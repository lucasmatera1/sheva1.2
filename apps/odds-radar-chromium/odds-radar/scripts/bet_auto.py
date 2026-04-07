"""Auto-Bet Completo — Browser quente + polling Sheva API + Telegram.

Combina a velocidade do bet_daemon.py com automação total:
  1. Abre browser UMA VEZ, faz login, fica quente
  2. Faz polling na API Sheva a cada N segundos
  3. Quando chega sinal → aposta em ~6-8s
  4. Envia resultado via Telegram
  5. Respeita limites (max bets/hora, stop-loss diário)

Uso:
  cd apps/odds-radar
  python scripts/bet_auto.py

Modos (via .env AUTOBET_MODE):
  full  → aposta imediatamente
  semi  → pede confirmação no Telegram antes
"""

from __future__ import annotations

import asyncio
import sys
import time
from datetime import datetime
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from camoufox.async_api import AsyncCamoufox
from config.settings import get_settings
from src.betting.bet_log import BetLogger
from src.browser.engine import BrowserEngine
from src.browser.login import ensure_logged_in
from src.browser.session import load_cookies, save_cookies
from src.models.odds import BetRecord, BetSignal, BetStatus
from src.signals.listener import SignalListener
from src.telegram.bot import TelegramNotifier
from src.utils.logger import get_logger

logger = get_logger("bet_auto")


# ─── Popups ──────────────────────────────────────────────────────────────────

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


# ─── Fast Bet (otimizado do bet_daemon.py) ───────────────────────────────────

async def fast_bet(
    page, url: str, stake: float, target_odd: float | None = None
) -> dict:
    """Aposta rápida com todas as otimizações. Retorna dict com resultado."""
    t0 = time.perf_counter()
    result = {"status": "error", "odd": 0.0, "time": 0.0, "msg": ""}

    # 1. Navega — SPA hash se já no Bet365
    current_url = page.url or ""
    if "bet365" in current_url and "#/" in url:
        new_hash = url.split("#", 1)[1]
        await page.evaluate(f"window.location.hash = '{new_hash}'")
    else:
        await page.goto(url, wait_until="commit")

    # Espera odds no DOM
    try:
        await page.wait_for_selector(".gl-Participant_General", timeout=15000)
    except Exception:
        result["msg"] = "Timeout esperando odds na página"
        result["time"] = time.perf_counter() - t0
        return result

    t_nav = time.perf_counter()
    logger.info("Página carregada ({:.1f}s)", t_nav - t0)

    # 2. Dismiss popups + encontra odd via JS (1 roundtrip)
    odd_index = await page.evaluate(r"""(targetOdd) => {
        // Dismiss inline
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
        result["msg"] = "Nenhuma odd clicável encontrada"
        result["time"] = time.perf_counter() - t0
        return result

    # Clique nativo via Playwright (anti-bot)
    await page.locator(".gl-Participant_General").nth(odd_index["index"]).click(timeout=3000)
    val = float(odd_index["val"].replace(",", "."))
    result["odd"] = val
    logger.info("Odd clicada: {:.2f}", val)

    # 3. Preenche stake via Playwright keyboard
    stake_loc = page.locator('div[contenteditable="true"].bsf-StakeBox_StakeValue-input').first
    try:
        await stake_loc.wait_for(state="attached", timeout=5000)
    except Exception:
        await asyncio.sleep(0.5)

    try:
        await stake_loc.click(timeout=2000)
    except Exception:
        await stake_loc.evaluate("el => { el.focus(); el.click(); }")
    await page.keyboard.press("Control+a")
    await page.keyboard.press("Backspace")
    await page.keyboard.type(f"{stake:.2f}", delay=20)

    t_stake = time.perf_counter()
    logger.info("Stake R${:.2f} preenchida ({:.1f}s)", stake, t_stake - t0)

    # 4. Espera botão ativo
    for _ in range(30):
        btn_disabled = await page.evaluate("""() => {
            const btn = document.querySelector('.bsf-PlaceBetButton');
            return btn ? btn.className.includes('Disabled') : true;
        }""")
        if not btn_disabled:
            break
        await asyncio.sleep(0.1)

    # 5. Clica "Fazer Aposta" (Playwright nativo)
    btn = page.locator(".bsf-PlaceBetButton")
    try:
        await btn.click(timeout=3000)
    except Exception:
        await page.evaluate(
            "() => { const b = document.querySelector('.bsf-PlaceBetButton'); if(b) b.click(); }"
        )

    t_bet = time.perf_counter()
    logger.info("'Fazer Aposta' clicado ({:.1f}s)", t_bet - t0)

    # 6. Espera resultado — polling unificado
    for _ in range(40):
        await asyncio.sleep(0.2)
        check = await page.evaluate("""() => {
            const receipt = document.querySelector('.bsf-ReceiptContent, .bs-Receipt, .bss-ReceiptContent');
            if (receipt) return { status: 'accepted' };
            const allText = document.body.innerText || '';
            if (allText.includes('Aposta Feita') || allText.includes('Bet Placed'))
                return { status: 'accepted' };
            const acceptBtn = document.querySelector('.bsf-AcceptButton, .bsf-AcceptOdds');
            if (acceptBtn && acceptBtn.getBoundingClientRect().width > 0) {
                acceptBtn.click();
                return { status: 'odd_changed' };
            }
            const err = document.querySelector('.bs-GeneralErrorMessage');
            if (err) return { status: 'error', msg: err.textContent.trim().substring(0, 100) };
            return { status: 'waiting' };
        }""")

        st = check.get("status") if check else "waiting"

        if st == "accepted":
            t_done = time.perf_counter()
            result["status"] = "accepted"
            result["time"] = t_done - t0
            logger.info("APOSTA ACEITA! R${:.2f} @ {:.2f} em {:.1f}s", stake, val, t_done - t0)
            return result

        if st == "odd_changed":
            logger.info("Odd mudou — aceitando...")
            await asyncio.sleep(0.3)
            try:
                await btn.click(timeout=2000)
            except Exception:
                pass
            continue

        if st == "error":
            t_done = time.perf_counter()
            result["status"] = "error"
            result["msg"] = check.get("msg", "Erro desconhecido")
            result["time"] = t_done - t0
            return result

    result["status"] = "timeout"
    result["msg"] = "Timeout esperando confirmação"
    result["time"] = time.perf_counter() - t0
    return result


# ─── Processamento de Sinal ──────────────────────────────────────────────────

async def process_signal(
    page,
    signal: BetSignal,
    stake: float,
    notifier: TelegramNotifier,
    bet_logger: BetLogger,
    listener: SignalListener,
    mode: str,
    confirm_timeout: int,
) -> None:
    """Processa um sinal: navega, aposta, notifica."""
    record = BetRecord(signal=signal, stake=stake)

    logger.info(
        "═══ SINAL: {} vs {} | side={} | method={} | liga={} ═══",
        signal.home_player, signal.away_player, signal.side,
        signal.method_code, signal.league,
    )

    url = signal.bet365_url
    if not url:
        record.status = BetStatus.ERROR
        record.error_message = "Sem URL Bet365 no sinal"
        await _finalize(record, notifier, bet_logger, listener)
        return

    # Modo semi: pede confirmação no Telegram antes
    if mode == "semi":
        # Primeiro, navega e pega a odd real
        await notifier.send_status(
            f"🎯 Sinal: {signal.home_player} vs {signal.away_player} ({signal.side})\n"
            f"Liga: {signal.league} | Método: {signal.method_code}\n"
            f"Buscando odd\\.\\.\\."
        )
        # TODO: poderia navegar, pegar odd, e perguntar. Por agora, pede confirmação direto.
        await notifier.send_bet_preview(signal, signal.odd_min, stake)
        response = await notifier.wait_for_confirmation(confirm_timeout)
        if response != "apostar":
            record.status = (
                BetStatus.CANCELLED if response == "cancelar" else BetStatus.TIMEOUT
            )
            logger.info("Sinal {} — resposta: {}", signal.signal_id, response)
            await _finalize(record, notifier, bet_logger, listener)
            return

    # Aposta rápida
    print(f"\n⚡ APOSTANDO: {signal.home_player} vs {signal.away_player} (R${stake:.2f})")
    bet_result = await fast_bet(page, url, stake)

    record.odd_found = bet_result["odd"]
    record.potential_return = bet_result["odd"] * stake

    if bet_result["status"] == "accepted":
        record.status = BetStatus.ACCEPTED
        record.placed_at = datetime.utcnow()
        print(f"✅ ACEITA! Odd {bet_result['odd']:.2f} em {bet_result['time']:.1f}s")
    elif bet_result["status"] == "timeout":
        record.status = BetStatus.ERROR
        record.error_message = bet_result["msg"]
        print(f"⚠️ TIMEOUT: {bet_result['msg']}")
    else:
        record.status = BetStatus.ERROR
        record.error_message = bet_result["msg"]
        print(f"❌ ERRO: {bet_result['msg']}")

    await _finalize(record, notifier, bet_logger, listener)


async def _finalize(
    record: BetRecord,
    notifier: TelegramNotifier,
    bet_logger: BetLogger,
    listener: SignalListener,
) -> None:
    """Loga e notifica resultado."""
    bet_logger.log_bet(record)
    await notifier.send_bet_result(record)
    await listener.mark_processed(record.signal.signal_id, record.status.value)
    logger.info("Finalizado: {} — {}", record.signal.signal_id, record.status.value)


# ─── Main ────────────────────────────────────────────────────────────────────

async def main() -> None:
    settings = get_settings()
    ab = settings.autobet
    engine = BrowserEngine(settings.browser)
    listener = SignalListener()
    notifier = TelegramNotifier(settings.telegram)
    bet_logger = BetLogger()

    mode = ab.mode  # "full" ou "semi"
    stake = ab.default_stake
    poll_sec = ab.sheva_poll_interval_sec

    print("=" * 60)
    print("  🤖 AUTO-BET — Totalmente Automático")
    print(f"  Mode: {mode} | Stake: R${stake:.2f}")
    print(f"  Limites: {ab.max_bets_per_hour}x/hora, R${ab.max_daily_loss:.2f}/dia")
    print(f"  Polling Sheva API: a cada {poll_sec}s")
    print("=" * 60)

    # ─── Abre browser quente (mesma config do bet_daemon.py) ─────────────
    s = settings.browser
    _geo_json = '{"location":{"lat":-23.5505,"lng":-46.6333},"accuracy":50}'

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

    print("\n⏳ Abrindo browser...")
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
    await context.set_geolocation({"latitude": -23.5505, "longitude": -46.6333})

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

    # Navega e valida login
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

    await notifier.send_status(
        f"Auto\\-Bet iniciado \\(mode\\={mode}, stake\\=R${stake:.2f}\\)"
    )

    print(f"\n🟢 AUTO-BET ATIVO — Esperando sinais da API Sheva...\n")

    # ─── Loop principal: polling da API ──────────────────────────────────
    try:
        while True:
            try:
                async for signal in listener.poll_signals():
                    # Verifica limites
                    if bet_logger.hourly_bet_count() >= ab.max_bets_per_hour:
                        msg = f"Limite {ab.max_bets_per_hour}x/hora atingido"
                        logger.warning(msg)
                        await notifier.send_status(f"⛔ {msg}")
                        await listener.mark_processed(signal.signal_id, "blocked")
                        continue

                    if bet_logger.daily_loss() >= ab.max_daily_loss:
                        msg = f"Stop-loss R${ab.max_daily_loss:.2f}/dia atingido"
                        logger.warning(msg)
                        await notifier.send_status(f"⛔ {msg}")
                        await listener.mark_processed(signal.signal_id, "blocked")
                        continue

                    # Processa o sinal
                    await process_signal(
                        page=page,
                        signal=signal,
                        stake=stake,
                        notifier=notifier,
                        bet_logger=bet_logger,
                        listener=listener,
                        mode=mode,
                        confirm_timeout=ab.confirm_timeout_sec,
                    )

                    # Dismiss popups entre apostas
                    await dismiss_popups(page)

            except Exception as e:
                logger.error("Erro no ciclo de polling: {}", e)

            # Aguarda antes do próximo poll
            await asyncio.sleep(poll_sec)

    except KeyboardInterrupt:
        print("\n👋 Encerrando...")
    finally:
        await save_cookies(context)
        await listener.close()
        await notifier.close()
        try:
            await browser.close()
        except Exception:
            pass
        print("Browser fechado. Auto-Bet encerrado.")


if __name__ == "__main__":
    asyncio.run(main())
