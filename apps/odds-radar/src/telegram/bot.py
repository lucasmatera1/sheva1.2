"""Bot Telegram para envio de alertas de odds e confirmação de apostas."""

from __future__ import annotations

import asyncio
from datetime import datetime
from typing import TYPE_CHECKING

import httpx

from config.settings import TelegramSettings, get_settings
from src.models.odds import BetRecord, BetSignal, BetStatus, OddsSnapshot, ScanResult
from src.utils.logger import get_logger

if TYPE_CHECKING:
    pass

logger = get_logger(__name__)


class TelegramNotifier:
    """Envia mensagens formatadas via Telegram Bot API (httpx, sem polling)."""

    API = "https://api.telegram.org/bot{token}/{method}"

    def __init__(self, settings: TelegramSettings | None = None):
        s = settings or get_settings().telegram
        self._token = s.bot_token
        self._chat_id = s.chat_id
        self._client = httpx.AsyncClient(timeout=30)

    # ─── Público ─────────────────────────────────────────────────────────────

    async def send_scan_results(self, result: ScanResult) -> None:
        """Envia resumo de um scan completo."""
        if not result.snapshots:
            logger.info("No odds to report, skipping Telegram")
            return

        # Agrupa por liga
        by_league: dict[str, list[OddsSnapshot]] = {}
        for snap in result.snapshots:
            by_league.setdefault(snap.match.league, []).append(snap)

        for league, snaps in by_league.items():
            msg = self._format_league_block(league, snaps)
            await self._send_message(msg)

    async def send_alert(self, snapshot: OddsSnapshot, reason: str = "") -> None:
        """Envia alerta individual para uma odd relevante."""
        msg = self._format_single_alert(snapshot, reason)
        await self._send_message(msg)

    async def send_status(self, text: str) -> None:
        """Envia mensagem de status livre."""
        await self._send_message(f"🤖 *Radar Status*\n{_escape(text)}")

    async def close(self) -> None:
        await self._client.aclose()

    # ─── Formatação ──────────────────────────────────────────────────────────

    def _format_league_block(
        self, league: str, snaps: list[OddsSnapshot]
    ) -> str:
        lines = [f"🏆 *{_escape(league)}*", ""]
        for snap in snaps:
            m = snap.match
            score = ""
            if m.score_home is not None and m.score_away is not None:
                score = f" \\[{m.score_home}\\-{m.score_away}\\]"
            time_str = f" ⏱ {_escape(m.minute)}" if m.minute else ""

            lines.append(
                f"⚽ *{_escape(m.home)}* vs *{_escape(m.away)}*{score}{time_str}"
            )

            for o in snap.odds:
                arrow = ""
                if o.previous is not None:
                    if o.value > o.previous:
                        arrow = " 📈"
                    elif o.value < o.previous:
                        arrow = " 📉"
                lines.append(f"   {_escape(o.label)}: `{o.value:.2f}`{arrow}")

            if m.url:
                lines.append(f"   🔗 [Abrir]({m.url})")
            lines.append("")

        lines.append(f"_Scan: {datetime.utcnow().strftime('%H:%M:%S')} UTC_")
        return "\n".join(lines)

    def _format_single_alert(
        self, snap: OddsSnapshot, reason: str
    ) -> str:
        m = snap.match
        odds_str = " \\| ".join(
            f"{_escape(o.label)} `{o.value:.2f}`" for o in snap.odds
        )
        header = f"🚨 *ALERTA DE ODD*"
        if reason:
            header += f" — {_escape(reason)}"

        parts = [
            header,
            f"🏆 {_escape(m.league)}",
            f"⚽ *{_escape(m.home)}* vs *{_escape(m.away)}*",
            f"📊 {odds_str}",
        ]
        if m.url:
            parts.append(f"🔗 [Abrir]({m.url})")

        return "\n".join(parts)

    # ─── HTTP ────────────────────────────────────────────────────────────────

    async def _send_message(self, text: str) -> bool:
        if not self._token or not self._chat_id:
            logger.warning("Telegram not configured, skipping message")
            return False

        url = self.API.format(token=self._token, method="sendMessage")
        payload = {
            "chat_id": self._chat_id,
            "text": text,
            "parse_mode": "MarkdownV2",
            "disable_web_page_preview": True,
        }

        try:
            resp = await self._client.post(url, json=payload)
            if resp.status_code == 200:
                logger.debug("Telegram message sent")
                return True
            else:
                logger.warning("Telegram API error {}: {}", resp.status_code, resp.text)
                return False
        except Exception as e:
            logger.error("Failed to send Telegram message: {}", e)
            return False

    # ─── Auto-bet: preview + confirmação ─────────────────────────────────────

    async def send_bet_preview(self, signal: BetSignal, odd: float, stake: float) -> int | None:
        """Envia preview da aposta e retorna message_id para tracking."""
        potential = odd * stake
        side_label = {"home": "🏠 Casa", "away": "✈️ Fora", "draw": "🤝 Empate"}.get(
            signal.side, signal.side
        )

        msg = (
            f"🎯 *APOSTA PRONTA*\n\n"
            f"⚽ *{_escape(signal.home_player)}* vs *{_escape(signal.away_player)}*\n"
            f"🏆 {_escape(signal.league)} \\| {_escape(signal.method_code)}\n\n"
            f"📊 {side_label}: `{odd:.2f}`\n"
            f"💰 Stake: `R${stake:.2f}`\n"
            f"🎰 Retorno: `R${potential:.2f}`\n\n"
            f"Responda /apostar ou /cancelar \\(30s\\)"
        )

        msg_id = await self._send_message_get_id(msg)
        return msg_id

    async def send_bet_result(self, record: BetRecord) -> None:
        """Envia resultado da aposta (aceita, rejeitada, etc)."""
        s = record.signal
        status_map = {
            BetStatus.ACCEPTED: "✅ *APOSTA ACEITA*",
            BetStatus.REJECTED: "❌ *APOSTA REJEITADA*",
            BetStatus.CANCELLED: "🚫 *APOSTA CANCELADA*",
            BetStatus.TIMEOUT: "⏰ *TIMEOUT \\- sem resposta*",
            BetStatus.ERROR: "⚠️ *ERRO NA APOSTA*",
        }
        header = status_map.get(record.status, f"📋 *Status: {record.status.value}*")

        parts = [
            header,
            f"⚽ {_escape(s.home_player)} vs {_escape(s.away_player)}",
            f"📊 Odd: `{record.odd_found:.2f}` \\| Stake: `R${record.stake:.2f}`",
        ]
        if record.status == BetStatus.ACCEPTED:
            parts.append(f"🎰 Retorno potencial: `R${record.potential_return:.2f}`")
        if record.error_message:
            parts.append(f"💬 {_escape(record.error_message)}")

        await self._send_message("\n".join(parts))

    async def wait_for_confirmation(self, timeout_sec: int = 30) -> str:
        """Espera /apostar ou /cancelar via getUpdates polling.

        Returns:
            "apostar", "cancelar", ou "timeout"
        """
        if not self._token:
            return "timeout"

        deadline = asyncio.get_event_loop().time() + timeout_sec
        offset = 0

        while asyncio.get_event_loop().time() < deadline:
            remaining = deadline - asyncio.get_event_loop().time()
            poll_timeout = min(5, max(1, int(remaining)))

            url = self.API.format(token=self._token, method="getUpdates")
            payload = {"offset": offset, "timeout": poll_timeout, "allowed_updates": ["message"]}

            try:
                resp = await self._client.post(url, json=payload, timeout=poll_timeout + 5)
                data = resp.json()

                for update in data.get("result", []):
                    offset = update["update_id"] + 1
                    msg = update.get("message", {})
                    text = msg.get("text", "").strip().lower()
                    chat_id = str(msg.get("chat", {}).get("id", ""))

                    # Só aceita do chat configurado
                    if chat_id != self._chat_id:
                        continue

                    if text in ("/apostar", "apostar"):
                        return "apostar"
                    elif text in ("/cancelar", "cancelar"):
                        return "cancelar"

            except httpx.TimeoutException:
                continue
            except Exception as e:
                logger.warning("Erro no polling Telegram: {}", e)
                await asyncio.sleep(1)

        return "timeout"

    async def _send_message_get_id(self, text: str) -> int | None:
        """Envia mensagem e retorna o message_id."""
        if not self._token or not self._chat_id:
            return None

        url = self.API.format(token=self._token, method="sendMessage")
        payload = {
            "chat_id": self._chat_id,
            "text": text,
            "parse_mode": "MarkdownV2",
            "disable_web_page_preview": True,
        }

        try:
            resp = await self._client.post(url, json=payload)
            if resp.status_code == 200:
                return resp.json().get("result", {}).get("message_id")
        except Exception as e:
            logger.error("Failed to send Telegram message: {}", e)
        return None


def _escape(text: str) -> str:
    """Escapa caracteres especiais do MarkdownV2 do Telegram."""
    special = r"_*[]()~`>#+-=|{}.!"
    result = []
    for ch in str(text):
        if ch in special:
            result.append(f"\\{ch}")
        else:
            result.append(ch)
    return "".join(result)
