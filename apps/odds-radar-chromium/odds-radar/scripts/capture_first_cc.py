"""
capture_first_cc.py — Captura os valores de bg, cc, pc no primeiro PlaceBet
via UI do bet365 para descobrir de onde vem o primeiro c=.
"""
from __future__ import annotations
import asyncio, json, os, random, sys
from pathlib import Path
from urllib.parse import parse_qs

sys.stdout.reconfigure(encoding="utf-8", errors="replace")
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
os.chdir(Path(__file__).resolve().parent.parent)

from dotenv import load_dotenv
load_dotenv()
from camoufox.async_api import AsyncCamoufox

TMP = Path("tmp"); TMP.mkdir(exist_ok=True)

# Hook JS: intercepta fetch + XHR e captura requests BetsWebAPI com bg, cc
HOOK_JS = r"""
(function() {
    window.__shevaBetsWebApiCaptures = [];

    // Hook fetch
    const _fetch = window.fetch;
    window.fetch = async function(...args) {
        const url = typeof args[0] === 'string' ? args[0] : (args[0]?.url || '');
        if (/betswebapi/i.test(url)) {
            const cap = { type:'fetch', url, method: args[1]?.method||'GET',
                          body: args[1]?.body ? String(args[1].body).substring(0,3000) : null,
                          ts: Date.now() };
            try {
                const resp = await _fetch.apply(this, args);
                const cl = resp.clone();
                cap.status = resp.status;
                try { cap.respText = (await cl.text()).substring(0,5000); } catch(e) {}
                window.__shevaBetsWebApiCaptures.push(cap);
                return resp;
            } catch(e) { cap.err = e.message; window.__shevaBetsWebApiCaptures.push(cap); throw e; }
        }
        return _fetch.apply(this, args);
    };

    // Hook XHR
    const _open = XMLHttpRequest.prototype.open;
    const _send = XMLHttpRequest.prototype.send;
    XMLHttpRequest.prototype.open = function(m, u, ...r) { this._su=u; this._sm=m; return _open.apply(this,[m,u,...r]); };
    XMLHttpRequest.prototype.send = function(body) {
        if (this._su && /betswebapi/i.test(this._su)) {
            const cap = { type:'xhr', url:this._su, method:this._sm,
                          body: body ? String(body).substring(0,3000) : null, ts: Date.now() };
            this.addEventListener('load', function() {
                cap.status = this.status;
                cap.respText = (this.responseText||'').substring(0,5000);
                window.__shevaBetsWebApiCaptures.push(cap);
            });
        }
        return _send.apply(this,[body]);
    };
    console.log('[SHEVA] hooks OK');
})();
"""


async def auto_login(page, ctx):
    bet_user = os.environ.get("BET365_USER", "")
    bet_pass = os.environ.get("BET365_PASS", "")
    if not bet_user or not bet_pass:
        print("  BET365_USER/PASS not set"); return False
    try:
        cb = await page.query_selector("#onetrust-accept-btn-handler")
        if cb: await cb.click(); await asyncio.sleep(1)
    except: pass
    is_logged = await page.evaluate("() => ![...document.querySelectorAll('button')].some(b=>b.textContent.trim()==='Login')")
    if is_logged:
        print("  Ja logado"); return True
    lb = await page.evaluate("""() => {
        const b = [...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='Login');
        if(b){const r=b.getBoundingClientRect(); return {x:r.x+r.width/2,y:r.y+r.height/2};}
        return null;
    }""")
    if not lb: return False
    await page.mouse.click(lb["x"], lb["y"]); await asyncio.sleep(2)
    try: await page.wait_for_selector('input[type="text"]', timeout=10000, state="visible")
    except: pass
    await page.evaluate("()=>{const s=document.querySelector('input[type=\"text\"]');if(s)s.focus();}")
    await asyncio.sleep(0.3)
    await page.keyboard.press("Control+a"); await page.keyboard.press("Backspace")
    await page.keyboard.type(bet_user, delay=55); await asyncio.sleep(0.5)
    await page.evaluate("()=>{const p=document.querySelector('input[type=\"password\"]');if(p)p.focus();}")
    await asyncio.sleep(0.3)
    await page.keyboard.press("Control+a"); await page.keyboard.press("Backspace")
    await page.keyboard.type(bet_pass, delay=65); await asyncio.sleep(0.5)
    await page.keyboard.press("Enter"); print("  Credenciais enviadas...")
    await asyncio.sleep(8)
    for _ in range(3):
        ck = await ctx.cookies("https://www.bet365.bet.br")
        if any(c["name"]=="pstk" for c in ck): print("  LOGIN OK!"); return True
        await asyncio.sleep(3)
    return True


async def main():
    _geo = '{"location":{"lat":-23.4210,"lng":-51.9331},"accuracy":30}'
    kw = {
        "headless": False, "humanize": True, "os": "windows",
        "firefox_user_prefs": {
            "geo.enabled": True, "geo.prompt.testing": True,
            "geo.prompt.testing.allow": True, "permissions.default.geo": 1,
            "geo.provider.network.url": f"data:application/json,{_geo}",
            "geo.provider.ms-windows-location": False,
            "geo.provider.use_corelocation": False,
            "geo.provider.use_gpsd": False, "geo.provider.use_mls": False,
        },
    }

    async with AsyncCamoufox(**kw) as browser:
        ctx = browser.contexts[0] if browser.contexts else await browser.new_context()
        page = ctx.pages[0] if ctx.pages else await ctx.new_page()

        await page.add_init_script(HOOK_JS)

        # Also capture via Playwright response handler
        pw_responses = []
        async def on_resp(resp):
            if "betswebapi" in resp.url.lower():
                try: body = await resp.text()
                except: body = "(err)"
                pw_responses.append({"url": resp.url, "status": resp.status, "body": body[:5000]})
        page.on("response", on_resp)

        print("[1] Login...")
        await page.goto("https://www.bet365.bet.br", timeout=60000)
        await asyncio.sleep(3)
        await auto_login(page, ctx)

        print("[2] In-Play eSports...")
        await page.evaluate("window.location.hash='#/IP/B18'")
        await asyncio.sleep(5)

        # gwt
        for i in range(30):
            ck = await ctx.cookies("https://www.bet365.bet.br")
            if any(c["name"]=="gwt" for c in ck):
                print(f"  gwt OK ({i+1}s)"); break
            await asyncio.sleep(2)
        else:
            print("  gwt NAO apareceu"); return
        await asyncio.sleep(3)

        # [3] Click odds
        print("[3] Clicando odds...")
        await page.evaluate("()=>document.querySelectorAll('.wcl-ModalManager_DarkWash,.wcl-ModalManager_LightWash').forEach(e=>e.remove())")
        await asyncio.sleep(1)

        odds = await page.evaluate("""() => {
            const cells = document.querySelectorAll('[class*="Participant"][class*="Odds"]');
            const r = [];
            for (const c of cells) {
                const t = c.textContent?.trim();
                if (!t || t==='-') continue;
                const b = c.getBoundingClientRect();
                if (b.width>0 && b.height>0 && b.top>100) r.push({t, x:b.x+b.width/2, y:b.y+b.height/2});
                if (r.length>=5) break;
            }
            return r;
        }""")
        if not odds:
            print("  Nenhum odds cell"); return
        print(f"  Odds: {odds[0]['t']} at ({odds[0]['x']:.0f},{odds[0]['y']:.0f})")
        await page.mouse.click(odds[0]["x"], odds[0]["y"])
        await asyncio.sleep(3)

        # [4] Fill stake
        print("[4] Preenchendo stake...")
        try:
            has_stake = await page.evaluate("()=>!!document.querySelector('.bsf-StakeBox_StakeValue-input')")
        except Exception as e:
            print(f"  Erro ao verificar stake: {e}")
            has_stake = False
        if not has_stake:
            print("  Stake box não encontrado")
            # Try clicking on the betslip area first
            await asyncio.sleep(2)
            has_stake = await page.evaluate("()=>!!document.querySelector('.bsf-StakeBox_StakeValue-input')")
        
        if has_stake:
            # Fill via DOM manipulation (the proven method from intercept_placebet.py)
            await page.evaluate("""() => {
                const el = document.querySelector('.bsf-StakeBox_StakeValue-input');
                if (!el) return;
                el.textContent = '';
                el.innerText = '';
                el.focus();
                el.dispatchEvent(new InputEvent('beforeinput', {bubbles:true,cancelable:true,inputType:'insertText',data:'1'}));
                el.textContent = '1';
                el.dispatchEvent(new InputEvent('input', {bubbles:true,cancelable:true,inputType:'insertText',data:'1'}));
                el.dispatchEvent(new Event('change', {bubbles:true}));
                el.dispatchEvent(new KeyboardEvent('keydown', {key:'1',code:'Digit1',bubbles:true}));
                el.dispatchEvent(new KeyboardEvent('keyup', {key:'1',code:'Digit1',bubbles:true}));
            }""")
            await asyncio.sleep(2)
            sv = await page.evaluate("()=>{const e=document.querySelector('.bsf-StakeBox_StakeValue-input');return e?e.textContent.trim():'N/A';}")
            print(f"  Stake value: '{sv}'")

            btn_ok = await page.evaluate("""() => {
                const btn = document.querySelector('.bsf-PlaceBetButton');
                if (!btn) return null;
                const cls = btn.className;
                const r = btn.getBoundingClientRect();
                return {
                    enabled: !cls.includes('Disabled') && !cls.includes('disabled'),
                    text: btn.textContent.trim(),
                    x: r.x+r.width/2, y: r.y+r.height/2,
                    cls: cls.substring(0,200)
                };
            }""")
            print(f"  Place Bet: {btn_ok}")

            if btn_ok and btn_ok["enabled"]:
                # Pre-click: check sessionStorage for bg/cc
                pre_ss = await page.evaluate("""() => {
                    const r = {};
                    for(let i=0;i<sessionStorage.length;i++){
                        const k=sessionStorage.key(i);
                        r[k]=sessionStorage.getItem(k)?.substring(0,500);
                    }
                    return r;
                }""")
                print(f"\n  Pre-PlaceBet sessionStorage:")
                for k,v in pre_ss.items():
                    print(f"    {k}: {v[:200]}")

                # Click Place Bet
                print(f"\n[5] Clicando Place Bet...")
                await page.mouse.click(btn_ok["x"], btn_ok["y"])
                await asyncio.sleep(8)

                # Get captures
                caps = await page.evaluate("()=>window.__shevaBetsWebApiCaptures||[]")
                print(f"\n  === BetsWebAPI CAPTURES: {len(caps)} ===")
                for i, c in enumerate(caps):
                    print(f"\n  --- Capture #{i+1} ({c.get('type')}) ---")
                    url = c.get("url","")
                    print(f"  URL: {url[:500]}")
                    print(f"  Method: {c.get('method')}")
                    print(f"  Status: {c.get('status')}")
                    if c.get("body"):
                        print(f"  Body: {c['body'][:500]}")
                    if c.get("respText"):
                        print(f"  Response: {c['respText'][:1000]}")
                    # Parse URL params
                    if "?" in url:
                        qs = url.split("?",1)[1]
                        params = parse_qs(qs)
                        pp = {k: v[0] if len(v)==1 else v for k,v in params.items()}
                        print(f"  Params: {json.dumps(pp, indent=4)}")
                        # Key values
                        if "c" in pp:
                            print(f"\n  *** c= (challenge): {pp['c']} ***")
                            print(f"  *** c= length: {len(pp['c'])} ***")
                        if "betGuid" in pp:
                            print(f"  *** betGuid: {pp['betGuid']} ***")
                        if "p" in pp:
                            print(f"  *** p= (participantCorrelation): {pp['p']} ***")

                print(f"\n  === Playwright responses: {len(pw_responses)} ===")
                for r in pw_responses:
                    print(f"  URL: {r['url'][:500]}")
                    print(f"  Status: {r['status']}")
                    print(f"  Body: {r['body'][:1000]}")
                    # Parse response JSON
                    try:
                        rj = json.loads(r["body"])
                        print(f"  Response keys: {list(rj.keys())}")
                        if "cc" in rj:
                            print(f"  *** Response cc: {rj['cc']} ***")
                        if "bg" in rj:
                            print(f"  *** Response bg: {rj['bg']} ***")
                        if "sr" in rj:
                            print(f"  *** Response sr: {rj['sr']} ***")
                    except: pass

                # Post-PlaceBet sessionStorage
                post_ss = await page.evaluate("""() => {
                    const r = {};
                    for(let i=0;i<sessionStorage.length;i++){
                        const k=sessionStorage.key(i);
                        r[k]=sessionStorage.getItem(k)?.substring(0,500);
                    }
                    return r;
                }""")
                print(f"\n  Post-PlaceBet sessionStorage:")
                for k,v in post_ss.items():
                    print(f"    {k}: {v[:200]}")

                # Save dump
                dump = {
                    "captures": caps,
                    "pw_responses": pw_responses,
                    "pre_ss": pre_ss,
                    "post_ss": post_ss,
                }
                with open(TMP/"first_cc_capture.json","w",encoding="utf-8") as f:
                    json.dump(dump, f, indent=2, default=str)
                print(f"\nDump: tmp/first_cc_capture.json")

            else:
                print("  Place Bet button disabled ou não encontrado")
                # Try searching for WHAT's wrong
                errs = await page.evaluate("""() => {
                    const els = document.querySelectorAll('[class*="Error"], [class*="error"], [class*="Warning"]');
                    return [...els].map(e => ({cls: e.className.substring(0,100), text: e.textContent?.trim()?.substring(0,200)})).filter(e => e.text);
                }""")
                print(f"  Errors/Warnings on page: {json.dumps(errs, indent=2)[:500]}")
        else:
            print("  Stake box não encontrado de todo")

if __name__ == "__main__":
    try:
        asyncio.run(main())
    except Exception as e:
        import traceback
        traceback.print_exc()
        print(f"\nERROR: {e}")
