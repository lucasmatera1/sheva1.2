"""Teste: identifica qual flag Chrome arg impede a SPA da bet365 de carregar."""
import asyncio
import shutil
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from playwright.async_api import async_playwright
from src.browser.engine import BrowserEngine

URL = "https://www.bet365.bet.br/#/IP/"
SELECTOR = ".hm-MainHeaderRHSLoggedOutWide_LoginContainer, .hm-MainHeaderRHSLoggedOutMed_LoginContainer, .gl-MarketGroup, .ovm-FixtureDetailsTwoWay"

# Stealth scripts do engine
GEO_SCRIPT = BrowserEngine.GEO_STEALTH_SCRIPT
WEBGL_SCRIPT = BrowserEngine.WEBGL_FONT_STEALTH_SCRIPT
VISIBILITY_SCRIPT = BrowserEngine.VISIBILITY_STEALTH_SCRIPT

# Mesmo que o engine — vamos testar removendo flags uma a uma
ALL_ARGS = [
    "--disable-blink-features=AutomationControlled",
    "--disable-features=IsolateOrigins,site-per-process,CalculateNativeWinOcclusion",
    "--disable-infobars",
    "--disable-background-networking",
    "--disable-background-timer-throttling",
    "--disable-backgrounding-occluded-windows",
    "--disable-renderer-backgrounding",
    "--disable-ipc-flooding-protection",
    "--no-first-run",
    "--no-default-browser-check",
    "--password-store=basic",
    "--use-mock-keychain",
    "--mute-audio",
    "--autoplay-policy=no-user-gesture-required",
    "--enable-features=WebRTC",
    "--window-size=1366,1080",
]


async def test_with_args(name: str, args: list, inject_stealth: bool = False, inject_geo: bool = False):
    """Testa com args específicos e mede se a SPA carrega."""
    print(f"\n--- {name} ---")
    pw = await async_playwright().start()
    udd = str(Path(__file__).parent.parent / f".test_flag_{name.replace(' ', '_')}")
    shutil.rmtree(udd, ignore_errors=True)

    ctx = await pw.chromium.launch_persistent_context(
        user_data_dir=udd,
        headless=False,
        args=args,
        locale="pt-BR",
        timezone_id="America/Sao_Paulo",
        viewport={"width": 1366, "height": 1080},
        geolocation={"latitude": -23.4210, "longitude": -51.9331},
        permissions=["geolocation"],
    )

    if inject_stealth:
        cdp_stealth = WEBGL_SCRIPT + "\n" + VISIBILITY_SCRIPT
        for page in ctx.pages:
            try:
                cdp = await ctx.new_cdp_session(page)
                await cdp.send("Page.addScriptToEvaluateOnNewDocument", {"source": cdp_stealth})
                await cdp.detach()
            except Exception:
                pass

    page = ctx.pages[0] if ctx.pages else await ctx.new_page()

    if inject_geo:
        await page.add_init_script(GEO_SCRIPT)

    t0 = time.time()
    try:
        await page.goto(URL, wait_until="domcontentloaded", timeout=15000)
        # Espera a SPA renderizar — verificação como o bot faz
        for i in range(20):
            dom = await page.evaluate("""() => {
                const btns = [...document.querySelectorAll('button')];
                const hasLogin = btns.some(b => b.textContent.trim() === 'Login');
                const fixtures = document.querySelectorAll('.ovm-FixtureDetailsTwoWay, .gl-MarketGroup, .sph-EventWrapper');
                return { hasLogin, fixtures: fixtures.length, btns: btns.length };
            }""")
            if dom["fixtures"] > 0:
                print(f"  ✅ SPA CARREGOU em {time.time()-t0:.1f}s — {dom['fixtures']} fixtures, {dom['btns']} btns")
                break
            if i == 19:
                print(f"  ❌ SPA NAO CARREGOU em {time.time()-t0:.1f}s — last check: {dom}")
            await asyncio.sleep(0.5)
    except Exception as e:
        print(f"  ❌ ERRO: {e}")

    await ctx.close()
    await pw.stop()
    shutil.rmtree(udd, ignore_errors=True)


async def main():
    Path("tmp").mkdir(exist_ok=True)

    # Teste A: SEM nenhum arg (baseline)
    await test_with_args("A_baseline_no_args", ["--window-size=1366,1080"])

    # Teste B: Todos os args SEM --disable-background-networking
    args_no_bg = [a for a in ALL_ARGS if a != "--disable-background-networking"]
    await test_with_args("B_all_except_bg_networking", args_no_bg)

    # Teste C: Todos os args (como o engine)
    await test_with_args("C_all_args", list(ALL_ARGS))

    # Teste D: Todos os args + CDP stealth + geo (como o bot real)
    await test_with_args("D_full_stealth", list(ALL_ARGS), inject_stealth=True, inject_geo=True)

    # Teste E: Sem bg networking + com stealth
    await test_with_args("E_no_bg_net_with_stealth", args_no_bg, inject_stealth=True, inject_geo=True)

    print("\n=== RESUMO ===")
    print("Se A passa e C falha → algum flag é o problema")
    print("Se B passa e C falha → --disable-background-networking é o culpado")
    print("Se C passa e D falha → stealth scripts são o problema")

asyncio.run(main())
