"""Debug: navega até E-Sports > GT Leagues e captura o DOM para análise."""

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

        print("Navigating to Bet365...")
        await page.goto(settings.scraper.base_url, wait_until="domcontentloaded")
        await asyncio.sleep(8)

        # Dismiss cookies
        btn = await page.query_selector("#onetrust-accept-btn-handler")
        if btn:
            await btn.click()
            await asyncio.sleep(2)

        # 1. Click E-Sports
        await page.evaluate("""() => {
            const items = document.querySelectorAll('.wn-PreMatchItem_Text');
            for (const el of items) {
                if (el.textContent.trim() === 'E-Sports') { el.click(); return; }
            }
        }""")
        print("Clicked E-Sports")
        await asyncio.sleep(5)

        # Captura o DOM após clicar E-Sports (sub-ligas)
        sub_items = await page.evaluate("""() => {
            const results = [];
            const allEls = document.querySelectorAll('div, span, a');
            for (const el of allEls) {
                const text = (el.textContent || '').trim();
                const cls = el.className || '';
                if (text.length > 0 && text.length < 100 && el.children.length <= 2) {
                    const lower = text.toLowerCase();
                    if (lower.includes('gt') || lower.includes('soccer') || lower.includes('league') ||
                        lower.includes('battle') || lower.includes('volta') || lower.includes('e-soccer')) {
                        results.push({
                            text: text.slice(0, 100),
                            tag: el.tagName.toLowerCase(),
                            cls: (typeof cls === 'string' ? cls : '').slice(0, 120),
                            children: el.children.length,
                        });
                    }
                }
            }
            return results.slice(0, 40);
        }""")
        print(f"\nSub-items after E-Sports ({len(sub_items)}):")
        for item in sub_items:
            print(f"  [{item['tag']}] cls='{item['cls'][:50]}' children={item['children']} text='{item['text']}'")

        # 2. Click "GT Leagues" mais específico
        clicked = await page.evaluate("""() => {
            const items = document.querySelectorAll('.sm-CouponLink_Title, .ovm-CompetitionHeader_Title, .sm-Market_HeaderOpen, div, span, a');
            for (const el of items) {
                const text = (el.textContent || '').trim();
                if (text.includes('GT Leagues') && el.children.length === 0) {
                    el.click();
                    return text;
                }
            }
            // Fallback: buscar link mais próximo
            for (const el of items) {
                const text = (el.textContent || '').trim();
                if (text.includes('GT Leagues') && text.length < 60) {
                    el.click();
                    return text;
                }
            }
            return null;
        }""")
        print(f"\nClicked GT: {clicked}")
        await asyncio.sleep(5)

        # 3. URL atual
        print(f"URL: {page.url}")

        # 4. Busca "Partidas" tab
        tabs = await page.evaluate("""() => {
            const results = [];
            const els = document.querySelectorAll('div, span, a, button');
            for (const el of els) {
                const text = (el.textContent || '').trim();
                if (el.children.length === 0 && text.length > 0 && text.length < 40) {
                    const lower = text.toLowerCase();
                    if (lower === 'partidas' || lower === 'mercados da partida' || 
                        lower === 'resultado final' || lower === 'todos' ||
                        lower === 'total de gols' || lower === 'chance dupla') {
                        results.push({
                            text,
                            tag: el.tagName.toLowerCase(),
                            cls: (el.className || '').slice(0, 80),
                        });
                    }
                }
            }
            return results;
        }""")
        print(f"\nTabs found ({len(tabs)}):")
        for t in tabs:
            print(f"  [{t['tag']}] cls='{t['cls'][:50]}' text='{t['text']}'")

        # 5. Click "Partidas" se existir
        clicked_partidas = await page.evaluate("""() => {
            const els = document.querySelectorAll('div, span, a, button');
            for (const el of els) {
                const text = (el.textContent || '').trim();
                if (text === 'Partidas' && el.children.length === 0) {
                    el.click();
                    return true;
                }
            }
            return false;
        }""")
        if clicked_partidas:
            print("Clicked 'Partidas' tab")
            await asyncio.sleep(5)

        # 6. Agora vamos verificar fixtures + odds no DOM
        fixture_check = await page.evaluate("""() => {
            const fixtEls = document.querySelectorAll('.rcl-ParticipantFixtureDetails');
            const oddEls = document.querySelectorAll('.sgl-ParticipantOddsOnly80_Odds');
            const leagueEl = document.querySelector('.sph-EventWrapper_Label');
            return {
                fixtures: fixtEls.length,
                odds: oddEls.length,
                league: leagueEl ? leagueEl.textContent.trim() : null,
            };
        }""")
        print(f"\nDOM check: {fixture_check}")

        # 7. Se ainda sem fixtures, captura os principais seletores presentes
        if fixture_check['fixtures'] == 0:
            classes_found = await page.evaluate("""() => {
                const interesting = [
                    'rcl-ParticipantFixtureDetails', 'sgl-ParticipantOddsOnly80_Odds',
                    'sph-EventWrapper', 'gl-MarketGroup', 'sl-CouponFixtureLinkParticipant',
                    'ovm-FixtureDetailsTwoWay', 'ovm-Fixture', 'src-FixtureSubGroup',
                    'src-ParticipantFixtureDetailsTeam', 'sip-FixtureDetail'
                ];
                const found = {};
                for (const cls of interesting) {
                    found[cls] = document.querySelectorAll('[class*="' + cls + '"]').length;
                }
                return found;
            }""")
            print(f"Class presence: {classes_found}")

            # Tira screenshot
            await page.screenshot(path="tmp/debug_gt_leagues.png", full_page=False)
            print("Screenshot saved to tmp/debug_gt_leagues.png")

        await save_cookies(context)
        await page.close()


if __name__ == "__main__":
    asyncio.run(main())
