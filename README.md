# Sheva Platform

Plataforma estatistica para analise de ligas, jogadores, confrontos diretos, metodos configuraveis e backtests sobre historico esportivo em MySQL.

## Arquitetura

- `apps/api` — API REST em Node.js, Express, Prisma e Zod (porta **4013**)
- `apps/portal` — Painel operacional em Next.js 15 (porta **3005**)
- `apps/web` — Frontend publico em Next.js, React, TypeScript e Tailwind
- `Sheva/packages/shared` — Contratos compartilhados, modelos de metodos e utilitarios de dominio

## Rodando localmente

1. Copie `.env.example` para `.env` na raiz.
2. Ajuste `DATABASE_URL` para sua base MySQL.
3. Instale dependencias com `npm install`.
4. Gere o client Prisma com `npm run prisma:generate`.
5. Rode o ambiente completo com `npm run dev`.

Se preferir subir os servicos separadamente:

- API: `npm run dev:api` → http://localhost:4013
- Portal: `npm run dev:portal` → http://localhost:3005
- Web: `npm run dev:web`

## Tasks do VS Code

O workspace ja possui tasks configuradas em `.vscode/tasks.json` para o fluxo local:

- `Prisma: Generate` — gera o client Prisma antes do primeiro boot ou depois de mudancas no schema.
- `Dev: Monorepo` — sobe API e frontend em paralelo.
- `Dev: API Only` — sobe apenas a API (porta 4013).
- `Dev: Web Only` — sobe apenas o frontend publico.
- `Dev: Portal Only` — sobe apenas o portal operacional (porta 3005).

## Debug no VS Code

O workspace tambem possui launch configurado em `.vscode/launch.json`:

- `API: Debug Server` — depura o backend Node com `tsx`.
- `Web: Debug Next.js` — sobe o frontend e abre o navegador de debug.
- `Full Stack: Debug` — inicia API e web juntos para depuracao integrada.

## Integracao com MySQL

O projeto conecta numa base MySQL remota via Prisma.

1. Configurar `DATABASE_URL` no `.env` (veja `.env.example` para o formato).
2. Validar a conexao via `GET /api/health/db`.
3. Para introspectar o schema: `npm run prisma:pull`, depois `npm run prisma:generate`.

## ODBC (opcional)

Se a fonte esta exposta por ODBC no Windows, o backend aceita como fonte auxiliar.

1. Configure `MYSQL_ODBC_CONNECTION_STRING` no `.env` (veja `.env.example`).
2. Teste via `GET /api/source/health`.
3. Inspecione tabelas em `GET /api/source/schema`.

> Prisma usa conexao nativa MySQL, nao ODBC. A camada ODBC serve apenas para descoberta/validacao.

## Deploy

Veja `scripts/deploy.sh` para deploy automatizado em VPS Ubuntu e `scripts/nginx-sheva.conf` para a configuracao do Nginx.

## Portal Operacional (GT League)

O portal em `apps/portal` (porta 3005) exibe paineis ao vivo da GT League:

- `/esoccer/gt-league` — Live Board com confrontos do dia, taxas BTTS, Over 0.5, scorelines e historico recente.
- `/esoccer/gt-league/panorama` — Visao geral do dia operacional.
- `/esoccer/gt-league/raio-x` — Analise de taxa de acerto.
- `/esoccer/gt-league/disparidade` — Comparativo head-to-head entre jogadores.
- `/esoccer/gt-league/metodos` — Sinais passados dos metodos.

O backend roda runners em background que atualizam snapshots JSON a cada 30 segundos.

## Extensoes Recomendadas

O `.vscode/extensions.json` lista as extensoes recomendadas para o workspace:

- **Prisma** — syntax highlighting e formatacao para arquivos `.prisma`
- **Error Lens** — erros e warnings inline no editor
- **Pretty TypeScript Errors** — erros de TypeScript legiveis
- **GitLens** — blame inline e historico de arquivos
- **Thunder Client** — testar endpoints REST direto no VS Code
- **Database Client** — navegar e consultar MySQL sem sair do editor
- **Turbo Console Log** — inserir console.log contextualizado via `Ctrl+Alt+L`
- **Todo Tree** — localizar TODO/FIXME/HACK espalhados pelo projeto

## Direcao tecnica

- Separacao entre dominio estatistico e engine de metodos
- Endpoints REST focados em leitura agregada
- Prisma como camada de acesso e schema adaptavel a base existente
- Estrutura preparada para caches materializados e sumarizacao futura
