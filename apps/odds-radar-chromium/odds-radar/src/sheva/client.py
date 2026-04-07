"""Client HTTP para enviar odds extraídas à API do Sheva."""

from __future__ import annotations

import httpx

from config.settings import get_settings
from src.models.odds import OddsSnapshot, ScanResult
from src.utils.logger import get_logger

logger = get_logger(__name__)


class ShevaClient:
    """Envia odds ao endpoint POST /api/alerts/dispatches/odds do Sheva."""

    def __init__(self, base_url: str | None = None):
        self._base_url = (base_url or get_settings().sheva_api_url).rstrip("/")
        self._client = httpx.AsyncClient(timeout=15)

    async def push_scan_odds(self, result: ScanResult) -> None:
        """Itera snapshots de um scan e envia cada confronto ao Sheva."""
        if not result.snapshots:
            return

        for snap in result.snapshots:
            await self._push_snapshot(snap)

    async def _push_snapshot(self, snap: OddsSnapshot) -> None:
        m = snap.match

        # Precisamos de home_odd e away_odd (labels "1" e "2" no mercado 1X2)
        odds_by_label = {o.label: o.value for o in snap.odds}
        home_odd = odds_by_label.get("1") or odds_by_label.get("Home")
        away_odd = odds_by_label.get("2") or odds_by_label.get("Away")

        if home_odd is None or away_odd is None:
            logger.debug(
                "Skipping {} vs {} — missing home/away odds (labels: {})",
                m.home, m.away, list(odds_by_label.keys()),
            )
            return

        body = {
            "homePlayer": m.home,
            "awayPlayer": m.away,
            "homeOdd": home_odd,
            "awayOdd": away_odd,
        }
        if m.url:
            body["link"] = m.url

        url = f"{self._base_url}/api/alerts/dispatches/odds"

        try:
            resp = await self._client.post(url, json=body)
            data = resp.json()
            matched = data.get("matched", 0)

            if matched > 0:
                logger.info(
                    "Sheva: {} odds aplicadas para {} vs {}",
                    matched, m.home, m.away,
                )
            else:
                logger.debug(
                    "Sheva: nenhum dispatch pendente para {} vs {}",
                    m.home, m.away,
                )
        except httpx.ConnectError:
            logger.warning("Sheva API offline — ignorando push de odds")
        except Exception as e:
            logger.error("Sheva push falhou para {} vs {}: {}", m.home, m.away, e)

    async def close(self) -> None:
        await self._client.aclose()
