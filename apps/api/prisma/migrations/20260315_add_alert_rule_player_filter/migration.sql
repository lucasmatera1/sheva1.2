ALTER TABLE alert_method_rules
  ADD COLUMN player_name VARCHAR(120) NULL AFTER series;

CREATE INDEX idx_alert_rules_player_name ON alert_method_rules (player_name);
