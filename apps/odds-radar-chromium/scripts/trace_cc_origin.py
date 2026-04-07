"""
Busca a origem do PRIMEIRO 'cc' no documento betslip.
Sabemos que betRequestCorrelation = encodeURIComponent(this.document.get("cc"))
Precisamos encontrar onde 'cc' é populado pela primeira vez.
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

from playwright.async_api import async_playwright


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
    print("  TRACE: Origem do primeiro 'cc' no betslip document")
    print("=" * 70)

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

        # Busca no script[173] (betslip): onde "cc" é SET no document
        print("\n  [3] Buscando onde 'cc' é definido no betslip document...")

        # Estratégia 1: Busca .set("cc", ou document.set("cc" ou ["cc"]= ou .cc =
        result1 = await page.evaluate("""() => {
            const scripts = document.querySelectorAll('script');
            const results = [];

            scripts.forEach((script, idx) => {
                const text = script.textContent || '';
                if (text.length < 1000) return;

                // Padrões de atribuição de cc no document
                const patterns = [
                    /\\.set\\s*\\("cc"[^)]{0,100}\\)/g,
                    /\\.set\\s*\\('cc'[^)]{0,100}\\)/g,
                    /\\["cc"\\]\\s*=/g,
                    /\\['cc'\\]\\s*=/g,
                    /\\.cc\\s*=\\s*[^;]{0,100}/g,
                    /merge\\([^)]*cc[^)]*\\)/g,
                ];

                patterns.forEach(pat => {
                    pat.lastIndex = 0;
                    let match;
                    let count = 0;
                    while ((match = pat.exec(text)) !== null && count < 5) {
                        const start = Math.max(0, match.index - 200);
                        const end = Math.min(text.length, match.index + match[0].length + 200);
                        results.push({
                            scriptIdx: idx,
                            pattern: pat.source,
                            pos: match.index,
                            matchText: match[0].substring(0, 150),
                            context: text.substring(start, end)
                        });
                        count++;
                    }
                });
            });
            return results;
        }""")

        print(f"  Resultados set('cc'): {len(result1)}")
        for r in result1:
            print(f"\n  [{r['scriptIdx']}] pat={r['pattern'][:40]}  pos={r['pos']}")
            print(f"  match: {r['matchText'][:200]}")
            print(f"  ctx: {r['context'][:500]}")

        # Estratégia 2: Busca por "initialise" ou "init" ou "loadBetslip" com cc
        print("\n\n  [4] Buscando init/load do betslip com cc...")
        result2 = await page.evaluate("""() => {
            const scripts = document.querySelectorAll('script');
            const results = [];

            scripts.forEach((script, idx) => {
                const text = script.textContent || '';
                if (!text.includes('betRequestCorrelation') && !text.includes('"cc"')) return;

                // Busca init/load/create com cc próximo
                const initPats = [
                    /(?:init|load|create|setup|bootstrap|start|begin|open)(?:ialis|ialize)?[^{]{0,200}"cc"/gi,
                    /"cc"[^}]{0,200}(?:init|load|create|setup)/gi,
                    /document\\.merge\\([^)]{0,500}\\)/g,
                    /document\\.set\\(/g,
                    /\\.merge\\({[^}]{0,500}"cc"/g,
                ];

                initPats.forEach(pat => {
                    pat.lastIndex = 0;
                    let match;
                    while ((match = pat.exec(text)) !== null) {
                        const start = Math.max(0, match.index - 150);
                        const end = Math.min(text.length, match.index + match[0].length + 200);
                        results.push({
                            scriptIdx: idx,
                            pattern: pat.source,
                            pos: match.index,
                            matchText: match[0].substring(0, 200),
                            context: text.substring(start, end)
                        });
                        break;  // 1 per pattern
                    }
                });
            });
            return results;
        }""")

        print(f"  Resultados init/cc: {len(result2)}")
        for r in result2:
            print(f"\n  [{r['scriptIdx']}] pat={r['pattern'][:40]}  pos={r['pos']}")
            print(f"  match: {r['matchText'][:300]}")
            print(f"  ctx: {r['context'][:600]}")

        # Estratégia 3: Busca "cc" no betslip script - AMPLA
        print("\n\n  [5] Todas as ocorrências de 'cc' relevantes no script betslip...")
        result3 = await page.evaluate("""() => {
            const scripts = document.querySelectorAll('script');
            let betslipScript = '';
            let betslipIdx = -1;

            scripts.forEach((script, idx) => {
                const text = script.textContent || '';
                if (text.includes('betRequestCorrelation') && text.length > 50000) {
                    betslipScript = text;
                    betslipIdx = idx;
                }
            });

            if (!betslipScript) return {found: false};

            // Busca TODAS as ocorrências de "cc" ou 'cc' como key/property
            const results = [];
            const patterns = [
                // .get("cc")
                /\\.get\\(["']cc["']\\)/g,
                // "cc": ou "cc",
                /"cc"\\s*[,:]/g,
                // set("cc" ou merge com cc
                /set\\(["']cc["']/g,
                // response cc parsing
                /\\.cc\\b/g,
            ];

            for (const pat of patterns) {
                pat.lastIndex = 0;
                let match;
                let count = 0;
                while ((match = pat.exec(betslipScript)) !== null && count < 10) {
                    const start = Math.max(0, match.index - 200);
                    const end = Math.min(betslipScript.length, match.index + match[0].length + 200);
                    results.push({
                        pattern: pat.source,
                        pos: match.index,
                        matchText: match[0],
                        context: betslipScript.substring(start, end)
                    });
                    count++;
                }
            }

            return {
                found: true,
                scriptIdx: betslipIdx,
                scriptLen: betslipScript.length,
                matches: results
            };
        }""")

        if result3.get("found"):
            print(f"  Script betslip [{result3['scriptIdx']}] len={result3['scriptLen']}")
            for m in result3.get("matches", []):
                print(f"\n  pat={m['pattern'][:30]}  pos={m['pos']}  match='{m['matchText']}'")
                print(f"  {m['context'][:500]}")
        else:
            print("  Script betslip nao encontrado!")

        # Estratégia 4: Busca onde 'bg' e 'cc' aparecem juntos (resposta PlaceBet parseada)
        print("\n\n  [6] Buscando 'bg' + 'cc' juntos (parse da resposta PlaceBet)...")
        result4 = await page.evaluate("""() => {
            const scripts = document.querySelectorAll('script');
            const results = [];

            scripts.forEach((script, idx) => {
                const text = script.textContent || '';
                if (text.length < 1000) return;

                // Busca contextos onde bg e cc aparecem próximos (dentro de 300 chars)
                let pos = 0;
                while ((pos = text.indexOf('"bg"', pos)) !== -1) {
                    const region = text.substring(Math.max(0, pos - 200), Math.min(text.length, pos + 500));
                    if (region.includes('"cc"')) {
                        results.push({
                            scriptIdx: idx,
                            pos: pos,
                            context: region
                        });
                    }
                    pos++;
                    if (results.length > 10) break;
                }
            });
            return results;
        }""")

        print(f"  'bg'+'cc' juntos: {len(result4)}")
        for r in result4:
            print(f"\n  [{r['scriptIdx']}] pos={r['pos']}")
            print(f"  {r['context'][:600]}")

        # Estratégia 5: Busca o betslipinit/initialise endpoint que retorna cc
        print("\n\n  [7] Buscando endpoints que retornam cc (init betslip)...")
        result5 = await page.evaluate("""() => {
            const scripts = document.querySelectorAll('script');
            const results = [];

            scripts.forEach((script, idx) => {
                const text = script.textContent || '';
                if (text.length < 1000) return;

                // Endpoints: initialisebet, initbet, betslipinit, etc.
                const pats = [
                    /initialise(?:bet|slip|bets)/gi,
                    /initbet/gi,
                    /betslipinit/gi,
                    /GetApiEndpoint/gi,
                    /BetsWebApi/gi,
                ];

                let found = false;
                pats.forEach(pat => {
                    if (found) return;
                    pat.lastIndex = 0;
                    let match;
                    while ((match = pat.exec(text)) !== null) {
                        const start = Math.max(0, match.index - 100);
                        const end = Math.min(text.length, match.index + match[0].length + 200);
                        const ctx = text.substring(start, end);
                        results.push({
                            scriptIdx: idx,
                            pattern: pat.source,
                            pos: match.index,
                            context: ctx
                        });
                        if (results.length > 20) { found = true; break; }
                    }
                });
            });
            return results.slice(0, 20);
        }""")

        print(f"  Endpoint results: {len(result5)}")
        for r in result5:
            print(f"\n  [{r['scriptIdx']}] {r['pattern']}  pos={r['pos']}")
            print(f"  {r['context'][:300]}")

        # Estratégia 6: Lê sessionStorage betstring
        print("\n\n  [8] sessionStorage e betslip state...")
        storage = await page.evaluate("""() => {
            const result = {};
            // sessionStorage
            for (let i = 0; i < sessionStorage.length; i++) {
                const key = sessionStorage.key(i);
                const val = sessionStorage.getItem(key);
                if (key.toLowerCase().includes('bet') || key.toLowerCase().includes('slip') ||
                    key.toLowerCase().includes('cc') || key.toLowerCase().includes('correlation') ||
                    key.toLowerCase().includes('bg') || key.toLowerCase().includes('guid') ||
                    val.includes('cc') || val.includes('bg')) {
                    result[key] = val.substring(0, 500);
                }
            }
            // localStorage
            for (let i = 0; i < localStorage.length; i++) {
                const key = localStorage.key(i);
                const val = localStorage.getItem(key);
                if (key.toLowerCase().includes('bet') || key.toLowerCase().includes('slip') ||
                    key.toLowerCase().includes('cc') || key.toLowerCase().includes('correlation')) {
                    result['LS:' + key] = val.substring(0, 500);
                }
            }
            return result;
        }""")

        print(f"  Storage keys with bet/cc/bg: {len(storage)}")
        for k, v in storage.items():
            print(f"  {k}: {v[:300]}")

        # Dump
        outfile = Path("tmp/cc_origin_analysis.json")
        outfile.parent.mkdir(exist_ok=True)
        dump = {
            "set_cc": result1,
            "init_cc": result2,
            "all_cc_in_betslip": result3,
            "bg_cc_together": result4,
            "endpoints": result5,
            "storage": storage,
        }
        outfile.write_text(json.dumps(dump, indent=2, ensure_ascii=False), encoding="utf-8")
        print(f"\n  Dump: {outfile}")

    finally:
        await context.close()
        await pw.stop()

    print("=" * 70)


if __name__ == "__main__":
    asyncio.run(main())
