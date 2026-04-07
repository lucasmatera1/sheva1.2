# 🔍 Protocolo Bet365 — Análise de Engenharia Reversa

> Gerado em 2026-03-23 a partir de `logs/bet365_api_traffic.jsonl` (610 entries, ~1MB)

---

## 1. Endpoint de Aposta (PlaceBet)

### URL
```
POST https://www.bet365.bet.br/BetsWebAPI/placebet
```

### Query Parameters
| Param | Exemplo | Descrição |
|-------|---------|-----------|
| `betGuid` | `b794e297-7b00-4479-920d-fac9bd8d1f76` | UUID único por aposta (gerado client-side) |
| `c` | `hrPsrij7d30KZ9E8aVKtwSHxQ_B84lbHX-M1gpg3vnM=` | Token de challenge/assinatura (muda a cada request) |
| `p` | `3664062448596345987` | Session/page identifier (número grande, parece fixo por sessão) |

### Headers Obrigatórios
| Header | Valor | Nota |
|--------|-------|------|
| `content-type` | `application/x-www-form-urlencoded` | |
| `x-net-sync-term` | Base64 longo (~1KB) | Token de sincronização, muda por sessão. Crítico — sem ele a request é rejeitada |
| `x-request-id` | UUID | ID único por request |
| `referer` | `https://www.bet365.bet.br/` | |
| `origin` | `https://www.bet365.bet.br` | |
| `cookie` | Ver seção Cookies | Todos os cookies de sessão |

### Cookies Essenciais
| Cookie | Exemplo | Descrição |
|--------|---------|-----------|
| `pstk` | `6A46C120F07E511AB708006A77CDCA7A000004` | **Session token principal** — usado no WebSocket também |
| `aaat` | `di=<UUID>&ts=<datetime>&v=2&am=0&at=<UUID>&ue=<email>` | Auth account token (contém email, timestamps) |
| `gwt` | Base64 longo | General web token |
| `swt` | Base64 longo | Session web token |
| `pers` | `id=<UUID>&pc=21&username=<user>` | Persistência (user ID) |
| `session` | `lgs=1` | Flag de login (1 = logado) |
| `aps03` | `ao=1&cf=E&cg=0&...` | Config de sessão |
| `__cf_bm` | Hash | Cloudflare bot management |

### Post Data (URL-decoded)
```
ns=pt=N#o=4/5#pv=4/5#f=191755961#fp=901719780#so=#c=18#ln=+6.5#mt=11#|at=Y#TP=BS191755961-901719780#ust=1.00#st=1.00#tr=1.80#||
xb=1
aa=null
betsource=FlashInPLay
tagType=WindowsDesktopBrowser
bs=99
qb=1
```

### Campos do `ns` (Bet Slip Notation)
| Campo | Exemplo | Significado |
|-------|---------|-------------|
| `pt` | `N` | Bet placement type (N = normal) |
| `o` | `4/5` | Odd atual (formato fracionário UK) |
| `pv` | `4/5` | Previous value / odd confirmada |
| `f` | `191755961` | **Fixture ID** (ID do evento/jogo) |
| `fp` | `901719780` | **Selection/Participant ID** (ID da seleção específica) |
| `so` | `` | Sort order (vazio = single) |
| `c` | `18` | Classification ID (tipo de esporte? 18 = e-sport?) |
| `ln` | `+6.5` | **Handicap line** |
| `mt` | `11` | **Market Type** (11 = handicap asiático?) |
| `at` | `Y` | Accept changes (Y = aceitar mudanças de odd) |
| `TP` | `BS191755961-901719780` | Ticket Position (fixture-selection) |
| `ust` | `1.00` | User stake (valor que o user digitou) |
| `st` | `1.00` | Stake real |
| `tr` | `1.80` | Total return (stake × odd decimal) |

### Campos extras do POST
| Campo | Valor | Significado |
|-------|-------|-------------|
| `xb` | `1` | ? |
| `aa` | `null` | ? |
| `betsource` | `FlashInPLay` | Origem: In-Play (ao vivo) |
| `tagType` | `WindowsDesktopBrowser` | Fingerprint de plataforma |
| `bs` | `99` | ? (bet source code?) |
| `qb` | `1` | Quick bet? |

---

## 2. Resposta do PlaceBet

### Resposta JSON (status 200)
```json
{
  "sr": 118,
  "pm": "BWAPI",
  "vm": "BWAPI",
  "ab": true,
  "bg": "<next-bet-guid>",
  "cc": "<next-challenge-token>",
  "vr": "1574",
  "cs": 2,
  "st": 1,
  "mi": "geo_services_blocked",
  "mv": "",
  "bt": [{
    "ob": [],
    "ms": 0.0,
    "fy": 1,
    "er": false,
    "ra": 0.0,
    "rp": 0.0,
    "nf": 191755637,
    "mf": "",
    "ir": "",
    "bt": 1,
    "od": "4/5",
    "go": "4/5",
    "fi": 191755961,
    "pt": [{
      "hd": "+6.5",
      "pm": {},
      "pi": 901719780,
      "ha": "+6.5",
      "ho": "",
      "hf": "+0.0"
    }],
    "re": 1.80,
    "sr": 0,
    "ox": "",
    "px": ""
  }]
}
```

### Campos da Resposta
| Campo | Tipo | Significado |
|-------|------|-------------|
| `sr` | int | Status/result code |
| `pm` | string | Placement method |
| `vm` | string | Validation method |
| `ab` | bool | ? |
| `bg` | string | **Next bet GUID** — usar na próxima request (encadeamento) |
| `cc` | string | **Next challenge token** — usar no `c` da próxima request |
| `vr` | string | Version |
| `cs` | int | **Completion status** — 2 provavelmente = rejeitado |
| `st` | int | Status (1 = ?) |
| `mi` | string | **Message identifier** — razão do resultado |
| `mv` | string | Message value |
| `bt[]` | array | Bet items array |
| `bt[].od` | string | Odd da aposta |
| `bt[].fi` | int | Fixture item ID |
| `bt[].pt[].pi` | int | Participant/selection ID |
| `bt[].pt[].hd` | string | Handicap |
| `bt[].re` | float | Return esperado |

### ⚠️ Achado Crítico: Correlação gwt/swt com Geo Blocking

Análise detalhada de 16 PlaceBets revela:
- **12 rejeitadas** (`cs=2, mi="geo_services_blocked"`)
- **4 aceitas** (`cs=3`) — refs: DF2649966071F, DF9692071621F, FF3899699891F, EF9674916471F

#### Padrão Temporal e gwt
| Bets | Timestamp | gwt (início) | Resultado |
|------|-----------|--------------|-----------|
| #1-10 | 11:54-12:16 | `AazBm...` | ❌ 10/10 BLOCKED |
| #11-12 | 12:27-12:29 | `AfScQ...` | ✅ 2/3 OK |
| #13 | 12:36 | `AfScQ...` | ❌ 1/3 BLOCKED |
| #14 | 12:50 | `AR2+r...` | ✅ OK |
| #15 | 13:00 | `AaXpo...` | ✅ OK |
| #16 | 13:14 | `AWKvu...` | ❌ BLOCKED |

**Conclusão**: O cookie `gwt` (General Web Token) incorpora validação geo do browser.
- Quando o GeoComply JS roda com sucesso no browser, os próximos gwt/swt passam
- As primeiras 10 apostas com o mesmo gwt antigo → TODAS bloqueadas
- Após gwt rotacionar (refresh pelo browser) → apostas passaram
- `swt` também rotaciona em paralelo (7 valores únicos na sessão)
- Cookies `__cf_bm`, `ab.storage.sessionId` também mudam (Cloudflare + analytics)
- Nenhum GeoComply URL aparece no tráfego (route interception bloqueia)
- Nenhum WS frame contém dados de geo

#### Estratégia: Abordagem Híbrida
O browser é NECESSÁRIO para validação geo (não dá para skippar). Estratégia:
1. **Browser Camoufox** mantém sessão ativa + GeoComply validation
2. **Token Harvester** extrai cookies/gwt/swt/x-net-sync-term periodicamente
3. **HTTP Client** faz PlaceBet direto (httpx) usando tokens frescos (<500ms)
4. **Fallback** para DOM se HTTP retornar geo_blocked

---

## 3. Protocolo WebSocket

### Conexões
| URL | Propósito |
|-----|-----------|
| `wss://premws-pt1.365lpodds.com/zap/?uid=<random>` | **Odds/Market feed** — dados de mercados, odds em tempo real |
| `wss://pshudws.365lpodds.com/zap/?uid=<random>` | **Session/Command feed** — balance, comandos, status |

### Formato dos Frames
**NÃO é JSON.** Usa formato proprietário delimitado por caracteres especiais:

#### Separadores
| Char | Uso |
|------|-----|
| `\|` | Separa entidades/elementos |
| `;` | Separa campos key=value dentro de entidade |
| `=` | Key-value pair |
| `,` | Lista de valores |
| `~` | Separador de sub-categorias |
| `^` | Modificador/flag |
| `#` | Prefixo de comando |
| `F` | Flag em mensagens de config (após ID) |

#### Prefixos de Autenticação
| Prefixo | Significado |
|---------|-------------|
| `S_<pstk>` | Session token (cookie pstk) |
| `A_<base64>` | Auth token (base64 encoded, longo) |
| `P-ENDP` | Protocol endpoint/handshake |
| `P_CONFIG` | Request de config |

#### Exemplo: Handshake Inicial
```
Frame 1 (sent): #\x03P\x01__time,S_6A46C120F07E511AB708006A77CDCA7A000004
Frame 2 (sent): \x16\x00P-ENDP,P_CONFIG,A_<auth_token_base64>
Frame 3 (recv): P-ENDP\x46|EV;ID=;IT=P-ENDP;|MG;ID=;IT=ENDP;|MA;AD=;ED=B:3~D:7...
```

#### Comando: getBalance
```
Frame (sent para pshudws): commandgetBalance6A46C120F07E511AB708006A77CDCA7A000004SPTBK
```
- `command` — tipo da mensagem
- `getBalance` — comando
- `<pstk>` — session token
- `SPTBK` — product code (Sportsbook)

#### Mensagem de Config de Endpoints (recv)
```
|MA;AD=;ED=B:3~D:7,29,516,...;EX=AC;IT=mmnsp;NA=/matchmarketscontentapi/partial;OT=990;
```
- `MA` = Market/Module Assignment
- `ED` = Event Data (sport IDs: B=ball, D=?...)
- `IT` = Item Type (mmnsp = match markets non-splash partial)
- `NA` = Name/API path
- `OT` = Order/Type

### Content APIs referenciadas via WS
| API Path | Propósito |
|----------|-----------|
| `/matchmarketscontentapi/partial` | Mercados de partida (parcial) |
| `/matchmarketscontentapi/lists` | Listas de mercados |
| `/oddsoncouponcontentapi/coupon` | Odds no cupom |
| `/oddsoncouponcontentapi/header` | Header do cupom |
| `/playercontentapi/playerparlay` | Player parlay |
| `/playercontentapi/changeplayer` | Mudança de jogador |
| `/virtualsportscontentapi/changemarket` | Mercado virtual |
| `/splashcontentapi/tennistab` | Tab de tênis |
| `/racingsplashcontentapi/antepost` | Corridas ante-post |

---

## 4. Distribuição do Tráfego Capturado

| Tipo | Count | % |
|------|-------|---|
| ws_sent | 407 | 66.7% |
| ws_recv | 69 | 11.3% |
| request | 52 | 8.5% |
| response | 52 | 8.5% |
| ws_open | 30 | 4.9% |

**Problema:** `ws_recv` está muito baixo (69 vs 407 sent). O filtro atual só loga frames com keywords de aposta, **perdendo dados críticos de odds updates.**

---

## 5. Arquitetura Etapa 2 — Bot Híbrido

### Componentes Criados
| Arquivo | Propósito | Status |
|---------|-----------|--------|
| `src/api/http_client.py` | HTTP PlaceBet via httpx (SessionTokens, BetResult) | ✅ Criado |
| `src/api/ws_parser.py` | Parser WS proprietário (87+ endpoints) | ✅ Testado |
| `src/api/ws_client.py` | Cliente WS standalone (odds + commands) | ✅ Criado |
| `src/api/token_harvester.py` | Extrai tokens do browser (auto-refresh) | ✅ Criado |
| `scripts/bet_hybrid.py` | Daemon híbrido (browser geo + HTTP bet) | ✅ Criado |
| `scripts/analyze_traffic.py` | Análise automatizada de tráfego JSONL | ✅ Testado |
| `scripts/extract_tokens.py` | Extrator de tokens de log → JSON | ✅ Testado |

### Fluxo de Dados
```
Browser (Camoufox)          Token Harvester          HTTP Client
┌────────────────┐   ┌──────────────────────┐   ┌───────────────────┐
│ Login + Geo    │──▶│ Extract cookies/gwt   │──▶│ PlaceBet POST     │
│ GeoComply JS   │   │ Intercept sync-term   │   │ Token chain (bg,cc)│
│ Session alive  │   │ Auto-refresh 120s     │   │ <500ms latência   │
└────────────────┘   │ Save to disk          │   └───────────────────┘
                     └──────────────────────┘
                              │
                     WS Client (standalone)
                     ┌──────────────────────┐
                     │ Odds feed streaming   │
                     │ Balance/commands      │
                     │ Real-time updates     │
                     └──────────────────────┘
```

### Próximos Passos
1. **Testar pipeline completo** — rodar bet_hybrid.py com aposta real
2. **Capturar WS frame data** — interceptor corrigido (dict payload fix)
3. **Validar WS client** — conectar com cookies de sessão válidos
4. **TLS fingerprint** — verificar se httpx é bloqueado por JA3/JA4
5. **WS odds decoding** — mapear formato de OD/PA/HA fields em tempo real

---

## 6. Referência de Formatos

### Odd Fracionária → Decimal
| Fracionária | Decimal |
|-------------|---------|
| 4/5 | 1.80 |
| 1/1 (evens) | 2.00 |
| 6/4 | 2.50 |
| 2/1 | 3.00 |

### Market Types (mt)
| ID | Tipo (provável) |
|----|-----------------|
| 11 | Handicap Asiático |
| (outros a mapear) | |

### Classification IDs (c)
| ID | Esporte (provável) |
|----|---------------------|
| 18 | eSports / Cyber |
| (outros a mapear) | |
