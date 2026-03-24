"""
Diagnóstico gwt Origin — Descobre de onde vem o cookie gwt.

Estratégia:
  1. Intercepta document.cookie setter via JS proxy
  2. Monitora Set-Cookie headers em TODAS as respostas HTTP
  3. Após login + In-Play, clica numa seleção de aposta (betslip trigger)
  4. Monitora 60s adicionais após interação com betslip
  5. Busca "gwt" em TODO o JS source carregado na página
"""

from __future__ import annotations

import asyncio
import json
import os
import random
import sys
from pathlib import Path

if sys.platform == "win32":
    os.environ.setdefault("PYTHONIOENCODING", "utf-8")
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    if hasattr(sys.stderr, "reconfigure"):
        sys.stderr.reconfigure(encoding="utf-8", errors="replace")

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from src.browser.engine import BrowserEngine

BET365_URL = "https://www.bet365.bet.br"

# JS que intercepta document.cookie writes — detecta quando qualquer script
# seta o gwt cookie via JavaScript
COOKIE_INTERCEPT_SCRIPT = """
(() => {
    const _origDescriptor = Object.getOwnPropertyDescriptor(Document.prototype, 'cookie')
        || Object.getOwnPropertyDescriptor(HTMLDocument.prototype, 'cookie');
    if (!_origDescriptor) return;

    const _origSet = _origDescriptor.set;
    Object.defineProperty(document, 'cookie', {
        get: _origDescriptor.get,
        set: function(val) {
            if (val && typeof val === 'string' && val.toLowerCase().includes('gwt')) {
                console.log('[GWT-INTERCEPT] document.cookie SET: ' + val.substring(0, 200));
            }
            return _origSet.call(this, val);
        },
        configurable: true,
    });
    console.log('[GWT-INTERCEPT] Cookie setter interception active');
})();
"""


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


async def main():
    print()
    print("=" * 60)
    print("  DIAGNÓSTICO gwt ORIGIN")
    print("=" * 60)
    print()

    engine = BrowserEngine()

    gwt_events: list[dict] = []
    all_set_cookies: list[dict] = []
    gwt_js_mentions: list[str] = []

    async with engine.launch() as context:
        page = await engine.new_page(context)
        page.set_default_timeout(30_000)

        # === Injetar cookie setter interceptor ===
        await page.add_init_script(COOKIE_INTERCEPT_SCRIPT)

        # Monitor: TODAS as console messages (captura o intercept)
        def _on_console(msg):
            text = msg.text
            if "[GWT-INTERCEPT]" in text:
                gwt_events.append({"source": "js_cookie_set", "text": text[:300]})
                print(f"  *** GWT VIA JS: {text[:200]}")
            elif "gwt" in text.lower():
                gwt_events.append({"source": "console", "text": text[:300]})
                print(f"  CONSOLE gwt: {text[:120]}")

        page.on("console", _on_console)

        # Monitor: TODAS as Set-Cookie headers (não apenas geo keywords)
        async def _on_response(response):
            try:
                headers = response.headers
                for h_name, h_val in headers.items():
                    if h_name.lower() == "set-cookie":
                        cookie_info = {
                            "url": response.url[:150],
                            "cookie": h_val[:300],
                            "status": response.status,
                        }
                        all_set_cookies.append(cookie_info)
                        if "gwt" in h_val.lower():
                            gwt_events.append({"source": "set_cookie_header", "text": h_val[:300], "url": response.url[:150]})
                            print(f"  *** GWT VIA SET-COOKIE: {response.url[:80]}")
                            print(f"      Cookie: {h_val[:150]}")
            except Exception:
                pass

        page.on("response", _on_response)

        # === 1. Abre e loga ===
        print("  [1] Abrindo Bet365...")
        await page.goto(BET365_URL, wait_until="domcontentloaded", timeout=30000)
        await asyncio.sleep(3)

        print("  [*] Login automático...")
        logged = await auto_login(page, context)
        print(f"  {'✅' if logged else '❌'} Login: {'OK' if logged else 'FALHOU'}")

        if not logged:
            print("  Esperando login manual (5 min)...")
            for i in range(300):
                ck = await context.cookies("https://www.bet365.bet.br")
                if any(c["name"] == "pstk" for c in ck):
                    print(f"  pstk após {i}s")
                    break
                await asyncio.sleep(1)

        await asyncio.sleep(2)

        # Check gwt agora (pós-login)
        ck = await context.cookies()
        ck_dict = {c["name"]: c["value"] for c in ck}
        print(f"  gwt pós-login: {'SIM (' + ck_dict['gwt'][:30] + '...)' if ck_dict.get('gwt') else 'NAO'}")
        print(f"  Cookies: {len(ck_dict)} | Set-Cookies capturados: {len(all_set_cookies)}")
        print()

        # === 2. Busca "gwt" no JS source da página ===
        print("  [2] Buscando 'gwt' no JS source da página...")
        gwt_in_js = await page.evaluate("""() => {
            const results = [];
            // Check all inline scripts
            const scripts = document.querySelectorAll('script:not([src])');
            for (const s of scripts) {
                const text = s.textContent || '';
                if (text.toLowerCase().includes('gwt')) {
                    // Find the context around 'gwt'
                    const idx = text.toLowerCase().indexOf('gwt');
                    const start = Math.max(0, idx - 50);
                    const end = Math.min(text.length, idx + 80);
                    results.push('INLINE: ...' + text.substring(start, end) + '...');
                }
            }
            // Check external script URLs
            const extScripts = document.querySelectorAll('script[src]');
            for (const s of extScripts) {
                if (s.src.toLowerCase().includes('gwt')) {
                    results.push('EXTERNAL: ' + s.src);
                }
            }
            // Check document.cookie for gwt
            const cookies = document.cookie;
            if (cookies.toLowerCase().includes('gwt')) {
                results.push('COOKIE: gwt found in document.cookie');
            }
            return results;
        }""")
        for r in gwt_in_js:
            print(f"    {r[:200]}")
            gwt_js_mentions.append(r)
        if not gwt_in_js:
            print("    Nenhuma menção a 'gwt' no HTML/JS inline da página")

        # === 3. Navega para In-Play eSports ===
        print()
        print("  [3] Navegando para In-Play eSports...")
        await page.evaluate("window.location.hash = '#/IP/B18'")
        await asyncio.sleep(8)

        ck = await context.cookies()
        ck_dict = {c["name"]: c["value"] for c in ck}
        print(f"  gwt pós-InPlay: {'SIM' if ck_dict.get('gwt') else 'NAO'}")
        print()

        # === 4. Tenta clicar em uma seleção de aposta ===
        print("  [4] Procurando seleção de aposta para clicar...")
        bet_clicked = await page.evaluate("""() => {
            // Procura por elementos clicáveis de odds (bet365 usa divs com classe específica)
            const selectors = [
                '[class*="gl-Participant_General"]',       // Odds buttons
                '[class*="ovm-ParticipantOddsOnly"]',      // Participant odds
                '[class*="ovm-Participant"]',              // Participant
                '[class*="sl-MarketCouponSelectionPrice"]', // Selection price
                '[class*="sac-ParticipantCen498"]',        // Specific participant
                '[class*="Odds"]',                         // Generic odds
            ];
            for (const sel of selectors) {
                const els = document.querySelectorAll(sel);
                for (const el of els) {
                    const text = el.textContent.trim();
                    // Procura por algo que parece uma odd (ex: "1.85", "2/1")
                    if (text && /^\d+[./]\d+$/.test(text)) {
                        const r = el.getBoundingClientRect();
                        if (r.width > 0 && r.height > 0) {
                            return {
                                x: r.x + r.width / 2,
                                y: r.y + r.height / 2,
                                text: text,
                                selector: sel,
                            };
                        }
                    }
                }
            }
            // Fallback: qualquer elemento com odds-like text
            const allEls = document.querySelectorAll('*');
            for (const el of allEls) {
                if (el.children.length > 0) continue; // leaf nodes only
                const text = el.textContent.trim();
                if (/^\d+\/\d+$/.test(text) || /^[12]\.\d{2}$/.test(text)) {
                    const r = el.getBoundingClientRect();
                    if (r.width > 10 && r.height > 10 && r.y > 100 && r.y < 800) {
                        return {
                            x: r.x + r.width / 2,
                            y: r.y + r.height / 2,
                            text: text,
                            selector: 'leaf',
                        };
                    }
                }
            }
            return null;
        }""")

        if bet_clicked:
            print(f"  Odds encontrada: '{bet_clicked['text']}' via {bet_clicked['selector']}")
            print(f"  Clicando em ({bet_clicked['x']:.0f}, {bet_clicked['y']:.0f})...")
            await page.mouse.click(bet_clicked["x"], bet_clicked["y"])
            await asyncio.sleep(3)
            print("  Click executado!")
        else:
            print("  Nenhuma seleção de odds encontrada para clicar")

        # === 5. Monitora 60s pós-click ===
        print()
        print("  [5] Monitorando 60s pós-click (gwt pode aparecer agora)...")
        for t in range(60):
            await asyncio.sleep(1)
            if (t + 1) % 10 == 0:
                ck = await context.cookies()
                ck_dict = {c["name"]: c["value"] for c in ck}
                has_gwt = "gwt" in ck_dict
                sc_with_gwt = sum(1 for s in all_set_cookies if "gwt" in s["cookie"].lower())
                print(f"  [{t+1}s] gwt={'SIM' if has_gwt else 'NAO'} | gwt_events={len(gwt_events)} | set-cookies={len(all_set_cookies)} (gwt={sc_with_gwt})")
                if has_gwt:
                    print(f"  *** gwt DETECTADO: {ck_dict['gwt'][:50]}...")
                    break

        # === 6. Busca gwt novamente no JS pós-interação ===
        print()
        print("  [6] Busca gwt no JS pós-interação...")
        gwt_post = await page.evaluate("""() => {
            const results = {};
            // Check common global variables that bet365 might use
            const globals = [
                'window.__gwt', 'window._gwt', 'window.gwtToken',
                'window.__bet365?.gwt', 'window.Bet365?.gwt',
                'window.__config?.gwt', 'window.AppState?.gwt',
            ];
            for (const g of globals) {
                try {
                    const val = eval(g);
                    if (val !== undefined) results[g] = String(val).substring(0, 100);
                } catch (e) {}
            }
            // Check document.cookie again
            results['document.cookie_has_gwt'] = document.cookie.includes('gwt');
            // Check localStorage
            for (let i = 0; i < localStorage.length; i++) {
                const key = localStorage.key(i);
                if (key.toLowerCase().includes('gwt')) {
                    results['localStorage.' + key] = localStorage.getItem(key).substring(0, 100);
                }
            }
            // Check sessionStorage
            for (let i = 0; i < sessionStorage.length; i++) {
                const key = sessionStorage.key(i);
                if (key.toLowerCase().includes('gwt')) {
                    results['sessionStorage.' + key] = sessionStorage.getItem(key).substring(0, 100);
                }
            }
            return results;
        }""")
        for k, v in gwt_post.items():
            print(f"    {k}: {v}")
        if not gwt_post or all(v is False or v == '' for v in gwt_post.values()):
            print("    Nenhum gwt encontrado em globals/storage")

        # === 7. Relatório Final ===
        print()
        print("=" * 60)
        print("  RELATÓRIO gwt ORIGIN")
        print("=" * 60)

        all_ck = await context.cookies()
        ck_names = sorted({c["name"] for c in all_ck})
        print(f"\n  Cookies finais ({len(ck_names)}):")
        for n in ck_names:
            val = next((c["value"] for c in all_ck if c["name"] == n), "")
            print(f"    {n}: {val[:60]}{'...' if len(val) > 60 else ''}")

        print(f"\n  gwt presente: {'SIM' if 'gwt' in {c['name'] for c in all_ck} else 'NAO'}")

        print(f"\n  gwt Events ({len(gwt_events)}):")
        for ev in gwt_events:
            print(f"    [{ev['source']}] {ev.get('text', '')[:150]}")
        if not gwt_events:
            print("    ZERO — gwt nunca foi setado via JS ou Set-Cookie")

        print(f"\n  Set-Cookie headers capturados: {len(all_set_cookies)}")
        # Print últimos 10 Set-Cookie headers (resumo)
        for sc in all_set_cookies[-10:]:
            cookie_name = sc["cookie"].split("=")[0] if "=" in sc["cookie"] else "?"
            print(f"    {cookie_name}: {sc['url'][:80]}")

        print(f"\n  gwt em JS source: {len(gwt_js_mentions)}")
        for m in gwt_js_mentions:
            print(f"    {m[:200]}")

        print()
        print("=" * 60)
        print("  FIM")
        print("=" * 60)


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        print("\n  Ctrl+C")
