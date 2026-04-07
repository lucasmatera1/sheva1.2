"""
Parser do protocolo WebSocket proprietário Bet365.

O protocolo usa formato delimitado (NÃO JSON):
  - `|` separa entidades
  - `;` separa campos key=value
  - `=` key-value pair
  - `,` lista de valores
  - `~` sub-categorias
  - `^` flags/modificadores

Tipos de mensagem:
  - EV: Event
  - MG: Market Group
  - MA: Market Assignment
  - PA: Participant
  - OD: Odds

Uso:
    from src.api.ws_parser import Bet365WsParser
    parser = Bet365WsParser()
    parsed = parser.parse_frame(raw_data)
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field


@dataclass
class WsEntity:
    """Uma entidade parseada de um frame WS."""
    type: str  # EV, MG, MA, PA, etc.
    fields: dict[str, str] = field(default_factory=dict)

    def get(self, key: str, default: str = "") -> str:
        return self.fields.get(key, default)

    def __repr__(self) -> str:
        return f"WsEntity({self.type}, {self.fields})"


@dataclass
class WsMessage:
    """Mensagem WS parseada contendo múltiplas entidades."""
    raw: str
    entities: list[WsEntity] = field(default_factory=list)
    msg_type: str = ""  # handshake, subscribe, config, data, command

    @property
    def is_config(self) -> bool:
        return self.msg_type == "config"

    @property
    def is_data(self) -> bool:
        return self.msg_type == "data"


# Campos conhecidos do protocolo
FIELD_NAMES = {
    "ID": "id",
    "IT": "item_type",
    "NA": "api_name",
    "OT": "order_type",
    "AD": "additional_data",
    "ED": "event_data",
    "EX": "exchange",
    "FI": "fixture_id",
    "FF": "fixture_full",
    "PA": "participant",
    "OD": "odds",
    "HA": "handicap",
    "SU": "suspended",
    "OR": "order",
    "SS": "status",
    "TM": "time",
    "SC": "score",
    "CL": "classification",
    "CT": "competition_type",
    "CP": "competition",
    "TT": "template_type",
    "MG": "market_group",
    "MA": "market",
    "EV": "event",
    "BC": "bet_count",
    "HO": "home",
    "AW": "away",
}

# Item types conhecidos
ITEM_TYPES = {
    "mmnsp": "match_markets_partial",
    "mmls": "match_markets_lists",
    "mmbm": "match_markets_betbuilder",
    "oob": "odds_on_coupon",
    "ooh": "odds_on_header",
    "rsa": "racing_splash_antepost",
    "tt": "tennis_tab",
    "tp": "tennis_partial",
    "pp": "player_parlay",
    "scpd": "change_player",
    "vscm": "virtual_sports_change_market",
}


class Bet365WsParser:
    """Parser para frames WebSocket do Bet365."""

    # Regex para detectar controle chars no início de frames
    _ctrl_prefix = re.compile(r'^[\x00-\x1f]+')
    # Regex para session token
    _session_re = re.compile(r'S_([A-F0-9]+)')
    # Regex para auth token
    _auth_re = re.compile(r'A_([A-Za-z0-9+/=]+)')

    def parse_frame(self, raw: str) -> WsMessage:
        """Parse um frame WS raw em WsMessage."""
        msg = WsMessage(raw=raw)

        # Limpa prefixo de controle
        cleaned = self._ctrl_prefix.sub('', raw)

        # Classifica tipo de mensagem
        msg.msg_type = self._classify(cleaned, raw)

        # Parse entidades se houver pipes
        if '|' in cleaned:
            msg.entities = self._parse_entities(cleaned)
        elif ';' in cleaned:
            # Pode ser uma entidade única
            entity = self._parse_single_entity(cleaned)
            if entity:
                msg.entities = [entity]

        return msg

    def _classify(self, cleaned: str, raw: str) -> str:
        """Classifica o tipo da mensagem."""
        if raw.startswith('#') or raw.startswith('\x03'):
            return "handshake"
        if 'P-ENDP' in cleaned and 'P_CONFIG' in cleaned:
            return "subscribe"
        if 'P-ENDP' in cleaned and '|' in cleaned:
            return "config"
        if cleaned.startswith('command'):
            return "command"
        if any(prefix in cleaned[:20] for prefix in ['BS', 'MBS', 'OV', 'Media_', 'InPlay_']):
            return "subscribe"
        if 'S_' in cleaned and 'A_' not in cleaned:
            return "session_init"
        if 'S_' in cleaned and 'A_' in cleaned:
            return "auth_subscribe"
        if '|EV;' in cleaned or '|MG;' in cleaned or '|MA;' in cleaned:
            return "data"
        if 'F|' in cleaned:
            return "data"
        return "unknown"

    def _parse_entities(self, data: str) -> list[WsEntity]:
        """Parse string com pipes em lista de entidades."""
        entities = []
        # Remove 'F' flag no início (ex: "P-ENDPF|EV;..." → entities após F|)
        if 'F|' in data:
            data = data.split('F|', 1)[1]

        parts = data.split('|')
        for part in parts:
            part = part.strip()
            if not part:
                continue
            entity = self._parse_single_entity(part)
            if entity:
                entities.append(entity)
        return entities

    def _parse_single_entity(self, part: str) -> WsEntity | None:
        """Parse uma entidade individual (campos separados por `;`)."""
        if not part or ';' not in part:
            # Pode ser só um tipo sem campos
            if len(part) <= 4 and part.isalpha():
                return WsEntity(type=part)
            return None

        fields = {}
        entity_type = ""

        segments = part.split(';')
        for seg in segments:
            seg = seg.strip()
            if not seg:
                continue
            if '=' in seg:
                key, value = seg.split('=', 1)
                fields[key] = value
            elif not entity_type:
                # Primeiro segmento sem = é o tipo
                entity_type = seg

        return WsEntity(type=entity_type, fields=fields)

    def extract_session_token(self, data: str) -> str | None:
        """Extrai S_ session token de um frame."""
        m = self._session_re.search(data)
        return m.group(1) if m else None

    def extract_auth_token(self, data: str) -> str | None:
        """Extrai A_ auth token de um frame."""
        m = self._auth_re.search(data)
        return m.group(1) if m else None

    def extract_subscriptions(self, data: str) -> list[str]:
        """Extrai IDs de subscription (BS..., MBS..., OV..., etc.) de um frame."""
        subs = []
        parts = data.split(',')
        for part in parts:
            part = part.strip()
            if re.match(r'^(BS|MBS|OV|InPlay_|Media_|OVM)\d', part):
                subs.append(part)
        return subs

    def extract_command(self, data: str) -> tuple[str, str, str] | None:
        """Extrai comando de frame (ex: commandgetBalanceSPTBK)."""
        if 'command' not in data.lower():
            return None
        # Formato: "command<cmd><session_token><product>"
        m = re.match(r'command(\w+?)([A-F0-9]{30,})(\w+)$', data)
        if m:
            return m.group(1), m.group(2), m.group(3)
        return None

    def extract_endpoints(self, msg: WsMessage) -> list[dict]:
        """Extrai endpoints de uma mensagem de config."""
        endpoints = []
        for entity in msg.entities:
            if entity.type == "MA" and entity.get("NA"):
                endpoints.append({
                    "api_path": entity.get("NA"),
                    "item_type": entity.get("IT"),
                    "item_type_name": ITEM_TYPES.get(entity.get("IT"), "unknown"),
                    "order_type": entity.get("OT"),
                    "exchange": entity.get("EX"),
                    "event_data": entity.get("ED"),
                })
        return endpoints

    def parse_odds_update(self, data: str) -> list[dict]:
        """Parse odds updates de frames WS (snapshots e updates incrementais).

        Formatos detectados:
          Snapshot: |PA;FI=191751841;ID=901210606;OD=1/1;HA=+1.5;...
          Update:   OVM175P{fixture}-{selection}U|OD=5/6;HA=116.5;
                    L{fixture}-{selection}_33_0U|OD=9/4;
        """
        updates = []

        # 1. Parse updates incrementais (formato topic-based)
        # Padrão: OVM175P{fixture}-{selection}U|fields; ou L{fixture}-{selection}_33_0U|fields;
        for m in re.finditer(
            r'(?:OVM?\d*P|L|OVES)(\d+)-(\d+)[^|]*\|([^;]+(?:;[^;|]+)*);?',
            data,
        ):
            fixture_id = m.group(1)
            selection_id = m.group(2)
            fields_str = m.group(3)

            fields = {}
            for pair in fields_str.split(';'):
                pair = pair.strip()
                if '=' in pair:
                    k, v = pair.split('=', 1)
                    fields[k] = v

            if fields.get("OD"):
                updates.append({
                    "fixture_id": fixture_id,
                    "selection_id": selection_id,
                    "odds": fields.get("OD", ""),
                    "handicap": fields.get("HA", ""),
                    "handicap_display": fields.get("HD", ""),
                    "name": fields.get("NA", ""),
                    "suspended": fields.get("SU", "") == "1",
                    "source": "update",
                })

        # 2. Parse de entidades padrão (|PA;...) — só se tiver FI e ID
        msg = self.parse_frame(data)
        for entity in msg.entities:
            if entity.get("OD") and entity.get("FI") and entity.get("ID"):
                updates.append({
                    "fixture_id": entity.get("FI", ""),
                    "selection_id": entity.get("ID", ""),
                    "odds": entity.get("OD"),
                    "handicap": entity.get("HA", ""),
                    "handicap_display": entity.get("HD", ""),
                    "name": entity.get("NA", ""),
                    "suspended": entity.get("SU", "") == "1",
                    "source": "snapshot",
                })

        return updates


def analyze_traffic_ws(filepath: str):
    """Analisa arquivo JSONL de tráfego WS com o parser."""
    import json
    from pathlib import Path
    from collections import Counter

    parser = Bet365WsParser()
    msg_types = Counter()
    endpoints_found = []
    commands_found = []
    subscriptions = []

    path = Path(filepath)
    if not path.exists():
        print(f"❌ Arquivo não encontrado: {filepath}")
        return

    with open(path, "r", encoding="utf-8") as f:
        for line in f:
            entry = json.loads(line.strip())
            data = entry.get("data", "")
            if not data:
                continue

            msg = parser.parse_frame(data)
            msg_types[msg.msg_type] += 1

            # Extract endpoints from config messages
            if msg.msg_type == "config":
                eps = parser.extract_endpoints(msg)
                endpoints_found.extend(eps)

            # Extract commands
            cmd = parser.extract_command(data)
            if cmd:
                commands_found.append(cmd)

            # Extract subscriptions
            subs = parser.extract_subscriptions(data)
            subscriptions.extend(subs)

    print("=" * 60)
    print("📡 ANÁLISE WS COM PARSER")
    print("=" * 60)

    print(f"\nTipos de mensagem:")
    for t, c in msg_types.most_common():
        print(f"  {t:20s} → {c}")

    print(f"\nEndpoints encontrados ({len(endpoints_found)}):")
    seen = set()
    for ep in endpoints_found:
        key = ep["api_path"]
        if key not in seen:
            seen.add(key)
            print(f"  {ep['api_path']:45s} | {ep['item_type']:6s} | {ep['item_type_name']}")

    print(f"\nComandos encontrados ({len(commands_found)}):")
    cmd_counter = Counter(c[0] for c in commands_found)
    for cmd, count in cmd_counter.most_common():
        print(f"  {cmd:20s} → {count}x")

    print(f"\nSubscriptions ({len(subscriptions)}):")
    sub_types = Counter()
    for s in subscriptions:
        prefix = re.match(r'^[A-Za-z_]+', s)
        if prefix:
            sub_types[prefix.group()] += 1
    for st, count in sub_types.most_common():
        print(f"  {st:20s} → {count}x")


if __name__ == "__main__":
    import sys
    from pathlib import Path
    filepath = sys.argv[1] if len(sys.argv) > 1 else str(
        Path(__file__).resolve().parent.parent.parent / "logs" / "bet365_api_traffic.jsonl"
    )
    analyze_traffic_ws(filepath)
