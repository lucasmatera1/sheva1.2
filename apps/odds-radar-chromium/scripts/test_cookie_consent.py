"""Teste: aceita cookie consent e verifica se a SPA carrega."""
import asyncio
import shutil
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from playwright.async_api import async_playwright

URL = "https://www.bet365.bet.br/#/IP/"


async def main():
    pw = await async_playwright().start()
    udd = str(Path(__file__).parent.parent / ".test_cookie_consent")
    shutil.rmtree(udd, ignore_errors=True)

    ctx = await pw.chromium.launch_persistent_context(
        user_data_dir=udd,
        headless=False,
        args=[
            "--disable-blink-features=AutomationControlled",
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

    # Espera o botão de cookie consent aparecer e clica
    await asyncio.sleep(2)
    
    # Tenta clicar "Aceitar todos"
    try:
        accept_btn = page.locator("button", has_text="Aceitar todos")
        if await accept_btn.count() > 0:
            print(f"[{time.time()-t0:.1f}s] Clicando 'Aceitar todos'...")
            await accept_btn.click()
            print(f"[{time.time()-t0:.1f}s] Cookie consent aceito!")
        else:
            print(f"[{time.time()-t0:.1f}s] Botão 'Aceitar todos' não encontrado")
    except Exception as e:
        print(f"[{time.time()-t0:.1f}s] Erro ao clicar: {e}")

    # Agora monitora se a SPA carrega
    for i in range(20):
        await asyncio.sleep(2)
        elapsed = time.time() - t0
        dom = await page.evaluate("""() => {
            const spinner = document.querySelector('.bl-Preloader_SpinnerContainer');
            const spinnerVisible = spinner && spinner.offsetParent !== null;
            const fixtures = document.querySelectorAll('.ovm-FixtureDetailsTwoWay, .gl-MarketGroup, .sph-EventWrapper, .ovm-Fixture');
            const menuItems = document.querySelectorAll('.ovm-ClassificationHeader, .wn-Classification');
            const btns = [...document.querySelectorAll('button')].map(b => b.textContent.trim()).filter(Boolean);
            return {
                spinnerVisible,
                fixtures: fixtures.length,
                menuItems: menuItems.length,
                totalElements: document.querySelectorAll('*').length,
                btns: btns.slice(0, 15),
            };
        }""")
        print(f"[{elapsed:.1f}s] Spinner: {dom['spinnerVisible']} | Fixtures: {dom['fixtures']} | Menu: {dom['menuItems']} | Elements: {dom['totalElements']}")
        print(f"  Btns: {dom['btns']}")

        if dom['fixtures'] > 0:
            print(f"\n✅ SPA CARREGOU DEPOIS DO COOKIE CONSENT! ({elapsed:.1f}s)")
            break
        if not dom['spinnerVisible'] and dom['totalElements'] > 600:
            print(f"\n✅ Spinner sumiu, SPA parece carregada ({elapsed:.1f}s)")
            break

    await page.screenshot(path="tmp/cookie_consent_test.png")
    print("Screenshot: tmp/cookie_consent_test.png")

    await ctx.close()
    await pw.stop()
    shutil.rmtree(udd, ignore_errors=True)


asyncio.run(main())
