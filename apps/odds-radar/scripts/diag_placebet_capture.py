"""
Diagnóstico: Captura EXATA das requests do browser para BetsWebAPI.

Objetivo: Entender por que nosso PlaceBet retorna sr=-1 (rejeição imediata).
Captura:
  1. page_id (param `p`) de qualquer request bet365
  2. Todas as requests a BetsWebAPI/*
  3. O PlaceBet exato que o BROWSER envia (se clicar no betslip)
  4. Compara com o que nosso código envia

Uso:
    python scripts/diag_placebet_capture.py
"""

from __future__ import annotations

import asyncio
import json
import os
import random
import sys
import time
from pathlib import Path
from urllib.parse import urlparse, parse_qs, urlencode, quote

if sys.platform == "win32":
    os.environ.setdefault("PYTHONIOENCODING", "utf-8")
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    if hasattr(sys.stderr, "reconfigure"):
        sys.stderr.reconfigure(encoding="utf-8", errors="replace")

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from loguru import logger
from src.api.http_client import Bet365HttpClient, SessionTokens, _build_ns_payload
from src.api.token_harvester import TokenHarvester
from src.api.ws_parser import Bet365WsParser
from src.browser.engine import BrowserEngine
from src.browser.session import save_cookies

BET365_URL = "https://www.bet365.bet.br"


async def auto_login(page, context) -> bool:
    """Login humanizado automático."""
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
    print("=" * 70)
    print("  DIAG: PlaceBet Request Capture")
    print("  Objetivo: Capturar exatamente o que o browser envia")
    print("=" * 70)
    print()

    engine = BrowserEngine()
    harvester = TokenHarvester(refresh_interval=120)
    parser = Bet365WsParser()

    # Stores
    captured_page_ids: list[str] = []
    captured_sync_terms: list[str] = []
    betswebapi_requests: list[dict] = []
    all_api_requests: list[dict] = []
    selections: list[dict] = []

    async with engine.launch() as context:
        page = await engine.new_page(context)
        page.set_default_timeout(30_000)

        # === MASTER REQUEST LISTENER ===
        def _on_request(request):
            url = request.url
            headers = dict(request.headers)

            # Captura sync_term de qualquer request
            term = headers.get("x-net-sync-term", "")
            if term and len(term) > 50:
                if not captured_sync_terms or captured_sync_terms[-1] != term:
                    captured_sync_terms.append(term)

            # Captura page_id de qualquer request com ?p=
            parsed = urlparse(url)
            qs = parse_qs(parsed.query)
            if "p" in qs:
                pid = qs["p"][0]
                if pid and pid not in captured_page_ids:
                    captured_page_ids.append(pid)
                    print(f"  [CAPTURE] page_id encontrado: {pid} (de {parsed.path})")

            # Captura requests BetsWebAPI
            if "BetsWebAPI" in url or "betswebapi" in url.lower():
                req_data = {
                    "url": url,
                    "method": request.method,
                    "headers": headers,
                    "post_data": request.post_data,
                    "timestamp": time.time(),
                    "resource_type": request.resource_type,
                }
                betswebapi_requests.append(req_data)
                print(f"\n  {'='*60}")
                print(f"  [BETSWEBAPI] {request.method} {url[:100]}")
                print(f"  Headers: {json.dumps({k:v for k,v in headers.items() if k.startswith(('x-','content-','cookie'))}, indent=2)[:300]}")
                if request.post_data:
                    print(f"  Body: {request.post_data[:300]}")
                print(f"  {'='*60}\n")

            # Captura qualquer request com endpoints relevantes
            if any(kw in url for kw in ["contentapi", "defaultapi", "SportsBookData"]):
                pqs = parse_qs(parsed.query)
                all_api_requests.append({
                    "path": parsed.path,
                    "params": {k: v[0] if len(v) == 1 else v for k, v in pqs.items()},
                })

        page.on("request", _on_request)

        # WS listener
        ws_count = 0
        def _on_ws(ws):
            nonlocal ws_count
            ws_count += 1
            def _on_frame(payload):
                if isinstance(payload, bytes):
                    return
                parsed = parser.parse_odds_update(payload)
                if parsed:
                    for p in parsed:
                        if p.get("name") and p.get("handicap"):
                            selections.append(p)
            ws.on("framereceived", lambda data: _on_frame(data))
        page.on("websocket", _on_ws)

        # === 1. LOGIN ===
        print("  [1/6] Login automático...")
        await page.goto(BET365_URL, wait_until="domcontentloaded", timeout=30000)
        await asyncio.sleep(3)

        logged = await auto_login(page, context)
        if logged:
            print("  ✅ Login OK!")
        else:
            print("  ❌ Login falhou — esperando manual...")
            for i in range(120):
                ck = await context.cookies("https://www.bet365.bet.br")
                if any(c["name"] == "pstk" for c in ck):
                    break
                await asyncio.sleep(1)

        # === 2. TOKENS ===
        print("  [2/6] Capturando tokens...")
        tokens = await harvester.extract_from_page(page)

        print(f"  pstk: {'OK' if tokens.pstk else 'NONE'}")
        print(f"  gwt:  {'OK' if tokens.gwt else 'NONE'}")
        print(f"  swt:  {'OK' if tokens.swt else 'NONE'}")
        print(f"  sync: {'OK (' + str(len(tokens.x_net_sync_term)) + ' chars)' if tokens.x_net_sync_term else 'NONE'}")
        print(f"  page_id (harvester): '{tokens.page_id}'")
        print(f"  page_ids capturados de requests: {captured_page_ids}")

        # === 3. NAVEGA IN-PLAY ===
        print("\n  [3/6] Navegando para In-Play eSports...")
        await page.evaluate("window.location.hash = '#/IP/B18'")
        await asyncio.sleep(8)

        print(f"  WebSockets: {ws_count}")
        print(f"  page_ids capturados: {captured_page_ids}")
        print(f"  sync_terms capturados: {len(captured_sync_terms)}")

        # === 4. BUSCA page_id EM TODAS AS FONTES ===
        print("\n  [4/6] Procurando page_id em TODAS as fontes JS...")

        page_id_search = await page.evaluate("""() => {
            const results = {};
            
            // 1. window properties
            const windowProps = ['__pageId', '_pid', 'pageId', 'PageId', 'PAGE_ID',
                'nPageIdentifier', 'websiteConfig', '_websiteConfig', 'appConfig'];
            for (const prop of windowProps) {
                if (window[prop] !== undefined) {
                    results['window.' + prop] = typeof window[prop] === 'object' 
                        ? JSON.stringify(window[prop]).substring(0, 200) 
                        : String(window[prop]);
                }
            }
            
            // 2. Meta tags
            const metas = document.querySelectorAll('meta');
            for (const m of metas) {
                const name = m.getAttribute('name') || m.getAttribute('property') || '';
                if (name && m.content) {
                    results['meta.' + name] = m.content.substring(0, 100);
                }
            }
            
            // 3. Scan for any large number that looks like page_id (19 digits)
            const scripts = document.querySelectorAll('script:not([src])');
            for (const s of scripts) {
                const text = s.textContent || '';
                const matches = text.match(/\\b(\\d{16,20})\\b/g);
                if (matches) {
                    results['inline_script_numbers'] = matches.slice(0, 5);
                }
            }
            
            // 4. data-* attributes on body/html
            for (const el of [document.documentElement, document.body]) {
                if (!el) continue;
                for (const attr of el.attributes) {
                    if (attr.name.startsWith('data-')) {
                        results['attr.' + attr.name] = attr.value.substring(0, 100);
                    }
                }
            }
            
            // 5. localStorage/sessionStorage keys with 'page' or 'pid' or 'id'
            for (const [storeName, store] of [['local', localStorage], ['session', sessionStorage]]) {
                for (let i = 0; i < store.length; i++) {
                    const key = store.key(i);
                    if (key.toLowerCase().includes('page') || key.toLowerCase().includes('pid') 
                        || key.toLowerCase().includes('identifier')) {
                        results[storeName + '.' + key] = store.getItem(key).substring(0, 200);
                    }
                }
            }

            // 6. Check performance entries for p= parameter
            const entries = performance.getEntriesByType('resource');
            const withP = [];
            for (const e of entries) {
                if (e.name.includes('?') && e.name.includes('p=')) {
                    try {
                        const u = new URL(e.name);
                        const pVal = u.searchParams.get('p');
                        if (pVal && pVal.length > 10) {
                            withP.push({url: e.name.substring(0, 120), p: pVal});
                        }
                    } catch {}
                }
            }
            if (withP.length > 0) {
                results['performance_entries_with_p'] = withP.slice(0, 5);
            }

            return results;
        }""")

        print(f"  page_id search results:")
        for k, v in page_id_search.items():
            print(f"    {k}: {v}")

        # === 5. ESPERA E COLETA SELEÇÕES ===
        print(f"\n  [5/6] Esperando fixtures (15s)...")
        await asyncio.sleep(15)
        print(f"  Selections: {len(selections)}")
        print(f"  BetsWebAPI requests capturados: {len(betswebapi_requests)}")
        print(f"  page_ids: {captured_page_ids}")

        # Use primeiro page_id capturado, se disponível
        final_page_id = ""
        if captured_page_ids:
            final_page_id = captured_page_ids[0]
            print(f"  Usando page_id de request capturado: {final_page_id}")
        elif tokens.page_id:
            final_page_id = tokens.page_id
            print(f"  Usando page_id do harvester: {final_page_id}")
        else:
            print(f"  ⚠️ NENHUM page_id encontrado!")

        # Use sync_term mais fresco
        final_sync = ""
        if captured_sync_terms:
            final_sync = captured_sync_terms[-1]
        elif tokens.x_net_sync_term:
            final_sync = tokens.x_net_sync_term

        if not selections:
            print("  FALHA: Nenhuma selection capturada")
            return

        # Pega primeira seleção
        target = None
        for s in selections:
            if s.get("handicap") and s.get("odds"):
                target = s
                break
        if not target:
            target = selections[0]

        print(f"\n  === SELEÇÃO ESCOLHIDA ===")
        print(f"  Fixture:   {target['fixture_id']}")
        print(f"  Selection: {target['selection_id']}")
        print(f"  Player:    {target.get('name', '?')}")
        print(f"  Odds:      {target['odds']}")
        print(f"  HC:        {target.get('handicap', 'N/A')}")

        # === 6. COMPARA PAYLOADS ===
        print(f"\n  [6/6] Comparando: nosso payload vs formato esperado...")
        print()

        # Rebuild tokens with captured page_id
        ck = await context.cookies("https://www.bet365.bet.br")
        ck_dict = {c["name"]: c["value"] for c in ck}

        our_tokens = SessionTokens(
            pstk=ck_dict.get("pstk", ""),
            gwt=ck_dict.get("gwt", ""),
            swt=ck_dict.get("swt", ""),
            aaat=ck_dict.get("aaat", ""),
            pers=ck_dict.get("pers", ""),
            aps03=ck_dict.get("aps03", ""),
            cf_bm=ck_dict.get("__cf_bm", ""),
            x_net_sync_term=final_sync,
            page_id=final_page_id,
        )

        # Build what WE would send
        import uuid as uuid_mod
        bet_guid = str(uuid_mod.uuid4())

        params: dict = {"betGuid": bet_guid}
        if our_tokens.page_id:
            params["p"] = our_tokens.page_id

        our_url = f"https://www.bet365.bet.br/BetsWebAPI/placebet?{urlencode(params, quote_via=quote)}"

        ns = _build_ns_payload(
            fixture_id=target["fixture_id"],
            selection_id=target["selection_id"],
            odds=target["odds"],
            stake=1.00,
            handicap=target.get("handicap", ""),
            market_type=11,
            classification=18,
        )

        our_body = urlencode({
            "ns": ns,
            "xb": "1",
            "aa": "null",
            "betsource": "FlashInPLay",
            "tagType": "WindowsDesktopBrowser",
            "bs": "99",
            "qb": "1",
        }, quote_via=quote)
        our_body = "&" + our_body

        our_headers = {
            "content-type": "application/x-www-form-urlencoded",
            "x-net-sync-term": final_sync[:50] + "..." if final_sync else "EMPTY",
            "x-request-id": str(uuid_mod.uuid4()),
        }

        our_cookies = our_tokens.to_cookie_dict()

        print("  --- O QUE NÓS ENVIAMOS ---")
        print(f"  URL: {our_url}")
        print(f"  Body: {our_body[:200]}")
        print(f"  Headers (relevantes): {json.dumps(our_headers, indent=2)[:300]}")
        print(f"  Cookies ({len(our_cookies)} cookies):")
        for k, v in sorted(our_cookies.items()):
            print(f"    {k}: {'OK (' + str(len(v)) + ' chars)' if v else 'EMPTY/MISSING'}")
        print()

        # Referência do PROTOCOLO (requests logadas)
        print("  --- REFERÊNCIA (logs reais) ---")
        print(f"  URL: https://www.bet365.bet.br/BetsWebAPI/placebet?betGuid=<UUID>&c=<challenge>&p=<page_id>")
        print(f"  Body: &ns=pt=N#o=4/5#pv=4/5#f=191755961#fp=901719780#so=#c=18#ln=+6.5#mt=11#|at=Y#TP=BS191755961-901719780#ust=1.00#st=1.00#tr=1.80#||&xb=1&aa=null&betsource=FlashInPLay&tagType=WindowsDesktopBrowser&bs=99&qb=1")
        print(f"  Cookies: pstk, gwt, swt, aaat, pers, __cf_bm + todos os outros")
        print()

        # Diferenças detectadas
        print("  === DIFERENÇAS DETECTADAS ===")
        diffs = []
        if not final_page_id:
            diffs.append("CRITICAL: page_id (param p) AUSENTE — todos os logs reais têm p=<number>")
        if not our_tokens.gwt:
            diffs.append("WARNING: gwt cookie AUSENTE — logs com bets aceitas tinham gwt")
        if not final_sync:
            diffs.append("CRITICAL: x-net-sync-term header VAZIO — sem ele a request é rejeitada")
        if not our_tokens.pstk:
            diffs.append("CRITICAL: pstk cookie AUSENTE — autenticação")

        # Verifica se nosso ns tem o formato correto
        logged_ns = "pt=N#o=4/5#pv=4/5#f=191755961#fp=901719780#so=#c=18#ln=+6.5#mt=11#|at=Y#TP=BS191755961-901719780#ust=1.00#st=1.00#tr=1.80#||"
        if "#|" in ns and "#||" in ns:
            print(f"  ns FORMAT: OK (tem #| e #||)")
        else:
            diffs.append(f"ns FORMAT: WRONG — ns={ns}")

        if diffs:
            for d in diffs:
                print(f"  ❌ {d}")
        else:
            print(f"  ✅ Nenhuma diferença óbvia encontrada")

        print()

        # Dump all API requests que tinham page_id
        if all_api_requests:
            print(f"  --- OUTROS ENDPOINTS COM p= ---")
            for rq in all_api_requests[:10]:
                if "p" in rq["params"]:
                    print(f"  {rq['path']} → p={rq['params']['p']}")
            print()

        # Summary
        print("  === SUMÁRIO ===")
        print(f"  page_id capturado:    {'SIM (' + final_page_id + ')' if final_page_id else 'NÃO'}")
        print(f"  sync_term capturado:  {'SIM (' + str(len(final_sync)) + ' chars)' if final_sync else 'NÃO'}")
        print(f"  gwt presente:         {'SIM' if our_tokens.gwt else 'NÃO'}")
        print(f"  BetsWebAPI requests:  {len(betswebapi_requests)}")
        print(f"  Selections:           {len(selections)}")
        print()

        # Save full diagnostics
        diag_file = Path(__file__).parent.parent / "tmp" / "diag_placebet_capture.json"
        diag_file.parent.mkdir(exist_ok=True)
        diag_data = {
            "timestamp": time.time(),
            "page_ids": captured_page_ids,
            "sync_terms_count": len(captured_sync_terms),
            "betswebapi_requests": betswebapi_requests,
            "page_id_search_js": page_id_search,
            "our_url": our_url,
            "our_body": our_body,
            "our_cookies": {k: str(len(v)) + " chars" for k, v in our_cookies.items()},
            "diffs": diffs,
            "all_api_with_p": [r for r in all_api_requests if "p" in r.get("params", {})],
        }
        diag_file.write_text(json.dumps(diag_data, indent=2, default=str), encoding="utf-8")
        print(f"  Diagnóstico salvo: {diag_file}")


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        print("\n  Ctrl+C")
