import { Prisma } from "@prisma/client";

export type AlertRuleRecord = {
  id: bigint;
  name: string;
  is_active: boolean;
  transport_channel: string;
  league_type: string;
  method_code: string;
  series: string | null;
  player_name: string | null;
  apx_min: Prisma.Decimal;
  min_occurrences: number;
  window_days: number;
  recipients: string;
  webhook_url: string | null;
  note: string | null;
  created_at: Date;
  updated_at: Date;
  last_evaluated_at: Date | null;
};

export type AlertDispatchRecord = {
  id: bigint;
  rule_id: bigint;
  signal_key: string;
  confrontation_key: string;
  confrontation_label: string;
  day_key: string;
  occurrence_match_id: string;
  occurrence_played_at: Date;
  apx: Prisma.Decimal;
  total_occurrences: number;
  payload_text: string;
  recipients_snapshot: string;
  transport_status: string;
  transport_response: string | null;
  sent_at: Date | null;
  created_at: Date;
  updated_at: Date;
};

const memoryRules: AlertRuleRecord[] = [];
const memoryDispatches: AlertDispatchRecord[] = [];
let nextRuleId = 1n;
let nextDispatchId = 1n;

export function clearMemoryAlertsState() {
  memoryRules.length = 0;
  memoryDispatches.length = 0;
  nextRuleId = 1n;
  nextDispatchId = 1n;
}

export function listMemoryRules(options: { ruleId?: bigint; onlyActive?: boolean } = {}) {
  return [...memoryRules]
    .filter((rule) => (options.ruleId ? rule.id === options.ruleId : true))
    .filter((rule) => (options.onlyActive ? rule.is_active : true))
    .sort((left, right) => Number(right.created_at.getTime() - left.created_at.getTime()));
}

export function getMemoryRule(ruleId: bigint) {
  return memoryRules.find((rule) => rule.id === ruleId) ?? null;
}

export function createMemoryRule(input: Omit<AlertRuleRecord, "id" | "created_at" | "updated_at" | "last_evaluated_at">) {
  const now = new Date();
  const rule: AlertRuleRecord = {
    id: nextRuleId,
    created_at: now,
    updated_at: now,
    last_evaluated_at: null,
    ...input,
  };

  nextRuleId += 1n;
  memoryRules.push(rule);
  return rule;
}

export function restoreMemoryRule(rule: AlertRuleRecord) {
  memoryRules.push(rule);
  if (rule.id >= nextRuleId) {
    nextRuleId = rule.id + 1n;
  }

  return rule;
}

export function updateMemoryRule(ruleId: bigint, input: Partial<Omit<AlertRuleRecord, "id" | "created_at">>) {
  const rule = getMemoryRule(ruleId);
  if (!rule) {
    return null;
  }

  Object.assign(rule, input, { updated_at: new Date() });
  return rule;
}

export function deleteMemoryRule(ruleId: bigint) {
  const ruleIndex = memoryRules.findIndex((rule) => rule.id === ruleId);
  if (ruleIndex === -1) {
    return null;
  }

  const [deletedRule] = memoryRules.splice(ruleIndex, 1);
  for (let index = memoryDispatches.length - 1; index >= 0; index -= 1) {
    if (memoryDispatches[index]?.rule_id === ruleId) {
      memoryDispatches.splice(index, 1);
    }
  }

  return deletedRule;
}

export function listMemoryDispatches(options: { ruleId?: bigint; limit?: number } = {}) {
  return [...memoryDispatches]
    .filter((dispatch) => (options.ruleId ? dispatch.rule_id === options.ruleId : true))
    .sort((left, right) => Number(right.created_at.getTime() - left.created_at.getTime()))
    .slice(0, options.limit ?? 50);
}

export function findMemoryDispatch(ruleId: bigint, signalKey: string) {
  return memoryDispatches.find((dispatch) => dispatch.rule_id === ruleId && dispatch.signal_key === signalKey) ?? null;
}

export function createMemoryDispatch(input: Omit<AlertDispatchRecord, "id" | "created_at" | "updated_at">) {
  const now = new Date();
  const dispatch: AlertDispatchRecord = {
    id: nextDispatchId,
    created_at: now,
    updated_at: now,
    ...input,
  };

  nextDispatchId += 1n;
  memoryDispatches.push(dispatch);
  return dispatch;
}

export function restoreMemoryDispatch(dispatch: AlertDispatchRecord) {
  memoryDispatches.push(dispatch);
  if (dispatch.id >= nextDispatchId) {
    nextDispatchId = dispatch.id + 1n;
  }

  return dispatch;
}

export function updateMemoryDispatch(dispatchId: bigint, input: Partial<Omit<AlertDispatchRecord, "id" | "rule_id" | "created_at">>) {
  const dispatch = memoryDispatches.find((item) => item.id === dispatchId);
  if (!dispatch) {
    return null;
  }

  Object.assign(dispatch, input, { updated_at: new Date() });
  return dispatch;
}