"""Bet Placer — interage com o betslip do Bet365 para colocar apostas."""

from __future__ import annotations

import asyncio
from datetime import datetime
from typing import TYPE_CHECKING

from src.browser.engine import BrowserEngine
from src.models.odds import BetRecord, BetSignal, BetStatus
from src.utils.logger import get_logger

if TYPE_CHECKING:
    from playwright.async_api import Page

logger = get_logger(__name__)

# Seletores do betslip Bet365 (podem mudar — atualize quando quebrar)
# Descobertos via debug_betslip.py / debug_stakebox.py em 2025-06-27
BETSLIP_SEL = {
    # Elementos de odds clicáveis na listagem
    "odd_cell": ".sgl-ParticipantOddsOnly80_Odds",
    # Fixture container (para match finding)
    "fixture": ".rcl-ParticipantFixtureDetails",
    "team_name": ".rcl-ParticipantFixtureDetailsTeam_TeamName",
    # Betslip (lateral que abre ao clicar numa odd)
    # Stake: <div contenteditable="true"> — NÃO é <input>
    "betslip_stake": ".bsf-StakeBox_StakeValue-input",
    "betslip_place": ".bsf-PlaceBetButton",
    "betslip_place_text": ".bsf-PlaceBetButton_Text",
    "betslip_return": ".bsf-PlaceBetButton_ReturnValue",
    "betslip_confirm": ".bsf-ReceiptContent, .bs-Receipt",
    "betslip_close": ".bs-DoneButton, .bss-DefaultContent_TitleDone",
    "betslip_error": ".bsf-ErrorMessage, .bsf-NormalMessage",
    # Erro genérico que aparece ao fazer aposta ("Infelizmente, um erro ocorreu")
    "place_bet_error": ".bs-PlaceBetErrorMessage-show",
    "place_bet_error_text": ".bs-PlaceBetErrorMessage_ContentsText",
    # Erro genérico global (modal) — "Infelizmente, um erro ocorreu"
    "general_error": ".bs-GeneralErrorMessage",
    "general_error_text": ".bs-GeneralErrorMessage_Contents",
    "betslip_odd_display": ".bsf-BetslipOdds_Odds, .bsf-OddsDisplay",
    # Popup de odd mudou
    "odd_changed_accept": ".bsf-AcceptButton, .bsf-AcceptOdds",
    # Popup de geolocalização do Bet365
    "geo_popup": ".gsm-EnableBrowserGeolocationPopup",
    # Market column containers
    "market_col": ".sgl-MarketOddsExpand",
}


class BetPlacer:
    """Coloca apostas no Bet365 via interação DOM."""

    def __init__(self, engine: BrowserEngine):
        self.engine = engine

    async def find_and_click_odd(
        self, page: Page, signal: BetSignal
    ) -> float | None:
        """Encontra a partida pelo nome dos jogadores e clica na odd.

        Returns:
            O valor da odd clicada, ou None se não encontrou.
        """
        side_index = {"home": 0, "draw": 1, "away": 2}.get(signal.side)
        if side_index is None:
            logger.error("Side inválido: {}", signal.side)
            return None

        # Usa JavaScript para encontrar a fixture e clicar na odd correta
        result = await page.evaluate("""(args) => {
            const { homeName, awayName, sideIndex } = args;
            const hn = homeName.toLowerCase();
            const an = awayName.toLowerCase();

            // Encontra fixtures
            const fixtures = document.querySelectorAll('.rcl-ParticipantFixtureDetails');
            let fixtureIndex = -1;

            for (let i = 0; i < fixtures.length; i++) {
                const names = fixtures[i].querySelectorAll(
                    '.rcl-ParticipantFixtureDetailsTeam_TeamName'
                );
                if (names.length < 2) continue;
                const h = names[0].textContent.trim().toLowerCase();
                const a = names[1].textContent.trim().toLowerCase();
                if (h.includes(hn) || hn.includes(h) || a.includes(an) || an.includes(a)) {
                    fixtureIndex = i;
                    break;
                }
            }

            if (fixtureIndex === -1) return { found: false, error: 'Fixture not found' };

            // Pega as colunas de mercado
            const cols = document.querySelectorAll('.sgl-MarketOddsExpand');
            if (sideIndex >= cols.length) return { found: false, error: 'Column index out of range' };

            const col = cols[sideIndex];
            const oddEls = col.querySelectorAll('.sgl-ParticipantOddsOnly80_Odds');

            if (fixtureIndex >= oddEls.length) {
                return { found: false, error: 'Odd element not found for fixture index' };
            }

            const oddEl = oddEls[fixtureIndex];
            const oddValue = oddEl.textContent.trim();

            // Clica na odd (precisa clicar no pai clicável)
            const clickTarget = oddEl.closest('.sgl-ParticipantOddsOnly80') || oddEl;
            clickTarget.click();

            return { found: true, oddValue, fixtureIndex };
        }""", {"homeName": signal.home_player, "awayName": signal.away_player, "sideIndex": side_index})

        if not result.get("found"):
            logger.warning("Partida não encontrada: {} vs {} — {}",
                           signal.home_player, signal.away_player, result.get("error"))
            return None

        odd_str = result.get("oddValue", "0")
        try:
            odd_val = float(odd_str.replace(",", "."))
        except ValueError:
            logger.warning("Odd inválida: {}", odd_str)
            return None

        logger.info("Odd clicada: {} vs {} | side={} | odd={}",
                     signal.home_player, signal.away_player, signal.side, odd_val)

        # Espera betslip abrir
        await asyncio.sleep(3)
        return odd_val

    async def fill_stake(self, page: Page, stake: float) -> bool:
        """Preenche o valor da stake no betslip.

        O campo de stake do Bet365 é um <div contenteditable="true">,
        não um <input>. Precisa de click + keyboard.type().
        """
        try:
            # Usa locator com filtro contenteditable para pegar o div correto
            loc = page.locator(
                'div[contenteditable="true"].bsf-StakeBox_StakeValue-input'
            ).first
            await loc.wait_for(state="attached", timeout=15000)
            await asyncio.sleep(0.5)

            # Scroll o betslip para view via JS
            await loc.evaluate("el => el.scrollIntoView({block:'center'})")
            await asyncio.sleep(0.3)

            # Click real do Playwright (gera eventos nativos que o React captura)
            try:
                await loc.click(timeout=3000)
            except Exception:
                # Fallback: dispatch mouse events via JS
                await loc.evaluate("""el => {
                    el.dispatchEvent(new MouseEvent('mousedown', {bubbles:true}));
                    el.dispatchEvent(new MouseEvent('mouseup', {bubbles:true}));
                    el.dispatchEvent(new MouseEvent('click', {bubbles:true}));
                    el.focus();
                }""")
            await asyncio.sleep(0.3)

            # Seleciona tudo (caso já tenha valor) e apaga
            await page.keyboard.press("Control+a")
            await asyncio.sleep(0.1)
            await page.keyboard.press("Backspace")
            await asyncio.sleep(0.2)

            # Digita o valor via Playwright keyboard (gera eventos reais)
            stake_str = f"{stake:.2f}"
            await page.keyboard.type(stake_str, delay=30)
            await asyncio.sleep(0.3)

            # Verifica se o valor pegou; se não, re-foca e tenta novamente
            current = await loc.text_content()
            if not current or current.strip() == "":
                logger.warning("Primeira tentativa falhou, re-focando...")
                await loc.evaluate("el => { el.focus(); el.click(); }")
                await asyncio.sleep(0.3)
                await page.keyboard.type(stake_str, delay=30)
                await asyncio.sleep(0.3)

            logger.info("Stake preenchida: R${:.2f}", stake)
            return True
        except Exception as e:
            logger.error("Erro ao preencher stake: {}", e)
            return False

    async def get_betslip_odd(self, page: Page) -> float | None:
        """Lê a odd atual do betslip (pode ter mudado)."""
        try:
            el = await page.query_selector(BETSLIP_SEL["betslip_odd_display"])
            if el:
                text = await el.text_content()
                return float(text.strip().replace(",", ".")) if text else None
        except Exception:
            pass
        return None

    async def place_bet(
        self,
        page: Page,
        after_click_screenshot_path: str | None = None,
    ) -> BetStatus:
        """Clica no botão de confirmar aposta e verifica resultado."""
        try:
            # Espera o botão ficar habilitado (sem _Disabled)
            for i in range(20):
                diag = await page.evaluate("""() => {
                    const btn = document.querySelector('.bsf-PlaceBetButton');
                    const stake = document.querySelector('.bsf-StakeBox_StakeValue-input');
                    const msg = document.querySelector('.bs-MessageContainer');
                    const geoPopup = document.querySelector('.gsm-EnableBrowserGeolocationPopup');
                    const placeErr = document.querySelector('.bs-PlaceBetErrorMessage-show');
                    return {
                        btnClass: btn ? btn.className : null,
                        stakeText: stake ? stake.textContent : null,
                        msgText: msg ? msg.textContent.trim() : null,
                        geoPopup: !!geoPopup,
                        placeErr: placeErr ? placeErr.textContent.trim() : null,
                    };
                }""")

                if i == 0 or i == 10:
                    logger.info("place_bet diag: {}", diag)

                btn_class = diag.get("btnClass") or ""
                if not btn_class:
                    logger.error("Botão 'Fazer Aposta' não encontrado")
                    return BetStatus.ERROR
                if "Disabled" not in btn_class and "Hidden" not in btn_class:
                    break
                await asyncio.sleep(0.5)
            else:
                # Diagnóstico completo do betslip quando botão fica Hidden
                betslip_html = await page.evaluate("""() => {
                    const bs = document.querySelector('.bss-StandardBetslip, .bss-BetslipContent, [class*="Betslip"]');
                    if (bs) return bs.innerText;
                    // Fallback: pega todo o conteúdo visível do footer/betslip area
                    const all = document.querySelectorAll('[class*="bsf-"], [class*="bss-"], [class*="bs-"]');
                    let texts = [];
                    all.forEach(el => {
                        const t = el.textContent.trim();
                        if (t && t.length < 500 && !texts.includes(t)) texts.push(el.className.split(' ')[0] + ': ' + t.substring(0, 100));
                    });
                    return texts.join('\\n');
                }""")
                logger.error("Botão permanece Disabled/Hidden após 10s | diag={}", diag)
                logger.error("Betslip conteúdo:\\n{}", betslip_html[:2000] if betslip_html else "VAZIO")
                return BetStatus.ERROR

            # Clique no botão via Playwright nativo (anti-bot)
            btn_loc = page.locator(".bsf-PlaceBetButton")
            await asyncio.sleep(0.12)
            try:
                await btn_loc.click(timeout=5000)
            except Exception:
                # Fallback JS
                await page.evaluate("""() => {
                    const btn = document.querySelector('.bsf-PlaceBetButton');
                    if (btn) btn.click();
                }""")
            logger.info("Botão 'Fazer Aposta' clicado")

            if after_click_screenshot_path:
                try:
                    await asyncio.sleep(1)
                    await page.screenshot(
                        path=after_click_screenshot_path,
                        full_page=True,
                    )
                except Exception:
                    pass

            # Espera resultado (até 15s)
            for attempt in range(30):
                await asyncio.sleep(0.5)

                # Diagnóstico a cada 2s — busca TUDO na página
                if attempt % 4 == 3:
                    diag = await page.evaluate("""() => {
                        const receipt = document.querySelector('.bsf-ReceiptContent, .bs-Receipt');
                        const placeErr = document.querySelector('.bs-PlaceBetErrorMessage');
                        const errShow = document.querySelector('.bs-PlaceBetErrorMessage-show');
                        const errText = document.querySelector('.bs-PlaceBetErrorMessage_ContentsText');
                        const btn = document.querySelector('.bsf-PlaceBetButton');
                        const accept = document.querySelector('.bsf-AcceptButton');
                        const footer = document.querySelector('.bss-Footer');

                        // Busca QUALQUER modal/overlay/dialog de erro na página toda
                        const allModals = document.querySelectorAll(
                            '[class*="Modal"], [class*="Dialog"], [class*="Overlay"], [class*="Popup"], [class*="Error"], [class*="error"], [role="dialog"], [role="alert"]'
                        );
                        let modalTexts = [];
                        allModals.forEach(el => {
                            const t = el.textContent.trim();
                            if (t && t.length > 5 && t.length < 500) {
                                modalTexts.push(el.className.split(' ')[0] + ': ' + t.substring(0, 150));
                            }
                        });

                        // Busca texto "erro" em qualquer elemento visível
                        const errElements = document.querySelectorAll('*');
                        let visibleErrors = [];
                        errElements.forEach(el => {
                            if (el.children.length === 0 && el.offsetParent !== null) {
                                const t = el.textContent.trim().toLowerCase();
                                if (t.includes('erro') || t.includes('error') || t.includes('infelizmente')) {
                                    visibleErrors.push(el.textContent.trim().substring(0, 100));
                                }
                            }
                        });

                        return {
                            receipt: !!receipt,
                            placeErr: placeErr ? placeErr.className : null,
                            errShow: !!errShow,
                            errText: errText ? errText.textContent.trim() : null,
                            btnClass: btn ? btn.className : null,
                            acceptVisible: accept ? !accept.className.includes('Hidden') : false,
                            footerText: footer ? footer.textContent.trim().substring(0, 200) : null,
                            modals: modalTexts.length > 0 ? modalTexts : null,
                            visibleErrors: visibleErrors.length > 0 ? visibleErrors : null,
                        };
                    }""")
                    logger.info("place_bet wait diag [{}]: {}", attempt, diag)

                # Verifica se aposta foi aceita (receipt aparece)
                receipt = await page.query_selector(BETSLIP_SEL["betslip_confirm"])
                if receipt:
                    logger.info("Aposta ACEITA pelo Bet365")
                    return BetStatus.ACCEPTED

                # Fallback: detecta texto "Aposta Feita" em qualquer elemento visível
                aposta_feita = await page.evaluate("""() => {
                    const walk = document.createTreeWalker(document.body, NodeFilter.SHOW_ELEMENT, null);
                    while (walk.nextNode()) {
                        const el = walk.currentNode;
                        const dt = Array.from(el.childNodes)
                            .filter(n => n.nodeType === 3)
                            .map(n => n.textContent.trim()).join('');
                        if (dt === 'Aposta Feita' || dt === 'Bet Placed') {
                            if (el.getBoundingClientRect().width > 0) return true;
                        }
                    }
                    return false;
                }""")
                if aposta_feita:
                    logger.info("Aposta ACEITA pelo Bet365 (detectado via texto 'Aposta Feita')")
                    return BetStatus.ACCEPTED

                # Verifica erro genérico de place bet ("Infelizmente, um erro ocorreu")
                place_err = await page.query_selector(BETSLIP_SEL["place_bet_error"])
                if place_err:
                    err_text_el = await page.query_selector(BETSLIP_SEL["place_bet_error_text"])
                    err_text = await err_text_el.text_content() if err_text_el else "erro desconhecido"
                    logger.warning("Erro ao fazer aposta (PlaceBetError): {}", err_text)
                    return BetStatus.REJECTED

                # Verifica erro GERAL (modal bs-GeneralErrorMessage)
                gen_err = await page.query_selector(BETSLIP_SEL["general_error"])
                if gen_err:
                    gen_text_el = await page.query_selector(BETSLIP_SEL["general_error_text"])
                    gen_text = await gen_text_el.text_content() if gen_text_el else "erro genérico"
                    logger.warning("Erro GERAL do Bet365: {}", gen_text.strip()[:200])
                    return BetStatus.REJECTED

                # Verifica se odd mudou — aceita automaticamente via JS
                odd_changed = await page.evaluate("""() => {
                    const textOf = (el) =>
                        (el?.textContent || '').toLowerCase().replace(/\\s+/g, ' ').trim();

                    const acceptBtn = document.querySelector('.bsf-AcceptButton, .bsf-AcceptOdds');
                    if (
                        acceptBtn &&
                        !acceptBtn.className.includes('Hidden') &&
                        acceptBtn.getBoundingClientRect().width > 0
                    ) {
                        acceptBtn.click();
                        return 'accept_button';
                    }

                    const placeBtn = document.querySelector('.bsf-PlaceBetButton');
                    if (
                        placeBtn &&
                        !placeBtn.className.includes('Hidden') &&
                        placeBtn.getBoundingClientRect().width > 0 &&
                        textOf(placeBtn).includes('aceitar altera')
                    ) {
                        placeBtn.click();
                        return 'combined_place_button';
                    }

                    return '';
                }""")
                if odd_changed:
                    logger.warning("Odd mudou — tratando alteração via {}...", odd_changed)
                    await asyncio.sleep(1.5)
                    if odd_changed == "accept_button":
                        # Após aceitar, re-clica em Fazer Aposta
                        await page.evaluate("""() => {
                            const btn = document.querySelector('.bsf-PlaceBetButton');
                            if (btn && !btn.className.includes('Disabled') && !btn.className.includes('Hidden'))
                                btn.click();
                        }""")
                        await asyncio.sleep(1)
                    continue

                # Verifica erro inline no betslip
                err_el = await page.query_selector(BETSLIP_SEL["betslip_error"])
                if err_el:
                    err_text = await err_el.text_content()
                    logger.warning("Erro no betslip: {}", err_text)
                    return BetStatus.REJECTED

            logger.warning("Timeout esperando resultado da aposta")
            return BetStatus.ERROR

        except Exception as e:
            logger.error("Erro ao colocar aposta: {}", e)
            return BetStatus.ERROR

    async def close_betslip(self, page: Page) -> None:
        """Fecha o betslip/receipt após aposta ou cancelamento."""
        selectors = [
            ".bss-RemoveButton",
            ".bs-DeleteButton",
            BETSLIP_SEL["betslip_close"],
            ".bss-DefaultContent_Close",
            ".bs-Receipt [class*='Close']",
            ".bs-Receipt [class*='Done']",
            ".bsf-ReceiptContent [class*='Close']",
            ".bsf-ReceiptContent [class*='Done']",
            ".bss-ReceiptContent [class*='Close']",
            ".bss-ReceiptContent [class*='Done']",
        ]

        for selector in selectors:
            try:
                btn = await page.query_selector(selector)
                if btn:
                    await btn.click()
                    await asyncio.sleep(0.5)
                    return
            except Exception:
                pass

        try:
            closed = await page.evaluate("""() => {
                const visible = (el) => {
                    if (!el || !el.offsetParent) return false;
                    const r = el.getBoundingClientRect();
                    return r.width > 8 && r.height > 8;
                };

                const containers = Array.from(document.querySelectorAll(
                    '.bs-Receipt, .bsf-ReceiptContent, .bss-ReceiptContent, .bss-StandardBetslip, [class*="Betslip"]'
                )).filter(visible);

                for (const container of containers) {
                    const rect = container.getBoundingClientRect();
                    const buttons = Array.from(container.querySelectorAll('*')).filter(visible);

                    for (const el of buttons) {
                        const text = (el.textContent || '').trim().toLowerCase();
                        const cls = el.className || '';
                        const r = el.getBoundingClientRect();
                        const topRight = r.top <= rect.top + 70 && r.left >= rect.right - 90;
                        const looksClose =
                            text === 'x' ||
                            text === 'fechar' ||
                            text === 'done' ||
                            text === 'ok' ||
                            cls.includes('Close') ||
                            cls.includes('Done');

                        if (topRight && looksClose) {
                            el.click();
                            return true;
                        }
                    }
                }
                return false;
            }""")
            if closed:
                await asyncio.sleep(0.5)
        except Exception:
            pass

    async def close_betslip_fast(self, page: Page) -> None:
        """Fecha rapidamente o recibo/betslip, priorizando o X do topo direito."""
        selectors = [
            ".bss-RemoveButton",
            ".bs-DeleteButton",
            ".bs-Receipt [class*='Close']",
            ".bs-Receipt [class*='Remove']",
            ".bs-Receipt [class*='Delete']",
            ".bs-Receipt [class*='Done']",
            ".bsf-ReceiptContent [class*='Close']",
            ".bsf-ReceiptContent [class*='Remove']",
            ".bsf-ReceiptContent [class*='Delete']",
            ".bsf-ReceiptContent [class*='Done']",
            ".bss-ReceiptContent [class*='Close']",
            ".bss-ReceiptContent [class*='Remove']",
            ".bss-ReceiptContent [class*='Delete']",
            ".bss-ReceiptContent [class*='Done']",
            BETSLIP_SEL["betslip_close"],
            ".bss-DefaultContent_Close",
        ]

        for selector in selectors:
            try:
                clicked = await page.evaluate("""(sel) => {
                    const visible = (el) => {
                        if (!el) return false;
                        const style = window.getComputedStyle(el);
                        if (style.visibility === 'hidden' || style.display === 'none') return false;
                        const rect = el.getBoundingClientRect();
                        return rect.width > 6 && rect.height > 6;
                    };

                    const el = Array.from(document.querySelectorAll(sel)).find(visible);
                    if (!el) return null;

                    el.dispatchEvent(new MouseEvent('mousemove', { bubbles: true }));
                    el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
                    el.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
                    el.click();

                    return {
                        selector: sel,
                        cls: String(el.className || ''),
                    };
                }""", selector)
                if clicked:
                    logger.info(
                        "Betslip fechado via seletor rapido {} ({})",
                        clicked["selector"],
                        clicked["cls"],
                    )
                    await asyncio.sleep(0.25)
                    return
            except Exception:
                pass

        try:
            closed = await page.evaluate("""() => {
                const visible = (el) => {
                    if (!el) return false;
                    const style = window.getComputedStyle(el);
                    if (style.visibility === 'hidden' || style.display === 'none') return false;
                    const r = el.getBoundingClientRect();
                    return r.width > 8 && r.height > 8;
                };

                const containers = Array.from(document.querySelectorAll(
                    '.bs-Receipt, .bsf-ReceiptContent, .bss-ReceiptContent, .bss-StandardBetslip, [class*="Betslip"]'
                )).filter(visible);

                for (const container of containers) {
                    const rect = container.getBoundingClientRect();
                    const buttons = Array.from(container.querySelectorAll('*')).filter(visible);

                    for (const el of buttons) {
                        const text = (el.textContent || '').trim().toLowerCase();
                        const title = (el.getAttribute('title') || '').trim().toLowerCase();
                        const aria = (el.getAttribute('aria-label') || '').trim().toLowerCase();
                        const cls = String(el.className || '');
                        const r = el.getBoundingClientRect();
                        const topRight = r.top <= rect.top + 70 && r.left >= rect.right - 90;
                        const looksClose =
                            text === 'x' ||
                            text === 'fechar' ||
                            text === 'apagar' ||
                            text === 'done' ||
                            text === 'ok' ||
                            title === 'fechar' ||
                            title === 'apagar' ||
                            aria === 'fechar' ||
                            aria === 'apagar' ||
                            cls.includes('Close') ||
                            cls.includes('Remove') ||
                            cls.includes('Delete') ||
                            cls.includes('Done');

                        if (topRight && looksClose) {
                            el.dispatchEvent(new MouseEvent('mousemove', { bubbles: true }));
                            el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
                            el.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
                            el.click();
                            return true;
                        }
                    }
                }
                return false;
            }""")
            if closed:
                logger.info("Betslip fechado via heuristica do topo direito")
                await asyncio.sleep(0.25)
                return
        except Exception:
            pass

        try:
            receipt_point = await page.evaluate("""() => {
                const visible = (el) => {
                    if (!el) return false;
                    const style = window.getComputedStyle(el);
                    if (style.visibility === 'hidden' || style.display === 'none') return false;
                    const rect = el.getBoundingClientRect();
                    return rect.width > 50 && rect.height > 50;
                };

                const container = Array.from(document.querySelectorAll(
                    '.bs-Receipt, .bsf-ReceiptContent, .bss-ReceiptContent, .bss-StandardBetslip'
                )).find(visible);
                if (!container) return null;

                const rect = container.getBoundingClientRect();
                return {
                    x: Math.max(rect.left + 10, rect.right - 24),
                    y: rect.top + 22,
                };
            }""")
            if receipt_point:
                await page.mouse.click(receipt_point["x"], receipt_point["y"])
                logger.info(
                    "Betslip fechado via clique de fallback em ({:.0f}, {:.0f})",
                    receipt_point["x"],
                    receipt_point["y"],
                )
                await asyncio.sleep(0.25)
        except Exception:
            pass

    async def take_screenshot(self, page: Page, path: str) -> str:
        """Tira screenshot como comprovante."""
        try:
            await page.screenshot(path=path, full_page=True)
            logger.info("Screenshot salvo: {}", path)
            return path
        except Exception as e:
            logger.error("Erro ao tirar screenshot: {}", e)
            return ""
