"""
Cliente HTTP direto para Bet365 — API-only (sem browser).

Usa curl_cffi para impersonar o TLS fingerprint (JA3/JA4) de um browser
real (Firefox 135). Isso é como os serviços SaaS profissionais operam:
chamadas HTTP diretas com TLS idêntico ao browser, sem automação DOM.

Fluxo:
  1. Extrair tokens de sessão de uma sessão ativa do browser (bootstrap)
  2. Montar request PlaceBet idêntico ao que o site faz
  3. Enviar via curl_cffi com impersonação Firefox
  4. Usar tokens encadeados (bg, cc) da resposta para próximas apostas

Arquitetura:
  Browser (Camoufox) → login manual → cookies/gwt → TokenHarvester → HTTP client
  O browser só precisa existir para GeoComply rodar e renovar gwt tokens.
  Todas as apostas vão via HTTP direto (latência <200ms).
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass, field
from urllib.parse import quote, urlencode

from curl_cffi.requests import AsyncSession
from loguru import logger


@dataclass
class BetResult:
    """Resultado de um PlaceBet."""
    success: bool
    completion_status: int  # cs: 2=rejected, 3=accepted
    message_id: str  # mi: "geo_services_blocked", "", etc.
    bet_reference: str  # br: "DF2649966071F"
    ticket_id: str  # tk/ir: ticket number
    odds: str  # odd confirmada
    return_value: float  # retorno esperado
    next_bet_guid: str  # bg: para próxima aposta
    next_challenge: str  # cc: challenge token para próxima
    raw_response: dict  # resposta completa

    @property
    def is_geo_blocked(self) -> bool:
        return self.message_id == "geo_services_blocked"


@dataclass
class SessionTokens:
    """Tokens de sessão necessários para fazer apostas."""
    pstk: str  # Cookie pstk (session token principal)
    gwt: str  # Cookie gwt (general web token)
    swt: str  # Cookie swt (session web token)
    aaat: str  # Cookie aaat (auth account token)
    pers: str  # Cookie pers (persistence)
    aps03: str  # Cookie aps03 (config)
    cf_bm: str  # Cookie __cf_bm (Cloudflare)
    x_net_sync_term: str  # Header x-net-sync-term
    # Tokens encadeados (atualizados a cada aposta)
    last_bet_guid: str = ""
    last_challenge: str = ""
    page_id: str = ""  # param p= na URL
    # TODOS os cookies do browser (para enviar exatamente como o browser)
    _all_cookies: dict = field(default_factory=dict)

    def to_cookie_string(self) -> str:
        """Monta string de cookie para o header."""
        cookies = self.to_cookie_dict()
        return "; ".join(f"{k}={v}" for k, v in cookies.items() if v)

    def to_cookie_dict(self) -> dict:
        """Cookies como dict para curl_cffi — envia TODOS os cookies do browser."""
        if self._all_cookies:
            return {k: v for k, v in self._all_cookies.items() if v}
        # Fallback: apenas os campos nomeados
        d = {
            "pstk": self.pstk,
            "gwt": self.gwt,
            "swt": self.swt,
            "aaat": self.aaat,
            "pers": self.pers,
            "aps03": self.aps03,
            "__cf_bm": self.cf_bm,
            "session": "lgs=1",
            "rmbs": "3",
            "cc": "1",
        }
        return {k: v for k, v in d.items() if v}

    @classmethod
    def from_browser_cookies(cls, cookies: dict, sync_term: str = "", page_id: str = "") -> SessionTokens:
        """Cria SessionTokens a partir de cookies extraídos do browser."""
        return cls(
            pstk=cookies.get("pstk", ""),
            gwt=cookies.get("gwt", ""),
            swt=cookies.get("swt", ""),
            aaat=cookies.get("aaat", ""),
            pers=cookies.get("pers", ""),
            aps03=cookies.get("aps03", ""),
            cf_bm=cookies.get("__cf_bm", ""),
            x_net_sync_term=sync_term,
            page_id=page_id,
            _all_cookies=dict(cookies),  # Guarda TODOS os cookies
        )


def _build_ns_payload(
    fixture_id: str,
    selection_id: str,
    odds: str,
    stake: float,
    handicap: str = "",
    market_type: int = 11,
    classification: int = 18,
    accept_changes: bool = True,
) -> str:
    """Monta o campo `ns` do POST data no formato proprietário Bet365."""
    # Calcula retorno decimal
    if "/" in odds:
        num, den = odds.split("/", 1)
        try:
            decimal_odds = 1 + int(num) / int(den)
        except (ValueError, ZeroDivisionError):
            decimal_odds = float(odds.replace("/", "."))
    else:
        try:
            decimal_odds = float(odds)
        except ValueError:
            decimal_odds = 2.0  # fallback seguro
            logger.warning("Odds inválida '{}', usando fallback 2.0", odds)
    total_return = round(stake * decimal_odds, 2)

    # Monta componentes
    parts = [
        f"pt=N",
        f"o={odds}",
        f"pv={odds}",
        f"f={fixture_id}",
        f"fp={selection_id}",
        f"so=",
        f"c={classification}",
    ]
    if handicap:
        parts.append(f"ln={handicap}")
    parts.append(f"mt={market_type}")

    bet_section = "#".join(parts)

    at_section = "#".join([
        f"at={'Y' if accept_changes else 'N'}",
        f"TP=BS{fixture_id}-{selection_id}",
        f"ust={stake:.2f}",
        f"st={stake:.2f}",
        f"tr={total_return:.2f}",
    ])

    return f"{bet_section}#|{at_section}#||"


class Bet365HttpClient:
    """Cliente HTTP para PlaceBet direto via curl_cffi (TLS impersonation)."""

    BASE_URL = "https://www.bet365.bet.br"
    PLACEBET_URL = f"{BASE_URL}/BetsWebAPI/placebet"
    # Impersona Firefox 135 no Windows — mesmo fingerprint TLS do Camoufox
    IMPERSONATE = "firefox135"
    USER_AGENT = (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:135.0) "
        "Gecko/20100101 Firefox/135.0"
    )

    def __init__(self, tokens: SessionTokens):
        self.tokens = tokens
        self._session: AsyncSession | None = None

    async def __aenter__(self):
        self._session = AsyncSession(
            impersonate=self.IMPERSONATE,
            timeout=30,
        )
        return self

    async def __aexit__(self, *args):
        if self._session:
            await self._session.close()

    def _build_headers(self) -> dict:
        """Monta headers idênticos ao browser."""
        return {
            "user-agent": self.USER_AGENT,
            "accept": "*/*",
            "accept-language": "en-US,en;q=0.5",
            "accept-encoding": "gzip, deflate, br, zstd",
            "content-type": "application/x-www-form-urlencoded",
            "referer": f"{self.BASE_URL}/",
            "origin": self.BASE_URL,
            "x-net-sync-term": self.tokens.x_net_sync_term,
            "x-request-id": str(uuid.uuid4()),
            "sec-fetch-dest": "empty",
            "sec-fetch-mode": "cors",
            "sec-fetch-site": "same-origin",
        }

    async def place_bet(
        self,
        fixture_id: str,
        selection_id: str,
        odds: str,
        stake: float = 1.00,
        handicap: str = "",
        market_type: int = 11,
        classification: int = 18,
        accept_changes: bool = True,
    ) -> BetResult:
        """Envia PlaceBet via HTTP POST direto com TLS impersonation."""
        if not self._session:
            raise RuntimeError("Use 'async with' para inicializar o client")

        # Gera GUID para esta aposta (ou usa encadeado)
        bet_guid = self.tokens.last_bet_guid or str(uuid.uuid4())
        challenge = self.tokens.last_challenge or ""

        # Monta URL com query params
        params = {"betGuid": bet_guid}
        if challenge:
            params["c"] = challenge
        if self.tokens.page_id:
            params["p"] = self.tokens.page_id

        url = f"{self.PLACEBET_URL}?{urlencode(params, quote_via=quote)}"

        # Monta POST body
        ns = _build_ns_payload(
            fixture_id=fixture_id,
            selection_id=selection_id,
            odds=odds,
            stake=stake,
            handicap=handicap,
            market_type=market_type,
            classification=classification,
            accept_changes=accept_changes,
        )

        # Body montado manualmente — bet365 espera #, =, |, / literais
        # dentro do campo `ns` (NÃO pode usar urlencode que codifica esses chars)
        post_data = (
            f"&ns={ns}"
            f"&xb=1"
            f"&aa=null"
            f"&betsource=FlashInPLay"
            f"&tagType=WindowsDesktopBrowser"
            f"&bs=99"
            f"&qb=1"
        )

        headers = self._build_headers()

        # Cookies como dict nativo para curl_cffi
        cookies = self.tokens.to_cookie_dict()

        logger.info(
            "PlaceBet → fixture={} selection={} odds={} stake={:.2f}",
            fixture_id, selection_id, odds, stake,
        )
        logger.debug("URL: {}", url)
        logger.debug("Body: {}", post_data[:200])
        logger.debug("Cookies: {}", list(cookies.keys()))
        logger.debug("page_id={}, challenge={}", self.tokens.page_id or "EMPTY", challenge[:20] if challenge else "EMPTY")

        resp = await self._session.post(
            url,
            data=post_data.encode(),
            headers=headers,
            cookies=cookies,
        )

        logger.info("PlaceBet response: status={}", resp.status_code)

        if resp.status_code != 200:
            logger.error("PlaceBet HTTP error: {}", resp.status_code)
            return BetResult(
                success=False,
                completion_status=-1,
                message_id=f"http_{resp.status_code}",
                bet_reference="",
                ticket_id="",
                odds=odds,
                return_value=0.0,
                next_bet_guid="",
                next_challenge="",
                raw_response={"status_code": resp.status_code, "body": resp.text[:1000]},
            )

        data = resp.json()
        cs = data.get("cs", -1)
        mi = data.get("mi", "")
        success = cs == 3

        # Update chained tokens
        next_guid = data.get("bg", "")
        next_cc = data.get("cc", "")
        if next_guid:
            self.tokens.last_bet_guid = next_guid
        if next_cc:
            self.tokens.last_challenge = next_cc

        # Extract bet details
        bt = data.get("bt", [{}])[0] if data.get("bt") else {}

        result = BetResult(
            success=success,
            completion_status=cs,
            message_id=mi,
            bet_reference=data.get("br", ""),
            ticket_id=bt.get("tk", bt.get("ir", "")),
            odds=bt.get("od", odds),
            return_value=bt.get("re", 0.0) or 0.0,
            next_bet_guid=next_guid,
            next_challenge=next_cc,
            raw_response=data,
        )

        if success:
            logger.success(
                "✅ Aposta aceita! ref={} ticket={} odd={} return={}",
                result.bet_reference, result.ticket_id, result.odds, result.return_value,
            )
        else:
            logger.warning(
                "❌ Aposta rejeitada: cs={} mi={}", cs, mi,
            )

        return result

    @classmethod
    def from_browser_cookies(cls, cookies: dict, sync_term: str = "", page_id: str = "") -> Bet365HttpClient:
        """Cria cliente a partir de cookies extraídos do browser."""
        tokens = SessionTokens.from_browser_cookies(cookies, sync_term, page_id)
        return cls(tokens)


async def extract_tokens_from_browser(page) -> SessionTokens:
    """
    Extrai tokens de sessão de uma página Playwright ativa.
    Usado para bootstrap: pega tokens do browser e passa para o HTTP client.
    """
    context = page.context

    # Extrai cookies
    all_cookies = await context.cookies()
    cookies = {}
    for c in all_cookies:
        if c["domain"] and "bet365" in c["domain"]:
            cookies[c["name"]] = c["value"]

    # Extrai x-net-sync-term via JS
    sync_term = await page.evaluate("""() => {
        // Tenta encontrar o sync term no DOM ou em variáveis globais
        try {
            // O x-net-sync-term é gerado pelo JS do site e armazenado
            // em variáveis ofuscadas. Não temos acesso direto.
            return window.__xnst || '';
        } catch(e) { return ''; }
    }""")

    # Extrai page ID (param p=) via JS
    page_id = await page.evaluate("""() => {
        try {
            return window.__pageId || '';
        } catch(e) { return ''; }
    }""")

    logger.info(
        "Tokens extraídos: {} cookies, sync_term={}, page_id={}",
        len(cookies), bool(sync_term), bool(page_id),
    )

    return SessionTokens.from_browser_cookies(cookies, sync_term, page_id)


async def place_bet_via_browser(
    page,
    fixture_id: str,
    selection_id: str,
    odds: str,
    stake: float = 1.00,
    handicap: str = "",
    market_type: int = 11,
    classification: int = 18,
    sync_term: str = "",
    page_id: str = "",
) -> dict:
    """PlaceBet usando fetch() DENTRO do browser — inclui todos cookies automaticamente.

    O browser inclui gwt, cc, cc2 e todos os outros cookies que curl_cffi não tem.
    Também inclui headers corretos como connection, host, content-length.
    """
    ns = _build_ns_payload(
        fixture_id=fixture_id,
        selection_id=selection_id,
        odds=odds,
        stake=stake,
        handicap=handicap,
        market_type=market_type,
        classification=classification,
    )

    body = (
        f"&ns={ns}"
        f"&xb=1"
        f"&aa=null"
        f"&betsource=FlashInPLay"
        f"&tagType=WindowsDesktopBrowser"
        f"&bs=99"
        f"&qb=1"
    )

    bet_guid = str(uuid.uuid4())
    url_params = f"betGuid={bet_guid}"
    if page_id:
        url_params += f"&p={page_id}"

    url = f"https://www.bet365.bet.br/BetsWebAPI/placebet?{url_params}"

    logger.info(
        "PlaceBet via browser → fixture={} selection={} odds={} stake={:.2f}",
        fixture_id, selection_id, odds, stake,
    )

    # Executa fetch() dentro do browser — cookies e headers são incluídos automaticamente
    result = await page.evaluate("""async ([url, body, syncTerm]) => {
        try {
            const headers = {
                'Content-Type': 'application/x-www-form-urlencoded',
                'x-net-sync-term': syncTerm,
                'x-request-id': crypto.randomUUID(),
            };
            const resp = await fetch(url, {
                method: 'POST',
                headers: headers,
                body: body,
                credentials: 'include',
            });
            const text = await resp.text();
            return {
                ok: true,
                status: resp.status,
                body: text,
            };
        } catch (e) {
            return { ok: false, error: e.message };
        }
    }""", [url, body, sync_term])

    logger.info("PlaceBet via browser: status={}", result.get("status", "error"))

    return result
