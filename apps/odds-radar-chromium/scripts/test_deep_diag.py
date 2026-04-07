"""Diagnóstico final: intercepta requests + remove preloader + verifica conteúdo."""
import asyncio
import json
import shutil
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from playwright.async_api import async_playwright

URL = "https://www.bet365.bet.br/#/IP/"
LOG_DIR = Path(__file__).parent.parent / "tmp"


async def main():
    LOG_DIR.mkdir(exist_ok=True)
    pw = await async_playwright().start()
    udd = str(Path(__file__).parent.parent / ".test_deep_diag")
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

    # Intercepta TODAS as requests/responses
    failed_requests = []
    blocked_requests = []
    all_requests = []

    def on_request(req):
        all_requests.append({"url": req.url[:200], "method": req.method, "type": req.resource_type})

    def on_request_failed(req):
        failed_requests.append({"url": req.url[:200], "failure": req.failure})

    def on_response(resp):
        if resp.status >= 400:
            blocked_requests.append({"url": resp.url[:200], "status": resp.status})

    page.on("request", on_request)
    page.on("requestfailed", on_request_failed)
    page.on("response", on_response)

    # Captura erros de console JS
    js_errors = []
    def on_console(msg):
        if msg.type in ("error", "warning"):
            js_errors.append({"type": msg.type, "text": msg.text[:300]})
    page.on("console", on_console)

    t0 = time.time()
    await page.goto(URL, wait_until="domcontentloaded", timeout=30000)
    print(f"Page loaded in {time.time()-t0:.1f}s")

    # Espera 5s para requests
    await asyncio.sleep(5)

    print(f"\n=== NETWORK SUMMARY ===")
    print(f"Total requests: {len(all_requests)}")
    print(f"Failed requests: {len(failed_requests)}")
    print(f"Blocked (4xx/5xx): {len(blocked_requests)}")

    if failed_requests:
        print("\n--- FAILED REQUESTS ---")
        for r in failed_requests[:10]:
            print(f"  {r['failure']}: {r['url']}")

    if blocked_requests:
        print("\n--- BLOCKED REQUESTS ---")
        for r in blocked_requests[:10]:
            print(f"  {r['status']}: {r['url']}")

    if js_errors:
        print(f"\n--- JS ERRORS ({len(js_errors)}) ---")
        for e in js_errors[:10]:
            print(f"  [{e['type']}] {e['text']}")

    # Request types breakdown
    types = {}
    for r in all_requests:
        types[r['type']] = types.get(r['type'], 0) + 1
    print(f"\nRequest types: {types}")

    # Verifica o que existe ATRÁS do preloader
    print("\n=== DOM BEHIND PRELOADER ===")
    behind = await page.evaluate("""() => {
        // Remove preloader
        const preloader = document.querySelector('#__-plContainer');
        const preloaderHTML = preloader ? preloader.outerHTML.substring(0, 200) : 'none';
        
        // Verifica conteúdo principal
        const mainArea = document.querySelector('.wc-PageView, .wc-WebConsoleContent, .ip-InPlayModule, [class*="InPlay"]');
        const mainHTML = mainArea ? mainArea.innerHTML.substring(0, 500) : 'none';
        
        // Verifica se tem algum iframe GeoComply
        const iframes = [...document.querySelectorAll('iframe')].map(f => ({src: f.src, id: f.id, name: f.name, class: f.className}));
        
        // Verifica scripts bloqueados
        const scripts = [...document.querySelectorAll('script[src]')].map(s => s.src.substring(0, 100));
        
        // O que o WebConsole contém
        const wc = document.querySelector('.wc-WebConsoleModule');
        const wcChildren = wc ? [...wc.children].map(c => c.className.substring(0, 80)) : [];
        
        // Verifica localStorage/sessionStorage para tokens
        let geo = null;
        try { geo = localStorage.getItem('geoComplyData') || localStorage.getItem('gcToken'); } catch(e) {}
        
        return { preloaderHTML, mainHTML, iframes, scripts: scripts.slice(0, 10), wcChildren, geo };
    }""")
    print(f"  Preloader: {behind['preloaderHTML']}")
    print(f"  Main area: {behind['mainHTML'][:200]}")
    print(f"  Iframes: {behind['iframes']}")
    print(f"  Scripts: {behind['scripts']}")
    print(f"  WC children: {behind['wcChildren']}")
    print(f"  GeoComply data: {behind['geo']}")

    # Agora REMOVE o preloader e vê o que aparece
    print("\n=== REMOVING PRELOADER ===")
    await page.evaluate("""() => {
        const el = document.querySelector('#__-plContainer');
        if (el) el.remove();
    }""")
    await asyncio.sleep(1)
    await page.screenshot(path=str(LOG_DIR / "no_preloader.png"))
    print("Screenshot sem preloader: tmp/no_preloader.png")

    # Check after removal
    after = await page.evaluate("""() => {
        const all = document.querySelectorAll('*');
        const visible = [...document.querySelectorAll('div')].filter(d => d.offsetHeight > 0 && d.offsetWidth > 0);
        return { totalElements: all.length, visibleDivs: visible.length };
    }""")
    print(f"  After removal: {after['totalElements']} elements, {after['visibleDivs']} visible divs")

    # Salva log completo
    log_data = {
        "all_requests": all_requests[:50],
        "failed_requests": failed_requests,
        "blocked_requests": blocked_requests,
        "js_errors": js_errors,
        "dom_behind": behind,
    }
    (LOG_DIR / "deep_diag.json").write_text(json.dumps(log_data, indent=2, ensure_ascii=False))
    print("\nLog completo: tmp/deep_diag.json")

    await ctx.close()
    await pw.stop()
    shutil.rmtree(udd, ignore_errors=True)


asyncio.run(main())
