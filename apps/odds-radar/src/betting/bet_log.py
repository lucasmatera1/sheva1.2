"""Bet Logger — registra apostas em CSV para tracking de P&L."""

from __future__ import annotations

import csv
from collections import defaultdict
from datetime import datetime, date
from pathlib import Path

from src.models.odds import BetRecord, BetStatus
from src.utils.logger import get_logger

logger = get_logger(__name__)

LOG_DIR = Path(__file__).resolve().parent.parent.parent / "data"
BETS_CSV = LOG_DIR / "bets.csv"

CSV_HEADERS = [
    "created_at", "signal_id", "home_player", "away_player", "side",
    "league", "method", "odd_found", "odd_at_confirm", "stake",
    "potential_return", "status", "error",
]


class BetLogger:
    """Registra apostas em CSV e controla limites diários."""

    def __init__(self) -> None:
        LOG_DIR.mkdir(parents=True, exist_ok=True)
        self._ensure_csv()
        self._daily_records: list[BetRecord] = []
        self._today: date = date.today()

    def _ensure_csv(self) -> None:
        if not BETS_CSV.exists():
            with open(BETS_CSV, "w", newline="", encoding="utf-8") as f:
                writer = csv.writer(f)
                writer.writerow(CSV_HEADERS)

    def log_bet(self, record: BetRecord) -> None:
        """Grava uma aposta no CSV."""
        s = record.signal
        row = [
            record.created_at.isoformat(),
            s.signal_id,
            s.home_player,
            s.away_player,
            s.side,
            s.league,
            s.method_code,
            f"{record.odd_found:.2f}",
            f"{record.odd_at_confirm:.2f}",
            f"{record.stake:.2f}",
            f"{record.potential_return:.2f}",
            record.status.value,
            record.error_message,
        ]
        with open(BETS_CSV, "a", newline="", encoding="utf-8") as f:
            writer = csv.writer(f)
            writer.writerow(row)

        self._refresh_daily()
        self._daily_records.append(record)
        logger.info("Bet logged: {} vs {} | {} | odd={:.2f} | stake={:.2f} | status={}",
                     s.home_player, s.away_player, s.side,
                     record.odd_found, record.stake, record.status.value)

    def _refresh_daily(self) -> None:
        """Reseta contadores se mudou o dia."""
        today = date.today()
        if today != self._today:
            self._daily_records = []
            self._today = today

    def daily_bet_count(self) -> int:
        self._refresh_daily()
        return sum(1 for r in self._daily_records if r.status in (
            BetStatus.PLACED, BetStatus.ACCEPTED
        ))

    def daily_loss(self) -> float:
        """Retorna perda líquida do dia (stakes de apostas aceitas sem retorno confirmado)."""
        self._refresh_daily()
        return sum(r.stake for r in self._daily_records if r.status == BetStatus.ACCEPTED)

    def hourly_bet_count(self) -> int:
        """Conta apostas colocadas na última hora."""
        self._refresh_daily()
        now = datetime.utcnow()
        return sum(
            1 for r in self._daily_records
            if r.status in (BetStatus.PLACED, BetStatus.ACCEPTED)
            and r.created_at
            and (now - r.created_at).total_seconds() < 3600
        )
