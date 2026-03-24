# Sheva Platform

Plataforma estatistica para analise de ligas, jogadores, confrontos diretos, metodos configuraveis e backtests sobre historico esportivo em MySQL.

## Arquitetura

- apps/web: frontend em Next.js, React, TypeScript e Tailwind
- apps/api: API REST em Node.js, Express, Prisma e Zod
- packages/shared: contratos compartilhados, modelos de metodos e utilitarios de dominio

## Modulos iniciais

- Dashboard geral
- Ligas e campeonatos
- Jogadores
- H2H
- Metodos configuraveis
- Backtest com stake fixa

## Rodando localmente

1. Copie `.env.example` para `.env` na raiz.
2. Ajuste `DATABASE_URL` para sua base MySQL.
3. Instale dependencias com `npm install`.
4. Gere o client Prisma com `npm run prisma:generate`.
5. Rode o ambiente completo com `npm run dev`.

Se preferir subir os servicos separadamente:

1. Rode a API com `npm run dev:api` na porta 4003.
2. Rode o frontend com `npm run dev:web` na porta 3004.

Padrao local deste projeto:

- API: http://localhost:4003
- Frontend: http://localhost:3004

## Tasks do VS Code

O workspace ja possui tasks configuradas em `.vscode/tasks.json` para o fluxo local:

- `Prisma: Generate`: gera o client Prisma antes do primeiro boot ou depois de mudancas no schema.
- `Dev: Monorepo`: sobe API e frontend em paralelo.
- `Dev: API Only`: sobe apenas a API.
- `Dev: Web Only`: sobe apenas o frontend.

## Debug no VS Code

O workspace tambem possui launch configurado em `.vscode/launch.json`:

- `API: Debug Server`: depura o backend Node com `tsx`.
- `Web: Debug Next.js`: sobe o frontend e abre o navegador de debug.
- `Full Stack: Debug`: inicia API e web juntos para depuracao integrada.

## Integracao com MySQL existente

O projeto ja esta preparado para conectar numa base MySQL real. O que falta para integrar "a porra toda" de verdade e somente plugar a sua conexao e alinhar o schema com as tabelas reais existentes.

1. Criar o arquivo `.env` na raiz com a sua conexao real:
	`DATABASE_URL="mysql://usuario:senha@host:3306/nome_do_banco"`
2. Validar se a API enxerga a conexao em [apps/api/src/app.ts](apps/api/src/app.ts) pela rota `GET /api/health/db`.
3. Rodar `npm run prisma:pull` para introspectar a estrutura real do MySQL existente.
4. Revisar [apps/api/prisma/schema.prisma](apps/api/prisma/schema.prisma) e aplicar `@@map` e `@map` se os nomes reais do banco forem diferentes do modelo de dominio.
5. Rodar `npm run prisma:generate` para regenerar o client apos a introspecao.
6. Substituir progressivamente os mocks pelos repositórios reais baseados no schema introspectado.

## Integracao com MySQL ODBC 9.3

Se a sua fonte esta exposta por ODBC 9.3 no Windows, o backend agora aceita essa entrada como fonte externa.

1. Configure no `.env`:
	`MYSQL_ODBC_CONNECTION_STRING="DSN=MyMysql93Source;UID=usuario;PWD=senha;DATABASE=nome_do_banco"`
2. Se precisar, informe explicitamente o schema:
	`MYSQL_ODBC_SCHEMA="nome_do_banco"`
3. Teste a conexao da fonte em `GET /api/source/health`.
4. Inspecione as tabelas reais em `GET /api/source/schema`.

Ponto tecnico importante: Prisma nao usa ODBC. Ele usa conexao nativa MySQL. Entao a arquitetura correta fica assim:

- ODBC: usado para descobrir e validar a fonte externa existente.
- Prisma: usado como camada principal do dominio quando tivermos a conexao MySQL nativa ou um schema mapeado de forma confiavel.

Se voce tiver apenas DSN ODBC e nao tiver host, porta, usuario e senha em formato MySQL, eu ainda consigo inspecionar e mapear a base pela rota de schema. O passo seguinte sera ligar os repositórios aos nomes reais das tabelas dessa fonte.

## Estado atual da integracao

- Sem `DATABASE_URL`, a API sobe em modo mock para o frontend continuar evoluindo.
- Com `DATABASE_URL`, a API ja passa a operar em modo live e a rota `GET /api/health/db` mostra se a conexao esta valida.
- O proximo passo tecnico real e introspectar sua base existente, porque hoje eu ainda nao tenho os nomes reais de tabelas, colunas, indices e relacionamentos.

## Direcao tecnica

- Separacao entre dominio estatistico e engine de metodos
- Endpoints REST focados em leitura agregada
- Prisma como camada de acesso e schema inicial adaptavel a base existente
- Estrutura preparada para caches materializados e sumarizacao futura
