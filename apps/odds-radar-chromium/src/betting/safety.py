"""Safety Guard — controle de risco e sistema de unidades (µ).

Inspirado nas funcionalidades de segurança do Tippy.bet:
- Stop-loss diário
- Limite máximo por aposta
- Sistema de unidades (µ) para gerenciamento de banca
- Rate limiting (apostas/hora)
"""

from __future__ import annotations

import random
from dataclasses import dataclass, field
from datetime import datetime
from enum import Enum

from config.settings import AutoBetSettings, get_settings
from src.utils.logger import get_logger

logger = get_logger(__name__)


class RejectReason(str, Enum):
    OK = "ok"
    DISABLED = "autobet_disabled"
    STOP_LOSS = "stop_loss_atingido"
    MAX_STAKE = "stake_acima_max"
    RATE_LIMIT = "limite_hora_atingido"
    ODD_TOO_LOW = "odd_abaixo_min"
    ODD_TOO_HIGH = "odd_acima_max"


@dataclass
class SafetyCheck:
    """Resultado da verificação de segurança."""
    allowed: bool
    reason: RejectReason
    detail: str = ""
    adjusted_stake: float = 0.0  # stake final após ajustes


@dataclass
class UnitSystem:
    """Sistema de unidades (µ) — converte entre unidades e R$.

    Uma unidade = valor base da banca dividido por unidades totais.
    Ex: banca R$1000, 100 µ → 1µ = R$10.
    """
    bankroll: float = 1000.0    # Banca total em R$
    total_units: int = 100      # Número de unidades na banca

    @property
    def unit_value(self) -> float:
        """Valor de 1µ em R$."""
        if self.total_units <= 0:
            return 0.0
        return self.bankroll / self.total_units

    def units_to_brl(self, units: float) -> float:
        """Converte unidades para R$."""
        return round(units * self.unit_value, 2)

    def brl_to_units(self, brl: float) -> float:
        """Converte R$ para unidades."""
        if self.unit_value <= 0:
            return 0.0
        return round(brl / self.unit_value, 2)


class SafetyGuard:
    """Guardião de segurança — verifica limites antes de cada aposta.

    Integra com BetLogger para tracking de P&L e com AutoBetSettings
    para configuração dos limites.
    """

    def __init__(
        self,
        bet_logger=None,
        unit_system: UnitSystem | None = None,
    ) -> None:
        self._settings: AutoBetSettings = get_settings().autobet
        self._bet_logger = bet_logger
        self.units = unit_system or UnitSystem()
        self._daily_pnl: float = 0.0
        self._today: str = datetime.utcnow().strftime("%Y-%m-%d")
        self._paused: bool = False
        self._pause_reason: str = ""

    def _refresh_daily(self) -> None:
        today = datetime.utcnow().strftime("%Y-%m-%d")
        if today != self._today:
            self._daily_pnl = 0.0
            self._today = today
            if self._paused and self._pause_reason == "stop_loss":
                self._paused = False
                self._pause_reason = ""
                logger.info("Novo dia → stop-loss resetado, apostas reativadas")

    def pause(self, reason: str = "manual") -> None:
        self._paused = True
        self._pause_reason = reason
        logger.warning("⚠️ Safety: apostas PAUSADAS (motivo: {})", reason)

    def resume(self) -> None:
        self._paused = False
        self._pause_reason = ""
        logger.info("✅ Safety: apostas RETOMADAS")

    @property
    def is_paused(self) -> bool:
        return self._paused

    def record_result(self, profit: float) -> None:
        """Registra resultado de uma aposta (positivo = lucro, negativo = perda)."""
        self._refresh_daily()
        self._daily_pnl += profit
        logger.info(
            "Safety P&L: aposta={:+.2f} | dia={:+.2f} | max_loss={:.2f}",
            profit, self._daily_pnl, self._settings.max_daily_loss,
        )
        if self._daily_pnl <= -self._settings.max_daily_loss:
            self.pause("stop_loss")
            logger.error(
                "🛑 STOP-LOSS atingido! P&L={:+.2f} ≤ -{:.2f}",
                self._daily_pnl, self._settings.max_daily_loss,
            )

    def check(self, stake: float, odd: float) -> SafetyCheck:
        """Verifica se uma aposta deve ser permitida.

        Args:
            stake: Valor da aposta em R$.
            odd: Odd decimal da aposta.

        Returns:
            SafetyCheck com resultado e stake ajustado.
        """
        self._refresh_daily()

        # 1. AutoBet habilitado?
        if not self._settings.enabled:
            return SafetyCheck(
                allowed=False,
                reason=RejectReason.DISABLED,
                detail="AutoBet está desabilitado nas configurações",
            )

        # 2. Pausado por stop-loss ou manualmente?
        if self._paused:
            return SafetyCheck(
                allowed=False,
                reason=RejectReason.STOP_LOSS,
                detail=f"Apostas pausadas: {self._pause_reason}",
            )

        # 3. Stop-loss diário
        daily_loss = self._get_daily_loss()
        if daily_loss >= self._settings.max_daily_loss:
            self.pause("stop_loss")
            return SafetyCheck(
                allowed=False,
                reason=RejectReason.STOP_LOSS,
                detail=f"Perda diária R${daily_loss:.2f} ≥ limite R${self._settings.max_daily_loss:.2f}",
            )

        # 4. Rate limit (apostas/hora)
        hourly = self._get_hourly_count()
        if hourly >= self._settings.max_bets_per_hour:
            return SafetyCheck(
                allowed=False,
                reason=RejectReason.RATE_LIMIT,
                detail=f"{hourly} apostas na última hora ≥ limite {self._settings.max_bets_per_hour}",
            )

        # 5. Odd dentro do range
        if odd < self._settings.odd_min:
            return SafetyCheck(
                allowed=False,
                reason=RejectReason.ODD_TOO_LOW,
                detail=f"Odd {odd:.2f} < mínimo {self._settings.odd_min:.2f}",
            )
        if odd > self._settings.odd_max:
            return SafetyCheck(
                allowed=False,
                reason=RejectReason.ODD_TOO_HIGH,
                detail=f"Odd {odd:.2f} > máximo {self._settings.odd_max:.2f}",
            )

        # 6. Ajustar stake ao máximo permitido
        adjusted = min(stake, self._settings.max_stake)
        if adjusted != stake:
            logger.warning(
                "Safety: stake ajustado {:.2f} → {:.2f} (max_stake={:.2f})",
                stake, adjusted, self._settings.max_stake,
            )

        return SafetyCheck(
            allowed=True,
            reason=RejectReason.OK,
            adjusted_stake=adjusted,
        )

    def calculate_stake(self, units: float = 1.0) -> float:
        """Calcula stake em R$ baseado em unidades (µ).

        Args:
            units: Número de unidades para apostar (default: 1µ).

        Returns:
            Stake em R$, limitado ao max_stake.
        """
        raw = self.units.units_to_brl(units)
        return min(raw, self._settings.max_stake)

    def apply_jitter(self, stake: float, pct: float = 0.05) -> float:
        """Aplica variação aleatória de ±pct na stake (anti-detecção).

        Ex: stake=10.00, pct=0.05 → retorna entre 9.50 e 10.50
        O valor final é arredondado para 2 casas e clampado ao max_stake.

        Args:
            stake: Valor base da stake.
            pct: Percentual de variação (default 5%).

        Returns:
            Stake com jitter aplicado.
        """
        jitter = stake * random.uniform(-pct, pct)
        adjusted = round(stake + jitter, 2)
        adjusted = max(0.50, adjusted)  # mínimo R$0.50
        return min(adjusted, self._settings.max_stake)

    def status_summary(self) -> str:
        """Retorna resumo do estado de segurança para logging/Telegram."""
        self._refresh_daily()
        daily_loss = self._get_daily_loss()
        hourly = self._get_hourly_count()
        return (
            f"💰 P&L dia: R${self._daily_pnl:+.2f}\n"
            f"📊 Perda bruta: R${daily_loss:.2f} / R${self._settings.max_daily_loss:.2f}\n"
            f"⏱️ Apostas/hora: {hourly}/{self._settings.max_bets_per_hour}\n"
            f"💎 1µ = R${self.units.unit_value:.2f}\n"
            f"{'🛑 PAUSADO' if self._paused else '✅ ATIVO'}"
        )

    def _get_daily_loss(self) -> float:
        if self._bet_logger:
            return self._bet_logger.daily_loss()
        return max(0.0, -self._daily_pnl)

    def _get_hourly_count(self) -> int:
        if self._bet_logger:
            return self._bet_logger.hourly_bet_count()
        return 0

    # ─── Bankroll Tracker ────────────────────────────────────────────────

    def update_bankroll(self, profit: float) -> None:
        """Atualiza a banca após resultado de aposta.

        Args:
            profit: Positivo = lucro, negativo = perda.
        """
        old = self.units.bankroll
        self.units.bankroll = round(self.units.bankroll + profit, 2)
        logger.info(
            "Bankroll: R${:.2f} → R${:.2f} ({:+.2f}) | 1µ = R${:.2f}",
            old, self.units.bankroll, profit, self.units.unit_value,
        )

    def bankroll_summary(self) -> str:
        """Retorna resumo da banca para relatórios."""
        b = self.units.bankroll
        u = self.units.unit_value
        t = self.units.total_units
        used = self._daily_pnl
        return (
            f"🏦 Banca: R${b:.2f} ({t}µ × R${u:.2f})\n"
            f"📈 P&L dia: R${used:+.2f}\n"
            f"💵 Banca ajustada: R${b + used:.2f}"
        )
