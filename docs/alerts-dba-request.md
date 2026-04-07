# Solicitação para DBA: tabelas de alertas de método

## Contexto

O módulo de alertas de método já está implementado na aplicação, mas o usuário atual do banco usado pela API não consegue criar nem escrever nas tabelas novas.

Grant atual verificado para o usuário da aplicação:

```sql
GRANT SELECT ON *.* TO `app_user`@`%`
```

Na prática, isso impede:

- CREATE TABLE
- INSERT
- UPDATE
- DELETE

Por isso, o sistema está operando temporariamente em memória volátil.

## Ação necessária

Aplicar o SQL abaixo no schema `fifa` com um usuário que tenha permissão de criação de tabelas e constraints.

Arquivo de origem no projeto:

`apps/api/prisma/migrations/20260313_add_method_alerts/migration.sql`

## SQL a executar

```sql
CREATE TABLE IF NOT EXISTS alert_method_rules (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  name VARCHAR(150) NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  league_type VARCHAR(32) NOT NULL,
  method_code VARCHAR(16) NOT NULL,
  series VARCHAR(1) NULL,
  apx_min DECIMAL(5, 2) NOT NULL DEFAULT 0,
  min_occurrences INT UNSIGNED NOT NULL DEFAULT 1,
  window_days SMALLINT UNSIGNED NOT NULL DEFAULT 30,
  recipients TEXT NOT NULL,
  webhook_url VARCHAR(500) NULL,
  note VARCHAR(255) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  last_evaluated_at DATETIME NULL,
  PRIMARY KEY (id),
  KEY idx_alert_rules_active_method (is_active, league_type, method_code)
);

CREATE TABLE IF NOT EXISTS alert_method_dispatches (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  rule_id BIGINT UNSIGNED NOT NULL,
  signal_key VARCHAR(255) NOT NULL,
  confrontation_key VARCHAR(255) NOT NULL,
  confrontation_label VARCHAR(255) NOT NULL,
  day_key VARCHAR(10) NOT NULL,
  occurrence_match_id VARCHAR(64) NOT NULL,
  occurrence_played_at DATETIME NOT NULL,
  apx DECIMAL(5, 2) NOT NULL,
  total_occurrences INT UNSIGNED NOT NULL,
  payload_text LONGTEXT NOT NULL,
  recipients_snapshot TEXT NOT NULL,
  transport_status VARCHAR(20) NOT NULL,
  transport_response LONGTEXT NULL,
  sent_at DATETIME NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_alert_dispatch_rule_signal (rule_id, signal_key),
  KEY idx_alert_dispatch_rule_created (rule_id, created_at),
  KEY idx_alert_dispatch_status_created (transport_status, created_at),
  CONSTRAINT fk_alert_dispatch_rule FOREIGN KEY (rule_id) REFERENCES alert_method_rules (id) ON DELETE CASCADE
);
```

## Permissões mínimas esperadas para a aplicação

Depois da criação das tabelas, o usuário da aplicação precisa ao menos conseguir:

- SELECT
- INSERT
- UPDATE
- DELETE

No mínimo nessas duas tabelas:

- `fifa.alert_method_rules`
- `fifa.alert_method_dispatches`

## Como validar depois da liberação

1. Abrir `http://localhost:4013/api/alerts/status`
2. Criar uma regra em `http://localhost:3005/methods/alerts`
3. Confirmar que o modo sai de `memory` e passa para `database`
4. Rodar um dry-run e confirmar persistência após reiniciar a API

## Resultado esperado

Após essa liberação:

- as regras deixam de ficar apenas em memória
- os disparos passam a ser gravados no banco
- reiniciar a API não apaga mais as regras nem o histórico de dispatches
