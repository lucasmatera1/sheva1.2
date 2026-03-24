# Analytics Architecture

## Objetivo

Concentrar a inteligencia estatistica em uma camada unica, previsivel e preparada para exposicao via API, sem acoplar o frontend ao arquivo monolitico live-analytics.

## Camadas

### Repository

- `apps/api/src/core/analytics/repository.ts`
- Responsavel por ler fixtures reais, normalizar ligas e devolver `AnalyticsMatch[]`.

### Domain Analytics

- `streaks.ts`
- `windows.ts`
- `schedule.ts`
- `h2h.ts`
- `bankroll.ts`
- `tilt.ts`
- `risk.ts`
- `scoring.ts`

Cada modulo calcula apenas um recorte estatistico e recebe dados ja normalizados.

### Service Facade

- `apps/api/src/core/analytics/service.ts`
- Orquestra filtros, overview consolidado, envelopes de resposta e observacoes de dominio.

### Contracts

- `apps/api/src/core/analytics/contracts.ts`
- Define requests e responses da futura API `/api/analytics`.

## Proxima Exposicao de API

Rotas previstas:

- `GET /api/analytics/overview`
- `GET /api/analytics/schedule`
- `GET /api/analytics/tilt`
- `GET /api/analytics/h2h`
- `GET /api/analytics/risk`

## Decisoes

- O bankroll da primeira versao permanece `simulated` por nao existir lucro por partida nas fixtures.
- O filtro `onlyCompletedSessions` fica declarado no contrato, mas depende de integracao futura com `player_daily_history_sessions`.
- O frontend deve consumir envelopes estaveis com `filters`, `meta` e `data`.