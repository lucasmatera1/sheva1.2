"""Quick test: Navega até GT Leagues e verifica se fixtures aparecem."""

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

    async with engine.launch() as context:
        await load_cookies(context)
        page = await engine.new_page(context)

        # Navega homepage
        await page.goto(settings.scraper.base_url, wait_until="domcontentloaded")
        await asyncio.sleep(8)
        await scraper._dismiss_popups(page)

        # Navega para GT Leagues
        await scraper._navigate_to_esoccer_gt(page)

        # Verifica URL e conteudo
        url = page.url
        print(f"\nCurrent URL: {url}")

        # Screenshot
        await page.screenshot(path="tmp/debug_gt_nav_test.png", full_page=False)
        print("Screenshot saved to tmp/debug_gt_nav_test.png")

        # Tenta extrair odds
        snapshots = await scraper._extract_all_odds(page)
        print(f"\nExtracted {len(snapshots)} fixtures")
        for snap in snapshots:
            odds_str = " | ".join(f"{o.label}={o.value}" for o in snap.odds)
            print(f"  {snap.match.home} vs {snap.match.away} [{snap.match.minute or 'pre'}] → {odds_str}")

        await save_cookies(context)
        await page.close()


if __name__ == "__main__":
    asyncio.run(main())
