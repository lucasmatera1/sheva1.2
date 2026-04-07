"""Daemon de aposta rápida — browser QUENTE, espera sinais via stdin.

Uso:
  python scripts/bet_daemon.py

O browser abre UMA VEZ, faz login, fecha popups e fica esperando.
Quando você cola uma URL + odd, ele aposta em ~5-8s.

Comandos no stdin:
  <URL>                → Aposta R$1.00 na primeira odd disponível
  <URL> <odd_value>    → Aposta R$1.00 na odd específica (ex: 2.15)
  stake <valor>        → Muda o stake (ex: stake 2.50)
  quit                 → Fecha o browser e sai
"""

from __future__ import annotations

import asyncio
import re
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from playwright.async_api import async_playwright
from config.settings import get_settings
from src.betting import BetPlacer
from src.browser.engine import BrowserEngine
from src.browser.login import ensure_logged_in
from src.browser.session import load_cookies, save_cookies
from src.models.odds import BetStatus
from src.utils.logger import get_logger

logger = get_logger("bet_daemon")

STAKE = 1.00


async def dismiss_popups(page) -> int:
    """Fecha todos os popups do Bet365."""
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


async def fast_bet(page, placer, url: str, stake: float, target_odd: float | None = None) -> None:
    """Aposta rápida: navega → clica odd → stake → aposta. Otimizado para velocidade."""
    t0 = time.perf_counter()

    # 1. Navega — SPA hash change se já estamos no Bet365 (muito mais rápido)
    print(f"  ⏳ Navegando para {url[:60]}...")
    current_url = page.url or ""
    if "bet365" in current_url and "#/" in url:
        # Já estamos no Bet365 — só muda o hash (SPA navigation)
        new_hash = url.split("#", 1)[1]
        await page.evaluate(f"window.location.hash = '{new_hash}'")
    else:
        await page.goto(url, wait_until="commit")
    # Espera odds aparecerem no DOM
    await page.wait_for_selector(".gl-Participant_General", timeout=15000)
    t_nav = time.perf_counter()
    print(f"  📄 Página carregada ({t_nav - t0:.1f}s)")

    # 2. Dismiss popups + encontra índice da odd via JS (1 roundtrip)
    odd_index = await page.evaluate(r"""(targetOdd) => {
        // Dismiss popups inline
        const cookie = document.querySelector('#onetrust-accept-btn-handler');
        if (cookie) cookie.click();
        const walk = document.createTreeWalker(document.body, NodeFilter.SHOW_ELEMENT, null);
        while (walk.nextNode()) {
            const el = walk.currentNode;
            const dt = Array.from(el.childNodes).filter(n => n.nodeType === 3).map(n => n.textContent.trim()).join('');
            if (dt === 'Continuar' || dt === 'Continue') { if (el.getBoundingClientRect().width > 50) { el.click(); break; } }
        }
        const closeBtns = document.querySelectorAll('[class*="IntroductoryPopup_Close"],[class*="NotificationsPopup_Close"],[class*="Popup"][class*="Close"]');
        closeBtns.forEach(b => { if (b.getBoundingClientRect().width > 0) b.click(); });

        // Encontra odd válida
        const odds = document.querySelectorAll('.gl-Participant_General');
        for (let i = 0; i < Math.min(odds.length, 30); i++) {
            const el = odds[i];
            const text = el.textContent.trim();
            const m = text.match(/(\d+[.,]\d+)/);
            if (!m) continue;
            const val = parseFloat(m[1].replace(',', '.'));
            if (val < 1.01) continue;
            if (targetOdd && Math.abs(val - targetOdd) > 0.02) continue;
            if (el.closest('[class*="Suspended"]')) continue;
            if (el.className.includes('Suspended')) continue;
            return { index: i, val: m[1], label: text.replace(m[1], '').trim() || '@' + m[1] };
        }
        return null;
    }""", target_odd)

    if not odd_index:
        print("  ❌ Nenhuma odd clicável encontrada!")
        return

    # Clique nativo via Playwright (anti-bot)
    await page.locator(".gl-Participant_General").nth(odd_index["index"]).click(timeout=3000)
    val_str = odd_index["val"]
    val = float(val_str.replace(",", "."))
    print(f"  ✅ Odd clicada: {val:.2f} ({odd_index['label']})")
    t_click = time.perf_counter()

    # 4. Espera stake field + preenche via JS direto (1 roundtrip)
    stake_loc = page.locator('div[contenteditable="true"].bsf-StakeBox_StakeValue-input').first
    try:
        await stake_loc.wait_for(state="attached", timeout=5000)
    except Exception:
        await asyncio.sleep(0.5)

    # Fill stake via Playwright keyboard (gera eventos reais que React captura)
    stake_str = f"{stake:.2f}"
    stake_loc = page.locator('div[contenteditable="true"].bsf-StakeBox_StakeValue-input').first
    try:
        await stake_loc.click(timeout=2000)
    except Exception:
        await stake_loc.evaluate("el => { el.focus(); el.click(); }")
    await page.keyboard.press("Control+a")
    await page.keyboard.press("Backspace")
    await page.keyboard.type(stake_str, delay=20)
    t_stake = time.perf_counter()
    print(f"  💰 Stake R${stake:.2f} preenchida ({t_stake - t0:.1f}s)")

    # 5. Espera botão ativo + clica (polling 100ms)
    for _ in range(30):
        btn_disabled = await page.evaluate("""() => {
            const btn = document.querySelector('.bsf-PlaceBetButton');
            return btn ? btn.className.includes('Disabled') : true;
        }""")
        if not btn_disabled:
            break
        await asyncio.sleep(0.1)

    # 6. Clica "Fazer Aposta" (Playwright nativo)
    btn = page.locator(".bsf-PlaceBetButton")
    try:
        await btn.click(timeout=3000)
    except Exception:
        await page.evaluate("() => { const b = document.querySelector('.bsf-PlaceBetButton'); if(b) b.click(); }")

    t_bet = time.perf_counter()
    print(f"  🎰 'Fazer Aposta' clicado ({t_bet - t0:.1f}s)")

    # 7. Espera resultado — 1 chamada JS para checar tudo de uma vez
    for i in range(40):
        await asyncio.sleep(0.2)

        result = await page.evaluate("""() => {
            // Accepted? — check receipt element FIRST (fast CSS selector)
            const receipt = document.querySelector('.bsf-ReceiptContent, .bs-Receipt, .bss-ReceiptContent');
            if (receipt) return { status: 'accepted' };

            // Accepted? — fallback: check text "Aposta Feita"
            const allText = document.body.innerText || '';
            if (allText.includes('Aposta Feita') || allText.includes('Bet Placed'))
                return { status: 'accepted' };

            // Odd changed? Auto-accept
            const acceptBtn = document.querySelector('.bsf-AcceptButton, .bsf-AcceptOdds');
            if (acceptBtn && acceptBtn.getBoundingClientRect().width > 0) {
                acceptBtn.click();
                return { status: 'odd_changed' };
            }
            // Error?
            const err = document.querySelector('.bs-GeneralErrorMessage');
            if (err) return { status: 'error', msg: err.textContent.trim().substring(0, 100) };
            return { status: 'waiting' };
        }""")

        st = result.get("status") if result else "waiting"

        if st == "accepted":
            t_done = time.perf_counter()
            print(f"\n  ✅ APOSTA ACEITA! R${stake:.2f} em {t_done - t0:.1f}s total")
            return

        if st == "odd_changed":
            print("  ⚠️  Odd mudou — aceitando...")
            await asyncio.sleep(0.3)
            try:
                await btn.click(timeout=2000)
            except Exception:
                pass
            continue

        if st == "error":
            t_done = time.perf_counter()
            print(f"\n  ❌ ERRO: {result.get('msg', '?')} ({t_done - t0:.1f}s)")
            return

    t_done = time.perf_counter()
    print(f"\n  ⚠️  Timeout esperando resultado ({t_done - t0:.1f}s)")


async def fast_fill_stake(page, stake: float) -> bool:
    """Fill stake otimizado — mínimo de sleeps."""
    loc = page.locator('div[contenteditable="true"].bsf-StakeBox_StakeValue-input').first
    try:
        await loc.click(timeout=2000)
    except Exception:
        await loc.evaluate("""el => { el.focus(); el.click(); }""")

    await page.keyboard.press("Control+a")
    await page.keyboard.press("Backspace")
    await page.keyboard.type(f"{stake:.2f}", delay=30)  # delay=30ms vs 100ms original
    await asyncio.sleep(0.2)

    # Verifica
    current = await loc.text_content()
    if not current or current.strip() == "":
        await loc.evaluate("el => { el.focus(); el.click(); }")
        await asyncio.sleep(0.1)
        await page.keyboard.type(f"{stake:.2f}", delay=30)

    return True


async def main() -> None:
    global STAKE
    settings = get_settings()
    engine = BrowserEngine(settings.browser)
    placer = BetPlacer(engine)

    print("=" * 60)
    print("  🔥 BET DAEMON — Browser Quente")
    print("  Comandos: <URL> [odd] | stake <valor> | quit")
    print("=" * 60)

    # Abre browser com Playwright Chromium (perfil persistente)
    s = settings.browser
    from src.browser.engine import STEALTH_CHROMIUM_ARGS

    args = list(STEALTH_CHROMIUM_ARGS)
    if not s.headless:
        args.append(f"--window-size={s.viewport_width},{s.viewport_height}")

    print("\n⏳ Abrindo browser...")
    pw = await async_playwright().start()
    context = await pw.chromium.launch_persistent_context(
        user_data_dir=s.user_data_dir,
        headless=s.headless,
        args=args,
        geolocation={"latitude": -23.4210, "longitude": -51.9331},
        permissions=["geolocation"],
        locale="pt-BR",
        timezone_id="America/Sao_Paulo",
        viewport={"width": s.viewport_width, "height": s.viewport_height},
        ignore_https_errors=True,
    )

    # Permissions
    for origin in ["https://www.bet365.bet.br", "https://bet365.bet.br", "https://www.bet365.com"]:
        try:
            await context.grant_permissions(["geolocation"], origin=origin)
        except Exception:
            pass
    await context.set_geolocation({"latitude": -23.4210, "longitude": -51.9331})

    # Load cookies
    await load_cookies(context)
    page = await context.new_page()
    await page.set_viewport_size({"width": s.viewport_width, "height": s.viewport_height})

    # Bloqueia recursos pesados para acelerar navegação
    await page.route("**/*.{png,jpg,jpeg,gif,svg,webp,ico,woff,woff2,ttf,eot}", lambda route: route.abort())
    await page.route("**/{analytics,tracking,beacon,pixel,telemetry,ads,doubleclick,googletag}**", lambda route: route.abort())

    # Navega para Bet365 homepage e valida login
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

    # Dismiss all popups (Continuar, App, etc.)
    await asyncio.sleep(2)
    n = await dismiss_popups(page)
    if n:
        print(f"   Fechou {n} popup(s)")

    # ─── Modo CLI: URL passada como argumento → aposta e sai ───────────
    cli_url = None
    cli_odd = None
    if len(sys.argv) > 1:
        cli_url = sys.argv[1]
        if len(sys.argv) > 2:
            try:
                cli_odd = float(sys.argv[2])
            except ValueError:
                pass

    if cli_url:
        print(f"\n{'='*50}")
        print(f"  ⚡ APOSTA RÁPIDA — R${STAKE:.2f}")
        print(f"  URL: {cli_url[:60]}")
        if cli_odd:
            print(f"  Odd alvo: {cli_odd}")
        print(f"{'='*50}")

        try:
            await fast_bet(page, placer, cli_url, STAKE, cli_odd)
        except Exception as e:
            print(f"  ❌ Erro: {e}")
            import traceback
            traceback.print_exc()
    else:
        # Modo interativo: espera URLs via stdin
        print("\n🟢 PRONTO — Cole a URL do jogo para apostar:\n")

        loop = asyncio.get_event_loop()
        while True:
            line = await loop.run_in_executor(None, sys.stdin.readline)
            line = line.strip()
            if not line:
                continue

            if line.lower() == "quit":
                print("👋 Encerrando...")
                break

            if line.lower().startswith("stake "):
                try:
                    STAKE = float(line.split()[1])
                    print(f"  💰 Stake atualizado: R${STAKE:.2f}")
                except ValueError:
                    print("  ❌ Valor inválido")
                continue

            parts = line.split()
            url = parts[0]
            target_odd = None
            if len(parts) > 1:
                try:
                    target_odd = float(parts[1])
                except ValueError:
                    pass

            if not url.startswith("http"):
                print("  ❌ URL inválida")
                continue

            print(f"\n{'='*50}")
            print(f"  ⚡ APOSTA RÁPIDA — R${STAKE:.2f}")
            print(f"  URL: {url[:60]}")
            if target_odd:
                print(f"  Odd alvo: {target_odd}")
            print(f"{'='*50}")

            try:
                await fast_bet(page, placer, url, STAKE, target_odd)
            except Exception as e:
                print(f"  ❌ Erro: {e}")
                import traceback
                traceback.print_exc()

            print("\n🟢 Pronto para próxima aposta:\n")

    await save_cookies(context)
    try:
        await browser.close()
    except Exception:
        pass
    print("Browser fechado.")


if __name__ == "__main__":
    asyncio.run(main())
