"""
Test HTTP Pipeline — Valida o pipeline HTTP PlaceBet com tokens salvos.

Testa sem browser (usando tokens de data/session_tokens.json).
Útil para validar que http_client, token chain e ns_payload estão corretos.

Uso:
  python scripts/test_http_pipeline.py                         → dry-run (não envia)
  python scripts/test_http_pipeline.py --live                  → envia PlaceBet real
  python scripts/test_http_pipeline.py --parse-ns "ns=pt=N#..." → testa parser de ns
"""

from __future__ import annotations

import asyncio
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from src.api.http_client import (
    Bet365HttpClient,
    SessionTokens,
    _build_ns_payload,
)
from src.api.bet_interceptor import InterceptedBet
from src.api.token_harvester import TokenHarvester


DATA_DIR = Path(__file__).resolve().parent.parent / "data"
SESSION_FILE = DATA_DIR / "session_tokens.json"
LIVE_TOKENS_FILE = DATA_DIR / "live_tokens.json"


def load_tokens(path: Path) -> SessionTokens | None:
    """Carrega tokens de um arquivo JSON."""
    if not path.exists():
        print(f"  ❌ Arquivo não encontrado: {path}")
        return None

    data = json.loads(path.read_text(encoding="utf-8"))

    # Suporta formato do extract_tokens.py (cookies como sub-dict)
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
            last_bet_guid=data.get("last_bet_guid", ""),
            last_challenge=data.get("last_challenge", ""),
        )

    # Formato do token_harvester (flat)
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
        last_bet_guid=data.get("last_bet_guid", ""),
        last_challenge=data.get("last_challenge", ""),
    )


def test_ns_builder():
    """Testa a construção do campo ns."""
    print("\n📋 Teste: _build_ns_payload()")
    ns = _build_ns_payload(
        fixture_id="191755961",
        selection_id="901719780",
        odds="4/5",
        stake=1.00,
        handicap="+6.5",
        market_type=11,
        classification=18,
    )
    print(f"  ns = {ns}")

    # Valida campos
    assert "f=191755961" in ns, "fixture_id não encontrado"
    assert "fp=901719780" in ns, "selection_id não encontrado"
    assert "o=4/5" in ns, "odds não encontrado"
    assert "ln=+6.5" in ns, "handicap não encontrado"
    assert "st=1.00" in ns, "stake não encontrado"
    assert "tr=1.80" in ns, "return não encontrado"
    print("  ✅ Odds fracionada (4/5) — campos corretos")

    # Teste com odds decimal
    ns2 = _build_ns_payload(
        fixture_id="100000001",
        selection_id="200000002",
        odds="1.83",
        stake=10.00,
    )
    assert "o=1.83" in ns2, "odds decimal não encontrado"
    assert "st=10.00" in ns2, "stake não encontrado"
    assert "tr=18.30" in ns2, f"return decimal incorreto: {ns2}"
    print("  ✅ Odds decimal (1.83) — return 18.30 correto")

    # Teste com odds decimal alta
    ns3 = _build_ns_payload(
        fixture_id="100000001",
        selection_id="200000002",
        odds="2.50",
        stake=5.00,
    )
    assert "tr=12.50" in ns3, f"return 2.50*5 incorreto: {ns3}"
    print("  ✅ Odds decimal (2.50) — return 12.50 correto")

    # Teste sem handicap
    ns4 = _build_ns_payload(
        fixture_id="100000001",
        selection_id="200000002",
        odds="1/2",
        stake=1.00,
    )
    assert "ln=" not in ns4, "handicap não deveria estar presente"
    print("  ✅ Sem handicap — campo ln ausente")

    # Teste com handicap negativo
    ns5 = _build_ns_payload(
        fixture_id="100000001",
        selection_id="200000002",
        odds="1/1",
        stake=1.00,
        handicap="-1.5",
    )
    assert "ln=-1.5" in ns5, "handicap negativo não encontrado"
    assert "tr=2.00" in ns5, f"return 1/1 incorreto: {ns5}"
    print("  ✅ Handicap negativo (-1.5) + odds 1/1 — correto")


def test_ns_parser():
    """Testa o parser de ns interceptado (InterceptedBet)."""
    print("\n📋 Teste: InterceptedBet.from_post_data()")

    post = "&ns=pt%3DN%23o%3D4%2F5%23pv%3D4%2F5%23f%3D191755961%23fp%3D901719780%23so%3D%23c%3D18%23ln%3D%2B6.5%23mt%3D11%23%7Cat%3DY%23TP%3DBS191755961-901719780%23ust%3D1.00%23st%3D1.00%23tr%3D1.80%23%7C%7C&xb=1&aa=null&betsource=FlashInPLay&tagType=WindowsDesktopBrowser&bs=99&qb=1"
    url = "https://www.bet365.bet.br/BetsWebAPI/placebet?betGuid=b794e297-7b00-4479-920d-fac9bd8d1f76&c=hrPsrij7d30KZ9E8aVKtwSHxQ_B84lbHX&p=3664062448596345987"

    bet = InterceptedBet.from_post_data(post, url)

    print(f"  fixture_id:  {bet.fixture_id}")
    print(f"  selection_id: {bet.selection_id}")
    print(f"  odds:         {bet.odds}")
    print(f"  handicap:     {bet.handicap}")
    print(f"  stake:        {bet.stake}")
    print(f"  market_type:  {bet.market_type}")
    print(f"  classification: {bet.classification}")
    print(f"  bet_guid:     {bet.bet_guid}")
    print(f"  challenge:    {bet.challenge}")
    print(f"  page_id:      {bet.page_id}")

    assert bet.fixture_id == "191755961", f"Expected 191755961, got {bet.fixture_id}"
    assert bet.selection_id == "901719780", f"Expected 901719780, got {bet.selection_id}"
    assert bet.odds == "4/5", f"Expected 4/5, got {bet.odds}"
    assert bet.handicap == "+6.5", f"Expected +6.5, got {bet.handicap}"
    assert bet.market_type == 11
    assert bet.classification == 18
    assert bet.stake == 1.0
    assert bet.bet_guid == "b794e297-7b00-4479-920d-fac9bd8d1f76"
    assert bet.page_id == "3664062448596345987"
    print("  ✅ Parser correto — todos os campos extraídos")

    # Teste com post_data vazio
    bet2 = InterceptedBet.from_post_data("", "https://bet365.com/BetsWebAPI/placebet?betGuid=abc")
    assert bet2.bet_guid == "abc"
    assert bet2.fixture_id == ""
    print("  ✅ POST vazio — extrai query params, campos vazios")

    # Teste com odds decimal no ns
    post_dec = "&ns=pt%3DN%23o%3D1.83%23f%3D999%23fp%3D888%23c%3D18%23mt%3D11%23%7Cat%3DN%23st%3D5.00%23tr%3D9.15%23%7C%7C&xb=1"
    bet3 = InterceptedBet.from_post_data(post_dec, "")
    assert bet3.odds == "1.83", f"Expected 1.83, got {bet3.odds}"
    assert bet3.fixture_id == "999"
    assert bet3.accept_changes is False, "at=N should be False"
    print("  ✅ Odds decimal (1.83) + at=N parsed corretamente")


def test_gwt_changed_logic():
    """Testa que gwt_changed não fica sempre True após rotação."""
    print("\n📋 Teste: TokenState.gwt_changed lógica")
    from src.api.token_harvester import TokenState

    tokens = SessionTokens(
        pstk="", gwt="gwt_INICIAL", swt="", aaat="", pers="",
        aps03="", cf_bm="", x_net_sync_term="",
    )

    # Estado inicial — sem last_gwt, não deveria indicar mudança
    state = TokenState(tokens=tokens, last_gwt="")
    assert not state.gwt_changed, "Não deveria indicar mudança sem last_gwt"
    print("  ✅ Estado inicial sem last_gwt → gwt_changed=False")

    # Simula primeiro refresh — gwt igual, last_gwt setado
    state2 = TokenState(tokens=tokens, last_gwt="gwt_INICIAL")
    assert not state2.gwt_changed, "gwt igual a last_gwt → não mudou"
    print("  ✅ gwt==last_gwt → gwt_changed=False")

    # Simula rotação — gwt mudou
    tokens_novo = SessionTokens(
        pstk="", gwt="gwt_ROTACIONADO", swt="", aaat="", pers="",
        aps03="", cf_bm="", x_net_sync_term="",
    )
    state3 = TokenState(tokens=tokens_novo, last_gwt="gwt_INICIAL")
    assert state3.gwt_changed, "gwt diferente → deveria indicar mudança"
    print("  ✅ gwt!=last_gwt → gwt_changed=True")

    # Simula atualização do last_gwt após detecção (fix aplicado)
    state3.last_gwt = tokens_novo.gwt
    assert not state3.gwt_changed, "Após atualizar last_gwt, não deveria mais indicar mudança"
    print("  ✅ Após update last_gwt → gwt_changed=False (fix confirmado)")


def test_tokens_status():
    """Mostra status dos tokens salvos."""
    print("\n📋 Teste: Tokens salvos")

    # Tenta ambos os arquivos
    for name, path in [("session_tokens", SESSION_FILE), ("live_tokens", LIVE_TOKENS_FILE)]:
        if not path.exists():
            print(f"  {name}: ❌ não encontrado")
            continue

        tokens = load_tokens(path)
        if not tokens:
            continue

        print(f"\n  {name} ({path.name}):")
        print(f"    pstk:     {'✅' if tokens.pstk else '❌'} {tokens.pstk[:20]}..." if tokens.pstk else f"    pstk:     ❌")
        print(f"    gwt:      {'✅' if tokens.gwt else '❌'} {tokens.gwt[:20]}..." if tokens.gwt else f"    gwt:      ❌")
        print(f"    swt:      {'✅' if tokens.swt else '❌'} {tokens.swt[:20]}..." if tokens.swt else f"    swt:      ❌")
        print(f"    sync:     {'✅' if tokens.x_net_sync_term else '❌'} ({len(tokens.x_net_sync_term)} chars)" if tokens.x_net_sync_term else f"    sync:     ❌")
        print(f"    page_id:  {'✅' if tokens.page_id else '❌'} {tokens.page_id}" if tokens.page_id else f"    page_id:  ❌")
        print(f"    aaat:     {'✅' if tokens.aaat else '❌'}")
        print(f"    cf_bm:    {'✅' if tokens.cf_bm else '❌'}")

        # Cookie string preview
        cs = tokens.to_cookie_string()
        print(f"    cookie:   {len(cs)} chars")


async def test_live_bet(tokens: SessionTokens):
    """Envia PlaceBet real (R$1.00) com tokens salvos."""
    print("\n⚠️  Teste LIVE: PlaceBet real com tokens salvos")
    print("    Isso vai enviar um PlaceBet HTTP real para o Bet365.")

    # Fixture e selection de teste (do traffic log)
    fixture_id = "191755961"
    selection_id = "901719780"
    odds = "4/5"
    stake = 1.00
    handicap = "+6.5"

    print(f"    fixture: {fixture_id}")
    print(f"    selection: {selection_id}")
    print(f"    odds: {odds}")
    print(f"    stake: R${stake:.2f}")

    async with Bet365HttpClient(tokens) as client:
        result = await client.place_bet(
            fixture_id=fixture_id,
            selection_id=selection_id,
            odds=odds,
            stake=stake,
            handicap=handicap,
            market_type=11,
            classification=18,
        )

    print(f"\n  Resultado:")
    print(f"    success:    {result.success}")
    print(f"    cs:         {result.completion_status}")
    print(f"    mi:         {result.message_id}")
    print(f"    geo_blocked: {result.is_geo_blocked}")
    print(f"    odds:       {result.odds}")
    print(f"    return:     {result.return_value}")
    print(f"    next_guid:  {result.next_bet_guid[:30]}..." if result.next_bet_guid else "    next_guid:  (vazio)")
    print(f"    next_cc:    {result.next_challenge[:30]}..." if result.next_challenge else "    next_cc:    (vazio)")

    if result.is_geo_blocked:
        print("\n  ⚠️ Geo blocked — tokens salvos não têm gwt válido.")
        print("     Isso é ESPERADO sem browser ativo para GeoComply.")
        print("     O BetInterceptor resolve isso usando tokens frescos do browser.")


def main():
    print("=" * 60)
    print("  🧪 Test HTTP Pipeline — Validação Bet365 API")
    print("=" * 60)

    # 1. Testa builder de ns payload
    test_ns_builder()

    # 2. Testa parser de ns interceptado
    test_ns_parser()

    # 3. Testa lógica gwt_changed (bug fix)
    test_gwt_changed_logic()

    # 4. Mostra status de tokens
    test_tokens_status()

    # 4. Live bet (só com --live)
    if "--live" in sys.argv:
        tokens = load_tokens(LIVE_TOKENS_FILE) or load_tokens(SESSION_FILE)
        if tokens:
            asyncio.run(test_live_bet(tokens))
        else:
            print("\n❌ Nenhum token disponível para teste live")
    else:
        print("\n💡 Para testar PlaceBet real: python scripts/test_http_pipeline.py --live")

    # 5. Parse ns customizado
    if "--parse-ns" in sys.argv:
        idx = sys.argv.index("--parse-ns")
        raw = sys.argv[idx + 1] if idx + 1 < len(sys.argv) else ""
        if raw:
            print(f"\n📋 Parse ns customizado:")
            bet = InterceptedBet.from_post_data(raw, "")
            print(f"  fixture:  {bet.fixture_id}")
            print(f"  selection: {bet.selection_id}")
            print(f"  odds:     {bet.odds}")
            print(f"  handicap: {bet.handicap}")
            print(f"  mt:       {bet.market_type}")
            print(f"  c:        {bet.classification}")

    print("\n✅ Pipeline test completo.")


if __name__ == "__main__":
    main()
