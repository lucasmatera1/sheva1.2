"""
capture_addbet_body.py — Captura request+response completa de addbet e placebet.
DESCOBERTA: addbet retorna bg, cc, pc que são usados por placebet.
"""
from __future__ import annotations
import asyncio, json, os, random, sys
from pathlib import Path
from urllib.parse import parse_qs, unquote

sys.stdout.reconfigure(encoding="utf-8", errors="replace")
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
os.chdir(Path(__file__).resolve().parent.parent)

from dotenv import load_dotenv
load_dotenv()
from playwright.async_api import async_playwright

TMP = Path("tmp"); TMP.mkdir(exist_ok=True)


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
    from src.browser.engine import STEALTH_CHROMIUM_ARGS
    args = list(STEALTH_CHROMIUM_ARGS)
    args.append("--window-size=1366,1080")

    pw = await async_playwright().start()
    context = await pw.chromium.launch_persistent_context(
        user_data_dir=str(Path(__file__).resolve().parent.parent / ".browser_data"),
        headless=False,
        args=args,
        geolocation={"latitude": -23.4210, "longitude": -51.9331},
        permissions=["geolocation"],
        locale="pt-BR",
        timezone_id="America/Sao_Paulo",
        viewport={"width": 1366, "height": 1080},
        ignore_https_errors=True,
    )
    try:
        ctx = context
        page = ctx.pages[0] if ctx.pages else await ctx.new_page()

        # Capture REQUESTS (body) and RESPONSES via Playwright
        all_traffic = []

        async def on_req(req):
            if "betswebapi" in req.url.lower():
                entry = {
                    "direction": "REQUEST",
                    "url": req.url,
                    "method": req.method,
                    "headers": dict(req.headers),
                    "post_data": req.post_data,
                }
                all_traffic.append(entry)
                print(f"\n  >>> REQUEST: {req.method} {req.url[:200]}")
                if req.post_data:
                    print(f"  >>> POST body: {req.post_data[:500]}")
                print(f"  >>> Headers: {json.dumps(dict(req.headers), indent=2)[:500]}")

        async def on_resp(resp):
            if "betswebapi" in resp.url.lower():
                try: body = await resp.text()
                except: body = "(err)"
                entry = {
                    "direction": "RESPONSE",
                    "url": resp.url,
                    "status": resp.status,
                    "body": body[:10000],
                    "headers": dict(resp.headers),
                }
                all_traffic.append(entry)
                print(f"\n  <<< RESPONSE: {resp.status} {resp.url[:200]}")
                print(f"  <<< Body: {body[:1000]}")

        page.on("request", on_req)
        page.on("response", on_resp)

        print("[1] Login...")
        await page.goto("https://www.bet365.bet.br", timeout=60000)
        await asyncio.sleep(3)
        await auto_login(page, ctx)

        print("[2] In-Play eSports...")
        await page.evaluate("window.location.hash='#/IP/B18'")
        await asyncio.sleep(5)

        for i in range(30):
            ck = await ctx.cookies("https://www.bet365.bet.br")
            if any(c["name"]=="gwt" for c in ck):
                print(f"  gwt OK ({i+1}s)"); break
            await asyncio.sleep(2)
        else:
            print("  gwt NAO apareceu"); return
        await asyncio.sleep(3)

        # Click odds
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

        # Clear traffic before clicking odds
        all_traffic.clear()
        print("\n  --- Traffic cleared, clicking odds ---")
        await page.mouse.click(odds[0]["x"], odds[0]["y"])
        await asyncio.sleep(4)

        # Report traffic after clicking odds
        print(f"\n  Traffic after clicking odds: {len(all_traffic)} entries")
        traffic_after_odds = list(all_traffic)

        # Fill stake
        print("[4] Preenchendo stake...")
        has_stake = await page.evaluate("()=>!!document.querySelector('.bsf-StakeBox_StakeValue-input')")
        if not has_stake:
            print("  Stake box não encontrado - aguardando...")
            await asyncio.sleep(3)
            has_stake = await page.evaluate("()=>!!document.querySelector('.bsf-StakeBox_StakeValue-input')")

        if not has_stake:
            print("  ERRO: Stake box definitivamente não encontrado")
            return

        await page.evaluate("""() => {
            const el = document.querySelector('.bsf-StakeBox_StakeValue-input');
            if (!el) return;
            el.textContent = ''; el.innerText = ''; el.focus();
            el.dispatchEvent(new InputEvent('beforeinput', {bubbles:true,cancelable:true,inputType:'insertText',data:'1'}));
            el.textContent = '1';
            el.dispatchEvent(new InputEvent('input', {bubbles:true,cancelable:true,inputType:'insertText',data:'1'}));
            el.dispatchEvent(new Event('change', {bubbles:true}));
        }""")
        await asyncio.sleep(2)

        sv = await page.evaluate("()=>{const e=document.querySelector('.bsf-StakeBox_StakeValue-input');return e?e.textContent.trim():'N/A';}")
        print(f"  Stake: '{sv}'")

        btn = await page.evaluate("""() => {
            const btn = document.querySelector('.bsf-PlaceBetButton');
            if (!btn) return null;
            const r = btn.getBoundingClientRect();
            return {
                enabled: !btn.className.includes('Disabled'),
                x: r.x+r.width/2, y: r.y+r.height/2
            };
        }""")
        if not btn or not btn["enabled"]:
            print("  Place Bet button disabled"); return

        # Clear traffic before clicking Place Bet
        all_traffic.clear()
        print("\n  --- Traffic cleared, clicking Place Bet ---")
        await page.mouse.click(btn["x"], btn["y"])
        await asyncio.sleep(10)

        # Report all traffic after Place Bet
        print(f"\n{'='*70}")
        print(f"  TOTAL TRAFFIC AFTER PLACE BET: {len(all_traffic)} entries")
        print(f"{'='*70}")

        for i, entry in enumerate(all_traffic):
            print(f"\n  --- Entry #{i+1}: {entry['direction']} ---")
            print(f"  URL: {entry['url']}")
            if entry["direction"] == "REQUEST":
                print(f"  Method: {entry.get('method')}")
                pd = entry.get("post_data")
                if pd:
                    print(f"  POST Data: {pd[:2000]}")
                    # Decode
                    if "&" in pd:
                        params = parse_qs(pd)
                        print(f"  Decoded params:")
                        for k, v in params.items():
                            print(f"    {k}: {v[0][:300] if len(v)==1 else str(v)[:300]}")
                # Print key headers
                hdrs = entry.get("headers", {})
                for h in ["content-type", "x-request-id", "x-net-sync-term", "cookie"]:
                    if h in hdrs:
                        val = hdrs[h][:200] if h != "cookie" else f"({len(hdrs[h])} chars)"
                        print(f"  Header {h}: {val}")
            else:
                print(f"  Status: {entry.get('status')}")
                body_str = entry.get("body", "")
                print(f"  Body: {body_str[:2000]}")
                try:
                    rj = json.loads(body_str)
                    print(f"  Keys: {list(rj.keys())}")
                    for key in ["bg", "cc", "pc", "sr"]:
                        if key in rj:
                            print(f"  *** {key}: {rj[key]} ***")
                except: pass

        # Also save traffic from odds click
        dump = {
            "traffic_after_odds_click": traffic_after_odds,
            "traffic_after_placebet": list(all_traffic),
        }
        with open(TMP / "addbet_placebet_traffic.json", "w", encoding="utf-8") as f:
            json.dump(dump, f, indent=2, default=str)
        print(f"\nDump: tmp/addbet_placebet_traffic.json")
    finally:
        await context.close()
        await pw.stop()


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except Exception as e:
        import traceback
        traceback.print_exc()
