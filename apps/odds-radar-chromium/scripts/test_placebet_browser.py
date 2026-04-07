"""
Test PlaceBet via browser fetch() — versão simplificada.

Faz o PlaceBet usando fetch() DENTRO do browser para incluir todos os cookies
automaticamente (especialmente gwt se existir).

Uso:
    python scripts/test_placebet_browser.py
    python scripts/test_placebet_browser.py --dry-run
"""

from __future__ import annotations

import asyncio
import json
import os
import random
import sys
import time
import uuid
from pathlib import Path

if sys.platform == "win32":
    os.environ.setdefault("PYTHONIOENCODING", "utf-8")
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    if hasattr(sys.stderr, "reconfigure"):
        sys.stderr.reconfigure(encoding="utf-8", errors="replace")

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from loguru import logger
from src.api.http_client import _build_ns_payload
from src.api.ws_parser import Bet365WsParser
from src.browser.engine import BrowserEngine
from src.browser.session import save_cookies

BET365_URL = "https://www.bet365.bet.br"
DRY_RUN = "--dry-run" in sys.argv


async def auto_login(page, context) -> bool:
    """Login humanizado automático."""
    bet_user = os.environ.get("BET365_USER", "")
    bet_pass = os.environ.get("BET365_PASS", "")
    if not bet_user or not bet_pass:
        return False

    try:
        cookie_btn = await page.query_selector("#onetrust-accept-btn-handler")
        if cookie_btn:
            await cookie_btn.click()
            await asyncio.sleep(1)
    except Exception:
        pass

    login_visible = await page.evaluate("""() => {
        const btns = [...document.querySelectorAll('button')];
        return btns.some(b => b.textContent.trim() === 'Login');
    }""")
    if not login_visible:
        return True

    login_bbox = await page.evaluate("""() => {
        const btns = [...document.querySelectorAll('button')];
        const loginBtn = btns.find(b => b.textContent.trim() === 'Login');
        if (loginBtn) {
            const r = loginBtn.getBoundingClientRect();
            if (r.width > 0) return { x: r.x, y: r.y, w: r.width, h: r.height };
        }
        return null;
    }""")
    if login_bbox:
        lx = login_bbox["x"] + random.uniform(5, max(6, login_bbox["w"] - 5))
        ly = login_bbox["y"] + random.uniform(3, max(4, login_bbox["h"] - 3))
        await page.mouse.click(lx, ly)
    else:
        return False

    try:
        await page.wait_for_load_state("domcontentloaded", timeout=10_000)
    except Exception:
        pass
    await asyncio.sleep(2)

    try:
        await page.wait_for_selector(
            'input[type="text"], input[name="username"]',
            timeout=15_000, state="visible",
        )
    except Exception:
        pass

    await page.evaluate("""() => {
        const sel = document.querySelector('input[type="text"]')
            || document.querySelector('input[name="username"]')
            || document.querySelector('input[autocomplete="username"]')
            || document.querySelector('input:not([type="password"]):not([type="hidden"])');
        if (sel) sel.focus();
    }""")
    await asyncio.sleep(0.3)
    await page.keyboard.press("Control+a")
    await page.keyboard.press("Backspace")
    await page.keyboard.type(bet_user, delay=55)
    await asyncio.sleep(0.5)

    await page.evaluate("""() => {
        const pw = document.querySelector('input[type="password"]');
        if (pw) pw.focus();
    }""")
    await asyncio.sleep(0.3)
    await page.keyboard.press("Control+a")
    await page.keyboard.press("Backspace")
    await page.keyboard.type(bet_pass, delay=65)
    await asyncio.sleep(0.5)

    await page.keyboard.press("Enter")
    await asyncio.sleep(8)

    for _ in range(3):
        ck = await context.cookies("https://www.bet365.bet.br")
        if any(c["name"] == "pstk" for c in ck):
            return True
        await asyncio.sleep(3)
    return False


async def main():
    print()
    print("=" * 60)
    print("  TEST PLACEBET VIA BROWSER FETCH()")
    print(f"  Mode: {'DRY-RUN' if DRY_RUN else 'LIVE (R$1)'}")
    print("=" * 60)
    print()

    engine = BrowserEngine()
    parser = Bet365WsParser()
    
    # Stores
    sync_term = ""
    selections: list[dict] = []
    ws_count = 0

    async with engine.launch() as context:
        page = await engine.new_page(context)
        page.set_default_timeout(30_000)

        # === Captura sync_term de qualquer request ===
        def _on_req(request):
            nonlocal sync_term
            if "bet365" in request.url:
                term = request.headers.get("x-net-sync-term", "")
                if term and len(term) > 50:
                    sync_term = term  # Atualiza sempre com o mais fresco

        page.on("request", _on_req)

        # === WS listener ===
        def _on_ws(ws):
            nonlocal ws_count
            ws_count += 1
            def _on_frame(payload):
                if isinstance(payload, bytes):
                    return
                parsed = parser.parse_odds_update(payload)
                if parsed:
                    for p in parsed:
                        if p.get("name") and p.get("handicap"):
                            selections.append(p)
            ws.on("framereceived", lambda data: _on_frame(data))

        page.on("websocket", _on_ws)

        # === 1. Login ===
        print("  [1] Login...")
        await page.goto(BET365_URL, wait_until="domcontentloaded", timeout=30000)
        await asyncio.sleep(3)

        logged = await auto_login(page, context)
        if logged:
            print("  OK - Login")
        else:
            print("  FALHA - esperando login manual (60s)...")
            for _ in range(60):
                ck = await context.cookies("https://www.bet365.bet.br")
                if any(c["name"] == "pstk" for c in ck):
                    break
                await asyncio.sleep(1)

        # === 2. Navega ===
        print("  [2] Navegando para In-Play eSports...")
        await page.evaluate("window.location.hash = '#/IP/B18'")
        await asyncio.sleep(8)

        # Espera WS
        for _ in range(30):
            if ws_count >= 1:
                break
            await asyncio.sleep(1)

        print(f"  WS: {ws_count}")

        # === 3. Espera fixtures ===
        print("  [3] Esperando selections (20s)...", flush=True)
        try:
            await asyncio.sleep(20)
        except Exception as e:
            print(f"  ERRO durante sleep: {e}", flush=True)
        print(f"  Selections: {len(selections)}", flush=True)

        # === 4. Estado da sessão ===
        all_ck = await context.cookies()
        ck_names = sorted({c["name"] for c in all_ck})
        ck_dict = {c["name"]: c["value"] for c in all_ck}
        has_gwt = "gwt" in ck_dict and bool(ck_dict["gwt"])

        print(f"\n  --- SESSÃO ---")
        print(f"  Cookies ({len(ck_names)}): {', '.join(ck_names)}")
        print(f"  gwt: {'SIM (' + str(len(ck_dict.get('gwt', ''))) + ' chars)' if has_gwt else 'NAO'}")
        print(f"  sync_term: {'SIM (' + str(len(sync_term)) + ' chars)' if sync_term else 'NAO'}")
        print()

        if not selections:
            print("  FALHA: Nenhuma selection capturada")
            return

        # Pega uma seleção com handicap
        target = None
        for s in selections:
            if s.get("handicap") and s.get("odds"):
                target = s
                break
        if not target:
            target = selections[0]

        print(f"  === SELEÇÃO ===")
        print(f"  Fixture:  {target['fixture_id']}")
        print(f"  Selection:{target['selection_id']}")
        print(f"  Odds:     {target['odds']}")
        print(f"  HC:       {target.get('handicap', 'N/A')}")
        print()

        if DRY_RUN:
            ns = _build_ns_payload(
                fixture_id=target["fixture_id"],
                selection_id=target["selection_id"],
                odds=target["odds"],
                stake=1.00,
                handicap=target.get("handicap", ""),
            )
            print(f"  [DRY-RUN] ns = {ns}")
            print(f"  sync_term: {len(sync_term)} chars")
            print(f"  gwt: {'SIM' if has_gwt else 'NAO'}")
            return

        # === 5. PlaceBet via browser fetch() ===
        print("  [5] PlaceBet via browser fetch()...")

        ns = _build_ns_payload(
            fixture_id=target["fixture_id"],
            selection_id=target["selection_id"],
            odds=target["odds"],
            stake=1.00,
            handicap=target.get("handicap", ""),
            market_type=11,
            classification=18,
        )

        body = (
            f"&ns={ns}"
            f"&xb=1"
            f"&aa=null"
            f"&betsource=FlashInPLay"
            f"&tagType=WindowsDesktopBrowser"
            f"&bs=99"
            f"&qb=1"
        )

        bet_guid = str(uuid.uuid4())
        page_id = str(random.randint(10**17, 10**19 - 1))
        url = f"https://www.bet365.bet.br/BetsWebAPI/placebet?betGuid={bet_guid}&p={page_id}"

        print(f"  URL: {url[:120]}")
        print(f"  Body ({len(body)} chars): {body[:200]}")
        print(f"  sync_term: {len(sync_term)} chars")

        # Executa fetch() DENTRO do browser
        result = await page.evaluate("""async ([url, body, syncTerm]) => {
            try {
                const headers = {
                    'Content-Type': 'application/x-www-form-urlencoded',
                    'x-net-sync-term': syncTerm,
                    'x-request-id': crypto.randomUUID(),
                };
                const resp = await fetch(url, {
                    method: 'POST',
                    headers: headers,
                    body: body,
                    credentials: 'include',
                });
                const text = await resp.text();
                return {
                    ok: true,
                    status: resp.status,
                    body: text,
                    cookieCount: document.cookie.split(';').length,
                };
            } catch (e) {
                return { ok: false, error: e.message };
            }
        }""", [url, body, sync_term])

        print(f"\n  === RESULTADO ===")
        print(f"  HTTP Status: {result.get('status')}")
        print(f"  Browser cookie count: {result.get('cookieCount', '?')}")
        
        body_text = result.get("body", "")
        if result.get("error"):
            print(f"  Error: {result['error']}")
            return

        print(f"  Response body: {body_text[:500]}")

        if body_text:
            try:
                data = json.loads(body_text)
                cs = data.get("cs", -1)
                mi = data.get("mi", "")
                sr = data.get("sr", "")
                bg = data.get("bg", "")
                cc_tok = data.get("cc", "")

                print(f"\n  CS={cs}  SR={sr}  MI='{mi}'")
                
                if cs == 3:
                    print(f"  *** APOSTA ACEITA! ***")
                    print(f"  Ref: {data.get('br', '')}")
                    print(f"  Return: {data.get('re', 0)}")
                elif sr == -1:
                    print(f"  SR=-1 → Rejeição imediata (formato/sessão)")
                    print(f"  Hipótese: gwt obrigatório para PlaceBet")
                elif mi == "geo_services_blocked":
                    print(f"  GEO BLOCKED → Formato OK! Problema é geo/gwt")
                    print(f"  next betGuid: {bg[:30]}...")
                    print(f"  next challenge: {cc_tok[:30]}...")
                else:
                    print(f"  Outra rejeição: cs={cs} mi={mi}")

                print(f"\n  Full: {json.dumps(data, indent=2)[:600]}")
            except json.JSONDecodeError:
                print(f"  Response não é JSON")


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        print("\n  Ctrl+C")
    except Exception as e:
        import traceback
        print(f"\n  ERRO FATAL: {e}")
        traceback.print_exc()
