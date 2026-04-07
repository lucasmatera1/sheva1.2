"""
Test Multi-Bet — Testa múltiplas apostas sequenciais para detectar bloqueio.

Abre 1 browser, faz login, e coloca N apostas em fixtures DIFERENTES
com delay entre cada uma. Reporta sr/cs de cada.

Uso:
    python scripts/test_multi_bet.py                   # 3 apostas, 5s delay
    python scripts/test_multi_bet.py --count 5         # 5 apostas
    python scripts/test_multi_bet.py --delay 10        # 10s entre apostas
    python scripts/test_multi_bet.py --stake 0.50      # R$0.50 cada
    python scripts/test_multi_bet.py --dry-run         # só seleciona, não aposta
"""

from __future__ import annotations

import asyncio
import os
import random
import sys
import time
from pathlib import Path

if sys.platform == "win32":
    os.environ.setdefault("PYTHONIOENCODING", "utf-8")
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    if hasattr(sys.stderr, "reconfigure"):
        sys.stderr.reconfigure(encoding="utf-8", errors="replace")

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import argparse

from loguru import logger
from src.api.token_harvester import TokenHarvester
from src.api.ws_parser import Bet365WsParser
from src.betting.ui_placer import UIBetPlacer
from src.browser.engine import BrowserEngine
from src.browser.session import load_cookies, save_cookies

BET365_URL = "https://www.bet365.bet.br"


def parse_args():
    p = argparse.ArgumentParser(description="Test multi-bet sequential")
    p.add_argument("--count", type=int, default=3, help="Número de apostas (default: 3)")
    p.add_argument("--delay", type=float, default=5.0, help="Segundos entre apostas (default: 5)")
    p.add_argument("--stake", type=float, default=1.0, help="Stake por aposta em R$ (default: 1.0)")
    p.add_argument("--dry-run", action="store_true", help="Seleciona fixtures mas não aposta")
    return p.parse_args()


async def auto_login(page, context) -> bool:
    """Login automático usando credenciais do .env."""
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
            'input[type="text"], input[name="username"]',
            timeout=15_000, state="visible",
        )
    except Exception:
        pass

    user_input = page.locator('input[type="text"]').first
    pass_input = page.locator('input[type="password"]').first
    await user_input.fill(bet_user)
    await asyncio.sleep(0.3)
    await pass_input.fill(bet_pass)
    await asyncio.sleep(0.3)
    await page.keyboard.press("Enter")
    await asyncio.sleep(5)

    for _ in range(3):
        ck = await context.cookies("https://www.bet365.bet.br")
        if any(c["name"] == "pstk" for c in ck):
            # NÃO fechar modal "Continuar" aqui — GeoComply pode precisar
            # dele para completar a geração do gwt. O dismiss será feito
            # APÓS o gwt aparecer, na fase de setup.
            return True
        await asyncio.sleep(3)
    return False


async def _dismiss_post_login_modal(page, max_attempts: int = 5) -> None:
    """Fecha o modal 'Seu último login' / 'Continuar' que aparece após login.

    Usa Playwright locator (get_by_text) + CDP mouse.click.
    Filtra apenas elementos visíveis na viewport (y < 1100).
    """
    for attempt in range(max_attempts):
        try:
            loc = page.get_by_text("Continuar")
            count = await loc.count()
            if count == 0:
                loc = page.get_by_text("Continue")
                count = await loc.count()
            if count == 0:
                if attempt == 0:
                    await asyncio.sleep(1)
                    continue
                break
            # Encontra o elemento correto (dentro da viewport)
            clicked = False
            for idx in range(min(count, 5)):
                try:
                    box = await loc.nth(idx).bounding_box()
                    if (box and box["width"] > 30 and box["height"] > 15
                            and box["y"] > 0 and box["y"] < 1100):
                        cx = box["x"] + box["width"] / 2
                        cy = box["y"] + box["height"] / 2
                        await page.mouse.click(cx, cy)
                        logger.info("Modal pós-login fechado: 'Continuar' em ({:.0f}, {:.0f}) tentativa {}",
                                    cx, cy, attempt + 1)
                        await asyncio.sleep(0.5)
                        clicked = True
                        break
                except Exception:
                    continue
            if not clicked:
                if attempt == 0:
                    await asyncio.sleep(1)
                else:
                    break
        except Exception:
            if attempt == 0:
                await asyncio.sleep(1)
            else:
                break


async def main():
    args = parse_args()
    mode = "DRY-RUN" if args.dry_run else f"LIVE ({args.count}x R${args.stake:.2f}, {args.delay}s delay)"

    print()
    print("=" * 64)
    print("  TEST MULTI-BET")
    print(f"  Mode: {mode}")
    print("=" * 64)
    print()

    engine = BrowserEngine()
    harvester = TokenHarvester(refresh_interval=120)
    parser = Bet365WsParser()

    # Coletar seleções do WS
    selections: list[dict] = []
    ws_count = 0

    async with engine.launch() as context:
        page = await engine.new_page(context)
        page.set_default_timeout(30_000)

        # ── Spectator: screenshot loop em background ──────────
        spectator_path = Path(__file__).resolve().parent.parent / "tmp" / "spectator_live.png"
        spectator_path.parent.mkdir(parents=True, exist_ok=True)
        _spectator_running = True

        async def _spectator_loop():
            while _spectator_running:
                try:
                    await page.screenshot(path=str(spectator_path), full_page=True)
                except Exception:
                    pass
                await asyncio.sleep(0.3)

        spectator_task = asyncio.create_task(_spectator_loop())

        # ── 1. Login (com sessão persistente) ─────────────────
        print("  [1/4] Verificando sessão...")

        # Carrega cookies salvos de sessão anterior
        cookies_loaded = await load_cookies(context)
        if cookies_loaded:
            print("  Cookies carregados de sessão anterior")

        # WS listener ANTES do goto (captura WS que abrem no page load)
        def _on_ws(ws):
            nonlocal ws_count
            ws_count += 1
            logger.info("WS #{} aberto: {}", ws_count, ws.url[:60])

            def _on_frame(payload):
                if isinstance(payload, bytes):
                    return
                parsed = parser.parse_odds_update(payload)
                if parsed:
                    for p in parsed:
                        if p.get("name") and p.get("handicap") and p.get("odds"):
                            selections.append(p)

            ws.on("framereceived", lambda data: _on_frame(data))

        page.on("websocket", _on_ws)

        await page.goto(BET365_URL, wait_until="domcontentloaded", timeout=30000)
        await asyncio.sleep(3)

        # Sync term passivo (precisa da página carregada)
        harvester.start_sync_term_listener(page)

        # ── Check sessão: cookie pstk + DOM ───────────────────
        # pstk = cookie de sessão do Bet365 (presente quando logado)
        has_pstk = any(
            c["name"] == "pstk"
            for c in await context.cookies("https://www.bet365.bet.br")
        )

        # Espera o header carregar (até 8s) e verifica botão Login vs Minhas Apostas
        session_active = False
        if has_pstk:
            for _ in range(16):
                dom_check = await page.evaluate("""() => {
                    const btns = [...document.querySelectorAll('button')];
                    const hasLogin = btns.some(b => b.textContent.trim() === 'Login');
                    const hasMyBets = btns.some(b => {
                        const t = b.textContent.trim();
                        return t.includes('Minhas Apostas') || t.includes('My Bets');
                    });
                    // Verifica saldo (R$ no header = logado)
                    const balEl = document.querySelector('.hm-Balance, [class*="Balance"]');
                    const hasBal = balEl && balEl.textContent.trim().length > 0;
                    return { hasLogin, hasMyBets, hasBal, btnCount: btns.length };
                }""")
                logger.debug("Session check: {}", dom_check)

                if dom_check["hasMyBets"] or dom_check["hasBal"]:
                    session_active = True
                    break
                if dom_check["hasLogin"] and dom_check["btnCount"] > 2:
                    # Página carregou e mostra botão Login → sessão expirou
                    break
                await asyncio.sleep(0.5)

        if session_active:
            print("  ✅ Sessão ativa — login pulado!")
            logged = True
        else:
            if has_pstk:
                print("  Cookies presentes mas sessão expirou — fazendo login...")
            else:
                print("  Sem sessão salva — fazendo login...")
            logged = await auto_login(page, context)
            if logged:
                await save_cookies(context)
                print("  ✅ Login OK! (cookies salvos)")
            else:
                print("  ❌ Login falhou")
                return

        # ── 2. Navega e espera fixtures ───────────────────────
        print("  [2/4] Navegando para In-Play eSports...")
        await page.evaluate("window.location.hash = '#/IP/B18'")
        await asyncio.sleep(3)

        # NÃO dismiss o modal "Continuar" antes do gwt —
        # GeoComply pode precisar do contexto de página intacto para gerar gwt
        # MAS: clicar "Continuar" pode ajudar a página a carregar completamente
        ui_pre = UIBetPlacer(page)
        await asyncio.sleep(1)
        await ui_pre.dismiss_overlays()

        # Verifica geolocalização antes de esperar gwt
        geo_ok = await engine.check_geolocation(page)
        if geo_ok:
            print(f"  Geolocalização: OK (lat={geo_ok['latitude']:.4f})")
        else:
            print("  ⚠️ Geolocalização FALHOU — gwt pode não aparecer")

        # Espera gwt (pode demorar até 60s)
        tokens = await harvester.extract_from_page(page)
        if not tokens.gwt:
            print("  [*] Esperando gwt (até 60s)...")
            for i in range(60):
                await asyncio.sleep(1)
                all_ck = await context.cookies()
                if any(c["name"] == "gwt" for c in all_ck):
                    tokens = await harvester.extract_from_page(page)
                    print(f"  gwt OK após {i + 1}s")
                    break
                if (i + 1) % 10 == 0:
                    # Interagir com a página para triggar GeoComply
                    # Scroll + click em área neutra + re-navegação
                    await page.mouse.move(400, 300)
                    await page.mouse.wheel(0, 100)
                    await asyncio.sleep(0.5)
                if (i + 1) % 20 == 0:
                    # Re-navegar pode triggar GeoComply
                    await page.evaluate("window.location.hash = '#/IP'")
                    await asyncio.sleep(1.5)
                    await page.evaluate("window.location.hash = '#/IP/B18'")
                    await asyncio.sleep(2)
                    print(f"  ... {i + 1}s — re-navegando para triggar GeoComply...")

        print(f"  gwt: {'OK' if tokens.gwt else 'AUSENTE'}  pstk: {'OK' if tokens.pstk else 'AUSENTE'}")

        if not tokens.gwt:
            print("  ⚠️ gwt AUSENTE — apostas provavelmente serão rejeitadas (sr=118)")
            print("  Continuando mesmo assim para diagnóstico...")

        # AGORA dismiss modal "Continuar" — APÓS gwt ter sido gerado
        ui_pre = UIBetPlacer(page)
        dismissed_count = await ui_pre.dismiss_overlays()
        if dismissed_count:
            print(f"  Modal/overlay removido: {dismissed_count} overlays")

        # Espera selections
        print("  [3/4] Coletando fixtures (10s)...")
        await asyncio.sleep(10)
        print(f"  Selections capturadas: {len(selections)}")

        if not selections:
            print("  ❌ Nenhuma selection capturada")
            return

        # ── 3. Seleciona N fixtures DIFERENTES ────────────────
        # Agrupa por fixture_id para pegar jogos diferentes
        by_fixture: dict[str, list[dict]] = {}
        for s in selections:
            fid = s["fixture_id"]
            if fid not in by_fixture:
                by_fixture[fid] = []
            by_fixture[fid].append(s)

        # Pega fixtures únicos com HC
        unique_fixtures = list(by_fixture.keys())
        random.shuffle(unique_fixtures)

        targets: list[dict] = []
        seen_fixtures: set[str] = set()
        for fid in unique_fixtures:
            if len(targets) >= args.count:
                break
            # Pega uma seleção HC deste fixture
            for s in by_fixture[fid]:
                if s.get("handicap") and fid not in seen_fixtures:
                    targets.append(s)
                    seen_fixtures.add(fid)
                    break

        if len(targets) < args.count:
            # Se não tem fixtures suficientes, usa linhas diferentes do mesmo fixture
            for fid in unique_fixtures:
                if len(targets) >= args.count:
                    break
                for s in by_fixture[fid]:
                    if s not in targets and len(targets) < args.count:
                        targets.append(s)

        print()
        print(f"  === {len(targets)} SELEÇÕES PARA TESTE ===")
        for i, t in enumerate(targets, 1):
            print(f"  [{i}] Fixture={t['fixture_id']}  {t.get('name', '?')[:25]:<25}  HC={t['handicap']}  Odds={t['odds']}")
        print()

        if args.dry_run:
            print("  [DRY-RUN] Seleções acima seriam apostadas. Saindo.")
            return

        # ── 4. Aposta sequencial (sem navegação — usa odds visíveis) ──
        # Garante que estamos na listagem de eSports com odds visíveis
        await page.evaluate("window.location.hash = '#/IP/B18'")
        await asyncio.sleep(2)
        await ui_pre.dismiss_overlays()

        print(f"  [4/4] Apostando em {args.count} odds diferentes...")
        print()

        ui = UIBetPlacer(page)

        # ── Warm-up: preenche stake e marca "Lembrar" ─────────
        print("  [WARM-UP] Preparando stake com 'Lembrar'...")
        warmup_ok = await ui.warm_up_stake(args.stake)
        if warmup_ok:
            print(f"  ✅ Warm-up OK — stake R${args.stake:.2f} será lembrado")
        else:
            print(f"  ⚠️ Warm-up: 'Lembrar' não ativado — stake será preenchido manualmente")
        print()

        if args.dry_run:
            await ui.dismiss_overlays()
            all_cells = await ui.find_all_visible_odds()
            print(f"  [DRY-RUN] {len(all_cells)} odds visíveis. Saindo.")
            for j, c in enumerate(all_cells[:args.count], 1):
                print(f"    [{j}] {c['text'][:12]}  at ({c['x']:.0f}, {c['y']:.0f})  {c.get('className','')[:40]}")
            return

        results = []
        used_coords: list[tuple[int, int]] = []  # Evita clicar perto da mesma cell
        t_start_all = time.time()

        for i in range(1, args.count + 1):
            t_start = time.time()

            # Sempre limpa overlays e betslip antes de cada aposta (fluxo 1-por-1)
            await ui.dismiss_overlays()
            await ui.clean_betslip()
            await ui.dismiss_overlays()

            # Busca cells FRESCAS (layout muda após cada aposta/navegação)
            fresh_cells = []
            for attempt in range(3):
                fresh_cells = await ui.find_all_visible_odds()
                if fresh_cells:
                    break
                await asyncio.sleep(1)
                if attempt == 1:
                    await page.evaluate("window.location.hash = '#/IP/B18'")
                    await asyncio.sleep(2)
                    await ui.dismiss_overlays()
            cell = None
            for c in fresh_cells:
                cx, cy = int(c['x']), int(c['y'])
                # Matching aproximado (±50px) — evita mesma odds após hard reset
                too_close = any(abs(cx - ux) < 50 and abs(cy - uy) < 50
                                for ux, uy in used_coords)
                if not too_close:
                    cell = c
                    used_coords.append((cx, cy))
                    break

            if not cell:
                print(f"  ── Aposta {i}/{args.count} ──────────────────────────")
                print(f"  ❌ Sem odds cells novas disponíveis ({len(fresh_cells)} total, {len(used_coords)} usadas)")
                results.append({
                    "i": i, "sr": -1, "cs": -1, "receipt": "",
                    "odds": "", "error": "no fresh cells",
                    "time": time.time() - t_start,
                })
                continue

            print(f"  ── Aposta {i}/{args.count} ──────────────────────────")
            print(f"  Odds:  {cell['text'][:15]}  at ({cell['x']:.0f}, {cell['y']:.0f})")
            print(f"  Stake: R${args.stake:.2f}")

            # 3. Tenta click + addbet com retry (até 2 tentativas)
            addbet = None
            for click_attempt in range(2):
                addbet_task = asyncio.create_task(ui.wait_addbet(timeout=8))
                await ui.click_odds(cell["x"], cell["y"])

                addbet = await addbet_task
                if addbet and addbet.get("bg"):
                    break

                # Verifica se betslip recebeu seleção mesmo sem capturar addbet
                betslip_ok = await page.evaluate("""() => {
                    const stake = document.querySelector(
                        '.bsf-StakeBox_StakeValue-input, .bss-StakeBox_StakeValue-input, [class*="StakeBox_StakeValue"]'
                    );
                    return !!stake && stake.offsetParent !== null;
                }""")
                if betslip_ok:
                    addbet = {"bg": "betslip-fallback", "sr": 0}
                    print(f"  ⚡ addbet não capturado via network MAS betslip tem seleção — prosseguindo")
                    break

                if click_attempt == 0:
                    # 1a falha sem seleção no betslip: mini-reset e re-tenta
                    print(f"  ⚠️ addbet tentativa 1 falhou (sem seleção no betslip), re-tentando...")
                    await page.keyboard.press("Escape")
                    await asyncio.sleep(0.3)
                    await page.keyboard.press("Escape")
                    await asyncio.sleep(0.3)
                    await ui.dismiss_overlays()
                    await asyncio.sleep(0.3)
                    await ui.clean_betslip()

            if not addbet or not addbet.get("bg"):
                # FALLBACK: addbet não capturado via network, mas betslip pode ter seleção
                betslip_has_sel = await page.evaluate("""() => {
                    const stake = document.querySelector(
                        '.bsf-StakeBox_StakeValue-input, .bss-StakeBox_StakeValue-input, [class*="StakeBox_StakeValue"]'
                    );
                    return !!stake && stake.offsetParent !== null;
                }""")
                if betslip_has_sel:
                    addbet = {"bg": "betslip-fallback", "sr": 0}
                    print(f"  ⚡ addbet response não capturado MAS betslip tem seleção — prosseguindo")
                else:
                    # Screenshot para diagnóstico
                    ss_path = f"tmp/debug_bet{i}.png"
                    try:
                        await page.screenshot(path=ss_path)
                        print(f"  📸 Screenshot salvo: {ss_path}")
                    except Exception:
                        pass
                    # Verifica o que está no ponto de click
                    el_info = await page.evaluate(f"""() => {{
                        const el = document.elementFromPoint({cell['x']}, {cell['y']});
                        if (!el) return 'null';
                        return el.tagName + ' | ' + (el.className || '').substring(0, 80)
                            + ' | text=' + (el.textContent || '').trim().substring(0, 40);
                    }}""")
                    print(f"  ❌ addbet não capturado (timeout)")
                    print(f"  🔍 Element at click: {el_info}")
                    elapsed = time.time() - t_start
                    results.append({
                        "i": i, "sr": -1, "cs": -1, "receipt": "",
                        "odds": cell["text"], "error": "addbet timeout",
                        "time": elapsed,
                    })
                    # Hard reset também após falha
                    if i < args.count:
                        await page.evaluate("window.location.hash = '#/IP'")
                        await asyncio.sleep(0.5)
                        await page.keyboard.press("Escape")
                        await asyncio.sleep(0.3)
                        jitter = args.delay * random.uniform(0.8, 1.2)
                        print(f"  ⏳ Aguardando {jitter:.1f}s (reset)...")
                        await asyncio.sleep(jitter)
                        await page.evaluate("window.location.hash = '#/IP/B18'")
                        await asyncio.sleep(2)
                        await ui.dismiss_overlays()
                    continue

            addbet_sr = addbet.get("sr", -1)
            bg = addbet.get("bg", "")
            odds = addbet.get("bt", [{}])[0].get("od", cell["text"]) if addbet.get("bt") else cell["text"]
            print(f"  addbet: sr={addbet_sr}  bg={bg[:20]}...  odds={odds}")

            # 5. Preenche stake (pode já estar preenchido via "Lembrar")
            stake_ok = await ui.fill_stake(args.stake, skip_if_remembered=warmup_ok)
            if not stake_ok:
                print(f"  ❌ Falha ao preencher stake")
                elapsed = time.time() - t_start
                results.append({
                    "i": i, "sr": -1, "cs": -1, "receipt": "",
                    "odds": str(odds), "error": "stake fill failed",
                    "time": elapsed,
                })
                if i < args.count:
                    await asyncio.sleep(args.delay)
                continue

            # 6. Registra placebet listener
            placebet_task = asyncio.create_task(ui.wait_placebet(timeout=20))

            # 7. Clica Place Bet
            clicked = await ui.click_place_bet()
            if not clicked:
                placebet_task.cancel()
                print(f"  ❌ Place Bet não encontrado")
                elapsed = time.time() - t_start
                results.append({
                    "i": i, "sr": -1, "cs": -1, "receipt": "",
                    "odds": str(odds), "error": "Place Bet not found",
                    "time": elapsed,
                })
                if i < args.count:
                    await asyncio.sleep(args.delay)
                continue

            # 8. Espera resultado
            pb = await placebet_task
            elapsed = time.time() - t_start

            if pb and pb.get("response"):
                resp = pb["response"]
                sr = resp.get("sr", -1)
                cs = resp.get("cs", -1)
                receipt = resp.get("br", "")
                status = "✅ ACEITA" if sr == 0 else f"❌ sr={sr} cs={cs}"
                print(f"  Resultado: {status}  {'Receipt: ' + receipt if receipt else ''}")
                results.append({
                    "i": i, "sr": sr, "cs": cs, "receipt": receipt,
                    "odds": str(odds), "error": "", "time": elapsed,
                })
            else:
                print(f"  ❌ placebet timeout")
                results.append({
                    "i": i, "sr": -1, "cs": -1, "receipt": "",
                    "odds": str(odds), "error": "placebet timeout",
                    "time": elapsed,
                })

            print(f"  Tempo:  {elapsed:.1f}s")
            print()

            # ── Desseleciona odds + fecha receipt ──
            print(f"  Desselecionando odds + fechando receipt...")
            await ui.deselect_odds()
            await ui.close_betslip()

            # ── Hard reset entre apostas ──────────────────────
            # Navegar para fora e voltar reseta completamente o betslip
            if i < args.count:
                # Navega para homepage (limpa betslip)
                await page.evaluate("window.location.hash = '#/IP'")
                await asyncio.sleep(0.5)
                # Escape para fechar qualquer painel residual
                await page.keyboard.press("Escape")
                await asyncio.sleep(0.3)

                jitter = args.delay * random.uniform(0.8, 1.2)
                print(f"  ⏳ Aguardando {jitter:.1f}s...")
                await asyncio.sleep(jitter)

                # Volta para eSports
                await page.evaluate("window.location.hash = '#/IP/B18'")
                await asyncio.sleep(2)
                await ui.dismiss_overlays()
                # NÃO limpa used_coords — matching aproximado (±50px) garante diversificação

        # ── Resumo final ──────────────────────────────────────
        total_time = time.time() - t_start_all
        accepted = sum(1 for r in results if r["sr"] == 0)
        rejected = sum(1 for r in results if r["sr"] != 0)

        print()
        print("=" * 64)
        print(f"  RESUMO: {accepted}/{len(results)} aceitas, {rejected} rejeitadas")
        print(f"  Tempo total: {total_time:.1f}s")
        print("=" * 64)
        print()
        print(f"  {'#':<3} {'sr':<4} {'cs':<4} {'Receipt':<17} {'Tempo':<7} {'Odds':<14} {'Erro'}")
        print(f"  {'─'*3} {'─'*4} {'─'*4} {'─'*17} {'─'*7} {'─'*14} {'─'*20}")
        for r in results:
            sr_str = "✅ 0" if r["sr"] == 0 else f"❌{r['sr']:>2}"
            receipt = r.get("receipt", "")[:15] or "—"
            err = (r.get("error") or "")[:30]
            odds_str = str(r.get("odds", "?"))[:12]
            print(f"  {r['i']:<3} {sr_str:<4} {r['cs']:<4} {receipt:<17} {r['time']:<7.1f} {odds_str:<14} {err}")

        print()
        if accepted == len(results):
            print("  🎉 TODAS AS APOSTAS ACEITAS — sem bloqueio detectado!")
        elif accepted > 0:
            print(f"  ⚠️ {rejected} apostas rejeitadas — possível rate-limit ou odds mudaram")
        else:
            print("  🚨 TODAS rejeitadas — possível bloqueio da conta!")

        # Para spectator loop
        _spectator_running = False
        spectator_task.cancel()
        try:
            await spectator_task
        except (asyncio.CancelledError, Exception):
            pass


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        print("\n  Ctrl+C")
