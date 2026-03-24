"""
Bot Híbrido — Browser para WS + curl_cffi para PlaceBet.

Fluxo:
  1. Abre Camoufox — usuário faz login manual
  2. Navega ao In-Play eSports — browser conecta aos WS nativamente
  3. Intercepta frames WS via page.on("websocket") → alimenta FixtureMap
  4. Escuta sinais do Telegram (mesmos grupos do bot original)
  5. Resolve player_name → fixture_id + selection_id via FixtureMap
  6. Envia PlaceBet via curl_cffi (TLS impersonation Firefox 135)

WS via browser real (Cloudflare OK). Bet via curl_cffi (TLS OK).

Uso:
    python scripts/bot_api.py
"""

from __future__ import annotations

import asyncio
import json
import os
import random
import re
import sys
import time
from dataclasses import dataclass, field
from pathlib import Path

# Fix encoding para Windows (emojis no print)
if sys.platform == "win32":
    os.environ.setdefault("PYTHONIOENCODING", "utf-8")
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    if hasattr(sys.stderr, "reconfigure"):
        sys.stderr.reconfigure(encoding="utf-8", errors="replace")

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from curl_cffi.requests import AsyncSession
from loguru import logger
from telethon import TelegramClient, events

from config.settings import get_settings
from src.api.http_client import Bet365HttpClient, SessionTokens
from src.api.token_harvester import TokenHarvester, TOKEN_FILE
from src.api.ws_parser import Bet365WsParser
from src.betting.safety import SafetyGuard
from src.betting.ui_placer import UIBetPlacer, UIBetResult
from src.browser.engine import BrowserEngine
from src.browser.session import save_cookies

# ─── Log para arquivo ────────────────────────────────────────────────────────
_LOG_DIR = Path(__file__).resolve().parent.parent / "logs"
_LOG_DIR.mkdir(exist_ok=True)
logger.add(_LOG_DIR / "bot_api.log", rotation="5 MB", encoding="utf-8", level="DEBUG")

# ─── Config ──────────────────────────────────────────────────────────────────

ROOT = Path(__file__).resolve().parent.parent
CONFIG_FILE = ROOT / ".telegram_config.json"
SESSION_FILE = ROOT / ".tg_bot"
STAKE = 1.00
MAX_ODD_DROP = 0.15   # Queda máxima da odd (1.83 aceita até 1.68)

# Content API para buscar fixtures ao vivo
INPLAY_ESPORTS_URL = (
    "https://www.bet365.bet.br"
    "/SportsBook.API/web"
    "?lid=33&zid=0&pd=%23AC%23B18%23C1%23D18%23F2%23"
    "&cid=18&ctid=18&cpn=OVInPlay"
)


@dataclass
class Selection:
    """Uma seleção encontrada no mapa do WS."""
    fixture_id: str
    selection_id: str
    name: str  # Player name (ex: "STING")
    odds: str  # Fracionária (ex: "5/6")
    odds_decimal: float  # Decimal (ex: 1.83)
    handicap: str  # ex: "+5.5"
    market_type: int = 11  # 11 = Asian HC
    suspended: bool = False
    last_update: float = field(default_factory=time.time)


class FixtureMap:
    """Mapa de fixtures ao vivo — player_name → Selection.

    Alimentado pelo WebSocket de odds.
    Resolve sinais do Telegram para fixture_id + selection_id.
    """

    def __init__(self):
        self._map: dict[str, list[Selection]] = {}  # key = PLAYER_NAME upper
        self._by_fixture: dict[str, dict[str, Selection]] = {}  # fixture_id → {selection_id → Selection}
        self._lock = asyncio.Lock()

    @staticmethod
    def _frac_to_decimal(frac: str) -> float:
        """Converte odds fracionárias para decimal. Ex: '5/6' → 1.833"""
        if "/" in frac:
            try:
                num, den = frac.split("/", 1)
                return 1 + int(num) / int(den)
            except (ValueError, ZeroDivisionError):
                return 0.0
        try:
            return float(frac)
        except ValueError:
            return 0.0

    async def enrich_names(self, fixture_id: str, name: str):
        """Enriquece selections sem nome usando dados do Content API."""
        if not name:
            return
        async with self._lock:
            sels = self._by_fixture.get(fixture_id, {})
            for sel in sels.values():
                if not sel.name and name:
                    sel.name = name.upper().strip()
                    # Adiciona ao índice por nome
                    key = sel.name
                    if key not in self._map:
                        self._map[key] = []
                    if sel not in self._map[key]:
                        self._map[key].append(sel)

    async def update(self, fixture_id: str, selection_id: str, name: str,
                     odds: str, handicap: str, suspended: bool = False):
        """Atualiza uma entrada no mapa."""
        async with self._lock:
            sel = Selection(
                fixture_id=fixture_id,
                selection_id=selection_id,
                name=name.upper().strip(),
                odds=odds,
                odds_decimal=self._frac_to_decimal(odds),
                handicap=handicap,
                suspended=suspended,
                last_update=time.time(),
            )

            # Index by player name (se tiver nome)
            key = sel.name
            if key:
                if key not in self._map:
                    self._map[key] = []

                found = False
                for i, existing in enumerate(self._map[key]):
                    if existing.fixture_id == fixture_id and existing.selection_id == selection_id:
                        self._map[key][i] = sel
                        found = True
                        break
                if not found:
                    self._map[key].append(sel)
            else:
                # Sem nome — tenta herdar de uma entrada anterior no mesmo fixture
                existing_sels = self._by_fixture.get(fixture_id, {})
                if selection_id in existing_sels:
                    old = existing_sels[selection_id]
                    if old.name:
                        sel = Selection(
                            fixture_id=fixture_id,
                            selection_id=selection_id,
                            name=old.name,
                            odds=odds,
                            odds_decimal=sel.odds_decimal,
                            handicap=handicap,
                            suspended=suspended,
                            last_update=time.time(),
                        )
                        # Atualiza no índice por nome
                        for i, ex in enumerate(self._map.get(old.name, [])):
                            if ex.fixture_id == fixture_id and ex.selection_id == selection_id:
                                self._map[old.name][i] = sel
                                break

            # Index by fixture (sempre)
            if fixture_id not in self._by_fixture:
                self._by_fixture[fixture_id] = {}
            self._by_fixture[fixture_id][selection_id] = sel

    async def resolve(self, player_name: str, handicap_line: float,
                      target_odd: float | None = None) -> Selection | None:
        """Resolve um sinal para a melhor seleção.

        Args:
            player_name: Nome do jogador (ex: "STING")
            handicap_line: Linha do handicap (ex: 5.5)
            target_odd: Odd alvo do sinal (ex: 1.83) — para validação
        """
        async with self._lock:
            key = player_name.upper().strip()
            candidates = self._map.get(key, [])

            if not candidates:
                # Tenta match parcial
                for k, sels in self._map.items():
                    if key in k or k in key:
                        candidates.extend(sels)

            if not candidates:
                return None

            # Filtra por linha do handicap (formato "+5.5" ou "-5.5")
            best = None
            best_score = float("inf")

            for sel in candidates:
                if sel.suspended:
                    continue

                # Compara handicap
                try:
                    sel_line = float(sel.handicap.replace("+", ""))
                except ValueError:
                    continue

                line_diff = abs(sel_line - handicap_line)
                if line_diff > 2.0:  # Muito diferente, pula
                    continue

                # Score: menor diferença de linha + odd
                score = line_diff * 10
                if target_odd and sel.odds_decimal > 0:
                    odd_diff = abs(sel.odds_decimal - target_odd)
                    score += odd_diff

                if score < best_score:
                    best_score = score
                    best = sel

            return best

    @property
    def stats(self) -> str:
        n_players = len(self._map)
        n_fixtures = len(self._by_fixture)
        n_selections = sum(len(sels) for sels in self._map.values())
        return f"{n_players} players, {n_fixtures} fixtures, {n_selections} selections"


# ─── Signal Parser (reutilizado do bet_telegram.py) ─────────────────────────

def parse_signal(text: str) -> dict | None:
    """Parse de sinal do Telegram — formato HC e Under/Over."""
    if not text:
        return None

    normalized = text.replace("\r\n", "\n").replace("\r", "\n")
    lines = [line.strip() for line in normalized.split("\n") if line.strip()]
    if not lines:
        return None

    selection_line = ""
    matchup_line = ""
    ou_market = None

    for line in lines:
        cleaned = re.sub(r"^[^\w(+-]+", "", line).strip()

        ou_match = re.match(
            r"(?:[📉📈]\s*)?(?P<side>UNDER|OVER)\s+(?P<line>\d+(?:[.,]\d+)?)\s*@\s*(?P<odd>\d+[.,]\d+)",
            cleaned, re.IGNORECASE,
        )
        if ou_match and not ou_market:
            ou_market = ou_match.group("side").lower()
            selection_line = cleaned
            continue

        if "@" in cleaned and not selection_line:
            selection_line = cleaned
            continue
        if re.search(r"\b(?:vs|x|v)\b", cleaned, re.IGNORECASE) and not matchup_line:
            matchup_line = cleaned
            continue

    if not selection_line or not matchup_line:
        return None

    # Over/Under
    if ou_market:
        ou_match = re.match(
            r"(?:[📉📈]\s*)?(?P<side>UNDER|OVER)\s+(?P<line>\d+(?:[.,]\d+)?)\s*@\s*(?P<odd>\d+[.,]\d+)",
            selection_line, re.IGNORECASE,
        )
        if not ou_match:
            return None
        return {
            "market": ou_market,
            "line": float(ou_match.group("line").replace(",", ".")),
            "odd": float(ou_match.group("odd").replace(",", ".")),
            "hc_team": None,
            "teams": matchup_line,
        }

    # HC
    sel_match = re.match(
        r"(?:HC\s+)?(?P<team>.+?)\s+(?P<line>[+-]?\d+(?:[.,]\d+)?)\s*@\s*(?P<odd>\d+[.,]\d+)\s*$",
        selection_line, re.IGNORECASE,
    )
    if not sel_match:
        return None

    return {
        "market": "hc",
        "line": float(sel_match.group("line").replace(",", ".")),
        "odd": float(sel_match.group("odd").replace(",", ".")),
        "hc_team": sel_match.group("team").strip(),
        "teams": matchup_line,
    }


# ─── Content API — Buscar fixtures eSports ao vivo ──────────────────────────

async def fetch_inplay_fixtures(tokens: SessionTokens) -> list[dict]:
    """Busca fixtures eSports ao vivo via SportsBook content API.

    Retorna lista de dicts com fixture_id, home, away, league.
    Usa curl_cffi para manter TLS fingerprint consistente.
    """
    fixtures = []
    try:
        async with AsyncSession(impersonate="firefox135", timeout=15) as s:
            resp = await s.get(
                INPLAY_ESPORTS_URL,
                headers={
                    "referer": "https://www.bet365.bet.br/",
                    "accept": "application/json, text/plain, */*",
                },
                cookies=tokens.to_cookie_dict(),
            )
            if resp.status_code != 200:
                logger.warning("Content API HTTP {}", resp.status_code)
                return fixtures

            body = resp.text
            # Parse formato proprietário Bet365 — cada fixture tem FI=, T1=, T2=
            for m in re.finditer(
                r'\|(?:EV|MA|PA);[^|]*?FI=(\d+);[^|]*?(?:NA=([^;|]+))?',
                body,
            ):
                fid = m.group(1)
                name = m.group(2) or ""
                fixtures.append({"fixture_id": fid, "name": name})

            # Também tenta formato JSON se a API retornar JSON
            if not fixtures and body.strip().startswith("{"):
                try:
                    data = resp.json()
                    for event in data.get("events", []):
                        fixtures.append({
                            "fixture_id": str(event.get("FI", "")),
                            "name": event.get("NA", ""),
                        })
                except Exception:
                    pass

    except Exception as e:
        logger.error("Content API error: {}", e)

    logger.info("Content API: {} fixtures eSports ao vivo", len(fixtures))
    return fixtures


# ─── Browser WS Feed ─────────────────────────────────────────────────────────

def setup_ws_listeners(page, fixture_map: FixtureMap, parser: Bet365WsParser):
    """Registra listeners nos WebSockets que o browser abre naturalmente.

    O browser, ao navegar para In-Play eSports, conecta ao WS de odds
    automaticamente. Interceptamos os frames para alimentar o FixtureMap.
    """
    ws_count = 0

    def on_websocket(ws):
        nonlocal ws_count
        ws_count += 1
        url = ws.url
        is_odds = "365lpodds.com" in url
        logger.info("WS #{} aberto: {} (odds={})", ws_count, url[:80], is_odds)

        if not is_odds:
            return

        def on_frame_received(payload):
            """Chamado para cada frame recebido do WS de odds."""
            raw = payload if isinstance(payload, str) else payload.decode("utf-8", errors="replace")

            updates = parser.parse_odds_update(raw)
            for u in updates:
                name = u.get("name", "")
                fid = u.get("fixture_id", "")
                sid = u.get("selection_id", "")
                odds = u.get("odds", "")
                hc = u.get("handicap", "")
                suspended = u.get("suspended", False)

                if fid and sid and odds:
                    # Usa sync API do FixtureMap (os listeners rodam no event loop do Playwright)
                    asyncio.get_event_loop().create_task(
                        fixture_map.update(fid, sid, name, odds, hc, suspended)
                    )

        ws.on("framereceived", on_frame_received)
        ws.on("close", lambda: logger.info("WS #{} fechado: {}", ws_count, url[:60]))

    page.on("websocket", on_websocket)
    return lambda: ws_count


# ─── Main Bot ────────────────────────────────────────────────────────────────

def load_config() -> dict:
    if not CONFIG_FILE.exists():
        return {}
    return json.loads(CONFIG_FILE.read_text(encoding="utf-8"))


BET365_URL = "https://www.bet365.bet.br/"
INPLAY_ESPORTS_URL_PATH = "#/IP/B18"  # In-Play → eSports


async def _wait_enter(prompt: str = "  >>> Pressione ENTER: ") -> None:
    loop = asyncio.get_running_loop()
    await loop.run_in_executor(None, lambda: input(prompt))


async def auto_login(page, context) -> bool:
    """Login humanizado automático usando credenciais do .env.

    Retorna True se login foi detectado via pstk cookie.
    """
    bet_user = os.environ.get("BET365_USER", "")
    bet_pass = os.environ.get("BET365_PASS", "")
    if not bet_user or not bet_pass:
        logger.warning("BET365_USER/BET365_PASS não definidos no .env")
        return False

    # Fecha popup de cookies
    try:
        cookie_btn = await page.query_selector("#onetrust-accept-btn-handler")
        if cookie_btn:
            await cookie_btn.click()
            await asyncio.sleep(1)
    except Exception:
        pass

    # Verifica se já está logado via DOM (não confiar em cookies salvos — podem ser stale)
    login_visible = await page.evaluate("""() => {
        const btns = [...document.querySelectorAll('button')];
        return btns.some(b => b.textContent.trim() === 'Login');
    }""")
    if not login_visible:
        logger.info("Já logado (botão Login não visível no DOM)")
        return True

    # Clica botão Login via mouse humanizado
    login_bbox = await page.evaluate("""() => {
        const btns = [...document.querySelectorAll('button')];
        const loginBtn = btns.find(b => b.textContent.trim() === 'Login');
        if (loginBtn) {
            const r = loginBtn.getBoundingClientRect();
            if (r.width > 0) return { x: r.x, y: r.y, w: r.width, h: r.height };
        }
        return null;
    }""")
    if login_bbox:
        lx = login_bbox["x"] + random.uniform(5, max(6, login_bbox["w"] - 5))
        ly = login_bbox["y"] + random.uniform(3, max(4, login_bbox["h"] - 3))
        await page.mouse.click(lx, ly)
        logger.info("Botão Login clicado via mouse")
    else:
        logger.warning("Botão Login não encontrado no DOM")
        return False

    # Espera DOM estabilizar
    try:
        await page.wait_for_load_state("domcontentloaded", timeout=10_000)
    except Exception:
        pass
    await asyncio.sleep(2)

    # Espera campo de login aparecer (até 15s)
    try:
        await page.wait_for_selector(
            'input[type="text"], input[name="username"], input[autocomplete="username"]',
            timeout=15_000,
            state="visible",
        )
    except Exception:
        logger.warning("Campo de login não apareceu em 15s")

    # Preenche user/pass via locator.fill() — imune a interferência de mouse/foco
    user_input = page.locator('input[type="text"]').first
    pass_input = page.locator('input[type="password"]').first
    await user_input.fill(bet_user)
    logger.info("Usuário preenchido: {}***", bet_user[:5])
    await asyncio.sleep(0.3)
    await pass_input.fill(bet_pass)
    logger.info("Senha preenchida ({} chars)", len(bet_pass))
    await asyncio.sleep(0.3)

    # Submit via Enter
    await page.keyboard.press("Enter")
    logger.info("Enter pressionado — aguardando login...")
    await asyncio.sleep(8)

    # Verifica login (pstk cookie)
    for attempt in range(3):
        ck = await context.cookies("https://www.bet365.bet.br")
        if any(c["name"] == "pstk" for c in ck):
            logger.info("Login automático SUCESSO!")
            return True
        await asyncio.sleep(3)

    logger.warning("Login automático: pstk não apareceu após 3 tentativas")
    return False


async def main():
    print()
    print("=" * 60)
    print("  🎯 SHEVA — Bot Híbrido (Browser WS + curl_cffi Bet)")
    print("=" * 60)
    print()

    settings = get_settings()
    engine = BrowserEngine(settings.browser)
    parser = Bet365WsParser()
    fixture_map = FixtureMap()
    safety = SafetyGuard()
    bet_count = 0
    processed = {}

    # 1. Abre browser — login manual
    print("  1. Abrindo browser para login...")
    print()

    async with engine.launch() as context:
        page = await engine.new_page(context)
        page.set_default_timeout(30_000)

        await page.goto(BET365_URL, wait_until="domcontentloaded", timeout=30000)
        await asyncio.sleep(3)

        # TokenHarvester — mantém tokens frescos (gwt, sync_term, etc.)
        harvester = TokenHarvester(refresh_interval=120)

        # Captura sync_term passivamente (antes do harvester ter estado)
        sync_term = ""
        def _on_request(request):
            nonlocal sync_term
            if "bet365" in request.url:
                term = request.headers.get("x-net-sync-term", "")
                if term and len(term) > 50 and not sync_term:
                    sync_term = term
                    logger.info("sync_term capturado ({} chars)", len(term))
        page.on("request", _on_request)

        # Registra WS listeners ANTES da navegação para pegar todos os WS
        get_ws_count = setup_ws_listeners(page, fixture_map, parser)

        # Login humanizado automático
        print("  [*] Iniciando login automático...")
        logged = await auto_login(page, context)
        if not logged:
            print("  ⚠️ Login automático falhou — esperando login manual (5 min)...")
            for i in range(300):
                if sync_term:
                    break
                if i > 0 and i % 5 == 0:
                    try:
                        ck = await context.cookies("https://www.bet365.bet.br")
                        ck_dict = {c["name"]: c["value"] for c in ck}
                        if ck_dict.get("pstk"):
                            logger.info("pstk detectado via cookie!")
                            break
                    except Exception:
                        pass
                await asyncio.sleep(1)
            else:
                print("  ⚠️ Timeout — prosseguindo mesmo assim...")
        else:
            print("  ✅ Login automático OK!")

        print(f"  ✅ sync_term={'✅' if sync_term else '❌'}")
        await asyncio.sleep(2)

        # 2. Captura tokens via TokenHarvester
        print()
        print("  [*] Capturando tokens...")
        await save_cookies(context)
        tokens = await harvester.extract_from_page(page)

        if not tokens.pstk:
            print("  ❌ Sem pstk — login falhou!")
            return

        # Injeta sync_term capturado passivamente (se harvester não pegou)
        if sync_term and not tokens.x_net_sync_term:
            tokens.x_net_sync_term = sync_term

        # Ativa sync_term listener passivo (atualiza sync_term continuamente)
        harvester.start_sync_term_listener(page)

        print(f"  ✅ Tokens: pstk={tokens.pstk[:20]}... gwt={'✅' if tokens.gwt else '⏳'} sync={'✅' if tokens.x_net_sync_term else '❌'}")
        print(f"  🌐 WebSockets capturados: {get_ws_count()}")
        print()

        # 3. Navega para In-Play eSports via hash (SPA — não recarrega a página)
        # IMPORTANTE: navegar ANTES de esperar gwt — GeoComply tipicamente
        # só dispara validação geo ao acessar páginas de apostas ao vivo
        print("  [*] Navegando para In-Play eSports...")
        try:
            current_url = page.url
            if "IP" not in current_url or "B18" not in current_url:
                # Usa hash navigation para não perder WS do SPA
                await page.evaluate("window.location.hash = '#/IP/B18'")
                await asyncio.sleep(5)
            else:
                print("  [*] Já está em In-Play eSports")
        except Exception as e:
            logger.warning("Navegação hash falhou: {} — tentando goto", e)
            try:
                await page.goto(BET365_URL + INPLAY_ESPORTS_URL_PATH,
                              wait_until="domcontentloaded", timeout=20000)
                await asyncio.sleep(5)
            except Exception:
                pass

        # Fase 2: espera WS conectar (máx 60s) — WS só conecta em In-Play
        print("  [*] Esperando WebSockets conectarem (máx 60s)...")
        for _ in range(60):
            if get_ws_count() >= 1:
                break
            await asyncio.sleep(1)

        print(f"  🌐 WebSockets: {get_ws_count()}")
        if get_ws_count() < 1:
            print("  ⚠️ Nenhum WS — fixture map ficará vazio")

        # 4. Espera gwt APÓS navegação (GeoComply dispara em In-Play)
        tokens = await harvester.extract_from_page(page)
        if not tokens.gwt:
            print("  ⏳ Esperando GeoComply gerar gwt (máx 120s)...")
            for i in range(120):
                await asyncio.sleep(1)
                ck = await context.cookies()  # ALL domains
                ck_dict = {c["name"]: c["value"] for c in ck}
                if ck_dict.get("gwt"):
                    tokens = await harvester.extract_from_page(page)
                    logger.info("gwt detectado após {}s", i + 1)
                    print(f"  ✅ gwt detectado após {i + 1}s")
                    break
                if (i + 1) % 30 == 0:
                    names = sorted(ck_dict.keys())
                    logger.debug("gwt check {}s — cookies: {}", i + 1, ", ".join(names[:20]))
            else:
                print("  ⚠️ gwt não apareceu — apostas serão geo_blocked")

        print(f"  ✅ gwt={'✅' if tokens.gwt else '❌'} swt={'✅' if tokens.swt else '❌'}")

        # Inicia auto-refresh de tokens (gwt rotaciona a cada ~10-15 bets)
        await harvester.start_auto_refresh(page, interval=120)
        print("  🔄 Token auto-refresh ativado (120s)")
        print()

        # 4. Conecta ao Telegram
        cfg = load_config()
        if not cfg.get("api_id"):
            print("  ❌ Telegram não configurado!")
            print("     Execute: python scripts/bet_telegram.py (wizard)")
            return

        tg_client = TelegramClient(str(SESSION_FILE), cfg["api_id"], cfg["api_hash"])
        await tg_client.start()
        me = await tg_client.get_me()
        print(f"  📱 Telegram: {me.first_name} ({me.phone})")

        group_ids = cfg.get("group_ids") or []
        if not group_ids:
            single = cfg.get("group") or cfg.get("group_id")
            if single:
                group_ids = [single]

        entities = []
        for gid in group_ids:
            try:
                ent = await tg_client.get_entity(gid if isinstance(gid, int) else gid)
                name = getattr(ent, "title", str(gid))
                entities.append(ent)
                print(f"  👥 Grupo: {name}")
            except Exception as e:
                print(f"  ⚠️ Grupo {gid}: {e}")

        if not entities:
            print("  ❌ Nenhum grupo válido!")
            await tg_client.disconnect()
            return

        # 5. Espera WS popular o mapa
        print()
        print("  ⏳ Esperando WS popular o fixture map (10s)...")
        await asyncio.sleep(10)

        print(f"  🏀 Fixture map: {fixture_map.stats}")
        if fixture_map.stats.startswith("0 "):
            print("     ⚠️ Mapa vazio — navegue no In-Play para triggerar WS")
        print(f"  💰 Stake: R${STAKE:.2f}")
        print(f"  {safety.status_summary()}")
        print()
        print("  🟢 ATIVO — Esperando sinais do Telegram...")
        print("  (Browser deve ficar aberto para manter WS ativo)")
        print()

        # Task de log periódico
        async def periodic_stats():
            while True:
                await asyncio.sleep(120)
                logger.info("Fixture map: {} | WS count: {}", fixture_map.stats, get_ws_count())

        stats_task = asyncio.create_task(periodic_stats())

        # 6. Handler de sinais
        @tg_client.on(events.NewMessage(chats=entities, incoming=True, outgoing=True))
        async def on_signal(event):
            nonlocal bet_count

            raw = event.message.text or ""
            msg_id = event.message.id

            # Log de TODA mensagem recebida (debug)
            chat = getattr(event.chat, 'title', '?')
            preview = raw[:120].replace('\n', ' | ')
            logger.info("📩 MSG de '{}': {}", chat, preview)

            # Skip se já processou
            if msg_id in processed:
                logger.debug("Skip: msg {} já processada", msg_id)
                return
            processed[msg_id] = True

            # Filtra futebol
            if "⚽" in raw or "esoccer" in raw.lower():
                logger.info("⚽ Skip futebol")
                return

            # Parse do sinal
            signal = parse_signal(raw)
            if not signal:
                logger.info("❓ Não parseou como sinal — ignorado")
                return

            market = signal["market"]
            line = signal["line"]
            odd = signal["odd"]
            player = signal.get("hc_team", "")
            teams = signal.get("teams", "")

            logger.info("=" * 50)
            logger.info("SINAL: {} {} {} @{:.2f}", player or market.upper(), "+" if line > 0 else "", line, odd)
            logger.info("Jogo: {}", teams)
            logger.info("=" * 50)

            # Safety check
            check = safety.check(stake=STAKE, odd=odd)
            if not check.allowed:
                logger.warning("⛔ Safety: {} — {}", check.reason.value, check.detail)
                return

            effective_stake = check.adjusted_stake or STAKE

            # Resolve via fixture map
            if market == "hc" and player:
                selection = await fixture_map.resolve(player, line, odd)
            elif market in ("over", "under"):
                # Para Over/Under, resolve pelo nome do time (qualquer lado)
                team_name = player or ""
                if not team_name and teams:
                    # Extrai primeiro time do matchup "A vs B"
                    parts = re.split(r'\s+(?:vs|x|v)\s+', teams, flags=re.IGNORECASE)
                    team_name = parts[0].strip() if parts else ""
                if team_name:
                    selection = await fixture_map.resolve(team_name, line, odd)
                else:
                    logger.warning("Over/Under sem nome de time para resolver")
                    return
            else:
                logger.warning("Mercado não suportado: {}", market)
                return

            if not selection:
                logger.warning("❌ Seleção não encontrada no mapa WS: {} {}", player, line)
                logger.info("   Mapa atual: {}", fixture_map.stats)
                return

            # Valida odd
            if odd - selection.odds_decimal > MAX_ODD_DROP:
                logger.warning(
                    "⚠️ Odd caiu muito: sinal={:.2f} atual={:.2f} (drop={:.2f})",
                    odd, selection.odds_decimal, odd - selection.odds_decimal,
                )

            logger.info(
                "✅ Resolvido: f={} fp={} odds={} ({:.2f}) hc={}",
                selection.fixture_id, selection.selection_id,
                selection.odds, selection.odds_decimal, selection.handicap,
            )

            # PlaceBet via UI automation (trusted CDP events)
            ui = UIBetPlacer(page)
            try:
                result = await ui.place_bet(
                    fixture_id=selection.fixture_id,
                    market=market,
                    handicap_line=line,
                    side="home" if player and player.upper() == (selection.name or "").upper() else "away",
                    stake=effective_stake,
                    navigate=True,
                )
            except Exception as e:
                logger.error("UI PlaceBet error: {}", e)
                # Volta para eSports para manter WS ativo
                await ui.go_back_to_esports()
                return

            # Volta para eSports listing (mantém WS ativo)
            await ui.go_back_to_esports()

            # Resultado
            if result.success:
                bet_count += 1
                logger.info(
                    "🎉 APOSTA #{} ACEITA! receipt={} odds={} sr={}",
                    bet_count, result.bet_receipt, result.odds, result.sr,
                )
                safety.record_result(-effective_stake)
            elif result.error:
                logger.warning("❌ Erro: {}", result.error)
            else:
                logger.warning(
                    "❌ Rejeitada: sr={} cs={}", result.sr, result.cs,
                )

        # 7. Roda até Ctrl+C (browser permanece aberto)
        try:
            await tg_client.run_until_disconnected()
        except KeyboardInterrupt:
            pass
        finally:
            stats_task.cancel()
            await harvester.stop_auto_refresh()
            await tg_client.disconnect()
            print()
            print(f"  📊 Total apostas: {bet_count}")
            print(f"  {safety.status_summary()}")
            print("  Bot encerrado.")


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        print("\n  Ctrl+C — bye!")
