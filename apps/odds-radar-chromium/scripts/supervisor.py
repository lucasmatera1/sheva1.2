"""Supervisor — watchdog que reinicia o bot em caso de crash.

Uso:
    python scripts/supervisor.py

Monitora o processo bet_telegram.py e reinicia automaticamente
se ele crashar (exit code != 0 ou timeout sem heartbeat).
"""

from __future__ import annotations

import subprocess
import sys
import time
from pathlib import Path

SCRIPT = Path(__file__).resolve().parent / "bet_telegram.py"
PYTHON = sys.executable
MAX_RESTARTS = 10
COOLDOWN_BASE = 5  # seconds, doubles each consecutive failure
MAX_COOLDOWN = 300  # 5 min max


def main() -> None:
    consecutive_failures = 0
    total_restarts = 0

    print("=" * 60)
    print("  🔄 SUPERVISOR — Sheva Bot Watchdog")
    print(f"  Script: {SCRIPT.name}")
    print(f"  Max restarts: {MAX_RESTARTS}")
    print("=" * 60)

    while total_restarts < MAX_RESTARTS:
        start_time = time.time()
        print(f"\n[supervisor] Iniciando bot (restart #{total_restarts})...")

        try:
            proc = subprocess.run(
                [PYTHON, str(SCRIPT)],
                cwd=str(SCRIPT.parent.parent),
            )
            exit_code = proc.returncode
        except KeyboardInterrupt:
            print("\n[supervisor] Ctrl+C — encerrando.")
            return
        except Exception as e:
            print(f"[supervisor] Erro ao rodar script: {e}")
            exit_code = 1

        elapsed = time.time() - start_time

        if exit_code == 0:
            print(f"[supervisor] Bot encerrou normalmente (exit 0) após {elapsed:.0f}s.")
            return

        total_restarts += 1

        # Se rodou por mais de 5min, reseta contador de falhas consecutivas
        if elapsed > 300:
            consecutive_failures = 0
        else:
            consecutive_failures += 1

        cooldown = min(COOLDOWN_BASE * (2 ** consecutive_failures), MAX_COOLDOWN)
        print(
            f"[supervisor] Bot crashou (exit={exit_code}) após {elapsed:.0f}s. "
            f"Restart {total_restarts}/{MAX_RESTARTS} em {cooldown}s..."
        )

        try:
            time.sleep(cooldown)
        except KeyboardInterrupt:
            print("\n[supervisor] Ctrl+C durante cooldown — encerrando.")
            return

    print(f"\n[supervisor] MAX_RESTARTS ({MAX_RESTARTS}) atingido. Encerrando.")


if __name__ == "__main__":
    main()
