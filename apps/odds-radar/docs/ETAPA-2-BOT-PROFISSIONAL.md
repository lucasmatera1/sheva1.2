# 🚀 Etapa 2 — Bot Profissional (API Reversa Bet365)

> Última atualização: 2026-03-24 (sessão 4d — **addbet endpoint DESCOBERTO, fluxo completo mapeado**)

## Contexto

O bot Etapa 1 opera via **Playwright + DOM scraping** (Camoufox). Funciona (~3s/aposta), mas é frágil (quebra quando Bet365 muda classes CSS) e não escala (1 browser = 1 aposta por vez).

Bots profissionais como **Tippy.bet** e **JBot (Jarvis Bot)** operam via **engenharia reversa da API interna do Bet365**, sem browser, com apostas em <500ms.

## Objetivo

Migrar o bot de DOM scraping para **API direta** via abordagem **híbrida** (browser mantém sessão geo + HTTP faz apostas).

> **Decisão arquitetural:** Browser NÃO pode ser eliminado por completo — GeoComply requer validação browser-side que gera os tokens `gwt`/`swt`. A abordagem é manter o browser rodando em background apenas para geo, enquanto apostas vão por HTTP direto.

---

## Comparação: Etapa 1 vs. Etapa 2

| Aspecto | Etapa 1 (DOM) | Etapa 2 (Híbrido) |
|---|---|---|
| **Método** | Playwright + DOM scraping | Browser geo + HTTP POST direto |
| **Velocidade** | ~3s por aposta | Target <500ms por aposta |
| **Browser** | Camoufox (renderiza DOM completo) | Camoufox (apenas sessão geo, sem interação DOM) |
| **Fragilidade** | Alto (classes CSS mudam) | Baixo (API é mais estável, fallback DOM) |
| **Odds** | Scrape DOM | WebSocket feed real-time |
| **Recursos** | ~500MB RAM (browser ativo) | ~500MB RAM (browser ocioso) + ~50MB (HTTP client) |

---

## Fases de Implementação

### Fase 1 — Captura e Análise de Tráfego ✅ COMPLETA

**Entregável:** `docs/PROTOCOLO-BET365-API.md` (600+ linhas)

**O que foi feito:**
- ✅ Interceptação de HTTP + WebSocket em `bet_telegram.py` (requests, responses, WS frames)
- ✅ 610 entries capturadas em `logs/bet365_api_traffic.jsonl` (~1MB)
- ✅ 16 PlaceBet POSTs capturados com headers + payload + response completos
- ✅ Endpoint mapeado: `POST /BetsWebAPI/placebet?betGuid=<UUID>&c=<challenge>&p=<pageId>`
- ✅ POST body decodificado: `ns=pt=N#o=<odd>#f=<fixtureId>#fp=<selectionId>#c=<class>#ln=<hcap>#mt=<mktType>`
- ✅ Respostas são **JSON** (não semicolon-delimited como assumido inicialmente)
- ✅ Token chain mapeado: response `bg` → próximo `betGuid`, `cc` → próximo `c` param
- ✅ Tokens obrigatórios: `pstk`, `x-net-sync-term`, `gwt`, `swt`, `aaat`, `__cf_bm`
- ✅ 2 WebSockets mapeados: `premws-*.365lpodds.com/zap/` (odds) + `pshudws.365lpodds.com/zap/` (commands)
- ✅ Protocolo WS decodificado: formato proprietário pipe-delimited, 87+ endpoints
- ✅ Token extractor criado e testado: 15 cookies, x-net-sync-term, pstk, page_id → `data/session_tokens.json`

**Scripts de análise:**
- `scripts/analyze_traffic.py` — flags: `--placebet`, `--ws-decode`, `--tokens`, `--overview`
- `scripts/extract_tokens.py` — extrai tokens do traffic log → JSON

### Fase 1.5 — Investigação GeoComply ✅ COMPLETA

**Achado crítico:** O cookie `gwt` (General Web Token) incorpora validação geo server-side.

| Bets | gwt (início) | Resultado |
|------|-------------|-----------|
| #1-10 | `AazBm...` (antigo) | ❌ 10/10 BLOCKED (cs=2, mi="geo_services_blocked") |
| #11-12 | `AfScQ...` (rotacionado) | ✅ 2/3 OK (cs=3) |
| #13 | `AfScQ...` | ❌ 1/3 BLOCKED |
| #14 | `AR2+r...` (novo) | ✅ OK |
| #15 | `AaXpo...` (novo) | ✅ OK |
| #16 | `AWKvu...` (novo) | ❌ BLOCKED (expirado?) |

**Conclusões:**
- GeoComply JS roda no browser e valida localização → gera novos `gwt`/`swt`
- Tokens geo expiram (as primeiras 10 bets com gwt antigo falharam todas)
- Após rotation automática no browser → apostas começaram a passar
- `swt` rotaciona em paralelo (7 valores únicos nos 16 bets)
- Zero URLs GeoComply no tráfego (route interception bloqueia)
- **Decisão:** Browser é NECESSÁRIO para geo → abordagem HÍBRIDA

### Fase 2 — Replay de Requests ✅ IMPLEMENTADA + CORRIGIDA

**Entregável:** Módulos Python para aposta HTTP e streaming WS

**O que foi implementado:**
- ✅ **Cliente HTTP** (`src/api/http_client.py`) — `Bet365HttpClient` com httpx async
  - Monta request idêntico ao browser (headers, cookies, ns payload)
  - Token chain automático (`bg` → `betGuid`, `cc` → `c`)
  - `SessionTokens` dataclass com todos tokens de sessão
  - `BetResult` com cs, mi, odd, fixture, etc.
  - ⚠️ **Não mais usado no interceptor** — httpx retorna 403 (TLS fingerprint). Mantido para uso futuro com curl_cffi/tls-client.
- ✅ **Parser WS** (`src/api/ws_parser.py`) — `Bet365WsParser` com 87+ endpoints
  - Decodifica formato proprietário (pipe, semicolon, tilde delimiters)
  - Classifica mensagens por tipo (odds, config, auth, heartbeat)
  - **`parse_odds_update()`** — decodifica snapshots E updates incrementais
  - Testado: 172 odds updates decodificados de fixture real (191756081)
- ✅ **Cliente WebSocket** (`src/api/ws_client.py`) — `Bet365WsClient`
  - Conexão odds (`premws-*`) e commands (`pshudws`)
  - Headers com cookies de sessão
  - Subscribe/unsubscribe fixtures
  - Async generator `odds_stream()` para streaming
  - Testado: retorna 403 sem cookies válidos (esperado)
- ✅ **Token Harvester** (`src/api/token_harvester.py`) — `TokenHarvester`
  - Extrai tokens frescos do browser Camoufox ao vivo
  - Auto-refresh a cada 120s (gwt/swt rotation)
  - Salva em `data/live_tokens.json`
  - Detecta idade de tokens e força refresh quando stale
- ✅ **Interceptor WS corrigido** em `bet_telegram.py`
  - Bug: `payload` é `dict {"payload": str|bytes}`, `str(payload)` dava vazio
  - Fix: `payload.get("payload", "")` + bytes decode

### Fase 3 — Integração Híbrida ✅ IMPLEMENTADA + TESTADA LIVE

**Entregável:** `src/api/bet_interceptor.py` + integração no `bet_telegram.py` e `bet_hybrid.py`

**Teste Live (2026-03-23 15:25-15:33):**

| Evento | Resultado |
|---|---|
| Browser abriu, cookies carregados | ✅ Login via cookies OK |
| GeoComply stealth injetado | ✅ lat=-23.4210 lon=-51.9331 |
| Warm-up (In-Play, odd, stake, Lembrar) | ✅ Completado |
| Browser movido offscreen | ✅ |
| TokenHarvester refresh automático | ✅ gwt=AXEj50Cme/H9..., refresh a cada 120s |
| BetInterceptor instalado | ✅ interceptando `**/BetsWebAPI/placebet**` |
| SafetyGuard check no startup | ✅ odd 1.74 in range 1.30-5.00 |
| **Sinal real recebido** (HC Jackal +15.5 @1.74) | ✅ msg_id=361 |
| Safety check antes da aposta | ✅ Permitido |
| Overview bet — odd encontrada no DOM | ✅ 15.51 (+15.5 @1.74) |
| "Fazer Aposta" clicado | ✅ (0.5s) |
| **BetInterceptor interceptou PlaceBet** | ✅ `f=191756081 fp=901735859 o=20/27 s=1.0 ln=+15.5` |
| ~~HTTP httpx PlaceBet~~ | ❌ **403 (416ms) — TLS fingerprint** |
| ~~DOM fallback~~ | ❌ "Infelizmente, um erro ocorreu" (jogo acabando Q4 03:23) |
| Bot retornou ao modo listening | ✅ |

**Análise do 403:**
- O browser (via `route.continue_()` após falha httpx) recebeu **200** com `cs:2, sr:-1` (aposta processada mas rejeitada — odds mudaram)
- O httpx recebeu **403** — Cloudflare detecta JA3/JA4 de Python como não-browser
- O header `x-net-sync-term` estava presente e válido (1500+ chars capturado dos headers do browser)
- **Root cause confirmado: TLS fingerprint** — httpx usa stack TLS Python, Bet365/Cloudflare exige fingerprint de browser real

**Fix aplicado:** Substituiu httpx por `route.fetch()` do Playwright, que usa o network stack do browser (mesma TLS fingerprint, mesmos cookies, mesma conexão). Elimina o 403 e mantém controle programático sobre a resposta.

**WS Data Capturado (sessão live):**
- 876 frames em `logs/bet365_ws_full.jsonl` (2.1MB)
- 797 frames com dados de odds (OD=, PA=, NA=)
- 172 atualizações de odds para fixture 191756081 (nosso jogo)
- premws-pt3: 737 frames, premws-pt1: 34, premws-pt2: 59, pshudws: 11
- 188 fixtures únicos com odds rastreados

**Arquitetura:**
```
                    ┌─────────────────┐
                    │  Browser Camoufox│
                    │  (Sessão + Geo)  │
                    └────────┬────────┘
                             │ Tokens (120s refresh)
                    ┌────────▼────────┐
                    │ Token Harvester  │
                    │ gwt/swt/pstk/... │
                    └────────┬────────┘
                             │
              ┌──────────────┼──────────────┐
              │              │              │
     ┌────────▼───────┐ ┌───▼──────┐ ┌─────▼───────┐
     │ BetInterceptor │ │WS Client │ │ DOM Fallback │
     │ (PlaceBet HTTP)│ │Odds Feed │ │ (~3s, seguro)│
     └────────────────┘ └──────────┘ └─────────────┘
```

**Fluxo do BetInterceptor (⭐ componente principal):**
1. Fluxo DOM normal roda: navegação → click odd → fill stake → "Fazer Aposta"
2. Quando o JS do Bet365 gera o PlaceBet POST:
   a. Interceptor captura: extrai `fixture_id`, `selection_id`, `odds` do campo `ns`
   b. Loga `x-net-sync-term` dos headers originais (1500+ chars, validação geo)
   c. Usa `route.fetch()` para enviar via network stack do browser (TLS fingerprint correto)
   d. Parseia resposta: `cs=3` → aceita, `cs=2` → rejeitada, HTTP ≠200 → erro
   e. Captura `bg`/`cc` encadeados para futuras apostas (betGuid chain)
   f. `route.fulfill(response=response)` devolve resposta ao browser (JS trata normalmente)
   g. Em caso de exceção: `route.continue_()` (DOM processa o fallback)
3. **Transparente**: nenhuma mudança no `fast_bet()` — tudo funciona via route intercept

> **Nota:** Versão anterior usava httpx para HTTP direto (mais rápido em teoria), mas
> Cloudflare bloqueia com 403 por TLS fingerprint (JA3/JA4 de Python ≠ Firefox).
> `route.fetch()` resolve usando o network stack do Camoufox.

**Integração ativa em:**
- `scripts/bet_telegram.py` — interceptor instalado automaticamente após login
- `scripts/bet_hybrid.py` — modo `auto` usa interceptor, modos `http`/`dom` manuais

**Comandos interativos (bet_hybrid.py):**
- `auto <URL> [odd]` — DOM flow + HTTP interceptor (⭐ recomendado)
- `http <fixture> <selection> <odds> [stake]` — HTTP manual (precisa IDs)
- `dom <URL> [odd]` — DOM puro (fallback)
- `tokens` / `refresh` / `stats` / `stake <val>` / `quit`
- `quit` — encerra

### Fase 4 — Bug Fixes e Hardening ✅ COMPLETA

**Auditoria de código completa** — bugs identificados e corrigidos em todos os módulos Etapa 2.

#### Bug Fixes Aplicados

| Severidade | Arquivo | Bug | Fix |
|---|---|---|---|
| 🔴 **CRÍTICO** | `token_harvester.py` | `gwt_changed` sempre retornava `True` após primeiro refresh — `last_gwt` nunca era atualizado após detectar rotação | Adicionado `self._state.last_gwt = tokens.gwt` após log de rotação |
| 🔴 **CRÍTICO** | `http_client.py` | `_build_ns_payload()` crashava com odds decimais (ex: "1.83") — `int("1.83")` → `ValueError` | Adicionado try/except para odds fracionada; fallback `float(odds)` para decimal |
| 🟡 **ALTO** | `bet_interceptor.py` | `wait_for_result()` timeout de 15s muito curto — resultado podia chegar após timeout (race condition) | Aumentado para 30s; check adicional `is_set()` + log de warning |
| 🟡 **ALTO** | `ws_client.py` | `_generate_uid()` usava `random.random()` — não crypto-safe, pouco entrópico | Substituído por `secrets.randbelow(10**16)` |

#### Testes Expandidos (`test_http_pipeline.py`)

| Teste | Antes | Depois |
|---|---|---|
| `test_ns_builder` — odds fracionada (4/5) | ✅ | ✅ |
| `test_ns_builder` — odds decimal (1.83) | ❌ | ✅ |
| `test_ns_builder` — odds decimal (2.50) | ❌ | ✅ |
| `test_ns_builder` — sem handicap | ❌ | ✅ |
| `test_ns_builder` — handicap negativo (-1.5) | ❌ | ✅ |
| `test_ns_parser` — POST completo URL-encoded | ✅ | ✅ |
| `test_ns_parser` — POST vazio (query params only) | ❌ | ✅ |
| `test_ns_parser` — odds decimal + `at=N` | ❌ | ✅ |
| `test_gwt_changed_logic` — estado inicial | ❌ | ✅ |
| `test_gwt_changed_logic` — gwt igual | ❌ | ✅ |
| `test_gwt_changed_logic` — gwt rotacionado | ❌ | ✅ |
| `test_gwt_changed_logic` — após update last_gwt | ❌ | ✅ |

**Resultado:** 16 assertions passando (era 7 antes).

#### Problemas Conhecidos (não-bloqueantes)

| Severidade | Arquivo | Problema | Status |
|---|---|---|---|
| 🟢 Médio | `ws_parser.py` | Regex de session/auth extraction frágil (sem âncoras) | Monitorar |
| 🟢 Médio | `ws_client.py` | `extract_tokens_from_browser()` busca `window.__wsConnections` inexistente | Não usado — TokenHarvester substitui |
| 🟢 Médio | `bet_telegram.py` | Windows-only (`ctypes.windll.user32.EnumWindows`) | Aceitável — deploy é Windows |
| 🟢 Baixo | `bet_hybrid.py` | Stats não persistem entre restarts | Aceitável |
| 🟢 Baixo | `http_client.py` | Cookies `session=lgs=1`, `rmbs=3` hardcoded | Monitorar se Bet365 muda |

### Fase 5 — Safety, Unidades e Perfil Passivo ✅ COMPLETA

**Entregável:** `src/betting/safety.py` + `scripts/bet_passive.py` + integração no `bet_telegram.py`

Inspirado nos recursos de segurança do **Tippy.bet** (Passive Profiles, Safety features, Unit system).

#### SafetyGuard (`src/betting/safety.py`)

Módulo centralizado de controle de risco:

| Feature | Descrição | Config (.env) |
|---|---|---|
| **Stop-Loss** | Pausa apostas se perda diária ≥ limite | `AUTOBET_MAX_DAILY_LOSS=100.00` |
| **Max Stake** | Ajusta stake automaticamente ao teto | `AUTOBET_MAX_STAKE=50.00` |
| **Rate Limit** | Bloqueia se apostas/hora ≥ limite | `AUTOBET_MAX_BETS_PER_HOUR=5` |
| **Odd Range** | Rejeita odds fora do range configurado | `AUTOBET_ODD_MIN=1.30`, `AUTOBET_ODD_MAX=5.00` |
| **Pause/Resume** | Pausa manual ou automática (stop-loss) | API: `guard.pause()` / `guard.resume()` |
| **P&L Tracking** | Registra P&L diário, reseta a cada novo dia | API: `guard.record_result(profit)` |

#### Sistema de Unidades (µ) — `UnitSystem`

Gerenciamento de banca baseado em unidades (como Tippy.bet):

```python
units = UnitSystem(bankroll=1000.0, total_units=100)
units.unit_value     # → 10.0 (1µ = R$10)
units.units_to_brl(2.5)  # → R$25.00
units.brl_to_units(50)   # → 5.0µ
guard.calculate_stake(1.0)  # → R$10.00 (capped at max_stake)
```

#### Integração no `bet_telegram.py`

- ✅ Import `SafetyGuard` e `RejectReason` adicionados
- ✅ `get_safety()` singleton inicializado no startup
- ✅ `safety.check(stake, odd)` executado **antes de cada aposta**
- ✅ Stake ajustado automaticamente se acima do max
- ✅ `safety.record_result(-stake)` registra perda provisória após aposta aceita
- ✅ Status summary exibido no startup (`safety.status_summary()`)

#### Perfil Passivo — `scripts/bet_passive.py`

Apostas aleatórias para manter conta Bet365 ativa (**desbug**), inspirado nos "Perfis Passivos" do Tippy.bet:

```bash
python scripts/bet_passive.py                       # 1 aposta aleatória
python scripts/bet_passive.py --count 3             # 3 apostas
python scripts/bet_passive.py --dry-run             # simula sem apostar
python scripts/bet_passive.py --interval 3600       # espera 1h entre apostas
```

| Config | Default | Descrição |
|---|---|---|
| `--stake` / `PASSIVE_STAKE` | R$1.00 | Valor por aposta |
| `--odd-min` / `PASSIVE_ODD_MIN` | 1.50 | Odd mínima |
| `--odd-max` / `PASSIVE_ODD_MAX` | 3.00 | Odd máxima |
| `--count` / `PASSIVE_COUNT` | 1 | Apostas por execução |
| `--interval` | 0 | Segundos entre apostas |
| `--dry-run` | false | Simula sem apostar |

**Funcionamento:** Login Camoufox → navega para URL aleatória (eSoccer/eBasket) → scroll humanizado → seleciona odd aleatória no range → preenche stake → confirma aposta → fecha betslip.

#### Testes (`scripts/test_safety.py`)

| Teste | Assertions |
|---|---|
| `test_unit_system` | 7 (conversão µ↔R$, edge cases) |
| `test_safety_check_ok` | 3 (aposta normal permitida) |
| `test_safety_max_stake` | 2 (stake ajustado ao teto) |
| `test_safety_odd_range` | 6 (odds fora do range bloqueadas) |
| `test_safety_stop_loss` | 4 (bloqueio após perda diária) |
| `test_safety_pause_resume` | 5 (pausa manual/automática) |
| `test_safety_rate_limit` | 2 (mock BetLogger, limite hora) |
| `test_safety_disabled` | 2 (AutoBet off bloqueia tudo) |
| `test_calculate_stake` | 3 (µ→R$ com cap) |
| `test_status_summary` | 2 (string formatada) |
| **Total** | **36 assertions ✅** |

#### WS Test (`scripts/test_ws_client.py`)

Teste standalone do WS client — confirmou que **todos os 4 hosts retornam HTTP 403** sem cookies válidos do browser:
- `premws-pt1.365lpodds.com` → 403
- `premws-pt2.365lpodds.com` → 403
- `premws-pt3.365lpodds.com` → 403
- `pshudws.365lpodds.com` → 403

**Conclusão:** WS streaming só funciona durante execução do bot com browser ativo (cookies de sessão frescos).

---

### Fase 6 — API-Only (curl_cffi + Browser Fetch) 🔄 EM ANDAMENTO

> **Pivô Session 4 (2026-03-24):** Todas as abordagens DOM falharam (route.fetch 403, route.continue app error). Usuário propôs eliminar TODA automação DOM: "e se eu fizer as ações manuais apenas pra você pegar os códigos?" → Nasceu a abordagem API-only.

**Problema resolvido:** curl_cffi com `impersonate="firefox135"` passa Cloudflare (HTTP 200 ✅), enquanto httpx (403) e route.fetch (app-level error) falhavam.

> **Evolução Session 4b-4c (2026-03-24): gwt Token RESOLVIDO** — Anteriormente se acreditava que gwt NUNCA aparecia no Camoufox. **Descoberta:** gwt APARECE se NÃO houver `page.route()` handlers instalados antes da navegação In-Play. Route handlers do TokenHarvester interferiam no mecanismo de geração do gwt pelo GeoComply JS. Solução: navegar para In-Play SEM route handlers → gwt aparece em ~5-10s → DEPOIS instalar listeners.

**Entregáveis:**
- ✅ `scripts/capture_tokens.py` — captura tokens via login manual
- ✅ `scripts/bot_api.py` — ⭐ bot completo API-only (Telegram → WS → PlaceBet)
- ✅ `src/api/http_client.py` — reescrito com curl_cffi
- ✅ `src/api/bet_interceptor.py` — reescrito para modo curl_cffi
- ✅ `src/api/token_harvester.py` — sync_term listener passivo adicionado

**Arquitetura API-Only:**
```
┌──────────────────────┐
│  capture_tokens.py   │  Camoufox (login manual)
│  User faz login →    │  → cookies + sync_term + page_id
│  → live_tokens.json  │  → session_tokens.json
└──────────┬───────────┘
           │ tokens
┌──────────▼───────────┐
│     bot_api.py       │  Zero browser, zero DOM
│  ┌─────────────────┐ │
│  │ Content API     │ │  curl_cffi → lista fixtures eSports ao vivo
│  │ (curl_cffi)     │ │
│  └────────┬────────┘ │
│  ┌────────▼────────┐ │
│  │ WebSocket Feed  │ │  Odds streaming → FixtureMap
│  │ (websockets)    │ │  player → (fixture_id, selection_id, odds, hc)
│  └────────┬────────┘ │
│  ┌────────▼────────┐ │
│  │ Telegram Listen │ │  telethon → parse signal (HC/U/O)
│  │ (telethon)      │ │
│  └────────┬────────┘ │
│  ┌────────▼────────┐ │
│  │ Resolve Signal  │ │  player_name → FixtureMap → Selection
│  └────────┬────────┘ │
│  ┌────────▼────────┐ │
│  │ PlaceBet        │ │  curl_cffi impersonate="firefox135"
│  │ (curl_cffi)     │ │  → BetResult (cs=3 aceita)
│  └─────────────────┘ │
└──────────────────────┘
```

**Componentes do bot_api.py:**

| Componente | Descrição |
|---|---|
| `Selection` | Dataclass: fixture_id, selection_id, name, odds (frac), odds_decimal, handicap |
| `FixtureMap` | Mapa player→selections alimentado pelo WS. Resolve sinais por nome + handicap + odd |
| `fetch_inplay_fixtures()` | Busca fixtures eSports ao vivo via SportsBook Content API (curl_cffi) |
| `ws_feed_loop()` | Conecta WS, subscribir fixtures, parseia updates, alimenta FixtureMap, re-busca 2min |
| `parse_signal()` | Parser HC ("STING +5.5 @1.86") e Under/Over ("UNDER 116.5 @1.83") |
| `on_signal()` | Handler Telegram: parse → safety check → resolve → PlaceBet → chain tokens |

**Decisões críticas:**
- **Odds**: WS envia fracionária ("5/6"), Telegram envia decimal (1.83). FixtureMap armazena ambas. PlaceBet usa a fracionária do WS (campo `o=` e `pv=`). Signal odd (decimal) é usada apenas para validação (MAX_ODD_DROP=0.15).
- **AUTOBET_ENABLED=true**: bot_api.py força via env var (default do settings é False)
- **Token refresh**: Tokens expiram. Precisa rodar `capture_tokens.py` periodicamente para renovar gwt.
- **Content API URL**: `SportsBook.API/web?lid=33&zid=0&pd=%23AC%23B18%23C1%23D18%23F2%23&cid=18&ctid=18&cpn=OVInPlay` — retorna fixtures eSports In-Play em formato proprietário.

**Testes de verificação (2026-03-24):**

| Teste | Resultado |
|---|---|
| curl_cffi `impersonate="firefox135"` → Cloudflare | ✅ HTTP 200 |
| PlaceBet com cookies expirados | ✅ cs=2 mi="" (esperado — cookies velhos) |
| Sintaxe bot_api.py | ✅ ast.parse OK |
| Imports bot_api.py | ✅ All imports OK |
| **gwt aparece sem route handlers** | ✅ 280 chars, < 10s após In-Play nav |
| **Browser fetch PlaceBet + gwt + URL-encode body** | ❌ cs=2, sr=-1 (falta challenge `c=`) |
| **Browser fetch PlaceBet + gwt + `c=` random** | ❌ cs=2, sr=-1 (c= precisa ser válido) |
| WS listener antes da navegação | ✅ 491-527 selections capturadas |
| sync_term via request listener | ✅ 1260 chars capturados automaticamente |

#### Descobertas Session 4b-4c

**gwt Cookie — APARECE no Camoufox (contradizendo conclusão anterior)**

O cookie `gwt` (280 chars, gerado pelo GeoComply) APARECE no Camoufox, mas SOMENTE quando os route handlers do Playwright (`page.route("**/defaultapi/**", ...)`) NÃO estão instalados.

| Condição | gwt Aparece? |
|---|---|
| Login + In-Play, SEM route handlers | ✅ SIM (5-10s) |
| Login + In-Play, COM route handlers (TokenHarvester) | ❌ NÃO |
| Login + Home (sem In-Play) | ❌ NÃO |

**Root cause:** Os route handlers do `token_harvester.py` que interceptam `**/defaultapi/**` bloqueavam os requests que trigam o mecanismo GeoComply, impedindo a geração do gwt. Remover os route handlers permite que o GeoComply JS funcione normalmente.

**Solução:** Mudar a ordem de inicialização — navegar para In-Play PRIMEIRO (sem route handlers) → esperar gwt (até 60s) → DEPOIS instalar TokenHarvester e WS listeners.

---

**PlaceBet sr=-1 — BLOQUEADOR ATIVO**

Mesmo com gwt presente (280 chars), sync_term (1260 chars), body URL-encoded, e x-request-id, o PlaceBet retorna `{"cs":2,"sr":-1}`. Análise do traffic log do browser real revelou **3 diferenças** entre nosso request e o real:

| Elemento | Nosso Request | Request Real (browser) |
|---|---|---|
| URL `c=` (challenge) | Ausente ou random | Hash base64url 32 bytes (gerado client-side pelo JS bet365) |
| POST body | Raw (`#`, `=`, `\|`, `/` literais) | URL-encoded (`%23`, `%3D`, `%7C`, `%2F`) |
| `x-request-id` header | Ausente | UUID v4 |

**Correções aplicadas e testadas:**
1. ✅ Body URL-encoded via `urllib.parse.quote(ns, safe='')`
2. ✅ `x-request-id` header adicionado (UUID v4)
3. ✅ `c=` parâmetro com hash base64url random adicionado
4. ❌ Resultado AINDA sr=-1 — o `c=` precisa ser o valor CORRETO gerado pelo JS do bet365

---

#### Descobertas Session 4d — **BREAKTHROUGH: Endpoint `addbet` e `c=` Mystery RESOLVIDO**

**`c=` NÃO É um algoritmo client-side — é um token do SERVIDOR via endpoint `addbet`!**

A análise anterior (session 4c) estava PARCIALMENTE ERRADA. O `c=` não é computado por SHA-256 client-side. Na verdade:

1. **Existe um 6º endpoint: `/BetsWebAPI/addbet`** — chamado automaticamente pelo JS bet365 QUANDO o usuário clica em uma odds (adiciona seleção ao betslip)
2. A resposta de `addbet` retorna: `bg` (betGuid), `cc` (challenge correlation), `pc` (page correlation)
3. O `placebet` usa exatamente esses valores na URL: `?betGuid={bg}&c={cc}&p={pc}`
4. O primeiro `c=` vem do `addbet`, NÃO de computação JS — a chain é: `addbet.cc` → `placebet.c` → `placebet_resp.cc` → próximo `placebet.c`

**Código-fonte bet365 JS (script[163]) confirmou:**
```javascript
betRequestCorrelation: encodeURIComponent(this.document.get("cc"))
betGuid: this.document.get("bg")
// "cc" é populado via this.document.merge(response) do addbet
```

**Fluxo real completo (confirmado por intercepção):**
```
1. Usuário CLICA odds no DOM
   → JS bet365 envia POST /BetsWebAPI/addbet
   → Body: ns=pt=N#o={odd}#f={fixture}#fp={selection}#so=#c={class}#ln={hcap}#pv={odd}#mt={mkt}#id={fid}-{sid}Y#|TP=BS...
   → Response: {"sr":0, "bg":"...", "cc":"...", "pc":"..."}

2. Betslip abre com seleção adicionada
   → Usuário preenche stake e clica "Place Bet"
   → JS bet365 envia POST /BetsWebAPI/placebet?betGuid={bg}&c={cc}&p={pc}
   → Body: &ns=pt=N#o=#f=#fp=#so=#c=#ln=#pv=#s=1.0#mt=#at=N#...&xb=1&betsource=FlashInPLay
   → Response: {"cs":3, "sr":0, "bg":"...", "cc":"...", ...} (ACEITA!)
```

**Teste de validação (session 4d):**

| Passo | Resultado |
|---|---|
| Click odds → addbet interceptado | ✅ sr=0, bg+cc+pc retornados |
| Betslip visível com seleção | ✅ |
| Stake preenchido via contenteditable div | ✅ |
| Place Bet clicado | ✅ |
| **PlaceBet aceito (sr=0)** | ✅ **APOSTA ACEITA!** |
| PlaceBet via fetch() com bg/cc/pc do addbet | ❌ sr=-1 (bet365 Loader interno adiciona headers extras) |

**Conclusão:** O `fetch()` injetado por nós retorna sr=-1 mesmo com bg/cc/pc corretos. O JS interno do bet365 ("Loader") adiciona headers/cookies/tokens extras que não replicamos. A aposta FUNCIONA quando feita pelo UI real do bet365.

**Endpoints BetsWebAPI descobertos:**

| Endpoint | Trigger | Retorna | Usado para |
|---|---|---|---|
| `/BetsWebAPI/addbet` | Click odds | bg, cc, pc, sr | Inicializar betslip |
| `/BetsWebAPI/placebet` | Click "Place Bet" | cs, sr, bg, cc, bt | Confirmar aposta |
| `/BetsWebAPI/removebet` | Click "X" no betslip | - | Remover seleção |

**Seletor do stake input:**
- NÃO é `<input>` — é `<div contenteditable="true">` dentro do betslip
- Seletor: `.bss-StakeBox_StakeValue` ou `.bss-StakeInput` (contenteditable)

**Estratégia definida para próxima sessão:**
- **Opção A (preferida):** Automação UI completa — click odds → preencher stake no contenteditable → click Place Bet → interceptar bg/cc/pc para logging
- **Opção B:** Reverse-engineer os headers extras que o Loader interno adiciona ao fetch()
- **Opção C:** Monkey-patch o Loader do bet365 para injetar nosso payload antes do envio

---

## Desafios Conhecidos

### GeoComply (RESOLVIDO — abordagem híbrida)
- ~~Possível necessidade de eliminar browser~~ → Browser mantido para GeoComply
- `gwt`/`swt` são tokens geo-validados pelo browser JS
- Rotation automática, mas pode expirar → auto-refresh a cada 120s
- GeoComply URLs bloqueadas por route interception (geo stealth funciona)

### Ofuscação
- Bet365 ofusca nomes de endpoints e payloads → mapeado via traffic analysis
- Tokens rotativos por sessão → token chain automático (`bg`→`betGuid`, `cc`→`c`)
- WS usa formato proprietário (NÃO JSON) → parser com 87+ endpoints implementado
- Formato pode mudar periodicamente → requer manutenção

### Anti-Bot (RESOLVIDO — curl_cffi)
- ~~httpx 403~~ → ~~route.fetch 200 mas app error~~ → **curl_cffi impersonate="firefox135" HTTP 200 ✅**
- Rate limiting agressivo em requests diretos → mitigado pelo SafetyGuard (5 bets/hora max)
- Cloudflare `__cf_bm` cookie → extraído via capture_tokens.py
- `tagType=WindowsDesktopBrowser` no payload → mantém fingindo browser

### WS Odds Protocol (DECODIFICADO)

**Formato de snapshot (frame inicial):**
```
|PA;FI=191751841;ID=901210606;NA=Union Berlin (F);OD=1/1;HA=+1.5;HD= +1.5;OR=0;SU=1;
```

**Formato de update (frames incrementais):**
```
OVM175P{fixture_id}-{selection_id}U|HA=116.5;HD= 116.5;OD=5/6;
L{fixture_id}-{selection_id}_33_0U|OD=9/4;
OVES{fixture_id}-{selection_id}_33_0U|OD=7/2;
```

**Hierarquia:**
```
CL (classification: CL=1 Futebol, CL=18 Basquete)
  └── CT (category: B-EBASKBAT4X5 = E-basketball Battle 4x5min)
       └── EV (event: FI=fixture_id, NA=teams, SS=score, CP=quarter)
            └── MA (market: ID=1446 Handicap, ID=1450 Total, ID=180032 Winner)
                 └── PA (participant: ID=selection_id, OD=odds, HA=handicap)
```

**Campos críticos para betting:**
- `FI=` → fixture_id (usado no PlaceBet)
- `ID=` em PA → selection_id (usado no PlaceBet)
- `OD=` → odds em fração (5/6 = 1.833, 20/27 = 1.74)
- `HA=` → handicap line (+15.5, 116.5, etc.)
- `SU=1` → selection suspensa (não apostar)

### Manutenção
- Empresas como Tippy.bet cobram assinatura mensal justamente porque mantêm equipe atualizando o mapeamento quando a Bet365 muda o protocolo

---

## Referência de Mercado — Tippy.bet

Pesquisa completa na documentação do [Tippy.bet](https://tippy.bet/pt-BR/docs/):

| Aspecto | Tippy.bet | Sheva (nosso) |
|---|---|---|
| **Motor** | Electron/Chromium embarcado | Camoufox (Firefox stealth) |
| **Abordagem** | Browser real (não API pura) | Browser + HTTP interceptor |
| **Apostas** | Via browser DOM | DOM + HTTP replay (interceptor) |
| **Geo** | Browser nativo | Camoufox + geo stealth |
| **Canais** | Tipster → followers auto-replicam | Telegram → auto-bet |
| **Preço** | Free (3/dia), Pro R$240/mês | Self-hosted |

**Insights importantes:**
- Tippy **também usa browser real** → valida nossa abordagem híbrida como correta
- **Perfis Passivos** (desbug): apostas aleatórias automáticas para manter conta ativa (intervalo, odds min/max)
- **Safety features**: max bet limiter, stop-loss (pausa se saldo < X)
- **Sistema de unidades (µ)**: bankroll management (ex: 1µ = R$25)
- Credenciais armazenadas localmente + suporte a proxy

---

## Arquivos do Projeto

### Etapa 2 — Core API (src/api/)

| Arquivo | Descrição | Status |
|---|---|---|
| `src/api/__init__.py` | Init do pacote | ✅ |
| `src/api/http_client.py` | ⭐ `Bet365HttpClient` — PlaceBet via **curl_cffi** impersonate=firefox135, SessionTokens, BetResult | ✅ **Reescrito** (era httpx) |
| `src/api/ws_parser.py` | `Bet365WsParser` — formato proprietário, 87+ endpoints, **`parse_odds_update()`** | ✅ Testado (172 updates) |
| `src/api/ws_client.py` | `Bet365WsClient` — odds feed + commands, precisa cookies sessão | ✅ Criado |
| `src/api/token_harvester.py` | `TokenHarvester` — extrai tokens do browser, **sync_term listener passivo**, salva disco | ✅ **Modificado** |
| `src/api/bet_interceptor.py` | `BetInterceptor` — intercept → abort → curl_cffi → fulfill | ✅ **Reescrito** (era route.fetch) |

### Etapa 2 — Betting Core (src/betting/)

| Arquivo | Descrição | Status |
|---|---|---|
| `src/betting/safety.py` | ⭐ `SafetyGuard` + `UnitSystem` — stop-loss, max stake, rate limit, µ units | ✅ Criado + Testado |
| `src/betting/ui_placer.py` | ⭐⭐ `UIBetPlacer` — aposta via UI (mouse.click CDP), addbet/placebet interceptor | ✅ **Novo (Session 4e)** |
| `src/betting/bet_log.py` | `BetLogger` — CSV logger, daily_loss, hourly_count | ✅ Existente |

### Etapa 2 — Scripts

| Arquivo | Descrição | Status |
|---|---|---|
| `scripts/bot_api.py` | ⭐⭐ **BOT PRINCIPAL** — Telegram → FixtureMap → **UIBetPlacer (mouse.click)** | ✅ **Atualizado (Session 4e)** |
| `scripts/capture_tokens.py` | ⭐ Captura tokens via login manual (Camoufox) → live_tokens.json | ✅ **Novo (Fase 6)** |
| `scripts/bet_hybrid.py` | Daemon híbrido: auto (interceptor) + http + dom | ✅ Atualizado |
| `scripts/bet_telegram.py` | Listener Telegram — DOM + interceptor (Etapa 2 anterior) | ✅ Modificado |
| `scripts/analyze_traffic.py` | Analisador tráfego JSONL (--placebet, --ws-decode, --tokens) | ✅ Testado |
| `scripts/extract_tokens.py` | Extrai tokens do traffic log → `data/session_tokens.json` | ✅ Testado |
| `scripts/test_http_pipeline.py` | Testes do pipeline HTTP (ns builder, parser, gwt_changed, tokens) | ✅ 16 assertions |
| `scripts/test_safety.py` | Testes do SafetyGuard + UnitSystem (10 testes, 36 assertions) | ✅ 36 assertions |
| `scripts/test_ws_client.py` | Teste standalone WS client (3 modos: no-auth, tokens, listen) | ✅ Criado |
| `scripts/bet_passive.py` | ⭐ Perfil Passivo (desbug) — apostas aleatórias para manter conta ativa | ✅ Criado |
| `scripts/test_placebet_gwt.py` | ⭐⭐ **REFERÊNCIA UI-FLOW COMPLETO** — login auto, addbet, stake, placebet sr=0 com receipt | ✅ **Atualizado (Session 4e)** |
| `scripts/test_bet_via_ui.py` | Teste aposta via UI bet365 (click odds → fill stake → Place Bet) — stake unfocusable | ⚠️ **Novo (Session 4c)** |
| `scripts/intercept_placebet.py` | Intercepta PlaceBet real via route + XHR monkey-patch — busca c= challenge | ✅ **Novo (Session 4c)** |
| `scripts/scan_placebet_traffic.py` | Scanner do traffic log JSONL para PlaceBet (compare headers/body/c=) | ✅ **Novo (Session 4c)** |
| `scripts/find_challenge_source.py` | Busca origem do c= challenge token no traffic log (antes do 1º PlaceBet) | ✅ **Novo (Session 4c)** |
| `scripts/analyze_pre_placebet.py` | Analisa TODOS os entries antes do 1º PlaceBet (busca base64 hashes) | ✅ **Novo (Session 4c)** |
| `scripts/extract_correlation.py` | Extrai script[163] JS, localiza `betRequestCorrelation` — confirmou c= vem do server | ✅ **Novo (Session 4d)** |
| `scripts/reverse_challenge.py` | Reverse-engineer c= challenge: monkey-patch fetch + dump scripts + trigger UI | ✅ **Novo (Session 4d)** |
| `scripts/capture_first_cc.py` | Captura primeiro bg/cc/pc via hook JS interceptando fetch+XHR do BetsWebAPI | ✅ **Novo (Session 4d)** |
| `scripts/capture_addbet_body.py` | ⭐ Captura request+response completa de addbet e placebet (descobriu endpoint!) | ✅ **Novo (Session 4d)** |
| `scripts/intercept_real_placebet.py` | Intercepta PlaceBet real via UI com stack trace — busca challengeRequired (sr=86) | ✅ **Novo (Session 4d)** |
| `scripts/find_betswebapi_init.py` | Busca TODOS endpoints BetsWebAPI e qual retorna bg/cc inicial | ✅ **Novo (Session 4d)** |
| `scripts/trace_cc_origin.py` | Rastreia onde cc é populado pela primeira vez no betslip document | ✅ **Novo (Session 4d)** |
| `scripts/diag_gwt_origin.py` | Diagnóstico gwt — proxy document.cookie setter + monitoramento Set-Cookie | ✅ **Novo (Session 4d)** |

### Etapa 2 — Dados e Logs

| Arquivo | Descrição | Status |
|---|---|---|
| `data/session_tokens.json` | Tokens extraídos do traffic (15 cookies, sync term, pstk) | ✅ Válido |
| `data/live_tokens.json` | Tokens extraídos ao vivo pelo TokenHarvester (atualizado a cada 120s) | ✅ Criado Live |
| `logs/bet365_api_traffic.jsonl` | 730+ entries de tráfego HTTP capturado | ✅ |
| `logs/bet365_ws_full.jsonl` | 876 frames WS capturados (2.1MB, 797 com odds) | ✅ Novo |

### Documentação

| Arquivo | Descrição |
|---|---|
| `docs/ETAPA-2-BOT-PROFISSIONAL.md` | Este arquivo — roadmap e status |
| `docs/PROTOCOLO-BET365-API.md` | Protocolo completo (600+ linhas): endpoints, payloads, WS, geo analysis |

### Etapa 1 — Bot DOM (referência)

| Arquivo | Descrição |
|---|---|
| `scripts/bet_daemon.py` | ⭐ Principal Etapa 1: browser quente, 3s/aposta, CLI interativo |
| `scripts/bet_telegram.py` | Listener Telegram → auto-bet DOM + interceptor de tráfego |
| `scripts/bet_telegram_live_page.py` | Listener em page live já aberta |
| `src/browser/engine.py` | Motor Camoufox + stealth + geo 5 camadas |
| `src/browser/session.py` | Persistência de cookies |
| `src/betting/__init__.py` | BetPlacer (fill_stake, place_bet, find_and_click_odd) |
| `config/settings.py` | Todas configs via .env |

## Stack Técnica

### Em uso
- **Python 3.12.10** (`C:\Users\lucas\AppData\Local\Programs\Python\Python312\python.exe`)
- **Camoufox 0.4.11** (Firefox stealth) + Playwright 1.58.0 — **SOMENTE para login manual + GeoComply**
- **curl_cffi** — ⭐ **HTTP client com TLS impersonation Firefox 135** (resolve 403 Cloudflare)
- **websockets 16.0** — WS client async (odds feed)
- **Telethon** (Telegram client)
- **Loguru** (logging)
- **Windows** (3 monitores)

### Descartadas
- **httpx** — retorna 403 (TLS fingerprint Python detectado pelo Cloudflare)
- **route.fetch()** — HTTP 200 do Cloudflare, mas "Infelizmente, um erro ocorreu" (automação detectada)
- **route.continue_()** — Mesmo resultado que route.fetch()
- **DOM automation para apostar** — Frágil, lento (3s), detectável

---

## Status Geral

| Fase | Status | Progresso |
|------|--------|-----------|
| Fase 1 — Captura de Tráfego | ✅ Completa | 100% |
| Fase 1.5 — Investigação GeoComply | ✅ Completa | 100% |
| Fase 2 — Replay (HTTP + WS) | ✅ Implementada + route.fetch fix | 100% |
| Fase 3 — Integração Híbrida | ✅ **TESTADA LIVE** | 100% |
| Fase 4 — Bug Fixes e Hardening | ✅ Completa + CancelledError fixes | 100% |
| Fase 5 — Safety + Perfil Passivo | ✅ Completa | 100% |
| Fase 6 — **API-Only (curl_cffi + Browser Fetch)** | ✅ addbet+placebet via UI sr=0 | 95% |
| Fase 7 — **Automação UI completa** | 🔄 Fluxo validado, integração em andamento | 40% |

### Bugs Corrigidos na Sessão 3 (Teste Live)

| Severidade | Arquivo | Bug | Fix |
|---|---|---|---|
| 🔴 **CRÍTICO** | `bet_telegram.py` | `continue` em contexto `async with _bet_lock:` (não é loop) → SyntaxError | Trocado por `return` |
| 🔴 **CRÍTICO** | `token_harvester.py` | `asyncio.CancelledError` é `BaseException` em Python 3.12, não capturado por `except Exception` → crash | Adicionado `asyncio.CancelledError` em 3 except clauses |
| 🟡 **ALTO** | `token_harvester.py` | `_save_tokens()` só chamado quando `sync_term` truthy, mas sync_term sempre timeout → `live_tokens.json` nunca criado | Agora salva incondicionalmente |
| 🔴 **CRÍTICO** | `bet_interceptor.py` | httpx HTTP PlaceBet retorna 403 (TLS fingerprint) → aposta adicionava 416ms de overhead + falhava | Substituído httpx por `route.fetch()` do Playwright |

### Bugs Corrigidos na Sessão 4 (API-Only Pivot)

| Severidade | Arquivo | Bug | Fix |
|---|---|---|---|
| 🔴 **CRÍTICO** | `http_client.py` | httpx TLS fingerprint Python → 403 Cloudflare | Reescrito com **curl_cffi** `impersonate="firefox135"` → HTTP 200 ✅ |
| 🔴 **CRÍTICO** | `bet_interceptor.py` | `route.fetch()` → 200 mas "Infelizmente, um erro" (app-level rejection) | Reescrito: intercept → abort → curl_cffi → fulfill |
| 🟡 **ALTO** | `token_harvester.py` | sync_term sempre vazio (JS eval fail — Bet365 ofusca) | Listener passivo `page.on("request")` captura de requests reais |
| 🟡 **ALTO** | `manual_login.py` | Refresh loop infinito (stealth scripts causavam reload) | Removido stealth do manual_login |

### Bugs Corrigidos na Sessão 4b/4c (gwt + PlaceBet Investigation)

| Severidade | Arquivo | Bug | Fix |
|---|---|---|---|
| 🔴 **CRÍTICO** | `http_client.py` | Body `ns=` enviava `#`, `=`, `\|`, `/` literais (bet365 espera URL-encoded) | ~~f-string manual~~ → revertido para `quote(ns, safe='')` |
| 🔴 **CRÍTICO** | `token_harvester.py` | `page.route()` handlers BLOQUEAVAM geração do cookie gwt | Descoberto: route handlers interferem com GeoComply JS. **Solução:** navegar sem handlers → esperar gwt → depois instalar handlers |
| 🟡 **ALTO** | `http_client.py` | `_all_cookies` não incluía todos os cookies HttpOnly | `SessionTokens._all_cookies` com dict completo + `from_browser_cookies()` |
| 🟡 **ALTO** | `http_client.py` | `page_id` via JS extraction retornava vazio ou "1" | Random BigInt `10^17` a `10^19` |
| 🟡 **ALTO** | test scripts | `sync_term` listener configurado DEPOIS do trigger (never captured) | Listener antes do trigger; fallback fetch explícito |
| 🟢 **MÉDIO** | test scripts | WS listener `page.on("websocket")` APÓS navegação (perde conexões) | Listener ANTES da navegação; re-navegação (#/IP → #/IP/B18) força novas conexões |

### Bugs Corrigidos na Sessão 4e (Full UI Flow)

| Severidade | Arquivo | Bug | Fix |
|---|---|---|---|
| 🔴 **CRÍTICO** | `test_placebet_gwt.py` | `keyboard.type()` para user/pass depende de foco — mouse do usuário causa perda de foco | **`locator.fill()`** preenche via CDP protocol, imune a interferência de mouse |
| 🔴 **CRÍTICO** | `test_placebet_gwt.py` | Stake selector `.bss-StakeBox_StakeValue` é 0x0 invisível (placeholder "Aposta") | Seletor correto: **`.bsf-StakeBox_StakeValue-input`** (contenteditable div, 60x25px) |
| 🟡 **ALTO** | `test_placebet_gwt.py` | Place Bet button não aparecia (stake não preenchido corretamente com seletor errado) | Corrigido após fix do seletor de stake; botão `.bsf-PlaceBetButton` (225x50) aparece |
| 🟡 **ALTO** | `test_placebet_gwt.py` | addbet não capturado em re-runs (betslip já tinha seleções anteriores) | Adicionado bet slip cleanup: remove seleções anteriores via JS antes de clicar nova odds |
| 🟢 **MÉDIO** | `test_placebet_gwt.py` | JS `dispatchEvent` click (isTrusted:false) — bet365 ignora para addbet/placebet | Mantido `page.mouse.click()` (trusted CDP events) para todos os botões |

### Próximos Passos (Fase 7 — Automação UI Completa)

#### ✅ Resolvido na Session 4e
- ~~Automação UI completa~~ → **FUNCIONA! sr=0, bet receipt confirmado**
- ~~Seletores DOM~~ → **Mapeados**: `.bsf-StakeBox_StakeValue-input` (stake), `.bsf-PlaceBetButton` (place bet), `[class*="Participant"][class*="Odds"]` (odds cells)
- ~~Ordem de inicialização~~ → **Validada**: Login → In-Play SEM route handlers → wait gwt → WS listeners
- ~~Mouse interference~~ → **locator.fill()** para inputs (imune a foco/mouse)

#### 🔴 Prioridade Alta — Integração no Bot
1. **Integrar UI flow no bot_telegram.py** — Recebe sinal Telegram → navega ao fixture → identifica odds cell correta → click → fill stake → place bet
2. **Fixture navigation from signal** — Dado player name do sinal, navegar até o fixture correto no In-Play:
   - WS FixtureMap: player name → fixture_id → URL hash `#/IP/EV{fixture_id}`
   - Ou scroll/busca no DOM (fallback)
3. **Odds cell matching** — Selecionar a odds cell correta baseado no mercado do sinal (Handicap +3.5, Over/Under, etc.)
4. **Error handling robusto** — Odds changed (sr≠0), selection suspended, timeout, betslip errors

#### 🟡 Prioridade Média — Robustez
5. **Token chain** — Após cada bet, `pc` do response vira `bg` do próximo addbet (manter cadeia)
6. **Session keepalive** — Manter browser ativo sem timeout (mouse moves periódicos / page activity)
7. **Retry logic** — Se odds mudam (cs=3 odds changed), re-click e re-try
8. **WS odds validation** — Comparar odds do sinal com odds WS antes de apostar

#### 🟢 Prioridade Baixa
9. **Implementar Under/Over** — Mercado Under/Over
10. **Logging persistente** — Salvar resultados de apostas em CSV/JSON
11. **Perfil passivo integrado** — bet_passive.py rodando em schedule
12. **Multi-bet** — Suporte a múltiplas apostas simultâneas na mesma sessão

### Riscos

- ~~TLS fingerprint (`JA3/JA4`)~~ → **RESOLVIDO: curl_cffi impersonate="firefox135"**
- ~~gwt não aparece no Camoufox~~ → **RESOLVIDO: não usar route handlers antes do gwt**
- ~~`c=` challenge token gerado client-side~~ → **RESOLVIDO: `c=` vem do endpoint `addbet` (server-side)**
- ~~PlaceBet via fetch() retorna sr=-1~~ → **RESOLVIDO: UI automation funciona (sr=0, receipt confirmado)**
- **Seletores DOM frágeis** — bet365 pode mudar classes CSS. Mitigação: múltiplos seletores + fallback. Seletores atuais: `.bsf-StakeBox_StakeValue-input` (stake, 60x25px, contenteditable), `.bsf-PlaceBetButton` (button, 225x50px), `[class*="Participant"][class*="Odds"]` (odds cells)
- Rate limiting: muitas requests HTTP rápidas podem triggar ban → mitigado por SafetyGuard (5/hora)
- Token expiry: gwt/swt podem ter TTL curto demais para o refresh de 120s → monitorar
- WS keepalive: protocolo proprietário pode ter heartbeat obrigatório não mapeado

---

## Como Continuar

Para retomar este trabalho em um novo chat, informe ao Copilot:

> "Estou trabalhando no projeto Sheva, especificamente no `apps/odds-radar`. Quero continuar a **Etapa 2 do bot profissional** — migrar de DOM scraping para API reversa do Bet365. Leia o arquivo `docs/ETAPA-2-BOT-PROFISSIONAL.md` e `docs/PROTOCOLO-BET365-API.md` para contexto completo."

**Estado atual (Session 4e):** Fases 1-6 completas. Fase 7 (Automação UI) em 40% — **FLUXO UI COMPLETO VALIDADO**: login auto → gwt → click odds → addbet sr=0 → fill stake → Place Bet → **placebet sr=0, receipt XF9748854581F**. **Próximo passo: integrar no bot Telegram** — signal → navigate fixture → select odds → stake → place bet.

**Descobertas-chave da sessão 4e (FULL UI FLOW WORKING):**
- **PlaceBet via UI: sr=0, cs=3, receipt XF9748854581F** — fluxo 100% automático funciona!
- **`locator.fill()`** resolve mouse interference — preenche inputs via CDP protocol, imune a foco/mouse do usuário
- **`page.mouse.click()`** já é protocol-level (CDP) em Playwright — NÃO é mouse físico
- **JS `dispatchEvent` (isTrusted:false)** — bet365 IGNORA clicks não-trusted para addbet/placebet
- **Seletor correto stake**: `.bsf-StakeBox_StakeValue-input` (contenteditable div, 60x25px) — NÃO `.bss-StakeBox_StakeValue` (0x0 invisível)
- **Seletor correto Place Bet**: `.bsf-PlaceBetButton` (225x50px, enabled após stake fill)
- **Bet slip cleanup necessário**: remover seleções anteriores antes de clicar novas odds
- **PlaceBet URL params**: `betGuid={bg}&c={cc}&p={pc}` — mesmos tokens do addbet response
- **PlaceBet body**: `ns=pt=N#o=...#f={fixture}#fp={selection}#so=#c=18#sa=...#ln=+3.5#mt=11#|at=Y#TP=...#ust=1.00#st=1.00#tr={odds}#||`

**Descobertas-chave da sessão 4d (BREAKTHROUGH):**
- **Endpoint `/BetsWebAPI/addbet` DESCOBERTO** — chamado ao clicar odds, retorna bg/cc/pc
- **`c=` NÃO é algoritmo client-side** — vem do `addbet` response (`cc` field)
- **Fluxo real**: click odds → addbet (bg/cc/pc) → fill stake → placebet (usa bg/cc/pc)
- **Aposta via UI real: sr=0 ACEITA!** — primeira aposta aceita programaticamente
- **Fetch() injetado: sr=-1** — bet365 Loader adiciona headers extras que não replicamos
- **Stake input é `<div contenteditable>`** (não `<input>`) — classe `.bss-StakeBox_StakeValue`
- **JS bet365 (script[163])**: `betRequestCorrelation = encodeURIComponent(this.document.get("cc"))`

**Descobertas-chave da sessão 4c:**
- **gwt APARECE no Camoufox** — route handlers (`page.route()`) bloqueavam a geração. Sem handlers → gwt em 5-10s
- **POST body deve ser URL-encoded** — `%23` ao invés de `#`, `%3D` ao invés de `=`, etc.
- **x-request-id** header é enviado pelo browser real mas ausência não é o causador de sr=-1
- WS listener deve ser instalado ANTES da navegação para capturar todas as conexões

**Descobertas-chave da sessão 3:**
- httpx → 403 (Cloudflare TLS fingerprint) → `route.fetch()` resolve
- `asyncio.CancelledError` é `BaseException` em Python 3.12 (não `Exception`)
- WS odds format: `OVM175P{fixture}-{selection}U|OD={odds};HA={handicap};`
- 172 updates de odds capturados em tempo real para um único fixture
