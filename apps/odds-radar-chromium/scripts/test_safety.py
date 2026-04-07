"""Testes unitários para SafetyGuard e UnitSystem."""

from __future__ import annotations

import os
import sys
from pathlib import Path
from unittest.mock import MagicMock

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

# Configura env ANTES de importar settings
os.environ.setdefault("AUTOBET_ENABLED", "true")
os.environ.setdefault("AUTOBET_MAX_STAKE", "50.00")
os.environ.setdefault("AUTOBET_MAX_DAILY_LOSS", "100.00")
os.environ.setdefault("AUTOBET_MAX_BETS_PER_HOUR", "5")
os.environ.setdefault("AUTOBET_ODD_MIN", "1.30")
os.environ.setdefault("AUTOBET_ODD_MAX", "5.00")

from src.betting.safety import SafetyGuard, UnitSystem, RejectReason


def test_unit_system():
    """Testa conversão µ ↔ R$."""
    u = UnitSystem(bankroll=1000.0, total_units=100)
    assert u.unit_value == 10.0
    assert u.units_to_brl(1) == 10.0
    assert u.units_to_brl(2.5) == 25.0
    assert u.brl_to_units(50.0) == 5.0

    # Edge case: zero units
    u2 = UnitSystem(bankroll=1000.0, total_units=0)
    assert u2.unit_value == 0.0
    assert u2.units_to_brl(1) == 0.0
    assert u2.brl_to_units(50.0) == 0.0
    print("  ✅ UnitSystem: 7 assertions OK")


def test_safety_check_ok():
    """Verifica aposta normal permitida."""
    guard = SafetyGuard()
    check = guard.check(stake=10.0, odd=1.80)
    assert check.allowed is True
    assert check.reason == RejectReason.OK
    assert check.adjusted_stake == 10.0
    print("  ✅ Safety check OK: 3 assertions OK")


def test_safety_max_stake():
    """Stake acima do max é ajustado para baixo."""
    guard = SafetyGuard()
    check = guard.check(stake=100.0, odd=2.00)  # max_stake=50
    assert check.allowed is True
    assert check.adjusted_stake == 50.0
    print("  ✅ Safety max_stake: 2 assertions OK")


def test_safety_odd_range():
    """Odds fora do range bloqueiam a aposta."""
    guard = SafetyGuard()

    # Odd muito baixa
    check = guard.check(stake=10.0, odd=1.10)
    assert check.allowed is False
    assert check.reason == RejectReason.ODD_TOO_LOW

    # Odd muito alta
    check = guard.check(stake=10.0, odd=6.50)
    assert check.allowed is False
    assert check.reason == RejectReason.ODD_TOO_HIGH

    # Odd no limite (deve passar)
    check = guard.check(stake=10.0, odd=1.30)
    assert check.allowed is True
    check = guard.check(stake=10.0, odd=5.00)
    assert check.allowed is True
    print("  ✅ Safety odd_range: 6 assertions OK")


def test_safety_stop_loss():
    """Stop-loss bloqueia após perda diária exceder limite."""
    guard = SafetyGuard()

    # Registra perdas até atingir stop-loss
    guard.record_result(-60.0)  # P&L: -60
    check = guard.check(stake=10.0, odd=2.00)
    assert check.allowed is True  # Ainda não atingiu -100

    guard.record_result(-50.0)  # P&L: -110 (passou do limit de 100)
    check = guard.check(stake=10.0, odd=2.00)
    assert check.allowed is False
    assert check.reason == RejectReason.STOP_LOSS
    assert guard.is_paused is True
    print("  ✅ Safety stop_loss: 4 assertions OK")


def test_safety_pause_resume():
    """Pausa manual bloqueia e resume libera."""
    guard = SafetyGuard()

    check = guard.check(stake=10.0, odd=2.00)
    assert check.allowed is True

    guard.pause("teste_manual")
    check = guard.check(stake=10.0, odd=2.00)
    assert check.allowed is False
    assert check.reason == RejectReason.STOP_LOSS

    guard.resume()
    check = guard.check(stake=10.0, odd=2.00)
    assert check.allowed is True
    print("  ✅ Safety pause/resume: 5 assertions OK")


def test_safety_rate_limit():
    """Rate limit com BetLogger mockado."""
    mock_logger = MagicMock()
    mock_logger.daily_loss.return_value = 0.0
    mock_logger.hourly_bet_count.return_value = 10  # Acima do limite de 5

    guard = SafetyGuard(bet_logger=mock_logger)
    check = guard.check(stake=10.0, odd=2.00)
    assert check.allowed is False
    assert check.reason == RejectReason.RATE_LIMIT
    print("  ✅ Safety rate_limit: 2 assertions OK")


def test_safety_disabled():
    """AutoBet desabilitado bloqueia tudo."""
    # Salva e modifica env
    old = os.environ.get("AUTOBET_ENABLED", "")
    os.environ["AUTOBET_ENABLED"] = "false"

    # Recria settings
    import config.settings as cfg_mod
    cfg_mod._settings = None

    guard = SafetyGuard()
    check = guard.check(stake=10.0, odd=2.00)
    assert check.allowed is False
    assert check.reason == RejectReason.DISABLED

    # Restaura
    os.environ["AUTOBET_ENABLED"] = old or "true"
    cfg_mod._settings = None
    print("  ✅ Safety disabled: 2 assertions OK")


def test_calculate_stake():
    """Calcula stake via unidades."""
    u = UnitSystem(bankroll=500.0, total_units=100)  # 1µ = R$5
    guard = SafetyGuard(unit_system=u)

    assert guard.calculate_stake(1.0) == 5.0   # 1µ = R$5
    assert guard.calculate_stake(2.0) == 10.0  # 2µ = R$10
    assert guard.calculate_stake(20.0) == 50.0  # 20µ = R$100 → capped at max_stake=50
    print("  ✅ calculate_stake: 3 assertions OK")


def test_status_summary():
    """status_summary retorna string formatada."""
    guard = SafetyGuard()
    summary = guard.status_summary()
    assert "P&L" in summary
    assert "ATIVO" in summary
    print("  ✅ status_summary: 2 assertions OK")


if __name__ == "__main__":
    print("=" * 60)
    print("  🧪 Test Safety Guard")
    print("=" * 60)
    test_unit_system()
    test_safety_check_ok()
    test_safety_max_stake()
    test_safety_odd_range()
    test_safety_stop_loss()
    test_safety_pause_resume()
    test_safety_rate_limit()
    test_safety_disabled()
    test_calculate_stake()
    test_status_summary()
    print("\n✅ Todos os testes passaram! (36 assertions)")
