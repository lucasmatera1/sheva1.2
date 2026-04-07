"""Debug: na página GT Leagues, captura DOM da área de fixtures e odds."""

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

        await page.goto(settings.scraper.base_url, wait_until="domcontentloaded")
        await asyncio.sleep(8)
        await scraper._dismiss_popups(page)
        await scraper._navigate_to_esoccer_gt(page)

        # 1. Dump all elements in center content area with their classes
        items = await page.evaluate("""() => {
            const results = [];
            const allEls = document.querySelectorAll('*');
            const seen = new Set();
            for (const el of allEls) {
                if (el.children.length > 5) continue;
                const text = (el.textContent || '').trim();
                if (!text || text.length > 150 || text.length < 2 || seen.has(text)) continue;
                const rect = el.getBoundingClientRect();
                if (rect.width === 0 || rect.height === 0) continue;
                if (rect.x < 440) continue;  // Skip sidebar
                seen.add(text);
                results.push({
                    text: text.slice(0, 120),
                    tag: el.tagName.toLowerCase(),
                    cls: (typeof el.className === 'string' ? el.className : '').slice(0, 120),
                    x: Math.round(rect.x),
                    y: Math.round(rect.y),
                    w: Math.round(rect.width),
                    h: Math.round(rect.h || 0),
                });
            }
            return results.slice(0, 200);
        }""")

        print(f"\nCenter content ({len(items)}):")
        for item in items:
            print(f"  ({item['x']},{item['y']}) [{item['tag']}] cls='{item['cls'][:60]}' → '{item['text']}'")

        # 2. Check specific selectors
        sel_checks = [
            '.rcl-ParticipantFixtureDetails',
            '.rcl-ParticipantFixtureDetailsTeam_TeamName',
            '.sgl-ParticipantOddsOnly80_Odds',
            '.sgl-MarketOddsExpand',
            '.gl-MarketGroupContainer',
            '.ovm-FixtureDetailsTwoWay',
            '.ovm-FixtureDetailsThreeWay',
            '.ovm-Fixture',
            '.ovm-ParticipantOddsOnly',
            '.sl-CouponParticipantWithBookCloses',
            '.sl-MarketCouponFixtureLinkParticipant',
            '[class*="Fixture"]',
            '[class*="Participant"]',
            '[class*="Odds"]',
            '[class*="Coupon"]',
        ]
        
        print(f"\nSelector counts:")
        for sel in sel_checks:
            count = await page.evaluate(f"document.querySelectorAll('{sel}').length")
            if count > 0:
                texts = await page.evaluate(f"""() => {{
                    const els = document.querySelectorAll('{sel}');
                    return Array.from(els).slice(0, 3).map(e => ({{
                        cls: (typeof e.className === 'string' ? e.className : '').slice(0, 80),
                        text: (e.textContent || '').trim().slice(0, 80)
                    }}));
                }}""")
                print(f"  {sel} → {count}")
                for t in texts:
                    print(f"    cls='{t['cls'][:50]}' text='{t['text']}'")

        await page.screenshot(path="tmp/debug_gt_fixtures_dom.png", full_page=False)
        print("\nScreenshot saved to tmp/debug_gt_fixtures_dom.png")
        await save_cookies(context)
        await page.close()


if __name__ == "__main__":
    asyncio.run(main())
