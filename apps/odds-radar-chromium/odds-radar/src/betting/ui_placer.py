"""UIBetPlacer — coloca apostas via automação UI com eventos trusted (CDP).

Baseado no fluxo validado do test_placebet_gwt.py (Session 4e):
  Login → gwt → click odds → addbet sr=0 → fill stake → Place Bet → placebet sr=0

Regras de ouro:
  - SEMPRE page.mouse.click() para botões/odds (trusted CDP events)
  - SEMPRE locator.fill() para inputs de texto (imune a foco/mouse)
  - NUNCA JS dispatchEvent click (isTrusted:false → bet365 ignora)
  - SEMPRE limpar betslip antes de clicar novas odds
"""
from __future__ import annotations

import asyncio
import json
import time as _time
from dataclasses import dataclass, field
from typing import Any

from src.utils.logger import get_logger

logger = get_logger(__name__)

# Seletores validados — Session 4e
SEL_STAKE = ".bsf-StakeBox_StakeValue-input"              # contenteditable div, 60x25px
SEL_STAKE_ALT = [".bss-StakeBox_StakeValue", '[class*="StakeBox"][contenteditable]']
SEL_PLACE_BET = ".bsf-PlaceBetButton"                      # 225x50px
SEL_PLACE_BET_ALT = [".bss-PlaceBetButton", '[class*="PlaceBet"]']
SEL_ODDS_CELL = '[class*="Participant"][class*="Odds"]'     # odds cells na listagem
SEL_RECEIPT = ".bsf-ReceiptContent, .bs-Receipt"
SEL_ERROR = ".bsf-ErrorMessage, .bsf-NormalMessage"
SEL_ACCEPT_ODDS = ".bsf-AcceptButton, .bsf-AcceptOdds"
SEL_REMOVE = '[class*="RemoveSelection"], [class*="DeleteSelection"], .bss-RemoveButton'


@dataclass
class UIBetResult:
    success: bool = False
    sr: int = -1                # server result (0 = accepted)
    cs: int = -1                # completion status
    bet_receipt: str = ""       # receipt ID (ex: XF9748854581F)
    bg: str = ""                # betGuid from addbet
    cc: str = ""                # challenge from addbet
    pc: str = ""                # precondition from addbet
    odds: str = ""              # confirmed odds from server
    fixture_id: str = ""
    selection_id: str = ""
    error: str = ""
    placebet_request: dict = field(default_factory=dict)
    placebet_response: dict = field(default_factory=dict)


class UIBetPlacer:
    """Coloca apostas no Bet365 via automação UI com eventos CDP trusted."""

    def __init__(self, page):
        self._page = page
        # Pre-cache de odds: { "PLAYER_NAME": [{ x, y, oddVal, hcText, col, ts }, ...] }
        self._odds_cache: dict[str, list[dict]] = {}
        self._cache_ts: float = 0.0  # timestamp do último scan
        self._scanner_task: asyncio.Task | None = None

    # ─── Reliable Click (mouse.click + fallback selector) ───────────────

    async def _reliable_click(
        self,
        x: float,
        y: float,
        *,
        fallback_selector: str | None = None,
        use_marker: bool = False,
        timeout: float = 1.5,
        description: str = "",
    ) -> None:
        """Clica via mouse.click com fallback para JS click no elemento correto.

        Ordem de fallback:
        1. page.mouse.click(x, y) — CDP trusted event (pode travar no Camoufox)
        2. Se timeout:
           a. Se use_marker=True: clica em [data-sheva-target] (marcado por find_odds_by_player)
           b. Se fallback_selector: clica via querySelector(selector)
           c. Último recurso: elementFromPoint(x, y)
        """
        page = self._page
        try:
            await asyncio.wait_for(page.mouse.click(x, y), timeout=timeout)
            return
        except asyncio.TimeoutError:
            logger.warning(
                "mouse.click timeout ({:.1f}s) em ({:.0f}, {:.0f}) {} — fallback JS",
                timeout, x, y, description,
            )

        # Fallback: click JS no elemento correto (não em elementFromPoint cego)
        if use_marker:
            clicked = await page.evaluate("""() => {
                const el = document.querySelector('[data-sheva-target]');
                if (el) { el.click(); return true; }
                return false;
            }""")
            if clicked:
                return

        if fallback_selector:
            clicked = await page.evaluate(f"""() => {{
                const el = document.querySelector('{fallback_selector}');
                if (el) {{ el.click(); return true; }}
                return false;
            }}""")
            if clicked:
                return

        # Último recurso: elementFromPoint (pode pegar elemento errado)
        logger.warning("Fallback elementFromPoint({:.0f}, {:.0f}) — risco de elemento errado", x, y)
        await page.evaluate(f"""() => {{
            const el = document.elementFromPoint({x}, {y});
            if (el) el.click();
        }}""")

    # ─── Odds Pre-Cache Scanner ─────────────────────────────────────────

    async def scan_odds_cache(self) -> int:
        """Escaneia TODAS as odds visíveis e armazena no cache por jogador.

        Retorna quantidade de jogadores mapeados.
        """
        data = await self._page.evaluate(r"""() => {
            const rows = document.querySelectorAll(
                '[class*="ovm-Fixture"], [class*="ovm-FixtureDetail"], ' +
                '[class*="gl-Market_General"], [class*="rcl-MarketCouponFixtureLinkBase"]'
            );
            const result = [];
            for (const row of rows) {
                const odds = row.querySelectorAll('.gl-Participant_General');
                if (odds.length < 2 || odds.length > 30) continue;

                // Extrai nomes dos jogadores
                const nameEls = row.querySelectorAll(
                    '[class*="ParticipantName"], [class*="TeamName"], ' +
                    '[class*="FixtureParticipant"], [class*="rcl-ParticipantFixtureDetails_TeamNames"]'
                );
                const names = [];
                for (const ne of nameEls) {
                    const t = ne.textContent.trim().toUpperCase();
                    if (t && t.length > 1 && !names.includes(t)) names.push(t);
                }
                if (names.length < 2) {
                    const fullText = row.textContent || '';
                    const vsMatch = fullText.match(/([A-Z][A-Z\s]+?)\s+(?:v|vs|x)\s+([A-Z][A-Z\s]+)/i);
                    if (vsMatch) {
                        const n1 = vsMatch[1].trim().toUpperCase();
                        const n2 = vsMatch[2].trim().toUpperCase();
                        if (!names.includes(n1)) names.push(n1);
                        if (!names.includes(n2)) names.push(n2);
                    }
                }

                for (let i = 0; i < odds.length; i++) {
                    const el = odds[i];
                    const rect = el.getBoundingClientRect();
                    if (rect.width < 5 || rect.height < 5) continue;
                    if (el.closest('[class*="Suspended"]') || el.className.includes('Suspended')) continue;

                    const oddsSpan = el.querySelector('[class*="_Odds"]');
                    const hcSpan = el.querySelector('[class*="_Handicap"]');
                    const oddText = oddsSpan ? oddsSpan.textContent.trim() : '';
                    const hcText = hcSpan ? hcSpan.textContent.trim() : '';

                    if (!oddText) continue;
                    const oddMatch = oddText.match(/(\d+[.,]\d+)/);
                    if (!oddMatch) continue;
                    const oddVal = parseFloat(oddMatch[1].replace(',', '.'));

                    result.push({
                        names: names,
                        idx: i,
                        oddVal: oddVal,
                        hcText: hcText,
                        x: rect.x + rect.width / 2,
                        y: rect.y + rect.height / 2,
                    });
                }
            }
            return result;
        }""")

        if not data:
            return 0

        cache: dict[str, list[dict]] = {}
        now = _time.monotonic()
        for item in data:
            for name in item.get("names", []):
                if name not in cache:
                    cache[name] = []
                cache[name].append({
                    "x": item["x"],
                    "y": item["y"],
                    "oddVal": item["oddVal"],
                    "hcText": item["hcText"],
                    "idx": item["idx"],
                    "names": item["names"],
                    "ts": now,
                })
        self._odds_cache = cache
        self._cache_ts = now
        return len(cache)

    def lookup_cache(
        self,
        player_name: str,
        market: str = "hc",
        line: float | None = None,
        target_odd: float | None = None,
        teams: str = "",
    ) -> dict | None:
        """Busca no cache pre-computado. Retorna dict compatível com find_odds_by_player."""
        if not self._odds_cache or (_time.monotonic() - self._cache_ts) > 5:
            return None

        player_upper = player_name.strip().upper()
        entries = self._odds_cache.get(player_upper)
        if not entries:
            for key, val in self._odds_cache.items():
                if player_upper in key or key in player_upper:
                    entries = val
                    break
        if not entries:
            return None

        team_names = []
        if teams and " vs " in teams:
            team_names = [t.strip().upper() for t in teams.split(" vs ", 1)]

        candidates = []
        line_str = str(line) if line is not None else None

        for e in entries:
            if len(team_names) >= 2:
                entry_text = " ".join(n.upper() for n in e.get("names", []))
                if not all(t in entry_text for t in team_names):
                    continue

            hc = e.get("hcText", "")

            if market == "hc" and line_str:
                import re
                line_num = float(line_str)
                has_plus = "+" in hc
                patterns = [f"+{line_str}", f"-{line_str}",
                            f"+{line_str.replace('.', ',')}",
                            f"-{line_str.replace('.', ',')}"]
                exact = any(p in hc for p in patterns)
                if exact and line_num >= 0 and not has_plus:
                    continue
                if not exact:
                    m = re.search(r'([+-]?\d+[.,]\d+)', hc)
                    if m:
                        cell_line = abs(float(m.group(1).replace(',', '.')))
                        if abs(cell_line - abs(line_num)) > 3:
                            continue
                        if line_num >= 0 and not has_plus:
                            continue
                    else:
                        continue
                candidates.append({**e, "exact": exact})
            else:
                candidates.append({**e, "exact": False})

        if not candidates:
            return None

        if target_odd:
            candidates.sort(key=lambda c: (
                0 if c.get("exact") else 1,
                abs(c["oddVal"] - target_odd),
            ))

        best = candidates[0]
        return {
            "x": best["x"],
            "y": best["y"],
            "oddVal": best["oddVal"],
            "text": f"{best.get('hcText', '')} {best['oddVal']}",
            "player": player_name,
            "col": market,
            "total": len(candidates),
            "from_cache": True,
        }

    async def start_scanner(self, interval: float = 2.0):
        """Inicia loop background que escaneia odds a cada `interval` segundos."""
        if self._scanner_task and not self._scanner_task.done():
            return

        async def _loop():
            while True:
                try:
                    n = await self.scan_odds_cache()
                    if n > 0:
                        logger.debug("Scanner: {} jogadores no cache", n)
                except Exception:
                    pass
                await asyncio.sleep(interval)

        self._scanner_task = asyncio.create_task(_loop())
        logger.info("Odds scanner iniciado (intervalo={:.1f}s)", interval)

    def stop_scanner(self):
        """Para o scanner background."""
        if self._scanner_task and not self._scanner_task.done():
            self._scanner_task.cancel()
            self._scanner_task = None

    # ─── Checker: Log de jogadores visíveis ──────────────────────────────

    async def check_visible_players(self) -> list[dict]:
        """Escaneia e loga os jogadores/jogos visíveis na overview.

        Retorna lista de fixtures com jogadores e odds visíveis.
        Também atualiza o cache interno para lookup rápido.
        """
        n = await self.scan_odds_cache()
        if n == 0:
            return []

        # Monta resumo agrupado por fixture
        fixtures: list[dict] = []
        seen_pairs: set[str] = set()

        for player, entries in self._odds_cache.items():
            for e in entries:
                names = e.get("names", [])
                pair_key = " vs ".join(sorted(n.upper() for n in names)) if names else player
                if pair_key in seen_pairs:
                    continue
                seen_pairs.add(pair_key)

                # Coleta todas as odds deste fixture
                fixture_odds = []
                for n2 in names:
                    n2_upper = n2.strip().upper()
                    for oe in self._odds_cache.get(n2_upper, []):
                        fixture_odds.append({
                            "hc": oe.get("hcText", ""),
                            "odd": oe.get("oddVal", 0),
                        })

                fixtures.append({
                    "players": " vs ".join(names) if names else player,
                    "odds_count": len(fixture_odds),
                    "sample": fixture_odds[:4],
                })

        if fixtures:
            summary = " | ".join(
                f"{f['players']} ({f['odds_count']}odds)"
                for f in fixtures[:8]
            )
            logger.info("Checker: {} fixtures visíveis — {}", len(fixtures), summary)

        return fixtures

    # ─── Dismiss Overlays ────────────────────────────────────────────────

    async def dismiss_overlays(self) -> int:
        """Fecha modais (ex: 'Continuar') e remove overlays bloqueadores do DOM.

        Usa Playwright locators para achar "Continuar" (robusto) + CDP mouse.click.
        Depois REMOVE overlays do DOM (el.remove()) — NÃO usa CSS neutralize,
        que mantém o estado do SPA bloqueado.
        """
        removed = 0

        # ── 1. Clica "Continuar" / "Continue" via Playwright locator ──
        # IMPORTANTE: filtra apenas elementos visíveis na viewport (y < 1100)
        # para não clicar em "Continuar" de rodapé/termos fora da vista
        for label in ["Continuar", "Continue"]:
            clicked_once = False
            for _ in range(2):
                try:
                    loc = self._page.get_by_text(label)
                    count = await loc.count()
                    if count == 0:
                        break
                    clicked = False
                    for idx in range(min(count, 5)):
                        try:
                            box = await loc.nth(idx).bounding_box()
                            if not box:
                                continue
                            # Deve estar na viewport visível e ter tamanho razoável
                            if (box["width"] > 30 and box["height"] > 15
                                    and box["y"] > 0 and box["y"] < 1100
                                    and box["x"] > 0 and box["x"] < 1400):
                                cx = box["x"] + box["width"] / 2
                                cy = box["y"] + box["height"] / 2
                                await self._reliable_click(
                                    cx, cy, timeout=1.5,
                                    description=f"modal-{label}",
                                )
                                removed += 1
                                clicked = True
                                clicked_once = True
                                logger.info("Modal '{}' fechado via CDP click em ({:.0f}, {:.0f})", label, cx, cy)
                                await asyncio.sleep(0.5)
                                break
                        except Exception:
                            continue
                    if not clicked:
                        break
                except Exception:
                    break
            if clicked_once:
                # Verifica se ainda está visível após click (evita loop infinito)
                await asyncio.sleep(0.2)

        # ── 2. Remove overlays do DOM (el.remove()) ──
        # APENAS seletores exatos do modal manager — seletores amplos
        # como [class*="CondensedOverlay"] removem elementos ESTRUTURAIS da grade de odds
        overlay_count = await self._page.evaluate("""() => {
            let count = 0;
            const sels = [
                '.wcl-ModalManager_DarkWash',
                '.wcl-ModalManager_LightWash',
                '.g5-PopupManager_ClickMask',
            ];
            for (const sel of sels) {
                for (const el of document.querySelectorAll(sel)) {
                    el.remove();
                    count++;
                }
            }
            return count;
        }""")
        removed += overlay_count

        if removed:
            logger.info("Overlays/modais tratados: {}", removed)
            await asyncio.sleep(0.2)
        return removed

    # ─── Bet Slip Cleanup ────────────────────────────────────────────────

    async def clean_betslip(self) -> int:
        """Remove todas as seleções do betslip via CDP trusted clicks."""
        page = self._page
        removed = 0
        prev_count = -1
        for _ in range(5):  # Máximo 5 seleções reais
            # Conta quantas seleções existem ANTES de clicar
            cur_count = await page.evaluate(f"""() => {{
                return document.querySelectorAll('{SEL_REMOVE}').length;
            }}""")
            if cur_count == 0:
                break
            # Se a contagem não mudou após o click anterior, estamos em loop
            if cur_count == prev_count:
                logger.warning("clean_betslip: contagem não mudou ({}), parando", cur_count)
                break
            prev_count = cur_count

            btn = await page.evaluate(f"""() => {{
                const el = document.querySelector('{SEL_REMOVE}');
                if (!el) return null;
                const r = el.getBoundingClientRect();
                if (r.width <= 0 || r.height <= 0) return null;
                return {{ x: r.x + r.width / 2, y: r.y + r.height / 2 }};
            }}""")
            if not btn:
                break
            await self._reliable_click(
                btn["x"], btn["y"],
                fallback_selector=SEL_REMOVE,
                timeout=1.5,
                description="remove-selection",
            )
            removed += 1
            await asyncio.sleep(0.1)
        if removed:
            logger.info("Betslip limpo ({} seleções removidas via CDP)", removed)
            await asyncio.sleep(0.1)
        return removed

    # ─── Navigate to Fixture ─────────────────────────────────────────────

    async def navigate_to_fixture(self, fixture_id: str) -> bool:
        """Navega para a página do evento via SPA hash navigation."""
        current_hash = await self._page.evaluate("() => window.location.hash")
        target = f"#/IP/EV{fixture_id}"
        if target in current_hash:
            return True

        # Tenta navegar até 3 vezes (SPA pode não responder de primeira)
        for attempt in range(3):
            await self._page.evaluate(f"window.location.hash = '{target}'")
            await asyncio.sleep(1.5)
            new_hash = await self._page.evaluate("() => window.location.hash")
            if fixture_id in new_hash:
                logger.info("Navegou para fixture {} (tentativa {})", fixture_id, attempt + 1)
                return True
            logger.warning("Tentativa {}: hash={}, esperado {}", attempt + 1, new_hash, target)

        # Fallback: navega para In-Play eSports primeiro, depois para o fixture
        await self._page.evaluate("window.location.hash = '#/IP/B18'")
        await asyncio.sleep(1)
        await self._page.evaluate(f"window.location.hash = '{target}'")
        await asyncio.sleep(1.5)
        new_hash = await self._page.evaluate("() => window.location.hash")
        ok = fixture_id in new_hash
        if not ok:
            logger.warning("Navegação para fixture {} falhou após fallback (hash={})", fixture_id, new_hash)
        return ok

    async def go_back_to_esports(self) -> None:
        """Volta para a listagem de eSports In-Play."""
        await self._page.evaluate("window.location.hash = '#/IP/B18'")
        await asyncio.sleep(1.5)

    # ─── Find Odds Cell ──────────────────────────────────────────────────

    async def find_odds_cell(
        self,
        market: str = "hc",
        handicap_line: float | None = None,
        side: str | None = None,
    ) -> dict | None:
        """Encontra a odds cell correta no DOM do evento aberto.

        Args:
            market: 'hc' (handicap), 'over', 'under'
            handicap_line: Linha do handicap (ex: 3.5, 5.5)
            side: 'home' ou 'away' para HC; None para over/under

        Returns:
            Dict com {x, y, text} ou None se não encontrado.
        """
        page = self._page

        # Estratégia 1: Busca dentro da página do evento aberto (mercados expandidos)
        result = await page.evaluate("""(args) => {
            const { market, line, side } = args;

            // Mapa de nomes de mercados em PT-BR e EN
            const hcNames = ['handicap', 'asian handicap', 'handicap asiático', 'alternativo'];
            const ouNames = ['total', 'mais/menos', 'over', 'under', 'pontos mais/menos'];

            const isHC = market === 'hc';
            const isOver = market === 'over';
            const isUnder = market === 'under';
            const marketNames = isHC ? hcNames : ouNames;
            const lineStr = line !== null && line !== undefined ? String(Math.abs(line)) : null;

            // Busca seções de mercado pelo título/header
            const headers = document.querySelectorAll(
                '[class*="MarketGroup"] [class*="Header"], ' +
                '[class*="MarketGroup"] [class*="Title"], ' +
                '[class*="MarketFixture"] [class*="Header"], ' +
                '[class*="HeaderOpen"], [class*="MarketTitle"]'
            );

            let bestSection = null;
            for (const h of headers) {
                const ht = (h.textContent || '').toLowerCase();
                const matchesMarket = marketNames.some(n => ht.includes(n));
                if (matchesMarket) {
                    bestSection = h.closest('[class*="MarketGroup"]')
                        || h.closest('[class*="MarketFixture"]')
                        || h.parentElement;
                    break;
                }
            }

            // Se encontrou seção do mercado, busca odds dentro dela
            const searchRoot = bestSection || document;
            const cells = searchRoot.querySelectorAll(
                '[class*="Participant"][class*="Odds"], ' +
                '[class*="OddsContainer"] [class*="Odds"], ' +
                '.sgl-ParticipantOddsOnly80_Odds'
            );

            const candidates = [];
            for (const c of cells) {
                const t = c.textContent?.trim();
                if (!t || t === '-' || t === '') continue;
                const b = c.getBoundingClientRect();
                if (b.width <= 0 || b.height <= 0 || b.top < 50) continue;

                // Tenta encontrar handicap label na mesma row
                let hcLabel = '';
                let rowText = '';
                const row = c.closest(
                    '[class*="Row"], [class*="MarketLine"], tr, [class*="Coupon"], [class*="Participant"]'
                );
                if (row) {
                    rowText = (row.textContent || '').trim();
                    const hcEls = row.querySelectorAll(
                        '[class*="Handicap"], [class*="Header"], [class*="Label"], [class*="handicap"]'
                    );
                    for (const h of hcEls) {
                        const ht = h.textContent?.trim();
                        if (ht && ht.match(/[+-]?\\d+\\.?\\d*/)) {
                            hcLabel = ht;
                            break;
                        }
                    }

                    // Fallback: scan row text for handicap pattern
                    if (!hcLabel && rowText) {
                        const m = rowText.match(/([+-]?\\d+\\.5)/);
                        if (m) hcLabel = m[1];
                    }
                }

                // Determina position (home=first, away=last na row)
                let position = 'unknown';
                if (row) {
                    const allOdds = row.querySelectorAll(
                        '[class*="Participant"][class*="Odds"], ' +
                        '[class*="OddsContainer"] [class*="Odds"], ' +
                        '.sgl-ParticipantOddsOnly80_Odds'
                    );
                    const oddsArr = Array.from(allOdds).filter(
                        e => e.getBoundingClientRect().width > 0
                    );
                    const idx = oddsArr.indexOf(c);
                    if (idx === 0) position = 'home';
                    else if (idx === oddsArr.length - 1) position = 'away';
                }

                candidates.push({
                    text: t, x: b.x + b.width / 2, y: b.y + b.height / 2,
                    handicap: hcLabel, position, rowText: rowText.substring(0, 120),
                });
            }

            if (candidates.length === 0) return null;

            // Filtro 1: match pela linha de handicap
            let filtered = candidates;
            if (lineStr) {
                const lineMatches = candidates.filter(
                    c => c.handicap && c.handicap.includes(lineStr)
                );
                if (lineMatches.length > 0) filtered = lineMatches;
            }

            // Filtro 2: match pelo side (home/away)
            if (side && filtered.length > 1) {
                const sideMatches = filtered.filter(c => c.position === side);
                if (sideMatches.length > 0) filtered = sideMatches;
            }

            // Filtro 3: para Over/Under, selecionar pelo label
            if ((isOver || isUnder) && filtered.length > 1) {
                const target = isOver ? 'home' : 'away'; // Over = first, Under = second
                const ouMatches = filtered.filter(c => c.position === target);
                if (ouMatches.length > 0) filtered = ouMatches;
            }

            return filtered[0];
        }""", {"market": market, "line": handicap_line, "side": side})
        return result

    async def find_all_visible_odds(self) -> list[dict]:
        """Lista todas as odds cells clicáveis visíveis na página.

        Prioriza containers gl-Participant_General (botões 148x51) sobre
        spans de texto ovm-*_Odds (27x19) que não são clicáveis.
        """
        return await self._page.evaluate("""() => {
            // Seletores em ordem de prioridade (containers > spans)
            const sels = [
                '.gl-Participant_General',
                '[class*="ParticipantOddsOnly"][class*="gl-Participant"]',
                '[class*="Participant"][class*="Odds"]',
            ];
            const seen = new Set();
            const r = [];
            for (const sel of sels) {
                const cells = document.querySelectorAll(sel);
                for (const c of cells) {
                    const b = c.getBoundingClientRect();
                    if (b.width < 30 || b.height < 20 || b.top < 50) continue;
                    const t = c.textContent?.trim();
                    if (!t || t === '-') continue;
                    // Deduplica por coordenadas (arredondado a 5px)
                    const key = `${Math.round(b.x/5)*5},${Math.round(b.y/5)*5}`;
                    if (seen.has(key)) continue;
                    seen.add(key);
                    r.push({text: t, x: b.x + b.width / 2, y: b.y + b.height / 2,
                            w: b.width, h: b.height, className: c.className.substring(0, 60)});
                    if (r.length >= 20) break;
                }
                if (r.length >= 20) break;
            }
            return r;
        }""")

    # ─── Click Odds (trusted CDP mouse event) ────────────────────────────

    async def click_odds(self, x: float, y: float) -> None:
        """Clica em uma odds cell via mouse.click com fallback para marker/selector.

        Se find_odds_by_player marcou o elemento com data-sheva-target,
        o fallback clica diretamente nele (evita elementFromPoint errado).
        Se o elemento no ponto é um SPAN pequeno, sobe até o container
        clicável (gl-Participant_General) e clica no centro dele.
        """
        page = self._page

        # Remove ClickMask se presente (bloqueia mouse.click indefinidamente)
        await page.evaluate("""() => {
            const mask = document.querySelector('.g5-PopupManager_ClickMask');
            if (mask) mask.remove();
        }""")

        # Verifica se o elemento é um SPAN pequeno e precisa subir ao container
        action = await page.evaluate(f"""() => {{
            const el = document.elementFromPoint({x}, {y});
            if (!el) return {{ action: 'click_original' }};

            const rect = el.getBoundingClientRect();
            if (rect.width < 40 || rect.height < 25) {{
                const container = el.closest(
                    '.gl-Participant_General, ' +
                    '[class*="ParticipantOddsOnly"][class*="gl-Participant"], ' +
                    '[class*="gl-Participant"]'
                );
                if (container) {{
                    const cr = container.getBoundingClientRect();
                    if (cr.width >= 30 && cr.height >= 20) {{
                        return {{
                            action: 'click_container',
                            x: cr.x + cr.width / 2,
                            y: cr.y + cr.height / 2,
                            info: container.className.substring(0, 60),
                            original: (el.className || '').substring(0, 60),
                        }};
                    }}
                }}
            }}

            return {{ action: 'click_original' }};
        }}""")

        if action["action"] == "click_container":
            cx, cy = action["x"], action["y"]
            logger.info(
                "SPAN pequeno ({}) → container ({}) em ({:.0f}, {:.0f})",
                action.get("original", ""), action.get("info", ""), cx, cy,
            )
            await self._reliable_click(
                cx, cy, use_marker=True, timeout=1.5,
                description="odds-container",
            )
        else:
            await self._reliable_click(
                x, y, use_marker=True, timeout=1.5,
                description="odds-cell",
            )

        # Limpa marcador após click
        await page.evaluate("""() => {
            document.querySelectorAll('[data-sheva-target]').forEach(e => e.removeAttribute('data-sheva-target'));
        }""")

        logger.info("Odds clicada em ({:.0f}, {:.0f})", x, y)

    # ─── Deselect Odds ──────────────────────────────────────────────────

    async def deselect_odds(self) -> None:
        """Desseleciona odds ativas clicando em área neutra do header.

        Após uma aposta ser feita, a odds cell fica highlighted (ativa).
        Clicar numa área neutra (header do site, acima das odds) desfaz
        a seleção e permite que o betslip/receipt seja fechado limpo.
        """
        page = self._page

        # 1. Tenta clicar na mesma odds ativa para toggle off
        toggled = await page.evaluate("""() => {
            const active = document.querySelector(
                '.gl-Participant_General.gl-Participant_General-active, ' +
                '[class*="gl-Participant"][class*="-active"], ' +
                '[class*="Participant"][class*="Selected"]'
            );
            if (active) {
                const r = active.getBoundingClientRect();
                if (r.width > 0 && r.height > 0 && r.y > 0 && r.y < 900) {
                    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
                }
            }
            return null;
        }""")
        if toggled:
            await self._reliable_click(
                toggled["x"], toggled["y"],
                fallback_selector='[class*="gl-Participant"][class*="-active"]',
                timeout=1.5,
                description="deselect-odds",
            )
            logger.info("Odds desselecionada via toggle em ({:.0f}, {:.0f})", toggled["x"], toggled["y"])
            await asyncio.sleep(0.15)
            return

        # 2. Fallback: clica em área neutra (título "Basquete" ou header do site)
        neutral = await page.evaluate("""() => {
            // Título da seção (ex: "Basquete")
            const title = document.querySelector(
                '[class*="InPlayModule"] [class*="Title"], ' +
                '[class*="SportHeader"], [class*="CategoryHeader"]'
            );
            if (title) {
                const r = title.getBoundingClientRect();
                if (r.width > 0 && r.y > 0 && r.y < 200) {
                    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
                }
            }
            return null;
        }""")
        if neutral:
            await self._reliable_click(
                neutral["x"], neutral["y"],
                timeout=1.5,
                description="neutral-area",
            )
            logger.info("Click em área neutra em ({:.0f}, {:.0f})", neutral["x"], neutral["y"])
        else:
            # Último recurso: click no canto superior esquerdo do content area
            await self._reliable_click(
                200, 120, timeout=1.5,
                description="neutral-fallback",
            )
            logger.info("Click em área neutra fallback (200, 120)")
        await asyncio.sleep(0.15)

    # ─── Wait for addbet response ────────────────────────────────────────

    async def wait_addbet(self, timeout: int = 15) -> dict | None:
        """Intercepta a resposta do endpoint addbet.

        Deve ser chamado ANTES de clicar na odds (registra o listener).
        Retorna dict com bg, cc, pc, sr, ou None se timeout.
        """
        result: dict[str, Any] = {"data": None}

        async def on_response(resp):
            if "betswebapi/addbet" in resp.url.lower() and not result["data"]:
                try:
                    body = await resp.text()
                    result["data"] = json.loads(body)
                except Exception:
                    pass

        self._page.on("response", on_response)
        try:
            for _ in range(timeout * 13):
                await asyncio.sleep(0.08)
                if result["data"]:
                    break
        finally:
            try:
                self._page.remove_listener("response", on_response)
            except Exception:
                pass

        return result["data"]

    # ─── Fill Stake ──────────────────────────────────────────────────────

    async def fill_stake(self, amount: float, skip_if_remembered: bool = False) -> bool:
        """Preenche o stake via mouse.click + keyboard.type (trusted events).

        Se skip_if_remembered=True, verifica se o stake já está preenchido
        (via "Lembrar") e pula a digitação se o valor estiver correto.
        """
        page = self._page
        stake_sel = SEL_STAKE

        # Fast path: se "Lembrar" está ativo, verifica stake + existência em 1 evaluate
        if skip_if_remembered:
            check = await page.evaluate(f"""() => {{
                const el = document.querySelector('{stake_sel}');
                if (!el) return {{ found: false }};
                const val = el.textContent.trim();
                return {{ found: true, val: val }};
            }}""")
            if check and check.get("found") and check.get("val") not in ("", "Aposta", "0", None):
                try:
                    if abs(float(check["val"].replace(",", ".")) - amount) < 0.01:
                        logger.info("Stake já preenchido via 'Lembrar': '{}'", check["val"])
                        return True
                except (ValueError, TypeError):
                    pass

        # Espera stake box aparecer — polling rápido (0.05s) para mínima latência
        for _ in range(60):
            found = await page.evaluate(f"()=>!!document.querySelector('{stake_sel}')")
            if found:
                break
            await asyncio.sleep(0.05)
        else:
            # Tenta seletores alternativos
            for alt in SEL_STAKE_ALT:
                found = await page.evaluate(f"()=>!!document.querySelector('{alt}')")
                if found:
                    stake_sel = alt
                    break
                await asyncio.sleep(0.05)
            else:
                logger.error("Stake box não encontrado")
                return False

        # Obtém coordenadas do stake box
        rect = await page.evaluate(f"""() => {{
            const el = document.querySelector('{stake_sel}');
            if (!el) return null;
            const r = el.getBoundingClientRect();
            return {{x: r.x + r.width / 2, y: r.y + r.height / 2}};
        }}""")
        if not rect:
            logger.error("Stake box sem bounding rect")
            return False

        # Click (trusted CDP) + limpa + digita
        await self._reliable_click(
            rect["x"], rect["y"],
            fallback_selector=stake_sel,
            timeout=1.5,
            description="stake-box",
        )
        # Foca o elemento via JS como garantia (para keyboard.type funcionar)
        await page.evaluate(f"() => {{ const el = document.querySelector('{stake_sel}'); if (el) el.focus(); }}")
        await asyncio.sleep(0.05)

        # Diagnóstico: tipo de elemento
        el_info = await page.evaluate(f"""() => {{
            const el = document.querySelector('{stake_sel}');
            if (!el) return null;
            return {{
                tag: el.tagName,
                editable: el.contentEditable,
                type: el.type || '',
                val: el.value || '',
                text: el.textContent || '',
                inner: el.innerText || ''
            }};
        }}""")
        logger.debug("Stake box info: {}", el_info)

        # Seleciona tudo: triplo-click (melhor em contenteditable) + Ctrl+A como backup
        try:
            await asyncio.wait_for(page.mouse.click(rect["x"], rect["y"], click_count=3), timeout=1.5)
        except asyncio.TimeoutError:
            pass
        await asyncio.sleep(0.03)
        await page.keyboard.press("Control+a")
        await page.keyboard.press("Backspace")
        await asyncio.sleep(0.03)

        stake_str = f"{amount:.2f}" if amount != int(amount) else str(int(amount))
        await page.keyboard.type(stake_str, delay=15)
        await asyncio.sleep(0.05)

        # Verifica
        value = await page.evaluate(f"""() => {{
            const e = document.querySelector('{stake_sel}');
            if (!e) return '';
            return e.value || e.innerText || e.textContent || '';
        }}""")
        value = value.strip()
        if not value or value in ("", "Aposta", "0"):
            logger.warning("Stake pode não ter sido preenchido (valor='{}'), retentando...", value)
            # Retry: click focado + triplo-click + type
            await self._reliable_click(
                rect["x"], rect["y"],
                fallback_selector=stake_sel,
                timeout=1.5,
                description="stake-retry",
            )
            await page.evaluate(f"() => {{ const el = document.querySelector('{stake_sel}'); if (el) el.focus(); }}")
            await asyncio.sleep(0.2)
            try:
                await asyncio.wait_for(page.mouse.click(rect["x"], rect["y"], click_count=3), timeout=1.5)
            except asyncio.TimeoutError:
                pass
            await asyncio.sleep(0.1)
            await page.keyboard.press("Control+a")
            await page.keyboard.press("Backspace")
            await asyncio.sleep(0.1)
            await page.keyboard.type(stake_str, delay=30)
            await asyncio.sleep(0.3)
            value = await page.evaluate(f"""() => {{
                const e = document.querySelector('{stake_sel}');
                if (!e) return '';
                return e.value || e.innerText || e.textContent || '';
            }}""")
            value = value.strip()

        logger.info("Stake preenchido: '{}' (alvo: {})", value, stake_str)
        return bool(value and value not in ("", "Aposta", "0"))

    # ─── Click Place Bet ─────────────────────────────────────────────────

    async def click_place_bet(self) -> bool:
        """Clica no botão Place Bet via mouse.click (trusted CDP).

        Se as odds mudaram, aceita automaticamente e re-busca o botão.
        Retorna True se o botão foi encontrado e clicado.
        """
        page = self._page

        # Espera até 10s pelo botão ou accept aparecer
        btn = None
        accepted_odds = False
        for wait_i in range(10):
            result = await page.evaluate("""() => {
                // 1. Procura botão Place Bet
                const placeSels = [
                    '.bsf-PlaceBetButton',
                    '.bss-PlaceBetButton',
                    '[class*="PlaceBet"]',
                    '.bss-DefaultContent_PlaceBet',
                    '[class*="BetslipButton"]',
                ];
                for (const s of placeSels) {
                    const els = document.querySelectorAll(s);
                    for (const btn of els) {
                        const r = btn.getBoundingClientRect();
                        if (r.width > 0 && r.height > 0) {
                            const cls = btn.className || '';
                            const txt = (btn.textContent || '').trim();
                            const isDisabled = cls.includes('Disabled') || cls.includes('Hidden');
                            if (!isDisabled) {
                                // "Aceitar Alteração e Fazer Aposta" = combinado accept+place
                                const txtLower = txt.toLowerCase();
                                const isAcceptAndPlace = txtLower.includes('aceitar')
                                    && (txtLower.includes('fazer') || txtLower.includes('aposta') || txtLower.includes('place'));
                                const isPureAccept = txtLower.includes('aceitar') && !isAcceptAndPlace;
                                if (isAcceptAndPlace) {
                                    return {
                                        type: 'accept_and_place',
                                        selector: s,
                                        text: txt.substring(0, 100),
                                        className: cls.substring(0, 200),
                                        x: r.x + r.width / 2,
                                        y: r.y + r.height / 2,
                                    };
                                }
                                if (!isPureAccept) {
                                    return {
                                        type: 'placebet',
                                        selector: s,
                                        text: txt.substring(0, 100),
                                        className: cls.substring(0, 200),
                                        x: r.x + r.width / 2,
                                        y: r.y + r.height / 2,
                                    };
                                }
                            }
                        }
                    }
                }
                // 2. Procura botões Accept (odds mudaram)
                const acceptSels = [
                    '.bsf-AcceptButton',
                    '.bss-AcceptButton',
                    '[class*="AcceptAny"]',
                    '[class*="Accept"][class*="Button"]',
                    '[class*="Accept"][class*="Change"]',
                ];
                for (const s of acceptSels) {
                    const els = document.querySelectorAll(s);
                    for (const el of els) {
                        const r = el.getBoundingClientRect();
                        if (r.width > 0 && r.height > 0 && !el.className.includes('Hidden')) {
                            return {
                                type: 'accept',
                                selector: s,
                                text: (el.textContent || '').trim().substring(0, 100),
                                x: r.x + r.width / 2,
                                y: r.y + r.height / 2,
                            };
                        }
                    }
                }
                // 3. Procura qualquer botão com texto de aceitar/fazer aposta (fallback PT-BR)
                const allBtns = document.querySelectorAll('[class*="Bet"] [class*="Button"], [class*="Bet"] button, [class*="Default"] [class*="Button"]');
                for (const el of allBtns) {
                    const r = el.getBoundingClientRect();
                    if (r.width < 50 || r.height < 20) continue;
                    const txt = (el.textContent || '').trim().toLowerCase();
                    // "Aceitar Alteração e" com "Fazer" = combinado
                    const isAcceptAndPlace = txt.includes('aceitar')
                        && (txt.includes('fazer') || txt.includes('aposta') || txt.includes('place'));
                    if (isAcceptAndPlace) {
                        return {
                            type: 'accept_and_place',
                            selector: 'text-match',
                            text: el.textContent.trim().substring(0, 100),
                            className: (el.className || '').substring(0, 200),
                            x: r.x + r.width / 2,
                            y: r.y + r.height / 2,
                        };
                    }
                    if (txt.includes('aceitar') || txt.includes('accept')) {
                        return {
                            type: 'accept_text',
                            selector: 'text-match',
                            text: el.textContent.trim().substring(0, 100),
                            className: (el.className || '').substring(0, 200),
                            x: r.x + r.width / 2,
                            y: r.y + r.height / 2,
                        };
                    }
                    if (txt.includes('fazer aposta') || txt.includes('place bet')) {
                        return {
                            type: 'placebet_text',
                            selector: 'text-match',
                            text: el.textContent.trim().substring(0, 100),
                            className: (el.className || '').substring(0, 200),
                            x: r.x + r.width / 2,
                            y: r.y + r.height / 2,
                        };
                    }
                }
                return null;
            }""")

            if result and result["type"] == "accept_and_place":
                # Botão combinado "Aceitar Alteração e Fazer Aposta" — clica e trata como Place Bet
                logger.warning("Linha/odds mudou — clicando 'Aceitar + Fazer Aposta': '{}'", result["text"][:60])
                btn = result
                accepted_odds = True
                break

            if result and result["type"] in ("accept", "accept_text"):
                logger.warning("Odds mudaram — clicando Accept: '{}' via {}", result["text"][:50], result["selector"])
                sel = result["selector"] if result["selector"] != "text-match" else None
                await self._reliable_click(
                    result["x"], result["y"],
                    fallback_selector=sel,
                    timeout=1.5,
                    description="accept-odds",
                )
                accepted_odds = True
                await asyncio.sleep(0.2)
                continue  # Volta ao loop para buscar Place Bet

            if result and result["type"] in ("placebet", "placebet_text"):
                btn = result
                break

            await asyncio.sleep(0.05)

        if not btn:
            # Diagnóstico: listar tudo no betslip
            diag = await page.evaluate("""() => {
                const all = document.querySelectorAll('[class*="Bet"], [class*="bet"], [class*="Slip"], [class*="slip"], [class*="Accept"], [class*="accept"]');
                const items = [];
                for (const el of all) {
                    const r = el.getBoundingClientRect();
                    if (r.width > 0 && r.height > 0) {
                        items.push({
                            tag: el.tagName,
                            cls: (el.className || '').substring(0, 120),
                            text: (el.textContent || '').trim().substring(0, 60),
                        });
                    }
                    if (items.length >= 20) break;
                }
                return items;
            }""")
            logger.error("Botão Place Bet não encontrado no DOM. Betslip elements: {}", diag)
            return False

        if accepted_odds:
            logger.info("Odds aceitas, Place Bet encontrado após Accept")

        logger.info("Place Bet encontrado via '{}': '{}'", btn.get("selector", ""), btn.get("text", "")[:50])
        sel = btn["selector"] if btn.get("selector") not in (None, "text-match") else None
        await self._reliable_click(
            btn["x"], btn["y"],
            fallback_selector=sel,
            timeout=1.5,
            description="place-bet",
        )
        logger.info("Place Bet clicado em ({:.0f}, {:.0f})", btn["x"], btn["y"])
        return True

    # ─── Wait for PlaceBet response ──────────────────────────────────────

    async def wait_placebet(self, timeout: int = 20) -> dict | None:
        """Intercepta request + response do endpoint placebet.

        Deve ser chamado ANTES de clicar Place Bet.
        Retorna dict com sr, cs, br (receipt), ou None se timeout.
        """
        traffic: dict[str, Any] = {"request": None, "response": None}

        async def on_req(req):
            if "betswebapi/placebet" in req.url.lower():
                traffic["request"] = {
                    "url": req.url,
                    "method": req.method,
                    "post_data": req.post_data,
                }

        async def on_resp(resp):
            if "betswebapi/placebet" in resp.url.lower():
                try:
                    body = await resp.text()
                    traffic["response"] = json.loads(body)
                except Exception:
                    traffic["response"] = {"error": "parse_failed"}

        self._page.on("request", on_req)
        self._page.on("response", on_resp)

        try:
            for i in range(timeout * 13):
                await asyncio.sleep(0.08)
                if traffic["response"]:
                    break
                # A cada ~3s, verifica receipt no DOM como fallback
                if (i + 1) % 38 == 0 and not traffic["response"]:
                    receipt_dom = await self._page.evaluate("""() => {
                        const sels = [
                            '[class*="ReceiptContent"]',
                            '[class*="ReceiptHeader"]',
                        ];
                        for (const s of sels) {
                            const el = document.querySelector(s);
                            if (el && el.getBoundingClientRect().height > 30) {
                                const txt = el.textContent || '';
                                const m = txt.match(/Ref[.:,]\\s*([A-Z0-9]+)/i);
                                return { found: true, receipt: m ? m[1] : '', text: txt.substring(0, 100) };
                            }
                        }
                        return null;
                    }""")
                    if receipt_dom and receipt_dom.get("found"):
                        logger.info("placebet detectado via DOM receipt: {}", receipt_dom.get("receipt", ""))
                        traffic["response"] = {
                            "sr": 0, "cs": 0,
                            "br": receipt_dom.get("receipt", "DOM-detected"),
                        }
                        break
        finally:
            try:
                self._page.remove_listener("request", on_req)
                self._page.remove_listener("response", on_resp)
            except Exception:
                pass

        if traffic["response"]:
            return {
                "request": traffic["request"],
                "response": traffic["response"],
            }
        return None

    # ─── Handle Odds Changed ─────────────────────────────────────────────

    async def handle_odds_changed(self) -> bool:
        """Se betslip mostra 'odds changed', aceita e re-tenta.

        Retorna True se tratou uma mudança de odds.
        """
        page = self._page
        result = await page.evaluate("""() => {
            const sels = [
                '.bsf-AcceptButton', '.bss-AcceptButton',
                '[class*="AcceptAny"]', '[class*="Accept"][class*="Button"]',
                '[class*="Accept"][class*="Change"]',
            ];
            for (const s of sels) {
                const el = document.querySelector(s);
                if (el && !el.className.includes('Hidden')) {
                    const r = el.getBoundingClientRect();
                    if (r.width > 0) return {x: r.x + r.width / 2, y: r.y + r.height / 2, type: 'accept', sel: s};
                }
            }
            // Fallback: busca por texto
            const allBtns = document.querySelectorAll('[class*="Bet"] [class*="Button"], [class*="Default"] [class*="Button"]');
            for (const el of allBtns) {
                const r = el.getBoundingClientRect();
                if (r.width < 50) continue;
                const txt = (el.textContent || '').trim().toLowerCase();
                if (txt.includes('aceitar') || txt.includes('accept')) {
                    return {x: r.x + r.width / 2, y: r.y + r.height / 2, type: 'text', sel: txt.substring(0, 50)};
                }
            }
            return null;
        }""")
        if result:
            logger.warning("Odds mudaram — aceitando alteração ({}: {})", result["type"], result.get("sel", ""))
            sel = result.get("sel") if result.get("type") == "accept" else None
            await self._reliable_click(
                result["x"], result["y"],
                fallback_selector=sel,
                timeout=1.5,
                description="accept-change",
            )
            await asyncio.sleep(0.5)
            return True
        return False

    # ─── Warm-up: Lembrar Stake ────────────────────────────────────────

    async def warm_up_stake(self, amount: float) -> bool:
        """Warm-up: clica odds, preenche stake, marca 'Lembrar', cancela.

        Após executar, todas as apostas seguintes terão o stake pré-preenchido,
        eliminando a necessidade de fill_stake() em cada aposta.

        Returns:
            True se 'Lembrar' foi ativado com sucesso.
        """
        page = self._page

        # 1. Clica em uma odds qualquer para abrir betslip
        cells = await self.find_all_visible_odds()
        if not cells:
            logger.warning("Warm-up: nenhuma odds visível para clicar")
            return False

        cell = cells[0]
        logger.info("Warm-up: clicando odds '{}' em ({:.0f}, {:.0f})", cell["text"][:12], cell["x"], cell["y"])
        await self.click_odds(cell["x"], cell["y"])

        # 2. Espera betslip abrir (stake box aparecer)
        stake_sel = SEL_STAKE
        for _ in range(20):
            found = await page.evaluate(f"()=>!!document.querySelector('{stake_sel}')")
            if found:
                break
            await asyncio.sleep(0.3)
        else:
            for alt in SEL_STAKE_ALT:
                found = await page.evaluate(f"()=>!!document.querySelector('{alt}')")
                if found:
                    stake_sel = alt
                    break
            else:
                logger.warning("Warm-up: betslip não abriu (stake box não encontrado)")
                await self.clean_betslip()
                return False

        # 3. Preenche stake
        rect = await page.evaluate(f"""() => {{
            const el = document.querySelector('{stake_sel}');
            if (!el) return null;
            const r = el.getBoundingClientRect();
            return {{x: r.x + r.width / 2, y: r.y + r.height / 2}};
        }}""")
        if rect:
            await self._reliable_click(
                rect["x"], rect["y"],
                fallback_selector=stake_sel,
                timeout=1.5,
                description="warmup-stake",
            )
            await page.evaluate(f"() => {{ const el = document.querySelector('{stake_sel}'); if (el) el.focus(); }}")
            await asyncio.sleep(0.15)
            await page.keyboard.press("Control+a")
            await page.keyboard.press("Backspace")
            stake_str = f"{amount:.2f}" if amount != int(amount) else str(int(amount))
            await page.keyboard.type(stake_str, delay=20)
            await asyncio.sleep(0.2)
            logger.info("Warm-up: stake '{}' preenchido", stake_str)

        # 4. Marca "Lembrar" via CDP mouse click
        remember_ok = await self._toggle_remember_stake()
        if remember_ok:
            logger.info("Warm-up: 'Lembrar' ativado com sucesso — stake será lembrado")
        else:
            logger.warning("Warm-up: 'Lembrar' NÃO foi ativado (checkbox não encontrado)")

        # 5. Cancela a aposta (limpa betslip sem apostar)
        await asyncio.sleep(0.3)
        await self.clean_betslip()
        await page.keyboard.press("Escape")
        await asyncio.sleep(0.2)

        return remember_ok

    async def _toggle_remember_stake(self) -> bool:
        """Marca checkbox 'Lembrar' no betslip se não estiver ativo.

        Seletores bet365:
        - .bsf-RememberStakeButtonNonTouch (container)
        - .bsf-RememberStakeButtonNonTouch-active (estado ativo)
        - .bsf-RememberStakeButtonNonTouch_HitArea (área clicável)
        """
        page = self._page

        # Verifica estado atual
        state = await page.evaluate("""() => {
            const sels = [
                '.bsf-RememberStakeButtonNonTouch',
                '.bss-RememberStakeButtonNonTouch',
                '[class*="RememberStake"]',
            ];
            for (const sel of sels) {
                const el = document.querySelector(sel);
                if (el && el.offsetParent !== null) {
                    const cls = el.className || '';
                    return {
                        found: true,
                        active: cls.includes('active'),
                        sel: sel,
                    };
                }
            }
            return { found: false, active: false };
        }""")

        if not state.get("found"):
            return False
        if state.get("active"):
            logger.info("'Lembrar' já está ativo")
            return True

        # Clica para ativar — usa CDP mouse.click para evento trusted
        hit_sels = [
            ".bsf-RememberStakeButtonNonTouch_HitArea",
            ".bss-RememberStakeButtonNonTouch_HitArea",
            ".bsf-RememberStakeButtonNonTouch",
            ".bss-RememberStakeButtonNonTouch",
            '[class*="RememberStake"]',
        ]
        for sel in hit_sels:
            rect = await page.evaluate(f"""() => {{
                const el = document.querySelector('{sel}');
                if (!el) return null;
                const r = el.getBoundingClientRect();
                if (r.width < 5 || r.height < 5) return null;
                return {{x: r.x + r.width / 2, y: r.y + r.height / 2}};
            }}""")
            if rect:
                await self._reliable_click(
                    rect["x"], rect["y"],
                    fallback_selector=sel,
                    timeout=1.5,
                    description="remember-stake",
                )
                await asyncio.sleep(0.3)

                # Confirma ativação
                confirmed = await page.evaluate("""() => {
                    const sels = [
                        '.bsf-RememberStakeButtonNonTouch',
                        '.bss-RememberStakeButtonNonTouch',
                        '[class*="RememberStake"]',
                    ];
                    for (const sel of sels) {
                        const el = document.querySelector(sel);
                        if (el) return (el.className || '').includes('active');
                    }
                    return false;
                }""")
                if confirmed:
                    return True

        return False

    # ─── Close Betslip / Receipt ─────────────────────────────────────────

    async def close_betslip(self) -> None:
        """Fecha receipt/betslip 'Aposta Feita' clicando no X via CDP trusted click.

        Estratégias (em ordem):
        0. Remove cookie banner se presente (bloqueia cliques)
        1. Seletores CSS diretos de receipt close
        2. Busca X/×/svg/Close dentro de qualquer container receipt
        3. Localiza "Aposta Feita" e clica no X mais próximo (top-right)
        4. Escape como fallback
        5. Remove receipt do DOM como último recurso
        """
        page = self._page

        # ── 0. Remove cookie banner que bloqueia cliques na parte inferior ──
        await page.evaluate("""() => {
            const banner = document.getElementById('onetrust-banner-sdk')
                || document.querySelector('[class*="CookieBanner"]')
                || document.querySelector('.onetrust-pc-dark-filter');
            if (banner) banner.remove();
            // Remove backdrop do cookie
            const backdrop = document.querySelector('.onetrust-pc-dark-filter');
            if (backdrop) backdrop.remove();
        }""")

        for attempt in range(4):
            btn = await page.evaluate("""() => {
                // ── 1. Seletores diretos ──
                const sels = [
                    '.bss-ReceiptContent_Close', '.bsf-ReceiptContent_Close',
                    '[class*="ReceiptContent"] [class*="Close"]',
                    '[class*="Receipt"] [class*="Close"]',
                    '[class*="Receipt"] [class*="Done"]',
                    '.bs-DoneButton', '.bss-DefaultContent_TitleDone',
                    '[class*="ReceiptHeader"] [class*="Close"]',
                ];
                for (const s of sels) {
                    const el = document.querySelector(s);
                    if (el) {
                        const r = el.getBoundingClientRect();
                        if (r.width > 0 && r.height > 0 && r.y > 0 && r.y < 900) {
                            return { x: r.x + r.width / 2, y: r.y + r.height / 2,
                                     sel: s, w: r.width, h: r.height };
                        }
                    }
                }

                // ── 2. Busca X/Close dentro de containers receipt ──
                const containers = document.querySelectorAll(
                    '[class*="Receipt"], [class*="BetslipContainer"], [class*="Betslip_"]'
                );
                for (const c of containers) {
                    const rect = c.getBoundingClientRect();
                    if (rect.height < 30) continue;
                    // Qualquer coisa com Close, cross, X
                    const elems = c.querySelectorAll('*');
                    for (const el of elems) {
                        const r = el.getBoundingClientRect();
                        if (r.width < 5 || r.width > 60 || r.height < 5 || r.height > 60) continue;
                        if (r.y < 0 || r.y > 900) continue;
                        const cls = (typeof el.className === 'string' ? el.className : '') || '';
                        const txt = (el.textContent || '').trim();
                        const isClose = cls.includes('Close') || cls.includes('cross')
                            || cls.includes('Cross') || cls.includes('Dismiss');
                        const isX = txt === '×' || txt === 'X' || txt === 'x' || txt === '✕';
                        const isSvg = el.tagName === 'svg' || el.tagName === 'SVG';
                        if (isClose || isX || (isSvg && r.width <= 30)) {
                            return { x: r.x + r.width / 2, y: r.y + r.height / 2,
                                     sel: 'inner:' + (cls || el.tagName).substring(0, 50),
                                     w: r.width, h: r.height };
                        }
                    }
                }

                // ── 3. Encontra "Aposta Feita" e busca X na mesma linha ──
                let receiptHeader = null;
                const hdrSels = [
                    '[class*="ReceiptHeader"]',
                    '[class*="ReceiptContent"] [class*="Header"]',
                    '[class*="Receipt"] [class*="Title"]',
                ];
                for (const hs of hdrSels) {
                    const h = document.querySelector(hs);
                    if (h && h.getBoundingClientRect().height > 10 && h.getBoundingClientRect().height < 80) {
                        receiptHeader = h;
                        break;
                    }
                }
                if (!receiptHeader) {
                    // Fallback: scan apenas dentro de Receipt containers
                    const rcts = document.querySelectorAll('[class*="Receipt"] *');
                    for (const el of rcts) {
                        const txt = (el.textContent || '').trim();
                        if ((txt.startsWith('Aposta Feita') || txt.startsWith('Bet Placed'))
                            && el.getBoundingClientRect().height < 80
                            && el.getBoundingClientRect().height > 10) {
                            receiptHeader = el;
                            break;
                        }
                    }
                }
                if (receiptHeader) {
                    const hr = receiptHeader.getBoundingClientRect();
                    // O X fica à direita do header, mesma faixa vertical
                    const parent = receiptHeader.parentElement
                        || receiptHeader.closest('[class*="Receipt"]')
                        || document.body;
                    const children = parent.querySelectorAll('*');
                    let bestX = null;
                    let bestDist = 999;
                    for (const el of children) {
                        const r = el.getBoundingClientRect();
                        if (r.width < 5 || r.width > 40 || r.height < 5 || r.height > 40) continue;
                        // Deve estar na mesma faixa vertical que o header
                        if (Math.abs(r.y - hr.y) > 30) continue;
                        // Deve estar à direita
                        if (r.x < hr.x + hr.width * 0.5) continue;
                        const cls = (typeof el.className === 'string' ? el.className : '') || '';
                        const txt2 = (el.textContent || '').trim();
                        const isCandidate = cls.includes('Close') || cls.includes('cross')
                            || txt2 === '×' || txt2 === 'X' || txt2 === '✕'
                            || el.tagName === 'svg' || el.tagName === 'SVG'
                            || el.tagName === 'path' || cls.includes('Icon');
                        if (isCandidate) {
                            const dist = Math.abs(r.y - hr.y);
                            if (dist < bestDist) {
                                bestDist = dist;
                                bestX = { x: r.x + r.width / 2, y: r.y + r.height / 2,
                                           sel: 'near-header:' + (cls || el.tagName).substring(0, 50),
                                           w: r.width, h: r.height };
                            }
                        }
                    }
                    if (bestX) return bestX;

                    // Último recurso: clica na posição estimada do X
                    // (top-right do container receipt, ~20px do canto)
                    const receiptContainer = receiptHeader.closest('[class*="Receipt"]')
                        || receiptHeader.parentElement;
                    if (receiptContainer) {
                        const cr = receiptContainer.getBoundingClientRect();
                        if (cr.width > 50) {
                            return { x: cr.x + cr.width - 15, y: cr.y + 15,
                                     sel: 'estimated-x', w: 20, h: 20 };
                        }
                    }
                }

                return null;
            }""")

            if btn:
                sel_fb = btn["sel"] if not btn["sel"].startswith(("inner:", "near-header:", "estimated-x")) else None
                await self._reliable_click(
                    btn["x"], btn["y"],
                    fallback_selector=sel_fb,
                    timeout=1.5,
                    description="receipt-close",
                )
                logger.info("Receipt fechado via '{}' em ({:.0f}, {:.0f}) [{}x{}]",
                            btn["sel"], btn["x"], btn["y"], btn.get("w", "?"), btn.get("h", "?"))
                await asyncio.sleep(0.15)

                # Confirma que fechou (receipt sumiu)
                still_open = await page.evaluate("""() => {
                    const sels = [
                        '[class*="ReceiptContent"]',
                        '[class*="ReceiptHeader"]',
                        '[class*="Receipt"]',
                    ];
                    for (const s of sels) {
                        const el = document.querySelector(s);
                        if (el && el.getBoundingClientRect().height > 30) return true;
                    }
                    return false;
                }""")
                if not still_open:
                    logger.info("Receipt confirmado como fechado")
                    return
                logger.warning("Receipt ainda aberto após click, tentativa {}", attempt + 1)
                continue

            # Não encontrou — espera um pouco (receipt pode estar animando)
            if attempt < 2:
                await asyncio.sleep(0.25)
            else:
                break

        # Fallback: Escape
        logger.warning("X do receipt não encontrado — Escape como fallback")
        await page.keyboard.press("Escape")
        await asyncio.sleep(0.3)

        # Último recurso: remove receipt do DOM
        removed = await page.evaluate("""() => {
            let count = 0;
            const sels = ['[class*="ReceiptContent"]', '[class*="Receipt"]'];
            for (const s of sels) {
                const el = document.querySelector(s);
                if (el && el.getBoundingClientRect().height > 30) {
                    el.remove();
                    count++;
                    break;
                }
            }
            return count;
        }""")
        if removed:
            logger.info("Receipt removido do DOM como fallback")

    # ─── Find Odds by Player (overview grid) ────────────────────────────

    async def find_odds_by_player(
        self,
        player_name: str,
        market: str = "hc",
        line: float | None = None,
        target_odd: float | None = None,
        teams: str = "",
    ) -> dict | None:
        """Encontra a odds cell de um jogador específico na overview (IP/B18).

        Busca o jogador pelo nome na grid, identifica a cell correta (HC/O/U)
        e retorna coordenadas para CDP click.

        Args:
            player_name: Nome do jogador (ex: "TRICKSTER", "PROWLER")
            market: 'hc', 'over', 'under'
            line: Linha numérica (ex: 5.5, 110.5)
            target_odd: Odd esperada p/ ordenar candidatos por proximidade
            teams: String "TeamA vs TeamB" para validação cruzada de fixture

        Returns:
            Dict {x, y, oddVal, text, player, col} ou None se não encontrado.
        """
        mkt = market or "hc"
        line_str = str(line) if line is not None else None

        # Extrai nomes dos dois jogadores para validação cruzada
        team_names: list[str] = []
        if teams and " vs " in teams:
            team_names = [t.strip() for t in teams.split(" vs ", 1)]
        elif teams:
            team_names = [teams.strip()]

        result = await self._page.evaluate(r"""(params) => {
            const { searchPlayer, mkt, lineStr, targetOdd, teamNames } = params;
            const playerUpper = searchPlayer.toUpperCase();
            const teamUppers = (teamNames || []).map(t => t.toUpperCase()).filter(t => t.length > 0);

            // Helper: verifica se uma row é a fixture correta (contém ambos os times)
            function isCorrectFixture(row) {
                if (teamUppers.length < 2) return true; // sem info de adversário, aceita
                const txt = (row.textContent || '').toUpperCase();
                return teamUppers.every(t => txt.includes(t));
            }

            // Helper: verifica se container é estreito o suficiente (1 fixture, não 10)
            function hasReasonableSize(row) {
                const odds = row.querySelectorAll('.gl-Participant_General');
                // Uma fixture de e-basketball tipicamente tem 2-8 odds cells
                return odds.length >= 2 && odds.length <= 30;
            }

            // 1. Encontra a linha do jogo que contém o player
            const allEventRows = document.querySelectorAll(
                '[class*="gl-Market_General"], [class*="rcl-MarketCouponFixtureLinkBase"], ' +
                '[class*="ovm-Fixture"], [class*="ovm-FixtureDetail"], ' +
                '[class*="sl-CouponFixtureLinkBase"], [class*="Coupon_FixtureLink"]'
            );

            let matchRow = null;
            // Fase 1a: busca row que contém AMBOS os times (ideal)
            if (teamUppers.length >= 2) {
                for (const row of allEventRows) {
                    const rowText = (row.textContent || '').toUpperCase();
                    if (teamUppers.every(t => rowText.includes(t)) && hasReasonableSize(row)) {
                        matchRow = row;
                        break;
                    }
                }
            }
            // Fase 1b: fallback — busca row que contém apenas o player
            if (!matchRow) {
                for (const row of allEventRows) {
                    const rowText = (row.textContent || '').toUpperCase();
                    if (rowText.includes(playerUpper) && hasReasonableSize(row)) {
                        // Valida que adversário também está presente (se disponível)
                        if (isCorrectFixture(row)) {
                            matchRow = row;
                            break;
                        }
                    }
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
                            if (odds.length >= 2 && odds.length <= 30) {
                                // Valida: row deve conter ambos os times
                                if (isCorrectFixture(parent)) {
                                    matchRow = parent;
                                    break;
                                }
                            }
                            parent = parent.parentElement;
                        }
                        if (matchRow) break;
                    }
                }
            }

            if (!matchRow) {
                return { error: true, msg: 'Player "' + searchPlayer + '" não encontrado na overview',
                         teamsSearched: teamUppers };
            }

            // Validação final: confirma que a row contém o fixture correto
            const matchRowText = matchRow.textContent.toUpperCase();
            if (teamUppers.length >= 2 && !teamUppers.every(t => matchRowText.includes(t))) {
                return { error: true, msg: 'Row encontrada NÃO contém ambos os times — abortando para evitar aposta errada',
                         player: searchPlayer, teamsSearched: teamUppers,
                         rowPreview: matchRowText.substring(0, 120) };
            }

            // 2. Dentro da row, busca a odd correta
            const oddEls = matchRow.querySelectorAll('.gl-Participant_General');
            const candidates = [];

            for (let i = 0; i < oddEls.length; i++) {
                const el = oddEls[i];
                const rect = el.getBoundingClientRect();
                if (rect.width < 5 || rect.height < 5) continue;
                if (el.closest('[class*="Suspended"]') || el.className.includes('Suspended')) continue;

                // Lê odds do span filho *_Odds (não do textContent concatenado!)
                const oddsSpan = el.querySelector('[class*="_Odds"]');
                const oddText = oddsSpan ? oddsSpan.textContent.trim() : '';
                // Lê handicap do span filho *_Handicap
                const hcSpan = el.querySelector('[class*="_Handicap"]');
                const hcText = hcSpan ? hcSpan.textContent.trim() : '';

                // Fallback: se não encontrou spans filhos, tenta separar textContent
                let oddValStr = '';
                let cellHcText = hcText;
                if (oddText) {
                    oddValStr = oddText;
                } else {
                    // Sem spans separados — tenta regex no texto inteiro
                    const allMatches = el.textContent.trim().match(/(\d+[.,]\d+)/g);
                    if (allMatches && allMatches.length > 0) {
                        // Último número decimal é geralmente a odd
                        oddValStr = allMatches[allMatches.length - 1];
                    }
                }

                const oddMatch = oddValStr.match(/(\d+[.,]\d+)/);
                if (!oddMatch) continue;
                const oddVal = parseFloat(oddMatch[1].replace(',', '.'));

                // Monta cellText para debug (handicap | odds separados)
                const cellText = (hcText ? hcText + ' ' : '') + oddValStr;

                if (mkt === 'hc') {
                    // Usa hcText (do span _Handicap) para matching de linha
                    const hcArea = (cellHcText || el.textContent.trim()).toUpperCase();
                    const hasPlus = hcArea.includes('+');
                    const hasMinus = hcArea.includes('-');

                    if (lineStr) {
                        const lineNum = parseFloat(lineStr);
                        const linePatterns = [
                            '+' + lineStr, '-' + lineStr,
                            '+' + lineStr.replace('.', ','), '-' + lineStr.replace('.', ',')
                        ];
                        let exactMatch = false;
                        for (const lp of linePatterns) {
                            if (hcArea.includes(lp)) { exactMatch = true; break; }
                        }

                        if (exactMatch) {
                            if (lineNum >= 0 && !hasPlus) continue;
                            candidates.push({ idx: i, oddVal, text: cellText.substring(0, 60), col: 'hc', exact: true, rect });
                        } else if (cellHcText) {
                            // Tem span _Handicap — extrai o número para comparar proximidade
                            const hcNumMatch = cellHcText.match(/([+-]?\d+[.,]\d+)/);
                            if (hcNumMatch) {
                                const cellLine = Math.abs(parseFloat(hcNumMatch[1].replace(',', '.')));
                                const targetLine = Math.abs(lineNum);
                                // Aceita se a linha mudou até ±3 pontos
                                if (Math.abs(cellLine - targetLine) <= 3 && lineNum >= 0 === hasPlus) {
                                    candidates.push({ idx: i, oddVal, text: cellText.substring(0, 60), col: 'hc', exact: false, rect });
                                }
                            }
                        }
                        // Sem span _Handicap e sem match exato → NÃO adiciona (evita falso positivo)
                    } else {
                        candidates.push({ idx: i, oddVal, text: cellText.substring(0, 60), col: 'hc', exact: false, rect });
                    }
                }
                else if (mkt === 'over' || mkt === 'under') {
                    const ouPrefix = mkt === 'over' ? 'O' : 'U';
                    const searchArea = (cellHcText || el.textContent.trim()).replace(/\s+/g, ' ');
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
                         rowOddsCount: oddEls.length, rowOdds: rowOdds.slice(0, 12) };
            }

            // Ordena: match exato primeiro, depois proximidade ao target
            if (targetOdd) {
                candidates.sort((a, b) => {
                    if (a.exact && !b.exact) return -1;
                    if (!a.exact && b.exact) return 1;
                    return Math.abs(a.oddVal - targetOdd) - Math.abs(b.oddVal - targetOdd);
                });
            }

            const chosen = candidates[0];
            const chosenEl = oddEls[chosen.idx];

            // Remove marcador anterior e marca o elemento escolhido
            document.querySelectorAll('[data-sheva-target]').forEach(e => e.removeAttribute('data-sheva-target'));
            chosenEl.setAttribute('data-sheva-target', '1');

            // Scroll elemento para viewport antes de retornar coordenadas
            chosenEl.scrollIntoView({ block: 'center', behavior: 'instant' });
            // Recalcula rect após scroll
            const r2 = chosenEl.getBoundingClientRect();
            return { error: false, val: chosen.oddVal.toFixed(2),
                     oddVal: chosen.oddVal, text: chosen.text,
                     col: chosen.col, total: candidates.length,
                     player: searchPlayer,
                     x: r2.x + r2.width / 2, y: r2.y + r2.height / 2 };
        }""", {"searchPlayer": player_name, "mkt": mkt, "lineStr": line_str, "targetOdd": target_odd, "teamNames": team_names})

        if not result or result.get("error"):
            logger.warning("find_odds_by_player: {} — debug: {}", result.get("msg", "null"), result)
            return None

        logger.info(
            "find_odds_by_player: {} {} @{} ({}), player={}, col={}",
            market.upper(), line_str or "", result["oddVal"],
            result["text"][:40], result["player"], result["col"],
        )
        return result

    # ─── Place Bet by Signal (Telegram integration) ──────────────────────

    async def place_bet_by_signal(
        self,
        signal: dict,
        stake: float = 1.0,
        skip_if_remembered: bool = True,
        max_odd_drop: float = 0.15,
        skip_cleanup: bool = True,
    ) -> UIBetResult:
        """Fluxo completo de aposta a partir de um sinal parsed do Telegram.

        Usa find_odds_by_player para localizar a odds na overview,
        depois executa: click_odds → wait_addbet → fill_stake →
        click_place_bet → wait_placebet → deselect → close.

        Args:
            signal: Dict do parse_signal() com market, line, hc_team, teams, odd
            stake: Valor em R$ da aposta
            skip_if_remembered: Se True, pula fill_stake quando Lembrar está ativo
            max_odd_drop: Queda máxima aceitável da odd (sinal → página)

        Returns:
            UIBetResult com sr, receipt, etc.
        """
        import time as _time
        t0 = _time.perf_counter()
        result = UIBetResult()

        market = signal.get("market") or "hc"
        line = signal.get("line")
        target_odd = signal.get("odd")
        hc_team = signal.get("hc_team")
        teams = signal.get("teams") or ""

        # Determina nome do jogador para busca
        player_name = hc_team or ""
        if not player_name and teams:
            player_name = teams.split(" vs ")[0].strip() if " vs " in teams else teams
        if not player_name:
            result.error = "Sinal sem nome de jogador para buscar"
            logger.error(result.error)
            return result

        try:
            # 1. Tenta cache pre-computado primeiro (0ms vs ~500ms do evaluate)
            cell = self.lookup_cache(player_name, market, line, target_odd, teams=teams)
            if cell:
                logger.info("Cache HIT: {} {} @{} em ({:.0f}, {:.0f})",
                            market.upper(), line or "", cell["oddVal"], cell["x"], cell["y"])
            else:
                # Fallback: busca completa via evaluate JS
                cell = await self.find_odds_by_player(player_name, market, line, target_odd, teams=teams)
            if not cell:
                result.error = f"Jogador '{player_name}' não encontrado na overview"
                logger.error(result.error)
                return result

            page_odd = cell["oddVal"]

            # 3. Validação de queda de odds
            if target_odd and max_odd_drop > 0:
                drop = target_odd - page_odd
                if drop > max_odd_drop:
                    result.error = f"Odd desvalorizada: {target_odd:.2f} → {page_odd:.2f} (queda {drop:.2f})"
                    logger.warning(result.error)
                    return result
                if drop > 0:
                    logger.info("Odd caiu {:.2f} (dentro do range aceitável)", drop)

            result.odds = str(page_odd)

            # 4. Remove overlays que possam bloquear click
            await self.dismiss_overlays()

            # 5. Registra addbet listener ANTES de clicar
            addbet_task = asyncio.create_task(self.wait_addbet(timeout=8))

            # 6. Clica odds via click_odds (trata SPAN→container)
            await self.click_odds(cell["x"], cell["y"])

            # 6. Espera addbet response
            addbet = await addbet_task
            if not addbet or not addbet.get("bg"):
                # Fallback: betslip pode ter recebido sem captura network
                betslip_ok = await self._page.evaluate("""() => {
                    const stake = document.querySelector(
                        '.bsf-StakeBox_StakeValue-input, .bss-StakeBox_StakeValue-input, [class*="StakeBox_StakeValue"]'
                    );
                    return !!stake && stake.offsetParent !== null;
                }""")
                if betslip_ok:
                    addbet = {"bg": "betslip-fallback", "sr": 0}
                    logger.info("addbet não capturado via network MAS betslip tem seleção — prosseguindo")
                else:
                    result.error = "addbet timeout — odds não selecionada"
                    logger.error(result.error)
                    return result

            result.bg = addbet.get("bg", "")
            result.cc = addbet.get("cc", "")
            result.pc = addbet.get("pc", "")

            bt = (addbet.get("bt") or [{}])[0]
            result.fixture_id = str(bt.get("fi", ""))
            result.selection_id = str((bt.get("pt", [{}])[0]).get("pi", "")) if bt.get("pt") else ""

            logger.info("addbet OK: sr={} bg={}... odds={}", addbet.get("sr", -1), result.bg[:20], result.odds)

            # 7. Preenche stake
            stake_ok = await self.fill_stake(stake, skip_if_remembered=skip_if_remembered)
            if not stake_ok:
                result.error = "Falha ao preencher stake"
                logger.error(result.error)
                return result

            # 8. Registra placebet listener
            placebet_task = asyncio.create_task(self.wait_placebet(timeout=20))

            # 9. Clica Place Bet (com auto-accept se odds mudaram)
            clicked = await self.click_place_bet()
            if not clicked:
                placebet_task.cancel()
                result.error = "Place Bet button não encontrado"
                logger.error(result.error)
                return result

            # 10. Espera resultado
            pb = await placebet_task
            if pb and pb.get("response"):
                resp = pb["response"]
                result.sr = resp.get("sr", -1)
                result.cs = resp.get("cs", -1)
                result.bet_receipt = resp.get("br", "")
                result.success = (result.sr == 0)
                result.placebet_request = pb.get("request", {})
                result.placebet_response = resp

                if result.success:
                    logger.info(
                        "APOSTA ACEITA! sr=0 receipt={} odd={} player={} ({:.1f}s)",
                        result.bet_receipt, result.odds, player_name,
                        _time.perf_counter() - t0,
                    )
                else:
                    logger.warning("Aposta rejeitada: sr={} cs={}", result.sr, result.cs)

                # ── RETRY sr=14 (linha/odds mudou) ──
                # Bet365 mostra "Aceitar Alteração e Fazer aposta" — clica e re-espera
                if result.sr == 14 and not result.success:
                    logger.info("sr=14 detectado — tentando aceitar alteração e forçar entrada...")
                    retry_placebet_task = asyncio.create_task(self.wait_placebet(timeout=15))
                    retry_clicked = await self.click_place_bet()
                    if retry_clicked:
                        retry_pb = await retry_placebet_task
                        if retry_pb and retry_pb.get("response"):
                            retry_resp = retry_pb["response"]
                            result.sr = retry_resp.get("sr", -1)
                            result.cs = retry_resp.get("cs", -1)
                            result.bet_receipt = retry_resp.get("br", "")
                            result.success = (result.sr == 0)
                            result.placebet_request = retry_pb.get("request", {})
                            result.placebet_response = retry_resp
                            if result.success:
                                logger.info(
                                    "APOSTA ACEITA (retry sr=14)! sr=0 receipt={} odd={} player={} ({:.1f}s)",
                                    result.bet_receipt, result.odds, player_name,
                                    _time.perf_counter() - t0,
                                )
                            else:
                                logger.warning("Retry sr=14 também rejeitado: sr={} cs={}", result.sr, result.cs)
                        else:
                            logger.warning("Retry sr=14: placebet timeout (sem resposta)")
                    else:
                        retry_placebet_task.cancel()
                        logger.warning("Retry sr=14: botão Accept/PlaceBet não encontrado")
            else:
                result.error = "placebet timeout"
                logger.warning(result.error)

            # 11. Cleanup: skip se hard reset virá depois (skip_cleanup=True)
            if not skip_cleanup:
                await self.deselect_odds()
                await self.close_betslip()
            else:
                logger.debug("Cleanup skipped (hard reset segue)")

        except Exception as e:
            result.error = str(e)
            logger.error("Erro no place_bet_by_signal: {}", e)

        return result

    # ─── Full PlaceBet Flow ──────────────────────────────────────────────

    async def place_bet(
        self,
        fixture_id: str,
        market: str = "hc",
        handicap_line: float | None = None,
        side: str | None = None,
        stake: float = 1.0,
        navigate: bool = True,
    ) -> UIBetResult:
        """Executa o fluxo completo de aposta via UI.

        1. Limpa betslip
        2. Navega ao fixture (se navigate=True)
        3. Encontra e clica odds cell
        4. Intercepta addbet response (bg/cc/pc)
        5. Preenche stake
        6. Clica Place Bet
        7. Intercepta placebet response
        8. Retorna resultado

        Args:
            fixture_id: ID do fixture (ex: "191801646")
            market: 'hc', 'over', 'under'
            handicap_line: Linha ex: 3.5, 5.5
            side: 'home'/'away' para HC
            stake: Valor da aposta
            navigate: Se True, navega para a página do evento
        """
        result = UIBetResult()

        try:
            # 1. Limpa betslip
            await self.clean_betslip()

            # Remove overlays que interceptam clicks
            await self.dismiss_overlays()

            # 2. Navega ao fixture (se solicitado)
            if navigate:
                await self.navigate_to_fixture(fixture_id)

            # 3. Encontra odds cell
            cell = await self.find_odds_cell(market, handicap_line, side)
            if not cell:
                result.error = "Nenhuma odds cell visível no DOM"
                logger.error(result.error)
                return result

            logger.info("Odds cell encontrada: {} at ({:.0f},{:.0f})", cell["text"], cell["x"], cell["y"])

            # 4. Registra addbet listener ANTES de clicar
            addbet_task = asyncio.create_task(self.wait_addbet(timeout=15))

            # 5. Clica odds (trusted CDP)
            await self.click_odds(cell["x"], cell["y"])

            # 6. Espera addbet response
            addbet = await addbet_task
            if not addbet:
                result.error = "addbet response não capturado (timeout)"
                logger.error(result.error)
                return result

            result.bg = addbet.get("bg", "")
            result.cc = addbet.get("cc", "")
            result.pc = addbet.get("pc", "")
            addbet_sr = addbet.get("sr", -1)

            if not result.bg or not result.cc:
                result.error = f"addbet sem bg/cc (sr={addbet_sr})"
                logger.error(result.error)
                return result

            # Extrai dados do addbet
            bt_list = addbet.get("bt", [])
            bt = bt_list[0] if bt_list else {}
            result.odds = str(bt.get("od", ""))
            result.fixture_id = str(bt.get("fi", ""))
            result.selection_id = str((bt.get("pt", [{}])[0]).get("pi", "")) if bt.get("pt") else ""

            logger.info("addbet OK: sr={} bg={}... odds={}", addbet_sr, result.bg[:20], result.odds)

            # 7. Preenche stake
            stake_ok = await self.fill_stake(stake)
            if not stake_ok:
                result.error = "Falha ao preencher stake"
                logger.error(result.error)
                return result

            # 8. Registra placebet listener ANTES de clicar
            placebet_task = asyncio.create_task(self.wait_placebet(timeout=20))

            # 9. Clica Place Bet
            clicked = await self.click_place_bet()
            if not clicked:
                placebet_task.cancel()
                result.error = "Place Bet button não clicável"
                logger.error(result.error)
                return result

            # 10. Espera placebet response
            pb = await placebet_task
            if not pb or not pb.get("response"):
                # Tenta tratar odds changed
                if await self.handle_odds_changed():
                    await asyncio.sleep(1)
                    # Re-tenta placebet
                    placebet_task2 = asyncio.create_task(self.wait_placebet(timeout=15))
                    await self.click_place_bet()
                    pb = await placebet_task2

            if pb and pb.get("response"):
                resp = pb["response"]
                result.sr = resp.get("sr", -1)
                result.cs = resp.get("cs", -1)
                result.bet_receipt = resp.get("br", "")
                result.success = (result.sr == 0)
                result.placebet_request = pb.get("request", {})
                result.placebet_response = resp

                if result.success:
                    logger.info("APOSTA ACEITA! sr=0 receipt={}", result.bet_receipt)
                else:
                    logger.warning("Aposta rejeitada: sr={} cs={}", result.sr, result.cs)
            else:
                result.error = "placebet response não capturado (timeout)"
                logger.warning(result.error)

            # 11. Fecha betslip/receipt
            await asyncio.sleep(1)
            await self.close_betslip()

        except Exception as e:
            result.error = str(e)
            logger.error("Erro no fluxo UI: {}", e)

        return result
