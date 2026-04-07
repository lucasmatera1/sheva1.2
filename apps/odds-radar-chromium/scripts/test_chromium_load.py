"""Teste mínimo: Chromium bundled abre bet365 e tira screenshot."""
import asyncio
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from playwright.async_api import async_playwright


async def main():
    pw = await async_playwright().start()

    # ── Chromium bundled SEM stealth nenhum ──
    print("1) Lançando Chromium bundled (sem stealth)...")
    context = await pw.chromium.launch_persistent_context(
        user_data_dir=str(Path(__file__).resolve().parent.parent / ".browser_test"),
        headless=False,
        args=[
            "--disable-blink-features=AutomationControlled",
            "--window-size=1366,768",
        ],
        locale="pt-BR",
        timezone_id="America/Sao_Paulo",
        viewport={"width": 1366, "height": 768},
    )

    page = context.pages[0] if context.pages else await context.new_page()

    # Remove webdriver
    await page.add_init_script("""
        Object.defineProperty(navigator, 'webdriver', {get: () => undefined});
    """)

    print("2) Navegando para bet365...")
    try:
        await page.goto("https://www.bet365.bet.br", wait_until="domcontentloaded", timeout=30000)
        print("   domcontentloaded OK")
    except Exception as e:
        print(f"   goto falhou: {e}")

    # Espera 10s para ver se carrega
    for i in range(20):
        await asyncio.sleep(1)
        # Checa se tem spinner ou conteúdo real
        check = await page.evaluate("""() => {
            const spinner = document.querySelector('.ip-Loader, .gl-Loader, [class*="Spinner"], [class*="spinner"]');
            const btns = document.querySelectorAll('button');
            const bodyText = document.body?.innerText?.length || 0;
            return {
                hasSpinner: !!spinner,
                btnCount: btns.length,
                bodyTextLen: bodyText,
                title: document.title,
                url: location.href,
            };
        }""")
        print(f"   {i+1}s: spinner={check['hasSpinner']} btns={check['btnCount']} textLen={check['bodyTextLen']} title={check['title']}")

        if check['btnCount'] > 5 and check['bodyTextLen'] > 500:
            print("   ✅ Página carregou!")
            break

    # Screenshot
    ss_path = Path(__file__).resolve().parent.parent / "tmp" / "test_chromium.png"
    ss_path.parent.mkdir(parents=True, exist_ok=True)
    await page.screenshot(path=str(ss_path), full_page=False)
    print(f"3) Screenshot salvo: {ss_path}")

    # Checa user-agent e webdriver
    ua_check = await page.evaluate("""() => ({
        userAgent: navigator.userAgent,
        webdriver: navigator.webdriver,
        chrome: !!window.chrome,
        plugins: navigator.plugins.length,
        languages: navigator.languages,
    })""")
    print(f"4) UA: {ua_check['userAgent'][:80]}...")
    print(f"   webdriver={ua_check['webdriver']} chrome={ua_check['chrome']} plugins={ua_check['plugins']} langs={ua_check['languages']}")

    await context.close()
    await pw.stop()
    print("Done.")


asyncio.run(main())
