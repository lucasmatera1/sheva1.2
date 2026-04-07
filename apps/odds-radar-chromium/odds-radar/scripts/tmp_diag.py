"""Diagnóstico rápido — vê o que tem na página após navegar para GT Leagues."""
import asyncio, sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from config.settings import get_settings
from src.browser.engine import BrowserEngine
from src.browser.session import load_cookies


async def diag():
    settings = get_settings()
    engine = BrowserEngine(settings.browser)
    async with engine.launch() as ctx:
        await load_cookies(ctx)
        page = await engine.new_page(ctx)
        url = "https://www.bet365.bet.br/#/AC/B1/C1/D1002/E71755867/G40/"
        print(f"Navigating to {url[:60]}...")
        await page.goto(url, wait_until="domcontentloaded")

        for i in range(6):
            await asyncio.sleep(3)
            fixtures = await page.query_selector_all(".rcl-ParticipantFixtureDetails")
            url_now = page.url
            print(f"  [{(i+1)*3}s] fixtures={len(fixtures)} url={url_now[:80]}")

            headers = await page.evaluate("""() => {
                const sels = [
                    '[class*="MarketFixtureDetailsLabel"]',
                    '[class*="CouponDate"]',
                    '[class*="gl-MarketGroupButton"]',
                    '[class*="sph-EventWrapper"]',
                    '.rcl-MarketHeaderLabel',
                ];
                const els = document.querySelectorAll(sels.join(','));
                return Array.from(els).slice(0, 8).map(e => ({
                    cls: e.className.substring(0,80),
                    text: (e.textContent||'').trim().substring(0,60)
                }));
            }""")
            for h in headers[:5]:
                print(f"    {h['text'][:50]} | {h['cls'][:60]}")

            if len(fixtures) > 0:
                break

        # Captura texto visível principal
        body_text = await page.evaluate("""() => {
            const main = document.querySelector('.sph-EventViewContent, .wc-WebConsoleModule, body');
            return main ? main.innerText.substring(0, 1500) : 'EMPTY';
        }""")
        print(f"\n--- Texto visível (primeiros 800 chars) ---")
        print(body_text[:800])

        Path("data/screenshots").mkdir(parents=True, exist_ok=True)
        await page.screenshot(path="data/screenshots/diag_page.png", full_page=True)
        print("\nScreenshot: data/screenshots/diag_page.png")
        await page.close()


asyncio.run(diag())
