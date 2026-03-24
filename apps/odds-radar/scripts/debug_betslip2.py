"""Debug: examina estado do betslip após clicar numa odd."""

from __future__ import annotations

import asyncio
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from config.settings import get_settings
from src.browser.engine import BrowserEngine
from src.browser.session import load_cookies
from src.scraper.bet365 import Bet365Scraper

URL = "https://www.bet365.bet.br/#/AC/B1/C1/D1002/E71755867/G40/"


async def main() -> None:
    s = get_settings()
    e = BrowserEngine(s.browser)
    sc = Bet365Scraper(e, s.scraper)

    async with e.launch() as ctx:
        await load_cookies(ctx)
        page = await e.new_page(ctx)
        await sc._navigate_to(page, URL)
        await sc._dismiss_popups(page)
        await asyncio.sleep(3)

        # Click first odd (home)
        await page.evaluate("""() => {
            const cols = document.querySelectorAll('.sgl-MarketOddsExpand');
            if (cols[0]) {
                const odds = cols[0].querySelectorAll('.sgl-ParticipantOddsOnly80_Odds');
                if (odds[0]) {
                    const target = odds[0].closest('.sgl-ParticipantOddsOnly80') || odds[0];
                    target.click();
                }
            }
        }""")
        await asyncio.sleep(2)

        # Fill stake R$1
        loc = page.locator('div[contenteditable="true"].bsf-StakeBox_StakeValue-input').first
        try:
            await loc.wait_for(state="attached", timeout=5000)
            await loc.evaluate("el => { el.scrollIntoView({block:'center'}); el.focus(); el.click(); }")
            await asyncio.sleep(0.3)
            await page.keyboard.press("Control+a")
            await page.keyboard.press("Backspace")
            await asyncio.sleep(0.2)
            await page.keyboard.type("1.00", delay=100)
            await asyncio.sleep(0.5)

            # Check if value took
            val = await loc.text_content()
            print(f"Stake after keyboard.type: '{val}'")

            if not val or val.strip() == "":
                print("Fallback: setting via JS events")
                await loc.evaluate("""(el, v) => {
                    el.textContent = v;
                    el.dispatchEvent(new Event('input', {bubbles: true}));
                    el.dispatchEvent(new Event('change', {bubbles: true}));
                }""", "1.00")
                await asyncio.sleep(0.5)
                val2 = await loc.text_content()
                print(f"Stake after JS fallback: '{val2}'")
        except Exception as ex:
            print(f"Stake fill error: {ex}")

        # Debug betslip
        info = await page.evaluate("""() => {
            const r = {};
            const btn = document.querySelector('.bsf-PlaceBetButton');
            r.btnExists = !!btn;
            r.btnClass = btn ? btn.className : '';
            r.btnText = btn ? btn.textContent.trim() : '';
            r.btnVisible = btn ? btn.offsetParent !== null : false;

            const msg = document.querySelector('.bsf-ErrorMessage, .bsf-NormalMessage, .bsf-InfoMessage');
            r.message = msg ? msg.textContent.trim() : '';

            const stake = document.querySelector('.bsf-StakeBox_StakeValue-input');
            r.stakeText = stake ? stake.textContent.trim() : '';

            // Check all visible text in betslip area
            const bs = document.querySelector('.bss-DefaultContent, .bs-Betslip');
            r.betslipText = bs ? bs.textContent.trim().substring(0, 500) : '';

            return r;
        }""")

        print("=== BETSLIP DEBUG ===")
        for k, v in info.items():
            print(f"  {k}: {v}")

        await page.close()


if __name__ == "__main__":
    asyncio.run(main())
