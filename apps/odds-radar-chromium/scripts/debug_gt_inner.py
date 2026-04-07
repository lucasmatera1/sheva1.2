"""Debug: inspect inner structure of the GT Leagues sm-SplashMarketGroup element."""

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

        # Scroll down to load all content
        for _ in range(6):
            await page.evaluate("window.scrollBy(0, 600)")
            await asyncio.sleep(1)

        # Get detailed structure of the GT Leagues block
        info = await page.evaluate("""() => {
            const groups = document.querySelectorAll('.sm-SplashMarketGroup');
            for (const el of groups) {
                const text = (el.textContent || '').trim().toLowerCase();
                if (text.includes('gt leagues')) {
                    // Capture full tree structure
                    function describeNode(node, depth) {
                        if (depth > 5) return [];
                        const results = [];
                        const tag = node.tagName ? node.tagName.toLowerCase() : '#text';
                        const cls = (typeof node.className === 'string') ? node.className : '';
                        const ownText = Array.from(node.childNodes)
                            .filter(n => n.nodeType === 3)
                            .map(n => n.textContent.trim())
                            .filter(t => t)
                            .join(' ');
                        const rect = node.getBoundingClientRect ? node.getBoundingClientRect() : {};
                        results.push({
                            depth,
                            tag,
                            cls: cls.slice(0, 120),
                            ownText: ownText.slice(0, 60),
                            w: Math.round(rect.width || 0),
                            h: Math.round(rect.height || 0),
                            clickable: ['a', 'button'].includes(tag) || node.onclick !== null || cls.includes('Button'),
                        });
                        if (node.children) {
                            for (const child of node.children) {
                                results.push(...describeNode(child, depth + 1));
                            }
                        }
                        return results;
                    }
                    return {
                        outerHTML: el.outerHTML.slice(0, 1000),
                        tree: describeNode(el, 0),
                    };
                }
            }
            return null;
        }""")

        if info:
            print(f"\nGT Leagues element outerHTML:\n{info['outerHTML']}\n")
            print("Tree structure:")
            for node in info['tree']:
                indent = "  " * node['depth']
                click = " [CLICKABLE]" if node['clickable'] else ""
                print(f"{indent}{node['tag']} cls='{node['cls'][:50]}' text='{node['ownText']}' ({node['w']}x{node['h']}){click}")
        else:
            print("GT Leagues block NOT FOUND")

        await save_cookies(context)
        await page.close()


if __name__ == "__main__":
    asyncio.run(main())
