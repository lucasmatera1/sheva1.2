"""Debug: examina header do Bet365 para descobrir indicadores de login."""

from __future__ import annotations

import asyncio
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from config.settings import get_settings
from src.browser.engine import BrowserEngine
from src.browser.session import load_cookies

BET365_URL = "https://www.bet365.bet.br/#/AC/B1/C1/D1002/E71755867/G40/"


async def main() -> None:
    settings = get_settings()
    engine = BrowserEngine(settings.browser)

    async with engine.launch() as context:
        await load_cookies(context)
        page = await engine.new_page(context)

        await page.goto(BET365_URL, wait_until="domcontentloaded", timeout=30000)
        await asyncio.sleep(6)

        # Examina header completo
        detail = await page.evaluate("""() => {
            const result = {
                buttons: [],
                headerClasses: [],
                hmElements: [],
                allText: '',
            };

            // Botões do header
            document.querySelectorAll('button').forEach(btn => {
                const text = btn.textContent?.trim() || '';
                if (text && text.length < 30) {
                    result.buttons.push({
                        text,
                        cls: btn.className.substring(0, 100),
                        visible: btn.offsetParent !== null,
                    });
                }
            });

            // Elementos com prefixo hm- (header members)
            document.querySelectorAll('[class*="hm-"]').forEach(el => {
                result.hmElements.push({
                    tag: el.tagName,
                    cls: el.className.substring(0, 200),
                    text: (el.textContent || '').trim().substring(0, 80),
                    visible: el.offsetParent !== null,
                });
            });

            // Elementos com prefixo myb- (my bets)
            document.querySelectorAll('[class*="myb-"]').forEach(el => {
                result.hmElements.push({
                    tag: el.tagName,
                    cls: 'myb: ' + el.className.substring(0, 200),
                    text: (el.textContent || '').trim().substring(0, 80),
                    visible: el.offsetParent !== null,
                });
            });

            return result;
        }""")

        print("=== HEADER BUTTONS ===")
        for btn in detail.get("buttons", []):
            vis = "VIS" if btn["visible"] else "hid"
            print(f"  [{vis}] '{btn['text']}' cls={btn['cls'][:80]}")

        print(f"\n=== HM/MYB ELEMENTS ({len(detail.get('hmElements', []))}) ===")
        for el in detail.get("hmElements", []):
            vis = "VIS" if el["visible"] else "hid"
            text = f" '{el['text']}'" if el.get("text") else ""
            print(f"  [{vis}] <{el['tag']}> cls={el['cls'][:100]}{text}")

        await page.close()


if __name__ == "__main__":
    asyncio.run(main())
