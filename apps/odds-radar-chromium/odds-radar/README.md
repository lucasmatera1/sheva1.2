# 🎯 Sheva Odds Radar

Radar de odds em tempo real para Bet365 usando **Camoufox** (Firefox stealth) + notificações via **Telegram**.

---

## 📐 Arquitetura

```
apps/odds-radar/
├── config/
│   └── settings.py          # Configurações centralizadas (.env)
├── src/
│   ├── browser/
│   │   ├── engine.py         # Motor Camoufox + comportamento humano
│   │   └── session.py        # Persistência de cookies
│   ├── scraper/
│   │   ├── bet365.py         # Navegação + extração de odds
│   │   └── parsers.py        # Parse de DOM → dados estruturados
│   ├── telegram/
│   │   └── bot.py            # Envio de alertas formatados
│   ├── models/
│   │   └── odds.py           # Dataclasses (Match, OddValue, etc.)
│   ├── utils/
│   │   └── logger.py         # Logging com loguru
│   └── main.py               # Loop principal do radar
├── scripts/
│   ├── single_scan.py        # Teste scan único
│   └── test_telegram.py      # Teste conexão Telegram
├── .env.example              # Template de variáveis
├── requirements.txt          # Dependências Python
└── README.md                 # Este arquivo
```

### Fluxo de Dados

```
[Camoufox Browser] → [Bet365 DOM] → [Parser] → [OddsSnapshot] → [Telegram Bot]
        ↑                                              ↓
   [Stealth +                                   [Cache de Odds]
    Humanize +                                   (detecta movimento)
    Proxy Rotativo]
```

---

## 🚀 Setup Rápido

### 1. Pré-requisitos

- **Python 3.11+**
- **pip** ou **uv** (recomendado)

### 2. Instalar dependências

```bash
cd apps/odds-radar

# Com pip
pip install -r requirements.txt

# Ou com uv (mais rápido)
uv pip install -r requirements.txt
```

### 3. Instalar o Camoufox (browser)

```bash
# Baixa o binário do Firefox modificado (~90MB)
python -m camoufox fetch
```

### 4. Configurar variáveis de ambiente

```bash
cp .env.example .env
# Editar .env com suas credenciais
```

### 5. Testar Telegram

```bash
python scripts/test_telegram.py
```

### 6. Rodar scan único (teste)

```bash
python scripts/single_scan.py
```

### 7. Iniciar o Radar (loop contínuo)

```bash
python src/main.py
```

---

## ⚙️ Configuração (.env)

| Variável | Descrição | Default |
|---|---|---|
| `BROWSER_HEADLESS` | Rodar sem janela | `true` |
| `PROXY_SERVER` | Proxy residencial (ex: `socks5://ip:port`) | — |
| `PROXY_USERNAME` | User do proxy | — |
| `PROXY_PASSWORD` | Senha do proxy | — |
| `BROWSER_HUMANIZE` | Simular comportamento humano | `true` |
| `PAGE_TIMEOUT_MS` | Timeout de carregamento | `60000` |
| `TELEGRAM_BOT_TOKEN` | Token do bot (via @BotFather) | — |
| `TELEGRAM_CHAT_ID` | ID do chat/grupo | — |
| `BET365_URL` | URL base | `https://www.bet365.bet.br` |
| `SCAN_INTERVAL_SEC` | Intervalo entre scans | `30` |
| `SPORTS` | Esportes (comma-separated) | `soccer` |
| `MIN_ODD` / `MAX_ODD` | Filtro de range | `1.01` / `10.0` |
| `TARGET_LEAGUES` | Ligas alvo (comma-separated) | todas |
| `LOG_LEVEL` | Nível de log | `INFO` |

---

## 🛡️ Anti-Detecção — Estratégias & Notas

O Bet365 usa **múltiplas camadas** de defesa anti-bot. Aqui está o que o projeto cobre e o que você precisa complementar:

### ✅ O que o Camoufox resolve sozinho

| Proteção | Status |
|---|---|
| Canvas fingerprinting | ✅ Randomizado |
| WebGL fingerprinting | ✅ Spoofado |
| navigator.webdriver | ✅ Removido |
| User-Agent consistency | ✅ Browser real |
| Font enumeration | ✅ Perfil nativo |
| Audio fingerprinting | ✅ Randomizado |
| Timezone/locale | ✅ Via geoip do proxy |

### ⚠️ O que você precisa configurar

| Proteção | Solução |
|---|---|
| **IP residencial** | Use proxy residencial rotativo (Bright Data, IPRoyal, Smartproxy). IPs de datacenter são bloqueados instantaneamente. |
| **Cloudflare Challenge** | O Camoufox headful passa na maioria. Em headless, pode precisar de solver externo. |
| **Rate limiting** | Configure `SCAN_INTERVAL_SEC` ≥ 30s. Evite scans muito frequentes. |
| **Behavioral analysis** | `BROWSER_HUMANIZE=true` + delays aleatórios já ajudam. |
| **Cookie/session tracking** | O projeto persiste cookies entre execuções. |
| **WebSocket interception** | Avançado — ver seção abaixo. |

### 🔴 O que NÃO está coberto (futuro)

| Item | Notas |
|---|---|
| **Captcha solving** | Integrar com 2Captcha ou CapSolver quando aparecer |
| **Fingerprint rotation** | Hoje usa 1 perfil fixo. Idealmente rotacionar a cada N ciclos |
| **Multi-session** | Rodar vários browsers em paralelo para cobrir mais esportes |
| **WebSocket sniffing** | Bet365 carrega odds via WS. Interceptar WS frames seria mais eficiente que DOM parsing |

---

## 🧠 Sugestões Táticas para Operar sem Bloqueio

### 1. Proxy Residencial é OBRIGATÓRIO

```
# Exemplo de config no .env com proxy rotativo
PROXY_SERVER=socks5://gate.smartproxy.com:7000
PROXY_USERNAME=user123
PROXY_PASSWORD=pass456
```

Serviços recomendados:
- **Bright Data** — maior pool de IPs, geo-targeting granular
- **IPRoyal** — bom custo, IPs brasileiros disponíveis
- **Smartproxy** — boa API, rotação automática

> IPs brasileiros são essenciais para acessar `bet365.bet.br` sem redirect.

### 2. Rode Headful em VPS

Modo headless é mais detectável. Configure um VPS Linux com:
- Xvfb (display virtual)
- `BROWSER_HEADLESS=false`
- VNC para monitorar remotamente

```bash
# No VPS
Xvfb :99 -screen 0 1366x768x24 &
export DISPLAY=:99
python src/main.py
```

### 3. Intervalo Humanizado

O config `SCAN_INTERVAL_SEC=30` é mínimo. Para uso contínuo, 45-90s é mais seguro. O sistema adiciona jitter aleatório automaticamente.

### 4. Sessão Persistente

O bot salva cookies entre execuções. Primeiro acesso será mais lento (Cloudflare challenge). Depois, as sessões são reutilizadas.

### 5. Evite Padrões Detectáveis

- **NÃO** rode 24/7 sem pausas — programe janelas (ex: 6h ligado, 2h off)
- **NÃO** acesse páginas em ordem sequencial sempre igual
- **NÃO** use resolução incomum (o default 1366x768 é o mais comum)
- **SIM** varie os esportes e ligas em cada ciclo

### 6. Interceptação de WebSocket (Avançado)

Bet365 transmite odds via WebSocket. Capturar esses frames elimina a necessidade de parse DOM:

```python
# Futuro: interceptar WS no Playwright
page.on("websocket", lambda ws: ws.on("framereceived", handle_frame))
```

Isso seria a evolução natural do projeto para ser mais resiliente a mudanças de DOM.

---

## 📱 Configuração do Telegram

### Criar o Bot

1. Abra o Telegram e fale com `@BotFather`
2. Envie `/newbot` e siga as instruções
3. Copie o **token** para `TELEGRAM_BOT_TOKEN`

### Obter Chat ID

1. Adicione o bot a um grupo (ou abra conversa privada)
2. Envie uma mensagem qualquer
3. Acesse: `https://api.telegram.org/bot<TOKEN>/getUpdates`
4. Copie o `chat.id` para `TELEGRAM_CHAT_ID`

### Formato das Mensagens

O bot envia mensagens formatadas como:

```
🏆 Premier League

⚽ Arsenal vs Chelsea [2-1] ⏱ 67'
   Home: 1.45 📉
   Draw: 4.20
   Away: 6.50 📈
   🔗 Abrir

🚨 ALERTA DE ODD — Odd Home moveu 15%
⚽ Arsenal vs Chelsea
📊 Home 1.45 | Draw 4.20 | Away 6.50
🔗 Abrir
```

---

## 🔧 Manutenção

### Seletores CSS quebraram?

O Bet365 ofusca e muda seletores frequentemente. Quando o scraper parar de encontrar dados:

1. Abra o site manualmente (`BROWSER_HEADLESS=false`)
2. Use DevTools (F12) para inspecionar os novos seletores
3. Atualize o dicionário `SEL` em `src/scraper/bet365.py`

### Logs

Logs rotativos em `logs/radar_YYYY-MM-DD.log`. Últimos 7 dias mantidos.

### Dados

Cookies persistidos em `.browser_data/cookies.json`.

---

## 📋 Roadmap

- [ ] **Captcha solver** — integrar 2Captcha/CapSolver
- [ ] **WebSocket interception** — capturar odds via WS em vez de DOM
- [ ] **Multi-browser** — rodar N instâncias em paralelo
- [ ] **Fingerprint rotation** — rotacionar perfis de browser
- [ ] **Database** — salvar histórico de odds localmente (SQLite)
- [ ] **Dashboard web** — visualizar odds em tempo real
- [ ] **Bet placement** — automatizar apostas (API ou DOM)
- [ ] **Estratégias** — módulo de regras configuráveis para alertas

---

## ⚖️ Aviso Legal

Este projeto é para fins **educacionais e de pesquisa**. O uso de bots e scrapers pode violar os Termos de Serviço do Bet365. Use por sua conta e risco. O autor não se responsabiliza por uso indevido.
