"""
Test PlaceBet Live — Abre browser, captura tokens (incluindo gwt), e tenta 1 bet.

Fluxo:
  1. Abre Camoufox → usuário faz login
  2. TokenHarvester extrai tokens (espera gwt do GeoComply)
  3. Navega ao In-Play eSports → captura fixture_id/selection_id via WS
  4. Faz 1 PlaceBet real (stake R$1) com a primeira seleção HC disponível

Uso:
    python scripts/test_placebet_live.py
    python scripts/test_placebet_live.py --dry-run   # não envia, só valida tokens
"""

from __future__ import annotations

import asyncio
import json
import os
import random
import sys
import time
from pathlib import Path

if sys.platform == "win32":
    import os
    os.environ.setdefault("PYTHONIOENCODING", "utf-8")
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    if hasattr(sys.stderr, "reconfigure"):
        sys.stderr.reconfigure(encoding="utf-8", errors="replace")

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from loguru import logger
from src.api.http_client import Bet365HttpClient, SessionTokens
from src.api.token_harvester import TokenHarvester
from src.api.ws_parser import Bet365WsParser
from src.betting.ui_placer import UIBetPlacer
from src.browser.engine import BrowserEngine
from src.browser.session import save_cookies

BET365_URL = "https://www.bet365.bet.br"
DRY_RUN = "--dry-run" in sys.argv


async def auto_login(page, context) -> bool:
    """Login humanizado automático usando credenciais do .env."""
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
            'input[type="text"], input[name="username"], input[autocomplete="username"]',
            timeout=15_000, state="visible",
        )
    except Exception:
        pass

    # Preenche user/pass via locator.fill() — imune a interferência de mouse/foco
    user_input = page.locator('input[type="text"]').first
    pass_input = page.locator('input[type="password"]').first
    await user_input.fill(bet_user)
    await asyncio.sleep(0.3)
    await pass_input.fill(bet_pass)
    await asyncio.sleep(0.3)

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
    print("  TEST PLACEBET LIVE")
    print(f"  Mode: {'DRY-RUN (sem aposta real)' if DRY_RUN else 'LIVE (vai apostar R$1)'}")
    print("=" * 60)
    print()

    # Enable debug logging for PlaceBet details
    import loguru
    logger.enable("src.api.http_client")

    engine = BrowserEngine()
    harvester = TokenHarvester(refresh_interval=120)
    parser = Bet365WsParser()

    # Mapa simples para capturar 1 seleção
    selections: list[dict] = []

    async with engine.launch() as context:
        page = await engine.new_page(context)
        page.set_default_timeout(30_000)

        # === 1. Login ===
        print("  [1/5] Abrindo browser — login automático...")
        await page.goto(BET365_URL, wait_until="domcontentloaded", timeout=30000)
        await asyncio.sleep(3)

        # Captura sync_term passivamente
        sync_term = ""
        def _on_req(request):
            nonlocal sync_term
            if "bet365" in request.url:
                term = request.headers.get("x-net-sync-term", "")
                if term and len(term) > 50 and not sync_term:
                    sync_term = term
        page.on("request", _on_req)

        # WS listener para capturar seleções
        ws_count = 0
        def _on_ws(ws):
            nonlocal ws_count
            ws_count += 1
            logger.info("WS #{} aberto: {}", ws_count, ws.url[:60])

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

        # Login automático
        logged = await auto_login(page, context)
        if logged:
            print("  ✅ Login automático OK!")
        else:
            print("  ⚠️ Login automático falhou — esperando login manual (pstk)...")
            for i in range(300):
                if sync_term:
                    break
                if i > 0 and i % 5 == 0:
                    ck = await context.cookies("https://www.bet365.bet.br")
                    ck_dict = {c["name"]: c["value"] for c in ck}
                    if ck_dict.get("pstk"):
                        break
                await asyncio.sleep(1)

        # === 2. Captura tokens iniciais ===
        print("  [2/5] Capturando tokens iniciais...")
        await save_cookies(context)
        tokens = await harvester.extract_from_page(page)
        if sync_term and not tokens.x_net_sync_term:
            tokens.x_net_sync_term = sync_term

        if not tokens.pstk:
            print("  FALHA: Sem pstk — login não detectado")
            return

        harvester.start_sync_term_listener(page)

        print(f"  pstk: OK  gwt: {'OK' if tokens.gwt else 'pendente'}  sync: {'OK' if tokens.x_net_sync_term else 'pendente'}")

        # === 3. Navega para In-Play eSports (ANTES de esperar gwt) ===
        # GeoComply tipicamente só dispara na navegação para páginas de bet ao vivo
        print("  [3/5] Navegando para In-Play eSports...")
        await page.evaluate("window.location.hash = '#/IP/B18'")
        await asyncio.sleep(5)

        # Espera WS
        for _ in range(60):
            if ws_count >= 1:
                break
            await asyncio.sleep(1)

        print(f"  WebSockets: {ws_count}")

        # === Espera gwt APÓS navegação ao In-Play (GeoComply trigger) ===
        tokens = await harvester.extract_from_page(page)
        if not tokens.gwt:
            print("  [*] Esperando gwt (15s max — Camoufox não tem GeoComply)...")
            for i in range(15):
                await asyncio.sleep(1)
                # Checa TODOS os cookies (qualquer domínio)
                all_ck = await context.cookies()
                ck_dict = {c["name"]: c["value"] for c in all_ck}
                if ck_dict.get("gwt"):
                    tokens = await harvester.extract_from_page(page)
                    print(f"  gwt detectado após {i + 1}s!")
                    break
                # Log a cada 15s
                if (i + 1) % 15 == 0:
                    names = sorted(ck_dict.keys())
                    print(f"  ... {i + 1}s — cookies: {', '.join(names[:15])}")
            else:
                # Dump all cookies for debugging
                all_ck = await context.cookies()
                names = sorted({c["name"] for c in all_ck})
                print(f"  gwt não apareceu após 120s")
                print(f"  Cookies ({len(names)}): {', '.join(names)}")

        print()
        print(f"  --- TOKEN STATUS ---")
        print(f"  pstk:  {tokens.pstk[:20]}...")
        print(f"  gwt:   {'OK (' + tokens.gwt[:20] + '...)' if tokens.gwt else 'AUSENTE'}")
        print(f"  swt:   {'OK' if tokens.swt else 'AUSENTE'}")
        print(f"  sync:  {'OK (' + str(len(tokens.x_net_sync_term)) + ' chars)' if tokens.x_net_sync_term else 'AUSENTE'}")
        print(f"  cf_bm: {'OK' if tokens.cf_bm else 'AUSENTE'}")
        print(f"  page_id: {tokens.page_id or 'EMPTY'}")
        print(f"  cookies totais: {len(tokens._all_cookies)}")
        print()

        # === 4. Espera fixtures ===
        print("  [4/5] Esperando fixtures (15s)...")
        await asyncio.sleep(15)
        print(f"  Selections capturadas: {len(selections)}")

        if not selections:
            print("  FALHA: Nenhuma selection capturada do WS")
            return

        # Pega primeira seleção com handicap (HC market)
        target = None
        for s in selections:
            if s.get("handicap") and s.get("odds"):
                target = s
                break

        if not target:
            print("  FALHA: Nenhuma selection com handicap encontrada")
            return

        print()
        print(f"  === SELEÇÃO DE TESTE ===")
        print(f"  Fixture:   {target['fixture_id']}")
        print(f"  Selection: {target['selection_id']}")
        print(f"  Player:    {target.get('name', '?')}")
        print(f"  Odds:      {target['odds']}")
        print(f"  Handicap:  {target['handicap']}")
        print()

        if DRY_RUN:
            print("  [DRY-RUN] Tokens e seleção OK. Não enviando PlaceBet.")
            print()
            print("  --- TOKEN SUMMARY ---")
            print(f"  gwt presente: {'SIM' if tokens.gwt else 'NAO'}")
            print(f"  sync_term presente: {'SIM' if tokens.x_net_sync_term else 'NAO'}")
            print(f"  Fixture Map: {len(selections)} selections capturadas")
            print(f"  Target: f={target['fixture_id']} s={target['selection_id']} odds={target['odds']} hc={target['handicap']}")
            print(f"  UIBetPlacer: pronto para uso")
            return

        # === 5. PlaceBet via UIBetPlacer (trusted CDP events) ===
        print("  [5/5] PlaceBet via UI automation (R$1.00)...")
        print()

        ui = UIBetPlacer(page)
        try:
            result = await ui.place_bet(
                fixture_id=target["fixture_id"],
                market="hc",
                handicap_line=float(target.get("handicap", "0").replace("+", "")),
                side="home",
                stake=1.00,
                navigate=True,
            )
        except Exception as e:
            print(f"  ERRO: {e}")
            import traceback
            traceback.print_exc()
            return

        print()
        print("  === RESULTADO (UI automation) ===")
        print(f"  Success: {result.success}")
        print(f"  SR: {result.sr}  CS: {result.cs}")
        if result.bet_receipt:
            print(f"  Receipt: {result.bet_receipt}")
        if result.odds:
            print(f"  Odds: {result.odds}")
        if result.error:
            print(f"  Error: {result.error}")
        if result.success:
            print("\n  >>> APOSTA ACEITA! <<<")
        else:
            print(f"\n  >>> Resultado: sr={result.sr} cs={result.cs} <<<")


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        print("\n  Ctrl+C")
