"""
Extrai o script[163] do bet365 e busca betRequestCorrelation.
O script anterior descobriu que c= vem de s.betRequestCorrelation.
Precisamos encontrar COMO esse valor é gerado.
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

from camoufox.async_api import AsyncCamoufox
from config.settings import get_settings


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
    print("  EXTRACT: betRequestCorrelation source code")
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

    async with AsyncCamoufox(**kw) as browser:
        ctx = browser.contexts[0] if browser.contexts else await browser.new_context()
        page = ctx.pages[0] if ctx.pages else await ctx.new_page()

        print("\n  [1] Login...")
        await page.goto("https://www.bet365.bet.br", timeout=30000)
        await asyncio.sleep(3)
        await auto_login(page, ctx)

        print("\n  [2] In-Play eSports...")
        await page.evaluate("window.location.hash = '#/IP/B18'")
        await asyncio.sleep(5)

        # Espera gwt
        for i in range(30):
            ck = await ctx.cookies("https://www.bet365.bet.br")
            if any(c["name"] == "gwt" for c in ck):
                print(f"  gwt OK ({i+1}s)")
                break
            await asyncio.sleep(1)

        # Extrai script[163] e scripts próximos (betslip-related)
        print("\n  [3] Extraindo scripts com betRequestCorrelation...")

        result = await page.evaluate("""() => {
            const scripts = document.querySelectorAll('script');
            const results = [];

            scripts.forEach((script, idx) => {
                const text = script.textContent || '';
                if (text.includes('betRequestCorrelation')) {
                    // Encontra TODAS as ocorrências
                    const matches = [];
                    let searchFrom = 0;
                    while (true) {
                        const pos = text.indexOf('betRequestCorrelation', searchFrom);
                        if (pos === -1) break;
                        const start = Math.max(0, pos - 300);
                        const end = Math.min(text.length, pos + 500);
                        matches.push({
                            pos: pos,
                            context: text.substring(start, end)
                        });
                        searchFrom = pos + 1;
                    }
                    results.push({
                        scriptIdx: idx,
                        src: script.src || '(inline)',
                        textLen: text.length,
                        matches: matches
                    });
                }
            });
            return results;
        }""")

        print(f"  Scripts com betRequestCorrelation: {len(result)}")
        for r in result:
            print(f"\n  === Script [{r['scriptIdx']}] (len={r['textLen']}) ===")
            print(f"  src: {r['src'][:100]}")
            for m in r["matches"]:
                print(f"\n  --- pos={m['pos']} ---")
                print(f"  {m['context']}")

        # Agora busca o que DEFINE betRequestCorrelation
        print("\n\n  [4] Buscando definição/atribuição de betRequestCorrelation...")
        definitions = await page.evaluate("""() => {
            const scripts = document.querySelectorAll('script');
            const results = [];
            const patterns = [
                'betRequestCorrelation',
                'participantCorrelation',
                'requestCorrelation',
                'BetRequestCorrelation',
            ];

            scripts.forEach((script, idx) => {
                const text = script.textContent || '';
                for (const pat of patterns) {
                    if (!text.includes(pat)) continue;
                    // Busca atribuições: X = ..., X: ...
                    const regex = new RegExp('(\\\\w+\\\\.)?' + pat + '\\\\s*[=:]\\\\s*[^,;\\\\n]{0,200}', 'g');
                    let match;
                    while ((match = regex.exec(text)) !== null) {
                        const start = Math.max(0, match.index - 150);
                        const end = Math.min(text.length, match.index + match[0].length + 150);
                        results.push({
                            scriptIdx: idx,
                            pattern: pat,
                            pos: match.index,
                            matchText: match[0],
                            context: text.substring(start, end)
                        });
                    }
                }
            });
            return results;
        }""")

        print(f"  Definições encontradas: {len(definitions)}")
        for d in definitions:
            print(f"\n  [{d['scriptIdx']}] {d['pattern']}  pos={d['pos']}")
            print(f"  match: {d['matchText'][:200]}")
            print(f"  ctx: {d['context'][:400]}")

        # Busca HMAC/crypto relacionado a betslip
        print("\n\n  [5] Buscando crypto/HMAC no contexto de betslip...")
        crypto_ctx = await page.evaluate("""() => {
            const scripts = document.querySelectorAll('script');
            const results = [];

            scripts.forEach((script, idx) => {
                const text = script.textContent || '';
                // Scripts que têm AMBOS: crypto/SHA-256 E betslip/placebet
                const hasCrypto = text.includes('crypto.subtle') || text.includes('SHA-256') || text.includes('SHA256');
                const hasBet = text.includes('placebet') || text.includes('PlaceBet') || text.includes('betslip') || text.includes('BetSlip');
                if (hasCrypto && hasBet) {
                    results.push({
                        scriptIdx: idx,
                        textLen: text.length,
                        src: script.src || '(inline)',
                        cryptoPositions: [],
                        betPositions: []
                    });
                    // Encontra todas as posições de crypto
                    let pos = 0;
                    while ((pos = text.indexOf('crypto.subtle', pos)) !== -1) {
                        const start = Math.max(0, pos - 100);
                        const end = Math.min(text.length, pos + 200);
                        results[results.length-1].cryptoPositions.push({
                            pos: pos,
                            context: text.substring(start, end)
                        });
                        pos++;
                    }
                }
            });
            return results;
        }""")

        print(f"  Scripts com crypto+bet: {len(crypto_ctx)}")
        for c in crypto_ctx:
            print(f"\n  [{c['scriptIdx']}] len={c['textLen']}")
            for cp in c["cryptoPositions"][:5]:
                print(f"    crypto pos={cp['pos']}: {cp['context'][:200]}")

        # EXTRA: Busca a fundo no script que define betRequestCorrelation
        print("\n\n  [6] Deep search: onde betRequestCorrelation é criado...")
        deep = await page.evaluate("""() => {
            const scripts = document.querySelectorAll('script');
            const results = [];
            // Termos que podem estar relacionados à geração do challenge
            const terms = [
                'generateCorrelation',
                'generateChallenge',
                'correlation',
                'newCorrelation',
                'getCorrelation',
                'createCorrelation',
                'betChallenge',
                'requestChallenge',
                'hashChallenge',
                'computeChallenge',
                'makeChallenge',
                'correlationId',
                'syncChallenge',
                'nextChallenge',
                'challengeToken',
                'generateToken',
                'randomBytes',
                'getRandomValues',
                'Uint8Array',
            ];

            scripts.forEach((script, idx) => {
                const text = script.textContent || '';
                if (!text.includes('betRequestCorrelation') && !text.includes('requestCorrelation')) return;

                for (const term of terms) {
                    if (!text.includes(term)) continue;
                    let pos = 0;
                    let found = 0;
                    while ((pos = text.indexOf(term, pos)) !== -1 && found < 3) {
                        const start = Math.max(0, pos - 150);
                        const end = Math.min(text.length, pos + 300);
                        results.push({
                            scriptIdx: idx,
                            term: term,
                            pos: pos,
                            context: text.substring(start, end)
                        });
                        pos++;
                        found++;
                    }
                }
            });
            return results;
        }""")

        print(f"  Deep search results: {len(deep)}")
        for d in deep:
            print(f"\n  [{d['scriptIdx']}] term='{d['term']}'  pos={d['pos']}")
            print(f"  {d['context'][:400]}")

        # Dump tudo em arquivo
        outfile = Path("tmp/betRequestCorrelation_analysis.json")
        outfile.parent.mkdir(exist_ok=True)
        dump = {
            "betRequestCorrelation_scripts": result,
            "definitions": definitions,
            "crypto_bet_scripts": crypto_ctx,
            "deep_search": deep,
        }
        outfile.write_text(json.dumps(dump, indent=2, ensure_ascii=False), encoding="utf-8")
        print(f"\n  Dump: {outfile}")

    print("=" * 70)


if __name__ == "__main__":
    asyncio.run(main())
