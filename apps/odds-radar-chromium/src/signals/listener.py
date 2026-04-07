"""Signal Listener — recebe sinais de aposta da API Sheva via polling."""

from __future__ import annotations

import asyncio
import hashlib
from datetime import datetime
from typing import AsyncGenerator

import httpx

from config.settings import AutoBetSettings, get_settings
from src.models.odds import BetSignal
from src.utils.logger import get_logger

logger = get_logger(__name__)

# Mapeamento de ligas Sheva → URLs Bet365
LEAGUE_URLS = {
    "GT": "https://www.bet365.bet.br/#/AC/B1/C1/D1002/E71755867/G40/",
    "eBattle": "https://www.bet365.bet.br/#/AC/B1/C1/D1002/E71755867/G40/",
    "H2H": "https://www.bet365.bet.br/#/AC/B1/C1/D1002/E71755867/G40/",
    "Volta": "https://www.bet365.bet.br/#/AC/B1/C1/D1002/E71755867/G40/",
}


class SignalListener:
    """Faz polling no endpoint da API Sheva para buscar sinais pendentes."""

    def __init__(
        self,
        sheva_api_url: str | None = None,
        settings: AutoBetSettings | None = None,
    ):
        s = get_settings()
        self._base_url = (sheva_api_url or s.sheva_api_url).rstrip("/")
        self._settings = settings or s.autobet
        self._client = httpx.AsyncClient(timeout=15)
        self._seen_ids: set[str] = set()

    async def poll_signals(self) -> AsyncGenerator[BetSignal, None]:
        """Faz uma requisição à API e retorna sinais novos."""
        url = f"{self._base_url}/api/alerts/dispatches"
        params = {"limit": 20, "status": "pending_bet"}

        try:
            resp = await self._client.get(url, params=params)
            if resp.status_code != 200:
                logger.warning("Sheva API retornou {}: {}", resp.status_code, resp.text[:200])
                return

            dispatches = resp.json()
            if not isinstance(dispatches, list):
                dispatches = dispatches.get("data", []) if isinstance(dispatches, dict) else []

            for d in dispatches:
                sig = self._parse_dispatch(d)
                if sig and sig.signal_id not in self._seen_ids:
                    self._seen_ids.add(sig.signal_id)
                    yield sig

        except Exception as e:
            logger.error("Erro ao buscar sinais: {}", e)

    def _parse_dispatch(self, d: dict) -> BetSignal | None:
        """Converte um dispatch da API Sheva em BetSignal."""
        try:
            dispatch_id = str(d.get("id", ""))
            if not dispatch_id:
                return None

            # Determina side e jogadores
            home = d.get("homePlayer", "") or d.get("home_player", "")
            away = d.get("awayPlayer", "") or d.get("away_player", "")
            method = d.get("methodCode", "") or d.get("method_code", "")
            league = d.get("leagueCode", "") or d.get("league_code", "")

            # O side vem do dispatch: qual jogador apostar
            side_raw = d.get("betSide", "") or d.get("side", "home")
            side = side_raw.lower() if side_raw in ("home", "away", "draw") else "home"

            odd_min = float(d.get("oddMin", 0) or d.get("odd_min", 0) or 1.30)

            bet365_url = LEAGUE_URLS.get(league, "")

            return BetSignal(
                signal_id=dispatch_id,
                home_player=home,
                away_player=away,
                side=side,
                method_code=method,
                league=league,
                odd_min=odd_min,
                bet365_url=bet365_url,
            )
        except Exception as e:
            logger.debug("Erro ao parsear dispatch: {}", e)
            return None

    async def mark_processed(self, signal_id: str, status: str) -> None:
        """Marca um dispatch como processado na API Sheva."""
        url = f"{self._base_url}/api/alerts/dispatches/{signal_id}/bet-status"
        try:
            await self._client.patch(url, json={"betStatus": status})
        except Exception as e:
            logger.warning("Erro ao marcar dispatch {}: {}", signal_id, e)

    async def close(self) -> None:
        await self._client.aclose()
