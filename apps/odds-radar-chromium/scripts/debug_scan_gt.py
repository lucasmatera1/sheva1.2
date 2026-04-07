"""Debug: testa a navegação E-Sports > GT Leagues e extrai odds."""

import asyncio
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from config.settings import get_settings
from src.browser.engine import BrowserEngine
from src.browser.session import load_cookies, save_cookies
from src.scraper.bet365 import Bet365Scraper


async def main():
    settings = get_settings()
    engine = BrowserEngine(settings.browser)
    scraper = Bet365Scraper(engine, settings.scraper)

    result = await scraper.run_scan()

    print(f"\n{'='*60}")
    print(f"Scan complete: {len(result.snapshots)} snapshots, {len(result.errors)} errors")
    print(f"Pages visited: {result.pages_visited}")
    if result.errors:
        for err in result.errors:
            print(f"  ERROR: {err}")

    for snap in result.snapshots:
        odds_str = " | ".join(f"{o.label}={o.value}" for o in snap.odds)
        print(f"  {snap.match.home} vs {snap.match.away} — {odds_str}")


if __name__ == "__main__":
    asyncio.run(main())
