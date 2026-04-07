"""Heartbeat — envia status periódico via Telegram.

Reporta a cada HEARTBEAT_INTERVAL_MIN (default 30min):
  - Apostas feitas / aceitas
  - P&L do dia
  - Uptime
  - Último erro
"""

from __future__ import annotations

import asyncio
import time
from datetime import datetime

from src.utils.logger import get_logger

logger = get_logger(__name__)

HEARTBEAT_INTERVAL_MIN = 30


class Heartbeat:
    """Envia heartbeat periódico via Telegram client."""

    def __init__(
        self,
        client,
        chat_id: int | str,
        interval_min: int = HEARTBEAT_INTERVAL_MIN,
    ) -> None:
        self._client = client
        self._chat_id = chat_id
        self._interval = interval_min * 60
        self._started_at = time.time()
        self._task: asyncio.Task | None = None
        self._bet_count = 0
        self._win_count = 0
        self._daily_pnl = 0.0
        self._last_error = ""
        self._bet_store = None  # Optional BetStore

    def set_store(self, store) -> None:
        self._bet_store = store

    def record_bet(self, success: bool, profit: float = 0.0) -> None:
        self._bet_count += 1
        if success:
            self._win_count += 1
        self._daily_pnl += profit

    def record_error(self, error: str) -> None:
        self._last_error = error

    def start(self) -> None:
        if self._task and not self._task.done():
            return
        self._task = asyncio.create_task(self._loop())
        logger.info("Heartbeat ativo — intervalo {}min → chat {}", self._interval // 60, self._chat_id)

    def stop(self) -> None:
        if self._task:
            self._task.cancel()
            self._task = None

    async def send_now(self) -> None:
        msg = await self._build_message()
        try:
            await self._client.send_message(self._chat_id, msg)
        except Exception as e:
            logger.warning("Heartbeat send falhou: {}", e)

    async def _build_message(self) -> str:
        uptime_s = time.time() - self._started_at
        hours = int(uptime_s // 3600)
        minutes = int((uptime_s % 3600) // 60)

        # Se BetStore disponível, pega dados reais
        if self._bet_store:
            try:
                stats = await self._bet_store.daily_stats()
                total = stats["total"]
                wins = stats["wins"]
                pnl = stats["pnl"]
                win_rate = stats["win_rate"]
            except Exception:
                total = self._bet_count
                wins = self._win_count
                pnl = self._daily_pnl
                win_rate = (wins / total * 100) if total > 0 else 0.0
        else:
            total = self._bet_count
            wins = self._win_count
            pnl = self._daily_pnl
            win_rate = (wins / total * 100) if total > 0 else 0.0

        lines = [
            "💓 **HEARTBEAT — Sheva Bot**",
            f"⏱ Uptime: {hours}h{minutes:02d}m",
            f"🎯 Apostas: {total} ({wins} aceitas — {win_rate:.0f}%)",
            f"💰 P&L dia: R${pnl:+.2f}",
        ]
        if self._last_error:
            lines.append(f"⚠️ Último erro: {self._last_error[:100]}")
        lines.append(f"🕐 {datetime.utcnow().strftime('%H:%M UTC')}")
        return "\n".join(lines)

    async def _loop(self) -> None:
        await asyncio.sleep(60)  # espera 1min antes do primeiro heartbeat
        while True:
            try:
                await self.send_now()
            except asyncio.CancelledError:
                return
            except Exception as e:
                logger.warning("Heartbeat loop erro: {}", e)
            await asyncio.sleep(self._interval)
