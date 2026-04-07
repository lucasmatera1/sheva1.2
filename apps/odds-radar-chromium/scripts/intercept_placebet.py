"""
Intercepta o PlaceBet real do bet365 clicando odds + betslip.
Objetivo: descobrir de onde vem o parâmetro c= (challenge token) da URL.

Abordagem:
1. Login
2. Navega In-Play (gwt aparece)
3. Instala route handler para interceptar PlaceBet
4. Clica em odds cell (abre betslip)
5. Tenta preencher stake via JS
6. Tenta clicar Place Bet (ou analisa requests capturados)
"""
from __future__ import annotations
import asyncio
import json
import os
import random
import sys
from pathlib import Path
from urllib.parse import unquote

sys.stdout.reconfigure(encoding="utf-8", errors="replace")
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
os.chdir(Path(__file__).resolve().parent.parent)

from dotenv import load_dotenv
load_dotenv()

from playwright.async_api import async_playwright
from config.settings import get_settings


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
            print(f"  ... {i+1}s — {len(ck)} cookies, gwt: NAO")
        await asyncio.sleep(1)
    return None


async def main():
    print()
    print("=" * 60)
    print("  INTERCEPTAR PlaceBet + Encontrar c= challenge")
    print("=" * 60)

    from src.browser.engine import STEALTH_CHROMIUM_ARGS

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

        # 1. Login
        print("\n  [1] Login...")
        await page.goto("https://www.bet365.bet.br", timeout=30000)
        await asyncio.sleep(3)
        await auto_login(page, ctx)

        # 2. In-Play + gwt
        print("\n  [2] In-Play eSports + gwt...")
        await page.evaluate("window.location.hash = '#/IP/B18'")
        await asyncio.sleep(5)
        gwt = await wait_for_gwt(ctx, timeout=30)
        print(f"  gwt: {'SIM' if gwt else 'NAO'}")

        # 3. Busca c= challenge em vários locais
        print("\n  [3] Buscando challenge token (c=)...")
        
        # 3a. localStorage
        ls_data = await page.evaluate("""() => {
            const result = {};
            for (let i = 0; i < localStorage.length; i++) {
                const key = localStorage.key(i);
                result[key] = localStorage.getItem(key);
            }
            return result;
        }""")
        print(f"  localStorage keys ({len(ls_data)}): {sorted(ls_data.keys())}")
        for k, v in ls_data.items():
            if isinstance(v, str) and len(v) > 10 and len(v) < 100:
                print(f"    {k} = {v[:80]}")
        
        # 3b. sessionStorage
        ss_data = await page.evaluate("""() => {
            const result = {};
            for (let i = 0; i < sessionStorage.length; i++) {
                const key = sessionStorage.key(i);
                result[key] = sessionStorage.getItem(key);
            }
            return result;
        }""")
        print(f"\n  sessionStorage keys ({len(ss_data)}): {sorted(ss_data.keys())}")
        for k, v in ss_data.items():
            if isinstance(v, str) and len(v) > 10 and len(v) < 100:
                print(f"    {k} = {v[:80]}")

        # 3c. Cookies
        ck = await ctx.cookies("https://www.bet365.bet.br")
        print(f"\n  Cookies ({len(ck)}):")
        for c in sorted(ck, key=lambda x: x["name"]):
            val = c["value"]
            print(f"    {c['name']} ({len(val)} chars): {val[:60]}{'...' if len(val)>60 else ''}")

        # 3d. Busca variáveis JS globais que possam conter o challenge
        challenge_search = await page.evaluate("""() => {
            const results = {};
            // Busca por variáveis comuns de betting
            const candidates = ['_cc', 'cc', 'challenge', 'betChallenge', 'placebetChallenge',
                'betsapi', 'BetsWebAPI', '_betsWebAPI', 'g_nc', 'nc'];
            for (const name of candidates) {
                try {
                    if (window[name] !== undefined) results[name] = String(window[name]).substring(0, 100);
                } catch {}
            }
            // Busca genérica por base64-like strings em globals
            for (const key of Object.keys(window)) {
                try {
                    const val = window[key];
                    if (typeof val === 'string' && val.length > 30 && val.length < 100 && /^[A-Za-z0-9+/=_-]+$/.test(val)) {
                        results['window.' + key] = val.substring(0, 80);
                    }
                } catch {}
            }
            return results;
        }""")
        print(f"\n  JS globals com tokens ({len(challenge_search)}):")
        for k, v in challenge_search.items():
            print(f"    {k} = {v}")

        # 4. Intercepta PlaceBet
        print("\n  [4] Interceptando PlaceBet requests...")
        intercepted = {"requests": []}

        async def intercept_placebet(route, request):
            url = request.url
            hdrs = dict(request.headers)
            body = request.post_data or ""
            
            # Extrai c= da URL
            c_val = ""
            if "&c=" in url:
                c_val = url.split("&c=")[1].split("&")[0]
            
            entry = {
                "url": url[:250],
                "c_param": unquote(c_val),
                "x_request_id": hdrs.get("x-request-id", ""),
                "body_raw": body[:500],
                "body_decoded": unquote(body[:500]),
                "headers": {k: v[:60] for k, v in hdrs.items()},
            }
            intercepted["requests"].append(entry)
            print(f"\n  !!! PlaceBet INTERCEPTADO !!!")
            print(f"  URL: {url[:200]}")
            print(f"  c= : {unquote(c_val)}")
            print(f"  body (decoded): {unquote(body[:300])}")
            print(f"  x-request-id: {hdrs.get('x-request-id', 'N/A')}")
            
            # Continua o request (não bloqueia)
            await route.continue_()

        await page.route("**/BetsWebAPI/placebet*", intercept_placebet)

        # 5. Clica em odds cell para abrir betslip
        print("\n  [5] Clicando em odds cell...")
        odds_cells = await page.evaluate("""() => {
            const cells = document.querySelectorAll('.sgl-ParticipantOddsOnly80_Odds, .gl-ParticipantOddsOnly_Odds');
            const results = [];
            for (let i = 0; i < Math.min(cells.length, 20); i++) {
                const text = cells[i].textContent.trim();
                const val = parseFloat(text);
                if (!isNaN(val) && val > 1.2 && val < 5.0) {
                    const r = cells[i].getBoundingClientRect();
                    results.push({
                        index: i, text: text, odds: val,
                        x: r.x + r.width/2, y: r.y + r.height/2,
                        w: r.width, h: r.height
                    });
                }
            }
            return results;
        }""")
        print(f"  Odds cells disponíveis: {len(odds_cells)}")
        
        if not odds_cells:
            print("  ERRO: Sem odds cells")
            return

        cell = odds_cells[0]
        print(f"  Clicando odds '{cell['text']}' em ({cell['x']:.0f}, {cell['y']:.0f})")
        await page.mouse.click(cell["x"], cell["y"])
        await asyncio.sleep(3)

        # Verifica se betslip abriu
        betslip = await page.evaluate("""() => {
            const bs = document.querySelector('.bsf-StakeBox_StakeValue-input');
            const btn = document.querySelector('.bsf-PlaceBetButton');
            return {
                stakeInput: !!bs,
                placeBetBtn: !!btn,
                stakeRect: bs ? (() => { const r = bs.getBoundingClientRect(); return {x:r.x,y:r.y,w:r.width,h:r.height}; })() : null,
                btnText: btn ? btn.textContent.trim() : '',
            };
        }""")
        print(f"  Betslip: stake={betslip['stakeInput']}, btn={betslip['placeBetBtn']}, btnText='{betslip['btnText']}'")

        if betslip["stakeInput"]:
            # 6. Tenta preencher stake
            print("\n  [6] Preenchendo stake via JS DOM manipulation...")
            
            # Método: Simula React/Angular input event chain
            await page.evaluate("""() => {
                const el = document.querySelector('.bsf-StakeBox_StakeValue-input');
                if (!el) return;
                
                // Limpa conteúdo
                el.textContent = '';
                el.innerText = '';
                
                // Foca
                el.focus();
                
                // Simula digitação via input events
                const inputEvent = new InputEvent('input', {
                    bubbles: true, cancelable: true, inputType: 'insertText', data: '1'
                });
                
                // Primeiro dispara beforeinput
                el.dispatchEvent(new InputEvent('beforeinput', {
                    bubbles: true, cancelable: true, inputType: 'insertText', data: '1'
                }));
                
                // Seta o texto
                el.textContent = '1';
                
                // Dispara input
                el.dispatchEvent(inputEvent);
                
                // Dispara change
                el.dispatchEvent(new Event('change', { bubbles: true }));
                
                // Dispara keydown/keyup para '1'
                el.dispatchEvent(new KeyboardEvent('keydown', { key: '1', code: 'Digit1', bubbles: true }));
                el.dispatchEvent(new KeyboardEvent('keyup', { key: '1', code: 'Digit1', bubbles: true }));
            }""")
            await asyncio.sleep(2)

            # Verifica se stake foi aceito
            stake_val = await page.evaluate("""() => {
                const el = document.querySelector('.bsf-StakeBox_StakeValue-input');
                return el ? el.textContent.trim() : 'N/A';
            }""")
            btn_enabled = await page.evaluate("""() => {
                const btn = document.querySelector('.bsf-PlaceBetButton');
                if (!btn) return false;
                const cls = btn.className;
                return !cls.includes('Disabled') && !cls.includes('disabled');
            }""")
            print(f"  Stake value: '{stake_val}'")
            print(f"  Button enabled: {btn_enabled}")

            if btn_enabled:
                print("\n  [7] Clicando Place Bet...")
                btn_rect = await page.evaluate("""() => {
                    const btn = document.querySelector('.bsf-PlaceBetButton');
                    const r = btn.getBoundingClientRect();
                    return {x: r.x + r.width/2, y: r.y + r.height/2};
                }""")
                await page.mouse.click(btn_rect["x"], btn_rect["y"])
                await asyncio.sleep(5)
                
                print(f"\n  Requests interceptados: {len(intercepted['requests'])}")
                for req in intercepted["requests"]:
                    print(f"\n  === PlaceBet Interceptado ===")
                    print(f"  c= : {req['c_param']}")
                    print(f"  x-request-id: {req['x_request_id']}")
                    print(f"  body: {req['body_decoded'][:300]}")
            else:
                print("  Button desabilitado — stake não aceito pelo UI")
                print("  Tentando buscar o c= de outra forma...")

        # 7. Alternativa: busca o c= no JavaScript do bet365
        print("\n  [8] Buscando placebet challenge no JS do bet365...")
        
        # Monkey-patch XMLHttpRequest.open para capturar o c= quando bet365 fizer request
        await page.evaluate("""() => {
            window.__b365_captured_placebet = [];
            const origOpen = XMLHttpRequest.prototype.open;
            const origSend = XMLHttpRequest.prototype.send;
            XMLHttpRequest.prototype.open = function(method, url, ...args) {
                this.__url = url;
                this.__method = method;
                return origOpen.apply(this, [method, url, ...args]);
            };
            XMLHttpRequest.prototype.send = function(body) {
                if (this.__url && this.__url.includes('placebet')) {
                    window.__b365_captured_placebet.push({
                        url: this.__url,
                        method: this.__method,
                        body: body ? body.substring(0, 500) : '',
                    });
                }
                return origSend.apply(this, [body]);
            };
            
            // Also monkey-patch fetch
            const origFetch = window.fetch;
            window.fetch = function(url, opts) {
                const urlStr = typeof url === 'string' ? url : url.url;
                if (urlStr && urlStr.includes('placebet')) {
                    window.__b365_captured_placebet.push({
                        url: urlStr,
                        method: opts?.method || 'GET',
                        body: opts?.body ? String(opts.body).substring(0, 500) : '',
                    });
                }
                return origFetch.apply(this, arguments);
            };
        }""")
        
        print("  XHR/fetch interceptors instalados")
        print("  Aguardando 30s para qualquer PlaceBet nativo...")
        
        # Espera um pouco para ver se algo é capturado
        await asyncio.sleep(5)
        
        captured = await page.evaluate("() => window.__b365_captured_placebet || []")
        print(f"  Captured via XHR/fetch: {len(captured)}")
        for c in captured:
            print(f"    {c['method']} {c['url'][:150]}")
            print(f"    body: {c['body'][:200]}")

        # 8. Dump final de todos os dados úteis
        print("\n  === RESUMO ===")
        print(f"  gwt: {'SIM' if gwt else 'NAO'}")
        print(f"  Intercepted via route: {len(intercepted['requests'])}")
        print(f"  Captured via XHR: {len(captured)}")
        
        # Salva tudo para análise
        result = {
            "localStorage": {k: v[:200] for k, v in ls_data.items()},
            "sessionStorage": {k: v[:200] for k, v in ss_data.items()},
            "cookies": [{c["name"]: c["value"][:100]} for c in ck],
            "jsGlobals": challenge_search,
            "intercepted": intercepted["requests"],
            "xhrCaptured": captured,
        }
        with open("tmp/placebet_intercept.json", "w") as f:
            json.dump(result, f, indent=2, ensure_ascii=False)
        print("  Dados salvos em tmp/placebet_intercept.json")
        
        print("=" * 60)
    finally:
        await context.close()
        await pw.stop()
    asyncio.run(main())
