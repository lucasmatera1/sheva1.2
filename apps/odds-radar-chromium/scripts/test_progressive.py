"""Teste progressivo: qual arg/script quebra o carregamento da bet365."""
import asyncio
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from playwright.async_api import async_playwright

# Mesmas args do engine.py
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
    "--window-size=1366,768",
    # offscreen
    "--window-position=-32000,-32000",
    "--disable-gpu",
]


async def test_with_args(label: str, args: list[str], inject_stealth: bool = False):
    """Teste com args específicos."""
    print(f"\n{'='*60}")
    print(f"TESTE: {label}")
    print(f"{'='*60}")

    pw = await async_playwright().start()
    ud = str(Path(__file__).resolve().parent.parent / f".browser_test_{label.replace(' ','_')}")

    context = await pw.chromium.launch_persistent_context(
        user_data_dir=ud,
        headless=False,
        args=args,
        locale="pt-BR",
        timezone_id="America/Sao_Paulo",
        viewport={"width": 1366, "height": 768},
    )

    page = context.pages[0] if context.pages else await context.new_page()

    if inject_stealth:
        # Injeta o GEO_STEALTH_SCRIPT via CDP (como engine.py faz)
        from src.browser.engine import BrowserEngine
        eng = BrowserEngine.__new__(BrowserEngine)
        await eng._inject_cdp_stealth(context)
        await eng._inject_geo_override(page)
        print("  [stealth CDP injetado]")

    print(f"  Navegando para bet365...")
    try:
        await page.goto("https://www.bet365.bet.br", wait_until="domcontentloaded", timeout=30000)
        print("  domcontentloaded OK")
    except Exception as e:
        print(f"  goto FALHOU: {e}")

    loaded = False
    for i in range(15):
        await asyncio.sleep(1)
        check = await page.evaluate("""() => {
            const btns = document.querySelectorAll('button');
            const bodyText = document.body?.innerText?.length || 0;
            return { btnCount: btns.length, bodyTextLen: bodyText };
        }""")
        status = f"btns={check['btnCount']} textLen={check['bodyTextLen']}"
        if check['btnCount'] > 5 and check['bodyTextLen'] > 500:
            print(f"  ✅ Carregou em {i+1}s ({status})")
            loaded = True
            break
        if i in [4, 9, 14]:
            print(f"  {i+1}s: {status}")

    if not loaded:
        print(f"  ❌ NÃO CARREGOU após 15s")
        ss_path = Path(__file__).resolve().parent.parent / "tmp" / f"fail_{label.replace(' ','_')}.png"
        ss_path.parent.mkdir(parents=True, exist_ok=True)
        await page.screenshot(path=str(ss_path))
        print(f"  Screenshot: {ss_path}")

    await context.close()
    await pw.stop()
    return loaded


async def main():
    # Teste 1: Mínimo (funciona — já testado)
    r1 = await test_with_args("minimo", [
        "--disable-blink-features=AutomationControlled",
        "--window-size=1366,768",
    ])

    # Teste 2: Todas as args SEM offscreen
    r2 = await test_with_args("all_args_visible", [
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
        "--window-size=1366,768",
    ])

    # Teste 3: Todas as args COM offscreen
    r3 = await test_with_args("all_args_offscreen", STEALTH_ARGS)

    # Teste 4: Todas args offscreen + stealth scripts CDP
    r4 = await test_with_args("full_stealth_offscreen", STEALTH_ARGS, inject_stealth=True)

    print(f"\n{'='*60}")
    print("RESULTADOS:")
    print(f"  Mínimo:               {'✅' if r1 else '❌'}")
    print(f"  All args visível:     {'✅' if r2 else '❌'}")
    print(f"  All args offscreen:   {'✅' if r3 else '❌'}")
    print(f"  Full stealth offscr:  {'✅' if r4 else '❌'}")
    print(f"{'='*60}")


asyncio.run(main())
