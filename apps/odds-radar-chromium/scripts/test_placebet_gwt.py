"""
Teste PlaceBet com gwt — combina descoberta de gwt + API PlaceBet.

Descoberta: gwt APARECE no Chromium se NÃO houver route handlers
instalados antes da navegação para In-Play.

Este script:
1. Abre Chromium SEM route handlers
2. Login
3. Navega para In-Play (gwt deve aparecer)
4. Extrai gwt + todos os cookies
5. Captura sync_term via listener
6. Faz PlaceBet via browser fetch() COM gwt
"""
from __future__ import annotations
import asyncio
import json
import os
import sys
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8", errors="replace")
sys.stderr = sys.stdout  # Redireciona stderr para stdout
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
os.chdir(Path(__file__).resolve().parent.parent)

from dotenv import load_dotenv
load_dotenv()

from playwright.async_api import async_playwright
from src.browser.engine import BrowserEngine, STEALTH_CHROMIUM_ARGS
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
    # Click no botao Login via coordenadas (protocol-level via Playwright)
    login_bbox = await page.evaluate("""() => {
        const btn = [...document.querySelectorAll('button')].find(b => b.textContent.trim() === 'Login');
        if (btn) { const r = btn.getBoundingClientRect(); return {x:r.x+r.width/2, y:r.y+r.height/2}; }
        return null;
    }""")
    if not login_bbox:
        print("  ERRO: Botao Login nao encontrado")
        return False
    await page.mouse.click(login_bbox["x"], login_bbox["y"])
    await asyncio.sleep(2)
    try:
        await page.wait_for_selector('input[type="text"]', timeout=15000, state="visible")
    except Exception:
        pass
    # Preenche user/pass via locator.fill() — imune a foco/mouse
    user_input = page.locator('input[type="text"]').first
    pass_input = page.locator('input[type="password"]').first
    await user_input.fill(bet_user)
    await asyncio.sleep(0.3)
    await pass_input.fill(bet_pass)
    await asyncio.sleep(0.3)
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
    """Espera gwt aparecer nos cookies (até timeout segundos)."""
    for i in range(timeout):
        ck = await context.cookies("https://www.bet365.bet.br")
        for c in ck:
            if c["name"] == "gwt":
                return c["value"]
        if i % 10 == 9:
            names = sorted(set(c["name"] for c in ck))
            print(f"  ... {i+1}s — {len(ck)} cookies, gwt: NAO")
        await asyncio.sleep(1)
    return None



async def main():
    print()
    print("=" * 60)
    print("  TESTE: PlaceBet COM gwt (API via browser fetch)")
    print("=" * 60)

    settings = get_settings()
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

        # --- Listeners globais (ANTES de qualquer navegação) ---
        ws_selections = {}  # {fid-sid: {fixture_id, selection_id, name, odds}}
        sync_captured = {"value": ""}

        def on_ws_global(ws):
            def on_frame(payload):
                text = payload if isinstance(payload, str) else ""
                # Cada entidade separada por |, campos por ;
                for entity in text.split("|"):
                    if "FI=" not in entity or "ID=" not in entity or "OD=" not in entity:
                        continue
                    fields = {}
                    for seg in entity.split(";"):
                        if "=" in seg:
                            k, v = seg.split("=", 1)
                            fields[k] = v
                    fid = fields.get("FI", "")
                    sid = fields.get("ID", "")
                    odds_raw = fields.get("OD", "")
                    name = fields.get("NA", "")
                    handicap = fields.get("HA", "")
                    if fid and sid and odds_raw:
                        ws_selections[f"{fid}-{sid}"] = {
                            "fixture_id": fid, "selection_id": sid,
                            "name": name, "odds": odds_raw,
                            "handicap": handicap,
                        }
            ws.on("framereceived", lambda p: on_frame(p))

        async def on_req_sync(request):
            t = request.headers.get("x-net-sync-term", "")
            if t and not sync_captured["value"]:
                sync_captured["value"] = t

        page.on("websocket", on_ws_global)
        page.on("request", on_req_sync)

        # 1. Login (SEM route handlers)
        print("\n  [1] Login...")
        await page.goto("https://www.bet365.bet.br", timeout=30000)
        await asyncio.sleep(3)
        await auto_login(page, ctx)

        # 2. Navega para In-Play (WS listener já ativo — captura tudo)
        print("\n  [2] In-Play eSports...")
        await page.evaluate("window.location.hash = '#/IP/B18'")
        await asyncio.sleep(5)
        print(f"  WS selections capturadas até aqui: {len(ws_selections)}")

        # 3. Espera gwt
        print("\n  [3] Esperando gwt (30s max)...")
        gwt = await wait_for_gwt(ctx, timeout=30)
        if not gwt:
            # gwt pode não aparecer se sessão está stale — recarrega completamente
            print("  gwt não apareceu. Recarregando página...")
            await page.goto("https://www.bet365.bet.br/#/IP/B18", timeout=30000)
            await asyncio.sleep(5)
            gwt = await wait_for_gwt(ctx, timeout=40)
        if gwt:
            print(f"  gwt ENCONTRADO! ({len(gwt)} chars): {gwt[:40]}...")
        else:
            print("  gwt NAO apareceu — continuando mesmo assim")

        print(f"  WS selections após gwt: {len(ws_selections)}")
        print(f"  sync_term capturado: {'SIM' if sync_captured['value'] else 'NAO'}")

        # 4. Re-navega para garantir dados frescos (se poucos WS data)
        if len(ws_selections) < 3:
            print("\n  [4] Re-navegando para capturar mais dados...")
            await page.evaluate("window.location.hash = '#/IP'")
            await asyncio.sleep(3)
            await page.evaluate("window.location.hash = '#/IP/B18'")
            await asyncio.sleep(10)
            print(f"  WS selections após re-nav: {len(ws_selections)}")

        # 5. Força sync_term se ainda não capturou
        if not sync_captured["value"]:
            print("\n  [5] Forçando sync_term...")
            await page.evaluate("() => fetch('/defaultapi/sports-configuration', {credentials:'include'}).catch(()=>{})")
            await asyncio.sleep(3)

        sync_term = sync_captured["value"]
        page.remove_listener("request", on_req_sync)

        # 6. Status geral
        ck = await ctx.cookies("https://www.bet365.bet.br")
        cookie_names = sorted(set(c["name"] for c in ck))

        print(f"\n  [6] Status:")
        print(f"  Cookies ({len(ck)}): {', '.join(cookie_names)}")
        print(f"  gwt: {'SIM' if gwt else 'NAO'}")
        print(f"  sync_term: {'OK' if sync_term else 'AUSENTE'} ({len(sync_term)} chars)")
        print(f"  WS selections: {len(ws_selections)}")

        # Mostra algumas selections capturadas
        ws_list = list(ws_selections.values())
        for s in ws_list[:5]:
            print(f"    f={s['fixture_id']} s={s['selection_id']} odds={s['odds']} {s['name']}")

        # =====================================================
        # PASSO 7a: Clicar odds no DOM para acionar addbet real
        # O bet365 JS chama BetsWebAPI/addbet internamente
        # Interceptamos a resposta para obter bg, cc, pc
        # =====================================================
        print("\n  [7a] Clicando odds no DOM para acionar addbet real...")

        # Remove overlays
        await page.evaluate("()=>document.querySelectorAll('.wcl-ModalManager_DarkWash,.wcl-ModalManager_LightWash').forEach(e=>e.remove())")
        await asyncio.sleep(1)

        # Limpa bet slip existente (se tiver selecoes anteriores)
        removed = await page.evaluate("""() => {
            const removeBtns = document.querySelectorAll('[class*="RemoveSelection"], [class*="DeleteSelection"], .bss-RemoveButton, [class*="betslip"] [class*="Remove"]');
            let count = 0;
            for (const btn of removeBtns) {
                btn.click();
                count++;
            }
            return count;
        }""")
        if removed:
            print(f"  Bet slip limpo ({removed} selecoes removidas)")
            await asyncio.sleep(2)

        # Encontra odds cells visíveis
        odds_info = await page.evaluate("""() => {
            const cells = document.querySelectorAll('[class*="Participant"][class*="Odds"]');
            const r = [];
            for (const c of cells) {
                const t = c.textContent?.trim();
                if (!t || t==='-') continue;
                const b = c.getBoundingClientRect();
                if (b.width>0 && b.height>0 && b.top>100)
                    r.push({text: t, x: b.x+b.width/2, y: b.y+b.height/2});
                if (r.length>=5) break;
            }
            return r;
        }""")
        if not odds_info:
            print("  ERRO: Nenhum odds cell visível no DOM")
            return
        print(f"  Odds cells visíveis: {len(odds_info)}")

        # Set up addbet response interceptor
        addbet_response = {"data": None}
        async def on_addbet_resp(resp):
            if "betswebapi/addbet" in resp.url.lower() and not addbet_response["data"]:
                try:
                    body = await resp.text()
                    addbet_response["data"] = json.loads(body)
                    print(f"  [addbet resp] sr={addbet_response['data'].get('sr')} bg={addbet_response['data'].get('bg','')[:20]}...")
                except Exception as e:
                    print(f"  [addbet resp error] {e}")
        page.on("response", on_addbet_resp)

        # Clica na primeira odds cell
        target = odds_info[0]
        print(f"  Clicando: {target['text']} at ({target['x']:.0f}, {target['y']:.0f})")
        await page.mouse.click(target["x"], target["y"])
        
        # Espera addbet response
        for _ in range(15):
            await asyncio.sleep(1)
            if addbet_response["data"]:
                break
        
        try:
            page.remove_listener("response", on_addbet_resp)
        except Exception:
            pass

        if not addbet_response["data"]:
            print("  ERRO: addbet response não capturado")
            return

        ad = addbet_response["data"]
        print(f"  addbet raw keys: {list(ad.keys())}")
        bg = ad.get("bg", "")
        cc = ad.get("cc", "")
        pc = ad.get("pc", "")
        addbet_sr = ad.get("sr", "?")
        
        print(f"  AddBet sr: {addbet_sr}")
        print(f"  bg: {bg}")
        print(f"  cc: {cc}")
        print(f"  pc: {pc}")
        
        if not bg or not cc:
            print("  ERRO: addbet não retornou bg/cc")
            print(f"  Full response: {json.dumps(ad)[:500]}")
            return

        # Extrair odds e detalhes do addbet response
        bt_list = ad.get("bt", [])
        bt = bt_list[0] if bt_list else {}
        odds = bt.get("od", "?")
        fixture_id = str(bt.get("fi", ""))
        pts = bt.get("pt", [{}])
        selection_id = str(pts[0].get("pi", "")) if pts else ""
        print(f"  Odds (confirmado pelo servidor): {odds}")
        print(f"  Fixture: {fixture_id}, Selection: {selection_id}")

        # Calcula retorno
        stake = 1.00
        if "/" in str(odds):
            num, den = str(odds).split("/", 1)
            try:
                dec = 1 + int(num) / int(den)
            except (ValueError, ZeroDivisionError):
                dec = 2.0
        else:
            try:
                dec = float(odds)
            except ValueError:
                dec = 2.0
        total_return = round(stake * dec, 2)

        # =====================================================
        # PASSO 7b: Preencher stake + capturar PlaceBet real via UI
        # Em vez de enviar nosso fetch, deixamos o JS do bet365
        # fazer o placebet e interceptamos o request + response completo
        # =====================================================
        try:
            await _step_7b_7c(page, stake)
        except Exception as e:
            import traceback
            print(f"\n  ERRO em 7b/7c: {e}")
            traceback.print_exc()
        
        print("=" * 60)


async def _step_7b_7c(page, stake):
        print(f"\n  [7b] Preenchendo stake via DOM...")
        # .bsf-StakeBox_StakeValue-input é o div contenteditable=true visível (60x25px)
        stake_sel = '.bsf-StakeBox_StakeValue-input'
        has_stake = False
        for _ in range(8):
            has_stake = await page.evaluate(f"()=>!!document.querySelector('{stake_sel}')")
            if has_stake:
                break
            await asyncio.sleep(1)

        if not has_stake:
            # Tenta seletores alternativos
            for alt in ['.bss-StakeBox_StakeValue', '[class*="StakeBox"][contenteditable]', '[class*="StakeInput"]']:
                has_stake = await page.evaluate(f"()=>!!document.querySelector('{alt}')")
                if has_stake:
                    stake_sel = alt
                    print(f"  Stake encontrado via seletor alternativo: {alt}")
                    break
                await asyncio.sleep(0.5)

        if not has_stake:
            print("  ERRO: Stake box não encontrado")
            return

        # Preenche stake — clica via mouse (trusted) e digita
        stake_rect = await page.evaluate(f"() => {{ const el = document.querySelector('{stake_sel}'); if (!el) return null; const r = el.getBoundingClientRect(); return {{x:r.x+r.width/2, y:r.y+r.height/2}}; }}")
        if stake_rect:
            await page.mouse.click(stake_rect["x"], stake_rect["y"])
            await asyncio.sleep(0.5)
            await page.keyboard.press('Control+a')
            await page.keyboard.press('Backspace')
            await asyncio.sleep(0.2)
            await page.keyboard.type('1', delay=50)
            await asyncio.sleep(1)
        else:
            # Fallback: JS manipulation
            await page.evaluate(f"""
                () => {{
                    const el = document.querySelector('{stake_sel}');
                    if (!el) return;
                    el.focus();
                    el.textContent = '1';
                    el.dispatchEvent(new InputEvent('input', {{bubbles:true,inputType:'insertText',data:'1'}}));
                    el.dispatchEvent(new Event('change', {{bubbles:true}}));
                }}
            """)
            await asyncio.sleep(1)

        sv = await page.evaluate(f"()=>{{const e=document.querySelector('{stake_sel}');return e?e.textContent.trim():'N/A';}}")
        print(f"  Stake value: '{sv}'")

        # Verifica Place Bet button — tenta múltiplos seletores
        btn = await page.evaluate("""
            () => {
                const sels = ['.bsf-PlaceBetButton', '.bss-PlaceBetButton', '[class*="PlaceBet"]'];
                for (const s of sels) {
                    const btn = document.querySelector(s);
                    if (!btn) continue;
                    const r = btn.getBoundingClientRect();
                    if (r.width > 0 && r.height > 0)
                        return {
                            sel: s,
                            enabled: !btn.className.includes('Disabled'),
                            text: btn.textContent.trim().substring(0, 100),
                            x: r.x+r.width/2, y: r.y+r.height/2
                        };
                }
                return null;
            }
        """)
        print(f"  Place Bet button: enabled={btn and btn.get('enabled')}")

        if btn and btn.get("enabled"):
            # Set up placebet request+response interceptor
            placebet_traffic = {"request": None, "response": None}
            async def on_pb_req(req):
                if "betswebapi/placebet" in req.url.lower():
                    placebet_traffic["request"] = {
                        "url": req.url,
                        "method": req.method,
                        "post_data": req.post_data,
                        "headers": dict(req.headers),
                    }
                    print(f"\n  >>> PLACEBET REQUEST interceptado!")
                    print(f"  >>> URL: {req.url[:300]}")
                    print(f"  >>> Body: {(req.post_data or '')[:500]}")
            async def on_pb_resp(resp):
                if "betswebapi/placebet" in resp.url.lower():
                    try: body = await resp.text()
                    except: body = "(err)"
                    placebet_traffic["response"] = {
                        "url": resp.url,
                        "status": resp.status,
                        "body": body,
                    }
                    print(f"\n  <<< PLACEBET RESPONSE: status={resp.status}")
                    print(f"  <<< Body: {body[:500]}")

            page.on("request", on_pb_req)
            page.on("response", on_pb_resp)

            print(f"\n  [7c] Clicando Place Bet via UI...")
            await page.mouse.click(btn["x"], btn["y"])
            
            # Espera placebet request/response
            for _ in range(20):
                await asyncio.sleep(1)
                if placebet_traffic["response"]:
                    break
            
            page.remove_listener("request", on_pb_req)
            page.remove_listener("response", on_pb_resp)

            # Analisa resultado
            if placebet_traffic["response"]:
                try:
                    data = json.loads(placebet_traffic["response"]["body"])
                    sr = data.get("sr", "?")
                    cs = data.get("cs", "?")
                    br_receipt = data.get("br", "")
                    print(f"\n  === RESULTADO PLACEBET (UI) ===")
                    print(f"  sr={sr}  cs={cs}")
                    if br_receipt:
                        print(f"  Bet receipt: {br_receipt}")
                    if sr == 0:
                        print("\n  >>> APOSTA ACEITA via UI! sr=0 <<<")
                    else:
                        print(f"\n  >>> Resultado: sr={sr} cs={cs} <<<")
                except Exception:
                    print(f"  (resposta não é JSON)")
            else:
                print("  PlaceBet não foi interceptado — sem resposta")

            # Mostra detalhes completos do request para debugging
            if placebet_traffic["request"]:
                req = placebet_traffic["request"]
                print(f"\n  === PLACEBET REQUEST DETAILS (para replicar) ===")
                print(f"  URL: {req['url']}")
                print(f"  Method: {req['method']}")
                pd = req.get("post_data", "")
                print(f"  POST Body raw: {pd[:1000]}")
                # Parse URL params
                if "?" in req["url"]:
                    from urllib.parse import parse_qs
                    qs = req["url"].split("?", 1)[1]
                    params = parse_qs(qs)
                    print(f"  URL Params:")
                    for k, v in params.items():
                        print(f"    {k}: {v[0][:100] if len(v)==1 else str(v)[:100]}")
                # Parse body params
                if pd and "&" in pd:
                    from urllib.parse import parse_qs, unquote
                    body_params = parse_qs(pd)
                    print(f"  Body Params:")
                    for k, v in body_params.items():
                        val = v[0] if len(v) == 1 else str(v)
                        print(f"    {k}: {unquote(val[:200])}")
                # Key headers
                hdrs = req.get("headers", {})
                for h in ["content-type", "x-request-id", "x-net-sync-term"]:
                    if h in hdrs:
                        print(f"  Header {h}: {hdrs[h][:100]}")
        else:
            print("  Place Bet button disabled ou não encontrado")
            print("  Sem fallback — PlaceBet requer UI real (Loader bet365 necesário)")
    finally:
        await context.close()
        await pw.stop()


if __name__ == "__main__":
    import traceback
    try:
        asyncio.run(main())
    except Exception:
        traceback.print_exc()
        sys.exit(1)
