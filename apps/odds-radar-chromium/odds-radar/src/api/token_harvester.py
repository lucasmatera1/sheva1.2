"""
Token Harvester — Etapa 2 (abordagem híbrida).

Mantém browser Camoufox rodando para validação GeoComply,
extrai tokens frescos (cookies + x-net-sync-term) periodicamente,
e alimenta o HTTP client para apostas rápidas.

Descoberta-chave: o cookie `gwt` incorpora validação geo server-side.
  - Primeiras 10 apostas com mesmo gwt → todas geo_services_blocked
  - Após gwt rotacionar (refresh pelo browser) → apostas passam (cs=3)
  - Conclusão: gwt/swt são tokens geo-validados pelo JS do browser

Arquitetura:
  Browser (Camoufox)  →  Token Harvester  →  HTTP Client (httpx)
  [geo + auth]           [extrai cookies]     [PlaceBet <500ms]

Uso:
    harvester = TokenHarvester()
    async with harvester.start() as tokens:
        # tokens é atualizado periodicamente em background
        client = Bet365HttpClient(tokens)
        result = await client.place_bet(...)
"""

from __future__ import annotations

import asyncio
import json
import time
from dataclasses import dataclass, field
from pathlib import Path

from loguru import logger

from src.api.http_client import SessionTokens


TOKEN_FILE = Path(__file__).parent.parent / "data" / "live_tokens.json"
REFRESH_INTERVAL = 120  # segundos entre refreshes de token


@dataclass
class TokenState:
    """Estado atual dos tokens com metadata."""
    tokens: SessionTokens
    extracted_at: float = 0.0
    refresh_count: int = 0
    last_gwt: str = ""  # para detectar rotação

    @property
    def age_seconds(self) -> float:
        return time.time() - self.extracted_at if self.extracted_at else float("inf")

    @property
    def gwt_changed(self) -> bool:
        return self.tokens.gwt != self.last_gwt and self.last_gwt != ""


class TokenHarvester:
    """Extrai e mantém tokens frescos de uma sessão Camoufox ativa."""

    def __init__(self, refresh_interval: float = REFRESH_INTERVAL):
        self._refresh_interval = refresh_interval
        self._state: TokenState | None = None
        self._page = None
        self._refresh_task: asyncio.Task | None = None
        self._sync_term_listener_installed = False

    @property
    def tokens(self) -> SessionTokens | None:
        return self._state.tokens if self._state else None

    @property
    def state(self) -> TokenState | None:
        return self._state

    async def extract_from_page(self, page) -> SessionTokens:
        """Extrai todos os tokens de uma página Playwright ativa no Bet365."""
        context = page.context

        # 1. Extrair cookies do context
        all_cookies = await context.cookies("https://www.bet365.bet.br")
        cookies_dict = {c["name"]: c["value"] for c in all_cookies}

        logger.debug(
            "Cookies extraídos: {} (gwt={}...)",
            len(cookies_dict),
            cookies_dict.get("gwt", "?")[:20],
        )

        # 2. Extrair x-net-sync-term via JS (está em window.__netSyncTerm ou similar)
        sync_term = await page.evaluate("""() => {
            // Tenta múltiplas fontes para o sync term
            // 1. Variable global conhecida
            if (window.__netSyncTerm) return window.__netSyncTerm;
            if (window._nst) return window._nst;
            
            // 2. Busca em XHR interceptado (último request registrado)
            if (window.__lastSyncTerm) return window.__lastSyncTerm;
            
            // 3. Busca no localStorage/sessionStorage
            for (const storage of [localStorage, sessionStorage]) {
                for (let i = 0; i < storage.length; i++) {
                    const key = storage.key(i);
                    if (key && (key.includes('sync') || key.includes('nst') || key.includes('term'))) {
                        const val = storage.getItem(key);
                        if (val && val.length > 50) return val;
                    }
                }
            }
            
            return '';
        }""")

        # 3. Extrair page_id via JS
        page_id = await page.evaluate("""() => {
            // page_id é tipicamente o param 'p' usado nas requests
            if (window.__pageId) return window.__pageId;
            if (window._pid) return window._pid;
            
            // Tenta extrair de data attributes ou meta tags
            const meta = document.querySelector('meta[name="page-id"]');
            if (meta) return meta.content;
            
            return '';
        }""")

        # Se page_id não encontrado no JS, gerar um (random BigInt como o browser faz)
        if not page_id:
            import random
            page_id = str(random.randint(10**17, 10**19 - 1))

        tokens = SessionTokens(
            pstk=cookies_dict.get("pstk", ""),
            gwt=cookies_dict.get("gwt", ""),
            swt=cookies_dict.get("swt", ""),
            aaat=cookies_dict.get("aaat", ""),
            pers=cookies_dict.get("pers", ""),
            aps03=cookies_dict.get("aps03", ""),
            cf_bm=cookies_dict.get("__cf_bm", ""),
            x_net_sync_term=sync_term,
            page_id=page_id,
            _all_cookies=dict(cookies_dict),  # Guarda TODOS os cookies
        )

        # Atualiza estado
        old_gwt = self._state.tokens.gwt if self._state else ""
        self._state = TokenState(
            tokens=tokens,
            extracted_at=time.time(),
            refresh_count=(self._state.refresh_count + 1) if self._state else 1,
            last_gwt=old_gwt,
        )

        if self._state.gwt_changed:
            logger.info(
                "🔄 gwt ROTACIONOU: {}... → {}...",
                old_gwt[:20], tokens.gwt[:20],
            )
            # Atualiza last_gwt para não disparar gwt_changed repetidamente
            self._state.last_gwt = tokens.gwt

        # Salva em disco para recuperação
        self._save_tokens()

        return tokens

    async def extract_sync_term_from_intercept(self, page) -> str:
        """Intercepta uma request real para capturar x-net-sync-term fresco.
        
        O sync term é gerado pelo JS do Bet365 e enviado em requests.
        Estratégia: intercepta requests que o Bet365 já faz naturalmente,
        ou triggera uma request leve se nenhuma ocorrer em 3s.
        """
        sync_term_future: asyncio.Future[str] = asyncio.get_event_loop().create_future()

        async def _intercept(route):
            headers = route.request.headers
            term = headers.get("x-net-sync-term", "")
            if term and not sync_term_future.done():
                sync_term_future.set_result(term)
            await route.continue_()

        # Intercepta qualquer request para APIs do Bet365
        patterns = ["**/defaultapi/**", "**/BetsWebAPI/**", "**/sportsbookapi/**"]
        for p in patterns:
            await page.route(p, _intercept)

        try:
            # Espera 3s por request natural (Bet365 faz polling frequente)
            try:
                term = await asyncio.wait_for(sync_term_future, timeout=3.0)
                logger.debug("x-net-sync-term interceptado (natural): {}...", term[:40])
                return term
            except (asyncio.TimeoutError, asyncio.CancelledError):
                pass

            # Triggera uma request leve para capturar o header
            await page.evaluate("""() => {
                fetch('/defaultapi/sports-configuration', { credentials: 'include' })
                    .catch(() => {});
            }""")

            term = await asyncio.wait_for(sync_term_future, timeout=5.0)
            logger.debug("x-net-sync-term interceptado (triggered): {}...", term[:40])
            return term
        except (asyncio.TimeoutError, asyncio.CancelledError):
            logger.warning("Timeout esperando x-net-sync-term")
            return ""
        finally:
            for p in patterns:
                try:
                    await page.unroute(p, _intercept)
                except Exception:
                    pass

    async def full_extract(self, page) -> SessionTokens:
        """Extração completa: cookies + sync term interceptado."""
        # Primeiro intercepta sync term (precisa de request real)
        try:
            sync_term = await self.extract_sync_term_from_intercept(page)
        except (asyncio.CancelledError, Exception) as e:
            logger.warning("Sync term extraction falhou (continuando sem): {}", e)
            sync_term = ""

        # Depois extrai cookies
        tokens = await self.extract_from_page(page)

        # Atualiza sync term se interceptação funcionou
        if sync_term:
            tokens.x_net_sync_term = sync_term

        self._state.tokens = tokens
        self._save_tokens()

        return tokens

    async def start_auto_refresh(self, page, interval: float | None = None):
        """Inicia refresh automático de tokens em background."""
        self._page = page
        interval = interval or self._refresh_interval

        async def _refresh_loop():
            while True:
                try:
                    await asyncio.sleep(interval)
                    await self.full_extract(page)
                    logger.info(
                        "Token refresh #{} — gwt={}... age={}s",
                        self._state.refresh_count,
                        self._state.tokens.gwt[:20] if self._state else "?",
                        int(self._state.age_seconds) if self._state else "?",
                    )
                except asyncio.CancelledError:
                    break
                except Exception as e:
                    logger.error("Token refresh error: {}", e)
                    await asyncio.sleep(10)

        self._refresh_task = asyncio.create_task(_refresh_loop())
        logger.info("Auto-refresh de tokens iniciado (interval={}s)", interval)

    def start_sync_term_listener(self, page):
        """Registra listener passivo que captura x-net-sync-term de qualquer request.

        Usa page.on("request") — não bloqueia requests, apenas observa headers.
        Sem conflito com route handlers (BetInterceptor etc.).
        """
        if self._sync_term_listener_installed:
            return

        def _on_request(request):
            url = request.url
            if "bet365" not in url:
                return
            headers = request.headers
            term = headers.get("x-net-sync-term", "")
            if term and len(term) > 50:
                if self._state and self._state.tokens:
                    old = self._state.tokens.x_net_sync_term
                    if term != old:
                        self._state.tokens.x_net_sync_term = term
                        self._save_tokens()
                        logger.debug(
                            "x-net-sync-term capturado ({}c) via {}",
                            len(term), url.split("?")[0].split("/")[-1],
                        )
                # Captura page_id do param p= se disponível
                if "?" in url and "p=" in url:
                    from urllib.parse import parse_qs
                    qs = parse_qs(url.split("?", 1)[1])
                    pid = qs.get("p", [""])[0]
                    if pid and self._state and self._state.tokens and not self._state.tokens.page_id:
                        self._state.tokens.page_id = pid
                        self._save_tokens()
                        logger.debug("page_id capturado: {}", pid[:30])

        page.on("request", _on_request)
        self._sync_term_listener_installed = True
        logger.info("Sync-term listener passivo ativado")

    async def stop_auto_refresh(self):
        """Para refresh automático."""
        if self._refresh_task:
            self._refresh_task.cancel()
            try:
                await self._refresh_task
            except asyncio.CancelledError:
                pass
            self._refresh_task = None
            logger.info("Auto-refresh de tokens parado")

    def _save_tokens(self):
        """Salva tokens em disco para recuperação."""
        if not self._state:
            return
        t = self._state.tokens
        data = {
            "pstk": t.pstk,
            "gwt": t.gwt,
            "swt": t.swt,
            "aaat": t.aaat,
            "pers": t.pers,
            "aps03": t.aps03,
            "__cf_bm": t.cf_bm,
            "x_net_sync_term": t.x_net_sync_term,
            "page_id": t.page_id,
            "last_bet_guid": t.last_bet_guid,
            "last_challenge": t.last_challenge,
            "extracted_at": self._state.extracted_at,
            "refresh_count": self._state.refresh_count,
        }
        TOKEN_FILE.parent.mkdir(parents=True, exist_ok=True)
        TOKEN_FILE.write_text(json.dumps(data, indent=2), encoding="utf-8")

    @classmethod
    def load_saved_tokens(cls) -> SessionTokens | None:
        """Carrega tokens salvos do disco (para warm-start)."""
        if not TOKEN_FILE.exists():
            return None
        try:
            data = json.loads(TOKEN_FILE.read_text(encoding="utf-8"))
            tokens = SessionTokens(
                pstk=data.get("pstk", ""),
                gwt=data.get("gwt", ""),
                swt=data.get("swt", ""),
                aaat=data.get("aaat", ""),
                pers=data.get("pers", ""),
                aps03=data.get("aps03", ""),
                cf_bm=data.get("__cf_bm", ""),
                x_net_sync_term=data.get("x_net_sync_term", ""),
                page_id=data.get("page_id", ""),
                last_bet_guid=data.get("last_bet_guid", ""),
                last_challenge=data.get("last_challenge", ""),
            )
            age = time.time() - data.get("extracted_at", 0)
            logger.info(
                "Tokens carregados do disco (age={}s, gwt={}...)",
                int(age), tokens.gwt[:20],
            )
            return tokens
        except Exception as e:
            logger.warning("Erro ao carregar tokens: {}", e)
            return None
