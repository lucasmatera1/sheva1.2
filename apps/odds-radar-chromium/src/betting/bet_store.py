"""BetStore — persistência de apostas via aiosqlite.

Substitui o BetLogger CSV com banco SQLite queryable.
Armazena: apostas, P&L, sessões, erros.
"""

from __future__ import annotations

import asyncio
from datetime import datetime, date, timedelta
from pathlib import Path

import aiosqlite

from src.utils.logger import get_logger

logger = get_logger(__name__)

DB_DIR = Path(__file__).resolve().parent.parent.parent / "data"
DB_PATH = DB_DIR / "bets.db"

_CREATE_SQL = """
CREATE TABLE IF NOT EXISTS bets (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    created_at  TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f','now')),
    signal_raw  TEXT,
    player      TEXT,
    teams       TEXT,
    market      TEXT,
    line        REAL,
    odd_signal  REAL,
    odd_page    REAL,
    stake       REAL    NOT NULL DEFAULT 0,
    receipt     TEXT,
    sr          INTEGER DEFAULT -1,
    cs          INTEGER DEFAULT -1,
    success     INTEGER DEFAULT 0,
    profit      REAL    DEFAULT 0,
    duration_s  REAL    DEFAULT 0,
    error       TEXT,
    attempt     INTEGER DEFAULT 1
);

CREATE TABLE IF NOT EXISTS sessions (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    started_at  TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f','now')),
    ended_at    TEXT,
    bets_placed INTEGER DEFAULT 0,
    bets_won    INTEGER DEFAULT 0,
    pnl         REAL    DEFAULT 0,
    uptime_s    REAL    DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_bets_created ON bets(created_at);
CREATE INDEX IF NOT EXISTS idx_bets_success ON bets(success);
"""


class BetStore:
    """Persistência SQLite async para apostas."""

    def __init__(self, db_path: Path | str | None = None) -> None:
        self._path = Path(db_path) if db_path else DB_PATH
        self._db: aiosqlite.Connection | None = None
        self._session_id: int | None = None

    async def open(self) -> None:
        self._path.parent.mkdir(parents=True, exist_ok=True)
        self._db = await aiosqlite.connect(str(self._path))
        self._db.row_factory = aiosqlite.Row
        await self._db.executescript(_CREATE_SQL)
        await self._db.commit()
        logger.info("BetStore aberto: {}", self._path)

    async def close(self) -> None:
        if self._db:
            await self._db.close()
            self._db = None

    async def start_session(self) -> int:
        assert self._db
        cur = await self._db.execute(
            "INSERT INTO sessions (started_at) VALUES (?)",
            (datetime.utcnow().isoformat(),),
        )
        await self._db.commit()
        self._session_id = cur.lastrowid
        logger.info("Session #{} iniciada", self._session_id)
        return self._session_id

    async def end_session(self, bets_placed: int = 0, bets_won: int = 0,
                          pnl: float = 0.0, uptime_s: float = 0.0) -> None:
        if not self._db or not self._session_id:
            return
        await self._db.execute(
            "UPDATE sessions SET ended_at=?, bets_placed=?, bets_won=?, pnl=?, uptime_s=? WHERE id=?",
            (datetime.utcnow().isoformat(), bets_placed, bets_won, pnl, uptime_s, self._session_id),
        )
        await self._db.commit()

    async def log_bet(
        self,
        *,
        signal_raw: str = "",
        player: str = "",
        teams: str = "",
        market: str = "",
        line: float | None = None,
        odd_signal: float | None = None,
        odd_page: float | None = None,
        stake: float = 0.0,
        receipt: str = "",
        sr: int = -1,
        cs: int = -1,
        success: bool = False,
        profit: float = 0.0,
        duration_s: float = 0.0,
        error: str = "",
        attempt: int = 1,
    ) -> int:
        assert self._db
        cur = await self._db.execute(
            """INSERT INTO bets
               (signal_raw, player, teams, market, line, odd_signal, odd_page,
                stake, receipt, sr, cs, success, profit, duration_s, error, attempt)
               VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
            (signal_raw, player, teams, market, line, odd_signal, odd_page,
             stake, receipt, sr, cs, int(success), profit, duration_s, error, attempt),
        )
        await self._db.commit()
        return cur.lastrowid

    async def daily_pnl(self, day: date | None = None) -> float:
        assert self._db
        d = (day or date.today()).isoformat()
        cur = await self._db.execute(
            "SELECT COALESCE(SUM(profit), 0) FROM bets WHERE date(created_at)=?",
            (d,),
        )
        row = await cur.fetchone()
        return float(row[0])

    async def daily_stats(self, day: date | None = None) -> dict:
        assert self._db
        d = (day or date.today()).isoformat()
        cur = await self._db.execute(
            """SELECT
                 COUNT(*) as total,
                 SUM(CASE WHEN success=1 THEN 1 ELSE 0 END) as wins,
                 COALESCE(SUM(stake), 0) as total_stake,
                 COALESCE(SUM(profit), 0) as pnl,
                 COALESCE(AVG(duration_s), 0) as avg_time
               FROM bets WHERE date(created_at)=?""",
            (d,),
        )
        row = await cur.fetchone()
        return {
            "total": row[0],
            "wins": row[1],
            "total_stake": float(row[2]),
            "pnl": float(row[3]),
            "avg_time": float(row[4]),
            "win_rate": (row[1] / row[0] * 100) if row[0] > 0 else 0.0,
        }

    async def hourly_count(self) -> int:
        assert self._db
        one_hour_ago = (datetime.utcnow() - timedelta(hours=1)).isoformat()
        cur = await self._db.execute(
            "SELECT COUNT(*) FROM bets WHERE created_at >= ? AND success=1",
            (one_hour_ago,),
        )
        row = await cur.fetchone()
        return int(row[0])

    async def daily_loss(self, day: date | None = None) -> float:
        pnl = await self.daily_pnl(day)
        return max(0.0, -pnl)

    async def recent_bets(self, limit: int = 10) -> list[dict]:
        assert self._db
        cur = await self._db.execute(
            "SELECT * FROM bets ORDER BY id DESC LIMIT ?", (limit,)
        )
        rows = await cur.fetchall()
        return [dict(r) for r in rows]

    async def lifetime_stats(self) -> dict:
        assert self._db
        cur = await self._db.execute(
            """SELECT
                 COUNT(*) as total,
                 SUM(CASE WHEN success=1 THEN 1 ELSE 0 END) as wins,
                 COALESCE(SUM(stake), 0) as total_stake,
                 COALESCE(SUM(profit), 0) as pnl
               FROM bets"""
        )
        row = await cur.fetchone()
        return {
            "total": row[0],
            "wins": row[1],
            "total_stake": float(row[2]),
            "pnl": float(row[3]),
            "win_rate": (row[1] / row[0] * 100) if row[0] > 0 else 0.0,
        }
