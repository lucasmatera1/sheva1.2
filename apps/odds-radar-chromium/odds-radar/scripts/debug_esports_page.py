"""Debug: na página E-Sports (#/AS/B151/), captura todos os links/itens visíveis."""

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

        # Vai direto para E-Sports
        url = settings.scraper.base_url + "/#/AS/B151/"
        print(f"Navigating to {url}...")
        await page.goto(url, wait_until="domcontentloaded")
        await asyncio.sleep(10)

        # Dismiss cookies
        btn = await page.query_selector("#onetrust-accept-btn-handler")
        if btn:
            await btn.click()
            await asyncio.sleep(2)

        # Captura TODOS os textos visíveis na área central com seus seletores
        items = await page.evaluate("""() => {
            const results = [];
            const allEls = document.querySelectorAll('*');
            const seen = new Set();
            for (const el of allEls) {
                // Somente nós folha ou com 1-2 filhos
                if (el.children.length > 3) continue;
                const text = (el.textContent || '').trim();
                if (!text || text.length > 120 || seen.has(text)) continue;
                
                // Filtra por posição (só centro e direita, ignorando sidebar esquerda)
                const rect = el.getBoundingClientRect();
                if (rect.width === 0 || rect.height === 0) continue;
                
                seen.add(text);
                results.push({
                    text: text.slice(0, 100),
                    tag: el.tagName.toLowerCase(),
                    cls: (typeof el.className === 'string' ? el.className : '').slice(0, 100),
                    x: Math.round(rect.x),
                    y: Math.round(rect.y),
                    w: Math.round(rect.width),
                    h: Math.round(rect.height),
                });
            }
            return results.slice(0, 100);
        }""")
        
        print(f"\nAll visible items ({len(items)}):")
        for item in items:
            pos = f"({item['x']},{item['y']} {item['w']}x{item['h']})"
            print(f"  {pos} [{item['tag']}] cls='{item['cls'][:40]}' → '{item['text']}'")

        await page.screenshot(path="tmp/debug_esports_page.png", full_page=False)
        print("\nScreenshot saved to tmp/debug_esports_page.png")
        
        await save_cookies(context)
        await page.close()


if __name__ == "__main__":
    asyncio.run(main())
