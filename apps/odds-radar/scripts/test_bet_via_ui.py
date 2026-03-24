"""
Teste de aposta via UI do Bet365 — TESTE DEFINITIVO.

Em vez de chamar a API PlaceBet diretamente, este script:
1. Faz login no Camoufox
2. Navega para In-Play eSports
3. Clica numa odd real (adiciona ao betslip)
4. Preenche stake (R$1)
5. Clica "Fazer Aposta"
6. Monitora o request/response do PlaceBet que o PRÓPRIO browser faz

Se o bet365 UI conseguir apostar → solução = automação UI (não precisa de gwt manual)
Se o bet365 UI também falhar → problema fundamental com Camoufox/GeoComply
"""

from __future__ import annotations
import asyncio
import os
import random
import sys
import json
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8", errors="replace")
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
os.chdir(Path(__file__).resolve().parent.parent)

from dotenv import load_dotenv
load_dotenv()

from camoufox.async_api import AsyncCamoufox
from src.browser.engine import BrowserEngine
from config.settings import get_settings


# ── Variáveis ────────────────────────────────────────────────────────────────
STAKE = 1.00
ODD_MIN = 1.30
ODD_MAX = 5.00

# Captura requests/responses do PlaceBet
placebet_requests: list[dict] = []
placebet_responses: list[dict] = []


async def auto_login(page, context) -> bool:
    """Login automático humanizado."""
    bet_user = os.environ.get("BET365_USER", "")
    bet_pass = os.environ.get("BET365_PASS", "")
    if not bet_user or not bet_pass:
        print("ERRO: BET365_USER/BET365_PASS não definidos")
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
        print("  Já logado (botão Login ausente)")
        return True

    login_bbox = await page.evaluate("""() => {
        const btns = [...document.querySelectorAll('button')];
        const btn = btns.find(b => b.textContent.trim() === 'Login');
        if (btn) { const r = btn.getBoundingClientRect(); return {x:r.x, y:r.y, w:r.width, h:r.height}; }
        return null;
    }""")
    if not login_bbox:
        print("  ERRO: Botão Login não encontrado")
        return False

    lx = login_bbox["x"] + random.uniform(5, max(6, login_bbox["w"] - 5))
    ly = login_bbox["y"] + random.uniform(3, max(4, login_bbox["h"] - 3))
    await page.mouse.click(lx, ly)
    print("  Botão Login clicado")
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

    await page.evaluate("() => { const pw = document.querySelector('input[type=\"password\"]'); if (pw) pw.focus(); }")
    await asyncio.sleep(0.3)
    await page.keyboard.press("Control+a")
    await page.keyboard.press("Backspace")
    await page.keyboard.type(bet_pass, delay=65)
    await asyncio.sleep(0.5)

    await page.keyboard.press("Enter")
    print("  Credenciais enviadas — aguardando 8s...")
    await asyncio.sleep(8)

    for _ in range(3):
        ck = await context.cookies("https://www.bet365.bet.br")
        if any(c["name"] == "pstk" for c in ck):
            print("  LOGIN OK!")
            return True
        await asyncio.sleep(3)

    print("  AVISO: pstk não apareceu, mas continuando...")
    return True


async def setup_placebet_monitor(page):
    """Monitora requests/responses PlaceBet que o browser faz."""

    async def on_request(request):
        url = request.url
        if "placebet" in url.lower() or "BetsWebAPI" in url:
            info = {
                "url": url,
                "method": request.method,
                "headers": dict(request.headers),
                "post_data": request.post_data,
            }
            placebet_requests.append(info)
            print(f"\n{'='*60}")
            print(f"  📤 PlaceBet REQUEST CAPTURADO!")
            print(f"  URL: {url}")
            print(f"  Method: {request.method}")
            # Check for gwt in cookies
            cookie_header = request.headers.get("cookie", "")
            has_gwt = "gwt=" in cookie_header
            print(f"  gwt no cookie: {'SIM' if has_gwt else 'NAO'}")
            if has_gwt:
                gwt_start = cookie_header.index("gwt=")
                gwt_val = cookie_header[gwt_start:gwt_start+50]
                print(f"  gwt: {gwt_val}...")
            print(f"  Headers ({len(request.headers)}):")
            for k, v in sorted(request.headers.items()):
                if k == "cookie":
                    cookies_list = [c.strip().split("=")[0] for c in v.split(";")]
                    print(f"    cookie: ({len(cookies_list)}) {', '.join(cookies_list)}")
                elif k == "x-net-sync-term":
                    print(f"    x-net-sync-term: {v[:60]}... ({len(v)} chars)")
                else:
                    print(f"    {k}: {v}")
            if request.post_data:
                body = request.post_data
                print(f"  Body ({len(body)} chars):")
                # Show ns field
                if "ns=" in body:
                    ns_start = body.index("ns=")
                    ns_end = body.find("&", ns_start + 3)
                    ns_val = body[ns_start:ns_end] if ns_end > 0 else body[ns_start:]
                    print(f"    {ns_val[:200]}...")
            print(f"{'='*60}")

    async def on_response(response):
        url = response.url
        if "placebet" in url.lower() or "BetsWebAPI" in url:
            try:
                body_text = await response.text()
            except Exception:
                body_text = "<error reading body>"
            info = {
                "url": url,
                "status": response.status,
                "body": body_text,
            }
            placebet_responses.append(info)
            print(f"\n{'='*60}")
            print(f"  📥 PlaceBet RESPONSE CAPTURADO!")
            print(f"  Status: {response.status}")
            print(f"  Body: {body_text[:500]}")
            # Parse JSON
            try:
                data = json.loads(body_text)
                cs = data.get("cs", "?")
                sr = data.get("sr", "?")
                mi = data.get("mi", "")
                bg = data.get("bg", "")
                print(f"  cs={cs}  sr={sr}  mi={mi}")
                if bg:
                    print(f"  bg (next betGuid): {bg[:40]}...")
                bt = data.get("bt", [])
                if bt:
                    for b in bt:
                        print(f"  bt: ref={b.get('rf','')} st={b.get('st','')} msg={b.get('mi','')}")
            except Exception:
                pass
            print(f"{'='*60}")

    page.on("request", on_request)
    page.on("response", on_response)
    print("  Monitor PlaceBet instalado")


async def find_and_click_odd(page) -> dict | None:
    """Encontra uma odd no range e clica nela."""
    odds_data = await page.evaluate(f"""() => {{
        const cells = document.querySelectorAll(
            '.sgl-ParticipantOddsOnly80_Odds, .gl-ParticipantOddsOnly_Odds, .gl-Participant_General'
        );
        const results = [];
        for (let i = 0; i < cells.length; i++) {{
            const text = cells[i].textContent.trim();
            const val = parseFloat(text);
            if (!isNaN(val) && val >= {ODD_MIN} && val <= {ODD_MAX}) {{
                const r = cells[i].getBoundingClientRect();
                if (r.width > 0 && r.height > 0) {{
                    results.push({{index: i, value: val, text: text, x: r.x, y: r.y, w: r.width, h: r.height}});
                }}
            }}
        }}
        return results;
    }}""")

    if not odds_data:
        print("  Nenhuma odd encontrada no range")
        return None

    chosen = random.choice(odds_data[:20])  # Entre as primeiras 20
    print(f"  Odd escolhida: {chosen['value']:.2f} (index {chosen['index']})")

    # Click via mouse (mais humano)
    cx = chosen["x"] + chosen["w"] / 2 + random.uniform(-3, 3)
    cy = chosen["y"] + chosen["h"] / 2 + random.uniform(-2, 2)
    await page.mouse.click(cx, cy)
    await asyncio.sleep(2)

    return chosen


async def fill_stake_and_place(page) -> dict:
    """Preenche stake e clica Place Bet. Retorna resultado."""
    result = {"success": False, "message": "", "odd": 0.0}

    # Espera betslip aparecer — scroll para baixo para garantir visibilidade
    await page.evaluate("window.scrollTo(0, 0)")
    await asyncio.sleep(1)

    # Verifica se betslip abriu
    betslip_visible = await page.evaluate("""() => {
        const bs = document.querySelector('.bsf-StakeBox_StakeValue-input, [class*="StakeBox"]');
        return bs !== null;
    }""")

    if not betslip_visible:
        await asyncio.sleep(3)
        betslip_visible = await page.evaluate("""() => {
            const bs = document.querySelector('[class*="Betslip"], [class*="betslip"], .bsf-StakeBox_StakeValue-input');
            return bs !== null;
        }""")

    if not betslip_visible:
        result["message"] = "Betslip nao abriu"
        print(f"  X {result['message']}")
        betslip_debug = await page.evaluate("""() => {
            const all = document.querySelectorAll('[class*="Bet"], [class*="bet"], [class*="Slip"], [class*="slip"]');
            return Array.from(all).slice(0, 10).map(e => ({
                tag: e.tagName,
                cls: e.className.substring(0, 80),
                visible: e.offsetParent !== null,
                text: e.textContent.substring(0, 50)
            }));
        }""")
        if betslip_debug:
            print("  Elementos betslip-related encontrados:")
            for el in betslip_debug:
                print(f"    {el['tag']}.{el['cls'][:50]} visible={el['visible']} text={el['text'][:30]}")
        return result

    print("  Betslip aberto!")

    # Lê odd do betslip
    try:
        odd_el = page.locator('.bsf-BetslipOdds, [class*="Odds_Odds"]').first
        odd_text = await odd_el.text_content(timeout=3000)
        if odd_text:
            result["odd"] = float(odd_text.strip())
            print(f"  Odd no betslip: {result['odd']:.2f}")
    except Exception:
        pass

    # Preenche stake — diagnóstico de posição + scroll inteligente
    # Primeiro verifica viewport
    viewport = await page.evaluate("() => ({ w: window.innerWidth, h: window.innerHeight, scrollY: window.scrollY })")
    print(f"  Viewport: {viewport['w']}x{viewport['h']} scrollY={viewport['scrollY']}")

    stake_info = await page.evaluate("""() => {
        let el = document.querySelector('div[contenteditable="true"].bsf-StakeBox_StakeValue-input');
        if (!el) el = document.querySelector('[class*="StakeBox"] [contenteditable="true"]');
        if (!el) return null;
        const r = el.getBoundingClientRect();
        // Tenta encontrar o container scrollável do betslip
        let parent = el.parentElement;
        let scrollParent = null;
        while (parent) {
            const style = window.getComputedStyle(parent);
            if (style.overflow === 'auto' || style.overflow === 'scroll' || 
                style.overflowY === 'auto' || style.overflowY === 'scroll') {
                scrollParent = { tag: parent.tagName, cls: parent.className.substring(0, 50), 
                    scrollTop: parent.scrollTop, scrollHeight: parent.scrollHeight, clientHeight: parent.clientHeight };
                break;
            }
            parent = parent.parentElement;
        }
        return {
            x: r.x, y: r.y, w: r.width, h: r.height,
            visible: r.width > 0 && r.height > 0,
            cls: el.className.substring(0, 80),
            placeholder: el.getAttribute('placeholder') || '',
            text: el.textContent.trim(),
            scrollParent: scrollParent
        };
    }""")

    if not stake_info:
        result["message"] = "Campo de stake nao encontrado no DOM"
        print(f"  X {result['message']}")
        return result

    print(f"  Stake input: {stake_info['w']:.0f}x{stake_info['h']:.0f} at ({stake_info['x']:.0f},{stake_info['y']:.0f}) visible={stake_info['visible']}")
    if stake_info.get('scrollParent'):
        sp = stake_info['scrollParent']
        print(f"  Scroll parent: {sp['tag']}.{sp['cls'][:30]} scrollTop={sp['scrollTop']} scrollH={sp['scrollHeight']} clientH={sp['clientHeight']}")

    # Se o elemento está fora do viewport, tenta:
    # 1. Scroll do container pai
    # 2. Scroll da janela
    if stake_info['y'] > viewport['h'] or stake_info['y'] < 0:
        print(f"  Stake fora do viewport (y={stake_info['y']:.0f} > viewport_h={viewport['h']})")
        # Scroll via container pai ou window
        await page.evaluate("""() => {
            let el = document.querySelector('div[contenteditable="true"].bsf-StakeBox_StakeValue-input');
            if (!el) el = document.querySelector('[class*="StakeBox"] [contenteditable="true"]');
            if (!el) return;
            // Scroll window para colocar no viewport
            let r = el.getBoundingClientRect();
            if (r.y > window.innerHeight) {
                window.scrollBy(0, r.y - window.innerHeight + 100);
            }
            // Tenta scrollIntoView de TODOS os parents
            let p = el.parentElement;
            while (p && p !== document.body) {
                p.scrollTop = p.scrollHeight;
                p = p.parentElement;
            }
            el.scrollIntoView({ behavior: 'instant', block: 'center' });
        }""")
        await asyncio.sleep(0.5)
        # Re-check position
        new_pos = await page.evaluate("""() => {
            let el = document.querySelector('div[contenteditable="true"].bsf-StakeBox_StakeValue-input');
            if (!el) return null;
            const r = el.getBoundingClientRect();
            return { x: r.x, y: r.y, w: r.width, h: r.height };
        }""")
        if new_pos:
            print(f"  Apos scroll: stake at ({new_pos['x']:.0f},{new_pos['y']:.0f})")
            stake_info['x'] = new_pos['x']
            stake_info['y'] = new_pos['y']
            stake_info['w'] = new_pos['w']
            stake_info['h'] = new_pos['h']

    # Tenta redimensionar viewport se necessário
    if stake_info['y'] > viewport['h']:
        print(f"  Stake AINDA fora do viewport. Resize viewport para {viewport['w']}x{int(stake_info['y'] + 200)}")
        await page.set_viewport_size({"width": viewport['w'], "height": int(stake_info['y'] + 200)})
        await asyncio.sleep(0.5)
        new_pos = await page.evaluate("""() => {
            let el = document.querySelector('div[contenteditable="true"].bsf-StakeBox_StakeValue-input');
            if (!el) return null;
            const r = el.getBoundingClientRect();
            return { x: r.x, y: r.y, w: r.width, h: r.height };
        }""")
        if new_pos:
            print(f"  Apos resize: stake at ({new_pos['x']:.0f},{new_pos['y']:.0f})")
            stake_info['x'] = new_pos['x']
            stake_info['y'] = new_pos['y']

    # Diagnostica o que está na posição do stake input
    sx = stake_info["x"] + stake_info["w"] / 2
    sy = stake_info["y"] + stake_info["h"] / 2
    hit_test = await page.evaluate(f"""() => {{
        const el = document.elementFromPoint({sx}, {sy});
        if (!el) return {{ tag: 'null', cls: '', id: '' }};
        return {{
            tag: el.tagName,
            cls: el.className.substring(0, 100),
            id: el.id,
            contentEditable: el.contentEditable,
            zIndex: window.getComputedStyle(el).zIndex,
            position: window.getComputedStyle(el).position,
            pointerEvents: window.getComputedStyle(el).pointerEvents
        }};
    }}""")
    print(f"  elementFromPoint({sx:.0f},{sy:.0f}): {hit_test['tag']}.{hit_test['cls'][:60]}")
    print(f"    contentEditable={hit_test.get('contentEditable')} zIndex={hit_test.get('zIndex')} pointer={hit_test.get('pointerEvents')}")

    # Verifica se existe overlay sobre o stake input
    overlays = await page.evaluate(f"""() => {{
        const stakeEl = document.querySelector('div[contenteditable="true"].bsf-StakeBox_StakeValue-input');
        if (!stakeEl) return [];
        const stakeRect = stakeEl.getBoundingClientRect();
        const cx = stakeRect.x + stakeRect.width / 2;
        const cy = stakeRect.y + stakeRect.height / 2;
        
        // Encontra todos os elementos nas coordenadas
        const elements = document.elementsFromPoint(cx, cy);
        return elements.slice(0, 8).map(e => ({{
            tag: e.tagName,
            cls: e.className.substring(0, 60),
            ce: e.contentEditable,
            pe: window.getComputedStyle(e).pointerEvents,
            z: window.getComputedStyle(e).zIndex
        }}));
    }}""")
    if overlays:
        print(f"  elementsFromPoint (stack de {len(overlays)} elementos):")
        for i, o in enumerate(overlays):
            print(f"    [{i}] {o['tag']}.{o['cls'][:50]} ce={o['ce']} pe={o['pe']} z={o['z']}")

    # Tenta desabilitar pointer-events nos overlays e clicar direto no alvo
    await page.evaluate("""() => {
        const stakeEl = document.querySelector('div[contenteditable="true"].bsf-StakeBox_StakeValue-input');
        if (!stakeEl) return;
        const r = stakeEl.getBoundingClientRect();
        const cx = r.x + r.width / 2;
        const cy = r.y + r.height / 2;
        const elements = document.elementsFromPoint(cx, cy);
        // Desabilita pointer-events dos elementos ACIMA do stake input
        for (const el of elements) {
            if (el === stakeEl) break;
            if (el.style) el.style.pointerEvents = 'none';
        }
        // Agora foca diretamente
        stakeEl.focus();
        // Cria selection dentro do contenteditable
        const range = document.createRange();
        range.selectNodeContents(stakeEl);
        range.collapse(false);
        const sel = window.getSelection();
        sel.removeAllRanges();
        sel.addRange(range);
    }""")
    await asyncio.sleep(0.3)

    # Click via mouse
    await page.mouse.click(sx, sy)
    await asyncio.sleep(0.5)

    focused = await page.evaluate("() => { const ae = document.activeElement; return ae ? ae.tagName + '.' + (ae.className || '').substring(0, 60) : 'none'; }")
    print(f"  Apos desabilitar overlays + click({sx:.0f},{sy:.0f}) foco: {focused}")

    await page.keyboard.press("Control+a")
    await page.keyboard.press("Backspace")
    await asyncio.sleep(0.2)
    await page.keyboard.type(f"{STAKE:.2f}", delay=random.randint(40, 80))
    print(f"  Stake digitado: R${STAKE:.2f}")
    await asyncio.sleep(1)

    stake_value = await page.evaluate("""() => {
        let el = document.querySelector('div[contenteditable="true"].bsf-StakeBox_StakeValue-input');
        if (el) return el.textContent.trim();
        return 'N/A';
    }""")
    print(f"  Valor no campo: '{stake_value}'")

    # Verifica se o bet365 reconheceu a stake (olha retorno potencial)
    return_info = await page.evaluate("""() => {
        const ret = document.querySelector('[class*="Returns"], [class*="EstReturns"]');
        if (ret) return ret.textContent.trim();
        return null;
    }""")
    if return_info:
        print(f"  Retorno estimado: {return_info}")

    # Verifica botão Place Bet
    btn_info = await page.evaluate("""() => {
        const btn = document.querySelector('.bsf-PlaceBetButton');
        if (!btn) return null;
        const r = btn.getBoundingClientRect();
        const disabled = btn.classList.contains('bsf-PlaceBetButton_Disabled') || 
                         btn.classList.contains('Disabled');
        return {
            text: btn.textContent.trim(),
            disabled: disabled,
            x: r.x, y: r.y, w: r.width, h: r.height,
            visible: r.width > 0 && r.height > 0
        };
    }""")

    if not btn_info:
        result["message"] = "Botao Place Bet nao encontrado"
        print(f"  X {result['message']}")
        return result

    print(f"  Botao: '{btn_info['text']}' disabled={btn_info['disabled']} visible={btn_info['visible']}")

    if btn_info["disabled"]:
        result["message"] = "Botao Place Bet desabilitado"
        print(f"  X {result['message']}")
        errors = await page.evaluate("""() => {
            const errs = document.querySelectorAll('[class*="Error"], [class*="Warning"], [class*="Message"]');
            return Array.from(errs).filter(e => e.textContent.trim().length > 0 && e.offsetParent !== null)
                .map(e => ({cls: e.className.substring(0, 60), text: e.textContent.trim().substring(0, 200)}));
        }""")
        if errors:
            for e in errors:
                print(f"    [{e['cls'][:40]}] {e['text'][:150]}")
        return result

    # CLICA PLACE BET via mouse humanizado
    print(f"\n  >>> CLICANDO 'PLACE BET' — APOSTA REAL R${STAKE:.2f}!")
    bx = btn_info["x"] + btn_info["w"] / 2 + random.uniform(-5, 5)
    by = btn_info["y"] + btn_info["h"] / 2 + random.uniform(-3, 3)
    await page.mouse.click(bx, by)

    # Espera resposta (o monitor vai capturar)
    print("  Aguardando resposta (15s)...")
    for i in range(15):
        await asyncio.sleep(1)
        if placebet_responses:
            print(f"  Resposta capturada em {i+1}s!")
            break
    else:
        print("  Timeout: nenhuma resposta PlaceBet capturada")

    # Verifica DOM para resultados
    await asyncio.sleep(2)

    # Check for receipt (aposta aceita)
    receipt = await page.evaluate("""() => {
        const r = document.querySelector('[class*="ReceiptContent"], [class*="Receipt"], [class*="Confirmation"]');
        if (r && r.offsetParent !== null) return r.textContent.trim().substring(0, 300);
        return null;
    }""")
    if receipt:
        result["success"] = True
        result["message"] = f"APOSTA ACEITA! Recibo: {receipt[:100]}"
        print(f"  ✅ {result['message']}")
        return result

    # Check for error messages
    errors = await page.evaluate("""() => {
        const all = document.querySelectorAll('*');
        const results = [];
        for (const el of all) {
            const cls = el.className || '';
            const txt = el.textContent.trim();
            if ((cls.includes('Error') || cls.includes('error') || cls.includes('Warning') || cls.includes('Referral') ||
                 cls.includes('Suspended') || cls.includes('Closed') || cls.includes('Rejected')) &&
                txt.length > 0 && txt.length < 300 && el.offsetParent !== null) {
                results.push({class: cls.substring(0, 80), text: txt.substring(0, 200)});
            }
        }
        return results.slice(0, 10);
    }""")
    if errors:
        print("  Mensagens após clique:")
        for e in errors:
            print(f"    [{e['class'][:40]}] {e['text'][:150]}")

    # Check betslip state
    bs_state = await page.evaluate("""() => {
        const bs = document.querySelector('[class*="Betslip"], [class*="betslip"]');
        if (bs) return bs.textContent.trim().substring(0, 500);
        return null;
    }""")
    if bs_state:
        print(f"  Estado do betslip: {bs_state[:200]}")

    result["message"] = "Sem confirmação de recibo"
    return result


async def main():
    print()
    print("=" * 60)
    print("  🧪 TESTE: Aposta via UI do Bet365 no Camoufox")
    print("=" * 60)
    print(f"  Stake: R${STAKE:.2f}")
    print(f"  Odds: {ODD_MIN:.2f} – {ODD_MAX:.2f}")
    print("=" * 60)
    print()

    settings = get_settings()
    s = settings.browser
    _geo = '{"location":{"lat":-23.4210,"lng":-51.9331},"accuracy":30}'
    kw = {
        "headless": False,  # Visível para debug
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

        # Setup PlaceBet monitor ANTES de qualquer navegação
        await setup_placebet_monitor(page)

        # 1. Carregar site
        print("  1. Carregando bet365.bet.br...")
        await page.goto("https://www.bet365.bet.br", timeout=30000)
        await asyncio.sleep(3)

        # 2. Login
        print("\n  2. Login...")
        logged_in = await auto_login(page, ctx)
        if not logged_in:
            print("  FALHA NO LOGIN — abortando")
            return

        # 3. Verificar cookies (gwt?)
        cookies = await ctx.cookies("https://www.bet365.bet.br")
        cookie_names = sorted(set(c["name"] for c in cookies))
        has_gwt = any(c["name"] == "gwt" for c in cookies)
        print(f"\n  3. Cookies ({len(cookies)}): {', '.join(cookie_names)}")
        print(f"     gwt: {'SIM' if has_gwt else 'NAO'}")

        # 4. Navegar para In-Play eSports
        print("\n  4. Navegando para In-Play eSports...")
        await page.evaluate("window.location.hash = '#/IP/B18'")
        await asyncio.sleep(5)

        # 5. Verificar odds disponíveis
        odds_count = await page.evaluate("""() => {
            const cells = document.querySelectorAll(
                '.sgl-ParticipantOddsOnly80_Odds, .gl-ParticipantOddsOnly_Odds, .gl-Participant_General'
            );
            return cells.length;
        }""")
        print(f"\n  5. Odds visíveis: {odds_count}")

        if odds_count == 0:
            print("  Aguardando odds carregar (30s)...")
            for i in range(30):
                await asyncio.sleep(1)
                odds_count = await page.evaluate("""() => {
                    return document.querySelectorAll(
                        '.sgl-ParticipantOddsOnly80_Odds, .gl-ParticipantOddsOnly_Odds, .gl-Participant_General'
                    ).length;
                }""")
                if odds_count > 0:
                    print(f"  {odds_count} odds encontradas em {i+1}s")
                    break
            else:
                print("  NENHUMA odd encontrada — abortando")
                return

        # 6. Re-check cookies antes da aposta
        cookies2 = await ctx.cookies("https://www.bet365.bet.br")
        has_gwt2 = any(c["name"] == "gwt" for c in cookies2)
        print(f"\n  6. Cookies pré-aposta ({len(cookies2)}): gwt={'SIM' if has_gwt2 else 'NAO'}")

        # 7. Clicar numa odd
        print("\n  7. Selecionando odd...")
        chosen = await find_and_click_odd(page)
        if not chosen:
            print("  ERRO: Nenhuma odd clicável")
            return

        # 8. Preencher stake e apostar
        print("\n  8. Preenchendo betslip e apostando...")
        bet_result = await fill_stake_and_place(page)

        # 9. Resumo
        print("\n" + "=" * 60)
        print("  📊 RESULTADO FINAL")
        print("=" * 60)
        print(f"  Sucesso: {bet_result['success']}")
        print(f"  Mensagem: {bet_result['message']}")
        print(f"  Odd: {bet_result['odd']}")
        print(f"  PlaceBet requests: {len(placebet_requests)}")
        print(f"  PlaceBet responses: {len(placebet_responses)}")
        if placebet_responses:
            for r in placebet_responses:
                print(f"  Response: status={r['status']} body={r['body'][:200]}")
        if placebet_requests:
            for r in placebet_requests:
                cookie_h = r["headers"].get("cookie", "")
                has_g = "gwt=" in cookie_h
                print(f"  Request gwt={has_g} headers={len(r['headers'])}")
        print("=" * 60)

        # Aguarda para observar o browser
        print("\n  Aguardando 10s para observação...")
        await asyncio.sleep(10)


if __name__ == "__main__":
    asyncio.run(main())
