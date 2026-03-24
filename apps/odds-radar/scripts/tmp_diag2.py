"""Diagnóstico de extração — vê quais fixtures são extraídos e quais filtrados."""
import asyncio, sys, json
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
        await page.goto(url, wait_until="domcontentloaded")
        await asyncio.sleep(5)

        # Extrai os dados RAW do JS (sem filtro Python)
        data = await page.evaluate("""() => {
            const results = [];
            const fixtureEls = document.querySelectorAll('.rcl-ParticipantFixtureDetails');
            const fixtures = [];
            for (const fix of fixtureEls) {
                const nameEls = fix.querySelectorAll('.rcl-ParticipantFixtureDetailsTeam_TeamName');
                if (nameEls.length < 2) continue;
                const home = nameEls[0].textContent.trim();
                const away = nameEls[1].textContent.trim();
                if (!home || !away) continue;

                const clockEl = fix.querySelector('.rcl-ParticipantFixtureDetails_Clock');
                const clock = clockEl ? clockEl.textContent.trim() : null;

                // Detecta placar
                let scoreHome = null;
                let scoreAway = null;
                const scoreEls = fix.querySelectorAll('[class*="ScoreContainer"] [class*="HistoryTextField"], [class*="Score_"]');
                const digits = [];
                for (const s of scoreEls) {
                    const t = s.textContent.trim();
                    if (/^\\d+$/.test(t)) digits.push(parseInt(t, 10));
                }
                if (digits.length >= 2) {
                    scoreHome = digits[0];
                    scoreAway = digits[1];
                }

                // HTML interno do fixture para debug
                const innerClasses = Array.from(fix.querySelectorAll('*')).slice(0, 30).map(e => e.className).filter(c => c && c.includes('Score'));

                fixtures.push({ home, away, clock, scoreHome, scoreAway, scoreClasses: innerClasses, allDigits: digits });
            }

            // Colunas de odds com status suspended
            const marketCols = document.querySelectorAll('.sgl-MarketOddsExpand');
            const columns = [];
            for (const col of marketCols) {
                const cellEls = col.querySelectorAll('.sgl-ParticipantOddsOnly80');
                const vals = [];
                for (const cell of cellEls) {
                    const isSuspended = cell.className.includes('Suspended');
                    if (isSuspended) {
                        vals.push('SUSPENDED');
                    } else {
                        const oddEl = cell.querySelector('.sgl-ParticipantOddsOnly80_Odds');
                        vals.push(oddEl ? oddEl.textContent.trim() : '');
                    }
                }
                if (vals.length > 0) columns.push(vals);
            }

            return { fixtures, columns, numFixtures: fixtures.length, numCols: columns.length };
        }""")

        print(f"Fixtures: {data['numFixtures']} | Colunas de odds: {data['numCols']}")
        print()
        for i, fix in enumerate(data['fixtures']):
            print(f"  [{i}] {fix['home']} vs {fix['away']}")
            print(f"      clock={fix['clock']} scoreHome={fix['scoreHome']} scoreAway={fix['scoreAway']}")
            print(f"      digits={fix['allDigits']} scoreClasses={fix['scoreClasses'][:3]}")
            # Odds para este fixture
            for c, col in enumerate(data['columns']):
                label = ['1', 'X', '2'][c] if c < 3 else f'C{c}'
                if i < len(col):
                    print(f"      {label}: {col[i]}")
            print()

        await page.close()


asyncio.run(diag())
