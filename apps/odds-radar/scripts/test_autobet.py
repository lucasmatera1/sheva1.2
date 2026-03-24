"""Teste do fluxo auto-bet com sinal simulado (sem depender da API Sheva)."""

from __future__ import annotations

import asyncio
import sys
from datetime import datetime
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from config.settings import get_settings
from src.betting import BetPlacer
from src.betting.bet_log import BetLogger
from src.browser.engine import BrowserEngine
from src.browser.login import ensure_logged_in, is_logged_in
from src.browser.session import load_cookies, save_cookies
from src.models.odds import BetRecord, BetSignal, BetStatus
from src.scraper.bet365 import Bet365Scraper
from src.telegram.bot import TelegramNotifier
from src.utils.logger import get_logger

logger = get_logger("test_autobet")

# URL da liga GT no Bet365
BET365_URL = "https://www.bet365.bet.br/#/AC/B1/C1/D1002/E71755867/G40/"


async def test_flow() -> None:
    """Simula o fluxo completo com um sinal fake."""
    settings = get_settings()
    engine = BrowserEngine(settings.browser)
    scraper = Bet365Scraper(engine, settings.scraper)
    placer = BetPlacer(engine)
    notifier = TelegramNotifier(settings.telegram)
    bet_logger = BetLogger()

    # Sinal simulado (pega o primeiro jogo que encontrar)
    signal = BetSignal(
        signal_id="test-001",
        home_player="",  # será preenchido após scan
        away_player="",
        side="home",
        method_code="TESTE",
        league="GT",
        odd_min=1.30,
        bet365_url=BET365_URL,
    )

    print("\n" + "=" * 60)
    print("  TESTE AUTO-BET (modo dry-run)")
    print("  URL:", BET365_URL)
    print("=" * 60)

    async with engine.launch() as context:
        await load_cookies(context)
        page = await engine.new_page(context)

        try:
            # 1. Navega e extrai fixtures
            await scraper._navigate_to(page, BET365_URL)
            await scraper._dismiss_popups(page)

            # 1b. Verifica login (cookies de sessão manual)
            logged = await ensure_logged_in(page, context)
            if logged:
                print("\n🔐 Login: ✅ Sessão ativa")
            else:
                print("\n⚠️  Não logado! Execute: python scripts/manual_login.py")

            snapshots = await scraper._extract_all_odds(page)
            if not snapshots:
                print("\n❌ Nenhuma fixture encontrada!")
                return

            # Pega a primeira fixture como alvo
            first = snapshots[0]
            signal = BetSignal(
                signal_id="test-001",
                home_player=first.match.home,
                away_player=first.match.away,
                side="home",
                method_code="TESTE",
                league="GT",
                odd_min=1.30,
                bet365_url=BET365_URL,
            )

            print(f"\n🎯 Alvo: {first.match.home} vs {first.match.away}")
            for o in first.odds:
                print(f"   {o.label}: {o.value:.2f}")

            # 2. Clica na odd
            print(f"\n📌 Clicando na odd 'home' ({signal.side})...")
            odd_value = await placer.find_and_click_odd(page, signal)

            if odd_value is None:
                print("❌ Não encontrou a odd para clicar!")
                return

            print(f"✅ Odd clicada: {odd_value:.2f}")

            # 3. Preenche stake (R$1.00 teste)
            stake = settings.autobet.default_stake
            print(f"\n💰 Preenchendo stake: R${stake:.2f}...")
            filled = await placer.fill_stake(page, stake)
            print(f"   {'✅ OK' if filled else '❌ Falhou'}")

            # 4. NÃO confirma aposta (dry-run) — só tira screenshot
            await asyncio.sleep(2)
            ss_path = str(Path("data/screenshots/test_betslip.png"))
            Path("data/screenshots").mkdir(parents=True, exist_ok=True)
            await placer.take_screenshot(page, ss_path)
            print(f"📸 Screenshot: {ss_path}")

            # 5. Lê odd do betslip
            betslip_odd = await placer.get_betslip_odd(page)
            if betslip_odd:
                print(f"📊 Odd no betslip: {betslip_odd:.2f}")

            # 6. Fecha betslip sem apostar
            await placer.close_betslip(page)
            print("\n🚫 Aposta NÃO realizada (dry-run)")

            # 7. Loga como teste
            record = BetRecord(
                signal=signal,
                status=BetStatus.CANCELLED,
                stake=stake,
                odd_found=odd_value,
                error_message="dry-run test",
            )
            bet_logger.log_bet(record)
            print(f"📝 Log gravado em data/bets.csv")

            await save_cookies(context)

        except Exception as e:
            logger.error("Erro no teste: {}", e)
            import traceback
            traceback.print_exc()
        finally:
            await page.close()

    print("\n" + "=" * 60)
    print("  TESTE CONCLUÍDO")
    print("=" * 60)


if __name__ == "__main__":
    asyncio.run(test_flow())
