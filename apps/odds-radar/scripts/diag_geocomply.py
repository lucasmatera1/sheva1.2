"""
Diagnóstico GeoComply — captura TODAS as requests de rede para entender
por que o gwt não está sendo setado.

Monitora:
1. Requests para domínios GeoComply (geocomply.com, geoguard, etc.)
2. Requests com 'geo' na URL
3. Responses Set-Cookie que setam gwt
4. Console errors/warnings do browser
5. Iframes carregados (GeoComply pode usar iframe)
"""

from __future__ import annotations

import asyncio
import os
import random
import sys
from pathlib import Path

if sys.platform == "win32":
    import os
    os.environ.setdefault("PYTHONIOENCODING", "utf-8")
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    if hasattr(sys.stderr, "reconfigure"):
        sys.stderr.reconfigure(encoding="utf-8", errors="replace")

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from src.browser.engine import BrowserEngine
from src.browser.session import save_cookies

BET365_URL = "https://www.bet365.bet.br"


async def auto_login(page, context) -> bool:
    """Login humanizado automático usando credenciais do .env."""
    bet_user = os.environ.get("BET365_USER", "")
    bet_pass = os.environ.get("BET365_PASS", "")
    if not bet_user or not bet_pass:
        return False

    try:
        cookie_btn = await page.query_selector("#onetrust-accept-btn-handler")
        if cookie_btn:
            await cookie_btn.click()
            await asyncio.sleep(1)
    except Exception:
        pass

    login_visible = await page.evaluate("""() => {
        const btns = [...document.querySelectorAll('button')];
        return btns.some(b => b.textContent.trim() === 'Login');
    }""")
    if not login_visible:
        return True

    login_bbox = await page.evaluate("""() => {
        const btns = [...document.querySelectorAll('button')];
        const loginBtn = btns.find(b => b.textContent.trim() === 'Login');
        if (loginBtn) {
            const r = loginBtn.getBoundingClientRect();
            if (r.width > 0) return { x: r.x, y: r.y, w: r.width, h: r.height };
        }
        return null;
    }""")
    if login_bbox:
        lx = login_bbox["x"] + random.uniform(5, max(6, login_bbox["w"] - 5))
        ly = login_bbox["y"] + random.uniform(3, max(4, login_bbox["h"] - 3))
        await page.mouse.click(lx, ly)
    else:
        return False

    try:
        await page.wait_for_load_state("domcontentloaded", timeout=10_000)
    except Exception:
        pass
    await asyncio.sleep(2)

    try:
        await page.wait_for_selector(
            'input[type="text"], input[name="username"], input[autocomplete="username"]',
            timeout=15_000, state="visible",
        )
    except Exception:
        pass

    await page.evaluate("""() => {
        const sel = document.querySelector('input[type="text"]')
            || document.querySelector('input[name="username"]')
            || document.querySelector('input[autocomplete="username"]')
            || document.querySelector('input:not([type="password"]):not([type="hidden"])');
        if (sel) sel.focus();
    }""")
    await asyncio.sleep(0.3)
    await page.keyboard.press("Control+a")
    await page.keyboard.press("Backspace")
    await page.keyboard.type(bet_user, delay=55)
    await asyncio.sleep(0.5)

    await page.evaluate("""() => {
        const pw = document.querySelector('input[type="password"]');
        if (pw) pw.focus();
    }""")
    await asyncio.sleep(0.3)
    await page.keyboard.press("Control+a")
    await page.keyboard.press("Backspace")
    await page.keyboard.type(bet_pass, delay=65)
    await asyncio.sleep(0.5)

    await page.keyboard.press("Enter")
    await asyncio.sleep(8)

    for _ in range(3):
        ck = await context.cookies("https://www.bet365.bet.br")
        if any(c["name"] == "pstk" for c in ck):
            return True
        await asyncio.sleep(3)
    return False

GEO_KEYWORDS = [
    "geocomply", "geoguard", "geolocate", "geolocation", "geo-verify",
    "geo-check", "location-verify", "location-check", "gwt", "glc",
    "geoip", "maxmind",
]


async def main():
    print()
    print("=" * 60)
    print("  DIAGNÓSTICO GEOCOMPLY")
    print("=" * 60)
    print()

    engine = BrowserEngine()
    geo_requests: list[dict] = []
    set_cookie_events: list[dict] = []
    console_msgs: list[str] = []
    all_request_domains: set[str] = set()

    async with engine.launch() as context:
        page = await engine.new_page(context)
        page.set_default_timeout(30_000)

        # Monitor: console messages
        def _on_console(msg):
            text = msg.text
            for kw in GEO_KEYWORDS:
                if kw in text.lower():
                    console_msgs.append(f"[{msg.type}] {text[:200]}")
                    print(f"  CONSOLE geo: {text[:120]}")
                    break

        page.on("console", _on_console)

        # Monitor: ALL requests
        def _on_request(request):
            url = request.url.lower()
            # Track all domains
            try:
                from urllib.parse import urlparse
                domain = urlparse(request.url).netloc
                all_request_domains.add(domain)
            except Exception:
                pass

            # Check for geo-related URLs
            for kw in GEO_KEYWORDS:
                if kw in url:
                    info = {
                        "url": request.url[:200],
                        "method": request.method,
                        "resource": request.resource_type,
                    }
                    geo_requests.append(info)
                    print(f"  REQ geo: {request.method} {request.url[:120]}")
                    break

        page.on("request", _on_request)

        # Monitor: responses with Set-Cookie headers
        async def _on_response(response):
            headers = response.headers
            # Check for gwt in Set-Cookie
            for h_name, h_val in headers.items():
                if h_name.lower() == "set-cookie" and "gwt" in h_val.lower():
                    info = {"url": response.url[:200], "set_cookie": h_val[:300]}
                    set_cookie_events.append(info)
                    print(f"  SET-COOKIE gwt: {response.url[:80]}")

            # Check for geo keywords in response URL
            url = response.url.lower()
            for kw in GEO_KEYWORDS:
                if kw in url:
                    status = response.status
                    print(f"  RESP geo: {status} {response.url[:120]}")
                    break

        page.on("response", _on_response)

        # Monitor: iframes
        def _on_frame(frame):
            url = frame.url
            if url and url != "about:blank":
                print(f"  FRAME: {url[:120]}")
                for kw in GEO_KEYWORDS:
                    if kw in url.lower():
                        print(f"  *** GEOCOMPLY IFRAME DETECTADO: {url[:200]}")

        page.on("frameattached", _on_frame)
        page.on("framenavigated", _on_frame)

        # === 1. Abre Bet365 ===
        print("  [1] Abrindo Bet365...")
        await page.goto(BET365_URL, wait_until="domcontentloaded", timeout=30000)
        await asyncio.sleep(3)

        # Login automático
        print("  [*] Iniciando login automático...")
        logged = await auto_login(page, context)
        if logged:
            print("  ✅ Login automático OK!")
        else:
            print("  ⚠️ Login automático falhou — esperando login manual...")
            print("  [*] Esperando pstk...")
            for i in range(300):
                ck = await context.cookies("https://www.bet365.bet.br")
                ck_dict = {c["name"]: c["value"] for c in ck}
                if ck_dict.get("pstk"):
                    print(f"  pstk detectado após {i}s")
                    break
                await asyncio.sleep(1)

        await asyncio.sleep(3)

        # === 2. Navega para In-Play eSports ===
        print("  [2] Navegando para In-Play eSports...")
        await page.evaluate("window.location.hash = '#/IP/B18'")
        await asyncio.sleep(5)

        # === 3. Monitora por 120s ===
        print(f"  [3] Monitorando rede por 120s...")
        print(f"      Geo requests até agora: {len(geo_requests)}")
        print()

        for t in range(120):
            await asyncio.sleep(1)
            if (t + 1) % 30 == 0:
                # Check gwt
                ck = await context.cookies()
                ck_dict = {c["name"]: c["value"] for c in ck}
                has_gwt = "gwt" in ck_dict
                print(f"  [{t+1}s] gwt={'SIM' if has_gwt else 'NAO'} | geo_reqs={len(geo_requests)} | console_geo={len(console_msgs)} | domains={len(all_request_domains)}")
                if has_gwt:
                    print(f"  *** gwt DETECTADO! ***")
                    break

        # === 4. Relatório ===
        print()
        print("=" * 60)
        print("  RELATÓRIO")
        print("=" * 60)

        # Cookies
        all_ck = await context.cookies()
        ck_names = sorted({c["name"] for c in all_ck})
        print(f"\n  Cookies ({len(ck_names)}):")
        for n in ck_names:
            print(f"    - {n}")

        has_gwt = "gwt" in {c["name"] for c in all_ck}
        print(f"\n  gwt presente: {'SIM' if has_gwt else 'NAO'}")

        # Geo requests
        print(f"\n  Geo-related requests ({len(geo_requests)}):")
        for r in geo_requests:
            print(f"    {r['method']} {r['url'][:120]}")
        if not geo_requests:
            print("    NENHUMA — GeoComply JS pode não estar rodando ou não faz requests de rede")

        # Set-Cookie gwt
        print(f"\n  Set-Cookie com gwt ({len(set_cookie_events)}):")
        for s in set_cookie_events:
            print(f"    URL: {s['url'][:100]}")
            print(f"    Cookie: {s['set_cookie'][:150]}")
        if not set_cookie_events:
            print("    NENHUM — gwt nunca foi setado via HTTP response")

        # Console geo
        print(f"\n  Console geo messages ({len(console_msgs)}):")
        for m in console_msgs[:10]:
            print(f"    {m[:150]}")
        if not console_msgs:
            print("    NENHUMA")

        # Iframes
        frames = [f.url for f in page.frames if f.url and f.url != "about:blank"]
        print(f"\n  Frames ativos ({len(frames)}):")
        for f in frames:
            print(f"    {f[:150]}")

        # Domains contacted
        geo_domains = [d for d in sorted(all_request_domains) if any(kw in d.lower() for kw in GEO_KEYWORDS)]
        print(f"\n  Domínios geo ({len(geo_domains)}/{len(all_request_domains)} total):")
        for d in geo_domains:
            print(f"    {d}")
        if not geo_domains:
            print("    NENHUM domínio geo contactado")

        # ALL domains (for reference)
        print(f"\n  Todos os domínios contactados ({len(all_request_domains)}):")
        for d in sorted(all_request_domains):
            print(f"    {d}")

        # Check if GeoComply script was loaded
        gc_check = await page.evaluate("""() => {
            const checks = {};
            checks.GeoComply = typeof window.GeoComply !== 'undefined';
            checks.geocomply = typeof window.geocomply !== 'undefined';
            checks.GLC = typeof window.GLC !== 'undefined';
            checks.GeoGuard = typeof window.GeoGuard !== 'undefined';
            checks.__geoComplyClient = typeof window.__geoComplyClient !== 'undefined';
            checks._gc = typeof window._gc !== 'undefined';

            // Check for GeoComply-related scripts
            const scripts = [...document.querySelectorAll('script[src]')].map(s => s.src);
            checks.geo_scripts = scripts.filter(s =>
                s.toLowerCase().includes('geocomply') ||
                s.toLowerCase().includes('geoguard') ||
                s.toLowerCase().includes('geolocation') ||
                s.toLowerCase().includes('glc')
            );

            return checks;
        }""")

        print(f"\n  GeoComply JS objects:")
        for k, v in gc_check.items():
            print(f"    {k}: {v}")

        print()
        print("=" * 60)
        print("  FIM DO DIAGNÓSTICO")
        print("=" * 60)


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        print("\n  Ctrl+C")
