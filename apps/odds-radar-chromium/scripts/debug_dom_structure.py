"""Debug script: carrega o Bet365 e extrai a estrutura do menu lateral."""

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

        print(f"Navigating to {settings.scraper.base_url}...")
        await page.goto(settings.scraper.base_url, wait_until="domcontentloaded")
        await asyncio.sleep(10)

        # Dismiss cookies
        btn = await page.query_selector("#onetrust-accept-btn-handler")
        if btn:
            await btn.click()
            print("Cookie popup dismissed")
            await asyncio.sleep(2)

        # Captura todos os elementos clicáveis do menu lateral
        menu_items = await page.evaluate("""() => {
            const results = [];
            // Busca qualquer elemento que pareça um item de menu
            const allEls = document.querySelectorAll('*');
            for (const el of allEls) {
                const text = (el.textContent || '').trim();
                const tag = el.tagName.toLowerCase();
                const cls = el.className || '';
                
                // Filtra elementos com texto curto (itens de menu)
                if (text.length > 0 && text.length < 60 && !text.includes('\\n')) {
                    // Só pega elementos folha ou com poucas children
                    if (el.children.length <= 3) {
                        const lower = text.toLowerCase();
                        if (lower.includes('soccer') || lower.includes('futebol') || 
                            lower.includes('e-soccer') || lower.includes('esport') || 
                            lower.includes('gt ') || lower.includes('league') ||
                            lower.includes('ao vivo') || lower.includes('sport') ||
                            lower.includes('partidas') || lower.includes('esoccer')) {
                            results.push({
                                text: text.slice(0, 80),
                                tag,
                                cls: typeof cls === 'string' ? cls.slice(0, 120) : '',
                                childCount: el.children.length,
                            });
                        }
                    }
                }
            }
            return results.slice(0, 50);
        }""")

        print(f"\\nFound {len(menu_items)} relevant menu items:")
        for item in menu_items:
            print(f"  [{item['tag']}] cls='{item['cls'][:60]}' text='{item['text']}' children={item['childCount']}")

        # Captura a URL atual (pode ter hash routes)
        current_url = page.url
        print(f"\nCurrent URL: {current_url}")

        # Tira screenshot para referência
        await page.screenshot(path="tmp/debug_homepage.png", full_page=False)
        print("Screenshot saved to tmp/debug_homepage.png")

        await save_cookies(context)
        await page.close()


if __name__ == "__main__":
    asyncio.run(main())
