"""Teste: patchright (Chromium patched) carrega bet365 SPA?"""
import asyncio
import shutil
import time
from pathlib import Path

from patchright.async_api import async_playwright

URL = "https://www.bet365.bet.br/#/IP/"


async def main():
    pw = await async_playwright().start()
    udd = str(Path(__file__).parent.parent / ".test_patchright")
    shutil.rmtree(udd, ignore_errors=True)

    ctx = await pw.chromium.launch_persistent_context(
        user_data_dir=udd,
        headless=False,
        args=[
            "--disable-blink-features=AutomationControlled",
            "--disable-features=IsolateOrigins,site-per-process",
            "--window-size=1366,1080",
        ],
        locale="pt-BR",
        timezone_id="America/Sao_Paulo",
        viewport={"width": 1366, "height": 1080},
    )

    page = ctx.pages[0] if ctx.pages else await ctx.new_page()
    t0 = time.time()
    await page.goto(URL, wait_until="domcontentloaded", timeout=30000)
    print(f"domcontentloaded em {time.time()-t0:.1f}s")

    for i in range(20):
        await asyncio.sleep(2)
        elapsed = time.time() - t0
        dom = await page.evaluate("""() => {
            const spinner = document.querySelector('.bl-Preloader_SpinnerContainer');
            const spinnerVisible = spinner && spinner.offsetParent !== null;
            const fixtures = document.querySelectorAll('.ovm-FixtureDetailsTwoWay, .gl-MarketGroup, .sph-EventWrapper, .ovm-Fixture, .ovm-ClassificationHeader');
            const btns = [...document.querySelectorAll('button')].map(b => b.textContent.trim()).filter(Boolean);
            return {
                spinnerVisible,
                fixtures: fixtures.length,
                totalElements: document.querySelectorAll('*').length,
                btns: btns.slice(0, 15),
            };
        }""")
        status = "SPINNER" if dom['spinnerVisible'] else "NO SPINNER"
        print(f"[{elapsed:.0f}s] {status} | Fixtures: {dom['fixtures']} | Elements: {dom['totalElements']} | Btns: {dom['btns'][:5]}")

        if dom['fixtures'] > 0:
            print(f"\n✅ SPA CARREGOU! {dom['fixtures']} fixtures em {elapsed:.1f}s")
            break
        if not dom['spinnerVisible'] and dom['totalElements'] > 600:
            print(f"\n✅ Spinner sumiu! {dom['totalElements']} elements em {elapsed:.1f}s")
            break

    await page.screenshot(path="tmp/patchright_test.png")
    print("Screenshot: tmp/patchright_test.png")
    await ctx.close()
    await pw.stop()
    shutil.rmtree(udd, ignore_errors=True)


asyncio.run(main())
