"""Scraper principal para Bet365 — navegação, extração e monitoramento de odds."""

from __future__ import annotations

import asyncio
import hashlib
from datetime import datetime
from typing import TYPE_CHECKING

from config.settings import ScraperSettings, get_settings
from src.browser.engine import BrowserEngine
from src.browser.session import load_cookies, save_cookies
from src.models.odds import (
    Match,
    MarketType,
    OddValue,
    OddsSnapshot,
    ScanResult,
    Sport,
)
from src.utils.logger import get_logger

if TYPE_CHECKING:
    from playwright.async_api import BrowserContext, Page

logger = get_logger(__name__)

# ─── Seletores DOM reais (validados 2026-03-20) ─────────────────────────────
# IMPORTANTE: Bet365 muda seletores frequentemente. Atualize quando quebrar.
SEL = {
    # Fixture row (container de cada partida na listagem)
    "fixture_row": ".rcl-ParticipantFixtureDetails",
    # Nome do jogador/time dentro do fixture
    "team_name": ".rcl-ParticipantFixtureDetailsTeam_TeamName",
    # Container de nomes
    "team_names_container": ".rcl-ParticipantFixtureDetails_TeamNames",
    # Odds
    "odd_cell": ".sgl-ParticipantOddsOnly80_Odds",
    # Liga / competição header
    "league_header": ".sph-EventWrapper_Label",
    # Relógio ao vivo
    "match_clock": ".rcl-ParticipantFixtureDetails_Clock",
    # Botão aceitar cookies
    "accept_cookies": "#onetrust-accept-btn-handler",
    # Breadcrumb (para verificar onde estamos)
    "breadcrumb": ".sph-BreadcrumbTrail",
    # Market group
    "market_group": ".gl-MarketGroupContainer",
    # Market header labels (1, X, 2)
    "market_header": ".rcl-MarketColumnHeader, .rcl-MarketHeaderLabel",
}


class Bet365Scraper:
    """Lógica de navegação e extração de dados do Bet365."""

    def __init__(
        self,
        engine: BrowserEngine,
        settings: ScraperSettings | None = None,
    ):
        self.engine = engine
        self.settings = settings or get_settings().scraper
        self._odd_cache: dict[str, list[OddValue]] = {}

    async def run_scan(self) -> ScanResult:
        """Executa um ciclo completo de scan."""
        result = ScanResult()
        async with self.engine.launch() as context:
            await load_cookies(context)
            page = await self.engine.new_page(context)

            try:
                await self._navigate_to(page, self.settings.base_url)
                await self._dismiss_popups(page)
                await self._navigate_to_esoccer_gt(page)

                # Força reload da página para garantir dados atualizados
                await page.reload(wait_until="domcontentloaded")
                await asyncio.sleep(3)
                snapshots = await self._extract_all_odds(page)
                result.snapshots.extend(snapshots)
                result.pages_visited = 1

                await save_cookies(context)
            except Exception as e:
                msg = f"Erro fatal no scan: {e}"
                logger.error(msg)
                result.errors.append(msg)
            finally:
                await page.close()

            result.scan_ended = datetime.utcnow()
        return result

    async def run_scan_url(self, url: str) -> ScanResult:
        """Executa scan em uma URL específica do Bet365."""
        result = ScanResult()
        async with self.engine.launch() as context:
            await load_cookies(context)
            page = await self.engine.new_page(context)

            try:
                await self._navigate_to(page, url)
                await self._dismiss_popups(page)

                snapshots = await self._extract_all_odds(page)
                result.snapshots.extend(snapshots)
                result.pages_visited = 1

                await save_cookies(context)
            except Exception as e:
                msg = f"Erro fatal no scan: {e}"
                logger.error(msg)
                result.errors.append(msg)
            finally:
                await page.close()

            result.scan_ended = datetime.utcnow()
        return result

    # ─── Navegação ───────────────────────────────────────────────────────────

    async def _navigate_to(self, page: Page, url: str) -> None:
        """Navega para uma URL com retries."""
        for attempt in range(3):
            try:
                logger.info("Navigating to {} (attempt {})", url[:80], attempt + 1)
                await page.goto(url, wait_until="domcontentloaded")
                # Espera conteúdo dinâmico carregar
                await asyncio.sleep(8)
                await self.engine.human_delay(2000, 4000)
                return
            except Exception as e:
                logger.warning("Navigation attempt {} failed: {}", attempt + 1, e)
                if attempt == 2:
                    raise
                await asyncio.sleep(5)

    async def _dismiss_popups(self, page: Page) -> None:
        """Fecha popups de cookies."""
        try:
            btn = await page.query_selector(SEL["accept_cookies"])
            if btn:
                await btn.click()
                logger.debug("Cookie popup dismissed")
                await self.engine.human_delay(500, 1000)
        except Exception:
            pass

    async def _navigate_to_esoccer_gt(self, page: Page) -> None:
        """Navega até E-Sports > Esoccer GT Leagues no Bet365.

        Fluxo real (validado 2026-03-20):
        1. Homepage → clica "E-Sports" no sidebar (wn-PreMatchItem)
        2. Página #/AS/B151/ carrega com lista de competições
        3. Scroll ate encontrar "Esoccer GT Leagues" (sm-SplashMarketGroup)
        4. Clica → abre a página de fixtures com odds
        """
        # Se já tem fixtures carregados, pula
        already = await page.query_selector(SEL["fixture_row"])
        if already:
            logger.debug("Already on a page with fixtures, skipping drill-down")
            return

        # 1. Clica em "E-Sports" no sidebar
        clicked = await page.evaluate("""() => {
            const items = document.querySelectorAll('.wn-PreMatchItem');
            for (const el of items) {
                const text = (el.textContent || '').trim();
                if (text === 'E-Sports') {
                    el.click();
                    return text;
                }
            }
            return null;
        }""")
        if clicked:
            logger.info("Clicked sidebar: {}", clicked)
            await asyncio.sleep(5)
            await self.engine.human_delay(1000, 2000)
        else:
            logger.warning("E-Sports sidebar item not found")
            return

        # 2. Scroll + clica no botão "GT Leagues" (sm-SplashMarketGroupButton_Text)
        clicked_gt = await self._click_gt_league_button(page)
        if not clicked_gt:
            logger.warning("GT Leagues not found, scrolling to load more...")
            for _ in range(8):
                await page.evaluate("window.scrollBy(0, 600)")
                await asyncio.sleep(1)
            clicked_gt = await self._click_gt_league_button(page)

        if clicked_gt:
            logger.info("Navigated to league: {}", clicked_gt)
            await asyncio.sleep(5)
            await self.engine.human_delay(1000, 2000)
        else:
            logger.warning("GT Leagues block not found after scrolling")

    async def _click_gt_league_button(self, page: Page) -> str | None:
        """Encontra, scroll e clica no botão de GT Leagues via Playwright click nativo."""
        # Primeiro scroll o elemento para a view
        await page.evaluate("""() => {
            const btns = document.querySelectorAll('.sm-SplashMarketGroupButton_Text');
            for (const el of btns) {
                const text = (el.textContent || '').trim().toLowerCase();
                if (text.includes('gt leagues')) {
                    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
                    return true;
                }
            }
            return false;
        }""")
        await asyncio.sleep(1)
        # Agora clica com Playwright (mouse event real)
        btn = page.locator(".sm-SplashMarketGroupButton_Text", has_text="GT Leagues")
        if await btn.count() > 0:
            text = await btn.first.text_content()
            await btn.first.click()
            return (text or "").strip()
        return None

    # ─── Extração ────────────────────────────────────────────────────────────

    async def _extract_all_odds(self, page: Page) -> list[OddsSnapshot]:
        """Extrai odds usando JavaScript no DOM real do Bet365.

        Layout do DOM Bet365:
        - Fixtures ficam à esquerda (rcl-ParticipantFixtureDetails)
        - Odds ficam em colunas separadas à direita (sgl-MarketOddsExpand)
        - Cada coluna de mercado (1, X, 2) tem N odds, uma por fixture na mesma ordem
        """
        data = await page.evaluate("""() => {
            const results = [];

            // Liga
            const leagueEl = document.querySelector('.sph-EventWrapper_Label');
            const league = leagueEl ? leagueEl.textContent.trim() : 'Unknown';

            // Fixtures (nomes + relógio + placar)
            const fixtureEls = document.querySelectorAll('.rcl-ParticipantFixtureDetails');
            const fixtures = [];
            for (const fix of fixtureEls) {
                const nameEls = fix.querySelectorAll('.rcl-ParticipantFixtureDetailsTeam_TeamName');
                if (nameEls.length < 2) continue;
                const home = nameEls[0].textContent.trim();
                const away = nameEls[1].textContent.trim();
                if (!home || !away) continue;

                const clockEl = fix.querySelector('.rcl-ParticipantFixtureDetails_Clock');
                const clock = clockEl ? clockEl.textContent.trim() : null;

                // Detecta placar visível (jogos ao vivo ou finalizados)
                let scoreHome = null;
                let scoreAway = null;
                const scoreEls = fix.querySelectorAll('[class*="ScoreContainer"] [class*="HistoryTextField"], [class*="Score_"]');
                const digits = [];
                for (const s of scoreEls) {
                    const t = s.textContent.trim();
                    if (/^\\d+$/.test(t)) digits.push(parseInt(t, 10));
                }
                if (digits.length >= 2) {
                    scoreHome = digits[0];
                    scoreAway = digits[1];
                }

                fixtures.push({ home, away, clock, scoreHome, scoreAway });
            }

            if (fixtures.length === 0) return results;

            // Colunas de mercado — detecta odds suspensas via classe _Suspended no pai
            const marketCols = document.querySelectorAll('.sgl-MarketOddsExpand');
            const columns = [];
            for (const col of marketCols) {
                const cellEls = col.querySelectorAll('.sgl-ParticipantOddsOnly80');
                const vals = [];
                for (const cell of cellEls) {
                    const isSuspended = cell.className.includes('Suspended');
                    if (isSuspended) {
                        vals.push('SUSPENDED');
                    } else {
                        const oddEl = cell.querySelector('.sgl-ParticipantOddsOnly80_Odds');
                        vals.push(oddEl ? oddEl.textContent.trim() : '');
                    }
                }
                if (vals.length > 0) columns.push(vals);
            }

            // Labels de mercado (1, X, 2)
            const labels = ['1', 'X', '2'];

            // Monta resultado: para cada fixture i, pega odds[i] de cada coluna
            const numFixtures = fixtures.length;
            for (let i = 0; i < numFixtures; i++) {
                const fix = fixtures[i];
                const odds = [];
                for (let c = 0; c < columns.length; c++) {
                    const col = columns[c];
                    if (col.length === numFixtures) {
                        odds.push({ label: labels[c] || ('Sel' + (c+1)), value: col[i] });
                    } else if (col.length === numFixtures * 2) {
                        odds.push({ label: labels[c] + 'H', value: col[i * 2] });
                        odds.push({ label: labels[c] + 'A', value: col[i * 2 + 1] });
                    } else {
                        if (i < col.length) {
                            odds.push({ label: labels[c] || ('Sel' + (c+1)), value: col[i] });
                        }
                    }
                }
                results.push({
                    home: fix.home, away: fix.away, league,
                    clock: fix.clock, odds,
                    scoreHome: fix.scoreHome, scoreAway: fix.scoreAway
                });
            }

            return results;
        }""")

        logger.info("Extracted {} fixtures from page", len(data))

        snapshots: list[OddsSnapshot] = []
        for item in data:
            try:
                event_id = hashlib.md5(
                    f"{item['home']}:{item['away']}".encode()
                ).hexdigest()[:12]

                match = Match(
                    event_id=event_id,
                    sport=Sport.SOCCER,
                    league=item.get("league", "Unknown"),
                    home=item["home"],
                    away=item["away"],
                    is_live=bool(item.get("clock")),
                    minute=item.get("clock"),
                    score_home=item.get("scoreHome"),
                    score_away=item.get("scoreAway"),
                )

                # Jogo finalizado: tem placar mas sem relógio (não é ao vivo)
                is_finished = (
                    item.get("scoreHome") is not None
                    and not item.get("clock")
                )

                odds_values = []
                for o in item.get("odds", []):
                    try:
                        val = float(str(o["value"]).replace(",", "."))
                        if self.settings.min_odd <= val <= self.settings.max_odd:
                            odds_values.append(OddValue(label=o["label"], value=val))
                    except ValueError:
                        continue

                if not odds_values:
                    continue

                # Pula jogos finalizados (odds residuais, mas jogo já acabou)
                if is_finished:
                    logger.debug(
                        "Skipping finished: {} vs {} ({}-{})",
                        item["home"], item["away"],
                        item.get("scoreHome"), item.get("scoreAway"),
                    )
                    continue

                enriched = self._detect_movement(event_id, odds_values)

                snapshots.append(OddsSnapshot(
                    match=match,
                    market=MarketType.MATCH_WINNER,
                    odds=enriched,
                ))
            except Exception as e:
                logger.debug("Error parsing fixture: {}", e)

        return snapshots

    def _detect_movement(
        self, event_id: str, current: list[OddValue]
    ) -> list[OddValue]:
        """Compara odds atuais com cache e marca movimentação."""
        previous = self._odd_cache.get(event_id, [])
        prev_map = {o.label: o.value for o in previous}

        enriched = []
        for odd in current:
            prev_val = prev_map.get(odd.label)
            enriched.append(
                OddValue(label=odd.label, value=odd.value, previous=prev_val)
            )

        self._odd_cache[event_id] = current
        return enriched
