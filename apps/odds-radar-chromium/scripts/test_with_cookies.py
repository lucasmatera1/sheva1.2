"""Teste: copia cookies do Camoufox para o Chromium e verifica se a SPA carrega."""
import asyncio
import json
import shutil
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from playwright.async_api import async_playwright

URL = "https://www.bet365.bet.br/#/IP/"
CAMOUFOX_COOKIES = Path("d:/Sheva/apps/odds-radar/.browser_data/cookies.json")


async def main():
    if not CAMOUFOX_COOKIES.exists():
        print("Camoufox cookies not found!")
        return

    cookies = json.loads(CAMOUFOX_COOKIES.read_text(encoding="utf-8"))
    print(f"Loaded {len(cookies)} cookies from Camoufox")

    pw = await async_playwright().start()
    udd = str(Path(__file__).parent.parent / ".test_with_cookies")
    shutil.rmtree(udd, ignore_errors=True)

    ctx = await pw.chromium.launch_persistent_context(
        user_data_dir=udd,
        headless=False,
        args=[
            "--disable-blink-features=AutomationControlled",
            "--disable-features=IsolateOrigins,site-per-process,CalculateNativeWinOcclusion",
            "--window-size=1366,1080",
        ],
        locale="pt-BR",
        timezone_id="America/Sao_Paulo",
        viewport={"width": 1366, "height": 1080},
    )

    # Injeta cookies do Camoufox
    valid_cookies = []
    for c in cookies:
        # Playwright exige domain com ponto no início ou sem
        cookie = {
            "name": c["name"],
            "value": c["value"],
            "domain": c.get("domain", ".bet365.bet.br"),
            "path": c.get("path", "/"),
        }
        # Se tem expires válido, coloca
        if c.get("expires") and c["expires"] > 0:
            cookie["expires"] = c["expires"]
        # Sem sameSite inválido
        ss = c.get("sameSite", "Lax")
        if ss in ("Strict", "Lax", "None"):
            cookie["sameSite"] = ss
        else:
            cookie["sameSite"] = "Lax"
        if c.get("secure"):
            cookie["secure"] = True
        if c.get("httpOnly"):
            cookie["httpOnly"] = True
        valid_cookies.append(cookie)

    try:
        await ctx.add_cookies(valid_cookies)
        print(f"Injected {len(valid_cookies)} cookies")
    except Exception as e:
        print(f"Cookie injection error: {e}")
        # Tenta um por um
        ok = 0
        for vc in valid_cookies:
            try:
                await ctx.add_cookies([vc])
                ok += 1
            except Exception:
                print(f"  Failed: {vc['name']} ({vc['domain']})")
        print(f"Injected {ok}/{len(valid_cookies)} cookies individually")

    page = ctx.pages[0] if ctx.pages else await ctx.new_page()

    t0 = time.time()
    await page.goto(URL, wait_until="domcontentloaded", timeout=30000)
    print(f"domcontentloaded in {time.time()-t0:.1f}s")

    # Monitor
    for i in range(15):
        await asyncio.sleep(2)
        elapsed = time.time() - t0
        dom = await page.evaluate("""() => {
            const spinner = document.querySelector('.bl-Preloader_SpinnerContainer');
            const spinnerVisible = spinner && spinner.offsetParent !== null;
            const fixtures = document.querySelectorAll('.ovm-FixtureDetailsTwoWay, .gl-MarketGroup, .sph-EventWrapper, .ovm-Fixture, .ovm-ClassificationHeader');
            const btns = [...document.querySelectorAll('button')].map(b => b.textContent.trim()).filter(Boolean);
            const hasMyBets = btns.some(b => b.includes('Minhas Apostas') || b.includes('My Bets'));
            const hasBal = !!document.querySelector('.hm-Balance, [class*="Balance"]');
            return {
                spinnerVisible,
                fixtures: fixtures.length,
                totalElements: document.querySelectorAll('*').length,
                hasMyBets,
                hasBal,
                btns: btns.slice(0, 15),
            };
        }""")
        status = "SPINNER" if dom['spinnerVisible'] else "NO SPINNER"
        logged = "LOGGED IN" if dom['hasMyBets'] or dom['hasBal'] else "NOT LOGGED"
        print(f"[{elapsed:.0f}s] {status} | {logged} | Fixtures: {dom['fixtures']} | Elements: {dom['totalElements']}")

        if dom['fixtures'] > 0:
            print(f"\n✅ SPA CARREGOU! Fixtures: {dom['fixtures']}")
            break
        if not dom['spinnerVisible'] and dom['totalElements'] > 600:
            print(f"\n✅ Spinner sumiu!")
            break

    await page.screenshot(path="tmp/with_cookies.png")
    print("Screenshot: tmp/with_cookies.png")

    await ctx.close()
    await pw.stop()
    shutil.rmtree(udd, ignore_errors=True)


asyncio.run(main())
