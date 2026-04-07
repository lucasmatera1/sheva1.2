"""
Daemon de aposta HÍBRIDO — Etapa 2 do bot profissional.

Arquitetura:
  1. Browser Camoufox mantém sessão autenticada + validação GeoComply
  2. TokenHarvester extrai cookies/tokens periodicamente (auto-refresh)
  3. HTTP Client faz PlaceBet direto via httpx (<500ms vs 3s do DOM)
  4. Fallback: se HTTP falhar com geo_blocked, tenta via DOM (bet_daemon)

Uso:
  python scripts/bet_hybrid.py                        → modo interativo
  python scripts/bet_hybrid.py "<URL>" <fixture> <sel> <odd> [stake]  → aposta rápida

Comandos interativos:
  auto <URL> [odd]                                    → DOM flow + HTTP interceptor (⭐ recomendado)
  http <fixture_id> <selection_id> <odds> [stake]     → aposta via HTTP direto
  dom <URL> [odd]                                     → aposta via DOM puro (fallback)
  tokens                                              → mostra estado dos tokens
  refresh                                             → força refresh de tokens
  stats                                               → mostra stats do interceptor
  stake <valor>                                       → muda stake padrão
  quit                                                → encerra
"""

from __future__ import annotations

import asyncio
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from camoufox.async_api import AsyncCamoufox
from config.settings import get_settings
from src.api.bet_interceptor import BetInterceptor
from src.api.http_client import Bet365HttpClient
from src.api.token_harvester import TokenHarvester
from src.betting import BetPlacer
from src.browser.engine import BrowserEngine
from src.browser.login import ensure_logged_in
from src.browser.session import load_cookies
from src.utils.logger import get_logger

logger = get_logger("bet_hybrid")

STAKE = 1.00


async def dismiss_popups(page) -> int:
    """Fecha popups do Bet365."""
    total = 0
    for _ in range(5):
        closed = await page.evaluate("""() => {
            let count = 0;
            const cookie = document.querySelector('#onetrust-accept-btn-handler');
            if (cookie && cookie.offsetParent !== null) { cookie.click(); count++; }

            const walk = document.createTreeWalker(document.body, NodeFilter.SHOW_ELEMENT, null);
            while (walk.nextNode()) {
                const el = walk.currentNode;
                const dt = Array.from(el.childNodes)
                    .filter(n => n.nodeType === 3)
                    .map(n => n.textContent.trim()).join('');
                if ((dt === 'Continuar' || dt === 'Continue') &&
                    el.getBoundingClientRect().width > 50) {
                    el.click(); count++; break;
                }
            }
            const closeBtns = document.querySelectorAll(
                '[class*="IntroductoryPopup_Close"],[class*="NotificationsPopup_Close"],' +
                '[class*="pop-"][class*="_Close"],[class*="Popup"][class*="Close"]'
            );
            for (const btn of closeBtns) {
                if (btn.getBoundingClientRect().width > 0) { btn.click(); count++; }
            }
            return count;
        }""")
        if closed and closed > 0:
            total += closed
            await asyncio.sleep(0.5)
        else:
            break
    return total


async def http_bet(
    client: Bet365HttpClient,
    fixture_id: str,
    selection_id: str,
    odds: str,
    stake: float,
    handicap: str = "",
    market_type: int = 11,
    classification: int = 18,
) -> bool:
    """Faz aposta via HTTP direto. Retorna True se aceita."""
    t0 = time.perf_counter()
    result = await client.place_bet(
        fixture_id=fixture_id,
        selection_id=selection_id,
        odds=odds,
        stake=stake,
        handicap=handicap,
        market_type=market_type,
        classification=classification,
    )
    elapsed = time.perf_counter() - t0

    if result.success:
        print(f"  ✅ ACEITA via HTTP! ({elapsed:.3f}s)")
        print(f"     Ref: {result.bet_reference} | Ticket: {result.ticket_id}")
        print(f"     Odd: {result.odds} | Retorno: R${result.return_value:.2f}")
        return True
    else:
        print(f"  ❌ REJEITADA via HTTP ({elapsed:.3f}s)")
        print(f"     cs={result.completion_status} mi={result.message_id}")
        if result.is_geo_blocked:
            print("     ⚠️ Geo blocked — tokens podem precisar de refresh")
        return False


async def setup_browser():
    """Configura browser Camoufox com geo."""
    settings = get_settings()
    s = settings.browser
    engine = BrowserEngine(s)
    placer = BetPlacer(engine)

    _geo_json = '{"location":{"lat":-23.4210,"lng":-51.9331},"accuracy":30}'
    kw = {
        "headless": s.headless,
        "humanize": False,
        "os": "windows",
        "firefox_user_prefs": {
            "geo.enabled": True,
            "geo.prompt.testing": True,
            "geo.prompt.testing.allow": True,
            "permissions.default.geo": 1,
            "geo.provider.network.url": f"data:application/json,{_geo_json}",
            "geo.provider.ms-windows-location": False,
            "geo.provider.use_corelocation": False,
            "geo.provider.use_gpsd": False,
            "geo.provider.use_mls": False,
        },
    }

    print("⏳ Abrindo browser...")
    camoufox = AsyncCamoufox(**kw)
    browser = await camoufox.__aenter__()
    context = browser.contexts[0] if browser.contexts else await browser.new_context()

    for origin in [
        "https://www.bet365.bet.br",
        "https://bet365.bet.br",
        "https://www.bet365.com",
    ]:
        try:
            await context.grant_permissions(["geolocation"], origin=origin)
        except Exception:
            pass
    await context.set_geolocation({"latitude": -23.4210, "longitude": -51.9331})

    await load_cookies(context)
    page = await context.new_page()
    await page.set_viewport_size({"width": s.viewport_width, "height": s.viewport_height})

    # Bloqueia recursos pesados
    await page.route(
        "**/*.{png,jpg,jpeg,gif,svg,webp,ico,woff,woff2,ttf,eot}",
        lambda route: route.abort(),
    )
    await page.route(
        "**/{analytics,tracking,beacon,pixel,telemetry,ads,doubleclick,googletag}**",
        lambda route: route.abort(),
    )

    # Injeta geo stealth
    await page.add_init_script(BrowserEngine.GEO_STEALTH_SCRIPT)

    return browser, camoufox, context, page, engine, placer


async def main() -> None:
    global STAKE

    browser, camoufox, context, page, engine, placer = await setup_browser()

    # Navega e login
    print("⏳ Navegando para Bet365...")
    await page.goto("https://www.bet365.bet.br", wait_until="domcontentloaded")
    await asyncio.sleep(3)
    await dismiss_popups(page)

    logged = await ensure_logged_in(page, context)
    if not logged:
        print("❌ Não logado! Execute manual_login.py primeiro.")
        await browser.close()
        return
    print("🔐 Login: ✅")

    geo = await engine.check_geolocation(page)
    print(f"📍 Geo: {'OK' if geo else 'FALHOU'}")

    await asyncio.sleep(2)
    n = await dismiss_popups(page)
    if n:
        print(f"   Fechou {n} popup(s)")

    # ── Token Harvester: extrai tokens e inicia auto-refresh ──
    harvester = TokenHarvester()
    print("\n⏳ Extraindo tokens iniciais...")
    tokens = await harvester.full_extract(page)

    print(f"   pstk: {tokens.pstk[:20]}...")
    print(f"   gwt:  {tokens.gwt[:20]}...")
    print(f"   swt:  {tokens.swt[:20]}...")
    sync_preview = tokens.x_net_sync_term[:40] if tokens.x_net_sync_term else "(vazio)"
    print(f"   sync: {sync_preview}...")

    # Auto-refresh a cada 2 minutos
    await harvester.start_auto_refresh(page, interval=120)

    # ── Interceptor: captura PlaceBet e faz replay via HTTP ──
    interceptor = BetInterceptor(page, harvester)
    await interceptor.install()

    print("\n" + "=" * 60)
    print("  🔥 BET HYBRID — HTTP Interceptor + Browser Fallback")
    print("  Comandos:")
    print("    auto <URL> [odd]           ← DOM flow + HTTP interceptor (⭐)")
    print("    http <fxt> <sel> <odds>    ← HTTP direto (precisa IDs manuais)")
    print("    dom <URL> [odd]            ← DOM puro (fallback)")
    print("    tokens | refresh | stats | stake <val> | quit")
    print("=" * 60)

    # ── Loop interativo ──
    loop = asyncio.get_event_loop()
    while True:
        try:
            line = await loop.run_in_executor(None, sys.stdin.readline)
        except (EOFError, KeyboardInterrupt):
            break
        line = line.strip()
        if not line:
            continue

        if line.lower() == "quit":
            break

        if line.lower() == "tokens":
            state = harvester.state
            if state:
                t = state.tokens
                print(f"  gwt:  {t.gwt[:30]}...")
                print(f"  swt:  {t.swt[:30]}...")
                print(f"  sync: {t.x_net_sync_term[:50]}...")
                print(f"  age:  {int(state.age_seconds)}s")
                print(f"  refreshes: {state.refresh_count}")
            else:
                print("  ❌ Nenhum token extraído")
            continue

        if line.lower() == "refresh":
            print("  ⏳ Refresh manual...")
            tokens = await harvester.full_extract(page)
            print(f"  ✅ gwt={tokens.gwt[:30]}... sync={tokens.x_net_sync_term[:30]}...")
            continue

        if line.lower().startswith("stake "):
            try:
                STAKE = float(line.split()[1])
                print(f"  💰 Stake: R${STAKE:.2f}")
            except (ValueError, IndexError):
                print("  ❌ Valor inválido")
            continue

        # ── AUTO: DOM flow + HTTP interceptor (⭐ modo recomendado) ──
        if line.lower().startswith("auto "):
            parts = line.split()
            url = parts[1] if len(parts) > 1 else ""
            target_odd = float(parts[2]) if len(parts) > 2 else None

            if not url.startswith("http"):
                print("  ❌ URL inválida")
                continue

            print(f"  🎯 AUTO: DOM flow com interceptor HTTP")
            print(f"     URL: {url[:60]}...")
            if target_odd:
                print(f"     Odd alvo: {target_odd}")

            # Garante interceptor ativo
            interceptor.active = True

            # Usa fast_bet para navegação + click odd + fill stake + Fazer Aposta
            # O interceptor captura o PlaceBet POST e faz via HTTP com tokens frescos
            t0 = time.perf_counter()

            try:
                # Navega — SPA hash se já no Bet365
                current_url = page.url or ""
                if "bet365" in current_url and "#/" in url:
                    new_hash = url.split("#", 1)[1]
                    await page.evaluate(f"window.location.hash = '{new_hash}'")
                else:
                    await page.goto(url, wait_until="commit")

                await page.wait_for_selector(
                    ".gl-Participant_General",
                    timeout=8000,
                )
                await asyncio.sleep(0.3)

                # Encontra e clica na odd
                odd_info = await page.evaluate(r"""(targetOdd) => {
                    const odds = document.querySelectorAll('.gl-Participant_General');
                    for (let i = 0; i < Math.min(odds.length, 30); i++) {
                        const el = odds[i];
                        const text = el.textContent.trim();
                        const m = text.match(/(\d+[.,]\d+)/);
                        if (!m) continue;
                        const val = parseFloat(m[1].replace(',', '.'));
                        if (val < 1.01) continue;
                        if (targetOdd && Math.abs(val - targetOdd) > 0.05) continue;
                        if (el.closest('[class*="Suspended"]')) continue;
                        return { index: i, odd: m[1] };
                    }
                    return null;
                }""", target_odd)

                if not odd_info:
                    print("  ❌ Odd não encontrada na página")
                    continue

                # Clica na odd (Playwright nativo, anti-bot)
                await page.locator(".gl-Participant_General").nth(odd_info["index"]).click()
                print(f"  ✅ Odd clicada: {odd_info['odd']}")

                # Espera betslip aparecer
                await page.wait_for_selector(
                    ".bsf-StakeBox_StakeValue-input, [class*='StakeBox']",
                    timeout=5000,
                )

                # Fill stake
                stake_input = page.locator("div[contenteditable='true'].bsf-StakeBox_StakeValue-input")
                await stake_input.click()
                await page.keyboard.press("Control+a")
                await page.keyboard.type(f"{STAKE:.2f}", delay=20)
                await asyncio.sleep(0.3)

                # Clica "Fazer Aposta" — o interceptor captura o POST automaticamente
                bet_btn = page.locator(".bsf-PlaceBetButton").first
                if await bet_btn.count() and not await page.locator(".bsf-PlaceBetButton.Disabled").count():
                    await bet_btn.click()
                    print(f"  ⏳ Fazer Aposta clicado — interceptor aguardando...")

                    # Espera resultado do interceptor ou fallback DOM
                    result = await interceptor.wait_for_result(timeout=15.0)
                    elapsed = time.perf_counter() - t0

                    if result and result.success:
                        print(f"  ✅ ACEITA via HTTP interceptor! ({elapsed:.1f}s total)")
                    elif result and result.is_geo_blocked:
                        print(f"  ⚠️ HTTP geo_blocked — DOM fallback executado ({elapsed:.1f}s)")
                        # DOM já processou o fallback via route.continue_()
                    elif result:
                        print(f"  ❌ HTTP rejeitado: cs={result.completion_status} mi={result.message_id}")
                    else:
                        print(f"  ⏳ Sem resultado do interceptor — verificando DOM... ({elapsed:.1f}s)")
                else:
                    print("  ❌ Botão 'Fazer Aposta' não disponível ou desabilitado")

            except Exception as e:
                print(f"  ❌ Erro auto: {e}")
            continue

        # ── STATS ──
        if line.lower() == "stats":
            interceptor.print_stats()
            continue

        # ── HTTP bet ──
        if line.lower().startswith("http "):
            parts = line.split()
            if len(parts) < 4:
                print("  Uso: http <fixture_id> <selection_id> <odds> [stake] [handicap]")
                continue

            fixture_id = parts[1]
            selection_id = parts[2]
            odds = parts[3]
            stake = float(parts[4]) if len(parts) > 4 else STAKE
            handicap = parts[5] if len(parts) > 5 else ""

            # Pega tokens mais recentes
            current_tokens = harvester.tokens
            if not current_tokens or not current_tokens.gwt:
                print("  ❌ Tokens não disponíveis, fazendo refresh...")
                current_tokens = await harvester.full_extract(page)

            async with Bet365HttpClient(current_tokens) as client:
                ok = await http_bet(
                    client, fixture_id, selection_id, odds, stake, handicap,
                )
                # Propaga token chain para próximas apostas
                if client.tokens.last_bet_guid:
                    harvester.tokens.last_bet_guid = client.tokens.last_bet_guid
                if client.tokens.last_challenge:
                    harvester.tokens.last_challenge = client.tokens.last_challenge
            continue

        # ── DOM bet (fallback) ──
        if line.lower().startswith("dom "):
            parts = line.split()
            url = parts[1] if len(parts) > 1 else ""
            target_odd = float(parts[2]) if len(parts) > 2 else None

            if not url.startswith("http"):
                print("  ❌ URL inválida")
                continue

            # Importa fast_bet do bet_daemon
            from scripts.bet_daemon import fast_bet
            try:
                await fast_bet(page, placer, url, STAKE, target_odd)
            except Exception as e:
                print(f"  ❌ Erro DOM: {e}")
            continue

        print(f"  ❌ Comando não reconhecido: {line[:30]}")

    # Cleanup
    print("\n👋 Encerrando...")
    await interceptor.uninstall()
    await harvester.stop_auto_refresh()
    try:
        await browser.close()
    except Exception:
        pass
    try:
        await camoufox.__aexit__(None, None, None)
    except Exception:
        pass


if __name__ == "__main__":
    asyncio.run(main())
