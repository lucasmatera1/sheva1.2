"""
Analisador de tráfego Bet365 — Etapa 2 (API Reversa)

Lê os arquivos JSONL de captura e gera relatórios:
  - Endpoints HTTP mapeados
  - Estrutura de frames WebSocket
  - Tokens de sessão
  - Payloads de PlaceBet decodificados

Uso:
    python scripts/analyze_traffic.py
    python scripts/analyze_traffic.py --placebet     # Só apostas
    python scripts/analyze_traffic.py --ws-decode     # Decodifica WS frames
    python scripts/analyze_traffic.py --tokens        # Extrai tokens de sessão
"""

import json
import sys
from collections import Counter, defaultdict
from pathlib import Path
from urllib.parse import unquote, parse_qs

LOGS_DIR = Path(__file__).resolve().parent.parent / "logs"
TRAFFIC_FILE = LOGS_DIR / "bet365_api_traffic.jsonl"
WS_FULL_FILE = LOGS_DIR / "bet365_ws_full.jsonl"


def load_entries(filepath: Path) -> list[dict]:
    if not filepath.exists():
        print(f"❌ Arquivo não encontrado: {filepath}")
        return []
    entries = []
    with open(filepath, "r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if line:
                try:
                    entries.append(json.loads(line))
                except json.JSONDecodeError:
                    pass
    return entries


def overview(entries: list[dict]):
    """Visão geral do tráfego capturado."""
    print("\n" + "=" * 70)
    print("📊 VISÃO GERAL DO TRÁFEGO")
    print("=" * 70)
    
    type_counts = Counter(e["type"] for e in entries)
    print(f"\nTotal de entries: {len(entries)}")
    print(f"\nPor tipo:")
    for t, c in type_counts.most_common():
        print(f"  {t:15s} → {c}")

    # HTTP endpoints
    print(f"\n{'─' * 70}")
    print("🌐 HTTP Endpoints:")
    http_urls = Counter()
    for e in entries:
        if e["type"] == "request":
            url = e["url"].split("?")[0]
            http_urls[f"{e.get('method', '?')} {url}"] += 1
    for url, c in http_urls.most_common():
        print(f"  [{c:3d}x] {url}")

    # WS connections
    print(f"\n{'─' * 70}")
    print("🔌 WebSocket Connections:")
    ws_urls = Counter()
    for e in entries:
        if e["type"] == "ws_open":
            host = e["url"].split("/zap")[0] if "/zap" in e["url"] else e["url"][:80]
            ws_urls[host] += 1
    for url, c in ws_urls.most_common():
        print(f"  [{c:3d}x] {url}")


def decode_placebet_ns(ns_raw: str) -> dict:
    """Decodifica o campo `ns` do PlaceBet POST data."""
    ns = unquote(ns_raw)
    result = {}
    # Parse: field=value#field=value#...|field=value#...||
    sections = ns.split("||")
    for i, section in enumerate(sections):
        if not section.strip():
            continue
        parts = section.split("|")
        for part in parts:
            fields = part.split("#")
            for field in fields:
                if "=" in field:
                    k, v = field.split("=", 1)
                    result[k] = v
    return result


def analyze_placebets(entries: list[dict]):
    """Analisa todas as requests de PlaceBet."""
    print("\n" + "=" * 70)
    print("🎰 ANÁLISE DE PLACEBET REQUESTS")
    print("=" * 70)

    requests = [e for e in entries if e["type"] == "request" and "placebet" in e.get("url", "").lower()]
    responses = [e for e in entries if e["type"] == "response" and "placebet" in e.get("url", "").lower()]
    
    print(f"\nTotal requests: {len(requests)}")
    print(f"Total responses: {len(responses)}")

    for i, req in enumerate(requests):
        print(f"\n{'─' * 70}")
        print(f"📝 Aposta #{i+1} — {req.get('_ts', '?')}")
        
        # Parse URL params
        url = req["url"]
        if "?" in url:
            params = parse_qs(url.split("?", 1)[1])
            print(f"  betGuid: {params.get('betGuid', ['?'])[0]}")
            print(f"  c (token): {str(params.get('c', ['?'])[0])[:50]}...")
            print(f"  p (session): {params.get('p', ['?'])[0]}")

        # Parse POST data
        post_data = req.get("post_data", "")
        if post_data:
            decoded_post = unquote(post_data)
            post_params = parse_qs(decoded_post.lstrip("&"))
            
            # Decode ns field
            ns_raw = post_params.get("ns", [""])[0]
            if ns_raw:
                ns_fields = decode_placebet_ns(ns_raw)
                print(f"  --- Bet Details ---")
                field_labels = {
                    "pt": "Bet Type", "o": "Odd (frac)", "pv": "Prev Value",
                    "f": "Fixture ID", "fp": "Selection ID", "c": "Classification",
                    "ln": "Line/Handicap", "mt": "Market Type", "at": "Accept Changes",
                    "TP": "Ticket Pos", "ust": "User Stake", "st": "Stake", "tr": "Total Return",
                }
                for k, label in field_labels.items():
                    if k in ns_fields:
                        print(f"  {label:20s}: {ns_fields[k]}")
            
            # Other POST fields
            betsource = post_params.get("betsource", ["?"])[0]
            print(f"  {'Bet Source':20s}: {betsource}")

        # Key headers
        headers = req.get("headers", {})
        sync_term = headers.get("x-net-sync-term", "")
        print(f"  x-net-sync-term: {sync_term[:60]}..." if sync_term else "  x-net-sync-term: (missing)")
        print(f"  x-request-id: {headers.get('x-request-id', '?')}")

    # Response analysis
    if responses:
        print(f"\n{'=' * 70}")
        print("📬 RESPOSTAS DO PLACEBET")
        print("=" * 70)
        
        status_msgs = Counter()
        for resp in responses:
            body = resp.get("body", "")
            if body:
                try:
                    data = json.loads(body)
                    mi = data.get("mi", "?")
                    cs = data.get("cs", "?")
                    status_msgs[f"cs={cs}, mi={mi}"] += 1
                    print(f"\n  Status {resp.get('status')}: cs={cs}, mi=\"{mi}\"")
                    if "bt" in data and data["bt"]:
                        bt = data["bt"][0]
                        print(f"    Odd: {bt.get('od')}, Return: {bt.get('re')}, Error: {bt.get('er')}")
                        print(f"    Fixture: {bt.get('fi')}, Next GUID: {data.get('bg', '?')[:36]}")
                except json.JSONDecodeError:
                    print(f"  (body not JSON)")

        print(f"\n  Resumo de status:")
        for msg, c in status_msgs.most_common():
            print(f"    [{c:3d}x] {msg}")


def extract_tokens(entries: list[dict]):
    """Extrai todos os tokens de sessão encontrados."""
    print("\n" + "=" * 70)
    print("🔑 TOKENS DE SESSÃO")
    print("=" * 70)

    pstk_tokens = set()
    sync_terms = set()
    challenge_tokens = set()

    for e in entries:
        # From cookies
        if e.get("headers", {}).get("cookie", ""):
            cookies = e["headers"]["cookie"]
            for part in cookies.split(";"):
                part = part.strip()
                if part.startswith("pstk="):
                    pstk_tokens.add(part.split("=", 1)[1])

        # From x-net-sync-term
        sync = e.get("headers", {}).get("x-net-sync-term", "")
        if sync:
            sync_terms.add(sync[:80])

        # From PlaceBet response (next challenge)
        if e["type"] == "response" and "placebet" in e.get("url", "").lower():
            try:
                data = json.loads(e.get("body", "{}"))
                if "cc" in data:
                    challenge_tokens.add(data["cc"][:60])
            except (json.JSONDecodeError, TypeError):
                pass

        # From WS frames (S_ prefix)
        if e["type"] == "ws_sent":
            data = e.get("data", "")
            if "S_" in data:
                for part in data.split(","):
                    if part.startswith("S_"):
                        pstk_tokens.add(part[2:])

    print(f"\n  pstk tokens ({len(pstk_tokens)}):")
    for t in pstk_tokens:
        print(f"    {t}")

    print(f"\n  x-net-sync-term tokens ({len(sync_terms)}):")
    for t in sync_terms:
        print(f"    {t}...")

    print(f"\n  Challenge tokens from responses ({len(challenge_tokens)}):")
    for t in challenge_tokens:
        print(f"    {t}...")


def decode_ws_frames(entries: list[dict]):
    """Tenta decodificar frames WebSocket."""
    print("\n" + "=" * 70)
    print("📡 ANÁLISE DE FRAMES WEBSOCKET")
    print("=" * 70)

    ws_recv = [e for e in entries if e["type"] == "ws_recv"]
    ws_sent = [e for e in entries if e["type"] == "ws_sent"]

    print(f"\n  Frames enviados: {len(ws_sent)}")
    print(f"  Frames recebidos: {len(ws_recv)}")

    # Analyze sent frame patterns
    print(f"\n  --- Padrões de frames enviados ---")
    sent_patterns = Counter()
    for e in ws_sent:
        data = e.get("data", "")
        if data.startswith("#"):
            sent_patterns["# (handshake/init)"] += 1
        elif "P-ENDP" in data:
            sent_patterns["P-ENDP (endpoint config)"] += 1
        elif "P_CONFIG" in data:
            sent_patterns["P_CONFIG (config request)"] += 1
        elif "command" in data.lower():
            sent_patterns["command (getBalance etc)"] += 1
        elif "S_" in data and "A_" in data:
            sent_patterns["S_+A_ (auth subscribe)"] += 1
        elif data.startswith("\x16") or data.startswith("\x14"):
            sent_patterns["binary prefix (subscribe)"] += 1
        else:
            # Try to identify by content
            if len(data) < 50:
                sent_patterns[f"short: {data[:40]}"] += 1
            else:
                sent_patterns["other (data)"] += 1

    for pattern, c in sent_patterns.most_common():
        print(f"    [{c:3d}x] {pattern}")

    # Analyze received frame structure
    if ws_recv:
        print(f"\n  --- Estrutura de frames recebidos ---")
        recv_patterns = Counter()
        for e in ws_recv:
            data = e.get("data", "")
            if "P-ENDP" in data:
                recv_patterns["P-ENDP (endpoint config)"] += 1
            elif "contentapi" in data.lower():
                recv_patterns["contentapi (market data)"] += 1
            elif "|EV;" in data or "|MG;" in data or "|MA;" in data:
                recv_patterns["EV/MG/MA (event/market)"] += 1
            elif "balance" in data.lower():
                recv_patterns["balance"] += 1
            else:
                recv_patterns["other"] += 1

        for pattern, c in recv_patterns.most_common():
            print(f"    [{c:3d}x] {pattern}")

    # Show unique WS URLs
    print(f"\n  --- WebSocket URLs ---")
    ws_urls = set()
    for e in entries:
        if e["type"] == "ws_open":
            host = e["url"].split("/zap")[0] if "/zap" in e["url"] else e["url"][:80]
            ws_urls.add(host)
    for url in sorted(ws_urls):
        print(f"    {url}")


def main():
    args = set(sys.argv[1:])
    
    # Load main traffic file
    entries = load_entries(TRAFFIC_FILE)
    if not entries:
        return

    # Also try to load full WS log
    ws_entries = load_entries(WS_FULL_FILE) if WS_FULL_FILE.exists() else []

    if not args or "--overview" in args:
        overview(entries)

    if not args or "--placebet" in args:
        analyze_placebets(entries)

    if "--tokens" in args or not args:
        extract_tokens(entries)

    if "--ws-decode" in args or not args:
        # Use full WS log if available, otherwise main
        decode_ws_frames(ws_entries if ws_entries else entries)

    print(f"\n{'=' * 70}")
    print("✅ Análise completa")
    print(f"   Fonte: {TRAFFIC_FILE}")
    if ws_entries:
        print(f"   WS Full: {WS_FULL_FILE}")
    print(f"{'=' * 70}\n")


if __name__ == "__main__":
    main()
