"""Quick test: navigate to Basquete and screenshot to verify odds appear."""
from __future__ import annotations

import asyncio
import os
import sys
from pathlib import Path

if sys.platform == "win32":
    os.environ.setdefault("PYTHONIOENCODING", "utf-8")
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    if hasattr(sys.stderr, "reconfigure"):
        sys.stderr.reconfigure(encoding="utf-8", errors="replace")

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from src.browser.engine import BrowserEngine
from src.browser.session import load_cookies


async def main():
    engine = BrowserEngine()
    screenshot_path = Path(__file__).resolve().parent.parent / "tmp" / "spectator_live.png"
    screenshot_path.parent.mkdir(parents=True, exist_ok=True)

    async with engine.launch() as context:
        page = await engine.new_page(context)
        page.set_default_timeout(30_000)

        # Load cookies
        loaded = await load_cookies(context)
        print(f"Cookies loaded: {loaded}")

        # Navigate to Bet365 Favoritos
        await page.goto("https://www.bet365.bet.br/#/IP/FAV/", wait_until="domcontentloaded")
        await asyncio.sleep(3)

        # Accept cookie banner if present
        try:
            cb = await page.query_selector("#onetrust-accept-btn-handler")
            if cb:
                await cb.click()
                await asyncio.sleep(1)
        except Exception:
            pass

        # Dismiss "Continuar" modal if present
        try:
            locs = page.get_by_text("Continuar")
            count = await locs.count()
            for i in range(min(count, 3)):
                box = await locs.nth(i).bounding_box()
                if box and box["width"] > 30 and box["y"] < 1100:
                    await page.mouse.click(box["x"] + box["width"] / 2, box["y"] + box["height"] / 2)
                    print("Dismissed 'Continuar' modal")
                    await asyncio.sleep(1)
                    break
        except Exception:
            pass

        # Screenshot Favoritos
        await page.screenshot(path=str(screenshot_path))
        print(f"Screenshot 1 (Favoritos): {screenshot_path}")

        # Now click on "Basquete" in the nav bar
        print("\nClicking on 'Basquete'...")
        clicked = await page.evaluate("""() => {
            // Try nav bar icons/text
            const items = document.querySelectorAll('[class*="ClassificationBar"] [class*="Item"], [class*="ip-ClassificationBar"] *');
            for (const el of items) {
                if (el.textContent.trim() === 'Basquete') {
                    el.click();
                    return 'clicked: ' + el.className;
                }
            }
            // Fallback: search all elements with "Basquete" text
            const all = document.querySelectorAll('*');
            for (const el of all) {
                if (el.children.length === 0 && el.textContent.trim() === 'Basquete') {
                    el.click();
                    return 'fallback clicked: ' + el.tagName + '.' + el.className;
                }
            }
            return 'not found';
        }""")
        print(f"Basquete click result: {clicked}")
        await asyncio.sleep(4)

        # Screenshot after clicking Basquete
        await page.screenshot(path=str(screenshot_path))
        print(f"Screenshot 2 (Basquete): {screenshot_path}")

        # Check if odds are visible
        odds_count = await page.evaluate("""() => {
            const odds = document.querySelectorAll('[class*="_Odds"], [class*="OddsContainer"]');
            return odds.length;
        }""")
        print(f"Odds elements found: {odds_count}")

        # Try navigating directly to #/IP/B18 
        print("\nNavigating to #/IP/B18 (Basketball direct)...")
        await page.goto("https://www.bet365.bet.br/#/IP/B18/", wait_until="domcontentloaded")
        await asyncio.sleep(4)
        await page.screenshot(path=str(screenshot_path))
        print(f"Screenshot 3 (#/IP/B18): {screenshot_path}")

        odds_count2 = await page.evaluate("""() => {
            const odds = document.querySelectorAll('[class*="_Odds"], [class*="OddsContainer"]');
            return odds.length;
        }""")
        print(f"Odds elements on B18: {odds_count2}")

        await asyncio.sleep(2)
        print("\nDone. Check tmp/spectator_live.png for screenshots.")


if __name__ == "__main__":
    asyncio.run(main())
