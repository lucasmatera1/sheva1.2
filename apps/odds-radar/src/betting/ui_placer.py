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

    # ─── Bet Slip Cleanup ────────────────────────────────────────────────

    async def clean_betslip(self) -> int:
        """Remove todas as seleções do betslip. Retorna quantidade removida."""
        removed = await self._page.evaluate(f"""() => {{
            const btns = document.querySelectorAll('{SEL_REMOVE}');
            let count = 0;
            for (const btn of btns) {{ btn.click(); count++; }}
            return count;
        }}""")
        if removed:
            logger.info("Betslip limpo ({} seleções removidas)", removed)
            await asyncio.sleep(1.5)
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
            await asyncio.sleep(3)
            new_hash = await self._page.evaluate("() => window.location.hash")
            if fixture_id in new_hash:
                logger.info("Navegou para fixture {} (tentativa {})", fixture_id, attempt + 1)
                return True
            logger.warning("Tentativa {}: hash={}, esperado {}", attempt + 1, new_hash, target)

        # Fallback: navega para In-Play eSports primeiro, depois para o fixture
        await self._page.evaluate("window.location.hash = '#/IP/B18'")
        await asyncio.sleep(2)
        await self._page.evaluate(f"window.location.hash = '{target}'")
        await asyncio.sleep(3)
        new_hash = await self._page.evaluate("() => window.location.hash")
        ok = fixture_id in new_hash
        if not ok:
            logger.warning("Navegação para fixture {} falhou após fallback (hash={})", fixture_id, new_hash)
        return ok

    async def go_back_to_esports(self) -> None:
        """Volta para a listagem de eSports In-Play."""
        await self._page.evaluate("window.location.hash = '#/IP/B18'")
        await asyncio.sleep(3)

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
        """Lista todas as odds cells visíveis na página."""
        return await self._page.evaluate(f"""() => {{
            const cells = document.querySelectorAll('{SEL_ODDS_CELL}');
            const r = [];
            for (const c of cells) {{
                const t = c.textContent?.trim();
                if (!t || t === '-') continue;
                const b = c.getBoundingClientRect();
                if (b.width > 0 && b.height > 0 && b.top > 50)
                    r.push({{text: t, x: b.x + b.width / 2, y: b.y + b.height / 2}});
                if (r.length >= 20) break;
            }}
            return r;
        }}""")

    # ─── Click Odds (trusted CDP mouse event) ────────────────────────────

    async def click_odds(self, x: float, y: float) -> None:
        """Clica em uma odds cell via mouse.click (trusted CDP events)."""
        await self._page.mouse.click(x, y)
        logger.info("Odds clicada em ({:.0f}, {:.0f})", x, y)

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
            for _ in range(timeout):
                await asyncio.sleep(1)
                if result["data"]:
                    break
        finally:
            try:
                self._page.remove_listener("response", on_response)
            except Exception:
                pass

        return result["data"]

    # ─── Fill Stake ──────────────────────────────────────────────────────

    async def fill_stake(self, amount: float) -> bool:
        """Preenche o stake via mouse.click + keyboard.type (trusted events).

        Espera até 8s pelo stake box aparecer.
        """
        page = self._page
        stake_sel = SEL_STAKE

        # Espera stake box aparecer
        for _ in range(8):
            found = await page.evaluate(f"()=>!!document.querySelector('{stake_sel}')")
            if found:
                break
            await asyncio.sleep(1)
        else:
            # Tenta seletores alternativos
            for alt in SEL_STAKE_ALT:
                found = await page.evaluate(f"()=>!!document.querySelector('{alt}')")
                if found:
                    stake_sel = alt
                    break
                await asyncio.sleep(0.3)
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
        await page.mouse.click(rect["x"], rect["y"])
        await asyncio.sleep(0.4)
        await page.keyboard.press("Control+a")
        await page.keyboard.press("Backspace")
        await asyncio.sleep(0.2)

        stake_str = f"{amount:.2f}" if amount != int(amount) else str(int(amount))
        await page.keyboard.type(stake_str, delay=40)
        await asyncio.sleep(0.8)

        # Verifica
        value = await page.evaluate(f"()=>{{const e=document.querySelector('{stake_sel}');return e?e.textContent.trim():''}}")
        if not value or value in ("", "Aposta", "0"):
            logger.warning("Stake pode não ter sido preenchido (valor='{}'), retentando...", value)
            await page.mouse.click(rect["x"], rect["y"])
            await asyncio.sleep(0.3)
            await page.keyboard.press("Control+a")
            await page.keyboard.press("Backspace")
            await page.keyboard.type(stake_str, delay=30)
            await asyncio.sleep(0.5)
            value = await page.evaluate(f"()=>{{const e=document.querySelector('{stake_sel}');return e?e.textContent.trim():''}}")

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
                            // Ignora se contém texto de Accept (não é Place Bet real)
                            if (!isDisabled && !txt.toLowerCase().includes('aceitar')) {
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
                // 3. Procura qualquer botão com texto de aceitar (fallback PT-BR)
                const allBtns = document.querySelectorAll('[class*="Bet"] [class*="Button"], [class*="Bet"] button, [class*="Default"] [class*="Button"]');
                for (const el of allBtns) {
                    const r = el.getBoundingClientRect();
                    if (r.width < 50 || r.height < 20) continue;
                    const txt = (el.textContent || '').trim().toLowerCase();
                    if (txt.includes('aceitar') || txt.includes('accept') || txt.includes('fazer aposta') || txt.includes('place bet')) {
                        return {
                            type: txt.includes('aceitar') || txt.includes('accept') ? 'accept_text' : 'placebet_text',
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

            if result and result["type"] in ("accept", "accept_text"):
                logger.warning("Odds mudaram — clicando Accept: '{}' via {}", result["text"][:50], result["selector"])
                await page.mouse.click(result["x"], result["y"])
                accepted_odds = True
                await asyncio.sleep(2)
                continue  # Volta ao loop para buscar Place Bet

            if result and result["type"] in ("placebet", "placebet_text"):
                btn = result
                break

            await asyncio.sleep(1)

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
        await page.mouse.click(btn["x"], btn["y"])
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
            for _ in range(timeout):
                await asyncio.sleep(1)
                if traffic["response"]:
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
            await page.mouse.click(result["x"], result["y"])
            await asyncio.sleep(1.5)
            return True
        return False

    # ─── Close Betslip / Receipt ─────────────────────────────────────────

    async def close_betslip(self) -> None:
        """Fecha receipt/betslip após aposta."""
        closed = await self._page.evaluate("""() => {
            const sels = [
                '.bs-DoneButton', '.bss-DefaultContent_TitleDone',
                '.bs-Receipt [class*="Close"]', '.bs-Receipt [class*="Done"]',
                '.bsf-ReceiptContent [class*="Done"]',
            ];
            for (const s of sels) {
                const el = document.querySelector(s);
                if (el && el.getBoundingClientRect().width > 0) {
                    el.click();
                    return s;
                }
            }
            return null;
        }""")
        if closed:
            logger.info("Betslip fechado via {}", closed)
            await asyncio.sleep(1)

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

            # Remove overlays
            await self._page.evaluate("""() => {
                document.querySelectorAll('.wcl-ModalManager_DarkWash,.wcl-ModalManager_LightWash')
                    .forEach(e => e.remove());
            }""")
            await asyncio.sleep(0.5)

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
