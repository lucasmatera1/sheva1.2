"""Modelos de dados imutáveis para odds e partidas."""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime
from enum import Enum


class Sport(str, Enum):
    SOCCER = "soccer"
    BASKETBALL = "basketball"
    TENNIS = "tennis"
    ESPORTS = "esports"


class MarketType(str, Enum):
    MATCH_WINNER = "1X2"
    OVER_UNDER = "O/U"
    BOTH_TEAMS_SCORE = "BTTS"
    HANDICAP = "HC"
    DOUBLE_CHANCE = "DC"
    CORRECT_SCORE = "CS"


@dataclass(frozen=True)
class OddValue:
    label: str          # ex: "Home", "Draw", "Away", "Over 2.5"
    value: float        # ex: 1.85
    previous: float | None = None  # valor anterior p/ detectar movimentação


@dataclass(frozen=True)
class Match:
    event_id: str
    sport: Sport
    league: str
    home: str
    away: str
    kickoff: datetime | None = None
    is_live: bool = False
    score_home: int | None = None
    score_away: int | None = None
    minute: str | None = None  # "45'", "HT", etc.
    url: str = ""


@dataclass(frozen=True)
class OddsSnapshot:
    match: Match
    market: MarketType
    odds: list[OddValue]
    scraped_at: datetime = field(default_factory=datetime.utcnow)


@dataclass
class ScanResult:
    snapshots: list[OddsSnapshot] = field(default_factory=list)
    errors: list[str] = field(default_factory=list)
    scan_started: datetime = field(default_factory=datetime.utcnow)
    scan_ended: datetime | None = None
    pages_visited: int = 0


# ─── Auto-bet models ────────────────────────────────────────────────────────


class BetStatus(str, Enum):
    PENDING = "pending"          # Aguardando confirmação do Telegram
    CONFIRMED = "confirmed"      # Usuário confirmou /apostar
    CANCELLED = "cancelled"      # Usuário cancelou /cancelar
    TIMEOUT = "timeout"          # Sem resposta dentro do prazo
    PLACED = "placed"            # Aposta enviada ao Bet365
    ACCEPTED = "accepted"        # Bet365 confirmou a aposta
    REJECTED = "rejected"        # Bet365 recusou (odd mudou, etc)
    ERROR = "error"              # Erro técnico


@dataclass
class BetSignal:
    """Sinal recebido da API Sheva para apostar."""
    signal_id: str
    home_player: str
    away_player: str
    side: str                    # "home" | "away" | "draw"
    method_code: str             # ex: "2D", "3D", "TROCA"
    league: str                  # ex: "GT", "H2H", "eBattle"
    odd_min: float               # odd mínima aceitável
    bet365_url: str = ""         # URL direta da liga no Bet365
    received_at: datetime = field(default_factory=datetime.utcnow)


@dataclass
class BetRecord:
    """Registro de uma aposta (tentada ou executada)."""
    signal: BetSignal
    status: BetStatus = BetStatus.PENDING
    stake: float = 0.0
    odd_found: float = 0.0
    odd_at_confirm: float = 0.0  # Odd no momento do clique final
    potential_return: float = 0.0
    screenshot_path: str = ""
    error_message: str = ""
    created_at: datetime = field(default_factory=datetime.utcnow)
    confirmed_at: datetime | None = None
    placed_at: datetime | None = None
