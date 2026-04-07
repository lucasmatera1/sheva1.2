"""
Extrator de tokens de sessão do Bet365 via browser.

Conecta ao browser ativo (ou abre novo), extrai todos os tokens
necessários para fazer apostas via HTTP direto, e salva em arquivo.

Uso:
    python scripts/extract_tokens.py              # Extrai do browser ativo
    python scripts/extract_tokens.py --test-bet   # Extrai e testa PlaceBet HTTP
"""

import asyncio
import json
import sys
import time
from pathlib import Path

# Adiciona src ao path
sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "src"))
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from loguru import logger

TOKENS_FILE = Path(__file__).resolve().parent.parent / "data" / "session_tokens.json"
TRAFFIC_LOG = Path(__file__).resolve().parent.parent / "logs" / "bet365_api_traffic.jsonl"


def extract_tokens_from_traffic_log() -> dict:
    """Extrai tokens da última sessão do traffic log."""
    if not TRAFFIC_LOG.exists():
        logger.warning("Traffic log não encontrado: {}", TRAFFIC_LOG)
        return {}

    tokens = {
        "cookies": {},
        "x_net_sync_term": "",
        "page_id": "",
        "last_bet_guid": "",
        "last_challenge": "",
        "pstk": "",
        "extracted_at": time.strftime("%Y-%m-%dT%H:%M:%S"),
    }

    # Lê de trás para frente para pegar os mais recentes
    lines = TRAFFIC_LOG.read_text(encoding="utf-8").strip().split("\n")

    for line in reversed(lines):
        try:
            entry = json.loads(line)
        except json.JSONDecodeError:
            continue

        # Extrai cookies de request headers
        if entry.get("type") == "request" and entry.get("headers", {}).get("cookie"):
            if not tokens["cookies"]:
                cookie_str = entry["headers"]["cookie"]
                for part in cookie_str.split(";"):
                    part = part.strip()
                    if "=" in part:
                        k, v = part.split("=", 1)
                        tokens["cookies"][k.strip()] = v.strip()

        # Extrai x-net-sync-term
        if entry.get("type") == "request" and entry.get("headers", {}).get("x-net-sync-term"):
            if not tokens["x_net_sync_term"]:
                tokens["x_net_sync_term"] = entry["headers"]["x-net-sync-term"]

        # Extrai page_id (param p=)
        if entry.get("type") == "request" and "placebet" in entry.get("url", "").lower():
            url = entry["url"]
            if "p=" in url and not tokens["page_id"]:
                import re
                m = re.search(r'p=(\d+)', url)
                if m:
                    tokens["page_id"] = m.group(1)

        # Extrai tokens encadeados da última resposta PlaceBet
        if entry.get("type") == "response" and "placebet" in entry.get("url", "").lower():
            try:
                body = json.loads(entry.get("body", "{}"))
                if body.get("bg") and not tokens["last_bet_guid"]:
                    tokens["last_bet_guid"] = body["bg"]
                if body.get("cc") and not tokens["last_challenge"]:
                    tokens["last_challenge"] = body["cc"]
            except (json.JSONDecodeError, TypeError):
                pass

        # Extrai pstk do WS
        if entry.get("type") == "ws_sent":
            data = entry.get("data", "")
            if "S_" in data and not tokens["pstk"]:
                import re
                m = re.search(r'S_([A-F0-9]+)', data)
                if m:
                    tokens["pstk"] = m.group(1)

        # Pára quando tiver tudo
        if all([tokens["cookies"], tokens["x_net_sync_term"], tokens["page_id"]]):
            break

    # Resumo
    logger.info("Tokens extraídos do traffic log:")
    logger.info("  Cookies: {} chaves", len(tokens["cookies"]))
    logger.info("  x-net-sync-term: {} chars", len(tokens["x_net_sync_term"]))
    logger.info("  page_id: {}", tokens["page_id"] or "(não encontrado)")
    logger.info("  pstk: {}", tokens["pstk"][:20] + "..." if tokens["pstk"] else "(não encontrado)")
    logger.info("  last_bet_guid: {}", tokens["last_bet_guid"][:20] + "..." if tokens["last_bet_guid"] else "(não encontrado)")

    return tokens


def save_tokens(tokens: dict):
    """Salva tokens em arquivo JSON."""
    TOKENS_FILE.parent.mkdir(parents=True, exist_ok=True)
    TOKENS_FILE.write_text(json.dumps(tokens, indent=2, ensure_ascii=False), encoding="utf-8")
    logger.success("Tokens salvos em: {}", TOKENS_FILE)


def load_tokens() -> dict:
    """Carrega tokens do arquivo."""
    if not TOKENS_FILE.exists():
        logger.warning("Arquivo de tokens não encontrado: {}", TOKENS_FILE)
        return {}
    tokens = json.loads(TOKENS_FILE.read_text(encoding="utf-8"))
    logger.info("Tokens carregados de: {} (extraídos em {})", TOKENS_FILE.name, tokens.get("extracted_at", "?"))
    return tokens


async def test_placebet_http(tokens: dict):
    """Testa o PlaceBet via HTTP direto usando tokens extraídos."""
    from src.api.http_client import Bet365HttpClient, SessionTokens

    session = SessionTokens(
        pstk=tokens["cookies"].get("pstk", tokens.get("pstk", "")),
        gwt=tokens["cookies"].get("gwt", ""),
        swt=tokens["cookies"].get("swt", ""),
        aaat=tokens["cookies"].get("aaat", ""),
        pers=tokens["cookies"].get("pers", ""),
        aps03=tokens["cookies"].get("aps03", ""),
        cf_bm=tokens["cookies"].get("__cf_bm", ""),
        x_net_sync_term=tokens.get("x_net_sync_term", ""),
        last_bet_guid=tokens.get("last_bet_guid", ""),
        last_challenge=tokens.get("last_challenge", ""),
        page_id=tokens.get("page_id", ""),
    )

    client = Bet365HttpClient(session)

    logger.info("Testando PlaceBet via HTTP direto...")
    logger.info("  pstk: {}...", session.pstk[:20] if session.pstk else "VAZIO")
    logger.info("  sync_term: {} chars", len(session.x_net_sync_term))
    logger.info("  page_id: {}", session.page_id or "VAZIO")

    async with client:
        # Usa IDs de teste de um jogo ao vivo (classificação 18 = eSports)
        # NOTA: Estes IDs precisam ser de um jogo ATIVO para funcionar
        result = await client.place_bet(
            fixture_id="191755961",  # Exemplo - trocar por jogo ativo
            selection_id="901719780",
            odds="4/5",
            stake=1.00,
            handicap="+6.5",
            market_type=11,
            classification=18,
        )

    logger.info("Resultado: cs={} mi={} success={}", result.completion_status, result.message_id, result.success)
    if result.is_geo_blocked:
        logger.warning("⚠️ Geo blocking ativo — precisa resolver GeoComply")
    logger.info("Resposta completa: {}", json.dumps(result.raw_response, indent=2)[:500])

    return result


def main():
    args = set(sys.argv[1:])

    logger.info("=== Extrator de Tokens Bet365 ===")

    # Extrai tokens do traffic log (mais recente)
    tokens = extract_tokens_from_traffic_log()

    if not tokens.get("cookies"):
        logger.error("Nenhum token encontrado! Rode o bot (bet_telegram.py) primeiro para capturar tráfego.")
        return

    # Salva tokens
    save_tokens(tokens)

    # Testa PlaceBet via HTTP se solicitado
    if "--test-bet" in args:
        asyncio.run(test_placebet_http(tokens))
    else:
        logger.info("Para testar PlaceBet via HTTP: python extract_tokens.py --test-bet")


if __name__ == "__main__":
    main()
