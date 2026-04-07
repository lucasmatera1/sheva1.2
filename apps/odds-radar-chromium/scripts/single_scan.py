"""Script utilitário para rodar um scan único (teste/debug)."""

from __future__ import annotations

import asyncio
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from config.settings import get_settings
from src.browser.engine import BrowserEngine
from src.scraper.bet365 import Bet365Scraper
from src.utils.logger import get_logger

logger = get_logger("single_scan")

# URL direta para a seção de futebol virtual / e-sports
DEFAULT_URL = "https://www.bet365.bet.br/#/AC/B1/C1/D1002/E71755867/G40/"


async def single_scan() -> None:
    """Executa um scan único e imprime resultado no console."""
    settings = get_settings()
    engine = BrowserEngine(settings.browser)
    scraper = Bet365Scraper(engine, settings.scraper)

    # Usa URL do argumento ou a default
    url = sys.argv[1] if len(sys.argv) > 1 else DEFAULT_URL

    logger.info("Running single scan on {}...", url[:80])
    result = await scraper.run_scan_url(url)

    print("\n" + "=" * 60)
    print(f"Snapshots: {len(result.snapshots)}")
    print(f"Errors:    {len(result.errors)}")
    print(f"Pages:     {result.pages_visited}")
    print("=" * 60)

    for snap in result.snapshots:
        m = snap.match
        odds_str = " | ".join(f"{o.label}: {o.value:.2f}" for o in snap.odds)
        minute = f" [{m.minute}]" if m.minute else ""
        print(f"  {m.league} | {m.home} vs {m.away}{minute} | {odds_str}")

    if result.errors:
        print("\nErrors:")
        for err in result.errors:
            print(f"  ❌ {err}")


if __name__ == "__main__":
    asyncio.run(single_scan())
