"""
Reverse-engineer o c= challenge token do PlaceBet bet365.

Estratégias:
1. Monkey-patch fetch() via addInitScript (captura c= + stack trace)
2. Dump todos os <script> e busca padrões SHA-256/crypto/challenge
3. Tenta triggerar PlaceBet via UI para capturar c= real
"""
from __future__ import annotations
import asyncio
import json
import os
import random
import re
import sys
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8", errors="replace")
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
os.chdir(Path(__file__).resolve().parent.parent)

from dotenv import load_dotenv
load_dotenv()

from playwright.async_api import async_playwright
from config.settings import get_settings

# JS para injetar ANTES de qualquer script bet365
FETCH_HOOK_JS = """
(() => {
    // Salva fetch original
    const _origFetch = window.fetch;
    // Log de PlaceBet intercepts
    window.__placebetCaptures = [];
    window.__challengeStack = [];

    window.fetch = function(...args) {
        const url = typeof args[0] === 'string' ? args[0] : (args[0]?.url || '');
        if (url.includes('placebet') || url.includes('PlaceBet') || url.includes('BetsWebAPI')) {
            const stack = new Error().stack;
            const capture = {
                url: url,
                method: args[1]?.method || 'GET',
                headers: {},
                body: args[1]?.body || null,
                stack: stack,
                timestamp: Date.now()
            };
            // Extrai headers
            const hdrs = args[1]?.headers;
            if (hdrs) {
                if (hdrs instanceof Headers) {
                    hdrs.forEach((v, k) => { capture.headers[k] = v; });
                } else if (typeof hdrs === 'object') {
                    Object.assign(capture.headers, hdrs);
                }
            }
            window.__placebetCaptures.push(capture);
            // Extrai c= do URL
            const cMatch = url.match(/[?&]c=([^&]+)/);
            if (cMatch) {
                window.__challengeStack.push({
                    challenge: decodeURIComponent(cMatch[1]),
                    stack: stack,
                    url: url
                });
            }
            console.log('[HOOK] PlaceBet interceptado:', url.substring(0, 120));
            console.log('[HOOK] c= value:', cMatch ? decodeURIComponent(cMatch[1]) : 'AUSENTE');
            console.log('[HOOK] Stack:', stack?.substring(0, 500));
        }
        return _origFetch.apply(this, args);
    };

    // Também hook XMLHttpRequest
    const _origXHROpen = XMLHttpRequest.prototype.open;
    const _origXHRSend = XMLHttpRequest.prototype.send;
    window.__xhrCaptures = [];

    XMLHttpRequest.prototype.open = function(method, url, ...rest) {
        this.__hookUrl = url;
        this.__hookMethod = method;
        if (url && (url.includes('placebet') || url.includes('PlaceBet') || url.includes('BetsWebAPI'))) {
            const stack = new Error().stack;
            console.log('[HOOK-XHR] PlaceBet open:', url.substring(0, 120));
            this.__hookStack = stack;
        }
        return _origXHROpen.call(this, method, url, ...rest);
    };

    XMLHttpRequest.prototype.send = function(body) {
        if (this.__hookUrl && (this.__hookUrl.includes('placebet') || this.__hookUrl.includes('PlaceBet') || this.__hookUrl.includes('BetsWebAPI'))) {
            const capture = {
                url: this.__hookUrl,
                method: this.__hookMethod,
                body: body,
                stack: this.__hookStack || new Error().stack,
                timestamp: Date.now()
            };
            window.__xhrCaptures.push(capture);
            const cMatch = this.__hookUrl.match(/[?&]c=([^&]+)/);
            if (cMatch) {
                window.__challengeStack.push({
                    challenge: decodeURIComponent(cMatch[1]),
                    stack: this.__hookStack || new Error().stack,
                    url: this.__hookUrl
                });
            }
            console.log('[HOOK-XHR] PlaceBet send, body len:', body?.length);
        }
        return _origXHRSend.call(this, body);
    };

    // Hook crypto.subtle.digest para capturar TODAS as chamadas SHA-256
    if (window.crypto?.subtle?.digest) {
        const _origDigest = window.crypto.subtle.digest.bind(window.crypto.subtle);
        window.__digestCalls = [];

        window.crypto.subtle.digest = async function(algo, data) {
            const result = await _origDigest(algo, data);
            const algoName = typeof algo === 'string' ? algo : algo?.name || '?';
            const inputArr = new Uint8Array(data);
            const resultArr = new Uint8Array(result);
            // Base64 encode do resultado
            const b64 = btoa(String.fromCharCode(...resultArr));
            const capture = {
                algo: algoName,
                inputLen: inputArr.length,
                inputPreview: Array.from(inputArr.slice(0, 32)).map(b => b.toString(16).padStart(2,'0')).join(''),
                resultB64: b64,
                stack: new Error().stack,
                timestamp: Date.now()
            };
            window.__digestCalls.push(capture);
            // Se input for texto, decodifica
            try {
                const inputText = new TextDecoder().decode(inputArr);
                if (inputText.length < 500 && /^[\x20-\x7e]+$/.test(inputText)) {
                    capture.inputText = inputText;
                }
            } catch(e) {}
            console.log('[HOOK-DIGEST]', algoName, 'input=' + inputArr.length + 'B', 'result=' + b64.substring(0,20) + '...');
            return result;
        };
    }

    console.log('[HOOK] fetch + XHR + crypto.subtle.digest hooks instalados');
})();
"""


async def auto_login(page, context) -> bool:
    bet_user = os.environ.get("BET365_USER", "")
    bet_pass = os.environ.get("BET365_PASS", "")
    if not bet_user or not bet_pass:
        print("  ERRO: BET365_USER/BET365_PASS nao definidos")
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
    await page.evaluate("() => { const p = document.querySelector('input[type=\"password\"]'); if (p) p.focus(); }")
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
    print("  AVISO: pstk nao apareceu")
    return True


async def wait_for_gwt(context, timeout=60) -> str | None:
    for i in range(timeout):
        ck = await context.cookies("https://www.bet365.bet.br")
        for c in ck:
            if c["name"] == "gwt":
                return c["value"]
        if i % 10 == 9:
            print(f"  ... {i+1}s — gwt: NAO")
        await asyncio.sleep(1)
    return None


async def dump_js_sources(page) -> list[dict]:
    """Extrai todos os <script> src e inline scripts carregados."""
    scripts_info = await page.evaluate("""() => {
        const result = [];
        // Scripts inline e externos
        document.querySelectorAll('script').forEach((s, i) => {
            result.push({
                index: i,
                src: s.src || '(inline)',
                type: s.type || 'text/javascript',
                textLen: s.textContent?.length || 0,
                preview: s.textContent?.substring(0, 200) || ''
            });
        });
        return result;
    }""")
    return scripts_info


async def search_js_for_challenge(page) -> list[dict]:
    """Busca padrões de geração de challenge no JS carregado."""
    results = await page.evaluate("""() => {
        const findings = [];
        const patterns = [
            // Crypto/hash
            /crypto\\.subtle\\.digest/gi,
            /SHA-256/gi,
            /SHA256/gi,
            // Base64
            /btoa\\s*\\(/gi,
            /atob\\s*\\(/gi,
            /base64/gi,
            // Challenge/token
            /challenge/gi,
            /placebet/gi,
            /BetsWebAPI/gi,
            // URL construction with c=
            /[&?]c=/gi,
            /betGuid/gi,
            // FNV hash (cf4 localStorage key hint)
            /fnv/gi,
            /2166136261/gi,  // FNV offset basis
            /16777619/gi,    // FNV prime
            // crypto key
            /importKey/gi,
            /sign\\s*\\(/gi,
            /hmac/gi
        ];

        document.querySelectorAll('script').forEach((script, idx) => {
            const text = script.textContent || '';
            if (text.length < 10) return;

            patterns.forEach(pat => {
                pat.lastIndex = 0;
                let match;
                let count = 0;
                while ((match = pat.exec(text)) !== null && count < 3) {
                    const start = Math.max(0, match.index - 80);
                    const end = Math.min(text.length, match.index + match[0].length + 80);
                    const context = text.substring(start, end);
                    findings.push({
                        scriptIdx: idx,
                        scriptSrc: script.src || '(inline)',
                        pattern: pat.source,
                        matchPos: match.index,
                        context: context.replace(/\\s+/g, ' ')
                    });
                    count++;
                }
            });
        });
        return findings;
    }""")
    return results


async def try_click_odds(page) -> bool:
    """Tenta clicar em uma odds cell para abrir o betslip."""
    # Vários seletores possíveis para odds cells
    selectors = [
        ".sgl-ParticipantOddsOnly80_Odds",
        ".gl-ParticipantOddsOnly_Odds",
        ".ovm-ParticipantOddsOnly_Odds",
        "[class*='ParticipantOdds']",
        "[class*='Odds_Odds']",
    ]
    for sel in selectors:
        cells = await page.query_selector_all(sel)
        if cells:
            print(f"  Encontradas {len(cells)} odds cells com '{sel}'")
            # Clica na primeira com valor numérico
            for cell in cells[:10]:
                text = await cell.text_content()
                if text and re.match(r"\d", text.strip()):
                    try:
                        await cell.scroll_into_view_if_needed()
                        await asyncio.sleep(0.3)
                        await cell.click()
                        print(f"  Clicou em odds: {text.strip()}")
                        return True
                    except Exception as e:
                        print(f"  Erro ao clicar: {e}")
                        continue
    print("  Nenhuma odds cell encontrada")
    return False


async def try_place_bet_ui(page) -> bool:
    """Tenta preencher stake e clicar Place Bet no betslip."""
    await asyncio.sleep(2)

    # Procura stake input
    stake_filled = await page.evaluate("""() => {
        // Possíveis seletores de stake input
        const selectors = [
            '.bss-StakeBox_StakeInput',
            'input[class*="Stake"]',
            'input[class*="stake"]',
            '.bs-Stake input',
            '.bss-StakeBox input',
            'input[type="text"][inputmode]',
            '.betslip input[type="text"]'
        ];
        for (const sel of selectors) {
            const el = document.querySelector(sel);
            if (el) {
                el.focus();
                el.value = '1';
                el.dispatchEvent(new Event('input', {bubbles: true}));
                el.dispatchEvent(new Event('change', {bubbles: true}));
                return {found: true, selector: sel, value: el.value};
            }
        }
        // Tenta qualquer input no betslip area
        const inputs = document.querySelectorAll('input[type="text"]');
        for (const inp of inputs) {
            const rect = inp.getBoundingClientRect();
            if (rect.width > 30 && rect.height > 15 && rect.right > window.innerWidth * 0.5) {
                inp.focus();
                inp.value = '1';
                inp.dispatchEvent(new Event('input', {bubbles: true}));
                inp.dispatchEvent(new Event('change', {bubbles: true}));
                return {found: true, selector: 'fallback-input', value: inp.value};
            }
        }
        return {found: false};
    }""")

    print(f"  Stake input: {json.dumps(stake_filled)}")
    if not stake_filled.get("found"):
        return False

    await asyncio.sleep(1)

    # Procura botão Place Bet
    bet_btn = await page.evaluate("""() => {
        const btns = document.querySelectorAll('button, div[class*="PlaceBet"], div[class*="placeBet"], [class*="Accept"]');
        for (const b of btns) {
            const text = (b.textContent || '').toLowerCase();
            if (text.includes('apostar') || text.includes('place bet') || text.includes('fazer aposta') || text.includes('colocar aposta')) {
                const rect = b.getBoundingClientRect();
                return {found: true, text: b.textContent.trim(), x: rect.x + rect.width/2, y: rect.y + rect.height/2};
            }
        }
        // Tenta seletores específicos
        const selectors = [
            '.bss-PlaceBetButton',
            '[class*="PlaceBet"]',
            '.bs-PlaceBetButton',
            '.bss-AcceptButton',
        ];
        for (const sel of selectors) {
            const el = document.querySelector(sel);
            if (el) {
                const rect = el.getBoundingClientRect();
                return {found: true, text: el.textContent?.trim(), x: rect.x + rect.width/2, y: rect.y + rect.height/2, selector: sel};
            }
        }
        return {found: false};
    }""")

    print(f"  Place Bet button: {json.dumps(bet_btn)}")
    if not bet_btn.get("found"):
        return False

    # Clica no botão Place Bet
    await page.mouse.click(bet_btn["x"], bet_btn["y"])
    print(f"  Clicou em Place Bet: '{bet_btn.get('text','')}'")
    return True


async def main():
    print()
    print("=" * 70)
    print("  REVERSE ENGINEERING: c= challenge token bet365")
    print("=" * 70)

    settings = get_settings()

    from src.browser.engine import STEALTH_CHROMIUM_ARGS

    console_logs = []

    pw = await async_playwright().start()
    context = await pw.chromium.launch_persistent_context(
        user_data_dir=str(Path("data/chromium-profile")),
        headless=False,
        args=STEALTH_CHROMIUM_ARGS,
        locale="pt-BR",
        timezone_id="America/Sao_Paulo",
        geolocation={"latitude": -23.4210, "longitude": -51.9331},
        permissions=["geolocation"],
        viewport={"width": 1440, "height": 900},
    )
    try:
        ctx = context
        page = ctx.pages[0] if ctx.pages else await ctx.new_page()

        # Captura console.log
        page.on("console", lambda msg: console_logs.append(f"[{msg.type}] {msg.text}"))

        # 0. INJETA HOOKS ANTES DE QUALQUER COISA
        print("\n  [0] Injetando fetch + XHR + crypto.subtle hooks...")
        await page.add_init_script(FETCH_HOOK_JS)

        # 1. Login
        print("\n  [1] Login...")
        await page.goto("https://www.bet365.bet.br", timeout=30000)
        await asyncio.sleep(3)
        await auto_login(page, ctx)

        # 2. In-Play
        print("\n  [2] In-Play eSports...")
        await page.evaluate("window.location.hash = '#/IP/B18'")
        await asyncio.sleep(5)

        # 3. Espera gwt
        print("\n  [3] Esperando gwt...")
        gwt = await wait_for_gwt(ctx, timeout=60)
        print(f"  gwt: {'SIM (' + str(len(gwt)) + ' chars)' if gwt else 'NAO'}")

        # 4. Dump scripts carregados
        print("\n  [4] Analisando scripts carregados...")
        scripts = await dump_js_sources(page)
        print(f"  Total scripts: {len(scripts)}")
        for s in scripts:
            if s["textLen"] > 1000:
                print(f"    [{s['index']}] src={s['src'][:80]} len={s['textLen']}")

        # 5. Busca padrões de challenge no JS
        print("\n  [5] Buscando padroes de challenge no JS...")
        findings = await search_js_for_challenge(page)
        print(f"  Total findings: {len(findings)}")

        # Agrupa por padrão
        by_pattern = {}
        for f in findings:
            pat = f["pattern"]
            if pat not in by_pattern:
                by_pattern[pat] = []
            by_pattern[pat].append(f)

        for pat, items in sorted(by_pattern.items()):
            print(f"\n  --- Padrao: {pat} ({len(items)} matches) ---")
            for item in items[:3]:
                ctx_clean = item["context"][:160]
                print(f"    script[{item['scriptIdx']}] pos={item['matchPos']}")
                print(f"    src: {item['scriptSrc'][:80]}")
                print(f"    ctx: {ctx_clean}")

        # 6. Busca ESPECÍFICA: FNV hash (cf4 = 2166136261 é FNV offset basis!)
        print("\n  [6] Busca especifica: FNV + challenge construction...")
        fnv_search = await page.evaluate("""() => {
            const results = [];
            document.querySelectorAll('script').forEach((script, idx) => {
                const text = script.textContent || '';
                if (text.length < 100) return;

                // Procura funções que constroem URL de PlaceBet
                const urlPatterns = [
                    /BetsWebAPI[^;]{0,200}placebet/gi,
                    /placebet[^;]{0,200}betGuid/gi,
                    /betGuid[^;]{0,200}&c=/gi,
                    /["']c["']\\s*[,:]/gi,
                    /challenge[^;]{0,200}/gi,
                ];
                urlPatterns.forEach(pat => {
                    pat.lastIndex = 0;
                    let m;
                    while ((m = pat.exec(text)) !== null) {
                        const start = Math.max(0, m.index - 100);
                        const end = Math.min(text.length, m.index + m[0].length + 200);
                        results.push({
                            scriptIdx: idx,
                            scriptSrc: script.src || '(inline)',
                            pattern: pat.source,
                            pos: m.index,
                            context: text.substring(start, end).replace(/\\s+/g, ' ')
                        });
                        break;
                    }
                });
            });
            return results;
        }""")

        print(f"  Results: {len(fnv_search)}")
        for r in fnv_search:
            print(f"\n  [{r['scriptIdx']}] {r['pattern']}  pos={r['pos']}")
            print(f"    src: {r['scriptSrc'][:80]}")
            print(f"    ctx: {r['context'][:250]}")

        # 7. Tenta triggerar PlaceBet via UI
        print("\n  [7] Tentando triggerar PlaceBet via UI...")
        clicked = await try_click_odds(page)
        if clicked:
            await asyncio.sleep(2)
            placed = await try_place_bet_ui(page)
            if placed:
                print("  Aguardando PlaceBet request (10s)...")
                await asyncio.sleep(10)

        # 8. Lê capturas dos hooks
        print("\n  [8] Verificando capturas dos hooks...")

        fetch_caps = await page.evaluate("() => window.__placebetCaptures || []")
        xhr_caps = await page.evaluate("() => window.__xhrCaptures || []")
        challenge_caps = await page.evaluate("() => window.__challengeStack || []")
        digest_caps = await page.evaluate("() => window.__digestCalls || []")

        print(f"  fetch captures: {len(fetch_caps)}")
        print(f"  XHR captures: {len(xhr_caps)}")
        print(f"  challenge captures: {len(challenge_caps)}")
        print(f"  digest (crypto.subtle) calls: {len(digest_caps)}")

        for fc in fetch_caps:
            print(f"\n  --- FETCH CAPTURE ---")
            print(f"  URL: {fc.get('url','')[:200]}")
            print(f"  Method: {fc.get('method','')}")
            print(f"  Body: {str(fc.get('body',''))[:150]}")
            print(f"  Headers: {json.dumps(fc.get('headers', {}))}")
            stack = fc.get("stack", "")
            print(f"  Stack trace:")
            for line in stack.split("\n")[:10]:
                print(f"    {line.strip()}")

        for xc in xhr_caps:
            print(f"\n  --- XHR CAPTURE ---")
            print(f"  URL: {xc.get('url','')[:200]}")
            print(f"  Body: {str(xc.get('body',''))[:150]}")
            stack = xc.get("stack", "")
            print(f"  Stack trace:")
            for line in stack.split("\n")[:10]:
                print(f"    {line.strip()}")

        for cc in challenge_caps:
            print(f"\n  --- CHALLENGE CAPTURE ---")
            print(f"  c= value: {cc['challenge']}")
            print(f"  URL: {cc['url'][:200]}")
            stack = cc.get("stack", "")
            print(f"  Stack trace:")
            for line in stack.split("\n")[:10]:
                print(f"    {line.strip()}")

        for dc in digest_caps:
            print(f"\n  --- CRYPTO DIGEST ---")
            print(f"  Algo: {dc['algo']}")
            print(f"  Input len: {dc['inputLen']} bytes")
            print(f"  Input preview (hex): {dc['inputPreview']}")
            if dc.get("inputText"):
                print(f"  Input text: {dc['inputText'][:200]}")
            print(f"  Result (base64): {dc['resultB64']}")
            stack = dc.get("stack", "")
            for line in stack.split("\n")[:6]:
                print(f"    {line.strip()}")

        # 9. Console logs com [HOOK]
        print(f"\n  [9] Console logs relevantes ({len(console_logs)} total):")
        hook_logs = [l for l in console_logs if "[HOOK" in l.upper()]
        for l in hook_logs[:30]:
            print(f"  {l}")

        # 10. Dump findings para arquivo
        outfile = Path("tmp/challenge_analysis.json")
        outfile.parent.mkdir(exist_ok=True)
        dump = {
            "scripts": scripts,
            "js_findings": findings,
            "fnv_search": fnv_search,
            "fetch_captures": fetch_caps,
            "xhr_captures": xhr_caps,
            "challenge_captures": challenge_caps,
            "digest_calls": digest_caps,
            "console_hook_logs": hook_logs,
        }
        outfile.write_text(json.dumps(dump, indent=2, ensure_ascii=False), encoding="utf-8")
        print(f"\n  Dump salvo em: {outfile}")

        # 11. Se não capturou via UI, tenta nosso próprio fetch para triggerar hooks
        if not fetch_caps and not xhr_caps:
            print("\n  [11] Nenhum PlaceBet capturado via UI. Verificando se hooks estao ativos...")
            hook_ok = await page.evaluate("() => typeof window.__placebetCaptures !== 'undefined'")
            print(f"  Hooks ativos: {hook_ok}")

            # Verifica se addInitScript funciona para hash navigation
            print("  NOTA: addInitScript pode nao injetar em SPA hash navigation.")
            print("  Tentando re-injetar hooks manualmente...")
            await page.evaluate(FETCH_HOOK_JS)
            hook_ok2 = await page.evaluate("() => typeof window.__placebetCaptures !== 'undefined'")
            print(f"  Hooks apos re-inject: {hook_ok2}")

            # Agora tenta nosso fetch manual para ver se hooks interceptam
            print("  Testando hook com fetch manual para BetsWebAPI...")
            test_result = await page.evaluate("""async () => {
                const before = window.__placebetCaptures.length;
                try {
                    await fetch('https://www.bet365.bet.br/BetsWebAPI/placebet?test=1', {
                        method: 'POST',
                        body: 'test=1',
                        credentials: 'include'
                    });
                } catch(e) {}
                const after = window.__placebetCaptures.length;
                return {before, after, captured: after > before};
            }""")
            print(f"  Hook test: {json.dumps(test_result)}")

        print("\n" + "=" * 70)
        print(f"  gwt: {'SIM' if gwt else 'NAO'}")
        print(f"  Digest calls: {len(digest_caps)}")
        print(f"  Challenge captures: {len(challenge_caps)}")
        print(f"  JS findings: {len(findings)}")
        print("=" * 70)
    finally:
        await context.close()
        await pw.stop()


if __name__ == "__main__":
    asyncio.run(main())
