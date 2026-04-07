"""Teste diagnóstico: identifica o que impede bet365 de carregar no Chromium."""
import asyncio
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from playwright.async_api import async_playwright


URL = "https://www.bet365.bet.br"
TIMEOUT = 30_000

# Mesmo stealth args do engine.py
STEALTH_ARGS = [
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

# Lê os stealth scripts do engine
from src.browser.engine import BrowserEngine
GEO_SCRIPT = BrowserEngine.GEO_STEALTH_SCRIPT
WEBGL_SCRIPT = BrowserEngine.WEBGL_FONT_STEALTH_SCRIPT
VISIBILITY_SCRIPT = BrowserEngine.VISIBILITY_STEALTH_SCRIPT


async def test_plain():
    """Teste 1: launch() simples, sem stealth, sem persistent context."""
    print("\n=== TEST 1: launch() simples ===")
    pw = await async_playwright().start()
    browser = await pw.chromium.launch(headless=False, args=STEALTH_ARGS)
    page = await browser.new_page()
    t0 = time.time()
    try:
        await page.goto(URL, wait_until="domcontentloaded", timeout=TIMEOUT)
        await page.wait_for_selector(".hm-MainHeaderRHSLoggedOutWide_LoginContainer, .hm-MainHeaderRHSLoggedOutMed_LoginContainer, .gl-MarketGroup", timeout=15000)
        print(f"  ✅ CARREGOU em {time.time()-t0:.1f}s — title: {await page.title()}")
    except Exception as e:
        print(f"  ❌ FALHOU em {time.time()-t0:.1f}s — {e}")
        await page.screenshot(path="tmp/test1_plain.png")
    await browser.close()
    await pw.stop()


async def test_persistent_no_stealth():
    """Teste 2: launch_persistent_context, sem stealth scripts."""
    print("\n=== TEST 2: persistent context, SEM stealth ===")
    pw = await async_playwright().start()
    udd = str(Path(__file__).parent.parent / ".test_browser_2")
    import shutil
    shutil.rmtree(udd, ignore_errors=True)
    ctx = await pw.chromium.launch_persistent_context(
        user_data_dir=udd,
        headless=False,
        args=STEALTH_ARGS,
        locale="pt-BR",
        timezone_id="America/Sao_Paulo",
        viewport={"width": 1366, "height": 1080},
    )
    page = ctx.pages[0] if ctx.pages else await ctx.new_page()
    t0 = time.time()
    try:
        await page.goto(URL, wait_until="domcontentloaded", timeout=TIMEOUT)
        await page.wait_for_selector(".hm-MainHeaderRHSLoggedOutWide_LoginContainer, .hm-MainHeaderRHSLoggedOutMed_LoginContainer, .gl-MarketGroup", timeout=15000)
        print(f"  ✅ CARREGOU em {time.time()-t0:.1f}s — title: {await page.title()}")
    except Exception as e:
        print(f"  ❌ FALHOU em {time.time()-t0:.1f}s — {e}")
        await page.screenshot(path="tmp/test2_persistent.png")
    await ctx.close()
    await pw.stop()
    shutil.rmtree(udd, ignore_errors=True)


async def test_persistent_with_cdp_stealth():
    """Teste 3: persistent context + CDP stealth completo (como o engine faz)."""
    print("\n=== TEST 3: persistent context + CDP stealth ===")
    pw = await async_playwright().start()
    udd = str(Path(__file__).parent.parent / ".test_browser_3")
    import shutil
    shutil.rmtree(udd, ignore_errors=True)
    ctx = await pw.chromium.launch_persistent_context(
        user_data_dir=udd,
        headless=False,
        args=STEALTH_ARGS,
        locale="pt-BR",
        timezone_id="America/Sao_Paulo",
        viewport={"width": 1366, "height": 1080},
        geolocation={"latitude": -23.4210, "longitude": -51.9331},
        permissions=["geolocation"],
    )
    # Injeta CDP stealth como o engine faz
    cdp_stealth = WEBGL_SCRIPT + "\n" + VISIBILITY_SCRIPT
    for page in ctx.pages:
        try:
            cdp = await ctx.new_cdp_session(page)
            await cdp.send("Page.addScriptToEvaluateOnNewDocument", {"source": cdp_stealth})
            await cdp.detach()
        except Exception as e:
            print(f"  CDP inject falhou: {e}")

    page = ctx.pages[0] if ctx.pages else await ctx.new_page()
    # Injeta geo script via addInitScript
    await page.add_init_script(GEO_SCRIPT)

    t0 = time.time()
    try:
        await page.goto(URL, wait_until="domcontentloaded", timeout=TIMEOUT)
        await page.wait_for_selector(".hm-MainHeaderRHSLoggedOutWide_LoginContainer, .hm-MainHeaderRHSLoggedOutMed_LoginContainer, .gl-MarketGroup", timeout=15000)
        print(f"  ✅ CARREGOU em {time.time()-t0:.1f}s — title: {await page.title()}")
    except Exception as e:
        print(f"  ❌ FALHOU em {time.time()-t0:.1f}s — {e}")
        await page.screenshot(path="tmp/test3_cdp.png")
    await ctx.close()
    await pw.stop()
    shutil.rmtree(udd, ignore_errors=True)


async def test_persistent_geo_only():
    """Teste 4: persistent context + apenas GEO stealth (sem WebGL/Visibility)."""
    print("\n=== TEST 4: persistent context + GEO only ===")
    pw = await async_playwright().start()
    udd = str(Path(__file__).parent.parent / ".test_browser_4")
    import shutil
    shutil.rmtree(udd, ignore_errors=True)
    ctx = await pw.chromium.launch_persistent_context(
        user_data_dir=udd,
        headless=False,
        args=STEALTH_ARGS,
        locale="pt-BR",
        timezone_id="America/Sao_Paulo",
        viewport={"width": 1366, "height": 1080},
        geolocation={"latitude": -23.4210, "longitude": -51.9331},
        permissions=["geolocation"],
    )
    page = ctx.pages[0] if ctx.pages else await ctx.new_page()
    await page.add_init_script(GEO_SCRIPT)

    t0 = time.time()
    try:
        await page.goto(URL, wait_until="domcontentloaded", timeout=TIMEOUT)
        await page.wait_for_selector(".hm-MainHeaderRHSLoggedOutWide_LoginContainer, .hm-MainHeaderRHSLoggedOutMed_LoginContainer, .gl-MarketGroup", timeout=15000)
        print(f"  ✅ CARREGOU em {time.time()-t0:.1f}s — title: {await page.title()}")
    except Exception as e:
        print(f"  ❌ FALHOU em {time.time()-t0:.1f}s — {e}")
        await page.screenshot(path="tmp/test4_geo.png")
    await ctx.close()
    await pw.stop()
    shutil.rmtree(udd, ignore_errors=True)


async def main():
    Path("tmp").mkdir(exist_ok=True)
    await test_plain()
    await test_persistent_no_stealth()
    await test_persistent_geo_only()
    await test_persistent_with_cdp_stealth()
    print("\n=== DIAGNÓSTICO COMPLETO ===")
    print("Se Test 1 passa e Test 3 falha → CDP stealth está quebrando")
    print("Se Test 2 falha → persistent context é o problema")
    print("Se Test 4 falha mas Test 2 passa → GEO script é o problema")

asyncio.run(main())
