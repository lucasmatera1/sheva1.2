"""Captura tokens de sesão do Bet365 para o bot API-only.

Abre o Chromium, você faz login manual, depois o script:
  1. Salva cookies de sessão
  2. Intercepta x-net-sync-term de requests reais do browser
  3. Captura page_id
  4. Salva tudo em src/data/live_tokens.json

Uso:
    python scripts/capture_tokens.py
    # Browser abre → você loga → pressiona ENTER → tokens salvos
"""

from __future__ import annotations

import asyncio
import json
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from config.settings import get_settings
from src.browser.engine import BrowserEngine
from src.browser.session import save_cookies
from src.api.token_harvester import TokenHarvester, TOKEN_FILE

BET365_URL = "https://www.bet365.bet.br/"
CAPTURE_DURATION = 15  # seconds to passively capture sync_term after login


async def _wait_enter(prompt: str = "  >>> Pressione ENTER após fazer login: ") -> None:
    loop = asyncio.get_running_loop()
    await loop.run_in_executor(None, lambda: input(prompt))


async def main() -> None:
    settings = get_settings()
    engine = BrowserEngine(settings.browser)

    print()
    print("=" * 60)
    print("  SHEVA — Captura de Tokens para Bot API-Only")
    print("=" * 60)
    print()
    print("  1. O browser vai abrir")
    print("  2. Faça login manual (usuário + senha)")
    print("  3. Navegue até a aba In-Play (Ao Vivo)")
    print("  4. Volte aqui e pressione ENTER")
    print("  5. Tokens serão capturados automaticamente")
    print()

    async with engine.launch() as context:
        page = await context.new_page()
        page.set_default_timeout(30_000)

        await page.goto(BET365_URL, wait_until="domcontentloaded", timeout=30000)
        await asyncio.sleep(3)

        # Fecha popup de cookies
        try:
            cookie_btn = await page.query_selector("#onetrust-accept-btn-handler")
            if cookie_btn:
                await cookie_btn.click()
                print("  [*] Popup de cookies fechado")
                await asyncio.sleep(1)
        except Exception:
            pass

        print("  [*] Browser aberto. Faça login agora...")
        print()

        await _wait_enter()

        print("  [*] Capturando tokens...")

        # 1. Save cookies
        await save_cookies(context)
        all_cookies = await context.cookies("https://www.bet365.bet.br")
        cookie_dict = {c["name"]: c["value"] for c in all_cookies}
        cookie_count = len(all_cookies)

        pstk = cookie_dict.get("pstk", "")
        if not pstk:
            print("  ❌ Cookie pstk não encontrado — login pode ter falhado")
            print("     Cookies encontrados:", list(cookie_dict.keys()))
            await page.close()
            return

        print(f"  ✅ {cookie_count} cookies capturados (pstk={pstk[:20]}...)")

        # 2. Intercepta x-net-sync-term passivamente
        print(f"  [*] Interceptando x-net-sync-term ({CAPTURE_DURATION}s)...")
        sync_term = ""
        page_id = ""

        sync_future: asyncio.Future[str] = asyncio.get_event_loop().create_future()
        pid_future: asyncio.Future[str] = asyncio.get_event_loop().create_future()

        def _on_request(request):
            nonlocal sync_term, page_id
            url = request.url
            if "bet365" not in url:
                return
            headers = request.headers
            term = headers.get("x-net-sync-term", "")
            if term and len(term) > 50 and not sync_future.done():
                sync_future.set_result(term)
            # Captura page_id
            if "?" in url and "p=" in url:
                from urllib.parse import parse_qs
                qs = parse_qs(url.split("?", 1)[1])
                pid = qs.get("p", [""])[0]
                if pid and not pid_future.done():
                    pid_future.set_result(pid)

        page.on("request", _on_request)

        # Faz uma navegação leve para triggerar requests que carregam sync_term
        try:
            await page.evaluate("""() => {
                fetch('/defaultapi/sports-configuration', { credentials: 'include' }).catch(() => {});
                fetch('/oddsoncouponcontentapi/coupon/esports/', { credentials: 'include' }).catch(() => {});
            }""")
        except Exception:
            pass

        try:
            sync_term = await asyncio.wait_for(sync_future, timeout=CAPTURE_DURATION)
            print(f"  ✅ x-net-sync-term capturado ({len(sync_term)} chars)")
        except asyncio.TimeoutError:
            print("  ⚠️ x-net-sync-term NÃO interceptado (timeout)")
            print("     Navegue pelo site (clique em In-Play, abra um jogo)")
            await _wait_enter("  >>> Pressione ENTER para tentar novamente: ")
            try:
                sync_term = await asyncio.wait_for(sync_future, timeout=10)
                print(f"  ✅ x-net-sync-term capturado ({len(sync_term)} chars)")
            except asyncio.TimeoutError:
                print("  ❌ sync_term não capturado. Apostas podem falhar sem ele.")

        try:
            page_id = await asyncio.wait_for(pid_future, timeout=2)
            print(f"  ✅ page_id capturado: {page_id}")
        except asyncio.TimeoutError:
            print("  ⚠️ page_id não capturado (não crítico)")

        # 3. Salva tudo no formato live_tokens.json
        data = {
            "pstk": pstk,
            "gwt": cookie_dict.get("gwt", ""),
            "swt": cookie_dict.get("swt", ""),
            "aaat": cookie_dict.get("aaat", ""),
            "pers": cookie_dict.get("pers", ""),
            "aps03": cookie_dict.get("aps03", ""),
            "__cf_bm": cookie_dict.get("__cf_bm", ""),
            "x_net_sync_term": sync_term,
            "page_id": page_id,
            "last_bet_guid": "",
            "last_challenge": "",
            "extracted_at": time.time(),
            "refresh_count": 0,
        }

        TOKEN_FILE.parent.mkdir(parents=True, exist_ok=True)
        TOKEN_FILE.write_text(json.dumps(data, indent=2), encoding="utf-8")

        # Também salva como session_tokens.json (formato alternativo)
        session_file = Path(__file__).resolve().parent.parent / "data" / "session_tokens.json"
        session_data = {
            "cookies": cookie_dict,
            "x_net_sync_term": sync_term,
            "page_id": page_id,
            "last_bet_guid": "",
            "last_challenge": "",
            "pstk": pstk,
            "extracted_at": time.strftime("%Y-%m-%dT%H:%M:%S"),
        }
        session_file.parent.mkdir(parents=True, exist_ok=True)
        session_file.write_text(json.dumps(session_data, indent=2), encoding="utf-8")

        print()
        print("  =" * 30)
        print(f"  📁 Tokens salvos em:")
        print(f"     {TOKEN_FILE}")
        print(f"     {session_file}")
        print()
        print(f"  📊 Status:")
        print(f"     pstk:     ✅ {pstk[:20]}...")
        print(f"     gwt:      {'✅' if data['gwt'] else '❌'}")
        print(f"     swt:      {'✅' if data['swt'] else '❌'}")
        print(f"     sync:     {'✅' if sync_term else '❌'} ({len(sync_term)} chars)")
        print(f"     page_id:  {'✅' if page_id else '❌'}")
        print(f"     aaat:     {'✅' if data['aaat'] else '❌'}")
        print(f"     cf_bm:    {'✅' if data['__cf_bm'] else '❌'}")
        print("  =" * 30)

        await page.close()

    print()
    print("  Browser fechado. Tokens prontos para uso pelo bot API-only.")
    print("  Execute: python scripts/bot_api.py")
    print()


if __name__ == "__main__":
    asyncio.run(main())
