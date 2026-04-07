"""Rich CLI Dashboard — logs formatados e dashboard em tempo real.

Usa a lib `rich` para exibir:
  - Tabela de apostas recentes
  - Status do bot (uptime, P&L, win rate)
  - Logs coloridos com Live display
"""

from __future__ import annotations

import time
from datetime import datetime

from rich.console import Console
from rich.layout import Layout
from rich.live import Live
from rich.panel import Panel
from rich.table import Table
from rich.text import Text

from src.utils.logger import get_logger

logger = get_logger(__name__)

console = Console()


class Dashboard:
    """Dashboard rich para o bot — exibe status e apostas recentes."""

    def __init__(self) -> None:
        self._started_at = time.time()
        self._bet_count = 0
        self._win_count = 0
        self._daily_pnl = 0.0
        self._status = "🟡 INICIANDO"
        self._last_signal = ""
        self._last_error = ""
        self._recent_bets: list[dict] = []
        self._groups: list[str] = []

    def set_status(self, status: str) -> None:
        self._status = status

    def set_groups(self, groups: list[str]) -> None:
        self._groups = groups

    def record_bet(self, bet: dict) -> None:
        self._bet_count += 1
        if bet.get("success"):
            self._win_count += 1
        self._daily_pnl += bet.get("profit", 0.0)
        self._recent_bets.insert(0, bet)
        if len(self._recent_bets) > 20:
            self._recent_bets = self._recent_bets[:20]

    def record_signal(self, signal_text: str) -> None:
        self._last_signal = signal_text[:80]

    def record_error(self, error: str) -> None:
        self._last_error = error[:100]

    def print_banner(self, stake: float, safety_summary: str) -> None:
        banner = Table.grid(padding=1)
        banner.add_row(
            Panel.fit(
                "[bold cyan]📡 TELEGRAM LISTENER + AUTO-BET[/]\n"
                f"[green]Stake: R${stake:.2f}[/]\n"
                f"{safety_summary}",
                title="[bold]SHEVA BOT[/]",
                border_style="bright_blue",
            )
        )
        console.print(banner)

    def print_signal(self, teams: str, league: str, market: str, odd: float, stake: float) -> None:
        console.print()
        console.rule("[bold yellow]SINAL RECEBIDO[/]", style="yellow")
        console.print(f"  🏀 [bold]{teams}[/] | 🏆 {league}")
        console.print(f"  📊 {market} | Odd: [bold cyan]{odd}[/] | Stake: [green]R${stake:.2f}[/]")
        console.rule(style="yellow")

    def print_bet_result(self, success: bool, receipt: str = "", odds: str = "",
                         sr: int = -1, error: str = "") -> None:
        if success:
            console.print(
                f"  [bold green]✅ ACEITA![/] receipt=[cyan]{receipt}[/] odd=[cyan]{odds}[/]"
            )
        elif error:
            console.print(f"  [bold red]❌ ERRO:[/] {error} (sr={sr})")
        else:
            console.print(f"  [bold yellow]⚠️ REJEITADA:[/] sr={sr}")

    def print_safety_block(self, reason: str, detail: str) -> None:
        console.print(f"  [bold red]⛔ Safety BLOQUEOU:[/] {reason} — {detail}")

    def print_status_line(self, bet_count: int) -> None:
        uptime_s = time.time() - self._started_at
        h = int(uptime_s // 3600)
        m = int((uptime_s % 3600) // 60)
        win_rate = (self._win_count / self._bet_count * 100) if self._bet_count > 0 else 0
        console.print(
            f"[dim]⏱ {h}h{m:02d}m | "
            f"🎯 {bet_count} apostas ({self._win_count}W {win_rate:.0f}%) | "
            f"💰 P&L: R${self._daily_pnl:+.2f}[/]"
        )

    def build_status_table(self) -> Table:
        uptime_s = time.time() - self._started_at
        h = int(uptime_s // 3600)
        m = int((uptime_s % 3600) // 60)
        win_rate = (self._win_count / self._bet_count * 100) if self._bet_count > 0 else 0

        table = Table(title="Status", show_header=False, border_style="blue")
        table.add_column("key", style="cyan")
        table.add_column("value")
        table.add_row("Status", self._status)
        table.add_row("Uptime", f"{h}h{m:02d}m")
        table.add_row("Apostas", f"{self._bet_count} ({self._win_count}W — {win_rate:.0f}%)")
        table.add_row("P&L dia", f"R${self._daily_pnl:+.2f}")
        table.add_row("Grupos", ", ".join(self._groups) or "—")
        if self._last_signal:
            table.add_row("Último sinal", self._last_signal)
        if self._last_error:
            table.add_row("Último erro", f"[red]{self._last_error}[/]")
        return table

    def build_bets_table(self) -> Table:
        table = Table(title="Apostas Recentes", border_style="green")
        table.add_column("#", style="dim")
        table.add_column("Hora")
        table.add_column("Player")
        table.add_column("Market")
        table.add_column("Odd")
        table.add_column("Stake")
        table.add_column("Status")

        for i, b in enumerate(self._recent_bets[:10], 1):
            status_str = "[green]✅[/]" if b.get("success") else "[red]❌[/]"
            table.add_row(
                str(i),
                b.get("time", ""),
                b.get("player", "?")[:20],
                b.get("market", "?"),
                f"{b.get('odd', 0):.2f}",
                f"R${b.get('stake', 0):.2f}",
                status_str,
            )
        return table
