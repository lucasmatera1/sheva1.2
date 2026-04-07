"""Orquestrador Auto-Bet — loop principal que conecta sinal → radar → aposta."""

from __future__ import annotations

import asyncio
from datetime import datetime
from pathlib import Path
from typing import TYPE_CHECKING

from config.settings import get_settings
from src.betting import BetPlacer
from src.betting.bet_log import BetLogger
from src.browser.engine import BrowserEngine
from src.browser.login import ensure_logged_in
from src.browser.session import load_cookies, save_cookies
from src.models.odds import BetRecord, BetSignal, BetStatus
from src.scraper.bet365 import Bet365Scraper
from src.signals.listener import SignalListener
from src.telegram.bot import TelegramNotifier
from src.utils.logger import get_logger

if TYPE_CHECKING:
    from playwright.async_api import Page

logger = get_logger("autobet")

SCREENSHOTS_DIR = Path(__file__).resolve().parent.parent.parent / "data" / "screenshots"


class AutoBetOrchestrator:
    """Gerencia o fluxo completo: sinal → scraper → betslip → confirmação."""

    def __init__(self) -> None:
        self.settings = get_settings()
        self.ab = self.settings.autobet

        self.engine = BrowserEngine(self.settings.browser)
        self.scraper = Bet365Scraper(self.engine, self.settings.scraper)
        self.placer = BetPlacer(self.engine)
        self.listener = SignalListener()
        self.notifier = TelegramNotifier(self.settings.telegram)
        self.bet_logger = BetLogger()

        self._running = True
        self._page = None

        SCREENSHOTS_DIR.mkdir(parents=True, exist_ok=True)

    async def start(self) -> None:
        """Inicia o loop de auto-bet."""
        if not self.ab.enabled:
            logger.warning("Auto-bet DESATIVADO (AUTOBET_ENABLED=false)")
            return

        logger.info("═══════════════════════════════════════════")
        logger.info("  Auto-Bet Orquestrador — Mode: {}", self.ab.mode)
        logger.info("  Stake: R${:.2f} | Limites: {}x/hora, R${:.2f}/dia",
                     self.ab.default_stake, self.ab.max_bets_per_hour, self.ab.max_daily_loss)
        logger.info("═══════════════════════════════════════════")

        await self.notifier.send_status(
            f"Auto-Bet iniciado (mode={self.ab.mode}, stake=R${self.ab.default_stake:.2f})"
        )

        while self._running:
            try:
                await self._poll_cycle()
            except Exception as e:
                logger.error("Erro no ciclo de polling: {}", e)

            await asyncio.sleep(self.ab.sheva_poll_interval_sec)

    async def stop(self) -> None:
        self._running = False
        await self.listener.close()
        await self.notifier.close()

    async def _poll_cycle(self) -> None:
        """Um ciclo: busca sinais e processa cada um."""
        async for signal in self.listener.poll_signals():
            logger.info("Sinal recebido: {} vs {} (side={}, method={})",
                         signal.home_player, signal.away_player,
                         signal.side, signal.method_code)

            # Verifica limites
            gate = self._check_gates(signal)
            if gate:
                logger.warning("Gate bloqueou: {}", gate)
                await self.notifier.send_status(f"⛔ Sinal bloqueado: {gate}")
                await self.listener.mark_processed(signal.signal_id, "blocked")
                continue

            await self._process_signal(signal)

    def _check_gates(self, signal: BetSignal) -> str | None:
        """Verifica se pode apostar. Retorna motivo se bloqueado."""
        if self.bet_logger.hourly_bet_count() >= self.ab.max_bets_per_hour:
            return f"Limite de {self.ab.max_bets_per_hour} apostas/hora atingido"

        if self.bet_logger.daily_loss() >= self.ab.max_daily_loss:
            return f"Stop-loss diário de R${self.ab.max_daily_loss:.2f} atingido"

        return None

    async def _process_signal(self, signal: BetSignal) -> None:
        """Processa um sinal: abre browser, encontra odd, pede confirmação, aposta."""
        record = BetRecord(signal=signal, stake=self.ab.default_stake)

        async with self.engine.launch() as context:
            await load_cookies(context)
            page = await self.engine.new_page(context)

            try:
                # 1. Navega até a liga no Bet365
                url = signal.bet365_url or self.settings.scraper.base_url
                await self.scraper._navigate_to(page, url)
                await self.scraper._dismiss_popups(page)

                # 1b. Verifica login (cookies de sessão manual)
                if not await ensure_logged_in(page, context):
                    record.status = BetStatus.ERROR
                    record.error_message = "Não logado — execute: python scripts/manual_login.py"
                    await self._finalize(record, page)
                    return

                # 2. Encontra e clica na odd
                odd_value = await self.placer.find_and_click_odd(page, signal)
                if odd_value is None:
                    record.status = BetStatus.ERROR
                    record.error_message = "Partida/odd não encontrada no Bet365"
                    await self._finalize(record, page)
                    return

                record.odd_found = odd_value

                # 3. Valida odd mínima
                if odd_value < self.ab.odd_min:
                    record.status = BetStatus.CANCELLED
                    record.error_message = f"Odd {odd_value:.2f} < mínima {self.ab.odd_min:.2f}"
                    await self.placer.close_betslip(page)
                    await self._finalize(record, page)
                    return

                if odd_value > self.ab.odd_max:
                    record.status = BetStatus.CANCELLED
                    record.error_message = f"Odd {odd_value:.2f} > máxima {self.ab.odd_max:.2f}"
                    await self.placer.close_betslip(page)
                    await self._finalize(record, page)
                    return

                # 4. Preenche stake
                if not await self.placer.fill_stake(page, self.ab.default_stake):
                    record.status = BetStatus.ERROR
                    record.error_message = "Falha ao preencher stake"
                    await self._finalize(record, page)
                    return

                record.potential_return = odd_value * self.ab.default_stake

                # 5. Confirmação (semi-auto: pede no Telegram)
                if self.ab.mode == "semi":
                    confirmed = await self._ask_confirmation(signal, odd_value)
                    if confirmed != "apostar":
                        record.status = (
                            BetStatus.CANCELLED if confirmed == "cancelar"
                            else BetStatus.TIMEOUT
                        )
                        await self.placer.close_betslip(page)
                        await self._finalize(record, page)
                        return

                record.confirmed_at = datetime.utcnow()
                record.status = BetStatus.CONFIRMED

                # 6. Re-lê odd do betslip (pode ter mudado)
                betslip_odd = await self.placer.get_betslip_odd(page)
                if betslip_odd:
                    record.odd_at_confirm = betslip_odd
                    if betslip_odd < self.ab.odd_min:
                        record.status = BetStatus.REJECTED
                        record.error_message = (
                            f"Odd mudou para {betslip_odd:.2f} (< {self.ab.odd_min:.2f})"
                        )
                        await self.placer.close_betslip(page)
                        await self._finalize(record, page)
                        return

                # 7. Coloca aposta
                place_status = await self.placer.place_bet(page)
                record.status = place_status
                record.placed_at = datetime.utcnow()

                # 8. Screenshot comprovante
                ts = datetime.utcnow().strftime("%Y%m%d_%H%M%S")
                ss_path = str(SCREENSHOTS_DIR / f"bet_{ts}_{signal.signal_id}.png")
                record.screenshot_path = await self.placer.take_screenshot(page, ss_path)

                await save_cookies(context)

            except Exception as e:
                record.status = BetStatus.ERROR
                record.error_message = str(e)
                logger.error("Erro ao processar sinal: {}", e)
            finally:
                await page.close()

        await self._finalize(record)

    async def _ask_confirmation(self, signal: BetSignal, odd: float) -> str:
        """Envia preview no Telegram e espera resposta."""
        await self.notifier.send_bet_preview(signal, odd, self.ab.default_stake)
        response = await self.notifier.wait_for_confirmation(self.ab.confirm_timeout_sec)
        logger.info("Resposta Telegram: {}", response)
        return response

    async def _finalize(self, record: BetRecord, page: "Page | None" = None) -> None:
        """Loga e notifica resultado."""
        self.bet_logger.log_bet(record)
        await self.notifier.send_bet_result(record)
        await self.listener.mark_processed(record.signal.signal_id, record.status.value)
