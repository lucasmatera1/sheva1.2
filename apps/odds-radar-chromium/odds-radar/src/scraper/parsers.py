"""Parsers de DOM para extrair dados estruturados das páginas Bet365."""

from __future__ import annotations

import hashlib
from typing import TYPE_CHECKING

from src.models.odds import OddValue
from src.utils.logger import get_logger

if TYPE_CHECKING:
    from playwright.async_api import Page

logger = get_logger(__name__)


async def parse_match_rows(page: Page, selectors: dict) -> list[dict]:
    """Extrai linhas de eventos da página atual.

    Retorna lista de dicts com keys: event_id, home, away, league,
    is_live, score_home, score_away, minute, raw_odds.
    """
    rows: list[dict] = []

    # Tenta pegar containers de liga
    league_sections = await page.query_selector_all(
        selectors.get("league_header", ".no-match")
    )
    current_league = "Unknown"

    # Pega todas as linhas de eventos
    event_elements = await page.query_selector_all(
        selectors["event_row"]
    )

    for elem in event_elements:
        try:
            # Liga: tenta pegar do header mais próximo acima
            parent = elem
            for _ in range(5):
                parent = await parent.evaluate_handle("e => e.parentElement")
                league_el = await parent.as_element().query_selector(
                    selectors["league_header"]
                )
                if league_el:
                    current_league = (await league_el.inner_text()).strip()
                    break

            # Nomes dos times
            team_els = await elem.query_selector_all(selectors["team_name"])
            if len(team_els) < 2:
                continue

            home = (await team_els[0].inner_text()).strip()
            away = (await team_els[1].inner_text()).strip()

            if not home or not away:
                continue

            # Event ID — hash do par de times (bet365 não expõe ID fácil)
            event_id = hashlib.md5(f"{home}:{away}".encode()).hexdigest()[:12]

            # Odds
            odd_elements = await elem.query_selector_all(selectors["odd_cell"])
            raw_odds = []
            for oel in odd_elements:
                text = (await oel.inner_text()).strip()
                if text:
                    raw_odds.append(text)

            # Placar ao vivo
            score_home = score_away = None
            score_el = await elem.query_selector(selectors["live_score"])
            if score_el:
                score_text = (await score_el.inner_text()).strip()
                parts = score_text.replace("-", " ").split()
                if len(parts) >= 2:
                    try:
                        score_home = int(parts[0])
                        score_away = int(parts[1])
                    except ValueError:
                        pass

            # Tempo de jogo
            minute = None
            time_el = await elem.query_selector(selectors["match_time"])
            if time_el:
                minute = (await time_el.inner_text()).strip()

            rows.append({
                "event_id": event_id,
                "home": home,
                "away": away,
                "league": current_league,
                "is_live": True,
                "score_home": score_home,
                "score_away": score_away,
                "minute": minute,
                "raw_odds": raw_odds,
            })
        except Exception as e:
            logger.debug("Failed to parse event row: {}", e)

    return rows


def parse_odds_from_row(raw_odds: list[str]) -> list[OddValue]:
    """Converte lista de textos de odds em OddValue."""
    labels = ["Home", "Draw", "Away"]
    result = []

    for i, text in enumerate(raw_odds):
        try:
            value = float(text.replace(",", "."))
            label = labels[i] if i < len(labels) else f"Sel{i+1}"
            result.append(OddValue(label=label, value=value))
        except ValueError:
            logger.debug("Could not parse odd text: {}", text)

    return result
