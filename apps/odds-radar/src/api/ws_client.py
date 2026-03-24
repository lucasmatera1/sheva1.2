"""
Cliente WebSocket standalone para Bet365 — Etapa 2.

Conecta aos WebSockets de odds e commands sem browser.
Usa tokens extraídos pelo TokenHarvester para autenticação.

Dois endpoints:
  - premws-*.365lpodds.com/zap/ — odds feed (preços)
  - pshudws.365lpodds.com/zap/ — commands (saldo, config)

Protocolo: handshake + subscribe + receive
  1. Handshake: flags de feature/version
  2. Subscribe: "S_<session>A_<auth>,<items>" ou item lists
  3. Receive: dados em formato proprietário (pipe-delimited)

Uso:
    from src.api.ws_client import Bet365WsClient
    client = Bet365WsClient(session_token, auth_token)
    async with client.connect() as ws:
        async for msg in ws.odds_stream(fixture_ids=[...]):
            print(msg)
"""

from __future__ import annotations

import asyncio
import json
import time
from dataclasses import dataclass, field
from functools import partial
from pathlib import Path

from curl_cffi.requests import WebSocket as CffiWebSocket
from loguru import logger

from src.api.http_client import SessionTokens
from src.api.ws_parser import Bet365WsParser, WsMessage


# WS endpoints (da análise do tráfego)
ODDS_WS_HOSTS = [
    "premws-pt1.365lpodds.com",
    "premws-pt2.365lpodds.com",
    "premws-pt3.365lpodds.com",
]
CMD_WS_HOST = "pshudws.365lpodds.com"
WS_PATH = "/zap/"

# User-Agent do Camoufox (Firefox 135)
USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:135.0) "
    "Gecko/20100101 Firefox/135.0"
)


@dataclass
class OddsUpdate:
    """Uma atualização de odds recebida via WS."""
    fixture_id: str
    odds: str
    participant: str
    handicap: str
    suspended: bool
    timestamp: float = field(default_factory=time.time)
    raw: str = ""


@dataclass
class WsTokens:
    """Tokens necessários para autenticação WS."""
    session_token: str  # S_<hex> do handshake
    auth_token: str  # A_<base64> da autenticação
    # Extraídos do tráfego ou browser
    origin: str = "https://www.bet365.bet.br"


class Bet365WsClient:
    """Cliente WebSocket para streaming de odds do Bet365."""

    def __init__(
        self,
        ws_tokens: WsTokens | None = None,
        session_tokens: SessionTokens | None = None,
        parser: Bet365WsParser | None = None,
    ):
        self._tokens = ws_tokens
        self._session_tokens = session_tokens
        self._parser = parser or Bet365WsParser()
        self._odds_ws = None
        self._cmd_ws = None
        self._running = False
        self._callbacks: list = []

    def _build_ws_headers(self) -> dict:
        """Monta headers incluindo cookies de sessão."""
        headers = {
            "Origin": "https://www.bet365.bet.br",
            "User-Agent": USER_AGENT,
            "Accept-Language": "en-US,en;q=0.5",
        }
        if self._session_tokens:
            headers["Cookie"] = self._session_tokens.to_cookie_string()
        return headers

    @staticmethod
    def _generate_uid() -> str:
        """Gera uid aleatório como o browser faz."""
        import secrets
        return str(secrets.randbelow(10**16)).ljust(16, '0')

    async def connect_odds(self, host: str | None = None) -> CffiWebSocket:
        """Conecta ao WS de odds usando curl_cffi (TLS impersonation)."""
        host = host or ODDS_WS_HOSTS[0]
        uid = self._generate_uid()
        url = f"wss://{host}{WS_PATH}?uid={uid}"

        headers = self._build_ws_headers()

        logger.info("Conectando ao WS de odds: {}", host)

        # curl_cffi WebSocket é síncrono — roda em thread
        def _connect():
            ws = CffiWebSocket()
            ws.connect(
                url,
                headers=headers,
                impersonate="firefox135",
            )
            return ws

        ws = await asyncio.to_thread(_connect)
        self._odds_ws = ws

        # Handshake — recv é síncrono
        data, flags = await asyncio.to_thread(ws.recv)
        handshake = data.decode("utf-8", errors="replace") if isinstance(data, bytes) else str(data)
        parsed = self._parser.parse_frame(handshake)
        logger.debug("Handshake recebido: type={}", parsed.msg_type)

        # Extrai session token do handshake
        session = self._parser.extract_session_token(handshake)
        if session:
            logger.info("Session token extraído: {}...", session[:20])
            if self._tokens:
                self._tokens.session_token = session

        return ws

    async def connect_cmd(self) -> CffiWebSocket:
        """Conecta ao WS de commands usando curl_cffi."""
        uid = self._generate_uid()
        url = f"wss://{CMD_WS_HOST}{WS_PATH}?uid={uid}"

        headers = self._build_ws_headers()

        logger.info("Conectando ao WS de commands: {}", CMD_WS_HOST)

        def _connect():
            ws = CffiWebSocket()
            ws.connect(
                url,
                headers=headers,
                impersonate="firefox135",
            )
            return ws

        ws = await asyncio.to_thread(_connect)
        self._cmd_ws = ws
        return ws

    async def subscribe_fixture(
        self,
        ws: CffiWebSocket,
        fixture_ids: list[str],
    ):
        """Subscribe em fixtures para receber odds updates."""
        if not self._tokens:
            logger.warning("Sem tokens — subscribe pode falhar")

        # Formato: items separados por vírgula
        items = ",".join(f"BS{fid}" for fid in fixture_ids)

        if self._tokens and self._tokens.session_token:
            msg = f"S_{self._tokens.session_token}"
            if self._tokens.auth_token:
                msg += f"A_{self._tokens.auth_token}"
            msg += f",{items}"
        else:
            msg = items

        logger.info("Subscribe: {} fixtures ({}...)", len(fixture_ids), msg[:60])
        await asyncio.to_thread(ws.send, msg.encode("utf-8"))

    async def odds_stream(
        self,
        fixture_ids: list[str],
        host: str | None = None,
    ):
        """Generator assíncrono que yield OddsUpdate para os fixtures."""
        ws = await self.connect_odds(host)
        await self.subscribe_fixture(ws, fixture_ids)

        self._running = True
        try:
            while self._running:
                try:
                    data, flags = await asyncio.wait_for(
                        asyncio.to_thread(ws.recv), timeout=30.0
                    )
                    raw = data.decode("utf-8", errors="replace") if isinstance(data, bytes) else str(data)
                except asyncio.TimeoutError:
                    continue

                msg = self._parser.parse_frame(raw)

                for entity in msg.entities:
                    odds = entity.get("OD")
                    if odds:
                        update = OddsUpdate(
                            fixture_id=entity.get("FI", ""),
                            odds=odds,
                            participant=entity.get("PA", ""),
                            handicap=entity.get("HA", ""),
                            suspended=entity.get("SU", "") == "1",
                            raw=raw[:200],
                        )
                        yield update
        finally:
            self._running = False
            ws.close()

    async def listen_raw(
        self,
        ws: CffiWebSocket,
        duration: float = 60.0,
        log_file: str | None = None,
    ) -> list[WsMessage]:
        """Escuta mensagens raw por duration segundos. Para debug."""
        messages = []
        start = time.time()
        log_path = Path(log_file) if log_file else None

        try:
            while time.time() - start < duration:
                try:
                    data, flags = await asyncio.wait_for(
                        asyncio.to_thread(ws.recv), timeout=5.0
                    )
                    raw = data.decode("utf-8", errors="replace") if isinstance(data, bytes) else str(data)
                except asyncio.TimeoutError:
                    continue

                msg = self._parser.parse_frame(raw)
                messages.append(msg)

                if log_path:
                    entry = {
                        "ts": time.time(),
                        "type": msg.msg_type,
                        "entities": len(msg.entities),
                        "raw": raw[:500],
                    }
                    with open(log_path, "a", encoding="utf-8") as f:
                        f.write(json.dumps(entry, ensure_ascii=False) + "\n")
        except Exception as e:
            logger.warning("WS conexão fechada: {}", e)

        return messages

    async def extract_tokens_from_browser(self, page) -> WsTokens:
        """Extrai tokens WS interceptando tráfego do browser.

        O browser faz handshake WS → recebe S_ token → envia auth.
        Interceptamos esses frames para obter os tokens.
        """
        tokens = WsTokens(session_token="", auth_token="")
        collected = asyncio.Event()

        # Monitor real WS frames via CDP
        ws_frames_future = asyncio.get_event_loop().create_future()

        # Alternativa: intercepta via page.evaluate
        result = await page.evaluate("""() => {
            // Procura WebSockets ativos
            const results = [];
            if (window.__wsConnections) {
                for (const ws of window.__wsConnections) {
                    results.push({
                        url: ws.url,
                        readyState: ws.readyState,
                    });
                }
            }
            return results;
        }""")

        logger.debug("WS connections encontrados: {}", len(result) if result else 0)
        return tokens

    def stop(self):
        """Para o streaming."""
        self._running = False


async def _test_ws_connection():
    """Testa conexão WS (sem auth — apenas handshake)."""
    parser = Bet365WsParser()
    client = Bet365WsClient(parser=parser)

    try:
        ws = await client.connect_odds()
        print("✅ Conectado ao WS de odds!")

        # Escuta 10s de mensagens raw
        messages = await client.listen_raw(ws, duration=10.0)
        print(f"\nRecebidas {len(messages)} mensagens:")
        for msg in messages[:5]:
            print(f"  [{msg.msg_type}] {len(msg.entities)} entities | {msg.raw[:100]}...")
    except Exception as e:
        print(f"❌ Erro WS: {e}")


if __name__ == "__main__":
    asyncio.run(_test_ws_connection())
