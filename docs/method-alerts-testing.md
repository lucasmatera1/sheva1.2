# Alertas de Metodo

O backend de alertas esta exposto em /api/alerts, mas a criacao das tabelas no banco ainda depende de permissao de CREATE no MySQL.

## Payloads prontos

- Criar regra GT 4D: [docs/examples/alerts/create-rule-gt-4d.json](docs/examples/alerts/create-rule-gt-4d.json)
- Criar regra GT 4D+: [docs/examples/alerts/create-rule-gt-4dplus.json](docs/examples/alerts/create-rule-gt-4dplus.json)
- Criar regra GT 4D via Telegram: [docs/examples/alerts/create-rule-telegram.json](docs/examples/alerts/create-rule-telegram.json)
- Rodar avaliacao sem disparo real: [docs/examples/alerts/run-rules-dry-run.json](docs/examples/alerts/run-rules-dry-run.json)

## PowerShell

Criar uma regra:

```powershell
Invoke-RestMethod \
  -Method Post \
  -Uri "http://localhost:4003/api/alerts/rules" \
  -ContentType "application/json" \
  -InFile "D:\Sheva\docs\examples\alerts\create-rule-gt-4d.json"
```

Criar uma regra para 4D+:

```powershell
Invoke-RestMethod \
  -Method Post \
  -Uri "http://localhost:4003/api/alerts/rules" \
  -ContentType "application/json" \
  -InFile "D:\Sheva\docs\examples\alerts\create-rule-gt-4dplus.json"
```

Criar uma regra para Telegram:

```powershell
Invoke-RestMethod \
  -Method Post \
  -Uri "http://localhost:4003/api/alerts/rules" \
  -ContentType "application/json" \
  -InFile "D:\Sheva\docs\examples\alerts\create-rule-telegram.json"
```

Rodar avaliacao manual em dry-run:

```powershell
Invoke-RestMethod \
  -Method Post \
  -Uri "http://localhost:4003/api/alerts/run" \
  -ContentType "application/json" \
  -InFile "D:\Sheva\docs\examples\alerts\run-rules-dry-run.json"
```

Listar regras:

```powershell
Invoke-RestMethod \
  -Method Get \
  -Uri "http://localhost:4003/api/alerts/rules"
```

Listar disparos:

```powershell
Invoke-RestMethod \
  -Method Get \
  -Uri "http://localhost:4003/api/alerts/dispatches?limit=20"
```

## Teste do webhook

Para validar o payload antes de apontar para o WhatsApp real, voce pode usar o coletor local ja embutido na API:

- POST local: /api/alerts/webhook-debug
- Leitura dos eventos: /api/alerts/webhook-debug/events
- Limpeza dos eventos: DELETE /api/alerts/webhook-debug/events

Exemplo em PowerShell:

```powershell
Invoke-RestMethod \
  -Method Post \
  -Uri "http://localhost:4003/api/alerts/webhook-debug" \
  -ContentType "application/json" \
  -Body '{"source":"manual-test","message":"payload local de teste","signal":{"confrontationLabel":"Ronaldo x Romario","apx":66.67}}'
```

Depois consulte o historico capturado:

```powershell
Invoke-RestMethod \
  -Method Get \
  -Uri "http://localhost:4003/api/alerts/webhook-debug/events"
```

Se preferir, ainda pode usar uma URL temporaria externa de inspeccao HTTP, como um request bin interno ou um endpoint dedicado do seu integrador.

Estrutura esperada do POST enviado pelo backend:

```json
{
  "source": "manual",
  "rule": {
    "id": "1",
    "name": "GT Serie A 4D acima de 63%",
    "isActive": true,
    "leagueType": "GT LEAGUE",
    "methodCode": "(4D)",
    "series": "A",
    "apxMin": 63,
    "minOccurrences": 8,
    "windowDays": 30,
    "recipients": ["+5511999999999"],
    "webhookUrl": "https://seu-bridge-whatsapp.exemplo/alerts/methods",
    "note": "Primeira regra para GT Serie A no metodo 4D",
    "createdAt": "2026-03-12T00:00:00.000Z",
    "updatedAt": "2026-03-12T00:00:00.000Z",
    "lastEvaluatedAt": null
  },
  "signal": {
    "signalKey": "ronaldo||romario::123456",
    "confrontationKey": "ronaldo||romario",
    "confrontationLabel": "Ronaldo x Romario",
    "dayKey": "2026-03-12",
    "occurrenceMatchId": "123456",
    "occurrencePlayedAt": "2026-03-12T18:30:00.000Z",
    "localPlayedAtLabel": "12/03/2026 15:30",
    "result": "W",
    "fullTimeScore": "3x1",
    "apx": 66.67,
    "totalOccurrences": 12
  },
  "recipients": ["+5511999999999"],
  "message": "Metodo em sinal: GT Serie A 4D acima de 63%"
}
```

## Telegram

Para o primeiro teste real, use um chat privado com o bot.

1. Crie o bot no BotFather e guarde o token.
2. Abra conversa com o bot e clique em Start.
3. Descubra o chat_id do seu privado.
4. Configure no .env raiz:

```env
TELEGRAM_BOT_TOKEN=123456:ABCDEF...
TELEGRAM_DEFAULT_CHAT_IDS=123456789
```

Enviar uma mensagem de teste diretamente pela API:

```powershell
Invoke-RestMethod \
  -Method Post \
  -Uri "http://localhost:4003/api/alerts/telegram/test" \
  -ContentType "application/json" \
  -Body (@{
    chatIds = @("123456789")
    message = "Teste Telegram do Sheva"
  } | ConvertTo-Json)
```

Se preferir grupo, adicione o bot ao grupo e use o chat_id do grupo, normalmente no formato negativo, por exemplo -1001234567890.

## Registro em Google Sheets

O caminho mais simples e robusto e espelhar cada dispatch do Telegram para um Web App do Google Apps Script. Assim, o alerta continua sendo enviado normalmente mesmo se a planilha falhar, e a planilha vira apenas um log operacional.

## Fluxo operacional rapido

Use esta ordem sempre que precisar validar ou reconfigurar a integracao:

1. Atualize o Apps Script e reimplante com `Nova versão`.
2. Confira se a aba correta e `Março/2026` e se o cabecalho inclui `eventType` e `rootSignalKey`.
3. Confirme a URL em `ALERTS_GOOGLE_SHEETS_WEBHOOK_URL` no `.env` raiz.
4. Reinicie a API depois de qualquer alteracao no `.env`.
5. Mantenha apenas uma instancia da API rodando na porta `4003`.
6. Valide primeiro com `POST /api/alerts/google-sheets/test`.
7. So depois rode um ciclo manual completo com `test-future-dispatch` e `test-future-resolve`.

Checklist de validacao:

1. O teste rapido do Google Sheets deve devolver `status: 200`, `ok: true` e `responseText: {"ok":true}`.
2. O dispatch inicial deve aparecer na planilha com `eventType = initial_signal`.
3. O follow-up deve atualizar a mesma linha com `eventType = result_followup`.
4. O Telegram deve registrar `edited <message_id>` no acompanhamento final.

1. Crie uma planilha no Google Sheets.
2. Abra Extensoes > Apps Script.
3. Cole o script abaixo.
4. Ajuste o nome da aba em `SHEET_NAME` para a aba real da planilha. No ambiente atual, o valor validado foi `Março/2026`.
5. Publique como Web App com acesso para `Anyone with the link`.
6. Copie a URL publicada e configure no `.env` raiz:

```env
ALERTS_GOOGLE_SHEETS_WEBHOOK_URL=https://script.google.com/macros/s/SEU_WEBAPP_ID/exec
```

Importante:

1. Salvar o codigo no editor do Apps Script nao basta.
2. Depois de cada alteracao voce precisa reimplantar o Web App em `Implantar > Gerenciar implantações > Editar`, selecionando `Nova versão`.
3. Se a planilha continuar com cabecalho antigo, como `referenceLabel`, sem `eventType` e `rootSignalKey`, a URL publicada ainda esta apontando para a versao antiga do script.
4. Se voce trocar o `.env`, reinicie a API.
5. Se houver duas instancias da API na porta `4003`, os testes podem usar configuracoes antigas.

Teste rapido do webhook do Google Sheets sem disparar alerta real:

```powershell
Invoke-RestMethod \
  -Method Post \
  -Uri "http://localhost:4003/api/alerts/google-sheets/test" \
  -ContentType "application/json" \
  -Body (@{
    confrontationLabel = "TESTE GOOGLE SHEETS x ALERTAS"
  } | ConvertTo-Json)
```

Esse endpoint devolve `status`, `ok`, `redirected`, `finalUrl` e `responseText`, alem do payload enviado. Use esse teste para validar rapidamente a URL configurada em `ALERTS_GOOGLE_SHEETS_WEBHOOK_URL` antes de disparar um alerta real ou um ciclo futuro completo.

Apps Script sugerido:

```javascript
const SHEET_NAME = 'Março/2026';
const HEADER = [
  'loggedAt',
  'sentAt',
  'transportStatus',
  'source',
  'eventType',
  'ruleId',
  'ruleName',
  'leagueType',
  'methodCode',
  'series',
  'signalKey',
  'rootSignalKey',
  'confrontationLabel',
  'fixtureLabel',
  'groupLabel',
  'playerName',
  'opponentName',
  'initialApx',
  'currentApx',
  'apxDelta',
  'initialTotalOccurrences',
  'currentTotalOccurrences',
  'result',
  'fullTimeScore',
  'localPlayedAtLabel',
  'triggerSequence',
  'daySequence',
  'homeOdd',
  'awayOdd',
  'oddsLink',
  'oddsAppliedAt',
  'recipients',
  'transportInfo',
  'message',
];

function doPost(e) {
  const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = spreadsheet.getSheetByName(SHEET_NAME) || spreadsheet.insertSheet(SHEET_NAME);
  const headerMap = ensureHeader(sheet);

  const payload = parseIncomingPayload(e);
  const signal = payload.signal || {};
  const rule = payload.rule || {};

  const rowValues = buildRow(payload, signal, rule);
  const targetRow = findRowBySignalKeys(sheet, headerMap, signal.rootSignalKey || signal.signalKey || '', signal.signalKey || '');

  if (targetRow > 0) {
    sheet.getRange(targetRow, 1, 1, HEADER.length).setValues([rowValues]);
  } else {
    sheet.appendRow(rowValues);
  }

  return ContentService
    .createTextOutput(JSON.stringify({ ok: true }))
    .setMimeType(ContentService.MimeType.JSON);
}

function parseIncomingPayload(e) {
  const raw = e && e.postData && typeof e.postData.contents === 'string'
    ? e.postData.contents.trim()
    : '';

  if (!raw) {
    return {};
  }

  const candidates = [raw];

  if (raw.indexOf('payload=') === 0) {
    candidates.push(decodeURIComponent(raw.slice('payload='.length)));
  }

  if ((raw.startsWith('"') && raw.endsWith('"')) || (raw.startsWith("'") && raw.endsWith("'"))) {
    candidates.push(raw.slice(1, -1));
  }

  for (let index = 0; index < candidates.length; index += 1) {
    const candidate = candidates[index];

    try {
      const parsed = JSON.parse(candidate);

      if (typeof parsed === 'string') {
        try {
          return JSON.parse(parsed);
        } catch (_innerError) {
          return {};
        }
      }

      return parsed && typeof parsed === 'object' ? parsed : {};
    } catch (_error) {
      continue;
    }
  }

  return {};
}

function ensureHeader(sheet) {
  if (sheet.getLastRow() === 0) {
    sheet.appendRow(HEADER);
  } else {
    const currentHeader = sheet.getRange(1, 1, 1, Math.max(sheet.getLastColumn(), HEADER.length)).getValues()[0];
    const normalizedCurrent = currentHeader.slice(0, HEADER.length).map((value) => String(value || '').trim());
    const normalizedExpected = HEADER.map((value) => String(value || '').trim());

    if (normalizedCurrent.join('|') !== normalizedExpected.join('|')) {
      sheet.getRange(1, 1, 1, HEADER.length).setValues([HEADER]);
    }
  }

  return buildHeaderMap(sheet);
}

function buildHeaderMap(sheet) {
  const headerValues = sheet.getRange(1, 1, 1, HEADER.length).getValues()[0];
  const headerMap = {};

  headerValues.forEach((value, index) => {
    const key = String(value || '').trim();
    if (key) {
      headerMap[key] = index + 1;
    }
  });

  return headerMap;
}

function buildRow(payload, signal, rule) {
  var odds = signal.odds || {};
  return [
    payload.loggedAt || '',
    payload.sentAt || '',
    payload.transportStatus || '',
    payload.source || '',
    payload.eventType || '',
    rule.id || '',
    rule.name || '',
    rule.leagueType || '',
    rule.methodCode || '',
    rule.series || '',
    signal.signalKey || '',
    signal.rootSignalKey || signal.signalKey || '',
    signal.confrontationLabel || '',
    signal.fixtureLabel || '',
    signal.groupLabel || '',
    signal.playerName || '',
    signal.opponentName || '',
    signal.initialApx || signal.apx || '',
    signal.currentApx || signal.apx || '',
    signal.apxDelta || 0,
    signal.initialTotalOccurrences || signal.totalOccurrences || '',
    signal.currentTotalOccurrences || signal.totalOccurrences || '',
    signal.result || '',
    signal.fullTimeScore || '',
    signal.localPlayedAtLabel || '',
    (signal.triggerSequence || []).join(' '),
    (signal.daySequence || []).join(' '),
    odds.homeOdd || '',
    odds.awayOdd || '',
    odds.link || '',
    odds.appliedAt || '',
    (payload.recipients || []).join(', '),
    payload.transportInfo || '',
    payload.message || '',
  ];
}

function findRowBySignalKeys(sheet, headerMap, rootSignalKey, signalKey) {
  if ((!rootSignalKey && !signalKey) || sheet.getLastRow() <= 1) {
    return 0;
  }

  const rootSignalKeyColumn = headerMap.rootSignalKey || (HEADER.indexOf('rootSignalKey') + 1);
  const signalKeyColumn = headerMap.signalKey || (HEADER.indexOf('signalKey') + 1);
  const rowCount = sheet.getLastRow() - 1;
  const rootValues = sheet.getRange(2, rootSignalKeyColumn, rowCount, 1).getValues();
  const signalValues = sheet.getRange(2, signalKeyColumn, rowCount, 1).getValues();

  for (let index = 0; index < rowCount; index += 1) {
    const currentRootSignalKey = String(rootValues[index][0] || '').trim();
    const currentSignalKey = String(signalValues[index][0] || '').trim();

    if (rootSignalKey && currentRootSignalKey === rootSignalKey) {
      return index + 2;
    }

    if (rootSignalKey && currentSignalKey === rootSignalKey) {
      return index + 2;
    }

    if (signalKey && currentSignalKey === signalKey) {
      return index + 2;
    }
  }

  return 0;
}
```

Com essa env preenchida, cada dispatch do Telegram passa a gerar tambem um POST para a planilha com status `sent`, `failed` ou `skipped`.

A coluna `eventType` diferencia o estado mais recente da linha:

- `initial_signal`: alerta inicial do metodo
- `result_followup`: acompanhamento posterior com o resultado final do jogo futuro
- `odds_applied`: odds capturadas pelo odds-radar e aplicadas ao dispatch

Com o script acima, o Google Sheets deixa de criar uma segunda linha para o follow-up. Em vez disso, ele localiza a linha original pelo `rootSignalKey` e sobrescreve os campos com o estado mais recente, incluindo:

- `initialApx`
- `currentApx`
- `apxDelta`
- `initialTotalOccurrences`
- `currentTotalOccurrences`
- `result`
- `fullTimeScore`
- `homeOdd`
- `awayOdd`
- `oddsLink`
- `oddsAppliedAt`

Se a aba ainda estiver com cabecalho antigo de uma versao anterior do script, o follow-up pode duplicar linha. A versao acima regrava o cabecalho automaticamente e procura a linha existente por `rootSignalKey` e por `signalKey`, cobrindo migracoes do formato antigo para o novo.

Para validacao operacional, a ordem recomendada e:

1. `POST /api/alerts/google-sheets/test`
2. `POST /api/alerts/rules/:ruleId/test-future-dispatch`
3. `POST /api/alerts/rules/:ruleId/test-future-resolve`
4. depois, se quiser, validar com dispatch real do scheduler

Quando o alerta for de jogo futuro, o backend agora faz um segundo acompanhamento automatico. Assim que o fixture sair do estado pendente e entrar com placar final na base, o runner tenta editar a mensagem original no Telegram e atualiza a mesma linha na planilha pelo `rootSignalKey`, preenchendo `signal.result`, `signal.fullTimeScore`, `signal.localPlayedAtLabel`, `signal.currentApx` e `signal.apxDelta`.

Se quiser forcar essa conciliacao sem esperar o proximo ciclo do runner, rode manualmente:

```powershell
Invoke-RestMethod \
  -Method Post \
  -Uri "http://localhost:4003/api/alerts/resolve-future-results" \
  -ContentType "application/json" \
  -Body '{}'
```

Para restringir a uma regra especifica:

```powershell
Invoke-RestMethod \
  -Method Post \
  -Uri "http://localhost:4003/api/alerts/resolve-future-results" \
  -ContentType "application/json" \
  -Body '{"ruleId":"1"}'
```

## Teste manual completo do ciclo futuro

Quando nao houver sinal real elegivel no momento, voce pode forcar o ciclo completo em dois passos: primeiro cria um alerta futuro pendente, depois resolve esse mesmo alerta para verificar a edicao no Telegram e a atualizacao da mesma linha no Google Sheets.

Passo 1, disparar um alerta futuro de teste para a regra 1:

```powershell
$future = Invoke-RestMethod \
  -Method Post \
  -Uri "http://localhost:4003/api/alerts/rules/1/test-future-dispatch" \
  -ContentType "application/json" \
  -Body (@{
    confrontationLabel = "TESTE FUTURO x ALERTAS"
    fixtureLabel = "TESTE FUTURO x ALERTAS"
    apx = 40
    totalOccurrences = 5
    occurrenceResults = @("L", "L", "W", "L", "W")
    triggerSequence = @("L", "L")
    daySequence = @("W", "L", "L")
  } | ConvertTo-Json)

$future.rootSignalKey
```

Esse retorno traz o `rootSignalKey`. Guarde esse valor, porque ele sera usado no segundo passo e tambem sera a chave que o Apps Script usa para sobrescrever a mesma linha da planilha.

Passo 2, resolver o mesmo alerta simulando o placar final:

```powershell
Invoke-RestMethod \
  -Method Post \
  -Uri "http://localhost:4003/api/alerts/rules/1/test-future-resolve" \
  -ContentType "application/json" \
  -Body (@{
    rootSignalKey = $future.rootSignalKey
    result = "W"
    fullTimeScore = "2-1"
  } | ConvertTo-Json)
```

Variacoes uteis para o segundo passo:

- `result = "D"` com `fullTimeScore = "1-1"`
- `result = "L"` com `fullTimeScore = "1-2"`

Resultado esperado apos os dois passos:

- o Telegram tenta editar a mensagem original do alerta inicial
- a planilha atualiza a mesma linha localizada por `rootSignalKey`
- `eventType` passa de `initial_signal` para `result_followup`
- `currentApx`, `apxDelta`, `result` e `fullTimeScore` passam a refletir o jogo resolvido

## Backup local das regras

Para trabalhar em modo memoria sem perder a configuracao ao reiniciar a API, agora existe um backup JSON simples das regras.

Exportar o snapshot atual:

```powershell
Invoke-RestMethod \
  -Method Get \
  -Uri "http://localhost:4003/api/alerts/backup"
```

Salvar o snapshot atual em um arquivo local do servidor:

```powershell
Invoke-RestMethod \
  -Method Post \
  -Uri "http://localhost:4003/api/alerts/backup/save-local"
```

Listar o historico dos snapshots locais ja salvos:

```powershell
Invoke-RestMethod \
  -Method Get \
  -Uri "http://localhost:4003/api/alerts/backup/local-history?limit=10"
```

Consultar se existe um latest.json salvo no servidor:

```powershell
Invoke-RestMethod \
  -Method Get \
  -Uri "http://localhost:4003/api/alerts/backup/local-status"
```

Importar um snapshot salvo, preservando o que ja existe:

```powershell
$backup = Get-Content "D:\Sheva\tmp\alerts-backup.json" -Raw

Invoke-RestMethod \
  -Method Post \
  -Uri "http://localhost:4003/api/alerts/backup/import" \
  -ContentType "application/json" \
  -Body (@{
    replaceExisting = $false
    skipDuplicates = $true
    backup = ($backup | ConvertFrom-Json)
  } | ConvertTo-Json -Depth 10)
```

Restaurar o ultimo snapshot salvo no servidor, sem precisar colar JSON:

```powershell
Invoke-RestMethod \
  -Method Post \
  -Uri "http://localhost:4003/api/alerts/backup/restore-latest" \
  -ContentType "application/json" \
  -Body (@{
    replaceExisting = $false
    skipDuplicates = $true
  } | ConvertTo-Json)
```

Importar substituindo as regras e o historico em memoria atuais:

```powershell
$backup = Get-Content "D:\Sheva\tmp\alerts-backup.json" -Raw

Invoke-RestMethod \
  -Method Post \
  -Uri "http://localhost:4003/api/alerts/backup/import" \
  -ContentType "application/json" \
  -Body (@{
    replaceExisting = $true
    skipDuplicates = $true
    backup = ($backup | ConvertFrom-Json)
  } | ConvertTo-Json -Depth 10)
```

Na interface web, esse mesmo fluxo aparece na secao Backup local, com download do JSON, leitura direta de arquivo .json e restauracao por colagem do conteudo. O import ignora regras identicas por padrao.

## Backup automatico local

Para ativar um snapshot automatico periodico do estado das regras, configure no .env raiz:

```env
ALERTS_LOCAL_BACKUP_ENABLED=true
ALERTS_LOCAL_BACKUP_INTERVAL_MS=300000
```

No exemplo acima, a API salva um novo snapshot a cada 5 minutos dentro de tmp/alerts-backups e atualiza o alias latest.json.

## Remover uma regra

Excluir uma regra pelo endpoint:

```powershell
Invoke-RestMethod \
  -Method Delete \
  -Uri "http://localhost:4003/api/alerts/rules/1"
```

Na interface web, cada card de regra agora possui o botao Remover.

## Observacao atual

Enquanto o banco nao receber as tabelas alert_method_rules e alert_method_dispatches, os endpoints de criacao e execucao vao falhar em runtime. O SQL necessario ja esta pronto em [apps/api/prisma/migrations/20260313_add_method_alerts/migration.sql](apps/api/prisma/migrations/20260313_add_method_alerts/migration.sql).