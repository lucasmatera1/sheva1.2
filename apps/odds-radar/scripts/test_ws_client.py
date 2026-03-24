"""
Test WS Client — Testa conexão WebSocket com Bet365.

Modos:
  python scripts/test_ws_client.py               → testa sem auth (apenas handshake)
  python scripts/test_ws_client.py --with-tokens  → usa tokens salvos para auth
  python scripts/test_ws_client.py --listen 30    → escuta 30s de mensagens raw

Saída: resumo de conexão, handshake, e mensagens recebidas.
"""

from __future__ import annotations

import asyncio
import json
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from loguru import logger

from src.api.ws_client import (
    Bet365WsClient,
    WsTokens,
    ODDS_WS_HOSTS,
    CMD_WS_HOST,
)
from src.api.ws_parser import Bet365WsParser
from src.api.http_client import SessionTokens
from src.api.token_harvester import TokenHarvester


DATA_DIR = Path(__file__).resolve().parent.parent / "data"
LOG_DIR = Path(__file__).resolve().parent.parent / "logs"


def load_session_tokens() -> SessionTokens | None:
    """Carrega tokens de sessão salvos."""
    for name in ("live_tokens.json", "session_tokens.json"):
        path = DATA_DIR / name
        if not path.exists():
            continue
        data = json.loads(path.read_text(encoding="utf-8"))
        if "cookies" in data:
            cookies = data["cookies"]
            return SessionTokens(
                pstk=cookies.get("pstk", ""),
                gwt=cookies.get("gwt", ""),
                swt=cookies.get("swt", ""),
                aaat=cookies.get("aaat", ""),
                pers=cookies.get("pers", ""),
                aps03=cookies.get("aps03", ""),
                cf_bm=cookies.get("__cf_bm", ""),
                x_net_sync_term=data.get("x_net_sync_term", ""),
                page_id=data.get("page_id", ""),
            )
        return SessionTokens(
            pstk=data.get("pstk", ""),
            gwt=data.get("gwt", ""),
            swt=data.get("swt", ""),
            aaat=data.get("aaat", ""),
            pers=data.get("pers", ""),
            aps03=data.get("aps03", ""),
            cf_bm=data.get("__cf_bm", ""),
            x_net_sync_term=data.get("x_net_sync_term", ""),
            page_id=data.get("page_id", ""),
        )
    return None


async def test_handshake_no_auth():
    """Testa conexão WS sem autenticação — verifica handshake."""
    print("\n📋 Teste: WS Handshake SEM auth")
    parser = Bet365WsParser()
    client = Bet365WsClient(parser=parser)

    for host in ODDS_WS_HOSTS:
        print(f"\n  Tentando {host}...")
        try:
            ws = await client.connect_odds(host)
            print(f"  ✅ Conectado a {host}")
            print(f"  Escutando 5s de mensagens...")

            messages = await client.listen_raw(ws, duration=5.0)
            print(f"  Recebidas: {len(messages)} mensagens")

            for i, msg in enumerate(messages[:3]):
                raw_preview = msg.raw[:120].replace("\n", "\\n")
                print(f"    [{i}] type={msg.msg_type} entities={len(msg.entities)} | {raw_preview}...")

            await ws.close()
            return True
        except Exception as e:
            print(f"  ❌ {host}: {e}")

    # Tenta cmd WS
    print(f"\n  Tentando CMD WS ({CMD_WS_HOST})...")
    try:
        ws = await client.connect_cmd()
        print(f"  ✅ Conectado a CMD WS")
        messages = await client.listen_raw(ws, duration=5.0)
        print(f"  Recebidas: {len(messages)} mensagens")
        await ws.close()
        return True
    except Exception as e:
        print(f"  ❌ CMD WS: {e}")

    return False


async def test_with_tokens():
    """Testa conexão WS com tokens de sessão salvos."""
    print("\n📋 Teste: WS com tokens de sessão")

    tokens = load_session_tokens()
    if not tokens:
        print("  ❌ Nenhum token salvo encontrado")
        print("  💡 Rode bet_telegram.py primeiro para gerar tokens")
        return False

    print(f"  Tokens carregados: gwt={'✅' if tokens.gwt else '❌'} pstk={'✅' if tokens.pstk else '❌'}")

    parser = Bet365WsParser()
    client = Bet365WsClient(session_tokens=tokens, parser=parser)

    for host in ODDS_WS_HOSTS:
        print(f"\n  Tentando {host} com cookies...")
        try:
            ws = await client.connect_odds(host)
            print(f"  ✅ Conectado COM auth a {host}!")

            messages = await client.listen_raw(ws, duration=10.0)
            print(f"  Recebidas: {len(messages)} mensagens")

            # Analisa tipos de mensagem
            type_counts: dict[str, int] = {}
            total_entities = 0
            for msg in messages:
                type_counts[msg.msg_type] = type_counts.get(msg.msg_type, 0) + 1
                total_entities += len(msg.entities)

            print(f"  Total entidades: {total_entities}")
            print(f"  Tipos: {type_counts}")

            # Mostra primeiras mensagens
            for i, msg in enumerate(messages[:5]):
                raw_preview = msg.raw[:150].replace("\n", "\\n")
                print(f"    [{i}] type={msg.msg_type} entities={len(msg.entities)} | {raw_preview}")

            await ws.close()
            return True
        except Exception as e:
            print(f"  ❌ {host}: {e}")

    return False


async def test_listen_raw(duration: float = 30.0):
    """Escuta e loga mensagens raw por N segundos."""
    print(f"\n📋 Teste: Listen raw por {duration}s")

    tokens = load_session_tokens()
    parser = Bet365WsParser()
    client = Bet365WsClient(session_tokens=tokens, parser=parser)

    log_file = LOG_DIR / "ws_raw_test.jsonl"
    LOG_DIR.mkdir(parents=True, exist_ok=True)

    host = ODDS_WS_HOSTS[0]
    print(f"  Conectando a {host}...")

    try:
        ws = await client.connect_odds(host)
        print(f"  ✅ Conectado — escutando {duration}s → {log_file}")

        messages = await client.listen_raw(
            ws, duration=duration, log_file=str(log_file)
        )

        print(f"\n  Resultado: {len(messages)} mensagens em {duration}s")

        # Estatísticas
        type_counts: dict[str, int] = {}
        entity_types: dict[str, int] = {}
        for msg in messages:
            type_counts[msg.msg_type] = type_counts.get(msg.msg_type, 0) + 1
            for ent in msg.entities:
                entity_types[ent.type] = entity_types.get(ent.type, 0) + 1

        print(f"  Msg types: {type_counts}")
        print(f"  Entity types: {dict(sorted(entity_types.items(), key=lambda x: -x[1])[:10])}")
        print(f"  Log salvo em: {log_file}")

        await ws.close()
    except Exception as e:
        print(f"  ❌ Erro: {e}")


def main():
    print("=" * 60)
    print("  🧪 Test WS Client — Bet365 WebSocket")
    print("=" * 60)

    if "--listen" in sys.argv:
        idx = sys.argv.index("--listen")
        duration = float(sys.argv[idx + 1]) if idx + 1 < len(sys.argv) else 30.0
        asyncio.run(test_listen_raw(duration))
    elif "--with-tokens" in sys.argv:
        asyncio.run(test_with_tokens())
    else:
        asyncio.run(test_handshake_no_auth())

    print("\n✅ WS test completo.")


if __name__ == "__main__":
    main()
