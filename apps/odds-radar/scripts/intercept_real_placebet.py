"""
intercept_real_placebet.py — Intercepta PlaceBet real (via UI) para capturar bg, cc, pc e resposta.
Também busca tratamento de challengeRequired (sr=86) no JS.
"""
from __future__ import annotations
import asyncio, json, os, random, re, sys, time
from urllib.parse import urlparse, parse_qs, unquote
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8", errors="replace")
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
os.chdir(Path(__file__).resolve().parent.parent)

from dotenv import load_dotenv
load_dotenv()

from camoufox.async_api import AsyncCamoufox

BASE = Path(__file__).resolve().parent.parent
TMP  = BASE / "tmp"
TMP.mkdir(exist_ok=True)

HOOK_JS = """
(function() {
    // --- Hook window.fetch to intercept PlaceBet requests/responses ---
    const _origFetch = window.fetch;
    window.__shevaPlaceBetCaptures = [];

    window.fetch = async function(...args) {
        const url = typeof args[0] === 'string' ? args[0] : (args[0]?.url || '');
        const isPlaceBet = url.toLowerCase().includes('betswebapi');

        if (isPlaceBet) {
            const capture = {
                type: 'fetch',
                url: url,
                method: args[1]?.method || 'GET',
                body: args[1]?.body || null,
                timestamp: Date.now(),
                stack: new Error().stack
            };

            try {
                const resp = await _origFetch.apply(this, args);
                const clone = resp.clone();
                try {
                    const text = await clone.text();
                    capture.status = resp.status;
                    capture.responseText = text.substring(0, 5000);
                } catch(e) {
                    capture.responseError = e.message;
                }
                window.__shevaPlaceBetCaptures.push(capture);
                return resp;
            } catch(e) {
                capture.fetchError = e.message;
                window.__shevaPlaceBetCaptures.push(capture);
                throw e;
            }
        }
        return _origFetch.apply(this, args);
    };

    // --- Hook XMLHttpRequest ---
    const _origOpen = XMLHttpRequest.prototype.open;
    const _origSend = XMLHttpRequest.prototype.send;

    XMLHttpRequest.prototype.open = function(method, url, ...rest) {
        this.__shevaUrl = url;
        this.__shevaMethod = method;
        return _origOpen.apply(this, [method, url, ...rest]);
    };

    XMLHttpRequest.prototype.send = function(body) {
        const url = this.__shevaUrl || '';
        if (url.toLowerCase().includes('betswebapi')) {
            const capture = {
                type: 'xhr',
                url: url,
                method: this.__shevaMethod,
                body: typeof body === 'string' ? body.substring(0, 3000) : null,
                timestamp: Date.now(),
                stack: new Error().stack
            };

            this.addEventListener('load', function() {
                capture.status = this.status;
                capture.responseText = (this.responseText || '').substring(0, 5000);
                window.__shevaPlaceBetCaptures.push(capture);
            });
            this.addEventListener('error', function() {
                capture.xhrError = 'Network error';
                window.__shevaPlaceBetCaptures.push(capture);
            });
        }
        return _origSend.apply(this, [body]);
    };

    console.log('[SHEVA] BetsWebAPI hooks installed');
})();
"""

async def auto_login(page, context) -> bool:
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
        print("  Ja logado")
        return True
    login_bbox = await page.evaluate("""() => {
        const btns = [...document.querySelectorAll('button')];
        const btn = btns.find(b => b.textContent.trim() === 'Login');
        if (btn) { const r = btn.getBoundingClientRect(); return {x:r.x,y:r.y,w:r.width,h:r.height}; }
        return null;
    }""")
    if not login_bbox:
        return False
    lx = login_bbox["x"] + random.uniform(5, max(6, login_bbox["w"] - 5))
    ly = login_bbox["y"] + random.uniform(3, max(4, login_bbox["h"] - 3))
    await page.mouse.click(lx, ly)
    await asyncio.sleep(2)
    try:
        await page.wait_for_selector('input[type="text"]', timeout=15000, state="visible")
    except Exception:
        pass
    await page.evaluate("""() => {
        const s = document.querySelector('input[type="text"]') || document.querySelector('input:not([type="password"]):not([type="hidden"])');
        if (s) s.focus();
    }""")
    await asyncio.sleep(0.3)
    await page.keyboard.press("Control+a")
    await page.keyboard.press("Backspace")
    await page.keyboard.type(bet_user, delay=55)
    await asyncio.sleep(0.5)
    await page.evaluate('() => { const p = document.querySelector(\'input[type="password"]\'); if (p) p.focus(); }')
    await asyncio.sleep(0.3)
    await page.keyboard.press("Control+a")
    await page.keyboard.press("Backspace")
    await page.keyboard.type(bet_pass, delay=65)
    await asyncio.sleep(0.5)
    await page.keyboard.press("Enter")
    print("  Credenciais enviadas...")
    await asyncio.sleep(8)
    for _ in range(3):
        ck = await context.cookies("https://www.bet365.bet.br")
        if any(c["name"] == "pstk" for c in ck):
            print("  LOGIN OK!")
            return True
        await asyncio.sleep(3)
    return True


async def main():
    dump = {
        "challengeRequired_handling": [],
        "sr_checks": [],
        "placebet_captures": [],
        "document_state": {},
    }

    _geo = '{"location":{"lat":-23.4210,"lng":-51.9331},"accuracy":30}'
    kw = {
        "headless": False,
        "humanize": True,
        "os": "windows",
        "firefox_user_prefs": {
            "geo.enabled": True,
            "geo.prompt.testing": True,
            "geo.prompt.testing.allow": True,
            "permissions.default.geo": 1,
            "geo.provider.network.url": f"data:application/json,{_geo}",
            "geo.provider.ms-windows-location": False,
            "geo.provider.use_corelocation": False,
            "geo.provider.use_gpsd": False,
            "geo.provider.use_mls": False,
        },
    }

    async with AsyncCamoufox(**kw) as browser:
            ctx = browser.contexts[0] if browser.contexts else await browser.new_context()
            page = ctx.pages[0] if ctx.pages else await ctx.new_page()

            # Inject hooks BEFORE page load
            await page.add_init_script(HOOK_JS)

            # Intercept responses via Playwright too
            placebet_responses = []
            async def on_resp(resp):
                if "betswebapi" in resp.url.lower():
                    try:
                        body = await resp.text()
                    except:
                        body = "(unreadable)"
                    placebet_responses.append({
                        "url": resp.url,
                        "status": resp.status,
                        "body": body[:5000],
                    })
            page.on("response", on_resp)

            print("[1] Navegando para bet365...")
            await page.goto("https://www.bet365.bet.br", timeout=60000)
            await asyncio.sleep(3)
            await auto_login(page, ctx)

            print("[2] Navegando para In-Play eSports...")
            await page.evaluate("window.location.hash = '#/IP/B18'")
            await asyncio.sleep(5)

            # Wait for gwt via cookies
            print("[3] Aguardando gwt...")
            gwt_ok = False
            for i in range(30):
                ck = await ctx.cookies("https://www.bet365.bet.br")
                if any(c["name"] == "gwt" for c in ck):
                    gwt_ok = True
                    print(f"  gwt OK ({i+1}s)")
                    break
                await asyncio.sleep(2)
            if not gwt_ok:
                print("  gwt NÃO apareceu — abortando.")
                return

            print("  gwt: OK")
            await asyncio.sleep(3)

            # ---- Search for challengeRequired handling in scripts ----
            print("[3] Buscando tratamento de challengeRequired/sr=86 nos scripts...")
            scripts = await page.evaluate("""() => {
                const scripts = document.querySelectorAll('script');
                const results = [];
                const patterns = [
                    /challengeRequired/gi,
                    /sr\s*[=!]==?\s*86/g,
                    /\.sr\s*[=!]==?\s*86/g,
                    /"sr"\s*:\s*86/g,
                    /86\s*===?\s*[a-z]+\.sr/gi,
                ];
                for (let i = 0; i < scripts.length; i++) {
                    const text = scripts[i].textContent || '';
                    if (text.length < 100) continue;
                    for (const pat of patterns) {
                        pat.lastIndex = 0;
                        let m;
                        while ((m = pat.exec(text)) !== null) {
                            const start = Math.max(0, m.index - 200);
                            const end = Math.min(text.length, m.index + m[0].length + 200);
                            results.push({
                                scriptIdx: i,
                                pattern: pat.source,
                                pos: m.index,
                                matchText: m[0],
                                context: text.substring(start, end)
                            });
                        }
                    }
                }
                return results;
            }""")
            print(f"  challengeRequired/sr=86 matches: {len(scripts)}")
            for r in scripts[:20]:
                print(f"  [{r['scriptIdx']}] {r['matchText']}  pos={r['pos']}")
                print(f"    ...{r['context'][:300]}...")
            dump["challengeRequired_handling"] = scripts

            # ---- Search for sr checks (status result) ----
            print("\n[4] Buscando todos os checks de sr no PlaceBet handler...")
            sr_checks = await page.evaluate("""() => {
                const scripts = document.querySelectorAll('script');
                const results = [];
                // Look for sr checks in betslip-related scripts
                for (let i = 0; i < scripts.length; i++) {
                    const text = scripts[i].textContent || '';
                    if (text.length < 50000) continue; // Only large scripts
                    if (!text.includes('placebet') && !text.includes('PlaceBet')) continue;

                    // Find all .sr references
                    const pat = /\\.sr\b[^;]{0,100}/g;
                    let m;
                    while ((m = pat.exec(text)) !== null) {
                        const start = Math.max(0, m.index - 100);
                        const end = Math.min(text.length, m.index + m[0].length + 100);
                        results.push({
                            scriptIdx: i,
                            pos: m.index,
                            matchText: m[0].substring(0, 120),
                            context: text.substring(start, end)
                        });
                    }
                }
                return results;
            }""")
            print(f"  .sr references in PlaceBet scripts: {len(sr_checks)}")
            for r in sr_checks[:30]:
                print(f"  [{r['scriptIdx']}] pos={r['pos']}: {r['matchText'][:100]}")
            dump["sr_checks"] = sr_checks[:50]

            # ---- Search for first-bet cc handling (undefined/null checks) ----
            print("\n[5] Buscando checks de cc undefined/null...")
            cc_checks = await page.evaluate("""() => {
                const scripts = document.querySelectorAll('script');
                const results = [];
                for (let i = 0; i < scripts.length; i++) {
                    const text = scripts[i].textContent || '';
                    if (text.length < 50000) continue;
                    if (!text.includes('betRequestCorrelation') && !text.includes('"cc"')) continue;

                    // Search for undefined/null checks around cc
                    const patterns = [
                        /get\("cc"\)[^;]{0,50}/g,
                        /get\("bg"\)[^;]{0,50}/g,
                        /get\("pc"\)[^;]{0,50}/g,
                        /betGuid[^;]{0,100}/g,
                        /betRequestCorrelation[^;]{0,100}/g,
                        /serialise\([^)]*\)[^;]{0,200}/g,
                        /deserialise\([^)]*\)/g,
                        /restoreFromStorage\([^)]*\)/g,
                        /saveToStorage\([^)]*\)/g,
                    ];
                    for (const pat of patterns) {
                        pat.lastIndex = 0;
                        let m;
                        while ((m = pat.exec(text)) !== null) {
                            const start = Math.max(0, m.index - 150);
                            const end = Math.min(text.length, m.index + m[0].length + 150);
                            results.push({
                                scriptIdx: i,
                                pattern: pat.source,
                                pos: m.index,
                                matchText: m[0].substring(0, 200),
                                context: text.substring(start, end)
                            });
                        }
                    }
                }
                return results;
            }""")
            print(f"  cc/bg/pc/serialise matches: {len(cc_checks)}")
            # Group by pattern
            by_pattern = {}
            for r in cc_checks:
                p = r["pattern"]
                if p not in by_pattern:
                    by_pattern[p] = []
                by_pattern[p].append(r)
            for p, items in by_pattern.items():
                print(f"\n  Pattern: {p} ({len(items)} matches)")
                for r in items[:5]:
                    print(f"    [{r['scriptIdx']}] pos={r['pos']}: {r['matchText'][:150]}")

            dump["cc_checks"] = cc_checks[:100]

            # ---- Now try clicking odds to add selection ----
            print("\n[6] Procurando odds cells para clicar...")

            # Remove overlays first
            await page.evaluate("""() => {
                document.querySelectorAll('.wcl-ModalManager_DarkWash, .wcl-ModalManager_LightWash').forEach(e => e.remove());
            }""")
            await asyncio.sleep(1)

            # Find In-Play odds cells
            odds_info = await page.evaluate("""() => {
                const cells = document.querySelectorAll('.ovm-ParticipantOddsOnly_Odds, .sac-ParticipantOddsOnly_Odds, .gl-ParticipantOddsOnly_Odds, [class*="Participant"][class*="Odds"]');
                const results = [];
                for (const cell of cells) {
                    const text = cell.textContent?.trim();
                    if (!text || text === '-') continue;
                    const rect = cell.getBoundingClientRect();
                    if (rect.width > 0 && rect.height > 0 && rect.top > 100) {
                        results.push({text, x: rect.x + rect.width/2, y: rect.y + rect.height/2});
                    }
                    if (results.length >= 5) break;
                }
                return results;
            }""")
            print(f"  Odds cells: {len(odds_info)}")
            if not odds_info:
                # Try broader search
                odds_info = await page.evaluate("""() => {
                    const cells = document.querySelectorAll('[class*="odds" i], [class*="Odds"]');
                    const results = [];
                    for (const cell of cells) {
                        const text = cell.textContent?.trim();
                        if (!text || text === '-' || text.length > 10) continue;
                        const f = parseFloat(text);
                        if (isNaN(f) || f < 1.01) continue;
                        const rect = cell.getBoundingClientRect();
                        if (rect.width > 0 && rect.height > 0 && rect.top > 100) {
                            results.push({text, x: rect.x + rect.width/2, y: rect.y + rect.height/2});
                        }
                        if (results.length >= 5) break;
                    }
                    return results;
                }""")
                print(f"  Odds cells (broad): {len(odds_info)}")

            if odds_info:
                target = odds_info[0]
                print(f"  Clicando em odds: {target['text']} at ({target['x']}, {target['y']})")
                await page.mouse.click(target["x"], target["y"])
                await asyncio.sleep(3)

                # Check if betslip opened
                betslip_visible = await page.evaluate("""() => {
                    const el = document.querySelector('.bss-StandardBetslip, [class*="Betslip"][class*="Standard"], [class*="betslip"]');
                    return el ? el.getBoundingClientRect() : null;
                }""")
                print(f"  Betslip visible: {betslip_visible is not None}")

                # Check document state (bg, cc, pc) via sessionStorage
                doc_state = await page.evaluate("""() => {
                    const result = {};
                    for (let i = 0; i < sessionStorage.length; i++) {
                        const key = sessionStorage.key(i);
                        const val = sessionStorage.getItem(key);
                        if (key.toLowerCase().includes('bet') || key.toLowerCase().includes('slip') ||
                            val.includes('bg=') || val.includes('cc=') || val.includes('pc=')) {
                            result[key] = val.substring(0, 1000);
                        }
                    }
                    // Also check all sessionStorage
                    result._all_keys = Object.keys(Object.fromEntries(
                        Array.from({length: sessionStorage.length}, (_, i) => [sessionStorage.key(i), ''])
                    ));
                    return result;
                }""")
                print(f"\n  sessionStorage bet-related:")
                for k, v in doc_state.items():
                    if k != '_all_keys':
                        print(f"    {k}: {v[:200]}")
                print(f"  All sessionStorage keys: {doc_state.get('_all_keys', [])}")
                dump["document_state"] = doc_state

                # Try to find the betslip document model directly
                doc_model = await page.evaluate("""() => {
                    try {
                        // BetSlipLocator is a global
                        if (typeof BetSlipLocator !== 'undefined' && BetSlipLocator.betSlipManager) {
                            const mgr = BetSlipLocator.betSlipManager;
                            return {
                                hasBetSlipManager: true,
                                type: typeof mgr,
                                keys: Object.keys(mgr).slice(0, 50),
                            };
                        }
                    } catch(e) {}

                    // Try to find document via global namespaces
                    try {
                        const nsBetslip = window.ns_betslipstandardlib_model_slip;
                        if (nsBetslip) {
                            return {ns_betslipstandardlib: Object.keys(nsBetslip).slice(0, 30)};
                        }
                    } catch(e) {}

                    // Search for common betslip globals
                    const globals = {};
                    for (const key of Object.keys(window)) {
                        if (key.toLowerCase().includes('betslip') || key.toLowerCase().includes('locator')) {
                            try {
                                globals[key] = typeof window[key];
                            } catch(e) {}
                        }
                    }
                    return {globals};
                }""")
                print(f"\n  Betslip model info: {json.dumps(doc_model, indent=2)[:500]}")
                dump["betslip_model"] = doc_model

                # Try to enter stake and place bet
                print("\n[7] Tentando entrar stake...")
                # Find stake input
                stake_input = await page.evaluate("""() => {
                    const inputs = document.querySelectorAll('input[type="text"], input[type="number"], input:not([type])');
                    for (const inp of inputs) {
                        const rect = inp.getBoundingClientRect();
                        // Stake input should be in the betslip area (right side, or bottom)
                        if (rect.width > 30 && rect.height > 20 && rect.right > 800) {
                            return {
                                x: rect.x + rect.width/2,
                                y: rect.y + rect.height/2,
                                placeholder: inp.placeholder || '',
                                className: inp.className || '',
                                value: inp.value || ''
                            };
                        }
                    }
                    return null;
                }""")

                if stake_input:
                    print(f"  Stake input found: {stake_input}")
                    await page.mouse.click(stake_input["x"], stake_input["y"])
                    await asyncio.sleep(0.5)
                    await page.keyboard.type("0.10")
                    await asyncio.sleep(1)

                    # Now find "Place Bet" button
                    place_btn = await page.evaluate("""() => {
                        const buttons = document.querySelectorAll('button, [class*="PlaceBet"], [class*="placeBet"], [class*="Place"][class*="Bet"], div[class*="Accept"]');
                        for (const btn of buttons) {
                            const text = btn.textContent?.trim().toLowerCase();
                            if (text && (text.includes('place bet') || text.includes('apostas') ||
                                text.includes('apostar') || text.includes('bet now'))) {
                                const rect = btn.getBoundingClientRect();
                                if (rect.width > 30 && rect.height > 10) {
                                    return {
                                        text: btn.textContent.trim(),
                                        x: rect.x + rect.width/2,
                                        y: rect.y + rect.height/2,
                                        className: btn.className || ''
                                    };
                                }
                            }
                        }
                        return null;
                    }""")

                    if place_btn:
                        print(f"  Place Bet button: {place_btn['text']} at ({place_btn['x']}, {place_btn['y']})")
                        print(f"  Class: {place_btn['className'][:100]}")

                        # BEFORE clicking Place Bet, check betstring/document state
                        pre_state = await page.evaluate("""() => {
                            const result = {};
                            for (let i = 0; i < sessionStorage.length; i++) {
                                const key = sessionStorage.key(i);
                                result[key] = sessionStorage.getItem(key)?.substring(0, 500);
                            }
                            return result;
                        }""")
                        print(f"\n  Pre-PlaceBet sessionStorage:")
                        for k, v in pre_state.items():
                            print(f"    {k}: {v[:200]}")

                        # Click Place Bet
                        print(f"\n  Clicando Place Bet...")
                        await page.mouse.click(place_btn["x"], place_btn["y"])

                        # Wait for the PlaceBet request to complete
                        await asyncio.sleep(5)

                        # Check captures from our hooks
                        captures = await page.evaluate("() => window.__shevaPlaceBetCaptures || []")
                        print(f"\n  BetsWebAPI captures (hook): {len(captures)}")
                        for c in captures:
                            print(f"\n    Type: {c.get('type')}")
                            print(f"    URL: {c.get('url', '')[:300]}")
                            print(f"    Method: {c.get('method')}")
                            print(f"    Status: {c.get('status')}")
                            if c.get('body'):
                                print(f"    Body: {c['body'][:300]}")
                            if c.get('responseText'):
                                print(f"    Response: {c['responseText'][:500]}")
                            # Parse URL params
                            url = c.get('url', '')
                            if '?' in url:
                                qs = url.split('?', 1)[1]
                                params = parse_qs(qs)
                                print(f"    URL Params: {json.dumps({k: v[0] if len(v)==1 else v for k, v in params.items()})}")

                        # Also check Playwright captured responses
                        print(f"\n  BetsWebAPI responses (Playwright): {len(placebet_responses)}")
                        for r in placebet_responses:
                            print(f"    URL: {r['url'][:300]}")
                            print(f"    Status: {r['status']}")
                            print(f"    Body: {r['body'][:500]}")

                        dump["placebet_captures"] = captures
                        dump["playwright_responses"] = placebet_responses

                        # Post-PlaceBet sessionStorage
                        post_state = await page.evaluate("""() => {
                            const result = {};
                            for (let i = 0; i < sessionStorage.length; i++) {
                                const key = sessionStorage.key(i);
                                result[key] = sessionStorage.getItem(key)?.substring(0, 500);
                            }
                            return result;
                        }""")
                        print(f"\n  Post-PlaceBet sessionStorage:")
                        for k, v in post_state.items():
                            print(f"    {k}: {v[:200]}")
                        dump["post_placebet_state"] = post_state

                    else:
                        print("  Place Bet button não encontrado")
                else:
                    print("  Stake input não encontrado")
                    # Still try to access document model
            else:
                print("  Nenhum odds cell encontrado")

            # Save dump
            with open(TMP / "real_placebet_intercept.json", "w", encoding="utf-8") as f:
                json.dump(dump, f, indent=2, default=str)
            print(f"\nDump salvo: tmp/real_placebet_intercept.json")

if __name__ == "__main__":
    asyncio.run(main())
