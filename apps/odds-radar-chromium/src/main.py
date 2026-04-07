"""Ponto de entrada principal — loop de radar com scan periódico."""

from __future__ import annotations

import asyncio
import signal
import sys
from pathlib import Path

# Garante que o root do projeto esteja no path
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from config.settings import get_settings
from src.browser.engine import BrowserEngine
from src.scraper.bet365 import Bet365Scraper
from src.sheva.client import ShevaClient
from src.telegram.bot import TelegramNotifier
from src.utils.logger import get_logger

logger = get_logger("main")


class OddsRadar:
    """Orquestrador principal: browser → scraper → telegram."""

    def __init__(self):
        self.settings = get_settings()
        self.engine = BrowserEngine(self.settings.browser)
        self.scraper = Bet365Scraper(self.engine, self.settings.scraper)
        self.notifier = TelegramNotifier(self.settings.telegram)
        self.sheva = ShevaClient(self.settings.sheva_api_url)
        self._running = True

    async def start(self) -> None:
        """Inicia o loop de radar."""
        logger.info("═══════════════════════════════════════════")
        logger.info("  Sheva Odds Radar  —  Starting up")
        logger.info("  Interval: {}s | Sports: {}",
                     self.settings.scraper.scan_interval_sec,
                     self.settings.scraper.sports)
        logger.info("═══════════════════════════════════════════")

        await self.notifier.send_status("Radar iniciado ✅")

        cycle = 0
        while self._running:
            cycle += 1
            logger.info("─── Scan cycle #{} ───", cycle)

            try:
                result = await self.scraper.run_scan()

                logger.info(
                    "Cycle #{} complete: {} snapshots, {} errors, {} pages",
                    cycle,
                    len(result.snapshots),
                    len(result.errors),
                    result.pages_visited,
                )

                # Envia resultados via Telegram
                await self.notifier.send_scan_results(result)

                # Envia odds à API do Sheva (edita mensagens de dispatch)
                await self.sheva.push_scan_odds(result)

                # Alertas especiais: odds com grande movimentação
                for snap in result.snapshots:
                    for odd in snap.odds:
                        if odd.previous is not None:
                            delta = abs(odd.value - odd.previous)
                            pct = delta / odd.previous if odd.previous else 0
                            if pct >= 0.10:  # Moveu 10%+
                                await self.notifier.send_alert(
                                    snap,
                                    reason=f"Odd {odd.label} moveu {pct:.0%}",
                                )

            except Exception as e:
                logger.error("Scan cycle #{} failed: {}", cycle, e)
                await self.notifier.send_status(f"Erro no ciclo #{cycle}: {e}")

            # Espera até o próximo ciclo
            logger.info(
                "Sleeping {}s until next scan...",
                self.settings.scraper.scan_interval_sec,
            )
            await asyncio.sleep(self.settings.scraper.scan_interval_sec)

        await self.notifier.send_status("Radar encerrado 🛑")
        await self.notifier.close()
        await self.sheva.close()

    def stop(self) -> None:
        """Para o loop gracefully."""
        logger.info("Shutdown requested")
        self._running = False


async def main() -> None:
    radar = OddsRadar()

    # Graceful shutdown com SIGINT / SIGTERM
    loop = asyncio.get_running_loop()
    for sig in (signal.SIGINT, signal.SIGTERM):
        try:
            loop.add_signal_handler(sig, radar.stop)
        except NotImplementedError:
            # Windows não suporta add_signal_handler
            signal.signal(sig, lambda s, f: radar.stop())

    await radar.start()


if __name__ == "__main__":
    asyncio.run(main())
