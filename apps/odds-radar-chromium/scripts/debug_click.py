"""
Debug: Verifica por que click em odds cells não gera addbet.
Faz login, navega para In-Play eSports, encontra odds, clica,
e captura TODAS as network responses para diagnóstico.
"""
from __future__ import annotations

import asyncio
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

from loguru import logger
from src.api.token_harvester import TokenHarvester
from src.browser.engine import BrowserEngine

BET365_URL = "https://www.bet365.bet.br"


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
        await page.wait_for_selector('input[type="text"], input[name="username"]', timeout=15_000, state="visible")
    except Exception:
        pass
    user_input = page.locator('input[type="text"]').first
    pass_input = page.locator('input[type="password"]').first
    await user_input.fill(bet_user)
    await asyncio.sleep(0.3)
    await pass_input.fill(bet_pass)
    await asyncio.sleep(0.3)
    await page.keyboard.press("Enter")
    await asyncio.sleep(8)
    for _ in range(3):
        ck = await context.cookies("https://www.bet365.bet.br")
        if any(c["name"] == "pstk" for c in ck):
            return True
        await asyncio.sleep(3)
    return False


async def main():
    print("\n=== DEBUG CLICK ===\n")

    engine = BrowserEngine()
    harvester = TokenHarvester(refresh_interval=120)

    async with engine.launch() as context:
        page = await engine.new_page(context)
        page.set_default_timeout(30_000)

        # Login
        print("[1] Login...")
        await page.goto(BET365_URL, wait_until="domcontentloaded", timeout=30000)
        await asyncio.sleep(3)
        harvester.start_sync_term_listener(page)

        logged = await auto_login(page, context)
        print(f"  Login: {'OK' if logged else 'FALHOU'}")
        if not logged:
            return

        # Navigate
        print("[2] Navegando para In-Play eSports...")
        await page.evaluate("window.location.hash = '#/IP/B18'")
        await asyncio.sleep(3)

        current_hash = await page.evaluate("() => window.location.hash")
        print(f"  Hash atual: {current_hash}")

        # Wait for gwt
        tokens = await harvester.extract_from_page(page)
        if not tokens.gwt:
            print("  Esperando gwt (45s)...")
            for i in range(45):
                await asyncio.sleep(1)
                all_ck = await context.cookies()
                if any(c["name"] == "gwt" for c in all_ck):
                    tokens = await harvester.extract_from_page(page)
                    print(f"  gwt OK após {i+1}s")
                    break
                if (i + 1) % 15 == 0:
                    await page.evaluate("window.location.hash = '#/IP'")
                    await asyncio.sleep(1)
                    await page.evaluate("window.location.hash = '#/IP/B18'")
                    print(f"  ... {i+1}s — re-navegando...")
        print(f"  gwt: {'OK' if tokens.gwt else 'AUSENTE'}")

        # Espera conteúdo carregar
        print("  Esperando conteúdo eSports (15s)...")
        await asyncio.sleep(15)

        # Find odds cells
        print("\n[3] Buscando odds cells...")
        cells = await page.evaluate("""() => {
            const sels = [
                '[class*="Participant"][class*="Odds"]',
                '.sgl-ParticipantOddsOnly80_Odds',
                '[class*="OddsContainer"] [class*="Odds"]',
                '.gl-Participant_General',
            ];
            const results = [];
            for (const sel of sels) {
                const els = document.querySelectorAll(sel);
                for (const el of els) {
                    const t = el.textContent?.trim();
                    if (!t || t === '-') continue;
                    const b = el.getBoundingClientRect();
                    if (b.width <= 0 || b.height <= 0 || b.top < 50) continue;
                    results.push({
                        sel: sel,
                        text: t,
                        x: Math.round(b.x + b.width / 2),
                        y: Math.round(b.y + b.height / 2),
                        w: Math.round(b.width),
                        h: Math.round(b.height),
                        className: el.className.substring(0, 80),
                        tagName: el.tagName,
                    });
                    if (results.length >= 15) break;
                }
                if (results.length >= 15) break;
            }
            return results;
        }""")

        print(f"  Encontrados: {len(cells)}")
        for i, c in enumerate(cells):
            print(f"  [{i}] sel={c['sel'][:50]}")
            print(f"       text={c['text']}  at ({c['x']}, {c['y']})  size={c['w']}x{c['h']}")
            print(f"       class={c['className'][:60]}")

        if not cells:
            print("  ❌ Nenhuma odds cell encontrada!")
            # Dump page structure for debug
            struct = await page.evaluate("""() => {
                const els = document.querySelectorAll('*');
                const classes = new Set();
                for (const el of els) {
                    if (el.className && typeof el.className === 'string') {
                        for (const c of el.className.split(' ')) {
                            if (c.includes('Odds') || c.includes('Participant') || c.includes('Market')
                                || c.includes('Coupon') || c.includes('Event') || c.includes('Fixture')
                                || c.includes('ovm-') || c.includes('rcl-') || c.includes('gl-')
                                || c.includes('sgl-') || c.includes('ipl-') || c.includes('ipe-'))
                                classes.add(c);
                        }
                    }
                }
                return Array.from(classes).sort().slice(0, 80);
            }""")
            print(f"  Classes relevantes ({len(struct)}):")
            for c in struct:
                print(f"    {c}")

            # Dump visible text content
            visible_text = await page.evaluate("""() => {
                const body = document.body;
                if (!body) return 'NO BODY';
                return body.innerText.substring(0, 2000);
            }""")
            print(f"\n  Visible text (first 2000 chars):")
            print(visible_text[:2000])

            # Viewport info
            vp = await page.evaluate("""() => ({
                innerW: window.innerWidth,
                innerH: window.innerHeight,
                scrollY: window.scrollY,
                hash: window.location.hash,
                url: window.location.href.substring(0, 100),
            })""")
            print(f"\n  Viewport: {vp}")
            return

        # Check what's at click point BEFORE clicking
        print("\n[4] Verificando elementFromPoint ANTES do click...")
        target = cells[0]
        el_at_point = await page.evaluate(f"""() => {{
            const el = document.elementFromPoint({target['x']}, {target['y']});
            if (!el) return null;
            return {{
                tag: el.tagName,
                className: el.className?.substring(0, 80),
                text: el.textContent?.trim().substring(0, 50),
                id: el.id,
            }};
        }}""")
        print(f"  Element at ({target['x']}, {target['y']}): {el_at_point}")

        # Register response listener for ALL requests
        print("\n[5] Clicando odds cell e monitorando TODAS as responses...")
        responses_captured = []

        async def on_response(resp):
            url = resp.url
            # Only capture bet-related and API URLs
            if any(k in url.lower() for k in ["addbet", "placebet", "betslip", "bet", "coupon", "odds"]):
                try:
                    body = await resp.text()
                    responses_captured.append({
                        "url": url[:100],
                        "status": resp.status,
                        "body_preview": body[:200] if body else "",
                    })
                except Exception:
                    responses_captured.append({"url": url[:100], "status": resp.status, "body_preview": "ERR"})

        async def on_request(req):
            url = req.url
            if any(k in url.lower() for k in ["addbet", "placebet", "betslip", "bet"]):
                print(f"  >> REQUEST: {req.method} {url[:100]}")

        page.on("response", on_response)
        page.on("request", on_request)

        # Click!
        print(f"  Clicando em ({target['x']}, {target['y']}) text={target['text']}...")
        await page.mouse.click(target["x"], target["y"])

        # Wait a bit
        await asyncio.sleep(5)

        # Check what happened
        print(f"\n  Responses capturadas: {len(responses_captured)}")
        for r in responses_captured:
            print(f"    [{r['status']}] {r['url']}")
            if r['body_preview']:
                print(f"         body: {r['body_preview'][:150]}")

        # Check if betslip appeared
        betslip = await page.evaluate("""() => {
            const stake = document.querySelector('.bsf-StakeBox_StakeValue-input, .bss-StakeBox_StakeValue');
            const receipt = document.querySelector('.bsf-ReceiptContent, .bs-Receipt');
            const placeBet = document.querySelector('.bsf-PlaceBetButton, .bss-PlaceBetButton');
            const betslipSels = document.querySelectorAll('[class*="BetSlip"], [class*="betslip"]');
            return {
                stakeVisible: !!stake && stake.getBoundingClientRect().width > 0,
                receiptVisible: !!receipt && receipt.getBoundingClientRect().width > 0,
                placeBetVisible: !!placeBet && placeBet.getBoundingClientRect().width > 0,
                betslipCount: betslipSels.length,
                betslipClasses: Array.from(betslipSels).map(e => e.className.substring(0, 60)).slice(0, 5),
            };
        }""")
        print(f"\n  Betslip state: {betslip}")

        # Check if element at click point changed (maybe it got selected)
        el_after = await page.evaluate(f"""() => {{
            const el = document.elementFromPoint({target['x']}, {target['y']});
            if (!el) return null;
            return {{
                tag: el.tagName,
                className: el.className?.substring(0, 80),
                text: el.textContent?.trim().substring(0, 50),
            }};
        }}""")
        print(f"  Element AFTER click: {el_after}")

        # Remove listeners
        page.remove_listener("response", on_response)
        page.remove_listener("request", on_request)

        # Try clicking with page.click on the actual element instead of mouse coords
        print("\n[6] Tentando locator.click() em vez de mouse.click()...")
        # First remove any existing betslip
        await page.evaluate("""() => {
            const btns = document.querySelectorAll('[class*="RemoveSelection"], [class*="DeleteSelection"]');
            for (const btn of btns) btn.click();
        }""")
        await asyncio.sleep(1)

        responses_captured.clear()
        page.on("response", on_response)
        page.on("request", on_request)

        # Click using locator
        selector = cells[0]["sel"]
        print(f"  Clicando via locator('{selector}').first ...")
        try:
            loc = page.locator(selector).first
            await loc.click(timeout=5000)
            await asyncio.sleep(5)
        except Exception as e:
            print(f"  locator.click falhou: {e}")

        print(f"\n  Responses capturadas: {len(responses_captured)}")
        for r in responses_captured:
            print(f"    [{r['status']}] {r['url']}")
            if r['body_preview']:
                print(f"         body: {r['body_preview'][:150]}")

        betslip2 = await page.evaluate("""() => {
            const stake = document.querySelector('.bsf-StakeBox_StakeValue-input, .bss-StakeBox_StakeValue');
            const placeBet = document.querySelector('.bsf-PlaceBetButton, .bss-PlaceBetButton');
            return {
                stakeVisible: !!stake && stake.getBoundingClientRect().width > 0,
                placeBetVisible: !!placeBet && placeBet.getBoundingClientRect().width > 0,
            };
        }""")
        print(f"  Betslip state: {betslip2}")

        page.remove_listener("response", on_response)
        page.remove_listener("request", on_request)

        print("\n=== DEBUG COMPLETE ===")


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        print("\n  Ctrl+C")
