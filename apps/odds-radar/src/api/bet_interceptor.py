"""
BetInterceptor — Intercepta PlaceBet e envia via curl_cffi (API-only).

Estratégia:
  1. O fluxo DOM normal roda (click odd → fill stake → "Fazer Aposta")
  2. Quando o JS do Bet365 dispara o PlaceBet POST, este interceptor:
     a. Extrai fixture_id, selection_id, odds, handicap, market_type do campo `ns`
     b. Captura x-net-sync-term, page_id e salva no harvester
     c. ABORTA a request do browser (que seria detectada como automação DOM)
     d. Envia PlaceBet via curl_cffi com TLS impersonation (Firefox 135)
     e. Retorna a resposta real via route.fulfill() (DOM reflete estado correto)

  curl_cffi impersona o TLS fingerprint do Firefox — sem 403 do Cloudflare,
  sem detecção de automação DOM. Isso é como os SaaS profissionais operam.

Uso:
    interceptor = BetInterceptor(page, token_harvester)
    await interceptor.install()
    # ... fluxo DOM normal de aposta (click odd, fill stake, etc.)
    # O interceptor age automaticamente quando PlaceBet dispara.
    # Resultados ficam em interceptor.last_result
"""

from __future__ import annotations

import asyncio
import json
import time
from dataclasses import dataclass, field
from urllib.parse import parse_qs, unquote

from loguru import logger

from src.api.http_client import BetResult, Bet365HttpClient


@dataclass
class InterceptStats:
    total: int = 0
    http_success: int = 0
    http_geo_blocked: int = 0
    http_error: int = 0
    fallback_dom: int = 0


@dataclass
class InterceptedBet:
    """Dados extraídos de um PlaceBet interceptado."""
    fixture_id: str = ""
    selection_id: str = ""
    odds: str = ""
    handicap: str = ""
    market_type: int = 11
    classification: int = 18
    stake: float = 1.00
    accept_changes: bool = True
    x_net_sync_term: str = ""
    bet_guid: str = ""
    challenge: str = ""
    page_id: str = ""
    raw_ns: str = ""

    @classmethod
    def from_post_data(cls, post_data: str, url: str = "") -> InterceptedBet:
        """Parseia o POST data e query params do PlaceBet."""
        bet = cls()

        # Query params: betGuid, c (challenge), p (page_id)
        if "?" in url:
            qs = parse_qs(url.split("?", 1)[1])
            bet.bet_guid = qs.get("betGuid", [""])[0]
            bet.challenge = qs.get("c", [""])[0]
            bet.page_id = qs.get("p", [""])[0]

        # POST body: ns=...&xb=1&aa=null&...
        if not post_data:
            return bet

        params = parse_qs(post_data, keep_blank_values=True)
        ns_raw = params.get("ns", [""])[0]
        if not ns_raw:
            # Pode estar como &ns=... (prepended &)
            if post_data.startswith("&"):
                params = parse_qs(post_data[1:], keep_blank_values=True)
                ns_raw = params.get("ns", [""])[0]

        bet.raw_ns = ns_raw
        if not ns_raw:
            return bet

        # Parse ns: pt=N#o=4/5#pv=4/5#f=191755961#fp=901719780#...#|at=Y#...#||
        ns = unquote(ns_raw)
        fields = {}
        for section in ns.split("||"):
            for part in section.split("|"):
                for fld in part.split("#"):
                    if "=" in fld:
                        k, v = fld.split("=", 1)
                        if v:
                            fields[k] = v

        bet.fixture_id = fields.get("f", "")
        bet.selection_id = fields.get("fp", "")
        bet.odds = fields.get("o", "")
        bet.handicap = fields.get("ln", "")
        bet.stake = float(fields.get("st", "1.00"))
        bet.accept_changes = fields.get("at", "Y") == "Y"

        mt = fields.get("mt", "11")
        bet.market_type = int(mt) if mt.isdigit() else 11

        c = fields.get("c", "18")
        bet.classification = int(c) if c.isdigit() else 18

        return bet


class BetInterceptor:
    """Intercepta PlaceBet do browser e reenvia via curl_cffi (API-only)."""

    def __init__(self, page, token_harvester=None):
        self._page = page
        self._harvester = token_harvester
        self._installed = False
        self._active = True
        self.stats = InterceptStats()
        self.last_result: BetResult | None = None
        self.last_intercepted: InterceptedBet | None = None
        self._result_event: asyncio.Event = asyncio.Event()
        self._bet_start_time: float = 0.0
        self._http_client: Bet365HttpClient | None = None

    @property
    def active(self) -> bool:
        return self._active

    @active.setter
    def active(self, value: bool):
        self._active = value

    async def install(self):
        """Registra o route handler para PlaceBet (curl_cffi mode)."""
        if self._installed:
            return
        # Route handler: intercepta request, aborta, reenvia via curl_cffi
        await self._page.route("**/BetsWebAPI/placebet**", self._handle_placebet)
        self._installed = True
        logger.info("BetInterceptor instalado — curl_cffi mode (TLS impersonation)")

    async def uninstall(self):
        """Remove o route handler."""
        if not self._installed:
            return
        try:
            await self._page.unroute("**/BetsWebAPI/placebet**", self._handle_placebet)
        except Exception:
            pass
        self._installed = False
        logger.info("BetInterceptor removido")

    async def wait_for_result(self, timeout: float = 30.0) -> BetResult | None:
        """Espera o resultado da próxima aposta interceptada."""
        self._result_event.clear()
        try:
            await asyncio.wait_for(self._result_event.wait(), timeout=timeout)
            return self.last_result
        except asyncio.TimeoutError:
            # Checa se resultado chegou durante o timeout (race condition)
            if self.last_result and self._result_event.is_set():
                return self.last_result
            logger.warning("Timeout {}s esperando resultado do interceptor", timeout)
            return None

    async def _handle_placebet(self, route):
        """Intercepta PlaceBet, aborta request do browser, envia via curl_cffi."""
        self.stats.total += 1
        self._bet_start_time = time.perf_counter()
        self._result_event.clear()

        if not self._active:
            logger.debug("Interceptor inativo — passando request original")
            await route.continue_()
            return

        request = route.request
        url = request.url
        post_data = request.post_data or ""
        headers = dict(request.headers)

        # 1. Extrai params do request original
        bet = InterceptedBet.from_post_data(post_data, url)
        self.last_intercepted = bet

        if not bet.fixture_id or not bet.selection_id:
            logger.warning("PlaceBet interceptado mas sem fixture/selection — passando adiante")
            await route.continue_()
            return

        # 2. Captura x-net-sync-term e page_id dos headers originais → salva no harvester
        sync_term = headers.get("x-net-sync-term", "")
        if sync_term and self._harvester and self._harvester.tokens:
            self._harvester.tokens.x_net_sync_term = sync_term
        if bet.page_id and self._harvester and self._harvester.tokens:
            self._harvester.tokens.page_id = bet.page_id

        logger.info(
            "🎯 PlaceBet INTERCEPTADO → curl_cffi — f={} fp={} o={} s={} ln={} sync={}...",
            bet.fixture_id, bet.selection_id, bet.odds, bet.stake, bet.handicap,
            sync_term[:30] if sync_term else "EMPTY",
        )

        # 3. Verifica se temos tokens válidos
        tokens = self._harvester.tokens if self._harvester else None
        if not tokens or not tokens.pstk:
            logger.error("Sem tokens válidos — fallback para route.continue_()")
            await route.continue_()
            return

        # 4. Envia via curl_cffi (TLS impersonation Firefox 135)
        try:
            async with Bet365HttpClient(tokens) as client:
                result = await client.place_bet(
                    fixture_id=bet.fixture_id,
                    selection_id=bet.selection_id,
                    odds=bet.odds,
                    stake=bet.stake,
                    handicap=bet.handicap,
                    market_type=bet.market_type,
                    classification=bet.classification,
                    accept_changes=bet.accept_changes,
                )
        except Exception as e:
            elapsed = time.perf_counter() - self._bet_start_time
            logger.error("curl_cffi PlaceBet falhou ({:.0f}ms): {}", elapsed * 1000, e)
            self.stats.http_error += 1
            # Fallback: deixa o browser tentar
            await route.continue_()
            return

        elapsed = time.perf_counter() - self._bet_start_time
        self.last_result = result

        # 5. Atualiza tokens encadeados no harvester
        if self._harvester and self._harvester.tokens:
            if result.next_bet_guid:
                self._harvester.tokens.last_bet_guid = result.next_bet_guid
            if result.next_challenge:
                self._harvester.tokens.last_challenge = result.next_challenge

        # 6. Atualiza stats
        if result.success:
            self.stats.http_success += 1
            logger.info(
                "✅ PlaceBet ACEITA via curl_cffi ({:.0f}ms) ref={} ticket={} return={}",
                elapsed * 1000, result.bet_reference,
                result.ticket_id, result.return_value,
            )
        elif result.is_geo_blocked:
            self.stats.http_geo_blocked += 1
            logger.warning(
                "❌ PlaceBet geo_blocked via curl_cffi ({:.0f}ms) — gwt expirou",
                elapsed * 1000,
            )
        else:
            self.stats.http_error += 1
            logger.warning(
                "❌ PlaceBet rejeitada via curl_cffi ({:.0f}ms) cs={} mi={}",
                elapsed * 1000, result.completion_status, result.message_id,
            )

        # 7. Retorna resposta ao browser via fulfill (para que o DOM reflita o estado)
        try:
            if result.completion_status >= 0:
                # Resposta Bet365 real — retorna como JSON para o JS processar
                await route.fulfill(
                    status=200,
                    content_type="application/json",
                    body=json.dumps(result.raw_response),
                )
            else:
                # Erro HTTP (não 200) — aborta para JS mostrar erro genérico
                await route.abort()
        except Exception:
            try:
                await route.abort()
            except Exception:
                pass

        self._result_event.set()

    def print_stats(self):
        s = self.stats
        total = s.total or 1
        print(f"  📊 Interceptor Stats:")
        print(f"     Total: {s.total}")
        print(f"     HTTP OK: {s.http_success} ({s.http_success/total:.0%})")
        print(f"     Geo blocked: {s.http_geo_blocked} ({s.http_geo_blocked/total:.0%})")
        print(f"     HTTP error: {s.http_error}")
        print(f"     Fallback DOM: {s.fallback_dom}")
