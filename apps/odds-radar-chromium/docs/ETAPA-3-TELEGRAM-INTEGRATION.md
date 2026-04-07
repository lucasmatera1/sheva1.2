# 📡 Etapa 3 — Integração Telegram (Auto-Bet com CDP Trusted Events)

> Última atualização: 2026-03-25 — Session 7: Lifecycle fix + Speed optimizations + Bot funcional ouvindo Telegram

## Contexto

Na Etapa 2, o `test_multi_bet.py` provou com **3/3 apostas aceitas** que o fluxo via `page.mouse.click()` (CDP trusted events) funciona perfeitamente. Porém, o `bet_telegram.py` (listener Telegram) ainda usava `_js_click_at()` que gera `isTrusted:false` — **Bet365 ignora esses eventos**.

## Problema Raiz

| Método | Evento | isTrusted | Bet365 |
|--------|--------|-----------|--------|
| `page.mouse.click()` | CDP Input.dispatchMouseEvent | `true` | ✅ Aceita |
| `el.click()` / `_js_click_at()` | JS Event() | `false` | ❌ Ignora |

O `bet_telegram.py` usava `_js_click_at()` em **todas** as interações de aposta — seleção de odds, fill stake, click place bet. Resultado: **0% de aceite**.

## Solução

Refatorar `bet_telegram.py` para usar `UIBetPlacer` — a mesma classe que deu 3/3 no `test_multi_bet.py`.

---

## Arquitetura Refatorada

```
┌──────────────────────────────────────────────────────────────┐
│                    bet_telegram.py (main)                     │
├──────────────────────────────────────────────────────────────┤
│                                                              │
│  Etapa 1: Login + Warm-up                                    │
│  ├─ setup_browser() → Camoufox + geo stealth                │
│  ├─ full_session_init()                                      │
│  │   ├─ load_cookies → page.goto → ensure_logged_in         │
│  │   ├─ accept_cookies + click_continuar + dismiss_popups    │
│  │   ├─ geo inject (evaluate + frame listeners)              │
│  │   ├─ navigate #/IP/B18 (eSports Basketball)              │
│  │   └─ UIBetPlacer.warm_up_stake(STAKE) → Lembrar          │
│  │       retorna: None=falha login, True/False=warmup_ok     │
│  └─ UIBetPlacer(page) → instância para sinais               │
│                                                              │
│  Etapa 2: Tokens + Keep-alive                                │
│  ├─ TokenHarvester.full_extract() → gwt, pstk, sync_term    │
│  ├─ BetInterceptor.install() → intercepta HTTP              │
│  └─ keep_current_page_alive() → scroll + login check        │
│                                                              │
│  Etapa 3: Telegram → Auto-Bet                                │
│  ├─ TelegramClient (Telethon) → ouve grupo(s)               │
│  ├─ parse_signal(text) → BetSignal dict                      │
│  ├─ SafetyGuard.check(stake, odd) → allowed?                │
│  └─ UIBetPlacer.place_bet_by_signal()                        │
│      ├─ dismiss_overlays                                     │
│      ├─ clean_betslip                                        │
│      ├─ find_odds_by_player(name, market, line, odd)         │
│      ├─ click_odds (CDP page.mouse.click)                    │
│      ├─ wait_addbet (betslip open)                           │
│      ├─ fill_stake (skip_if_remembered)                      │
│      ├─ click_place_bet (+ auto-accept alteração)            │
│      ├─ wait_placebet → UIBetResult                          │
│      ├─ deselect_odds                                        │
│      └─ close_betslip                                        │
│                                                              │
│  Hard Reset entre apostas:                                   │
│  └─ #/IP → Escape → #/IP/B18 → dismiss_overlays             │
│                                                              │
│  Re-login automático:                                        │
│  └─ _re_login_loop() → detecta logout → full_session_init   │
│      → recria UIBetPlacer(page)                              │
│                                                              │
└──────────────────────────────────────────────────────────────┘
```

---

## Mudanças Realizadas

### 1. `src/betting/ui_placer.py` — Novos Métodos

#### `find_odds_by_player(player_name, market, line, target_odd)`
- Busca na overview (#/IP/B18) pelo nome do jogador
- Percorre grid de participantes usando JS evaluate
- Identifica célula de odds correta por mercado (HC/Under/Over) e linha
- Retorna `{x, y, oddVal, text, player, col}` para CDP click
- Fallback: DOM tree walker se seletores CSS falharem

#### `place_bet_by_signal(signal, stake, skip_if_remembered, max_odd_drop)`
- Fluxo completo: sinal Telegram → aposta confirmada
- Usa **exclusivamente** `page.mouse.click()` (CDP trusted)
- Valida queda de odd antes de apostar
- Inclui cleanup automático (deselect + close betslip)
- Retorna `UIBetResult` com sr, cs, receipt, odds, error

### 2. `scripts/bet_telegram.py` — Refatoração

| Componente | Antes | Depois |
|------------|-------|--------|
| **Import** | — | `from src.betting.ui_placer import UIBetPlacer` |
| **warm_up()** | Própria implementação (JS clicks) | `UIBetPlacer.warm_up_stake(STAKE)` |
| **Tela base** | `#/IP/FAV/` | `#/IP/B18` (eSports Basketball) |
| **_handle_signal** | `fast_bet_overview()` com `_js_click_at()` | `UIBetPlacer.place_bet_by_signal()` |
| **Cleanup** | JS evaluate para Done/Remove/Close | `deselect_odds + close_betslip + hard reset` |
| **--test mode** | `fast_bet()` | `UIBetPlacer.place_bet_by_signal()` |
| **re-login** | Recreia `SafetyGuard` | Recria `UIBetPlacer(page)` + propaga `warmup_ok` |
| **return type** | `True`/`False` | `None`=falha login, `True`/`False`=warmup_ok |

### 3. Fluxo de Uma Aposta (CDP Trusted)

```
Sinal Telegram recebido
  │
  ├─ parse_signal(text) → signal dict
  ├─ SafetyGuard.check(stake, odd) → allowed
  ├─ Navega #/IP/B18 + dismiss_overlays
  │
  ├─ ui.place_bet_by_signal(signal, stake, ...)
  │   ├─ find_odds_by_player("TRICKSTER", "HC", "+4.5", 1.83)
  │   │   └─ JS evaluate: percorre grid → retorna {x, y}
  │   ├─ page.mouse.click(x, y)     ← CDP trusted ✅
  │   ├─ wait_addbet (betslip abre)
  │   ├─ fill_stake(25.00)           ← triple-click + type
  │   ├─ click_place_bet()           ← CDP trusted ✅
  │   │   └─ auto-accept "Aceitar Alteração" se aparecer
  │   ├─ wait_placebet → sr=0 ✅
  │   ├─ deselect_odds()
  │   └─ close_betslip()
  │
  └─ Hard reset: #/IP → Escape → #/IP/B18 → dismiss
```

### 4. Tratamento de Erros

| Cenário | Ação |
|---------|------|
| Timeout 25s | Escape ×3 + hard reset (#/IP → #/IP/B18) |
| Exceção no place_bet | Hard reset de recuperação |
| Aposta rejeitada (sr≠0) | Log + hard reset (pronto para próximo sinal) |
| Logout detectado | `_re_login_loop()` → full_session_init + novo UIBetPlacer |
| Browser crash | Reabre browser + full_session_init |

---

## Formatos de Sinal Aceitos

```
# HC (Handicap)
🎯 TRICKSTER +4.5 @1.83
🏀 TRICKSTER vs PROWLER

# Under
📉 UNDER 110.5 @1.83
🏀 TRICKSTER vs PROWLER

# Over
📈 OVER 110.5 @1.83
🏀 TRICKSTER vs PROWLER
```

## Uso

```bash
# Setup (primeira vez)
python scripts/bet_telegram.py --setup

# Teste (simula sinal sem Telegram)
python scripts/bet_telegram.py --test "🎯 TRICKSTER +4.5 @1.83\n🏀 TRICKSTER vs PROWLER"

# Produção (ouve grupo Telegram)
python scripts/bet_telegram.py
```

## Código Legado (Dead Code)

As seguintes funções em `bet_telegram.py` são **dead code** — não são mais chamadas pelo fluxo principal, mas foram mantidas por compatibilidade:

- `fast_bet()`, `fast_bet_overview()`, `fast_bet_by_search()`, `fast_bet_by_search_live()`
- `fast_bet_current_page()`, `warm_up()`, `_js_click_at()`

Todas usam `isTrusted:false` e **não devem ser restauradas** no fluxo principal.

---

## Próximos Passos

- [x] ~~Refatoração `bet_telegram.py` → UIBetPlacer (CDP trusted)~~
- [x] ~~Lifecycle fix: `_close_browser(cm)` helper, 5-tuple return~~
- [x] ~~Speed optimizations: polling 0.15s, smart hash nav, reduced sleeps~~
- [x] ~~Bot testado: login OK, geo OK, gwt OK, warm-up OK, sinal recebido~~
- [ ] Teste end-to-end com aposta aceita via sinal Telegram (addbet timeout no primeiro teste — jogo em lock)
- [ ] Monitorar taxa de aceitação (target: >90%)
- [ ] Avaliar MAX_ODD_DROP (0.15 atual — primeiro sinal teve drop 0.35)
- [ ] Avaliar removal do dead code se fluxo se provar estável
- [ ] Considerar múltiplos mercados simultâneos (Under + HC na mesma partida)
