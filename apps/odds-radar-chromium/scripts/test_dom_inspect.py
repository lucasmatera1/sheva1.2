"""Inspeciona o DOM real da bet365 no Chromium para entender o que renderiza."""
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
    udd = str(Path(__file__).parent.parent / ".test_dom_inspect")
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
    await page.goto(URL, wait_until="domcontentloaded", timeout=30000)

    # Inspeccionar DOM a cada 2s por 30s
    for i in range(15):
        await asyncio.sleep(2)
        elapsed = (i + 1) * 2
        dom_info = await page.evaluate("""() => {
            const body = document.body;
            const all = document.querySelectorAll('*');
            const divs = document.querySelectorAll('div');
            const btns = [...document.querySelectorAll('button')].map(b => b.textContent.trim().substring(0, 50));
            const iframes = document.querySelectorAll('iframe');
            const scripts = document.querySelectorAll('script[src]');
            
            // Busca qualquer coisa que pareça conteúdo principal
            const mainContent = document.querySelector('.wc-WebConsoleModule, .wn-WebConsole, #webConsole, .ip-InPlayModule, .hm-HeaderModule');
            const spinner = document.querySelector('.wl-Loading, .ip-Loader, [class*="Loading"], [class*="Spinner"]');
            
            // Classes únicas do primeiro nível depois do body
            const topLevel = [...document.body.children].map(c => c.className || c.tagName).filter(Boolean);
            
            // Procura erros no console
            const errors = [];
            
            return {
                totalElements: all.length,
                divCount: divs.length,
                buttons: btns,
                iframeCount: iframes.length,
                scriptCount: scripts.length,
                hasMainContent: !!mainContent,
                mainContentClass: mainContent ? mainContent.className.substring(0, 100) : null,
                hasSpinner: !!spinner,
                spinnerClass: spinner ? spinner.className.substring(0, 100) : null,
                topLevelClasses: topLevel.slice(0, 10),
                bodyInnerHTMLLength: body.innerHTML.length,
                title: document.title,
                url: location.href,
            };
        }""")
        print(f"\n[{elapsed}s] Elements: {dom_info['totalElements']} | Divs: {dom_info['divCount']} | Body HTML: {dom_info['bodyInnerHTMLLength']} bytes")
        print(f"  URL: {dom_info['url']}")
        print(f"  Title: {dom_info['title']}")
        print(f"  Buttons: {dom_info['buttons']}")
        print(f"  Iframes: {dom_info['iframeCount']} | Scripts: {dom_info['scriptCount']}")
        print(f"  Main content: {dom_info['hasMainContent']} ({dom_info['mainContentClass']})")
        print(f"  Spinner: {dom_info['hasSpinner']} ({dom_info['spinnerClass']})")
        print(f"  Top-level: {dom_info['topLevelClasses']}")
        
        # Se já tem muitos elementos, provavelmente carregou
        if dom_info['totalElements'] > 200:
            print(f"\n  >>> SPA parece ter carregado ({dom_info['totalElements']} elements)")

    # Screenshot final
    await page.screenshot(path="tmp/dom_inspect.png")
    print("\nScreenshot salvo em tmp/dom_inspect.png")

    await ctx.close()
    await pw.stop()
    shutil.rmtree(udd, ignore_errors=True)


asyncio.run(main())
