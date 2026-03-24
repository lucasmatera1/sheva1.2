"""Aposta REAL de R$1.00 no primeiro jogo de GT Leagues.

⚠️  ESTE SCRIPT COLOCA UMA APOSTA DE VERDADE!
    Valor: R$1.00 | Side: home | Liga: GT Leagues
"""

from __future__ import annotations

import asyncio
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from config.settings import get_settings
from src.betting import BetPlacer
from src.betting.bet_log import BetLogger
from src.browser.engine import BrowserEngine
from src.browser.login import ensure_logged_in
from src.browser.session import load_cookies, save_cookies
from src.models.odds import BetRecord, BetSignal, BetStatus
from src.scraper.bet365 import Bet365Scraper
from src.utils.logger import get_logger

logger = get_logger("bet_real")

BET365_URL = "https://www.bet365.bet.br/#/AC/B1/C1/D1002/E71755867/G40/"
STAKE = 1.00


async def main() -> None:
    settings = get_settings()
    engine = BrowserEngine(settings.browser)
    scraper = Bet365Scraper(engine, settings.scraper)
    placer = BetPlacer(engine)
    bet_logger = BetLogger()

    print()
    print("=" * 60)
    print("  ⚠️  APOSTA REAL — R$1.00")
    print("  Liga: GT Leagues | Side: home")
    print("=" * 60)

    async with engine.launch() as context:
        await load_cookies(context)
        page = await engine.new_page(context)

        try:
            # 1. Navega (goto + espera curta — fixtures carregam rápido)
            print("\n⏳ Navegando para GT Leagues...")
            await page.goto(BET365_URL, wait_until="domcontentloaded")
            await asyncio.sleep(3)
            await scraper._dismiss_popups(page)

            # 2. Login check
            logged = await ensure_logged_in(page, context)
            if not logged:
                print("\n❌ Não logado! Execute: python scripts/manual_login.py")
                return
            print("🔐 Login: ✅")

            # 2b. Verifica geolocalização
            geo = await engine.check_geolocation(page)
            if geo:
                print(f"📍 Geolocalização: lat={geo['latitude']:.4f} lon={geo['longitude']:.4f}")
            else:
                print("⚠️  Geolocalização FALHOU — aposta pode ser rejeitada")

            # 2c. Fecha popup de geo do Bet365 se existir
            await engine.dismiss_geo_popup(page)

            # 3. Extrai fixtures com retry (GT Leagues cicla jogos rápido)
            snapshots = []
            for attempt in range(6):
                snapshots = await scraper._extract_all_odds(page)
                if snapshots:
                    break
                wait = 5 if attempt < 3 else 10
                print(f"   ⏳ Nenhum fixture ainda, tentando novamente em {wait}s... (tentativa {attempt+1}/6)")
                await asyncio.sleep(wait)
            if not snapshots:
                print("\n❌ Nenhuma fixture encontrada após 6 tentativas!")
                return

            # Filtra: só jogos com odds válidas (scraper já exclui finalizados)
            # Adicionalmente exclui jogos cujas odds são todas "PI" ou com valor suspeito
            valid = [
                s for s in snapshots
                if not s.match.score_home and not s.match.score_away
            ]
            if not valid:
                print(f"\n❌ {len(snapshots)} fixtures encontrados, mas todos finalizados/inválidos!")
                for s in snapshots:
                    sc = f" ({s.match.score_home}-{s.match.score_away})" if s.match.score_home is not None else ""
                    print(f"   ⏭  {s.match.home} vs {s.match.away}{sc}")
                return

            print(f"\n📋 {len(valid)} fixtures válidos (de {len(snapshots)} total)")
            first = valid[0]
            signal = BetSignal(
                signal_id="real-001",
                home_player=first.match.home,
                away_player=first.match.away,
                side="home",
                method_code="REAL_TEST",
                league="GT",
                odd_min=1.01,
                bet365_url=BET365_URL,
            )

            print(f"\n🎯 Jogo: {first.match.home} vs {first.match.away}")
            for o in first.odds:
                print(f"   {o.label}: {o.value:.2f}")

            # 4. Clica na odd home
            print(f"\n📌 Clicando na odd home...")
            odd_value = await placer.find_and_click_odd(page, signal)
            if odd_value is None:
                print("❌ Odd não encontrada!")
                return
            print(f"✅ Odd: {odd_value:.2f}")

            # 5. Preenche stake
            print(f"\n💰 Preenchendo R${STAKE:.2f}...")
            filled = await placer.fill_stake(page, STAKE)
            if not filled:
                print("❌ Falha ao preencher stake!")
                return
            print("✅ Stake preenchida")

            # 6. Screenshot antes da aposta
            Path("data/screenshots").mkdir(parents=True, exist_ok=True)
            await placer.take_screenshot(page, "data/screenshots/pre_bet.png")
            print("📸 Screenshot pré-aposta salvo")

            # 7. COLOCA A APOSTA
            print(f"\n🎰 COLOCANDO APOSTA R${STAKE:.2f} @ {odd_value:.2f}...")
            await asyncio.sleep(1)
            status = await placer.place_bet(page)

            # 8. Screenshot pós-aposta
            await asyncio.sleep(2)
            await placer.take_screenshot(page, "data/screenshots/post_bet.png")

            if status == BetStatus.ACCEPTED:
                print(f"\n✅ APOSTA ACEITA! R${STAKE:.2f} @ {odd_value:.2f}")
            elif status == BetStatus.REJECTED:
                print(f"\n⚠️  APOSTA REJEITADA")
            else:
                print(f"\n❌ ERRO na aposta (status: {status})")

            # 9. Fecha betslip
            await placer.close_betslip(page)

            # 10. Loga
            record = BetRecord(
                signal=signal,
                status=status,
                stake=STAKE,
                odd_found=odd_value,
            )
            bet_logger.log_bet(record)
            print(f"📝 Log: data/bets.csv")

            await save_cookies(context)

        except Exception as e:
            logger.error("Erro: {}", e)
            import traceback
            traceback.print_exc()
        finally:
            await page.close()

    print("\n" + "=" * 60)
    print("  FIM")
    print("=" * 60)


if __name__ == "__main__":
    asyncio.run(main())
