from __future__ import annotations
# ─── Fast bet por busca (sem URL) ─────────────────────────────────────────────
import urllib.parse


async def _js_click_at(page, x: float, y: float) -> bool:
    """Click via JS elementFromPoint — não depende de humanize/OS mouse.

    Usado nas funções de aposta (browser pode ter vindo do offscreen).
    O warm-up continua com page.mouse.click() pois roda on-screen.
    """
    return await page.evaluate("""([x, y]) => {
        const el = document.elementFromPoint(x, y);
        if (el) { el.click(); return true; }
        return false;
    }""", [x, y])


async def fast_bet_by_search(page, target_odd: float | None, signal: dict) -> dict:
    """Busca evento pelo nome/time/mercado/linha e aposta rapidamente."""
    t0 = time.perf_counter()
    result = {"status": "error", "odd": 0.0, "time": 0.0, "msg": ""}
    market = signal.get("market")
    line = signal.get("line")
    hc_team = signal.get("hc_team")
    teams = signal.get("teams") or hc_team or ""
    league = signal.get("league")

    # 1. Busca pelo nome do time ou confronto
    search_terms = []
    if teams:
        # Exemplo: "TRICKSTER vs PROWLER" ou "PROWLER"
        if " vs " in teams:
            search_terms.append(teams)
            search_terms.extend(teams.split(" vs "))
        else:
            search_terms.append(teams)
    elif hc_team:
        search_terms.append(hc_team)
    if league:
        search_terms.append(league)

    # Vai para a home e busca
    await page.goto("https://www.bet365.bet.br", wait_until="domcontentloaded")
    await asyncio.sleep(random.uniform(0.4, 0.8))
    await page.keyboard.press("Escape")
    await asyncio.sleep(random.uniform(0.25, 0.45))
    await page.keyboard.press("Escape")
    await asyncio.sleep(random.uniform(0.25, 0.45))
    await page.keyboard.press("Escape")
    await asyncio.sleep(random.uniform(0.2, 0.35))

    # Tenta abrir o campo de busca
    try:
        search_btn = page.locator('[aria-label="Pesquisar"], [aria-label="Search"], [class*="Search"]').first
        await search_btn.click(timeout=2000)
        await asyncio.sleep(0.2)
    except Exception:
        pass

    # Preenche o campo de busca
    found = False
    for term in search_terms:
        try:
            input_box = page.locator('input[type="search"], input[aria-label*="Pesquisar"], input[aria-label*="Search"]').first
            await input_box.fill(term)
            await asyncio.sleep(0.8)
            # Seleciona o primeiro resultado
            first_result = page.locator('[class*="SearchResults"] [role="option"], [class*="SearchResults"] [tabindex="0"], [class*="SearchResults"] div').first
            await first_result.click(timeout=2000)
            found = True
            await asyncio.sleep(1.0)
            break
        except Exception:
            continue

    if not found:
        result["msg"] = f"Evento não encontrado para busca: {search_terms}"
        result["time"] = time.perf_counter() - t0
        return result

    # Após abrir o evento, usa a lógica de fast_bet (mas sem URL)
    # Reaproveita o core de fast_bet para encontrar e clicar na odd
    # (código duplicado para evitar dependência circular)
    # --- (código idêntico ao core de fast_bet, mas sem navegação por URL) ---
    market_labels = {
        "hc": ["Handicap Asiático", "Asian Handicap", "Handicap"],
        "under": ["Total", "Pontos Mais/Menos", "Total de Pontos", "Mais/Menos"],
        "over": ["Total", "Pontos Mais/Menos", "Total de Pontos", "Mais/Menos"],
    }
    mkt = market or "hc"
    section_names = market_labels.get(mkt, market_labels["hc"])
    is_ou = mkt in ("under", "over")
    ou_label = "Menos" if mkt == "under" else "Mais" if mkt == "over" else None
    ou_label_short = "U" if mkt == "under" else "O" if mkt == "over" else None
    line_str = str(line) if line else None
    hc_team = signal.get("hc_team") if signal else None
    is_redirect = False

    # Espera odds renderizarem
    try:
        await page.wait_for_selector(
            ".gl-Participant_General, [class*='ParticipantOddsOnly_Odds'], [class*='ParticipantCentered']",
            timeout=8000,
        )
    except Exception:
        result["msg"] = "Timeout esperando odds na página (busca)"
        result["time"] = time.perf_counter() - t0
        return result

    await asyncio.sleep(0.15)

    # --- Reaproveita o JS de busca de odds do fast_bet ---
    odd_found = await page.evaluate(r"""(params) => {
        const odds = document.querySelectorAll('.gl-Participant_General');
        for (let i = 0; i < odds.length; i++) {
            const el = odds[i];
            const text = el.textContent.trim();
            const m = text.match(/(\d+[.,]\d+)/);
            if (!m) continue;
            const val = parseFloat(m[1].replace(',', '.'));
            if (val >= 1.01 && val <= 200) {
                const rect = el.getBoundingClientRect();
                return { idx: i, val: m[1], oddVal: val,
                         bbox: { x: rect.x, y: rect.y, width: rect.width, height: rect.height } };
            }
        }
        return null;
    }""", {})

    if not odd_found:
        result["msg"] = "Odd não encontrada após busca"
        result["time"] = time.perf_counter() - t0
        return result

    page_odd = float(odd_found["val"].replace(",", "."))
    if target_odd:
        drop = target_odd - page_odd
        if drop > MAX_ODD_DROP:
            result["msg"] = f"Odd desvalorizada: {target_odd:.2f} → {page_odd:.2f} (queda {drop:.2f})"
            result["time"] = time.perf_counter() - t0
            return result

    # Click direto nas coordenadas (JS click — evita hang do humanize pós-offscreen)
    bbox = odd_found.get("bbox")
    if bbox:
        cx = bbox["x"] + random.uniform(3, max(4, bbox["width"] - 3))
        cy = bbox["y"] + random.uniform(3, max(4, bbox["height"] - 3))
        await _js_click_at(page, cx, cy)
    else:
        await page.evaluate("() => { const o = document.querySelectorAll('.gl-Participant_General')[" + str(odd_found.get("idx", 0)) + "]; if(o) o.click(); }")

    result["odd"] = page_odd

    # Espera caderneta abrir
    stake_loc = page.locator('div[contenteditable="true"].bsf-StakeBox_StakeValue-input').first
    try:
        await stake_loc.wait_for(state="attached", timeout=3000)
    except Exception:
        alt = page.locator('[class*="StakeBox"] [contenteditable="true"]').first
        try:
            await alt.wait_for(state="attached", timeout=2000)
            stake_loc = alt
        except Exception:
            result["msg"] = "Campo de stake não encontrado"
            result["time"] = time.perf_counter() - t0
            return result

    # Espera botão ativo (Lembrar preenche stake)
    btn_ready = False
    for i in range(15):
        btn_disabled = await page.evaluate("""() => {
            const btn = document.querySelector('.bsf-PlaceBetButton');
            return btn ? btn.className.includes('Disabled') : true;
        }""")
        if not btn_disabled:
            btn_ready = True
            break
        await asyncio.sleep(0.1)
    if not btn_ready:
        try:
            await stake_loc.click(timeout=1000)
        except Exception:
            await stake_loc.evaluate("el => { el.focus(); el.click(); }")
        await page.keyboard.press("Control+a")
        await page.keyboard.press("Backspace")
        await page.keyboard.type(f"{STAKE:.2f}", delay=random.randint(35, 65))
        for _ in range(10):
            btn_disabled = await page.evaluate("""() => {
                const btn = document.querySelector('.bsf-PlaceBetButton');
                return btn ? btn.className.includes('Disabled') : true;
            }""")
            if not btn_disabled:
                break
            await asyncio.sleep(0.08)

    btn = page.locator(".bsf-PlaceBetButton")
    try:
        box = await btn.bounding_box()
        if box:
            bx = box["x"] + random.uniform(5, max(6, box["width"] - 5))
            by = box["y"] + random.uniform(3, max(4, box["height"] - 3))
            await _js_click_at(page, bx, by)
        else:
            await btn.click(timeout=2000)
    except Exception:
        try:
            await btn.click(timeout=2000)
        except Exception:
            await page.evaluate("() => { const b = document.querySelector('.bsf-PlaceBetButton'); if(b) b.click(); }")

    # Espera resultado
    for _ in range(30):
        await asyncio.sleep(0.15)
        check = await page.evaluate("""() => {
            const receipt = document.querySelector('.bsf-ReceiptContent, .bs-Receipt, .bss-ReceiptContent');
            if (receipt) return { status: 'accepted' };
            const allText = document.body.innerText || '';
            if (allText.includes('Aposta Feita') || allText.includes('Bet Placed'))
                return { status: 'accepted' };
            const acceptBtn = document.querySelector('.bsf-AcceptButton, .bsf-AcceptOdds');
            if (acceptBtn && acceptBtn.getBoundingClientRect().width > 0) {
                const r = acceptBtn.getBoundingClientRect();
                return { status: 'odd_changed', bbox: { x: r.x, y: r.y, w: r.width, h: r.height } };
            }
            const err = document.querySelector('.bs-GeneralErrorMessage');
            if (err) return { status: 'error', msg: err.textContent.trim().substring(0, 100) };
            const geoErr = document.querySelector('[class*="Geolocation"], [class*="geo-"], [class*="LocationError"]');
            if (geoErr && geoErr.getBoundingClientRect().width > 0) return { status: 'error', msg: 'Geolocation error: ' + geoErr.textContent.trim().substring(0, 100) };
            const bodyText = document.body.innerText || '';
            if (bodyText.includes('localização') || bodyText.includes('geolocation') || bodyText.includes('location could not'))
                return { status: 'error', msg: 'Geolocation blocked' };
            return { status: 'waiting' };
        }""")
        st = check.get("status") if check else "waiting"
        if st == "accepted":
            t_done = time.perf_counter()
            result["status"] = "accepted"
            result["time"] = t_done - t0
            return result
        if st == "odd_changed":
            ab = check.get("bbox")
            if ab:
                ax = ab["x"] + random.uniform(5, max(6, ab["w"] - 5))
                ay = ab["y"] + random.uniform(3, max(4, ab["h"] - 3))
                await _js_click_at(page, ax, ay)
            await asyncio.sleep(0.3)
            try:
                box = await btn.bounding_box()
                if box:
                    bx = box["x"] + random.uniform(5, max(6, box["width"] - 5))
                    by = box["y"] + random.uniform(3, max(4, box["height"] - 3))
                    await _js_click_at(page, bx, by)
                else:
                    await btn.click(timeout=2000)
            except Exception:
                pass
            continue
        if st == "error":
            result["status"] = "error"
            result["msg"] = check.get("msg", "Erro desconhecido")
            result["time"] = time.perf_counter() - t0
            return result
    result["status"] = "timeout"
    result["msg"] = "Timeout esperando confirmação"
    result["time"] = time.perf_counter() - t0
    return result
"""Listener Telegram + Aposta Automática no Bet365.

Ouve mensagens de um grupo do Telegram (como membro, não precisa ser admin),
detecta sinais de aposta, extrai URL + odd, e aposta automaticamente.

Formato esperado do sinal (apenas basquete):
    🏀 Germany (OG) vs France (nikkitta)
    🎯 SCORCH +7.5 @1.83
    📉 UNDER 110.5 @1.83
    📈 OVER 110.5 @1.83

Primeiro uso:
  1. Vá em https://my.telegram.org → API Development Tools
  2. Copie api_id e api_hash
  3. Rode: python scripts/bet_telegram.py --setup
  4. Depois: python scripts/bet_telegram.py

Uso normal:
  python scripts/bet_telegram.py
"""

async def fast_bet_by_search_live(page, target_odd: float | None, signal: dict) -> dict:
    """Busca o evento e depois delega a seleção ao fast_bet market-aware."""
    t0 = time.perf_counter()
    result = {"status": "error", "odd": 0.0, "time": 0.0, "msg": ""}

    hc_team = signal.get("hc_team")
    teams = signal.get("teams") or hc_team or ""
    league = signal.get("league")

    search_terms = []
    if teams:
        if " vs " in teams:
            parts = [part.strip() for part in teams.split(" vs ") if part.strip()]
            search_terms.extend(parts)
            search_terms.append(teams)
        else:
            search_terms.append(teams)
    if hc_team:
        search_terms.append(hc_team)
    if league:
        search_terms.append(league)

    search_terms = list(dict.fromkeys(term.strip() for term in search_terms if term and term.strip()))

    if not search_terms:
        result["msg"] = "Sinal sem termos suficientes para busca"
        return result

    await page.goto("https://www.bet365.bet.br", wait_until="domcontentloaded")
    await asyncio.sleep(1.5)
    for _ in range(3):
        await page.keyboard.press("Escape")
        await asyncio.sleep(0.5)

    try:
        search_btn = page.locator(
            '[aria-label="Pesquisar"], [aria-label="Search"], [class*="Search"]'
        ).first
        await search_btn.click(timeout=3000)
        await asyncio.sleep(0.5)
    except Exception:
        pass

    found = False
    for term in search_terms:
        try:
            input_box = page.locator(
                'input[type="search"], input[aria-label*="Pesquisar"], input[aria-label*="Search"]'
            ).first
            await input_box.fill(term)
            await asyncio.sleep(1.5)
            first_result = page.locator(
                '[class*="SearchResults"] [role="option"], '
                '[class*="SearchResults"] [tabindex="0"], '
                '[class*="SearchResults"] div'
            ).first
            await first_result.wait_for(state="visible", timeout=3000)
            await first_result.click(timeout=3000)
            found = True
            logger.info("Busca encontrou evento com termo: {}", term)
            await asyncio.sleep(2.5)
            break
        except Exception:
            continue

    if not found:
        result["msg"] = f"Evento nÃ£o encontrado para busca: {search_terms}"
        result["time"] = time.perf_counter() - t0
        return result

    resolved_url = page.url or "https://www.bet365.bet.br"
    elapsed = time.perf_counter() - t0
    delegated = await fast_bet(page, resolved_url, STAKE, target_odd, signal)
    delegated["time"] = delegated.get("time", 0.0) + elapsed
    return delegated


async def fast_bet_current_page(page, stake: float, target_odd: float | None, signal: dict) -> dict:
    """Aposta usando a tela atual aberta, sem navegar para outro evento."""
    current_url = page.url or "https://www.bet365.bet.br"
    return await fast_bet(page, current_url, stake, target_odd, signal)


async def fast_bet_overview(page, stake: float, target_odd: float | None, signal: dict) -> dict:
    """Aposta direto da tela IP/FAV (overview com grid de jogos).

    Identifica o jogo pelo nome do jogador (hc_team/teams), encontra a célula
    correta (HC/Over/Under) e clica na odd — tudo sem abrir a página individual.
    """
    # Garante foco no browser antes de apostar (mouse.click precisa janela visível)
    _bring_browser_back()
    try:
        await page.bring_to_front()
    except Exception:
        pass
    await asyncio.sleep(0.5)  # Aguarda janela estabilizar após reposição
    try:
        await page.evaluate("() => 1")  # Ping — garante browser responsivo
    except Exception:
        pass

    t0 = time.perf_counter()
    result = {"status": "error", "odd": 0.0, "time": 0.0, "msg": ""}
    market = signal.get("market") if signal else None
    line = signal.get("line") if signal else None
    hc_team = signal.get("hc_team") if signal else None
    teams = signal.get("teams") or ""

    # Monta os termos de busca do jogador na overview
    search_player = hc_team or ""
    if not search_player and teams:
        search_player = teams.split(" vs ")[0].strip() if " vs " in teams else teams

    if not search_player:
        result["msg"] = "Sinal sem nome de jogador para buscar na overview"
        result["time"] = time.perf_counter() - t0
        return result

    mkt = market or "hc"
    line_str = str(line) if line else None

    logger.info("Overview bet: player='{}', market={}, line={}, odd={}", search_player, mkt, line_str, target_odd)

    # Dismiss popups humanizado antes de buscar odds
    logger.debug("Overview: dismiss_popups...")
    await dismiss_popups(page)
    logger.debug("Overview: buscando odd no DOM...")

    # JS que encontra a linha do jogo na overview e retorna coordenadas da odd
    odd_found = await page.evaluate(r"""(params) => {
        const { searchPlayer, mkt, lineStr, targetOdd } = params;
        const playerUpper = searchPlayer.toUpperCase();

        // 1. Encontra a linha do jogo que contém o player
        const allEventRows = document.querySelectorAll(
            '[class*="gl-Market_General"], [class*="rcl-MarketCouponFixtureLinkBase"], ' +
            '[class*="ovm-Fixture"], [class*="ovm-FixtureDetail"], ' +
            '[class*="sl-CouponFixtureLinkBase"], [class*="Coupon_FixtureLink"]'
        );

        let matchRow = null;
        let matchRowText = '';

        for (const row of allEventRows) {
            const rowText = (row.textContent || '').toUpperCase();
            if (rowText.includes(playerUpper)) {
                matchRow = row;
                matchRowText = rowText;
                break;
            }
        }

        // Fallback: busca no DOM inteiro
        if (!matchRow) {
            const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, null);
            while (walker.nextNode()) {
                const t = walker.currentNode.textContent.trim().toUpperCase();
                if (t.includes(playerUpper)) {
                    let parent = walker.currentNode.parentElement;
                    for (let i = 0; i < 20; i++) {
                        if (!parent || parent === document.body) break;
                        const odds = parent.querySelectorAll('.gl-Participant_General');
                        if (odds.length >= 2) {
                            matchRow = parent;
                            matchRowText = (parent.textContent || '').toUpperCase();
                            break;
                        }
                        parent = parent.parentElement;
                    }
                    if (matchRow) break;
                }
            }
        }

        if (!matchRow) {
            return { error: true, msg: 'Player "' + searchPlayer + '" não encontrado na overview',
                     debug: document.body.innerText.substring(0, 500) };
        }

        // 2. Dentro da row, busca a odd correta
        const oddEls = matchRow.querySelectorAll('.gl-Participant_General');
        const candidates = [];

        for (let i = 0; i < oddEls.length; i++) {
            const el = oddEls[i];
            const rect = el.getBoundingClientRect();
            if (rect.width < 5 || rect.height < 5) continue;
            if (el.closest('[class*="Suspended"]') || el.className.includes('Suspended')) continue;

            const cellParent = el.closest('[class*="srb-ParticipantLabelCentered"]') ||
                              el.closest('[class*="gl-Participant"]') ||
                              el.parentElement?.parentElement || el.parentElement;
            const cellText = cellParent ? cellParent.textContent.trim() : el.textContent.trim();
            const oddMatch = el.textContent.trim().match(/(\d+[.,]\d+)/);
            if (!oddMatch) continue;
            const oddVal = parseFloat(oddMatch[1].replace(',', '.'));

            if (mkt === 'hc') {
                const searchArea = cellText.toUpperCase();
                const hasPlus = searchArea.includes('+');
                const hasMinus = searchArea.includes('-');

                if (lineStr) {
                    const lineNum = parseFloat(lineStr);
                    const linePatterns = [
                        '+' + lineStr, '-' + lineStr,
                        '+' + lineStr.replace('.', ','), '-' + lineStr.replace('.', ',')
                    ];
                    let exactMatch = false;
                    for (const lp of linePatterns) {
                        if (searchArea.includes(lp)) { exactMatch = true; break; }
                    }

                    if (exactMatch) {
                        if (lineNum >= 0 && !hasPlus) continue;
                        candidates.push({ idx: i, oddVal, text: cellText.substring(0, 60), col: 'hc', exact: true, rect });
                    } else if (lineNum >= 0 && hasPlus && !hasMinus) {
                        candidates.push({ idx: i, oddVal, text: cellText.substring(0, 60), col: 'hc', exact: false, rect });
                    } else if (lineNum < 0 && hasMinus) {
                        candidates.push({ idx: i, oddVal, text: cellText.substring(0, 60), col: 'hc', exact: false, rect });
                    }
                } else {
                    candidates.push({ idx: i, oddVal, text: cellText.substring(0, 60), col: 'hc', exact: false, rect });
                }
            }
            else if (mkt === 'over' || mkt === 'under') {
                const ouPrefix = mkt === 'over' ? 'O' : 'U';
                const searchArea = cellText.trim().replace(/\s+/g, ' ');
                let matched = false;

                if (lineStr) {
                    const patterns = [
                        ouPrefix + ' ' + lineStr,
                        ouPrefix + ' ' + lineStr.replace('.', ','),
                        ouPrefix + lineStr,
                    ];
                    for (const p of patterns) {
                        if (searchArea.includes(p)) { matched = true; break; }
                    }
                } else {
                    matched = searchArea.startsWith(ouPrefix + ' ') || searchArea.includes(' ' + ouPrefix + ' ');
                }
                if (!matched) continue;
                candidates.push({ idx: i, oddVal, text: cellText.substring(0, 60), col: mkt, rect });
            }
        }

        if (candidates.length === 0) {
            const rowOdds = Array.from(oddEls).map(e => {
                const p = e.closest('[class*="srb-ParticipantLabelCentered"]') || e.parentElement?.parentElement || e.parentElement;
                return (p ? p.textContent : e.textContent).trim().substring(0, 40);
            });
            return { error: true, msg: 'Odd não encontrada na linha do jogo',
                     player: searchPlayer, mkt: mkt, lineStr: lineStr,
                     rowOddsCount: oddEls.length, rowOdds: rowOdds.slice(0, 12),
                     rowText: matchRowText.substring(0, 300) };
        }

        // Ordena: match exato primeiro, depois proximidade ao target
        if (targetOdd) {
            candidates.sort((a, b) => {
                if (a.exact && !b.exact) return -1;
                if (!a.exact && b.exact) return 1;
                return Math.abs(a.oddVal - targetOdd) - Math.abs(b.oddVal - targetOdd);
            });
        }

        // Retorna coordenadas em vez de marcar com atributo (evita MutationObserver)
        const chosen = candidates[0];
        const r = chosen.rect;
        return { error: false, val: chosen.oddVal.toFixed(2),
                 oddVal: chosen.oddVal, text: chosen.text,
                 col: chosen.col, total: candidates.length,
                 player: searchPlayer,
                 bbox: { x: r.x, y: r.y, width: r.width, height: r.height } };
    }""", {"searchPlayer": search_player, "mkt": mkt, "lineStr": line_str, "targetOdd": target_odd})

    if not odd_found or odd_found.get("error"):
        logger.warning("Overview: odd não encontrada! Debug: {}", odd_found)
        try:
            await page.screenshot(path=str(Path(__file__).resolve().parent.parent / "bet_debug_overview.png"))
            logger.info("Screenshot salvo: bet_debug_overview.png")
        except Exception:
            pass
        result["msg"] = odd_found.get("msg", "Odd não encontrada na overview") if odd_found else "JS retornou null"
        result["time"] = time.perf_counter() - t0
        return result

    logger.info("Overview: odd encontrada: {} ({}), player={}, col={}",
                 odd_found.get("val"), odd_found.get("text", ""), odd_found.get("player"), odd_found.get("col"))

    page_odd = odd_found.get("oddVal", 0.0)

    # Validação de range
    if target_odd:
        drop = target_odd - page_odd
        if drop > MAX_ODD_DROP:
            logger.warning("SKIP — odd desvalorizada: sinal @{:.2f} → página @{:.2f} (queda {:.2f} > max {:.2f})",
                           target_odd, page_odd, drop, MAX_ODD_DROP)
            result["msg"] = f"Odd desvalorizada: {target_odd:.2f} → {page_odd:.2f} (queda {drop:.2f})"
            result["time"] = time.perf_counter() - t0
            return result

    # Clica na odd — usando coordenadas retornadas (sem atributos customizados no DOM)
    bbox = odd_found.get("bbox")
    if not bbox:
        result["msg"] = "Odd encontrada mas sem coordenadas"
        result["time"] = time.perf_counter() - t0
        return result

    # Click direto com offset aleatório (JS click — evita hang do humanize pós-offscreen)
    click_x = bbox["x"] + random.uniform(3, max(4, bbox["width"] - 3))
    click_y = bbox["y"] + random.uniform(3, max(4, bbox["height"] - 3))
    logger.debug("Overview: clicando odd em ({:.0f}, {:.0f}) bbox={}...", click_x, click_y, bbox)
    await _js_click_at(page, click_x, click_y)
    logger.debug("Overview: click completou")

    result["odd"] = page_odd
    logger.info("Overview: odd {} clicada: {:.2f}", mkt.upper(), page_odd)

    # Espera caderneta abrir (stake campo visível)
    stake_loc = page.locator('div[contenteditable="true"].bsf-StakeBox_StakeValue-input').first
    try:
        await stake_loc.wait_for(state="attached", timeout=3000)
    except Exception:
        alt = page.locator('[class*="StakeBox"] [contenteditable="true"]').first
        try:
            await alt.wait_for(state="attached", timeout=2000)
            stake_loc = alt
        except Exception:
            result["msg"] = "Campo de stake não encontrado"
            result["time"] = time.perf_counter() - t0
            return result

    # Espera botão ativo (Lembrar preenche stake automaticamente)
    btn_ready = False
    for i in range(15):
        btn_disabled = await page.evaluate("""() => {
            const btn = document.querySelector('.bsf-PlaceBetButton');
            return btn ? btn.className.includes('Disabled') : true;
        }""")
        if not btn_disabled:
            btn_ready = True
            break
        await asyncio.sleep(0.1)

    if not btn_ready:
        # Stake não lembrado — preenche rapido via teclado
        logger.info("Stake não memorizado — preenchendo R${:.2f}", stake)
        try:
            await stake_loc.click(timeout=1000)
        except Exception:
            await stake_loc.evaluate("el => { el.focus(); el.click(); }")
        await page.keyboard.press("Control+a")
        await page.keyboard.press("Backspace")
        await page.keyboard.type(f"{stake:.2f}", delay=random.randint(35, 65))
        # Espera botão ativar após preencher
        for _ in range(10):
            btn_disabled = await page.evaluate("""() => {
                const btn = document.querySelector('.bsf-PlaceBetButton');
                return btn ? btn.className.includes('Disabled') : true;
            }""")
            if not btn_disabled:
                break
            await asyncio.sleep(0.08)

    # Clica "Fazer Aposta" — JS click (evita hang humanize)
    btn = page.locator(".bsf-PlaceBetButton")
    try:
        box = await btn.bounding_box()
        if box:
            bx = box["x"] + random.uniform(5, max(6, box["width"] - 5))
            by = box["y"] + random.uniform(3, max(4, box["height"] - 3))
            await _js_click_at(page, bx, by)
        else:
            await btn.click(timeout=2000)
    except Exception:
        try:
            await btn.click(timeout=2000)
        except Exception:
            await page.evaluate("() => { const b = document.querySelector('.bsf-PlaceBetButton'); if(b) b.click(); }")

    t_bet = time.perf_counter()
    logger.info("'Fazer Aposta' clicado ({:.1f}s)", t_bet - t0)

    # Espera resultado (até ~8s = 50×0.16)
    for _ in range(50):
        await asyncio.sleep(0.16)
        check = await page.evaluate("""() => {
            const receipt = document.querySelector('.bsf-ReceiptContent, .bs-Receipt, .bss-ReceiptContent, [class*="Receipt"][class*="Content"], .bss-DefaultContent_Done');
            if (receipt) return { status: 'accepted' };
            const allText = document.body.innerText || '';
            if (allText.includes('Aposta Feita') || allText.includes('Bet Placed')
                || allText.includes('Aposta Aceita') || allText.includes('Bet Accepted')
                || allText.includes('Aposta feita com sucesso'))
                return { status: 'accepted' };
            const doneBtn = document.querySelector('.bss-DefaultContent_Done, .bsf-ReceiptDoneButton, [class*="Receipt"] [class*="Done"]');
            if (doneBtn && doneBtn.getBoundingClientRect().width > 0) return { status: 'accepted' };
            const acceptBtn = document.querySelector('.bsf-AcceptButton, .bsf-AcceptOdds, [class*="Accept"][class*="Button"]');
            if (acceptBtn && acceptBtn.getBoundingClientRect().width > 0) {
                const r = acceptBtn.getBoundingClientRect();
                return { status: 'odd_changed', bbox: { x: r.x, y: r.y, w: r.width, h: r.height } };
            }
            const err = document.querySelector('.bs-GeneralErrorMessage, [class*="GeneralError"], [class*="BetError"]');
            if (err) return { status: 'error', msg: err.textContent.trim().substring(0, 100) };
            return { status: 'waiting' };
        }""")

        st = check.get("status") if check else "waiting"
        if st == "accepted":
            result["status"] = "accepted"
            result["time"] = time.perf_counter() - t0
            return result
        if st == "odd_changed":
            # Clica Accept via JS click
            ab = check.get("bbox")
            if ab:
                ax = ab["x"] + random.uniform(5, max(6, ab["w"] - 5))
                ay = ab["y"] + random.uniform(3, max(4, ab["h"] - 3))
                await _js_click_at(page, ax, ay)
            await asyncio.sleep(0.3)
            try:
                box = await btn.bounding_box()
                if box:
                    bx = box["x"] + random.uniform(5, max(6, box["width"] - 5))
                    by = box["y"] + random.uniform(3, max(4, box["height"] - 3))
                    await _js_click_at(page, bx, by)
                else:
                    await btn.click(timeout=2000)
            except Exception:
                pass
            continue
        if st == "error":
            result["status"] = "error"
            result["msg"] = check.get("msg", "Erro desconhecido")
            result["time"] = time.perf_counter() - t0
            return result

    result["status"] = "timeout"
    result["msg"] = "Timeout esperando confirmação"
    result["time"] = time.perf_counter() - t0
    return result


async def keep_current_page_alive(page, on_logout=None, engine=None, ui=None) -> None:
    """Mantém a página ativa, fecha popups, re-injeta geo e detecta logout.

    Args:
        page: Playwright page
        on_logout: callback async chamado quando logout é detectado
        engine: BrowserEngine para re-injeção de geo
        ui: UIBetPlacer opcional — se fornecido, roda checker de jogadores visíveis
    """
    _check_count = 0
    while True:
        try:
            # Pausa keep-alive enquanto aposta está em andamento (evita contention no CDP)
            if hasattr(page, '_bet_active') and page._bet_active.is_set():
                await asyncio.sleep(0.5)
                continue
            await dismiss_popups(page)
            # Scroll natural variado (evita padrão robótico)
            scroll_delta = random.randint(15, 80) * random.choice([1, -1])
            await page.evaluate(
                f"""() => {{
                    const y = window.scrollY || 0;
                    window.scrollTo({{ top: y + {scroll_delta}, behavior: 'smooth' }});
                }}"""
            )
            _check_count += 1

            # A cada 2 ciclos (~50s), re-injeta geo stealth em todos os frames
            if engine and _check_count % 2 == 0:
                await engine._inject_geo_evaluate(page)

            # A cada 2 ciclos (~50s), checker: loga jogadores visíveis + atualiza cache
            if ui and _check_count % 2 == 0:
                try:
                    await ui.check_visible_players()
                except Exception:
                    pass

            # A cada 6 ciclos (~2.5min), verifica geo + login
            if _check_count % 6 == 0:
                if engine:
                    geo = await engine.check_geolocation(page)
                    if not geo:
                        logger.warning("GEO FALHOU no keep-alive — re-injetando...")
                        await engine._inject_geo_evaluate(page)
                        # Tenta novamente após re-injeção
                        geo = await engine.check_geolocation(page)
                        if not geo:
                            logger.error("GEO CONTINUA FALHANDO após re-injeção")

                from src.browser.login import is_logged_in
                still_logged = await is_logged_in(page)
                if not still_logged:
                    logger.warning("LOGOUT DETECTADO no keep-alive!")
                    if on_logout:
                        await on_logout()
                    return  # Encerra o keep-alive — main() vai re-inicializar
        except Exception:
            pass
        await asyncio.sleep(25)



import asyncio
import json
import os
import random
import re
import sys
import time
from datetime import datetime
from pathlib import Path

# Força saída sem buffer para terminal background
os.environ["PYTHONUNBUFFERED"] = "1"
# Garante UTF-8 no Windows (cp1252 não suporta emojis)
os.environ["PYTHONIOENCODING"] = "utf-8"

import io
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace", line_buffering=True)
sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding="utf-8", errors="replace", line_buffering=True)

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
# Garante cwd correto para encontrar configs
os.chdir(Path(__file__).resolve().parent.parent)

# Log para arquivo (leitura confiável, sem buffering issues)
import logging as _logging
_file_handler = _logging.FileHandler(
    Path(__file__).resolve().parent.parent / "bet_telegram.log",
    encoding="utf-8", mode="w",
)
_file_handler.setFormatter(_logging.Formatter("%(asctime)s | %(levelname)s | %(name)s | %(message)s"))
_logging.getLogger().addHandler(_file_handler)
_logging.getLogger().setLevel(_logging.INFO)

# Loguru sink para arquivo (nossos logs usam loguru via get_logger)
_LOG_FILE = Path(__file__).resolve().parent.parent / "bet_telegram.log"

from telethon import TelegramClient, events

from config.settings import get_settings
from src.api.bet_interceptor import BetInterceptor
from src.api.token_harvester import TokenHarvester
from src.betting.safety import SafetyGuard, RejectReason
from src.betting.ui_placer import UIBetPlacer
from src.betting.bet_store import BetStore
from src.betting.heartbeat import Heartbeat
from src.betting.dashboard import Dashboard, console
from src.browser.engine import BrowserEngine
from src.browser.login import ensure_logged_in
from src.browser.session import load_cookies, save_cookies
from src.utils.logger import get_logger

logger = get_logger("bet_telegram")

# Adiciona sink loguru para arquivo
from loguru import logger as _loguru_logger
_loguru_logger.add(str(_LOG_FILE), format="{time:HH:mm:ss} | {level} | {name}:{function}:{line} | {message}", level="DEBUG", mode="a")


# ─── Windows: manter browser always-on-top + anti-minimize ─────────────────────
def _find_browser_hwnds():
    """Retorna lista de HWNDs das janelas do Chromium do Playwright."""
    import ctypes
    from ctypes import wintypes

    user32 = ctypes.windll.user32
    kernel32 = ctypes.windll.kernel32
    EnumWindowsProc = ctypes.WINFUNCTYPE(ctypes.c_bool, wintypes.HWND, wintypes.LPARAM)

    PROCESS_QUERY_LIMITED_INFORMATION = 0x1000
    _chromium_pids: set = set()
    found = []

    def _is_chromium_process(hwnd) -> bool:
        """Verifica se a janela pertence a um processo chromium/chrome do Playwright."""
        pid = wintypes.DWORD()
        user32.GetWindowThreadProcessId(hwnd, ctypes.byref(pid))
        p = pid.value
        if p in _chromium_pids:
            return True
        h = kernel32.OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, False, p)
        if not h:
            return False
        try:
            buf = ctypes.create_unicode_buffer(512)
            size = wintypes.DWORD(512)
            if kernel32.QueryFullProcessImageNameW(h, 0, buf, ctypes.byref(size)):
                exe = buf.value.lower()
                if "chromium" in exe or "chrome" in exe:
                    _chromium_pids.add(p)
                    return True
        finally:
            kernel32.CloseHandle(h)
        return False

    def _enum_callback(hwnd, _):
        if user32.IsWindowVisible(hwnd):
            if _is_chromium_process(hwnd):
                found.append(hwnd)
        return True

    user32.EnumWindows(EnumWindowsProc(_enum_callback), 0)
    return found


_OFFSCREEN_X = -10000
_original_positions: dict = {}


def _hide_browser_offscreen():
    """Move as janelas do browser para bem fora da tela (x=-10000)."""
    import ctypes

    user32 = ctypes.windll.user32
    hwnds = _find_browser_hwnds()
    if not hwnds:
        _loguru_logger.warning("Nenhuma janela do browser encontrada para esconder offscreen")
        return

    class RECT(ctypes.Structure):
        _fields_ = [("left", ctypes.c_long), ("top", ctypes.c_long),
                     ("right", ctypes.c_long), ("bottom", ctypes.c_long)]

    SWP_NOSIZE = 0x0001
    SWP_NOZORDER = 0x0004
    for hwnd in hwnds:
        rect = RECT()
        user32.GetWindowRect(hwnd, ctypes.byref(rect))
        x, y = rect.left, rect.top
        w = rect.right - rect.left
        h = rect.bottom - rect.top
        if x > _OFFSCREEN_X + 100:
            _original_positions[hwnd] = (x, y, w, h)
        user32.SetWindowPos(hwnd, 0, _OFFSCREEN_X, 0, 0, 0, SWP_NOSIZE | SWP_NOZORDER)

    _loguru_logger.info(f"Browser movido offscreen ({len(hwnds)} janelas)")


def _bring_browser_back():
    """Traz as janelas do browser de volta à posição original (robustamente)."""
    import ctypes
    import time as _time

    user32 = ctypes.windll.user32
    hwnds = _find_browser_hwnds()
    if not hwnds:
        _loguru_logger.warning("Nenhuma janela do browser encontrada para trazer de volta")
        return

    SW_RESTORE = 9
    SW_SHOW = 5
    HWND_TOPMOST = -1
    HWND_NOTOPMOST = -2
    SWP_NOSIZE = 0x0001
    SWP_NOMOVE = 0x0002
    SWP_SHOWWINDOW = 0x0040

    for hwnd in hwnds:
        # 1. Restaura se minimizado
        if user32.IsIconic(hwnd):
            user32.ShowWindow(hwnd, SW_RESTORE)

        # 2. Move para posição original
        x, y, w, h = _original_positions.get(hwnd, (100, 100, 1280, 900))
        user32.SetWindowPos(hwnd, 0, x, y, w, h, SWP_SHOWWINDOW)

        # 3. Força visibilidade
        user32.ShowWindow(hwnd, SW_SHOW)

        # 4. Traz para frente via TOPMOST temporário (garante foco)
        user32.SetWindowPos(hwnd, HWND_TOPMOST, 0, 0, 0, 0, SWP_NOMOVE | SWP_NOSIZE)
        user32.SetWindowPos(hwnd, HWND_NOTOPMOST, 0, 0, 0, 0, SWP_NOMOVE | SWP_NOSIZE)

        # 5. Foco
        user32.SetForegroundWindow(hwnd)

    _time.sleep(0.3)  # Aguarda OS processar reposição
    _loguru_logger.info(f"Browser restaurado ({len(hwnds)} janelas)")


CONFIG_FILE = Path(__file__).resolve().parent.parent / ".telegram_config.json"
SESSION_FILE = Path(__file__).resolve().parent.parent / ".telegram_session"
STAKE = 1.00
MAX_ODD_DROP = 0.35   # Queda máx aceitável da odd (sinal @1.83 aceita até 1.48) — ajustado de 0.15
MAX_LINE_DROP = 2     # Queda máx da linha HC (sinal +7.5 aceita até +5.5)
MAX_CONCURRENT_BETS = 2  # Multi-fixture: apostas simultâneas

# Safety Guard — controle de risco (stop-loss, rate limit, unidades)
_safety: SafetyGuard | None = None

def get_safety() -> SafetyGuard:
    global _safety
    if _safety is None:
        _safety = SafetyGuard()
    return _safety


# ─── Config ──────────────────────────────────────────────────────────────────

def load_config() -> dict:
    if not CONFIG_FILE.exists():
        return {}
    return json.loads(CONFIG_FILE.read_text(encoding="utf-8"))


def save_config(cfg: dict) -> None:
    CONFIG_FILE.write_text(json.dumps(cfg, indent=2), encoding="utf-8")


def setup_wizard() -> dict:
    """Setup interativo — pede api_id, api_hash e grupo."""
    print("=" * 60)
    print("  📱 SETUP — Telegram Listener")
    print("=" * 60)
    print("\n1. Vá em https://my.telegram.org → API Development Tools")
    print("2. Crie um app (nome qualquer) e copie api_id + api_hash\n")

    api_id = input("api_id: ").strip()
    api_hash = input("api_hash: ").strip()

    print("\n3. Qual grupo do Telegram monitorar?")
    print("   Cole o username (@grupo) ou link (t.me/grupo)")
    print("   Ou deixe vazio para listar seus grupos depois\n")
    group = input("grupo: ").strip()

    cfg = {"api_id": int(api_id), "api_hash": api_hash}
    if group:
        # Limpa t.me/ e @ do input
        group = group.replace("https://t.me/", "").replace("http://t.me/", "").lstrip("@")
        cfg["group"] = group

    save_config(cfg)
    print(f"\n✅ Config salva em {CONFIG_FILE.name}")
    return cfg


# ─── Parser ──────────────────────────────────────────────────────────────────

def parse_signal_live_format(text: str) -> dict | None:
    """Parser do formato novo para HC, Under e Over.

    HC:    🎯 TRICKSTER +4.5 @1.83
           🏀 TRICKSTER vs PROWLER

    UNDER: 📉 UNDER 110.5 @1.83
           🏀 JACKAL vs BULLSEYE

    OVER:  📈 OVER 110.5 @1.83
           🏀 JACKAL vs BULLSEYE
    """
    if not text:
        return None

    normalized = text.replace("\r\n", "\n").replace("\r", "\n")
    lines = [line.strip() for line in normalized.split("\n") if line.strip()]
    if not lines:
        return None

    selection_line = ""
    matchup_line = ""
    league_line = ""
    ou_market = None  # "under" ou "over"

    for line in lines:
        cleaned = re.sub(r"^[^\w(+-]+", "", line).strip()

        # Detecta Over/Under via emoji 📉/📈 ou palavra UNDER/OVER
        ou_match = re.match(
            r"(?:[📉📈]\s*)?(?P<side>UNDER|OVER)\s+(?P<line>\d+(?:[.,]\d+)?)\s*@\s*(?P<odd>\d+[.,]\d+)",
            cleaned,
            re.IGNORECASE,
        )
        if ou_match and not ou_market:
            ou_market = ou_match.group("side").lower()
            selection_line = cleaned
            continue

        if "@" in cleaned and not selection_line:
            selection_line = cleaned
            continue
        if re.search(r"\b(?:vs|x|v)\b", cleaned, re.IGNORECASE) and not matchup_line:
            matchup_line = cleaned
            continue
        if "🏆" in line and not league_line:
            league_line = line.split("🏆", 1)[1].strip()

    if not selection_line or not matchup_line:
        return None

    # ── Parse Over/Under ──
    if ou_market:
        ou_match = re.match(
            r"(?:[📉📈]\s*)?(?P<side>UNDER|OVER)\s+(?P<line>\d+(?:[.,]\d+)?)\s*@\s*(?P<odd>\d+[.,]\d+)",
            selection_line,
            re.IGNORECASE,
        )
        matchup_match = re.match(
            r"(?P<home>.+?)\s+(?:vs|x|v)\s+(?P<away>.+)$",
            matchup_line,
            re.IGNORECASE,
        )
        if not ou_match or not matchup_match:
            return None

        line_val = float(ou_match.group("line").replace(",", "."))
        odd_val = float(ou_match.group("odd").replace(",", "."))

        return {
            "url": None,  # Sempre opera pela overview, nunca navega para URL
            "odd": odd_val,
            "market": ou_market,  # "under" ou "over"
            "line": line_val,
            "teams": f"{matchup_match.group('home').strip()} vs {matchup_match.group('away').strip()}",
            "league": league_line or None,
            "raw": text,
            "hc_team": None,
            "selection_label": f"{ou_market.upper()} {line_val}",
        }

    # ── Parse HC (formato original) ──
    selection_match = re.match(
        r"(?P<team>.+?)\s+(?P<line>[+-]?\d+(?:[.,]\d+)?)\s*@\s*(?P<odd>\d+[.,]\d+)\s*$",
        selection_line,
    )
    matchup_match = re.match(
        r"(?P<home>.+?)\s+(?:vs|x|v)\s+(?P<away>.+)$",
        matchup_line,
        re.IGNORECASE,
    )

    if not selection_match or not matchup_match:
        return None

    team = selection_match.group("team").strip()
    # Remove prefixo "HC" do nome — é indicador de mercado, não parte do nome
    if re.match(r'^HC\s+', team, re.IGNORECASE):
        team = re.sub(r'^HC\s+', '', team, flags=re.IGNORECASE).strip()
    line = float(selection_match.group("line").replace(",", "."))
    odd = float(selection_match.group("odd").replace(",", "."))

    return {
        "url": None,  # Sempre opera pela overview, nunca navega para URL
        "odd": odd,
        "market": "hc",
        "line": line,
        "teams": f"{matchup_match.group('home').strip()} vs {matchup_match.group('away').strip()}",
        "league": league_line or None,
        "raw": text,
        "hc_team": team,
        "selection_label": f"{team} {selection_match.group('line').strip()}",
    }


def parse_signal(text: str) -> dict | None:
    """Extrai URL, odd e info do sinal do Telegram.

    Retorna dict com: url, odd, market, line, teams, league — ou None se não for sinal.

    Modelos suportados:
      Modelo 1: "HC Germany (OG) 0.0 @1.825" → abre caderneta direto
      Modelo 2: "Under 5.5 @1.875" → abre jogo, precisa achar mercado
    """
    if not text:
        return None

    parsed_live = parse_signal_live_format(text)
    if parsed_live:
        return parsed_live


    # Precisa ter URL bet365
    url_match = re.search(r'https?://(?:www\.)?bet365\.bet\.br\S+', text)
    url = url_match.group(0).rstrip(')') if url_match else None

    result = {
        "url": url, "odd": None, "market": None, "line": None,
        "teams": None, "league": None, "raw": text,
    }


    # Extrai odd — @1.825 ou @2.00
    odd_match = re.search(r'@(\d+[.,]\d+)', text)
    if odd_match:
        result["odd"] = float(odd_match.group(1).replace(",", "."))



    # Novo formato: 🎯 TRICKSTER +3.5 @1.83
    # Aceita variações de espaço, decimal, e time com caracteres especiais
    # Regex mais permissivo: aceita qualquer caractere no nome do time, múltiplos espaços, e variações de separação
    # Regex ultra permissivo: aceita qualquer caractere (incluindo quebras de linha) entre 🎯 e linha/odd
    nba_match = re.search(r'🎯[ \t\r\n]*([\s\S]+?)\s*([+-]?\d+(?:[.,]\d+)?)\s*@\s*([\d.,]+)', text, re.MULTILINE)
    if nba_match:
        result["market"] = "hc"
        result["hc_team"] = nba_match.group(1).replace("\n", " ").replace("\r", " ").strip()
        result["line"] = float(nba_match.group(2).replace(",", "."))
        result["odd"] = float(nba_match.group(3).replace(",", "."))
        return result if result["odd"] else None

    # Formatos antigos
    under_over = re.search(r'\b(Under|Over)\s+(\d+[.,]\d+)\b', text, re.IGNORECASE)
    if under_over:
        result["market"] = under_over.group(1).lower()  # "under" ou "over"
        result["line"] = float(under_over.group(2).replace(",", "."))
    elif re.search(r'\bHC\b', text, re.IGNORECASE):
        result["market"] = "hc"
        # Extrai time e linha HC: "HC Team +0.5 @1.925"
        hc_match = re.search(r'\bHC\b\s+(.+?)\s+([+-]?\d+(?:[.,]\d+)?(?:\s*,\s*[+-]?\d+(?:[.,]\d+)?)?)\s+@', text, re.IGNORECASE)
        if hc_match:
            result["hc_team"] = hc_match.group(1).strip()
            result["line"] = hc_match.group(2).strip()


    # Extrai times — apenas basquete (🏀 Team A vs Team B)
    teams_match = re.search(r'🏀\s*(.+?)\s+(?:vs|x|v)\s+(.+)', text, re.IGNORECASE)
    if teams_match:
        result["teams"] = f"{teams_match.group(1).strip()} vs {teams_match.group(2).strip()}"


    # Extrai liga — "🏆 Liga Name"
    league_match = re.search(r'🏆\s*(.+)', text)
    if league_match:
        result["league"] = league_match.group(1).strip()


    # Só retorna se tiver URL (exceto para novo formato, já retornado acima)
    if not url:
        return None
    return result


# ─── Popups (copiado do bet_daemon.py) ───────────────────────────────────────

async def dismiss_popups(page) -> int:
    total = 0
    for _ in range(5):
        # Coleta coordenadas de todos os popups visíveis
        targets = await page.evaluate("""() => {
            const results = [];
            // Cookie: busca por texto "Aceitar todos" primeiro
            const allBtns = document.querySelectorAll('button');
            let cookieFound = false;
            for (const btn of allBtns) {
                const txt = btn.textContent.trim();
                if (/^Aceitar todos$/i.test(txt) || /^Accept All$/i.test(txt)) {
                    const r = btn.getBoundingClientRect();
                    if (r.width > 0) { results.push({ x: r.x, y: r.y, w: r.width, h: r.height, t: 'cookie' }); cookieFound = true; break; }
                }
            }
            // Cookie: fallback OneTrust
            if (!cookieFound) {
                const cookie = document.querySelector('#onetrust-accept-btn-handler');
                if (cookie && cookie.offsetParent !== null) {
                    const r = cookie.getBoundingClientRect();
                    if (r.width > 0) results.push({ x: r.x, y: r.y, w: r.width, h: r.height, t: 'cookie' });
                }
            }
            const walk = document.createTreeWalker(document.body, NodeFilter.SHOW_ELEMENT, null);
            while (walk.nextNode()) {
                const el = walk.currentNode;
                const dt = Array.from(el.childNodes)
                    .filter(n => n.nodeType === 3)
                    .map(n => n.textContent.trim()).join('');
                if ((dt === 'Continuar' || dt === 'Continue') &&
                    el.getBoundingClientRect().width > 50) {
                    const r = el.getBoundingClientRect();
                    results.push({ x: r.x, y: r.y, w: r.width, h: r.height, t: 'continuar' });
                    break;
                }
            }
            const closeBtns = document.querySelectorAll(
                '[class*="IntroductoryPopup_Close"],[class*="NotificationsPopup_Close"],' +
                '[class*="pop-"][class*="_Close"],[class*="Popup"][class*="Close"],' +
                '[class*="EnableBrowserGeolocationPopup"] [class*="Close"],' +
                '[class*="gsm-EnableBrowserGeolocationPopup_Close"]'
            );
            for (const btn of closeBtns) {
                const r = btn.getBoundingClientRect();
                if (r.width > 0) results.push({ x: r.x, y: r.y, w: r.width, h: r.height, t: 'popup' });
            }
            return results;
        }""")
        if targets and len(targets) > 0:
            for t in targets:
                cx = t["x"] + random.uniform(3, max(4, t["w"] - 3))
                cy = t["y"] + random.uniform(3, max(4, t["h"] - 3))
                await _js_click_at(page, cx, cy)
                await asyncio.sleep(0.15)
            total += len(targets)
            await asyncio.sleep(0.4)
        else:
            break
    return total


# ─── Fast Bet (copiado do bet_daemon.py) ─────────────────────────────────────

async def fast_bet(page, url: str, stake: float, target_odd: float | None = None, signal: dict | None = None) -> dict:
    """Aposta rápida com todas as otimizações.

    signal: dict de parse_signal() com market, line, etc.
    Modelo 1 (HC/ML): URL abre listagem → clica odd na tabela
    Modelo 2 (Under/Over): URL abre página do jogo → acha mercado de total
    """
    # Garante foco no browser antes de apostar (mouse.click precisa janela visível)
    _bring_browser_back()
    try:
        await page.bring_to_front()
    except Exception:
        pass
    await asyncio.sleep(0.5)
    try:
        await page.evaluate("() => 1")
    except Exception:
        pass

    t0 = time.perf_counter()
    result = {"status": "error", "odd": 0.0, "time": 0.0, "msg": ""}
    market = signal.get("market") if signal else None
    line = signal.get("line") if signal else None

    # 1. Navega — SPA hash se já no Bet365
    current_url = page.url or ""
    if "bet365" in current_url and "#/" in url:
        new_hash = url.split("#", 1)[1]
        await page.evaluate(f"window.location.hash = '{new_hash}'")
    else:
        await page.goto(url, wait_until="commit")

    try:
        await page.wait_for_selector(
            ".gl-Participant_General, [class*='ParticipantOddsOnly_Odds'], [class*='ParticipantCentered']",
            timeout=8000,
        )
    except Exception:
        result["msg"] = "Timeout esperando odds na página"
        result["time"] = time.perf_counter() - t0
        return result

    # Espera odds reais renderizarem (SPA hash nav carrega rápido mas conteúdo demora)
    try:
        await page.wait_for_function("""() => {
            const odds = document.querySelectorAll('.gl-Participant_General');
            if (odds.length < 2) return false;
            for (const el of odds) {
                const m = el.textContent.trim().match(/\\d+[.,]\\d+/);
                if (m && parseFloat(m[0].replace(',','.')) >= 1.01) return true;
            }
            return false;
        }""", timeout=5000)
    except Exception:
        logger.warning("Timeout extra esperando odds renderizarem")
    await asyncio.sleep(0.15)

    t_nav = time.perf_counter()
    logger.info("Página carregada ({:.1f}s)", t_nav - t0)

    # 2. Seleção market-aware (ML / HC / Under / Over) ──────────────────
    # Em páginas de jogo, encontra a seção correta pelo nome do mercado,
    # depois clica na odd dentro dela.
    # market_labels mapeia tipo → textos das seções no Bet365 PT-BR
    market_labels = {
        "hc": ["Handicap Asiático", "Asian Handicap", "Handicap"],
        "under": ["Total", "Pontos Mais/Menos", "Total de Pontos", "Mais/Menos"],
        "over": ["Total", "Pontos Mais/Menos", "Total de Pontos", "Mais/Menos"],
    }
    mkt = market or "hc"
    section_names = market_labels.get(mkt, market_labels["hc"])
    is_ou = mkt in ("under", "over")
    ou_label = "Menos" if mkt == "under" else "Mais" if mkt == "over" else None
    ou_label_short = "U" if mkt == "under" else "O" if mkt == "over" else None
    line_str = str(line) if line else None
    hc_team = signal.get("hc_team") if signal else None
    # sportsbookredirect = link de caderneta (jogo ao vivo) — linha pode mudar
    is_redirect = "sportsbookredirect" in url.lower()

    logger.info("Market-aware: tipo={}, seções={}, ou_label={}, line={}, hc_team={}, redirect={}", mkt, section_names, ou_label, line_str, hc_team, is_redirect)

    # Screenshot de debug ANTES de buscar odds
    try:
        await page.screenshot(path=str(Path(__file__).resolve().parent.parent / "bet_debug_before.png"))
    except Exception:
        pass

    # Dismiss popups humanizado antes de buscar odds
    await dismiss_popups(page)

    odd_found = await page.evaluate(r"""(params) => {
        const { sectionNames, targetOdd, ouLabel, ouLabelShort, lineStr, mkt, hcTeam, isRedirect } = params;

        // ── Helper: verifica se um elemento odd está dentro de um contexto "Handicap" ──
        // Sobe na DOM procurando um ancestral cujo texto contém um dos sectionNames,
        // mas que seja pequeno o suficiente para ser uma seção de mercado (<30 odds).
        function isInHandicapAncestor(el) {
            let parent = el;
            for (let lvl = 0; lvl < 15; lvl++) {
                parent = parent.parentElement;
                if (!parent || parent === document.body) return { found: false };
                const oddsCount = parent.querySelectorAll('.gl-Participant_General').length;
                if (oddsCount > 30) continue; // Container muito grande, pula
                if (oddsCount === 0) continue; // Container sem odds, pula
                const pText = parent.textContent || '';
                for (const sName of sectionNames) {
                    if (pText.includes(sName)) {
                        return { found: true, container: parent, name: sName, oddsCount: oddsCount };
                    }
                }
            }
            return { found: false };
        }

        // ── ESTRATÉGIA 1: Busca top-down por seção (CSS selectors) ──
        const headers = document.querySelectorAll(
            '[class*="MarketGroup"], [class*="market-group"], [class*="sgl-MarketFixtureDetailsLabel"], ' +
            '[class*="rcl-MarketHeaderLabel"], [class*="cm-MarketGroupButton"], [class*="gl-MarketGroupButton"], ' +
            '[class*="gl-MarketGroupPod"], [class*="MarketGroupContainer"], [class*="MarketFixtureDetailsLabel"]'
        );

        let targetContainer = null;
        let matchedHeader = '';
        for (const h of headers) {
            const hText = h.textContent.trim();
            for (const sName of sectionNames) {
                const shortText = hText.substring(0, 80);
                if (shortText.includes(sName)) {
                    targetContainer = h.closest('[class*="gl-MarketGroupPod"]') ||
                                       h.closest('[class*="MarketGroupContainer"]') ||
                                       h.closest('[class*="MarketGroup"]') ||
                                       h.closest('[class*="market"]') ||
                                       h.parentElement?.parentElement || h.parentElement;
                    matchedHeader = shortText;
                    break;
                }
            }
            if (targetContainer) break;
        }

        // ── ESTRATÉGIA 2: Busca por TEXTO direto em qualquer elemento ──
        if (!targetContainer) {
            const allEls = document.querySelectorAll('div, span, td, th, label, p');
            for (const el of allEls) {
                // Pega APENAS o texto direto do elemento (não filhos)
                let ownText = '';
                for (const n of el.childNodes) {
                    if (n.nodeType === 3) ownText += n.textContent;
                }
                ownText = ownText.trim();
                if (ownText.length < 3) continue;

                for (const sName of sectionNames) {
                    if (ownText.includes(sName)) {
                        // Encontrou header! Sobe para achar container com odds
                        let container = el;
                        for (let i = 0; i < 8; i++) {
                            container = container.parentElement;
                            if (!container) break;
                            if (container.querySelectorAll('.gl-Participant_General').length > 0) break;
                        }
                        if (container && container.querySelectorAll('.gl-Participant_General').length > 0) {
                            targetContainer = container;
                            matchedHeader = ownText.substring(0, 60) + ' (own-text)';
                        }
                        break;
                    }
                }
                if (targetContainer) break;

                // Fallback: testa textContent completo se curto
                const fullText = el.textContent.trim();
                if (fullText.length > 3 && fullText.length < 120) {
                    for (const sName of sectionNames) {
                        if (fullText.includes(sName)) {
                            let container = el;
                            for (let i = 0; i < 8; i++) {
                                container = container.parentElement;
                                if (!container) break;
                                if (container.querySelectorAll('.gl-Participant_General').length > 0) break;
                            }
                            if (container && container.querySelectorAll('.gl-Participant_General').length > 0) {
                                targetContainer = container;
                                matchedHeader = fullText.substring(0, 60) + ' (text-search)';
                            }
                            break;
                        }
                    }
                }
                if (targetContainer) break;
            }
        }

        // ── ESTRATÉGIA 3 (HC only): Bottom-up — parte de cada odd, sobe na DOM ──
        // Se top-down falhou para HC, usa cada odd como âncora e verifica ancestrais
        if (!targetContainer && mkt === 'hc') {
            const allPageOdds = document.querySelectorAll('.gl-Participant_General');
            // Encontra as seções de Handicap de baixo pra cima
            const hcContainers = new Set();
            for (const el of allPageOdds) {
                const rect = el.getBoundingClientRect();
                if (rect.width < 5 || rect.height < 5) continue;
                const result = isInHandicapAncestor(el);
                if (result.found) {
                    hcContainers.add(result.container);
                }
            }
            // Usa o menor container encontrado (mais específico)
            let bestContainer = null;
            let bestOddsCount = Infinity;
            for (const c of hcContainers) {
                const cnt = c.querySelectorAll('.gl-Participant_General').length;
                if (cnt > 0 && cnt < bestOddsCount) {
                    bestOddsCount = cnt;
                    bestContainer = c;
                }
            }
            if (bestContainer) {
                targetContainer = bestContainer;
                matchedHeader = 'bottom-up HC (' + bestOddsCount + ' odds)';
            }
        }

        // 2. Coleta odds — da seção encontrada ou da página inteira (fallback)
        const searchRoot = targetContainer || document.body;
        const oddEls = searchRoot.querySelectorAll('.gl-Participant_General');
        const sectionInfo = targetContainer ? ('dentro da seção: ' + matchedHeader) : 'página inteira (fallback)';

        const candidates = [];
        for (let i = 0; i < oddEls.length; i++) {
            const el = oddEls[i];
            const text = el.textContent.trim();
            const rect = el.getBoundingClientRect();
            if (rect.width < 5 || rect.height < 5) continue;
            if (el.closest('[class*="Suspended"]') || el.className.includes('Suspended')) continue;

            // Para Under/Over, verifica label "Mais"/"Menos" ou "O"/"U" e linha
            if (ouLabel) {
                const row = el.closest('[class*="gl-Market_General"]') ||
                            el.closest('[class*="srb-ParticipantLabelCentered"]') ||
                            el.parentElement?.parentElement || el.parentElement;
                const rowText = row ? row.textContent : text;

                // Aceita "Menos de"/"Mais de" OU "U "/"O " (basquete)
                const hasLongLabel = rowText.includes(ouLabel);
                const hasShortLabel = ouLabelShort && (
                    new RegExp('\\b' + ouLabelShort + '\\s+\\d', 'i').test(rowText) ||
                    rowText.includes(ouLabelShort + ' ')
                );
                if (!hasLongLabel && !hasShortLabel) continue;

                if (lineStr) {
                    const lineComma = lineStr.replace('.', ',');
                    if (!rowText.includes(lineStr) && !rowText.includes(lineComma)) continue;
                }
            }

            // Para HC: SEMPRE verificar contexto Handicap (bottom-up safety net)
            if (mkt === 'hc') {
                // Se veio de fallback (página inteira), cada candidato DEVE estar em contexto Handicap
                if (!targetContainer) {
                    const hcCheck = isInHandicapAncestor(el);
                    if (!hcCheck.found) continue;
                }

                // Filtra por linha
                const row = el.closest('[class*="gl-Market_General"]') ||
                            el.closest('[class*="srb-Participant"]') ||
                            el.parentElement?.parentElement?.parentElement ||
                            el.parentElement?.parentElement || el.parentElement;
                const rowText = row ? row.textContent : text;

                if (lineStr) {
                    // Extrai TODOS os números da row que parecem linhas de handicap (com sinal)
                    const rowNums = [...rowText.matchAll(/([+-]\d+(?:[.,]\d+)?)/g)].map(m => parseFloat(m[1].replace(',','.')));
                    const signalLine = parseFloat(lineStr.replace(',', '.'));

                    if (!isNaN(signalLine) && rowNums.length > 0 && isRedirect) {
                        // sportsbookredirect: linha flexível
                        // Regra: se rowLine >= signalLine → aceita (a favor)
                        //         se rowLine < signalLine → aceita se dif <= 2
                        let foundLine = false;
                        for (const rl of rowNums) {
                            if (rl >= signalLine) { foundLine = true; break; } // a favor
                            if (signalLine - rl <= 2) { foundLine = true; break; } // até 2 abaixo
                        }
                        if (!foundLine) continue;
                    } else {
                        // Match exato (URL normal ou sem sinal)
                        const parts = lineStr.split(',').map(s => s.trim());
                        let foundLine = false;
                        for (const p of parts) {
                            const absP = p.replace(/^[+-]/, '');
                            const escP = absP.replace(/\./g, '\\.');
                            const lineRe = new RegExp('[+-]?' + escP + '(?=[^\\d]|$)');
                            if (lineRe.test(rowText)) { foundLine = true; break; }
                            const pComma = p.replace('.', ',');
                            const escPComma = pComma.replace(/^[+-]/, '').replace(/,/g, '\\,');
                            const lineReComma = new RegExp('[+-]?' + escPComma + '(?=[^\\d]|$)');
                            if (lineReComma.test(rowText)) { foundLine = true; break; }
                        }
                        if (!foundLine) continue;
                    }
                }

                // Filtra por nome do time HC
                if (hcTeam) {
                    // Usa contexto mais amplo para encontrar o time
                    let ctx = el;
                    let ctxText = '';
                    for (let lvl = 0; lvl < 6; lvl++) {
                        ctx = ctx.parentElement;
                        if (!ctx) break;
                        ctxText = ctx.textContent || '';
                        if (ctxText.toLowerCase().includes(hcTeam.toLowerCase())) break;
                    }
                    if (!ctxText.toLowerCase().includes(hcTeam.toLowerCase())) continue;
                }
            }

            // Extrai valor numérico da odd
            // Para HC, a célula contém "linha + odd" juntos (ex: "+9.5 1.83" → textContent "+9.51.83")
            // O regex guloso pega "9.51" errado. Solução: encontrar a linha no texto e pegar a odd DEPOIS dela.
            let val, oddVal;
            if (mkt === 'hc' && lineStr) {
                // Estratégia 1: buscar child elements separados (DOM-aware)
                let foundOdd = null;
                const children = el.querySelectorAll('span, div');
                for (const child of children) {
                    const ct = child.textContent.trim();
                    const cm = ct.match(/^(\d+[.,]\d+)$/);
                    if (cm) {
                        const cv = parseFloat(cm[1].replace(',', '.'));
                        if (cv >= 1.01 && cv <= 200) {
                            foundOdd = { raw: cm[1], num: cv };
                            break;
                        }
                    }
                }

                // Estratégia 2: encontrar a linha no texto e extrair odd depois dela
                // Usa regex com word-boundary para "+1" não casar com "+11" ou "+10"
                if (!foundOdd) {
                    const lineParts = lineStr.split(',').map(s => s.trim());
                    for (const lp of lineParts) {
                        const absLine = lp.replace(/^[+-]/, '');
                        // Busca a linha com word-boundary via regex
                        // Escapa o ponto para regex literal
                        const escaped = absLine.replace(/\./g, '\\.');
                        const lineRe = new RegExp('[+-]?' + escaped + '(?=[^\\d]|$)');
                        const lineMatch = lineRe.exec(text);
                        if (lineMatch) {
                            const afterLine = text.substring(lineMatch.index + lineMatch[0].length);
                            const om = afterLine.match(/(\d+[.,]\d+)/);
                            if (om) {
                                const ov = parseFloat(om[1].replace(',', '.'));
                                if (ov >= 1.01 && ov <= 200) {
                                    foundOdd = { raw: om[1], num: ov };
                                    break;
                                }
                            }
                        }
                        if (foundOdd) break;
                    }
                }

                // Estratégia 3: fallback — último decimal no texto (odd geralmente é o último)
                if (!foundOdd) {
                    const allNums = [...text.matchAll(/(\d+[.,]\d+)/g)];
                    if (allNums.length > 0) {
                        const last = allNums[allNums.length - 1];
                        const lv = parseFloat(last[1].replace(',', '.'));
                        if (lv >= 1.01 && lv <= 200) {
                            foundOdd = { raw: last[1], num: lv };
                        }
                    }
                }

                if (!foundOdd) continue;
                val = foundOdd.raw;
                oddVal = foundOdd.num;
            } else if (mkt === 'hc') {
                // HC sem linha — pega primeiro decimal
                const m = text.match(/(\d+[.,]\d+)/);
                if (!m) continue;
                oddVal = parseFloat(m[1].replace(',', '.'));
                if (oddVal < 1.01 || oddVal > 200) continue;
                val = m[1];
            } else {
                const m = text.match(/(\d+[.,]\d+)/);
                if (!m) continue;
                oddVal = parseFloat(m[1].replace(',', '.'));
                if (oddVal < 1.01 || oddVal > 200) continue;
                val = m[1];
            }

            // Para Under/Over com linha, pula se o número É a própria linha
            if (ouLabel && lineStr) {
                const lineVal = parseFloat(lineStr);
                if (Math.abs(oddVal - lineVal) < 0.01) continue;
            }

            candidates.push({ idx: i, val: val, oddVal: oddVal, text: text.substring(0, 60), section: sectionInfo });
        }

        // FALLBACK Under/Over: col-header parse
        if (candidates.length === 0 && ouLabel && targetContainer) {
            const sText = targetContainer.innerText || targetContainer.textContent || '';
            const labelFull = ouLabel === 'Menos' ? 'Menos de' : 'Mais de';
            let targetOddVal = null;

            if (lineStr) {
                const lineComma = lineStr.replace('.', ',');
                let lineIdx = sText.indexOf(lineStr);
                if (lineIdx === -1) lineIdx = sText.indexOf(lineComma);
                if (lineIdx >= 0) {
                    const after = sText.substring(lineIdx);
                    const re = new RegExp(labelFull.replace(/[+]/g, '\\+') + '[\\s\\u00a0]*(\\d+[.,]\\d+)');
                    const m2 = after.match(re);
                    if (m2) targetOddVal = parseFloat(m2[1].replace(',', '.'));
                }
            }
            if (!targetOddVal) {
                const re = new RegExp(labelFull.replace(/[+]/g, '\\+') + '[\\s\\u00a0]*(\\d+[.,]\\d+)');
                const m2 = sText.match(re);
                if (m2) targetOddVal = parseFloat(m2[1].replace(',', '.'));
            }

            if (targetOddVal) {
                for (let i = 0; i < oddEls.length; i++) {
                    const el = oddEls[i];
                    const rect = el.getBoundingClientRect();
                    if (rect.width < 5 || rect.height < 5) continue;
                    const m2 = el.textContent.trim().match(/(\d+[.,]\d+)/);
                    if (m2) {
                        const v = parseFloat(m2[1].replace(',', '.'));
                        if (Math.abs(v - targetOddVal) < 0.02) {
                            candidates.push({ idx: i, val: m2[1], oddVal: v,
                                text: el.textContent.trim().substring(0, 60),
                                section: sectionInfo + ' (col-header parse)' });
                            break;
                        }
                    }
                }
            }
        }

        if (candidates.length === 0) {
            // Debug info detalhado
            const allOddsPage = document.querySelectorAll('.gl-Participant_General');
            // Procura textos que contenham "Handicap" na página para debug
            const handicapTexts = [];
            const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, null);
            while (walker.nextNode()) {
                const t = walker.currentNode.textContent.trim();
                if (t.length > 3 && t.length < 100 && /handicap/i.test(t)) {
                    handicapTexts.push(t.substring(0, 60));
                    if (handicapTexts.length >= 10) break;
                }
            }
            return { error: true, oddsTotal: allOddsPage.length,
                sectionFound: !!targetContainer, matchedHeader: matchedHeader,
                headerTexts: Array.from(headers).map(h => h.textContent.trim().substring(0, 40)).slice(0, 15),
                handicapTexts: handicapTexts,
                mkt: mkt, lineStr: lineStr, hcTeam: hcTeam || null };
        }

        // 3. Ordena por proximidade ao alvo
        if (targetOdd) {
            candidates.sort((a, b) => Math.abs(a.oddVal - targetOdd) - Math.abs(b.oddVal - targetOdd));
        }

        // Retorna coordenadas bbox em vez de marcar com atributo (evita MutationObserver)
        const chosen = candidates[0];
        const targetEl = oddEls[chosen.idx];
        const rect = targetEl.getBoundingClientRect();
        // Faz scroll para o elemento se necessário
        targetEl.scrollIntoView({ block: 'center', behavior: 'instant' });
        const rect2 = targetEl.getBoundingClientRect();
        return { error: false, val: chosen.val, oddVal: chosen.oddVal,
                 text: chosen.text, section: chosen.section, total: candidates.length,
                 matchedHeader: matchedHeader,
                 bbox: { x: rect2.x, y: rect2.y, width: rect2.width, height: rect2.height } };
    }""", {"sectionNames": section_names, "targetOdd": target_odd, "ouLabel": ou_label,
            "ouLabelShort": ou_label_short, "lineStr": line_str, "mkt": mkt, "hcTeam": hc_team, "isRedirect": is_redirect})

    if not odd_found or odd_found.get("error"):
        logger.warning("Odd não encontrada! Debug: {}", odd_found)
        # Screenshot de debug quando odd não encontrada
        try:
            await page.screenshot(path=str(Path(__file__).resolve().parent.parent / "bet_debug_not_found.png"))
            logger.info("Screenshot salvo: bet_debug_not_found.png")
        except Exception:
            pass
        result["msg"] = f"Odd para mercado '{mkt}' não encontrada na página"
        result["time"] = time.perf_counter() - t0
        return result

    logger.info("Odd encontrada: {} ({}), candidatos: {}, seção: {}, header: {}",
                 odd_found["val"], odd_found.get("text", ""), odd_found["total"],
                 odd_found["section"], odd_found.get("matchedHeader", "N/A"))

    page_odd = float(odd_found["val"].replace(",", "."))

    # ── Validação de range: odd desvalorizada? ──
    if target_odd:
        drop = target_odd - page_odd
        if drop > MAX_ODD_DROP:
            logger.warning("SKIP — odd desvalorizada: sinal @{:.2f} → página @{:.2f} (queda {:.2f} > max {:.2f})",
                           target_odd, page_odd, drop, MAX_ODD_DROP)
            result["msg"] = f"Odd desvalorizada: {target_odd:.2f} → {page_odd:.2f} (queda {drop:.2f})"
            result["time"] = time.perf_counter() - t0
            return result
        if drop > 0:
            logger.info("Odd caiu {:.2f} (dentro do range aceitável)", drop)
        elif drop < 0:
            logger.info("Odd SUBIU {:.2f} — valorizada!", abs(drop))

    # Click direto nas coordenadas (JS click — evita hang humanize pós-offscreen)
    bbox = odd_found.get("bbox")
    if bbox:
        cx = bbox["x"] + random.uniform(3, max(4, bbox["width"] - 3))
        cy = bbox["y"] + random.uniform(3, max(4, bbox["height"] - 3))
        await _js_click_at(page, cx, cy)
    else:
        logger.warning("Sem bbox — fallback locator")
        odds_locator = page.locator('.gl-Participant_General')
        await odds_locator.nth(0).click(timeout=3000)

    result["odd"] = page_odd
    logger.info("Odd {} clicada: {:.2f}", mkt.upper(), page_odd)

    # 3. Stake já memorizado via warm-up ("Lembrar") — verifica e preenche só se necessário
    stake_loc = page.locator('div[contenteditable="true"].bsf-StakeBox_StakeValue-input').first
    try:
        await stake_loc.wait_for(state="attached", timeout=3000)
        logger.info("Campo stake encontrado")
    except Exception as e:
        logger.warning("Stake wait_for falhou: {} — tentando fallback", e)
        alt = page.locator('[class*="StakeBox"] [contenteditable="true"]').first
        try:
            await alt.wait_for(state="attached", timeout=2000)
            stake_loc = alt
            logger.info("Stake encontrado via seletor alternativo")
        except Exception:
            logger.error("Campo de stake NÃO encontrado!")
            result["msg"] = "Campo de stake não encontrado"
            result["time"] = time.perf_counter() - t0
            return result

    # Espera botão ativo (Lembrar preenche stake automaticamente)
    btn_ready = False
    for i in range(15):
        btn_disabled = await page.evaluate("""() => {
            const btn = document.querySelector('.bsf-PlaceBetButton');
            return btn ? btn.className.includes('Disabled') : true;
        }""")
        if not btn_disabled:
            btn_ready = True
            logger.info("Botão ativo após {} tentativas", i + 1)
            break
        await asyncio.sleep(0.1)

    if not btn_ready:
        logger.info("Stake não memorizado — preenchendo R${:.2f}", stake)
        try:
            await stake_loc.click(timeout=1000)
        except Exception:
            await stake_loc.evaluate("el => { el.focus(); el.click(); }")
        await page.keyboard.press("Control+a")
        await page.keyboard.press("Backspace")
        await page.keyboard.type(f"{stake:.2f}", delay=random.randint(35, 65))
        for _ in range(10):
            btn_disabled = await page.evaluate("""() => {
                const btn = document.querySelector('.bsf-PlaceBetButton');
                return btn ? btn.className.includes('Disabled') : true;
            }""")
            if not btn_disabled:
                break
            await asyncio.sleep(0.08)

    # Clica "Fazer Aposta" — JS click (evita hang humanize)
    btn = page.locator(".bsf-PlaceBetButton")
    try:
        box = await btn.bounding_box()
        if box:
            bx = box["x"] + random.uniform(5, max(6, box["width"] - 5))
            by = box["y"] + random.uniform(3, max(4, box["height"] - 3))
            await _js_click_at(page, bx, by)
        else:
            await btn.click(timeout=2000)
    except Exception:
        try:
            await btn.click(timeout=2000)
        except Exception:
            await page.evaluate("() => { const b = document.querySelector('.bsf-PlaceBetButton'); if(b) b.click(); }")

    t_bet = time.perf_counter()
    logger.info("'Fazer Aposta' clicado ({:.1f}s)", t_bet - t0)

    # 6. Espera resultado
    for _ in range(30):
        await asyncio.sleep(0.15)
        check = await page.evaluate("""() => {
            const receipt = document.querySelector('.bsf-ReceiptContent, .bs-Receipt, .bss-ReceiptContent');
            if (receipt) return { status: 'accepted' };
            const allText = document.body.innerText || '';
            if (allText.includes('Aposta Feita') || allText.includes('Bet Placed'))
                return { status: 'accepted' };
            const acceptBtn = document.querySelector('.bsf-AcceptButton, .bsf-AcceptOdds');
            if (acceptBtn && acceptBtn.getBoundingClientRect().width > 0) {
                const r = acceptBtn.getBoundingClientRect();
                return { status: 'odd_changed', bbox: { x: r.x, y: r.y, w: r.width, h: r.height } };
            }
            const err = document.querySelector('.bs-GeneralErrorMessage');
            if (err) return { status: 'error', msg: err.textContent.trim().substring(0, 100) };
            // Detecta erro de geolocalização
            const geoErr = document.querySelector('[class*="Geolocation"], [class*="geo-"], [class*="LocationError"]');
            if (geoErr && geoErr.getBoundingClientRect().width > 0) return { status: 'error', msg: 'Geolocation error: ' + geoErr.textContent.trim().substring(0, 100) };
            const bodyText = document.body.innerText || '';
            if (bodyText.includes('localização') || bodyText.includes('geolocation') || bodyText.includes('location could not'))
                return { status: 'error', msg: 'Geolocation blocked' };
            return { status: 'waiting' };
        }""")

        st = check.get("status") if check else "waiting"

        if st == "accepted":
            t_done = time.perf_counter()
            result["status"] = "accepted"
            result["time"] = t_done - t0
            return result

        if st == "odd_changed":
            ab = check.get("bbox")
            if ab:
                ax = ab["x"] + random.uniform(5, max(6, ab["w"] - 5))
                ay = ab["y"] + random.uniform(3, max(4, ab["h"] - 3))
                await _js_click_at(page, ax, ay)
            await asyncio.sleep(0.3)
            try:
                box = await btn.bounding_box()
                if box:
                    bx = box["x"] + random.uniform(5, max(6, box["width"] - 5))
                    by = box["y"] + random.uniform(3, max(4, box["height"] - 3))
                    await _js_click_at(page, bx, by)
                else:
                    await btn.click(timeout=2000)
            except Exception:
                pass
            continue

        if st == "error":
            result["status"] = "error"
            result["msg"] = check.get("msg", "Erro desconhecido")
            result["time"] = time.perf_counter() - t0
            return result

    result["status"] = "timeout"
    result["msg"] = "Timeout esperando confirmação"
    result["time"] = time.perf_counter() - t0
    # Screenshot para debug — salva o que está na tela no momento do timeout
    try:
        ss_path = Path(__file__).parent.parent / "bet_timeout_screenshot.png"
        await page.screenshot(path=str(ss_path))
        logger.info("Screenshot salvo: {}", ss_path)
    except Exception as e:
        logger.warning("Falha ao salvar screenshot: {}", e)
    return result


# ─── Warm-up & Session Init ──────────────────────────────────────────────────

async def accept_cookies(page) -> bool:
    """Aceita banner de cookies se visível — via mouse humanizado."""
    try:
        bbox = await page.evaluate("""() => {
            // 1. Busca por texto "Aceitar todos" / "Aceitar Todos" / "Accept All" em botões
            const allBtns = document.querySelectorAll('button');
            for (const btn of allBtns) {
                const txt = btn.textContent.trim();
                if (/^Aceitar todos$/i.test(txt) || /^Accept All$/i.test(txt)) {
                    const r = btn.getBoundingClientRect();
                    if (r.width > 0 && r.height > 0) return { x: r.x, y: r.y, w: r.width, h: r.height };
                }
            }
            // 2. OneTrust principal
            const btn = document.querySelector('#onetrust-accept-btn-handler');
            if (btn && btn.offsetParent !== null) {
                const r = btn.getBoundingClientRect();
                if (r.width > 0) return { x: r.x, y: r.y, w: r.width, h: r.height };
            }
            // 3. Banner OneTrust via classe
            const otBanner = document.querySelector('#onetrust-banner-sdk');
            if (otBanner) {
                const acceptBtn = otBanner.querySelector('button[id*="accept"], .onetrust-close-btn-handler');
                if (acceptBtn) {
                    const r = acceptBtn.getBoundingClientRect();
                    if (r.width > 0) return { x: r.x, y: r.y, w: r.width, h: r.height };
                }
            }
            // 4. Fallback genérico
            const alt = document.querySelector(
                '[class*="cookie"] button[id*="accept"], ' +
                '[class*="Cookie"] button[id*="accept"], ' +
                '[class*="consent"] button, ' +
                'button[class*="accept-cookie"], ' +
                'button[class*="AcceptCookie"]'
            );
            if (alt) {
                const r = alt.getBoundingClientRect();
                if (r.width > 0) return { x: r.x, y: r.y, w: r.width, h: r.height };
            }
            return null;
        }""")
        if bbox:
            cx = bbox["x"] + random.uniform(5, max(6, bbox["w"] - 5))
            cy = bbox["y"] + random.uniform(3, max(4, bbox["h"] - 3))
            try:
                await asyncio.wait_for(page.mouse.click(cx, cy), timeout=5)
            except asyncio.TimeoutError:
                await page.evaluate(f"() => {{ const el = document.elementFromPoint({cx}, {cy}); if (el) el.click(); }}")
            logger.info("Cookies aceitos via mouse ✔")
            await asyncio.sleep(0.5)
            return True
        return False
    except Exception:
        return False


async def warm_up(page, stake: float = 1.0) -> None:
    """Aquece a sessão: navega pelo site e preenche stake na caderneta.

    Fluxo: aceitar cookies → In-Play → clica qualquer odd → preenche stake → fecha caderneta → IP/FAV.
    """
    logger.info("Warm-up: iniciando...")
    try:
        # 0. Aceita cookies se aparecer
        await accept_cookies(page)

        # 1. Vai para In-Play (onde tem odds ao vivo)
        await page.evaluate("window.location.hash = '#/IP/'")
        await asyncio.sleep(3)
        await accept_cookies(page)
        await dismiss_popups(page)
        logger.info("Warm-up: In-Play carregado")

        # 2. Clica na primeira odd disponível para abrir a caderneta — via mouse
        odd_info = await page.evaluate("""() => {
            const odds = document.querySelectorAll('.gl-Participant_General');
            for (const el of odds) {
                const rect = el.getBoundingClientRect();
                if (rect.width < 5 || rect.height < 5) continue;
                if (el.closest('[class*="Suspended"]')) continue;
                if (el.className.includes('Suspended')) continue;
                const text = el.textContent.trim();
                if (text && parseFloat(text.replace(',', '.')) >= 1.01) {
                    return { text, x: rect.x, y: rect.y, w: rect.width, h: rect.height };
                }
            }
            return null;
        }""")

        if odd_info:
            ox = odd_info["x"] + random.uniform(3, max(4, odd_info["w"] - 3))
            oy = odd_info["y"] + random.uniform(3, max(4, odd_info["h"] - 3))
            try:
                await asyncio.wait_for(page.mouse.click(ox, oy), timeout=5)
            except asyncio.TimeoutError:
                await page.evaluate(f"() => {{ const el = document.elementFromPoint({ox}, {oy}); if (el) el.click(); }}")
            odd_clicked = odd_info["text"]
            logger.info("Warm-up: odd clicada ({}) — caderneta aberta", odd_clicked)
            await asyncio.sleep(2)

            # 3. Preenche o stake
            stake_loc = page.locator('div[contenteditable="true"].bsf-StakeBox_StakeValue-input').first
            try:
                await stake_loc.wait_for(state="attached", timeout=5000)
            except Exception:
                # Fallback selector
                stake_loc = page.locator('[class*="StakeBox"] [contenteditable="true"]').first
                await stake_loc.wait_for(state="attached", timeout=3000)

            try:
                await stake_loc.click(timeout=2000)
            except Exception:
                await stake_loc.evaluate("el => { el.focus(); el.click(); }")
            await page.keyboard.press("Control+a")
            await page.keyboard.press("Backspace")
            await page.keyboard.type(f"{stake:.2f}", delay=30)
            logger.info("Warm-up: stake preenchido R${:.2f}", stake)
            await asyncio.sleep(1)

            # 3b. Clica no toggle "Lembrar" com mouse humanizado (não JS puro)
            lembrar_bbox = await page.evaluate("""() => {
                // Procura por texto "Lembrar" / "Remember" e retorna coordenadas do toggle
                const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_ELEMENT, null);
                while (walker.nextNode()) {
                    const el = walker.currentNode;
                    const ownText = Array.from(el.childNodes)
                        .filter(n => n.nodeType === 3)
                        .map(n => n.textContent.trim()).join('');
                    if (ownText === 'Lembrar' || ownText === 'Remember') {
                        const parent = el.parentElement;
                        if (!parent) continue;
                        const toggle = parent.querySelector('[class*="Toggle"], [class*="toggle"], [class*="Switch"], input[type="checkbox"]');
                        const target = toggle || parent;
                        const r = target.getBoundingClientRect();
                        if (r.width > 0 && r.height > 0) {
                            return { x: r.x, y: r.y, w: r.width, h: r.height, via: toggle ? 'toggle' : 'parent' };
                        }
                    }
                }
                // Fallback: toggle na área do betslip
                const bsToggle = document.querySelector(
                    '[class*="bsf-"] [class*="Toggle"], [class*="bs-"] [class*="Toggle"], ' +
                    '[class*="RememberStake"], [class*="bsf-RememberStake"]'
                );
                if (bsToggle && bsToggle.getBoundingClientRect().width > 0) {
                    const r = bsToggle.getBoundingClientRect();
                    return { x: r.x, y: r.y, w: r.width, h: r.height, via: 'bs_toggle' };
                }
                return null;
            }""")
            if lembrar_bbox:
                lx = lembrar_bbox["x"] + random.uniform(3, max(4, lembrar_bbox["w"] - 3))
                ly = lembrar_bbox["y"] + random.uniform(3, max(4, lembrar_bbox["h"] - 3))
                try:
                    await asyncio.wait_for(page.mouse.click(lx, ly), timeout=5)
                except asyncio.TimeoutError:
                    await page.evaluate(f"() => {{ const el = document.elementFromPoint({lx}, {ly}); if (el) el.click(); }}")
                logger.info("Warm-up: 'Lembrar' clicado via mouse ({}) em ({:.0f},{:.0f})", lembrar_bbox["via"], lx, ly)
            else:
                logger.warning("Warm-up: toggle 'Lembrar' não encontrado")
            await asyncio.sleep(1)

            # 4. Remove a seleção (fecha a caderneta sem apostar) — via mouse
            close_bbox = await page.evaluate("""() => {
                // Tenta botão de remover seleção
                const removeBtn = document.querySelector(
                    '.bsf-RemoveButton, [class*="bs-RemoveButton"], ' +
                    '[class*="bss-RemoveButton"], [class*="RemoveSelection"]'
                );
                if (removeBtn && removeBtn.getBoundingClientRect().width > 0) {
                    const r = removeBtn.getBoundingClientRect();
                    return { x: r.x, y: r.y, w: r.width, h: r.height, via: 'remove_btn' };
                }
                // Tenta botão X de fechar betslip
                const closeBtn = document.querySelector(
                    '[class*="bsf-Close"], [class*="bs-Close"], ' +
                    '[class*="BetslipClose"], [class*="betslip"] [class*="Close"]'
                );
                if (closeBtn && closeBtn.getBoundingClientRect().width > 0) {
                    const r = closeBtn.getBoundingClientRect();
                    return { x: r.x, y: r.y, w: r.width, h: r.height, via: 'close_btn' };
                }
                // Fallback: odd selecionada
                const selected = document.querySelector('.gl-Participant_General.gl-Participant_General-active, .gl-Participant_General[class*="active"]');
                if (selected) {
                    const r = selected.getBoundingClientRect();
                    if (r.width > 0) return { x: r.x, y: r.y, w: r.width, h: r.height, via: 'deselect' };
                }
                return null;
            }""")
            if close_bbox:
                cx = close_bbox["x"] + random.uniform(2, max(3, close_bbox["w"] - 2))
                cy = close_bbox["y"] + random.uniform(2, max(3, close_bbox["h"] - 2))
                try:
                    await asyncio.wait_for(page.mouse.click(cx, cy), timeout=5)
                except asyncio.TimeoutError:
                    await page.evaluate(f"() => {{ const el = document.elementFromPoint({cx}, {cy}); if (el) el.click(); }}")
                logger.info("Warm-up: caderneta fechada via mouse ({})", close_bbox["via"])
            else:
                # Fallback: Escape
                await page.keyboard.press("Escape")
                logger.info("Warm-up: caderneta fechada via Escape")
            await asyncio.sleep(1)
        else:
            logger.warning("Warm-up: nenhuma odd disponível para clicar")

        # 5. Navega para In-Play/Favorites (página final)
        await page.evaluate("window.location.hash = '#/IP/FAV/'")
        await asyncio.sleep(2)
        await dismiss_popups(page)
        logger.info("Warm-up: In-Play/Favorites — pronto ✔")
    except Exception as e:
        logger.warning("Warm-up: erro (não fatal): {}", e)
        # Garante que termina no IP/FAV mesmo com erro
        try:
            await page.evaluate("window.location.hash = '#/IP/FAV/'")
            await asyncio.sleep(2)
        except Exception:
            pass


async def click_continuar(page) -> bool:
    """Clica no botão 'Continuar' pós-login se existir — via mouse humanizado."""
    logger.info("Verificando botão Continuar...")
    try:
        bbox = await page.evaluate("""() => {
            const walk = document.createTreeWalker(document.body, NodeFilter.SHOW_ELEMENT, null);
            while (walk.nextNode()) {
                const el = walk.currentNode;
                const dt = Array.from(el.childNodes)
                    .filter(n => n.nodeType === 3)
                    .map(n => n.textContent.trim()).join('');
                if ((dt === 'Continuar' || dt === 'Continue') &&
                    el.getBoundingClientRect().width > 50) {
                    const r = el.getBoundingClientRect();
                    return { x: r.x, y: r.y, w: r.width, h: r.height };
                }
            }
            return null;
        }""")
        if bbox:
            cx = bbox["x"] + random.uniform(10, max(11, bbox["w"] - 10))
            cy = bbox["y"] + random.uniform(5, max(6, bbox["h"] - 5))
            try:
                await asyncio.wait_for(page.mouse.click(cx, cy), timeout=5)
            except asyncio.TimeoutError:
                await page.evaluate(f"() => {{ const el = document.elementFromPoint({cx}, {cy}); if (el) el.click(); }}")
            logger.info("Botão 'Continuar' clicado via mouse!")
            await asyncio.sleep(2)
            return True
        return False
    except Exception:
        return False


async def auto_login(page, context) -> bool:
    """Login automático usando credenciais do .env — IDÊNTICO ao test_multi_bet.py."""
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
        try:
            await asyncio.wait_for(page.mouse.click(lx, ly), timeout=5)
        except asyncio.TimeoutError:
            await page.evaluate(f"() => {{ const el = document.elementFromPoint({lx}, {ly}); if (el) el.click(); }}")
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
            return True
        await asyncio.sleep(3)
    return False


async def full_session_init(browser, context, page, engine) -> bool:
    """Fluxo completo pós-abertura do browser — ESPELHA test_multi_bet.py (3/3).

    Ordem idêntica ao test_multi_bet.py:
    1. page.goto → login check
    2. Navega #/IP/FAV/
    3. dismiss overlays
    4. Geo check
    5. Espera gwt (até 60s)
    6. Warm-up (Lembrar stake)

    Returns: None = falha login, True/False = warmup_ok (Lembrar status)
    """
    logger.info("=" * 50)
    logger.info("INICIANDO SESSÃO COMPLETA (padrão test_multi_bet.py)")
    logger.info("=" * 50)

    # 1. page.goto — EXATAMENTE como test_multi_bet.py
    print("⏳ Navegando para Bet365...")
    try:
        await page.goto(
            "https://www.bet365.bet.br/#/IP/",
            wait_until="domcontentloaded",
            timeout=30000,
        )
        logger.info("Página Bet365 carregou (domcontentloaded)")
    except Exception as e:
        logger.warning("Navegação inicial lenta: {}", e)
    await asyncio.sleep(3)

    # 2. Check sessão: cookie pstk + DOM (EXATAMENTE como test_multi_bet.py)
    has_pstk = any(
        c["name"] == "pstk"
        for c in await context.cookies("https://www.bet365.bet.br")
    )

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
                const balEl = document.querySelector('.hm-Balance, [class*="Balance"]');
                const hasBal = balEl && balEl.textContent.trim().length > 0;
                return { hasLogin, hasMyBets, hasBal, btnCount: btns.length };
            }""")
            logger.debug("Session check: {}", dom_check)

            if dom_check["hasMyBets"] or dom_check["hasBal"]:
                session_active = True
                break
            if dom_check["hasLogin"] and dom_check["btnCount"] > 2:
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

    if not logged:
        logger.error("Não logado! Execute manual_login.py primeiro.")
        return None
    print("🔐 Login: ✅")

    # 3. Navega para #/IP/B18 (geo/gwt) — EXATAMENTE como test_multi_bet.py
    print("  Navegando para #/IP/B18 (geo/gwt)...")
    await page.evaluate("window.location.hash = '#/IP/B18'")
    await asyncio.sleep(3)

    # 4. Dismiss overlays (EXATAMENTE como test_multi_bet.py)
    ui_pre = UIBetPlacer(page)
    await asyncio.sleep(1)
    await ui_pre.dismiss_overlays()

    # 5. Geo check (EXATAMENTE como test_multi_bet.py)
    geo_ok = await engine.check_geolocation(page)
    if geo_ok:
        print(f"  📍 Geolocalização: OK (lat={geo_ok['latitude']:.4f})")
    else:
        print("  ⚠️ Geolocalização FALHOU — gwt pode não aparecer")

    # 6. Espera gwt (até 60s) — EXATAMENTE como test_multi_bet.py
    harvester = TokenHarvester()
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
            if (i + 1) % 30 == 0:
                # Re-navega apenas a cada 30s (menos agressivo)
                await page.evaluate("window.location.hash = '#/IP'")
                await asyncio.sleep(2)
                await page.evaluate("window.location.hash = '#/IP/B18'")
                await asyncio.sleep(3)
                print(f"  ... {i + 1}s — re-navegando para triggar GeoComply...")

    print(f"  gwt: {'OK' if tokens.gwt else 'AUSENTE'}  pstk: {'OK' if tokens.pstk else 'AUSENTE'}")

    if not tokens.gwt:
        print("  ⚠️ gwt AUSENTE — apostas provavelmente serão rejeitadas")
        print("  Continuando mesmo assim...")

    # 6b. Agora que gwt está pronto, navega para #/IP/FAV/ (favoritos — jogos no topo)
    print("  Navegando para #/IP/FAV/ (favoritos)...")
    await page.evaluate("window.location.hash = '#/IP/FAV/'")
    await asyncio.sleep(3)

    # 7. Dismiss overlays finais (pós-gwt)
    dismissed = await ui_pre.dismiss_overlays()
    if dismissed:
        print(f"  Modal/overlay removido: {dismissed} overlays")

    # 8. Warm-up via UIBetPlacer (Lembrar stake + CDP trusted events)
    #    Tenta primeiro em #/IP/FAV/ (sempre terá favoritos), fallback #/IP/B18
    ui = UIBetPlacer(page)
    print("  Warm-up: tentando em #/IP/FAV/...")
    warmup_ok = await ui.warm_up_stake(STAKE)
    if not warmup_ok:
        print("  Warm-up falhou em FAV — fallback #/IP/B18...")
        await page.evaluate("window.location.hash = '#/IP/B18'")
        await asyncio.sleep(3)
        await ui_pre.dismiss_overlays()
        warmup_ok = await ui.warm_up_stake(STAKE)
        # Volta para FAV
        await page.evaluate("window.location.hash = '#/IP/FAV/'")
        await asyncio.sleep(2)

    if warmup_ok:
        print(f"✅ Warm-up OK — stake R${STAKE:.2f} será lembrado (Lembrar ativo)")
    else:
        print(f"⚠️ Warm-up: 'Lembrar' não ativado — stake será preenchido manualmente")

    # 9. Popups finais
    n = await ui_pre.dismiss_overlays()
    if n:
        print(f"   Fechou {n} popup(s)")

    # 10. Scanner contínuo desativado — checker roda no keep-alive (~50s)
    # await ui.start_scanner(interval=2.0)
    print("✅ Checker ativo via keep-alive (escaneia jogadores a cada ~50s)")

    logger.info("SESSÃO PRONTA — #/IP/FAV/ — aguardando sinais")
    return warmup_ok


# ─── Browser Setup (mesmo do bet_daemon.py) ──────────────────────────────────

async def _close_browser(cm):
    """Fecha browser via __aexit__ do context manager (cleanup correto)."""
    if cm is None:
        return
    try:
        await cm.__aexit__(None, None, None)
    except Exception:
        pass


async def setup_browser():
    """Abre browser e retorna (browser, context, page, engine, cm).

    Segue EXATAMENTE o padrão do test_multi_bet.py (3/3 aceitas):
    - engine.launch() + engine.new_page() (geo injection automática)
    - load_cookies ANTES do goto
    - WS listener ANTES do goto
    - SEM interceptors de geocomply (atrapalham)

    Retorna cm (context manager) para cleanup correto via _close_browser(cm).
    """
    settings = get_settings()
    s = settings.browser
    engine = BrowserEngine(s)

    print("⏳ Abrindo browser...")
    cm = engine.launch()
    context = await cm.__aenter__()

    # Usa engine.new_page() — mesmo que test_multi_bet.py
    # Isso faz: grant_permissions + set_geolocation + _inject_geo_override
    page = await engine.new_page(context)
    page.set_default_timeout(30_000)
    print("   Page criada com geo injection automática")

    # Carrega cookies salvos (ANTES do goto, como test_multi_bet)
    cookies_loaded = await load_cookies(context)
    if cookies_loaded:
        print("   Cookies carregados de sessão anterior")

    # WS listener ANTES do goto (captura WS que abrem no page load)
    _logs_dir = Path(__file__).resolve().parent.parent / "logs"
    _logs_dir.mkdir(parents=True, exist_ok=True)
    _traffic_log_path = _logs_dir / "bet365_api_traffic.jsonl"
    _ws_full_log_path = _logs_dir / "bet365_ws_full.jsonl"

    def _log_traffic(entry: dict):
        import json as _json
        entry["_ts"] = time.strftime("%Y-%m-%dT%H:%M:%S")
        with open(_traffic_log_path, "a", encoding="utf-8") as f:
            f.write(_json.dumps(entry, ensure_ascii=False) + "\n")

    def _log_ws_full(entry: dict):
        import json as _json
        entry["_ts"] = time.strftime("%Y-%m-%dT%H:%M:%S")
        with open(_ws_full_log_path, "a", encoding="utf-8") as f:
            f.write(_json.dumps(entry, ensure_ascii=False) + "\n")

    async def _on_ws(ws):
        ws_url = ws.url
        logger.info("WebSocket aberto: {}", ws_url[:120])
        _log_traffic({"type": "ws_open", "url": ws_url})

        def _on_frame_sent(payload):
            if isinstance(payload, dict):
                raw = payload.get("payload", "")
            else:
                raw = payload
            if isinstance(raw, bytes):
                try:
                    raw = raw.decode("utf-8", errors="replace")
                except Exception:
                    raw = repr(raw)
            data_str = str(raw)[:5000]
            _log_traffic({"type": "ws_sent", "url": ws_url[:120], "data": data_str[:3000]})
            _log_ws_full({"type": "ws_sent", "url": ws_url[:120], "data": data_str})

        def _on_frame_received(payload):
            if isinstance(payload, dict):
                raw = payload.get("payload", "")
            else:
                raw = payload
            if isinstance(raw, bytes):
                try:
                    raw = raw.decode("utf-8", errors="replace")
                except Exception:
                    raw = repr(raw)
            data_str = str(raw)[:5000]
            _log_ws_full({"type": "ws_recv", "url": ws_url[:120], "data": data_str})
            s = data_str[:500].lower()
            if any(kw in s for kw in [
                "bet", "stake", "coupon", "receipt", "accept", "wager", "place",
                "odds", "price", "selection", "market", "handicap", "balance",
                "contentapi", "OD=", "PA=", "NA=",
            ]):
                _log_traffic({"type": "ws_recv", "url": ws_url[:120], "data": data_str[:3000]})

        ws.on("framesent", _on_frame_sent)
        ws.on("framereceived", _on_frame_received)

    page.on("websocket", _on_ws)
    logger.info("WS listener ativo (ANTES do goto)")

    # Retorna browser + context + page + engine + cm (para cleanup)
    browser = context.browser
    return browser, context, page, engine, cm


# ─── Main ────────────────────────────────────────────────────────────────────

async def list_groups(client: TelegramClient) -> None:
    """Lista grupos do Telegram para o usuário escolher."""
    print("\n📋 Seus grupos/canais:")
    print("-" * 50)
    async for dialog in client.iter_dialogs():
        if dialog.is_group or dialog.is_channel:
            print(f"  ID: {dialog.id:>15}  |  {dialog.name}")
    print("-" * 50)
    print("\nCole o ID do grupo no prompt abaixo:")
    group_id = input("group_id: ").strip()
    return int(group_id)


async def main() -> None:
    global STAKE

    # ─── Setup mode ──────────────────────────────────────────────────────
    if "--setup" in sys.argv:
        setup_wizard()
        return

    # ─── Test mode — simula sinal sem Telegram ───────────────────────────
    if "--test" in sys.argv:
        test_idx = sys.argv.index("--test")
        test_msg = sys.argv[test_idx + 1] if test_idx + 1 < len(sys.argv) else None
        if not test_msg:
            logger.error("Uso: --test \"mensagem do sinal\"")
            return

        signal = parse_signal(test_msg)
        if not signal:
            logger.error("Sinal NAO reconhecido pelo parser!")
            logger.info("Texto: {}", test_msg[:200])
            return

        logger.info(
            "Signal parsed: url={} odd={} market={} line={} teams={}",
            signal["url"],
            signal["odd"],
            signal.get("market"),
            signal.get("line"),
            signal.get("teams"),
        )

        browser, context, page, engine, cm = await setup_browser()
        if not page:
            return
        warmup_result = await full_session_init(browser, context, page, engine)
        if warmup_result is None:
            await _close_browser(cm)
            return
        try:
            ui = UIBetPlacer(page)
            bet_result = await ui.place_bet_by_signal(
                signal=signal,
                stake=STAKE,
                skip_if_remembered=bool(warmup_result),
                max_odd_drop=MAX_ODD_DROP,
            )
            if bet_result.success:
                logger.info("ACEITA! receipt={} odds={}", bet_result.bet_receipt, bet_result.odds)
            else:
                logger.info("Resultado: sr={} cs={} erro={}", bet_result.sr, bet_result.cs, bet_result.error)
        except Exception as e:
            logger.error("Erro no place_bet_by_signal: {}", e, exc_info=True)
        finally:
            await save_cookies(context)
            await _close_browser(cm)
        return

    # ─── Carrega config ──────────────────────────────────────────────────
    cfg = load_config()
    if not cfg.get("api_id") or not cfg.get("api_hash"):
        print("❌ Config não encontrada. Rode primeiro:")
        print("   python scripts/bet_telegram.py --setup")
        return

    safety = get_safety()

    # ─── Rich Dashboard ──────────────────────────────────────────────────
    dash = Dashboard()
    dash.print_banner(STAKE, safety.status_summary())

    # ─── SQLite BetStore ─────────────────────────────────────────────────
    store = BetStore()
    await store.open()
    await store.start_session()

    # ─── Conecta ao Telegram ─────────────────────────────────────────────
    client = TelegramClient(
        str(SESSION_FILE),
        cfg["api_id"],
        cfg["api_hash"],
    )
    await client.start()
    me = await client.get_me()
    console.print(f"📱 Telegram: {me.first_name} ({me.phone})")

    # ─── Resolve grupo(s) ───────────────────────────────────────────────
    group_ids = cfg.get("group_ids") or []
    if not group_ids:
        single = cfg.get("group") or cfg.get("group_id")
        if single:
            group_ids = [single]

    if not group_ids:
        gid = await list_groups(client)
        group_ids = [gid]
        cfg["group_ids"] = group_ids
        save_config(cfg)

    entities = []
    for gid in group_ids:
        try:
            ent = await client.get_entity(gid if isinstance(gid, int) else gid)
            name = getattr(ent, "title", str(gid))
            entities.append(ent)
            console.print(f"👥 Grupo: {name}")
        except Exception as e:
            console.print(f"⚠️ Grupo {gid} não encontrado: {e}")

    if not entities:
        console.print("❌ Nenhum grupo válido!")
        await store.close()
        await client.disconnect()
        return

    dash.set_groups([getattr(e, 'title', '?') for e in entities])

    # ─── Abre browser + fluxo completo (login → continuar → warm-up) ────
    browser, context, page, engine, cm = await setup_browser()
    if not page:
        await client.disconnect()
        return

    warmup_ok = await full_session_init(browser, context, page, engine)
    if warmup_ok is None:
        console.print("❌ Não logado! Execute manual_login.py primeiro.")
        await _close_browser(cm)
        await store.close()
        await client.disconnect()
        return

    dash.set_status("🟢 ATIVO")

    # UIBetPlacer — mesma instância usada nos sinais (CDP trusted events)
    ui = UIBetPlacer(page)

    # ─── Etapa 2: Token Harvester (interceptor DESLIGADO — DOM puro) ─────
    # NOTA: O BetInterceptor substitui o POST nativo por curl_cffi HTTP,
    # o que causa cs=2 (rejeição). O test_multi_bet.py que deu 3/3 NÃO
    # usava interceptor — a aposta ia pelo browser nativo (CDP trusted).
    harvester = TokenHarvester()
    interceptor = BetInterceptor(page, harvester)
    try:
        logger.info("Extraindo tokens iniciais (Etapa 2)...")
        await harvester.full_extract(page)
        harvester.start_sync_term_listener(page)
        await harvester.start_auto_refresh(page, interval=120)
        # interceptor.install() DESLIGADO — apostas vão pelo DOM/browser nativo
        # await interceptor.install()
        logger.info(
            "Etapa 2 ativo — gwt={}... interceptor OFF (DOM puro)",
            harvester.tokens.gwt[:20] if harvester.tokens else "?",
        )
    except (Exception, asyncio.CancelledError) as e:
        logger.warning("Etapa 2 setup parcial (continua com DOM puro): {}", e)

    # ─── Estado compartilhado para re-login ──────────────────────────────
    logout_event = asyncio.Event()

    async def on_logout_detected():
        """Callback do keep-alive quando detecta logout."""
        logger.warning("Logout detectado — sinalizando para re-login...")
        logout_event.set()

    keepalive_task = asyncio.create_task(
        keep_current_page_alive(page, on_logout=on_logout_detected, engine=engine, ui=ui)
    )

    # ─── Heartbeat Telegram ──────────────────────────────────────────────
    heartbeat = Heartbeat(client, chat_id=cfg.get("heartbeat_chat") or cfg.get("group") or entities[0].id)
    heartbeat.set_store(store)
    heartbeat.start()

    # ─── Spectator: screenshot loop em background ────────────────────────
    _spectator_path = Path(__file__).resolve().parent.parent / "tmp" / "spectator_live.png"
    _spectator_path.parent.mkdir(parents=True, exist_ok=True)
    _spectator_running = True

    async def _spectator_loop():
        while _spectator_running:
            try:
                await page.screenshot(path=str(_spectator_path), full_page=True)
            except Exception:
                pass
            await asyncio.sleep(0.3)

    spectator_task = asyncio.create_task(_spectator_loop())
    logger.info("Spectator ativo — tmp/spectator_live.png (rode spectator.py em outro terminal)")

    bet_count = 0
    processed_signals = {}
    _bet_semaphore = asyncio.Semaphore(MAX_CONCURRENT_BETS)
    _bet_active = asyncio.Event()  # sinaliza keep-alive para pausar durante aposta
    _session_start = time.time()
    group_names = ", ".join(getattr(e, "title", "?") for e in entities)
    console.print(f"\n🟢 ATIVO — Ouvindo sinais de: [bold]{group_names}[/]\n")

    # ─── Handler de mensagens (nova + editada) ───────────────────────────
    # Usa UIBetPlacer com CDP trusted events — mesmo fluxo do test_multi_bet.py (3/3)
    async def _handle_signal(event, is_edit=False):
        nonlocal bet_count, page
        text = event.raw_text

        if not text or len(text) < 5:
            return

        # Verifica se há slot disponível (multi-fixture)
        if _bet_semaphore._value <= 0:
            logger.info("[SKIP] {} apostas em andamento — sinal enfileirado", MAX_CONCURRENT_BETS)
            return

        msg_id = event.message.id

        tag = "EDIT" if is_edit else "NEW"
        preview = text.replace("\n", " | ")[:120]
        logger.info("[MSG {} id={}] {}", tag, msg_id, preview)

        signal = parse_signal(text)
        if not signal:
            if not is_edit:
                logger.info("[IGNORADA] Nao reconhecida como sinal")
            return

        # ── Filtro: somente basquete — rejeita futebol/esoccer ──
        _raw = signal.get("raw") or text
        _league = (signal.get("league") or "").lower()
        _teams = (signal.get("teams") or "").lower()
        _is_football = (
            "⚽" in _raw
            or "esoccer" in _league or "esoccer" in _teams or "esoccer" in _raw.lower()
            or "football" in _league or "football" in _teams
            or "futebol" in _league or "futebol" in _teams
            or "soccer" in _league
        )
        if _is_football:
            logger.info("[IGNORADA] Sinal de futebol/esoccer — somente basquete")
            return

        url = signal["url"]
        unique_id = url or f"no_url::{signal.get('teams') or signal.get('hc_team') or msg_id}"

        prev_url = processed_signals.get(msg_id)
        if prev_url == unique_id:
            logger.info("[SKIP] msg_id={} ja processada com mesmo sinal", msg_id)
            return
        processed_signals[msg_id] = unique_id

        if len(processed_signals) > 50:
            oldest = list(processed_signals.keys())[:-50]
            for k in oldest:
                del processed_signals[k]

        odd = signal["odd"]
        teams = signal["teams"] or signal.get("hc_team") or "?"
        league = signal["league"] or "?"

        market_type = signal.get("market") or "auto"
        line_val = signal.get("line")
        market_label = f"{market_type.upper()} {line_val}" if line_val else market_type.upper()

        logger.info("=" * 60)
        logger.info("SINAL RECEBIDO!")
        logger.info("Jogo: {} | Liga: {}", teams, league)
        logger.info("Mercado: {} | Odd: {}", market_label, odd or "auto")
        logger.info("Stake: R${:.2f}", STAKE)
        logger.info("=" * 60)

        # Rich dashboard: exibe sinal
        dash.print_signal(teams, league, market_label, odd or 0.0, STAKE)
        dash.record_signal(f"{teams} {market_label} @{odd}")
        bet_t0 = time.perf_counter()

        async with _bet_semaphore:
            try:
                # Safety check antes de apostar
                safety = get_safety()
                check = safety.check(stake=STAKE, odd=odd or 0.0)
                if not check.allowed:
                    dash.print_safety_block(check.reason.value, check.detail)
                    logger.warning(
                        "⛔ Safety BLOQUEOU aposta: {} — {}",
                        check.reason.value, check.detail,
                    )
                    return

                effective_stake = check.adjusted_stake or STAKE

                # ── Stake jitter (±5%) para anti-detecção ──
                effective_stake = safety.apply_jitter(effective_stake)
                logger.info("Stake com jitter: R${:.2f}", effective_stake)

                # Pausa keep-alive durante aposta (evita contention CDP)
                page._bet_active = _bet_active
                _bet_active.set()

                # ── Aposta via UIBetPlacer (CDP trusted events + retry backoff) ──
                bet_result = await asyncio.wait_for(
                    ui.place_bet_by_signal(
                        signal=signal,
                        stake=effective_stake,
                        skip_if_remembered=bool(warmup_ok),
                        max_odd_drop=MAX_ODD_DROP,
                        max_retries=3,
                    ),
                    timeout=45,  # increased for retries
                )

                bet_duration = time.perf_counter() - bet_t0
                profit = -effective_stake  # provisório (perda)

                if bet_result.success:
                    bet_count += 1
                    logger.info(
                        "APOSTA #{} ACEITA! sr=0 receipt={} odd={} ({:.1f}s)",
                        bet_count, bet_result.bet_receipt, bet_result.odds, bet_duration,
                    )
                    safety.record_result(profit)
                    safety.update_bankroll(profit)
                    dash.print_bet_result(True, receipt=bet_result.bet_receipt, odds=bet_result.odds)
                    heartbeat.record_bet(True, profit)
                elif bet_result.error:
                    logger.error("ERRO: {} (sr={} cs={})", bet_result.error, bet_result.sr, bet_result.cs)
                    dash.print_bet_result(False, sr=bet_result.sr, error=bet_result.error)
                    heartbeat.record_error(bet_result.error)
                else:
                    logger.warning("Rejeitada: sr={} cs={}", bet_result.sr, bet_result.cs)
                    dash.print_bet_result(False, sr=bet_result.sr)

                # ── SQLite: registra aposta ──
                try:
                    await store.log_bet(
                        signal_raw=signal.get("raw", "")[:500],
                        player=signal.get("hc_team") or teams,
                        teams=teams,
                        market=market_type,
                        line=line_val if isinstance(line_val, (int, float)) else None,
                        odd_signal=odd,
                        odd_page=float(bet_result.odds) if bet_result.odds else None,
                        stake=effective_stake,
                        receipt=bet_result.bet_receipt,
                        sr=bet_result.sr,
                        cs=bet_result.cs,
                        success=bet_result.success,
                        profit=profit if bet_result.success else 0.0,
                        duration_s=bet_duration,
                        error=bet_result.error,
                    )
                except Exception as e_store:
                    logger.warning("BetStore log falhou: {}", e_store)

                # ── Dashboard: registra aposta ──
                dash.record_bet({
                    "time": datetime.utcnow().strftime("%H:%M"),
                    "player": signal.get("hc_team") or teams,
                    "market": market_label,
                    "odd": odd or 0.0,
                    "stake": effective_stake,
                    "success": bet_result.success,
                    "profit": profit if bet_result.success else 0.0,
                })

                # ── Hard reset entre apostas ──
                _bet_active.clear()  # libera keep-alive
                await page.keyboard.press("Escape")
                await asyncio.sleep(0.3)
                await page.evaluate("window.location.hash = '#/IP'")
                await asyncio.sleep(1.0)
                await page.evaluate("window.location.hash = '#/IP/FAV/'")
                await asyncio.sleep(1.5)

            except asyncio.TimeoutError:
                _bet_active.clear()
                logger.error("TIMEOUT GLOBAL (45s) — resetando para #/IP/FAV/")
                heartbeat.record_error("TIMEOUT GLOBAL 45s")
                try:
                    for _ in range(3):
                        await page.keyboard.press("Escape")
                        await asyncio.sleep(0.2)
                    await page.evaluate("window.location.hash = '#/IP'")
                    await asyncio.sleep(1.0)
                    await page.evaluate("window.location.hash = '#/IP/FAV/'")
                    await asyncio.sleep(1.5)
                    await ui.dismiss_overlays()
                except Exception:
                    pass

            except Exception as e:
                _bet_active.clear()
                logger.error("Exceção no place_bet_by_signal: {}", e, exc_info=True)
                heartbeat.record_error(str(e)[:100])
                dash.record_error(str(e))
                try:
                    await page.evaluate("window.location.hash = '#/IP/FAV/'")
                    await asyncio.sleep(1.5)
                except Exception:
                    pass

        dash.print_status_line(bet_count)
        logger.info("Ouvindo sinais... (apostas: {})", bet_count)

    @client.on(events.NewMessage(chats=entities))
    async def on_new(event):
        try:
            await _handle_signal(event, is_edit=False)
        except Exception as e:
            logger.error("ERRO CRÍTICO no handler NewMessage: {}", e, exc_info=True)

    @client.on(events.MessageEdited(chats=entities))
    async def on_edit(event):
        try:
            await _handle_signal(event, is_edit=True)
        except Exception as e:
            logger.error("ERRO CRÍTICO no handler MessageEdited: {}", e, exc_info=True)

    # ─── Loop principal com re-login automático ──────────────────────────
    async def _re_login_loop():
        """Monitora logout e refaz o fluxo completo."""
        nonlocal browser, context, page, engine, keepalive_task, warmup_ok, ui, cm

        while True:
            # Espera sinal de logout ou desconexão
            await logout_event.wait()
            logout_event.clear()

            logger.info("=" * 50)
            logger.info("RE-LOGIN: Refazendo fluxo completo...")
            logger.info("=" * 50)

            # Cancela keep-alive antigo
            keepalive_task.cancel()

            # Tenta re-inicializar na mesma page
            try:
                warmup_ok = await full_session_init(browser, context, page, engine)
                if warmup_ok is not None:
                    ui = UIBetPlacer(page)
                    logger.info("RE-LOGIN: Sucesso! Retomando operação.")
                    # Re-instala Etapa 2 (harvester only — interceptor OFF)
                    try:
                        await harvester.full_extract(page)
                    except Exception as e2:
                        logger.warning("RE-LOGIN: Etapa 2 re-setup parcial: {}", e2)
                    keepalive_task = asyncio.create_task(
                        keep_current_page_alive(page, on_logout=on_logout_detected, engine=engine, ui=ui)
                    )
                    continue
            except Exception as e:
                logger.warning("RE-LOGIN: Falha na mesma page: {}", e)

            # Se falhou, fecha tudo e reabre o browser
            try:
                await save_cookies(context)
            except Exception:
                pass
            await _close_browser(cm)

            logger.info("RE-LOGIN: Reabrindo browser...")
            browser, context, page, engine, cm = await setup_browser()
            if not page:
                logger.error("RE-LOGIN: Falha ao reabrir browser! Encerrando.")
                return

            warmup_ok = await full_session_init(browser, context, page, engine)
            if warmup_ok is None:
                logger.error("RE-LOGIN: Não conseguiu logar. Execute manual_login.py.")
                return

            ui = UIBetPlacer(page)

            # Re-instala Etapa 2 no novo browser (interceptor OFF — DOM puro)
            try:
                harvester._sync_term_listener_installed = False
                await harvester.full_extract(page)
                harvester.start_sync_term_listener(page)
                await harvester.start_auto_refresh(page, interval=120)
            except Exception as e2:
                logger.warning("RE-LOGIN: Etapa 2 re-setup parcial: {}", e2)

            keepalive_task = asyncio.create_task(
                keep_current_page_alive(page, on_logout=on_logout_detected, engine=engine, ui=ui)
            )
            logger.info("RE-LOGIN: Browser reaberto e logado. Retomando operação.")

    relogin_task = asyncio.create_task(_re_login_loop())

    # ─── Roda até Ctrl+C ────────────────────────────────────────────────
    try:
        await client.run_until_disconnected()
    except KeyboardInterrupt:
        console.print("\n👋 Encerrando...")
    finally:
        _spectator_running = False
        spectator_task.cancel()
        relogin_task.cancel()
        keepalive_task.cancel()
        heartbeat.stop()
        # Fecha sessão SQLite com stats
        try:
            uptime_s = time.time() - _session_start
            await store.end_session(
                bets_placed=bet_count,
                bets_won=dash._win_count,
                pnl=dash._daily_pnl,
                uptime_s=uptime_s,
            )
            await store.close()
        except Exception:
            pass
        try:
            await save_cookies(context)
        except Exception:
            pass
        await _close_browser(cm)
        try:
            await client.disconnect()
        except Exception:
            pass


if __name__ == "__main__":
    asyncio.run(main())
