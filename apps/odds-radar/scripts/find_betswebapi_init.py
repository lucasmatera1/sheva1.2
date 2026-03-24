"""
Encontra TODOS os endpoints BetsWebAPI e descobre qual retorna bg/cc inicial.
Também busca onde o betslip document é inicializado.
"""
from __future__ import annotations
import asyncio
import json
import os
import random
import sys
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8", errors="replace")
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
os.chdir(Path(__file__).resolve().parent.parent)

from dotenv import load_dotenv
load_dotenv()

from camoufox.async_api import AsyncCamoufox


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
    return True


async def main():
    print()
    print("=" * 70)
    print("  TRACE: Todos os endpoints BetsWebAPI e origem de bg/cc")
    print("=" * 70)

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

    # Capture de TODOS os requests/responses para BetsWebAPI
    betswebapi_traffic = []

    async with AsyncCamoufox(**kw) as browser:
        ctx = browser.contexts[0] if browser.contexts else await browser.new_context()
        page = ctx.pages[0] if ctx.pages else await ctx.new_page()

        # Listener para capturar TODO tráfego BetsWebAPI
        async def on_response(response):
            url = response.url
            if "BetsWebAPI" in url or "betswebapi" in url.lower():
                try:
                    body = await response.text()
                except Exception:
                    body = "(erro ao ler body)"
                entry = {
                    "url": url,
                    "status": response.status,
                    "body": body[:2000],
                }
                betswebapi_traffic.append(entry)
                print(f"  [TRAFFIC] {response.status} {url[:120]}")
                if body and len(body) < 500:
                    print(f"  [BODY] {body[:300]}")

        page.on("response", on_response)

        print("\n  [1] Login...")
        await page.goto("https://www.bet365.bet.br", timeout=30000)
        await asyncio.sleep(3)
        await auto_login(page, ctx)

        print("\n  [2] In-Play eSports...")
        await page.evaluate("window.location.hash = '#/IP/B18'")
        await asyncio.sleep(5)

        for i in range(30):
            ck = await ctx.cookies("https://www.bet365.bet.br")
            if any(c["name"] == "gwt" for c in ck):
                print(f"  gwt OK ({i+1}s)")
                break
            await asyncio.sleep(1)

        # Buscar TODOS os endpoints no JS
        print("\n  [3] Endpoints BetsWebAPI no JS...")
        endpoints = await page.evaluate("""() => {
            const scripts = document.querySelectorAll('script');
            const results = new Set();

            scripts.forEach((script) => {
                const text = script.textContent || '';
                // Busca strings que parecem endpoints: "placebet", "referbet", etc depois de GetApiEndpoint
                const pats = [
                    /GetApiEndpoint\\(["']([^"']+)["']\\)/g,
                    /BetsWebAPI\\/([a-zA-Z]+)/g,
                    /betswebapi\\/([a-zA-Z]+)/gi,
                ];
                pats.forEach(pat => {
                    pat.lastIndex = 0;
                    let match;
                    while ((match = pat.exec(text)) !== null) {
                        results.add(match[1].toLowerCase());
                    }
                });
            });
            return [...results].sort();
        }""")

        print(f"  Endpoints encontrados: {len(endpoints)}")
        for ep in endpoints:
            print(f"    /BetsWebAPI/{ep}")

        # Busca merge() no document betslip — quem popula bg/cc ANTES do placebet
        print("\n  [4] Buscando merge() no betslip que popula bg/cc...")
        merges = await page.evaluate("""() => {
            const scripts = document.querySelectorAll('script');
            const results = [];

            scripts.forEach((script, idx) => {
                const text = script.textContent || '';
                if (!text.includes('betRequestCorrelation') && !text.includes('.merge(')) return;

                // Busca TODOS os .merge( no script betslip
                const pat = /\\.merge\\(/g;
                let match;
                let count = 0;
                while ((match = pat.exec(text)) !== null && count < 20) {
                    const start = Math.max(0, match.index - 200);
                    const end = Math.min(text.length, match.index + 300);
                    results.push({
                        scriptIdx: idx,
                        pos: match.index,
                        context: text.substring(start, end)
                    });
                    count++;
                }
            });
            return results;
        }""")

        print(f"  merge() calls no betslip: {len(merges)}")
        for m in merges[:15]:
            print(f"\n  [{m['scriptIdx']}] pos={m['pos']}")
            print(f"  {m['context'][:500]}")

        # Busca addselection/addbet/initialise no betslip
        print("\n\n  [5] Buscando addselection/addbet/initialise...")
        add = await page.evaluate("""() => {
            const scripts = document.querySelectorAll('script');
            const results = [];
            const searchTerms = [
                'addSelection', 'addBet', 'addToBetslip', 
                'initialise', 'initialize', 'initBetslip',
                'AddSelection', 'AddBet', 'restoreSession',
                'restoreFromStorage', 'loadFromStorage',
                'deserialise', 'deserialize',
                'sessionRestore', 'restoreBetslip',
            ];

            scripts.forEach((script, idx) => {
                const text = script.textContent || '';
                if (!text.includes('betRequestCorrelation') && 
                    !text.includes('BetsWebAPI') &&
                    text.length < 10000) return;

                for (const term of searchTerms) {
                    if (!text.includes(term)) continue;
                    let pos = 0;
                    let count = 0;
                    while ((pos = text.indexOf(term, pos)) !== -1 && count < 3) {
                        const start = Math.max(0, pos - 150);
                        const end = Math.min(text.length, pos + 300);
                        results.push({
                            scriptIdx: idx,
                            term: term,
                            pos: pos,
                            context: text.substring(start, end)
                        });
                        pos++;
                        count++;
                    }
                }
            });
            return results;
        }""")

        print(f"  Resultados: {len(add)}")
        # Filtra apenas os mais relevantes
        seen = set()
        for a in add:
            key = f"{a['scriptIdx']}:{a['term']}:{a['pos']}"
            if key in seen:
                continue
            seen.add(key)
            if a['term'] in ('addSelection', 'AddSelection', 'addBet', 'AddBet', 
                           'addToBetslip', 'restoreFromStorage', 'loadFromStorage',
                           'deserialise', 'restoreSession'):
                print(f"\n  [{a['scriptIdx']}] '{a['term']}'  pos={a['pos']}")
                print(f"  {a['context'][:400]}")

        # Agora tenta clicar em uma odds cell usando page.mouse.click
        # (evita o overlay problem) e captura o tráfego BetsWebAPI
        print("\n\n  [6] Tentando adicionar selection via click...")
        
        # Primeiro, fecha modal se existir 
        await page.evaluate("""() => {
            const darks = document.querySelectorAll('.wcl-ModalManager_DarkWash, .wcl-CommonElementStyle_OverlayContainer');
            darks.forEach(d => d.remove());
        }""")
        await asyncio.sleep(0.5)

        # Busca odds cells com coordenadas
        odds_info = await page.evaluate("""() => {
            const cells = document.querySelectorAll('.ovm-ParticipantOddsOnly_Odds');
            const result = [];
            for (const cell of cells) {
                const rect = cell.getBoundingClientRect();
                const text = cell.textContent?.trim();
                if (text && /^\\d/.test(text) && rect.width > 10 && rect.height > 10 &&
                    rect.top > 0 && rect.top < window.innerHeight) {
                    result.push({
                        text: text,
                        x: rect.x + rect.width / 2,
                        y: rect.y + rect.height / 2,
                        w: rect.width,
                        h: rect.height
                    });
                }
            }
            return result;
        }""")

        print(f"  Odds cells visíveis: {len(odds_info)}")
        if odds_info:
            for o in odds_info[:5]:
                print(f"    {o['text']} at ({o['x']:.0f}, {o['y']:.0f})")

            # Clica na primeira odds cell usando mouse.click direto
            target = odds_info[0]
            print(f"\n  Clicando em odds: {target['text']} at ({target['x']:.0f}, {target['y']:.0f})")
            before_count = len(betswebapi_traffic)
            await page.mouse.click(target["x"], target["y"])
            await asyncio.sleep(5)
            after_count = len(betswebapi_traffic)
            
            if after_count > before_count:
                print(f"\n  >>> NOVOS BetsWebAPI requests após click: {after_count - before_count} <<<")
                for entry in betswebapi_traffic[before_count:]:
                    print(f"  {entry['url'][:150]}")
                    print(f"  status={entry['status']}")
                    print(f"  body: {entry['body'][:500]}")
            else:
                print("  Nenhum BetsWebAPI request após click")

            # Verifica se betslip abriu e tem bg/cc
            print("\n  Verificando betslip document state...")
            doc_state = await page.evaluate("""() => {
                // Verifica sessionStorage
                const betstring = sessionStorage.getItem('betstring') || '';
                // Verifica se algum global betslip model tem bg/cc
                const result = {
                    betstring: betstring.substring(0, 500),
                };
                return result;
            }""")
            print(f"  betstring: {doc_state.get('betstring', '')}")

            # Tenta segundo click se não gerou tráfego
            if after_count == before_count and len(odds_info) > 1:
                target2 = odds_info[1]
                print(f"\n  Tentando 2o click: {target2['text']} at ({target2['x']:.0f}, {target2['y']:.0f})")
                await page.mouse.click(target2["x"], target2["y"])
                await asyncio.sleep(5)
                if len(betswebapi_traffic) > after_count:
                    print(f"\n  >>> NOVOS requests: {len(betswebapi_traffic) - after_count} <<<")
                    for entry in betswebapi_traffic[after_count:]:
                        print(f"  {entry['url'][:150]}")
                        print(f"  body: {entry['body'][:500]}")

        # Status final
        print(f"\n\n  === RESUMO ===")
        print(f"  Total BetsWebAPI traffic capturado: {len(betswebapi_traffic)}")
        for t in betswebapi_traffic:
            print(f"  {t['status']} {t['url'][:120]}")
            if '"bg"' in t.get('body', '') or '"cc"' in t.get('body', ''):
                print(f"    >>> CONTÉM bg/cc! <<<")
                print(f"    {t['body'][:500]}")

        # Dump
        outfile = Path("tmp/betswebapi_traffic.json")
        outfile.parent.mkdir(exist_ok=True)
        outfile.write_text(json.dumps({
            "endpoints_in_js": endpoints,
            "betswebapi_traffic": betswebapi_traffic,
            "merges_count": len(merges),
        }, indent=2, ensure_ascii=False), encoding="utf-8")
        print(f"\n  Dump: {outfile}")

    print("=" * 70)


if __name__ == "__main__":
    asyncio.run(main())
