"""Debug: na página E-Sports, procura links de competição (E-Soccer / GT Leagues)."""

import asyncio
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from config.settings import get_settings
from src.browser.engine import BrowserEngine
from src.browser.session import load_cookies, save_cookies


async def main():
    settings = get_settings()
    engine = BrowserEngine(settings.browser)

    async with engine.launch() as context:
        await load_cookies(context)
        page = await engine.new_page(context)

        url = settings.scraper.base_url + "/#/AS/B151/"
        print(f"Navigating to {url}...")
        await page.goto(url, wait_until="domcontentloaded")
        await asyncio.sleep(10)

        btn = await page.query_selector("#onetrust-accept-btn-handler")
        if btn:
            await btn.click()
            await asyncio.sleep(2)

        # Scroll the main content area to load all competitions
        for _ in range(5):
            await page.evaluate("window.scrollBy(0, 800)")
            await asyncio.sleep(1)

        # Get ALL text content from the center/right area (x > 440)
        items = await page.evaluate("""() => {
            const results = [];
            const allEls = document.querySelectorAll('*');
            const seen = new Set();
            for (const el of allEls) {
                if (el.children.length > 3) continue;
                const text = (el.textContent || '').trim();
                if (!text || text.length > 120 || text.length < 2 || seen.has(text)) continue;
                const rect = el.getBoundingClientRect();
                if (rect.width === 0 || rect.height === 0) continue;
                // Only center content area (x > 440)
                if (rect.x < 440) continue;
                seen.add(text);
                results.push({
                    text: text.slice(0, 100),
                    tag: el.tagName.toLowerCase(),
                    cls: (typeof el.className === 'string' ? el.className : '').slice(0, 120),
                    x: Math.round(rect.x),
                    y: Math.round(rect.y),
                });
            }
            return results;
        }""")

        print(f"\nCenter content items ({len(items)}):")
        for item in items:
            print(f"  ({item['x']},{item['y']}) [{item['tag']}] cls='{item['cls'][:50]}' → '{item['text']}'")

        # Specifically search for anything with soccer/gt/league/futebol
        keywords = await page.evaluate("""() => {
            const results = [];
            const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
            while (walker.nextNode()) {
                const text = walker.currentNode.textContent.trim().toLowerCase();
                if (text && (text.includes('soccer') || text.includes('gt') || 
                    text.includes('league') || text.includes('futebol') || 
                    text.includes('e-soccer'))) {
                    const parent = walker.currentNode.parentElement;
                    const rect = parent ? parent.getBoundingClientRect() : {};
                    results.push({
                        text: walker.currentNode.textContent.trim().slice(0, 100),
                        parentCls: parent ? (typeof parent.className === 'string' ? parent.className : '').slice(0, 80) : '',
                        parentTag: parent ? parent.tagName.toLowerCase() : '',
                        x: Math.round(rect.x || 0),
                        y: Math.round(rect.y || 0),
                    });
                }
            }
            return results;
        }""")
        
        print(f"\nKeyword matches (soccer/gt/league/futebol) ({len(keywords)}):")
        for k in keywords:
            print(f"  ({k['x']},{k['y']}) [{k['parentTag']}] cls='{k['parentCls'][:50]}' → '{k['text']}'")

        # Also look for coupon/competition links
        coupons = await page.evaluate("""() => {
            const results = [];
            // Common Bet365 selectors for competition links
            const selectors = [
                '[class*="CouponLink"]',
                '[class*="CompetitionHeader"]', 
                '[class*="MarketGroup"]',
                '[class*="League"]',
                '[class*="Competition"]',
                '[class*="sm-"]',
            ];
            for (const sel of selectors) {
                try {
                    const els = document.querySelectorAll(sel);
                    for (const el of els) {
                        const text = (el.textContent || '').trim();
                        if (text && text.length < 200) {
                            results.push({
                                selector: sel,
                                text: text.slice(0, 100),
                                cls: (typeof el.className === 'string' ? el.className : '').slice(0, 100),
                            });
                        }
                    }
                } catch(e) {}
            }
            return results;
        }""")
        
        print(f"\nCoupon/Competition elements ({len(coupons)}):")
        for c in coupons:
            print(f"  sel='{c['selector']}' cls='{c['cls'][:50]}' → '{c['text']}'")

        await page.screenshot(path="tmp/debug_esports_competitions.png", full_page=False)
        print("\nScreenshot saved to tmp/debug_esports_competitions.png")

        await save_cookies(context)
        await page.close()


if __name__ == "__main__":
    asyncio.run(main())
