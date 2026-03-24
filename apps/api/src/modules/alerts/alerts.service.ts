import { Prisma, type alert_method_dispatches, type alert_method_rules } from "@prisma/client";
import { mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { getConfrontationMethodsLive, getFuturePlayerSessionMethodsLive, getFutureFavoritoVsFracoMethodsLive } from "../../core/live-analytics";
import { env } from "../../core/env";
import { prisma } from "../../core/prisma";
import { MethodsService } from "../methods/methods.service";
import {
  clearMemoryAlertsState,
  createMemoryDispatch,
  createMemoryRule,
  deleteMemoryRule,
  findMemoryDispatch,
  getMemoryRule,
  listMemoryDispatches,
  listMemoryRules,
  type AlertDispatchRecord,
  type AlertRuleRecord,
  restoreMemoryDispatch,
  restoreMemoryRule,
  updateMemoryDispatch,
  updateMemoryRule,
} from "./alerts.memory-store";

const ALERT_LEAGUES = ["GT LEAGUE", "8MIN BATTLE", "6MIN VOLTA"] as const;
const ALERT_METHODS = ["T+", "E", "(2E)", "(2D)", "(2D+)", "(3D)", "(3D+)", "(4D)", "(4D+)", "4D Jogador", "4W Jogador", "Fav T1", "Fav T2", "Fav T3"] as const;
const ALERT_SERIES = ["A", "B", "C", "D", "E", "F", "G"] as const;
const ALERT_TRANSPORTS = ["webhook", "telegram"] as const;

type AlertLeagueType = (typeof ALERT_LEAGUES)[number];
type AlertMethodCode = (typeof ALERT_METHODS)[number];
type AlertSeriesCode = (typeof ALERT_SERIES)[number];
export type AlertTransportType = (typeof ALERT_TRANSPORTS)[number];
type DispatchSource = "manual" | "scheduler" | "odds-update";
type DispatchEventType = "initial_signal" | "result_followup" | "odds_applied";
type ConfrontationMethodsResponse = Awaited<ReturnType<typeof getConfrontationMethodsLive>>;
type ConfrontationRow = ConfrontationMethodsResponse["rows"][number];
type ConfrontationOccurrence = ConfrontationRow["history"][number];
type FutureConfrontationMethodsResponse = Awaited<ReturnType<MethodsService["getFutureConfrontationMethods"]>>;
type FutureConfrontationRow = FutureConfrontationMethodsResponse["rows"][number];
type FuturePlayerSessionMethodsResponse = Awaited<ReturnType<typeof getFuturePlayerSessionMethodsLive>>;
type FuturePlayerSessionRow = FuturePlayerSessionMethodsResponse["rows"][number];

export type AlertRuleInput = {
  name: string;
  isActive?: boolean;
  transportType?: AlertTransportType;
  leagueType: AlertLeagueType;
  methodCode: AlertMethodCode;
  series?: AlertSeriesCode;
  playerName?: string | null;
  apxMin?: number;
  minOccurrences?: number;
  windowDays?: number;
  recipients: string[];
  webhookUrl?: string | null;
  note?: string | null;
};

export type AlertRuleUpdateInput = {
  name?: string;
  isActive?: boolean;
  transportType?: AlertTransportType;
  leagueType?: AlertLeagueType;
  methodCode?: AlertMethodCode;
  series?: AlertSeriesCode | null;
  playerName?: string | null;
  apxMin?: number;
  minOccurrences?: number;
  windowDays?: number;
  recipients?: string[];
  webhookUrl?: string | null;
  note?: string | null;
};

export type AlertRulesBackup = {
  format: "sheva-method-alert-rules";
  version: 1 | 2;
  exportedAt: string;
  persistenceMode: "database" | "memory";
  rules: Array<ReturnType<typeof serializeRule>>;
  dispatches: Array<ReturnType<typeof serializeDispatch>>;
};

type LocalBackupStatus = {
  exists: boolean;
  filePath: string;
  directoryPath: string;
  latestFileName: string | null;
  exportedAt: string | null;
  sizeBytes: number | null;
};

export type LocalBackupHistoryItem = {
  fileName: string;
  filePath: string;
  exportedAt: string | null;
  sizeBytes: number;
  modifiedAt: string;
};

type ImportRulesBackupOptions = {
  replaceExisting?: boolean;
  skipDuplicates?: boolean;
};

type RunRulesOptions = {
  dryRun?: boolean;
  onlyActive?: boolean;
  ruleId?: bigint;
  source?: DispatchSource;
};

type StoredDispatchPayload = {
  source?: string;
  eventType?: DispatchEventType;
  rootSignalKey?: string;
  rule?: ReturnType<typeof serializeRule>;
  signal?: {
    signalKey?: string;
    rootSignalKey?: string;
    confrontationKey?: string;
    confrontationLabel?: string;
    dayKey?: string;
    occurrenceMatchId?: string;
    occurrencePlayedAt?: string;
    localPlayedAtLabel?: string;
    result?: string;
    fullTimeScore?: string;
    apx?: number;
    initialApx?: number;
    currentApx?: number;
    apxDelta?: number;
    totalOccurrences?: number;
    initialTotalOccurrences?: number;
    currentTotalOccurrences?: number;
    wins?: number;
    draws?: number;
    losses?: number;
    methodCode?: string;
    fixtureLabel?: string;
    groupLabel?: string | null;
    playerName?: string;
    opponentName?: string;
    occurrenceResults?: string[];
    triggerSequence?: string[];
    daySequence?: string[];
    confrontationSequence?: string[];
    sourceView?: "future-confrontations" | "future-player-sessions" | "historical";
  };
  recipients?: string[];
  message?: string;
};

type CompletedFutureFixture = {
  fixtureId: string;
  playedAtIso: string;
  localPlayedAtLabel: string;
  fixtureLabel: string;
  homePlayer: string;
  awayPlayer: string;
  homeScore: number;
  awayScore: number;
  fullTimeScore: string;
};

type EvaluatedSignal = {
  signalKey: string;
  rootSignalKey: string;
  confrontationKey: string;
  confrontationLabel: string;
  dayKey: string;
  occurrenceMatchId: string;
  occurrencePlayedAt: string;
  localPlayedAtLabel: string;
  result: string;
  fullTimeScore: string;
  apx: number;
  initialApx?: number;
  currentApx?: number;
  apxDelta?: number;
  totalOccurrences: number;
  initialTotalOccurrences?: number;
  currentTotalOccurrences?: number;
  wins?: number;
  draws?: number;
  losses?: number;
  telegramReplyTargets?: Array<{ chatId: string; messageId: number }>;
  recipients: string[];
  message: string;
  methodCode?: string;
  fixtureLabel?: string;
  groupLabel?: string | null;
  playerName?: string;
  opponentName?: string;
  occurrenceResults?: string[];
  triggerSequence?: string[];
  daySequence?: string[];
  confrontationSequence?: string[];
  sourceView?: "future-confrontations" | "future-player-sessions" | "historical";
};

type SignalPreviewItem = {
  signalKey: string;
  rootSignalKey: string;
  confrontationKey: string;
  confrontationLabel: string;
  dayKey: string;
  occurrenceMatchId: string;
  occurrencePlayedAt: string;
  localPlayedAtLabel: string;
  result: string;
  fullTimeScore: string;
  apx: number;
  initialApx?: number;
  currentApx?: number;
  apxDelta?: number;
  totalOccurrences: number;
  initialTotalOccurrences?: number;
  currentTotalOccurrences?: number;
  wins?: number;
  draws?: number;
  losses?: number;
  telegramReplyTargets?: Array<{ chatId: string; messageId: number }>;
  recipients: string[];
  message: string;
  alreadyProcessed: boolean;
  lastTransportStatus: string | null;
  lastSentAt: string | null;
  methodCode?: string;
  fixtureLabel?: string;
  groupLabel?: string | null;
  playerName?: string;
  opponentName?: string;
  occurrenceResults?: string[];
  triggerSequence?: string[];
  daySequence?: string[];
  confrontationSequence?: string[];
  sourceView?: "future-confrontations" | "future-player-sessions" | "historical";
};

type DispatchOutcome = {
  status: "sent" | "skipped" | "failed" | "duplicate" | "dry_run";
  info: string;
  wasDispatched: boolean;
};

type GoogleSheetsDispatchLogPayload = {
  loggedAt: string;
  source: DispatchSource;
  eventType: DispatchEventType;
  transportType: "telegram";
  transportStatus: DispatchOutcome["status"];
  transportInfo: string;
  sentAt: string | null;
  rule: ReturnType<typeof serializeRule>;
  signal: {
    signalKey: string;
    rootSignalKey: string;
    confrontationKey: string;
    confrontationLabel: string;
    fixtureLabel?: string;
    groupLabel?: string | null;
    dayKey: string;
    occurrenceMatchId: string;
    occurrencePlayedAt: string;
    localPlayedAtLabel: string;
    result: string;
    fullTimeScore: string;
    apx: number;
    initialApx?: number;
    currentApx?: number;
    apxDelta?: number;
    totalOccurrences: number;
    initialTotalOccurrences?: number;
    currentTotalOccurrences?: number;
    wins?: number;
    draws?: number;
    losses?: number;
    methodCode?: string;
    playerName?: string;
    opponentName?: string;
    occurrenceResults?: string[];
    triggerSequence?: string[];
    daySequence?: string[];
    sourceView?: "future-confrontations" | "historical";
    odds?: {
      homePlayer: string;
      awayPlayer: string;
      homeOdd: number;
      awayOdd: number;
      link?: string | null;
      appliedAt: string;
    };
  };
  recipients: string[];
  message: string;
};

type GoogleSheetsDispatchAttempt =
  | {
      enabled: false;
      ok: false;
      info: string;
    }
  | {
      enabled: true;
      ok: boolean;
      info: string;
      status?: number;
      responseText?: string;
    };

type AlertRuleEntity = alert_method_rules | AlertRuleRecord;
type AlertDispatchEntity = alert_method_dispatches | AlertDispatchRecord;
let alertsPersistenceMode: "database" | "memory" = "database";
const ALERTS_LOCAL_BACKUP_DIR = resolve(process.cwd(), "tmp", "alerts-backups");
const ALERTS_LOCAL_BACKUP_LATEST_PATH = resolve(ALERTS_LOCAL_BACKUP_DIR, "latest.json");
const methodsService = new MethodsService();

export class AlertsService {
  async bootstrapVolatileRulesFromLocalBackup() {
    await this.detectPersistenceMode();

    if (alertsPersistenceMode !== "memory") {
      return { restored: false, reason: "database-available" } as const;
    }

    const existingRules = await this.listRules();
    if (existingRules.length) {
      return {
        restored: false,
        reason: "memory-already-populated",
        rulesCount: existingRules.length,
      } as const;
    }

    try {
      const restored = await this.restoreRulesFromLocalLatest({
        replaceExisting: true,
        skipDuplicates: true,
      });

      return {
        restored: true,
        reason: "local-backup-restored",
        rulesCount: restored.importedCount,
      } as const;
    } catch {
      return { restored: false, reason: "no-local-backup" } as const;
    }
  }

  getStatus() {
    return {
      persistenceMode: alertsPersistenceMode,
      isVolatile: alertsPersistenceMode === "memory",
      telegramConfigured: Boolean(env.TELEGRAM_BOT_TOKEN),
      defaultTelegramChatIds: parseRecipients(env.TELEGRAM_DEFAULT_CHAT_IDS ?? ""),
    };
  }

  async detectPersistenceMode() {
    await withAlertsPersistence(
      () => prisma.alert_method_rules.findFirst({ select: { id: true } }),
      () => null,
    );

    return alertsPersistenceMode;
  }

  async listRules() {
    const rules = await withAlertsPersistence(
      () =>
        prisma.alert_method_rules.findMany({
          orderBy: [{ is_active: "desc" }, { created_at: "desc" }],
        }),
      () => listMemoryRules(),
    );

    return rules.map((rule) => serializeRule(rule));
  }

  async exportRulesBackup(): Promise<AlertRulesBackup> {
    return {
      format: "sheva-method-alert-rules",
      version: 2,
      exportedAt: new Date().toISOString(),
      persistenceMode: this.getStatus().persistenceMode,
      rules: await this.listRules(),
      dispatches: await this.listDispatches({ limit: Number.MAX_SAFE_INTEGER }),
    };
  }

  async importRulesBackup(backup: AlertRulesBackup, options: ImportRulesBackupOptions = {}) {
    const importedRules = backup.rules.map((rule) => toRuleInput(rule));

    for (const rule of importedRules) {
      if (rule.series && rule.leagueType !== "GT LEAGUE") {
        throw new Error("series so pode ser usada com GT LEAGUE");
      }
    }

    const replaceExisting = options.replaceExisting ?? false;
    const skipDuplicates = options.skipDuplicates ?? true;

    const existingRules = replaceExisting ? [] : await this.listRules();
    const existingRuleBySignature = new Map(existingRules.map((rule) => [buildRuleSignature(toRuleInput(rule)), rule]));
    const seenSignatures = new Set(existingRuleBySignature.keys());
    const rulesToCreate = [] as AlertRuleInput[];
    const sourceRuleIdsToCreate = [] as string[];
    const sourceRuleIdToTargetRuleId = new Map<string, bigint>();
    const sourceRuleIdBySignature = new Map<string, string>();
    const sourceRuleIdAliases = new Map<string, string>();
    let skippedCount = 0;

    for (const [index, rule] of importedRules.entries()) {
      const signature = buildRuleSignature(rule);
      const sourceRuleId = backup.rules[index].id;
      if (skipDuplicates && seenSignatures.has(signature)) {
        skippedCount += 1;
        const existingRule = existingRuleBySignature.get(signature);
        if (existingRule) {
          sourceRuleIdToTargetRuleId.set(sourceRuleId, BigInt(existingRule.id));
        } else {
          const canonicalSourceRuleId = sourceRuleIdBySignature.get(signature);
          if (canonicalSourceRuleId) {
            sourceRuleIdAliases.set(sourceRuleId, canonicalSourceRuleId);
          }
        }
        continue;
      }

      seenSignatures.add(signature);
      sourceRuleIdBySignature.set(signature, sourceRuleId);
      rulesToCreate.push(rule);
      sourceRuleIdsToCreate.push(sourceRuleId);
    }

    const createdRules = await withAlertsPersistence(
      async () => {
        if (replaceExisting) {
          await prisma.$transaction([prisma.alert_method_dispatches.deleteMany(), prisma.alert_method_rules.deleteMany()]);
        }

        const created = [] as AlertRuleEntity[];
        for (const rule of rulesToCreate) {
          created.push(
            await prisma.alert_method_rules.create({
              data: mapRuleCreateInput(rule),
            }),
          );
        }

        return created;
      },
      () => {
        if (replaceExisting) {
          clearMemoryAlertsState();
        }

        return rulesToCreate.map((rule) =>
          createMemoryRule({
            name: rule.name,
            is_active: rule.isActive ?? true,
            transport_channel: rule.transportType ?? "webhook",
            league_type: rule.leagueType,
            method_code: rule.methodCode,
            series: rule.series ?? null,
            player_name: normalizeOptionalString(rule.playerName),
            apx_min: new Prisma.Decimal(rule.apxMin ?? 0),
            min_occurrences: rule.minOccurrences ?? 1,
            window_days: rule.windowDays ?? 30,
            recipients: serializeRecipients(rule.recipients),
            webhook_url: normalizeOptionalString(rule.webhookUrl),
            note: normalizeOptionalString(rule.note),
          }),
        );
      },
    );

    for (const [index, rule] of createdRules.entries()) {
      sourceRuleIdToTargetRuleId.set(sourceRuleIdsToCreate[index]!, rule.id);
    }

    for (const [sourceRuleId, canonicalSourceRuleId] of sourceRuleIdAliases.entries()) {
      const targetRuleId = sourceRuleIdToTargetRuleId.get(canonicalSourceRuleId);
      if (targetRuleId) {
        sourceRuleIdToTargetRuleId.set(sourceRuleId, targetRuleId);
      }
    }

    if (alertsPersistenceMode === "memory" && Array.isArray(backup.dispatches) && backup.dispatches.length) {
      for (const dispatch of backup.dispatches) {
        const targetRuleId = sourceRuleIdToTargetRuleId.get(dispatch.ruleId);
        if (!targetRuleId || findMemoryDispatch(targetRuleId, dispatch.signalKey)) {
          continue;
        }

        restoreMemoryDispatch({
          id: BigInt(dispatch.id),
          rule_id: targetRuleId,
          signal_key: dispatch.signalKey,
          confrontation_key: dispatch.confrontationKey,
          confrontation_label: dispatch.confrontationLabel,
          day_key: dispatch.dayKey,
          occurrence_match_id: dispatch.occurrenceMatchId,
          occurrence_played_at: new Date(dispatch.occurrencePlayedAt),
          apx: new Prisma.Decimal(dispatch.apx),
          total_occurrences: dispatch.totalOccurrences,
          payload_text: dispatch.payloadText,
          recipients_snapshot: serializeRecipients(dispatch.recipients),
          transport_status: dispatch.transportStatus,
          transport_response: dispatch.transportResponse,
          sent_at: dispatch.sentAt ? new Date(dispatch.sentAt) : null,
          created_at: new Date(dispatch.createdAt),
          updated_at: new Date(dispatch.updatedAt),
        });
      }
    }

    const result = {
      importedCount: createdRules.length,
      skippedCount,
      replaceExisting,
      skipDuplicates,
      rules: createdRules.map((rule) => serializeRule(rule)),
    };

    await this.persistLocalRulesStateIfVolatile();

    return result;
  }

  async getRuleById(ruleId: bigint) {
    const rule = await withAlertsPersistence(
      () => prisma.alert_method_rules.findUnique({ where: { id: ruleId } }),
      () => getMemoryRule(ruleId),
    );
    return rule ? serializeRule(rule) : null;
  }

  async deleteRule(ruleId: bigint) {
    const deletedRule = await withAlertsPersistence(
      async () => {
        const existingRule = await prisma.alert_method_rules.findUnique({ where: { id: ruleId } });
        if (!existingRule) {
          return null;
        }

        await prisma.$transaction([
          prisma.alert_method_dispatches.deleteMany({ where: { rule_id: ruleId } }),
          prisma.alert_method_rules.delete({ where: { id: ruleId } }),
        ]);

        return existingRule;
      },
      () => deleteMemoryRule(ruleId),
    );

    const serializedRule = deletedRule ? serializeRule(deletedRule) : null;

    if (serializedRule) {
      await this.persistLocalRulesStateIfVolatile();
    }

    return serializedRule;
  }

  async saveRulesBackupToLocalFile() {
    const backup = await this.exportRulesBackup();
    return this.writeRulesBackupToLocalFile(backup, { writeVersionedCopy: true });
  }

  async persistLocalRulesStateIfVolatile() {
    if (alertsPersistenceMode !== "memory") {
      return null;
    }

    try {
      const backup = await this.exportRulesBackup();
      return await this.writeRulesBackupToLocalFile(backup, { writeVersionedCopy: false });
    } catch (error) {
      console.error("Erro ao persistir estado local de alertas", error);
      return null;
    }
  }

  private async writeRulesBackupToLocalFile(backup: AlertRulesBackup, options: { writeVersionedCopy: boolean }) {
    const latestFileName = `alerts-backup-${backup.exportedAt.slice(0, 19).replace(/[:T]/g, "-")}.json`;
    const latestVersionPath = resolve(ALERTS_LOCAL_BACKUP_DIR, latestFileName);
    const serialized = JSON.stringify(backup, null, 2);

    await mkdir(ALERTS_LOCAL_BACKUP_DIR, { recursive: true });
    if (options.writeVersionedCopy) {
      await writeFile(latestVersionPath, serialized, "utf8");
    }
    await writeFile(ALERTS_LOCAL_BACKUP_LATEST_PATH, serialized, "utf8");

    return {
      filePath: options.writeVersionedCopy ? latestVersionPath : ALERTS_LOCAL_BACKUP_LATEST_PATH,
      latestAliasPath: ALERTS_LOCAL_BACKUP_LATEST_PATH,
      exportedAt: backup.exportedAt,
      rulesCount: backup.rules.length,
    };
  }

  async getLocalBackupStatus(): Promise<LocalBackupStatus> {
    try {
      const fileStat = await stat(ALERTS_LOCAL_BACKUP_LATEST_PATH);
      const backup = await readLocalLatestBackup();
      const latestFileName = `alerts-backup-${backup.exportedAt.slice(0, 19).replace(/[:T]/g, "-")}.json`;

      return {
        exists: true,
        filePath: ALERTS_LOCAL_BACKUP_LATEST_PATH,
        directoryPath: ALERTS_LOCAL_BACKUP_DIR,
        latestFileName,
        exportedAt: backup.exportedAt,
        sizeBytes: fileStat.size,
      };
    } catch {
      return {
        exists: false,
        filePath: ALERTS_LOCAL_BACKUP_LATEST_PATH,
        directoryPath: ALERTS_LOCAL_BACKUP_DIR,
        latestFileName: null,
        exportedAt: null,
        sizeBytes: null,
      };
    }
  }

  async listLocalBackupHistory(limit = 12): Promise<LocalBackupHistoryItem[]> {
    try {
      const fileNames = await readdir(ALERTS_LOCAL_BACKUP_DIR);
      const versionedFiles = fileNames.filter((fileName) => /^alerts-backup-.*\.json$/i.test(fileName));

      const snapshots = await Promise.all(
        versionedFiles.map(async (fileName) => {
          const filePath = resolve(ALERTS_LOCAL_BACKUP_DIR, fileName);
          const fileStat = await stat(filePath);
          const exportedAt = extractExportedAtFromFileName(fileName);

          return {
            fileName,
            filePath,
            exportedAt,
            sizeBytes: fileStat.size,
            modifiedAt: fileStat.mtime.toISOString(),
          } satisfies LocalBackupHistoryItem;
        }),
      );

      return snapshots
        .sort((left, right) => right.modifiedAt.localeCompare(left.modifiedAt))
        .slice(0, limit);
    } catch {
      return [];
    }
  }

  async restoreRulesFromLocalLatest(options: ImportRulesBackupOptions = {}) {
    const backup = await readLocalLatestBackup();
    return this.importRulesBackup(backup, options);
  }

  async createRule(input: AlertRuleInput) {
    if (input.series && input.leagueType !== "GT LEAGUE") {
      throw new Error("series so pode ser usada com GT LEAGUE");
    }

    const createdRule = await withAlertsPersistence(
      () =>
        prisma.alert_method_rules.create({
          data: mapRuleCreateInput(input),
        }),
      () =>
        createMemoryRule({
          name: input.name,
          is_active: input.isActive ?? true,
          transport_channel: input.transportType ?? "webhook",
          league_type: input.leagueType,
          method_code: input.methodCode,
          series: input.series ?? null,
          player_name: normalizeOptionalString(input.playerName),
          apx_min: new Prisma.Decimal(input.apxMin ?? 0),
          min_occurrences: input.minOccurrences ?? 1,
          window_days: input.windowDays ?? 30,
          recipients: serializeRecipients(input.recipients),
          webhook_url: normalizeOptionalString(input.webhookUrl),
          note: normalizeOptionalString(input.note),
        }),
    );

    const serializedRule = serializeRule(createdRule);
    await this.persistLocalRulesStateIfVolatile();
    return serializedRule;
  }

  async updateRule(ruleId: bigint, input: AlertRuleUpdateInput) {
    const existingRule = await withAlertsPersistence(
      () => prisma.alert_method_rules.findUnique({ where: { id: ruleId } }),
      () => getMemoryRule(ruleId),
    );
    if (!existingRule) {
      return null;
    }

    const nextLeagueType = input.leagueType ?? (existingRule.league_type as AlertLeagueType);
    const nextSeries = input.series === undefined ? existingRule.series : input.series;
    if (nextSeries && nextLeagueType !== "GT LEAGUE") {
      throw new Error("series so pode ser usada com GT LEAGUE");
    }

    const updatedRule = await withAlertsPersistence(
      () =>
        prisma.alert_method_rules.update({
          where: { id: ruleId },
          data: mapRuleUpdateInput(input),
        }),
      () =>
        updateMemoryRule(ruleId, {
          ...(input.name !== undefined ? { name: input.name } : {}),
          ...(input.isActive !== undefined ? { is_active: input.isActive } : {}),
          ...(input.transportType !== undefined ? { transport_channel: input.transportType } : {}),
          ...(input.leagueType !== undefined ? { league_type: input.leagueType } : {}),
          ...(input.methodCode !== undefined ? { method_code: input.methodCode } : {}),
          ...(input.series !== undefined ? { series: input.series ?? null } : {}),
          ...(input.playerName !== undefined ? { player_name: normalizeOptionalString(input.playerName) } : {}),
          ...(input.apxMin !== undefined ? { apx_min: new Prisma.Decimal(input.apxMin) } : {}),
          ...(input.minOccurrences !== undefined ? { min_occurrences: input.minOccurrences } : {}),
          ...(input.windowDays !== undefined ? { window_days: input.windowDays } : {}),
          ...(input.recipients !== undefined ? { recipients: serializeRecipients(input.recipients) } : {}),
          ...(input.webhookUrl !== undefined ? { webhook_url: normalizeOptionalString(input.webhookUrl) } : {}),
          ...(input.note !== undefined ? { note: normalizeOptionalString(input.note) } : {}),
        }),
    );

    if (!updatedRule) {
      return null;
    }

    const serializedRule = serializeRule(updatedRule);
    await this.persistLocalRulesStateIfVolatile();
    return serializedRule;
  }

  async listDispatches(options: { ruleId?: bigint; limit?: number } = {}) {
    const dispatches = await withAlertsPersistence(
      () =>
        prisma.alert_method_dispatches.findMany({
          where: options.ruleId ? { rule_id: options.ruleId } : undefined,
          include: {
            rule: {
              select: {
                name: true,
                method_code: true,
                league_type: true,
              },
            },
          },
          orderBy: [{ created_at: "desc" }],
          take: options.limit ?? 50,
        }),
      () =>
        listMemoryDispatches(options).map((dispatch) => ({
          ...dispatch,
          rule: buildMemoryDispatchRule(dispatch.rule_id),
        })),
    );

    return dispatches.map((dispatch) => serializeDispatch(dispatch));
  }

  async listOpenFutureSignals() {
    const now = new Date();
    const dispatches = await withAlertsPersistence(
      () =>
        prisma.alert_method_dispatches.findMany({
          where: {
            transport_status: { in: ["sent", "skipped"] },
            occurrence_played_at: { gt: now },
          },
          orderBy: [{ occurrence_played_at: "asc" }, { created_at: "asc" }],
        }),
      () =>
        listMemoryDispatches({ limit: Number.MAX_SAFE_INTEGER }).filter(
          (dispatch) =>
            ["sent", "skipped"].includes(dispatch.transport_status) &&
            dispatch.occurrence_played_at.getTime() > now.getTime(),
        ),
    );

    const openSignals: Array<{
      confrontationLabel: string;
      methodCode: string;
      apx: number;
      occurrencePlayedAt: string;
      localPlayedAtLabel: string;
    }> = [];

    for (const dispatch of dispatches) {
      const payload = parseStoredDispatchPayload(dispatch.payload_text);
      const signal = extractPendingFutureSignal(payload);
      if (!signal) continue;

      openSignals.push({
        confrontationLabel: signal.confrontationLabel ?? dispatch.confrontation_label,
        methodCode: signal.methodCode ?? "",
        apx: signal.apx ?? Number(dispatch.apx),
        occurrencePlayedAt: signal.occurrencePlayedAt ?? dispatch.occurrence_played_at.toISOString(),
        localPlayedAtLabel: signal.localPlayedAtLabel ?? "",
      });
    }

    return openSignals;
  }

  async applyOddsToDispatch(input: {
    homePlayer: string;
    awayPlayer: string;
    homeOdd: number;
    awayOdd: number;
    link?: string;
  }) {
    const now = new Date();
    const lookbackMs = 12 * 60 * 60 * 1000; // 12 hours
    const cutoff = new Date(now.getTime() - lookbackMs);
    const dispatches = await withAlertsPersistence(
      () =>
        prisma.alert_method_dispatches.findMany({
          where: {
            transport_status: { in: ["sent", "skipped"] },
            occurrence_played_at: { gt: cutoff },
          },
          include: { rule: true },
          orderBy: [{ occurrence_played_at: "asc" }],
        }),
      () =>
        listMemoryDispatches({ limit: Number.MAX_SAFE_INTEGER }).filter(
          (d) => ["sent", "skipped"].includes(d.transport_status) && d.occurrence_played_at.getTime() > cutoff.getTime(),
        ),
    );

    const normalize = (s: string) => s.trim().toLowerCase();
    const inputHome = normalize(input.homePlayer);
    const inputAway = normalize(input.awayPlayer);

    const updated: Array<{ dispatchId: string; confrontationLabel: string; status: string }> = [];

    for (const dispatch of dispatches) {
      const payload = parseStoredDispatchPayload(dispatch.payload_text);
      const signal = extractPendingFutureSignal(payload);
      if (!signal) continue;

      const label = (signal.confrontationLabel ?? dispatch.confrontation_label).toLowerCase();
      const player = normalize(signal.playerName ?? "");
      const opponent = normalize(signal.opponentName ?? "");

      const matchesDirect =
        (label.includes(inputHome) && label.includes(inputAway)) ||
        (player === inputHome && opponent === inputAway) ||
        (player === inputAway && opponent === inputHome);

      if (!matchesDirect) continue;

      // Build edited message with odds appended
      const targets = extractTelegramReplyTargets(dispatch);
      if (!targets.length) continue;

      const originalMessage = payload?.message ?? "";
      if (!originalMessage) continue;

      const oddsLine = `<b>OD:</b> ${escapeHtml(input.homePlayer)} ${input.homeOdd.toFixed(2)} | ${escapeHtml(input.awayPlayer)} ${input.awayOdd.toFixed(2)}`;
      const linkLine = input.link ? `<b>Link:</b> ${escapeHtml(input.link)}` : null;
      const editedMessage = [originalMessage, "", oddsLine, ...(linkLine ? [linkLine] : [])].join("\n");

      const chatIds = targets.map((t) => t.chatId);
      const editMap = new Map(targets.map((t) => [t.chatId, t.messageId]));

      try {
        const responseText = await sendTelegramMessage(chatIds, editedMessage, { editMessageIdByChatId: editMap });

        // Update stored payload with odds info
        const updatedPayload = payload ? { ...payload } : {} as StoredDispatchPayload;
        if (updatedPayload.signal) {
          (updatedPayload.signal as Record<string, unknown>).odds = {
            home: input.homeOdd,
            away: input.awayOdd,
            link: input.link ?? null,
            appliedAt: new Date().toISOString(),
          };
        }

        await withAlertsPersistence(
          () =>
            prisma.alert_method_dispatches.update({
              where: { id: dispatch.id },
              data: {
                payload_text: JSON.stringify(updatedPayload),
                transport_response: [dispatch.transport_response, `[odds-update] ${responseText}`].filter(Boolean).join("\n"),
              },
            }),
          () =>
            updateMemoryDispatch(dispatch.id, {
              payload_text: JSON.stringify(updatedPayload),
              transport_response: [dispatch.transport_response, `[odds-update] ${responseText}`].filter(Boolean).join("\n"),
            }),
        );

        // Log to Google Sheets
        const rule = "rule" in dispatch && dispatch.rule ? dispatch.rule as AlertRuleEntity : null;
        await logGoogleSheetsDispatchBestEffort({
          loggedAt: new Date().toISOString(),
          source: "odds-update",
          eventType: "odds_applied",
          transportType: "telegram",
          transportStatus: "sent",
          transportInfo: responseText || "Odds aplicadas na mensagem",
          sentAt: new Date().toISOString(),
          rule: rule ? serializeRule(rule) : ({} as ReturnType<typeof serializeRule>),
          signal: {
            signalKey: dispatch.signal_key,
            rootSignalKey: dispatch.signal_key,
            confrontationKey: dispatch.confrontation_key,
            confrontationLabel: dispatch.confrontation_label,
            dayKey: dispatch.day_key,
            occurrenceMatchId: dispatch.occurrence_match_id,
            occurrencePlayedAt: dispatch.occurrence_played_at.toISOString(),
            localPlayedAtLabel: signal.localPlayedAtLabel ?? "",
            result: "-",
            fullTimeScore: "-",
            apx: Number(dispatch.apx),
            totalOccurrences: dispatch.total_occurrences,
            odds: {
              homePlayer: input.homePlayer,
              awayPlayer: input.awayPlayer,
              homeOdd: input.homeOdd,
              awayOdd: input.awayOdd,
              link: input.link ?? null,
              appliedAt: new Date().toISOString(),
            },
          },
          recipients: chatIds,
          message: editedMessage,
        });

        updated.push({
          dispatchId: String(dispatch.id),
          confrontationLabel: dispatch.confrontation_label,
          status: "updated",
        });
      } catch (error) {
        updated.push({
          dispatchId: String(dispatch.id),
          confrontationLabel: dispatch.confrontation_label,
          status: `error: ${error instanceof Error ? error.message : "unknown"}`,
        });
      }
    }

    return { matched: updated.length, dispatches: updated };
  }

  async sendTelegramTestMessage(input: { chatIds: string[]; message?: string }) {
    const chatIds = input.chatIds.map((item) => item.trim()).filter(Boolean);
    if (!chatIds.length) {
      throw new Error("Informe pelo menos um chat_id do Telegram");
    }

    const responseText = await sendTelegramMessage(
      chatIds,
      input.message?.trim() || "Teste de integracao Telegram do Sheva: transporte configurado com sucesso.",
    );

    return {
      sentTo: chatIds,
      response: responseText,
    };
  }

  async sendGoogleSheetsTest(input: { confrontationLabel?: string; message?: string; rootSignalKey?: string } = {}) {
    const webhookUrl = env.ALERTS_GOOGLE_SHEETS_WEBHOOK_URL;
    if (!webhookUrl) {
      throw new Error("ALERTS_GOOGLE_SHEETS_WEBHOOK_URL nao configurada");
    }

    const occurredAt = new Date();
    const confrontationLabel = input.confrontationLabel?.trim() || "TESTE GOOGLE SHEETS x ALERTAS";
    const inferredPlayers = inferPlayersFromConfrontationLabel(confrontationLabel);
    const signalKey = input.rootSignalKey?.trim() || `google-sheets-test::${occurredAt.getTime()}`;
    const payload: GoogleSheetsDispatchLogPayload = {
      loggedAt: occurredAt.toISOString(),
      source: "manual",
      eventType: "initial_signal",
      transportType: "telegram",
      transportStatus: "sent",
      transportInfo: "Teste manual do webhook do Google Sheets",
      sentAt: occurredAt.toISOString(),
      rule: {
        id: "google-sheets-test",
        name: "Teste Google Sheets",
        isActive: true,
        transportType: "telegram",
        leagueType: "GT LEAGUE",
        methodCode: "(2D+)",
        series: null,
        playerName: null,
        apxMin: 0,
        minOccurrences: 1,
        windowDays: 21,
        recipients: ["google-sheets-test"],
        webhookUrl: null,
        note: "Teste manual do endpoint de Google Sheets",
        createdAt: occurredAt.toISOString(),
        updatedAt: occurredAt.toISOString(),
        lastEvaluatedAt: null,
      },
      signal: {
        signalKey,
        rootSignalKey: signalKey,
        confrontationKey: normalizeConfrontationKey(confrontationLabel),
        confrontationLabel,
        fixtureLabel: confrontationLabel,
        groupLabel: null,
        dayKey: occurredAt.toISOString().slice(0, 10),
        occurrenceMatchId: `google-sheets-test-${occurredAt.getTime()}`,
        occurrencePlayedAt: occurredAt.toISOString(),
        localPlayedAtLabel: occurredAt.toLocaleString("pt-BR"),
        result: "-",
        fullTimeScore: "-",
        apx: 50,
        initialApx: 50,
        currentApx: 50,
        apxDelta: 0,
        totalOccurrences: 1,
        initialTotalOccurrences: 1,
        currentTotalOccurrences: 1,
        wins: 0,
        draws: 0,
        losses: 1,
        methodCode: "(2D+)",
        playerName: inferredPlayers.playerName ?? "Teste Google Sheets",
        opponentName: inferredPlayers.opponentName ?? "Alertas",
        occurrenceResults: ["L"],
        triggerSequence: ["L", "L"],
        daySequence: ["W", "L", "L"],
        sourceView: "future-confrontations",
      },
      recipients: ["google-sheets-test"],
      message: input.message?.trim() || `Teste do Google Sheets para ${confrontationLabel}`,
    };

    const response = await postGoogleSheetsDispatch(webhookUrl, payload);

    return {
      webhookUrl,
      status: response.status,
      ok: response.ok,
      redirected: response.redirected,
      finalUrl: response.url,
      responseText: response.responseText,
      payload,
    };
  }

  async resolveFutureResults(options: { ruleId?: bigint; source?: DispatchSource } = {}) {
    const candidateDispatches = await this.listPendingFutureResultDispatches(options.ruleId);
    const candidateDispatchesByRule = new Map<bigint, AlertDispatchEntity[]>();

    for (const dispatch of candidateDispatches) {
      const ruleDispatches = candidateDispatchesByRule.get(dispatch.rule_id) ?? [];
      ruleDispatches.push(dispatch);
      candidateDispatchesByRule.set(dispatch.rule_id, ruleDispatches);
    }

    const items = [] as Array<{
      dispatchId: string;
      ruleId: string;
      signalKey: string;
      resolvedSignalKey: string;
      confrontationLabel: string;
      fixtureId: string;
      fixturePlayedAt: string | null;
      result: string | null;
      fullTimeScore: string | null;
      deliveryStatus: DispatchOutcome["status"] | "pending-result" | "rule-not-found" | "already-resolved";
      deliveryInfo: string;
    }>;
    let pendingFixtures = 0;
    let alreadyResolved = 0;
    let missingRules = 0;
    let dispatchedResults = 0;

    for (const [ruleId, ruleDispatches] of candidateDispatchesByRule.entries()) {
      const rule = await this.getRuleEntity(ruleId);
      if (!rule) {
        missingRules += ruleDispatches.length;
        for (const dispatch of ruleDispatches) {
          items.push({
            dispatchId: dispatch.id.toString(),
            ruleId: dispatch.rule_id.toString(),
            signalKey: dispatch.signal_key,
            resolvedSignalKey: buildResolvedFutureSignalKey(dispatch.signal_key),
            confrontationLabel: dispatch.confrontation_label,
            fixtureId: dispatch.occurrence_match_id,
            fixturePlayedAt: null,
            result: null,
            fullTimeScore: null,
            deliveryStatus: "rule-not-found",
            deliveryInfo: "Regra original nao encontrada para gerar o acompanhamento do resultado",
          });
        }

        continue;
      }

      const dispatchIndex = await this.listRuleDispatchIndex(ruleId);

      for (const dispatch of ruleDispatches) {
        const payload = parseStoredDispatchPayload(dispatch.payload_text);
        const storedSignal = extractPendingFutureSignal(payload);
        if (!storedSignal) {
          continue;
        }

        const resolvedSignalKey = buildResolvedFutureSignalKey(dispatch.signal_key);
        const existingResolvedDispatch = dispatchIndex.get(resolvedSignalKey) ?? null;
        if (existingResolvedDispatch && existingResolvedDispatch.transport_status !== "failed") {
          alreadyResolved += 1;
          items.push({
            dispatchId: dispatch.id.toString(),
            ruleId: dispatch.rule_id.toString(),
            signalKey: dispatch.signal_key,
            resolvedSignalKey,
            confrontationLabel: dispatch.confrontation_label,
            fixtureId: dispatch.occurrence_match_id,
            fixturePlayedAt: existingResolvedDispatch.occurrence_played_at.toISOString(),
            result: null,
            fullTimeScore: null,
            deliveryStatus: "already-resolved",
            deliveryInfo: "Resultado deste jogo futuro ja foi acompanhado anteriormente",
          });
          continue;
        }

        const completedFixture = await findCompletedFutureFixtureById(dispatch.occurrence_match_id);
        if (!completedFixture) {
          pendingFixtures += 1;
          items.push({
            dispatchId: dispatch.id.toString(),
            ruleId: dispatch.rule_id.toString(),
            signalKey: dispatch.signal_key,
            resolvedSignalKey,
            confrontationLabel: dispatch.confrontation_label,
            fixtureId: dispatch.occurrence_match_id,
            fixturePlayedAt: null,
            result: null,
            fullTimeScore: null,
            deliveryStatus: "pending-result",
            deliveryInfo: "O fixture ainda nao foi encontrado com placar final",
          });
          continue;
        }

        const resolvedSignal = buildFutureResolvedSignal(rule, dispatch, storedSignal, payload, completedFixture);
        const outcome = await this.dispatchSignal(rule, resolvedSignal, options.source ?? "manual");
        if (outcome.wasDispatched) {
          dispatchedResults += 1;
        }

        items.push({
          dispatchId: dispatch.id.toString(),
          ruleId: dispatch.rule_id.toString(),
          signalKey: dispatch.signal_key,
          resolvedSignalKey,
          confrontationLabel: dispatch.confrontation_label,
          fixtureId: dispatch.occurrence_match_id,
          fixturePlayedAt: completedFixture.playedAtIso,
          result: resolvedSignal.result,
          fullTimeScore: resolvedSignal.fullTimeScore,
          deliveryStatus: outcome.status,
          deliveryInfo: outcome.info,
        });
      }
    }

    return {
      checkedDispatches: candidateDispatches.length,
      pendingFixtures,
      alreadyResolved,
      missingRules,
      dispatchedResults,
      items,
    };
  }

  async runRules(options: RunRulesOptions = {}) {
    const dryRun = options.dryRun ?? false;
    const onlyActive = options.onlyActive ?? true;
    const executedAt = new Date();
    const rules =
      (await withAlertsPersistence(
        () =>
          prisma.alert_method_rules.findMany({
            where: {
              ...(options.ruleId ? { id: options.ruleId } : {}),
              ...(onlyActive ? { is_active: true } : {}),
            },
            orderBy: [{ id: "asc" }],
          }),
        () =>
          listMemoryRules({ ruleId: options.ruleId, onlyActive }).sort((left, right) => Number(left.id - right.id)),
      )) || [];

    const evaluations = [] as Array<{
      rule: ReturnType<typeof serializeRule>;
      matchedRows: number;
      triggeredSignals: number;
      dispatchedSignals: number;
      signals: Array<EvaluatedSignal & { deliveryStatus: DispatchOutcome["status"]; deliveryInfo: string }>;
    }>;
    let totalSignals = 0;
    let totalDispatched = 0;

    for (const rule of rules) {
      const evaluation = await this.evaluateRule(rule, {
        dryRun,
        source: options.source ?? "manual",
      });

      evaluations.push(evaluation);
      totalSignals += evaluation.triggeredSignals;
      totalDispatched += evaluation.dispatchedSignals;

      await withAlertsPersistence(
        () =>
          prisma.alert_method_rules.update({
            where: { id: rule.id },
            data: { last_evaluated_at: executedAt },
          }),
        () => updateMemoryRule(rule.id, { last_evaluated_at: executedAt }),
      );
    }

    return {
      executedAt: executedAt.toISOString(),
      dryRun,
      totalRules: rules.length,
      totalSignals,
      totalDispatched,
      rules: evaluations,
    };
  }

  async previewCurrentSignals(ruleId: bigint, options: { limit?: number } = {}) {
    const rule = await this.getRuleEntity(ruleId);
    if (!rule) {
      return null;
    }

    const preview = await this.collectRuleSignals(rule, {
      respectRuleCreatedAt: false,
      limit: options.limit,
      onlyDispatchable: true,
      currentWindowOnly: true,
    });

    return {
      rule: serializeRule(rule),
      matchedRows: preview.matchedRows,
      totalMatchingSignals: preview.totalMatchingSignals,
      totalEligibleSignals: preview.signals.length,
      alreadyProcessedSignals: preview.alreadyProcessedSignals,
      signals: preview.signals,
    };
  }

  async dispatchCurrentSignals(ruleId: bigint, options: { maxSignals?: number } = {}) {
    const rule = await this.getRuleEntity(ruleId);
    if (!rule) {
      return null;
    }

    const preview = await this.collectRuleSignals(rule, {
      respectRuleCreatedAt: false,
      onlyDispatchable: true,
      currentWindowOnly: true,
    });

    const maxSignals = typeof options.maxSignals === "number" ? Math.max(1, options.maxSignals) : preview.signals.length;
    const targetSignals = typeof options.maxSignals === "number" ? preview.signals.slice(0, maxSignals) : preview.signals;
    const sentSignals = [] as Array<SignalPreviewItem & { deliveryStatus: DispatchOutcome["status"]; deliveryInfo: string }>;
    let dispatchedSignals = 0;

    for (const signal of targetSignals) {
      const outcome = await this.dispatchSignal(
        rule,
        {
          signalKey: signal.signalKey,
          rootSignalKey: signal.rootSignalKey,
          confrontationKey: signal.confrontationKey,
          confrontationLabel: signal.confrontationLabel,
          dayKey: signal.dayKey,
          occurrenceMatchId: signal.occurrenceMatchId,
          occurrencePlayedAt: signal.occurrencePlayedAt,
          localPlayedAtLabel: signal.localPlayedAtLabel,
          result: signal.result,
          fullTimeScore: signal.fullTimeScore,
          apx: signal.apx,
          initialApx: signal.initialApx,
          currentApx: signal.currentApx,
          apxDelta: signal.apxDelta,
          totalOccurrences: signal.totalOccurrences,
          initialTotalOccurrences: signal.initialTotalOccurrences,
          currentTotalOccurrences: signal.currentTotalOccurrences,
          wins: signal.wins,
          draws: signal.draws,
          losses: signal.losses,
          telegramReplyTargets: signal.telegramReplyTargets,
          recipients: signal.recipients,
          message: signal.message,
        },
        "manual",
      );

      if (outcome.wasDispatched) {
        dispatchedSignals += 1;
      }

      sentSignals.push({
        ...signal,
        deliveryStatus: outcome.status,
        deliveryInfo: outcome.info,
      });
    }

    return {
      rule: serializeRule(rule),
      maxSignals,
      totalEligibleSignals: preview.signals.length,
      attemptedSignals: targetSignals.length,
      dispatchedSignals,
      remainingSignals: Math.max(0, preview.signals.length - targetSignals.length),
      signals: sentSignals,
    };
  }

  async sendTestDispatch(
    ruleId: bigint,
    input: { signalKey?: string; confrontationLabel?: string; message?: string } = {},
  ) {
    const rule = await this.getRuleEntity(ruleId);
    if (!rule) {
      return null;
    }

    const occurredAt = new Date();
    const confrontationLabel = input.confrontationLabel?.trim() || "TESTE OPERACIONAL x ALERTAS";
    const signalKey = input.signalKey?.trim() || `test::${ruleId.toString()}::${occurredAt.getTime()}`;
    const recipients = parseRecipients(rule.recipients);
    const signal: EvaluatedSignal = {
      signalKey,
      rootSignalKey: signalKey,
      confrontationKey: normalizeConfrontationKey(confrontationLabel),
      confrontationLabel,
      dayKey: occurredAt.toISOString().slice(0, 10),
      occurrenceMatchId: `test-match-${occurredAt.getTime()}`,
      occurrencePlayedAt: occurredAt.toISOString(),
      localPlayedAtLabel: occurredAt.toLocaleString("pt-BR"),
      result: "D",
      fullTimeScore: "teste",
      apx: toNumber(rule.apx_min),
      totalOccurrences: Math.max(1, rule.min_occurrences),
      recipients,
      message:
        input.message?.trim() ||
        [
          `Teste operacional do alerta: ${rule.name}`,
          `${rule.league_type}${rule.series ? ` Serie ${rule.series}` : ""} | ${rule.method_code}`,
          `Confronto: ${confrontationLabel}`,
          `Executado em: ${occurredAt.toLocaleString("pt-BR")}`,
          "Este payload foi gerado pelo disparo de teste manual do sistema de alertas.",
        ].join("\n"),
    };

    const outcome = await this.dispatchSignal(rule, signal, "manual");

    return {
      rule: serializeRule(rule),
      signal,
      deliveryStatus: outcome.status,
      deliveryInfo: outcome.info,
      wasDispatched: outcome.wasDispatched,
    };
  }

  async sendTestFutureDispatch(
    ruleId: bigint,
    input: {
      rootSignalKey?: string;
      confrontationLabel?: string;
      fixtureLabel?: string;
      scheduledAt?: string;
      apx?: number;
      totalOccurrences?: number;
      occurrenceResults?: string[];
      triggerSequence?: string[];
      daySequence?: string[];
      confrontationSequence?: string[];
      message?: string;
    } = {},
  ) {
    const rule = await this.getRuleEntity(ruleId);
    if (!rule) {
      return null;
    }

    const scheduledAt = input.scheduledAt ? new Date(input.scheduledAt) : new Date(Date.now() + 5 * 60 * 1000);
    const confrontationLabel = input.confrontationLabel?.trim() || "TESTE FUTURO x ALERTAS";
    const rootSignalKey = input.rootSignalKey?.trim() || `manual-future::${ruleId.toString()}::${scheduledAt.getTime()}`;
    const occurrenceMatchId = `manual-future-${scheduledAt.getTime()}`;
    const recipients = parseRecipients(rule.recipients);
    const initialApx = typeof input.apx === "number" ? input.apx : Math.max(0, toNumber(rule.apx_min));
    const initialTotalOccurrences = Math.max(1, input.totalOccurrences ?? rule.min_occurrences);
    const baseCounts = deriveManualOutcomeCounts(initialApx, initialTotalOccurrences);
    const inferredPlayers = inferPlayersFromConfrontationLabel(confrontationLabel);
    const triggerSequence = input.triggerSequence?.length ? input.triggerSequence : ["L", "L"];
    const daySequence = input.daySequence?.length ? input.daySequence : ["W", "L", "L"];
    const confrontationSequence = input.confrontationSequence?.length ? input.confrontationSequence : ["W", "L", "L"];
    const occurrenceResults = input.occurrenceResults?.length ? input.occurrenceResults : [];
    const signal: EvaluatedSignal = {
      signalKey: rootSignalKey,
      rootSignalKey,
      confrontationKey: normalizeConfrontationKey(confrontationLabel),
      confrontationLabel,
      dayKey: scheduledAt.toISOString().slice(0, 10),
      occurrenceMatchId,
      occurrencePlayedAt: scheduledAt.toISOString(),
      localPlayedAtLabel: scheduledAt.toLocaleString("pt-BR"),
      result: "-",
      fullTimeScore: "-",
      apx: initialApx,
      initialApx,
      currentApx: initialApx,
      apxDelta: 0,
      totalOccurrences: initialTotalOccurrences,
      initialTotalOccurrences,
      currentTotalOccurrences: initialTotalOccurrences,
      wins: baseCounts.wins,
      draws: baseCounts.draws,
      losses: baseCounts.losses,
      recipients,
      methodCode: String(rule.method_code),
      fixtureLabel: input.fixtureLabel?.trim() || confrontationLabel,
      groupLabel: rule.series ?? null,
      playerName: inferredPlayers.playerName ?? "Teste Futuro",
      opponentName: inferredPlayers.opponentName ?? "Alertas",
      occurrenceResults,
      triggerSequence,
      daySequence,
      confrontationSequence,
      sourceView: "future-confrontations",
      message:
        input.message?.trim() ||
        [
          `Metodo em sinal: ${rule.name}`,
          `${rule.league_type}${rule.series ? ` Serie ${rule.series}` : ""} | ${rule.method_code}`,
          `Confronto: ${confrontationLabel}`,
          `APX: ${formatPercentage(initialApx)} | Ocorrencias: ${initialTotalOccurrences}`,
          `Resultados ocorrencias: ${formatSequenceForAlert(rule, occurrenceResults)}`,
          `Proximo jogo: ${scheduledAt.toLocaleString("pt-BR")} | Resultado: pendente | Placar: -`,
          `Gatilho metodo: ${formatSequenceForAlert(rule, triggerSequence)}`,
          `Hist. Seq. Dia Jogador: ${formatSequenceForAlert(rule, daySequence)}`,
          `Hist. Seq. Dia Confronto: ${formatSequenceForAlert(rule, confrontationSequence)}`,
          "Teste manual de jogo futuro para validar Telegram + Google Sheets.",
        ].join("\n"),
    };

    const outcome = await this.dispatchSignal(rule, signal, "manual");

    return {
      rule: serializeRule(rule),
      signal,
      rootSignalKey,
      deliveryStatus: outcome.status,
      deliveryInfo: outcome.info,
      wasDispatched: outcome.wasDispatched,
    };
  }

  async sendTestFutureResolution(
    ruleId: bigint,
    input: { rootSignalKey: string; result?: "W" | "D" | "L"; fullTimeScore?: string; resolvedAt?: string },
  ) {
    const rule = await this.getRuleEntity(ruleId);
    if (!rule) {
      return null;
    }

    const initialDispatch = await withAlertsPersistence(
      () =>
        prisma.alert_method_dispatches.findUnique({
          where: {
            rule_id_signal_key: {
              rule_id: ruleId,
              signal_key: input.rootSignalKey,
            },
          },
        }),
      () => findMemoryDispatch(ruleId, input.rootSignalKey),
    );

    if (!initialDispatch) {
      throw new Error("Sinal futuro de teste nao encontrado para esta regra");
    }

    const payload = parseStoredDispatchPayload(initialDispatch.payload_text);
    const storedSignal = extractPendingFutureSignal(payload);
    if (!storedSignal) {
      throw new Error("O dispatch informado nao e um sinal futuro pendente valido");
    }

    const result = input.result ?? "W";
    const resolvedAt = input.resolvedAt ? new Date(input.resolvedAt) : new Date();
    const completedFixture = buildManualCompletedFixture(initialDispatch, storedSignal, {
      result,
      fullTimeScore: input.fullTimeScore,
      resolvedAt,
    });
    const resolvedSignal = buildFutureResolvedSignal(rule, initialDispatch, storedSignal, payload, completedFixture);
    const outcome = await this.dispatchSignal(rule, resolvedSignal, "manual");

    return {
      rule: serializeRule(rule),
      rootSignalKey: input.rootSignalKey,
      signal: resolvedSignal,
      deliveryStatus: outcome.status,
      deliveryInfo: outcome.info,
      wasDispatched: outcome.wasDispatched,
    };
  }

  private async evaluateRule(rule: AlertRuleEntity, options: { dryRun: boolean; source: DispatchSource }) {
    const preview = await this.collectRuleSignals(rule, {
      respectRuleCreatedAt: true,
      onlyDispatchable: false,
      currentWindowOnly: true,
    });

    const signals = [] as Array<EvaluatedSignal & { deliveryStatus: DispatchOutcome["status"]; deliveryInfo: string }>;
    let dispatchedSignals = 0;

    for (const signal of preview.signals) {
      const evaluatedSignal = signalToEvaluatedSignal(signal);
      const outcome: DispatchOutcome = options.dryRun
        ? { status: "dry_run", info: "Execucao em modo simulacao", wasDispatched: false }
        : await this.dispatchSignal(rule, evaluatedSignal, options.source);

      if (outcome.wasDispatched) {
        dispatchedSignals += 1;
      }

      signals.push({
        ...evaluatedSignal,
        deliveryStatus: outcome.status,
        deliveryInfo: outcome.info,
      });
    }

    return {
      rule: serializeRule(rule),
      matchedRows: preview.matchedRows,
      triggeredSignals: signals.length,
      dispatchedSignals,
      signals,
    };
  }

  private async getRuleEntity(ruleId: bigint) {
    return withAlertsPersistence(
      () => prisma.alert_method_rules.findUnique({ where: { id: ruleId } }),
      () => getMemoryRule(ruleId),
    );
  }

  private async collectRuleSignals(
    rule: AlertRuleEntity,
    options: { respectRuleCreatedAt: boolean; limit?: number; onlyDispatchable: boolean; currentWindowOnly?: boolean },
  ) {
    const recipients = parseRecipients(rule.recipients);
    const existingDispatches = await this.listRuleDispatchIndex(rule.id);
    const signals = [] as SignalPreviewItem[];
    let alreadyProcessedSignals = 0;

    // Build set of confrontation keys that have unresolved future dispatches,
    // so we don't re-alert the same confrontation when the fixture ID rolls over.
    // Uses direction-agnostic normalization so "EROS||CRYSIS" matches "CRYSIS||EROS".
    const pendingFutureConfrontationKeys = new Set<string>();
    for (const [signalKey, dispatch] of existingDispatches) {
      if (dispatch.transport_status !== "sent" && dispatch.transport_status !== "skipped") continue;
      const resolvedKey = buildResolvedFutureSignalKey(signalKey);
      if (existingDispatches.has(resolvedKey)) continue; // already resolved
      const payload = parseStoredDispatchPayload(dispatch.payload_text);
      if (extractPendingFutureSignal(payload)) {
        pendingFutureConfrontationKeys.add(normalizePairKey(dispatch.confrontation_key));
      }
    }

    if (options.currentWindowOnly) {
      if (rule.method_code === "4D Jogador" || rule.method_code === "4W Jogador") {
        const futurePlayerSessions = await getFuturePlayerSessionMethodsLive(rule.league_type as AlertLeagueType, {
          methodCode: rule.method_code as "4D Jogador" | "4W Jogador",
          series: (rule.series as AlertSeriesCode | null) ?? undefined,
          days: rule.window_days,
          apxMin: toNumber(rule.apx_min),
          minOccurrences: rule.min_occurrences,
        });
        let totalMatchingSignals = 0;

        for (const row of futurePlayerSessions.rows) {
          if (!matchesRulePlayerFilter(rule, row.playerName)) {
            continue;
          }

          const fixtureAt = new Date(row.playedAtIso);
          if (Number.isNaN(fixtureAt.getTime())) {
            continue;
          }

          if (options.respectRuleCreatedAt && fixtureAt.getTime() < rule.created_at.getTime()) {
            continue;
          }

          totalMatchingSignals += 1;

          const baseSignal = buildFuturePlayerSessionSignal(rule, row, futurePlayerSessions.currentWindow.dayKey, recipients);
          const existingDispatch = existingDispatches.get(baseSignal.signalKey) ?? null;
          const coveredByPendingFuture = pendingFutureConfrontationKeys.has(normalizePairKey(baseSignal.confrontationKey));
          const alreadyProcessed = Boolean((existingDispatch && existingDispatch.transport_status !== "failed") || coveredByPendingFuture);
          if (alreadyProcessed) {
            alreadyProcessedSignals += 1;
            if (options.onlyDispatchable) {
              continue;
            }
          }

          signals.push({
            ...baseSignal,
            alreadyProcessed,
            lastTransportStatus: existingDispatch?.transport_status ?? null,
            lastSentAt: existingDispatch?.sent_at?.toISOString() ?? null,
          });
        }

        signals.sort((left, right) => new Date(left.occurrencePlayedAt).getTime() - new Date(right.occurrencePlayedAt).getTime());

        return {
          matchedRows: futurePlayerSessions.rows.filter((row) => matchesRulePlayerFilter(rule, row.playerName)).length,
          totalMatchingSignals,
          alreadyProcessedSignals,
          signals: typeof options.limit === "number" ? signals.slice(0, options.limit) : signals,
        };
      }

      if (rule.method_code === "Fav T1" || rule.method_code === "Fav T2" || rule.method_code === "Fav T3") {
        const favResults = await getFutureFavoritoVsFracoMethodsLive(rule.league_type as AlertLeagueType, {
          methodCode: rule.method_code as "Fav T1" | "Fav T2" | "Fav T3",
          series: (rule.series as AlertSeriesCode | null) ?? undefined,
          days: rule.window_days,
        });
        let totalMatchingSignals = 0;

        for (const row of favResults.rows) {
          if (!matchesRulePlayerFilter(rule, row.playerName)) {
            continue;
          }

          const fixtureAt = new Date(row.playedAtIso);
          if (Number.isNaN(fixtureAt.getTime())) {
            continue;
          }

          if (options.respectRuleCreatedAt && fixtureAt.getTime() < rule.created_at.getTime()) {
            continue;
          }

          totalMatchingSignals += 1;

          const baseSignal = buildFuturePlayerSessionSignal(rule, row, favResults.currentWindow.dayKey, recipients);
          const existingDispatch = existingDispatches.get(baseSignal.signalKey) ?? null;
          const coveredByPendingFuture = pendingFutureConfrontationKeys.has(normalizePairKey(baseSignal.confrontationKey));
          const alreadyProcessed = Boolean((existingDispatch && existingDispatch.transport_status !== "failed") || coveredByPendingFuture);
          if (alreadyProcessed) {
            alreadyProcessedSignals += 1;
            if (options.onlyDispatchable) {
              continue;
            }
          }

          signals.push({
            ...baseSignal,
            alreadyProcessed,
            lastTransportStatus: existingDispatch?.transport_status ?? null,
            lastSentAt: existingDispatch?.sent_at?.toISOString() ?? null,
          });
        }

        signals.sort((left, right) => new Date(left.occurrencePlayedAt).getTime() - new Date(right.occurrencePlayedAt).getTime());

        return {
          matchedRows: favResults.rows.filter((row) => matchesRulePlayerFilter(rule, row.playerName)).length,
          totalMatchingSignals,
          alreadyProcessedSignals,
          signals: typeof options.limit === "number" ? signals.slice(0, options.limit) : signals,
        };
      }

      const futureConfrontations = await methodsService.getFutureConfrontationMethods(rule.league_type as AlertLeagueType, {
        series: (rule.series as AlertSeriesCode | null) ?? undefined,
        methodCode: rule.method_code as AlertMethodCode,
        days: rule.window_days,
        apxMin: toNumber(rule.apx_min),
        minOccurrences: rule.min_occurrences,
      });
      let totalMatchingSignals = 0;

      for (const row of futureConfrontations.rows) {
        if (!matchesRulePlayerFilter(rule, row.playerName)) {
          continue;
        }

        const fixtureAt = new Date(row.playedAtIso);
        if (Number.isNaN(fixtureAt.getTime())) {
          continue;
        }

        if (options.respectRuleCreatedAt && fixtureAt.getTime() < rule.created_at.getTime()) {
          continue;
        }

        totalMatchingSignals += 1;

        const baseSignal = buildFutureSignal(rule, row, futureConfrontations.currentWindow.dayKey, recipients);
        const existingDispatch = existingDispatches.get(baseSignal.signalKey) ?? null;
        const coveredByPendingFuture = pendingFutureConfrontationKeys.has(normalizePairKey(baseSignal.confrontationKey));
        const alreadyProcessed = Boolean((existingDispatch && existingDispatch.transport_status !== "failed") || coveredByPendingFuture);
        if (alreadyProcessed) {
          alreadyProcessedSignals += 1;
          if (options.onlyDispatchable) {
            continue;
          }
        }

        signals.push({
          ...baseSignal,
          alreadyProcessed,
          lastTransportStatus: existingDispatch?.transport_status ?? null,
          lastSentAt: existingDispatch?.sent_at?.toISOString() ?? null,
        });
      }

      signals.sort((left, right) => new Date(left.occurrencePlayedAt).getTime() - new Date(right.occurrencePlayedAt).getTime());

      return {
        matchedRows: futureConfrontations.rows.filter((row) => matchesRulePlayerFilter(rule, row.playerName)).length,
        totalMatchingSignals,
        alreadyProcessedSignals,
        signals: typeof options.limit === "number" ? signals.slice(0, options.limit) : signals,
      };
    }

    const confrontationData = await getConfrontationMethodsLive(rule.league_type as AlertLeagueType, rule.method_code as AlertMethodCode, {
      series: (rule.series as AlertSeriesCode | null) ?? undefined,
      includeHistory: true,
      days: rule.window_days,
    });

    const matchingRows = confrontationData.rows.filter((row) => {
      const inferredPlayers = inferPlayersFromConfrontationLabel(row.confrontationLabel);
      return (
        row.apx >= toNumber(rule.apx_min) &&
        row.totalOccurrences >= rule.min_occurrences &&
        matchesRulePlayerFilter(rule, inferredPlayers.playerName)
      );
    });
    let totalMatchingSignals = 0;

    for (const row of matchingRows) {
      for (const occurrence of row.history) {
        const occurredAt = new Date(occurrence.playedAtIso);
        if (Number.isNaN(occurredAt.getTime())) {
          continue;
        }

        if (options.respectRuleCreatedAt && occurredAt.getTime() < rule.created_at.getTime()) {
          continue;
        }

        totalMatchingSignals += 1;

        const baseSignal = buildSignal(rule, row, occurrence, recipients);
        const existingDispatch = existingDispatches.get(baseSignal.signalKey) ?? null;
        const alreadyProcessed = Boolean(existingDispatch && existingDispatch.transport_status !== "failed");
        if (alreadyProcessed) {
          alreadyProcessedSignals += 1;
          if (options.onlyDispatchable) {
            continue;
          }
        }

        signals.push({
          ...baseSignal,
          alreadyProcessed,
          lastTransportStatus: existingDispatch?.transport_status ?? null,
          lastSentAt: existingDispatch?.sent_at?.toISOString() ?? null,
        });
      }
    }

    signals.sort((left, right) => new Date(left.occurrencePlayedAt).getTime() - new Date(right.occurrencePlayedAt).getTime());

    return {
      matchedRows: matchingRows.length,
      totalMatchingSignals,
      alreadyProcessedSignals,
      signals: typeof options.limit === "number" ? signals.slice(0, options.limit) : signals,
    };
  }

  private async listRuleDispatchIndex(ruleId: bigint) {
    const dispatches = await withAlertsPersistence(
      () =>
        prisma.alert_method_dispatches.findMany({
          where: { rule_id: ruleId },
          orderBy: [{ created_at: "desc" }],
        }),
      () => listMemoryDispatches({ ruleId, limit: Number.MAX_SAFE_INTEGER }),
    );

    return new Map(dispatches.map((dispatch) => [dispatch.signal_key, dispatch]));
  }

  private async listPendingFutureResultDispatches(ruleId?: bigint) {
    const now = new Date();
    const dispatches = await withAlertsPersistence(
      () =>
        prisma.alert_method_dispatches.findMany({
          where: {
            ...(ruleId ? { rule_id: ruleId } : {}),
            occurrence_played_at: { lte: now },
            transport_status: { in: ["sent", "skipped"] },
          },
          orderBy: [{ occurrence_played_at: "asc" }, { created_at: "asc" }],
        }),
      () =>
        listMemoryDispatches({ ruleId, limit: Number.MAX_SAFE_INTEGER }).filter(
          (dispatch) => dispatch.occurrence_played_at.getTime() <= now.getTime() && ["sent", "skipped"].includes(dispatch.transport_status),
        ),
    );

    return dispatches.filter((dispatch) => Boolean(extractPendingFutureSignal(parseStoredDispatchPayload(dispatch.payload_text))));
  }

  private async dispatchSignal(rule: AlertRuleEntity, signal: EvaluatedSignal, source: DispatchSource): Promise<DispatchOutcome> {
    const existingDispatch = await withAlertsPersistence(
      () =>
        prisma.alert_method_dispatches.findUnique({
          where: {
            rule_id_signal_key: {
              rule_id: rule.id,
              signal_key: signal.signalKey,
            },
          },
        }),
      () => findMemoryDispatch(rule.id, signal.signalKey),
    );

    if (existingDispatch && existingDispatch.transport_status !== "failed") {
      return {
        status: "duplicate",
        info: "Sinal ja processado anteriormente",
        wasDispatched: false,
      };
    }

    const payload = {
      source,
      eventType: getDispatchEventTypeFromSignal(signal),
      rootSignalKey: signal.rootSignalKey,
      rule: serializeRule(rule),
      signal: {
        signalKey: signal.signalKey,
        rootSignalKey: signal.rootSignalKey,
        confrontationKey: signal.confrontationKey,
        confrontationLabel: signal.confrontationLabel,
        dayKey: signal.dayKey,
        occurrenceMatchId: signal.occurrenceMatchId,
        occurrencePlayedAt: signal.occurrencePlayedAt,
        localPlayedAtLabel: signal.localPlayedAtLabel,
        result: signal.result,
        fullTimeScore: signal.fullTimeScore,
        apx: signal.apx,
        initialApx: signal.initialApx,
        currentApx: signal.currentApx,
        apxDelta: signal.apxDelta,
        totalOccurrences: signal.totalOccurrences,
        initialTotalOccurrences: signal.initialTotalOccurrences,
        currentTotalOccurrences: signal.currentTotalOccurrences,
        wins: signal.wins,
        draws: signal.draws,
        losses: signal.losses,
        methodCode: signal.methodCode,
        fixtureLabel: signal.fixtureLabel,
        groupLabel: signal.groupLabel,
        playerName: signal.playerName,
        opponentName: signal.opponentName,
        occurrenceResults: signal.occurrenceResults,
        triggerSequence: signal.triggerSequence,
        daySequence: signal.daySequence,
        confrontationSequence: signal.confrontationSequence,
        sourceView: signal.sourceView,
      },
      recipients: signal.recipients,
      message: signal.message,
    };

    const dispatchRecord = existingDispatch
      ? await withAlertsPersistence(
          () =>
            prisma.alert_method_dispatches.update({
              where: { id: existingDispatch.id },
              data: {
                transport_status: "pending",
                transport_response: null,
                payload_text: JSON.stringify(payload, null, 2),
                recipients_snapshot: signal.recipients.join(", "),
              },
            }),
          () =>
            updateMemoryDispatch(existingDispatch.id, {
              transport_status: "pending",
              transport_response: null,
              payload_text: JSON.stringify(payload, null, 2),
              recipients_snapshot: signal.recipients.join(", "),
            }),
        )
      : await createDispatchRecord(rule.id, signal, payload);

    if (!dispatchRecord) {
      throw new Error("Nao foi possivel registrar o dispatch do alerta");
    }

    const transportType = getRuleTransportType(rule);
    if (transportType === "telegram") {
      const chatIds = signal.recipients.length ? signal.recipients : parseRecipients(env.TELEGRAM_DEFAULT_CHAT_IDS ?? "");
      if (!chatIds.length) {
        const googleSheetsAttempt = await logGoogleSheetsDispatchBestEffort({
          loggedAt: new Date().toISOString(),
          source,
          eventType: getDispatchEventTypeFromSignal(signal),
          transportType: "telegram",
          transportStatus: "skipped",
          transportInfo: "Telegram sem chat_id configurado",
          sentAt: null,
          rule: serializeRule(rule),
          signal: buildGoogleSheetsSignal(signal),
          recipients: chatIds,
          message: signal.message,
        });
        await persistDispatchResult(
          dispatchRecord.id,
          "skipped",
          appendGoogleSheetsInfoToTransportResponse("Telegram sem chat_id configurado", googleSheetsAttempt),
        );
        await this.persistLocalRulesStateIfVolatile();

        return {
          status: "skipped",
          info: "Telegram sem chat_id configurado",
          wasDispatched: false,
        };
      }

      try {
        const responseText = await sendTelegramMessage(chatIds, signal.message, {
          editMessageIdByChatId: signal.telegramReplyTargets?.length
            ? new Map(signal.telegramReplyTargets.map((item) => [item.chatId, item.messageId]))
            : undefined,
        });
        const sentAt = new Date();
        const googleSheetsAttempt = await logGoogleSheetsDispatchBestEffort({
          loggedAt: new Date().toISOString(),
          source,
          eventType: getDispatchEventTypeFromSignal(signal),
          transportType: "telegram",
          transportStatus: "sent",
          transportInfo: responseText || "Mensagem enviada ao Telegram",
          sentAt: sentAt.toISOString(),
          rule: serializeRule(rule),
          signal: buildGoogleSheetsSignal(signal),
          recipients: chatIds,
          message: signal.message,
        });
        await persistDispatchResult(
          dispatchRecord.id,
          "sent",
          appendGoogleSheetsInfoToTransportResponse(responseText, googleSheetsAttempt).slice(0, 20000),
          sentAt,
        );
        await this.persistLocalRulesStateIfVolatile();

        return {
          status: "sent",
          info: responseText || "Mensagem enviada ao Telegram",
          wasDispatched: true,
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : "Falha ao enviar Telegram";
        const googleSheetsAttempt = await logGoogleSheetsDispatchBestEffort({
          loggedAt: new Date().toISOString(),
          source,
          eventType: getDispatchEventTypeFromSignal(signal),
          transportType: "telegram",
          transportStatus: "failed",
          transportInfo: message,
          sentAt: null,
          rule: serializeRule(rule),
          signal: buildGoogleSheetsSignal(signal),
          recipients: chatIds,
          message: signal.message,
        });
        await persistDispatchResult(
          dispatchRecord.id,
          "failed",
          appendGoogleSheetsInfoToTransportResponse(message, googleSheetsAttempt),
        );
        await this.persistLocalRulesStateIfVolatile();

        return {
          status: "failed",
          info: message,
          wasDispatched: false,
        };
      }
    }

    const webhookUrl = rule.webhook_url ?? env.ALERTS_WEBHOOK_URL;
    if (!webhookUrl) {
      await persistDispatchResult(dispatchRecord.id, "skipped", "Webhook nao configurado");
      await this.persistLocalRulesStateIfVolatile();

      return {
        status: "skipped",
        info: "Webhook nao configurado",
        wasDispatched: false,
      };
    }

    try {
      const response = await fetch(webhookUrl, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(env.ALERTS_WEBHOOK_TOKEN ? { authorization: `Bearer ${env.ALERTS_WEBHOOK_TOKEN}` } : {}),
        },
        body: JSON.stringify(payload),
      });

      const responseText = await response.text();
      if (!response.ok) {
        throw new Error(`Webhook respondeu ${response.status}: ${responseText}`);
      }

      await persistDispatchResult(dispatchRecord.id, "sent", responseText.slice(0, 20000), new Date());
      await this.persistLocalRulesStateIfVolatile();

      return {
        status: "sent",
        info: responseText || "Enviado com sucesso",
        wasDispatched: true,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Falha ao enviar webhook";

      await persistDispatchResult(dispatchRecord.id, "failed", message);
      await this.persistLocalRulesStateIfVolatile();

      return {
        status: "failed",
        info: message,
        wasDispatched: false,
      };
    }
  }
}

async function createDispatchRecord(ruleId: bigint, signal: EvaluatedSignal, payload: Record<string, unknown>) {
  try {
    return await prisma.alert_method_dispatches.create({
      data: {
        rule_id: ruleId,
        signal_key: signal.signalKey,
        confrontation_key: signal.confrontationKey,
        confrontation_label: signal.confrontationLabel,
        day_key: signal.dayKey,
        occurrence_match_id: signal.occurrenceMatchId,
        occurrence_played_at: new Date(signal.occurrencePlayedAt),
        apx: new Prisma.Decimal(signal.apx),
        total_occurrences: signal.totalOccurrences,
        payload_text: JSON.stringify(payload, null, 2),
        recipients_snapshot: signal.recipients.join(", "),
        transport_status: "pending",
      },
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return prisma.alert_method_dispatches.findUniqueOrThrow({
        where: {
          rule_id_signal_key: {
            rule_id: ruleId,
            signal_key: signal.signalKey,
          },
        },
      });
    }

    if (isAlertsTablesUnavailableError(error)) {
      const existingDispatch = findMemoryDispatch(ruleId, signal.signalKey);
      if (existingDispatch) {
        return existingDispatch;
      }

      return createMemoryDispatch({
        rule_id: ruleId,
        signal_key: signal.signalKey,
        confrontation_key: signal.confrontationKey,
        confrontation_label: signal.confrontationLabel,
        day_key: signal.dayKey,
        occurrence_match_id: signal.occurrenceMatchId,
        occurrence_played_at: new Date(signal.occurrencePlayedAt),
        apx: new Prisma.Decimal(signal.apx),
        total_occurrences: signal.totalOccurrences,
        payload_text: JSON.stringify(payload, null, 2),
        recipients_snapshot: signal.recipients.join(", "),
        transport_status: "pending",
        transport_response: null,
        sent_at: null,
      });
    }

    throw error;
  }
}

async function readLocalLatestBackup(): Promise<AlertRulesBackup> {
  const content = await readFile(ALERTS_LOCAL_BACKUP_LATEST_PATH, "utf8");
  return JSON.parse(content) as AlertRulesBackup;
}

function extractExportedAtFromFileName(fileName: string) {
  const match = /^alerts-backup-(\d{4})-(\d{2})-(\d{2})-(\d{2})-(\d{2})-(\d{2})\.json$/i.exec(fileName);
  if (!match) {
    return null;
  }

  const [, year, month, day, hour, minute, second] = match;
  return `${year}-${month}-${day}T${hour}:${minute}:${second}.000Z`;
}

function buildSignal(rule: AlertRuleEntity, row: ConfrontationRow, occurrence: ConfrontationOccurrence, recipients: string[]): EvaluatedSignal {
  const triggerSequenceLabel = formatTriggerSequenceForAlert(rule, occurrence);
  const daySequenceLabel = formatOccurrenceDaySequenceForAlert(rule, occurrence);
  const signalKey = `${row.confrontationKey}::${occurrence.matchId}`;

  return {
    signalKey,
    rootSignalKey: signalKey,
    confrontationKey: row.confrontationKey,
    confrontationLabel: row.confrontationLabel,
    dayKey: occurrence.dayKey,
    occurrenceMatchId: occurrence.matchId,
    occurrencePlayedAt: occurrence.playedAtIso,
    localPlayedAtLabel: occurrence.localPlayedAtLabel,
    result: occurrence.result,
    fullTimeScore: occurrence.fullTimeScore,
    apx: row.apx,
    totalOccurrences: row.totalOccurrences,
    recipients,
    methodCode: String(rule.method_code),
    triggerSequence: occurrence.triggerSequence,
    daySequence: occurrence.daySequence,
    sourceView: "historical",
    message: [
      `<b>${escapeHtml(String(rule.league_type))}${rule.series ? ` Serie ${rule.series}` : ""} | ${escapeHtml(String(rule.method_code))}</b>`,
      `<b>Confronto:</b> ${escapeHtml(row.confrontationLabel)}`,
      `<b>APX:</b> ${formatPercentage(row.apx)} | <b>Ocorrencias:</b> ${row.totalOccurrences}`,
      `<b>Jogo:</b> ${occurrence.localPlayedAtLabel} | <b>Resultado:</b> ${occurrence.result} | <b>Placar:</b> ${occurrence.fullTimeScore}`,
      `<b>Gatilho metodo:</b> ${triggerSequenceLabel}`,
      `<b>Historico sequencia dia:</b> ${daySequenceLabel}`,
      `<b>Janela:</b> ultimos ${rule.window_days} dias`,
    ].join("\n"),
  };
}

function buildFutureSignal(
  rule: AlertRuleEntity,
  row: FutureConfrontationRow,
  dayKey: string,
  recipients: string[],
): EvaluatedSignal {
  return {
    signalKey: `${row.confrontationKey}::${row.fixtureId}`,
    rootSignalKey: `${row.confrontationKey}::${row.fixtureId}`,
    confrontationKey: row.confrontationKey,
    confrontationLabel: row.confrontationLabel,
    dayKey,
    occurrenceMatchId: row.fixtureId,
    occurrencePlayedAt: row.playedAtIso,
    localPlayedAtLabel: row.localPlayedAtLabel,
    result: "-",
    fullTimeScore: "-",
    apx: row.apx,
    initialApx: row.apx,
    currentApx: row.apx,
    apxDelta: 0,
    totalOccurrences: row.totalOccurrences,
    initialTotalOccurrences: row.totalOccurrences,
    currentTotalOccurrences: row.totalOccurrences,
    wins: row.wins,
    draws: row.draws,
    losses: row.losses,
    recipients,
    methodCode: row.methodCode,
    fixtureLabel: row.fixtureLabel,
    groupLabel: row.groupLabel,
    playerName: row.playerName,
    opponentName: row.opponentName,
    occurrenceResults: row.occurrenceResults,
    triggerSequence: row.triggerSequence,
    daySequence: row.daySequence,
    confrontationSequence: row.confrontationSequence,
    sourceView: "future-confrontations",
    message: [
      `<b>${escapeHtml(String(rule.league_type))}${rule.series ? ` Serie ${rule.series}` : ""} | ${escapeHtml(String(rule.method_code))}</b>`,
      `<b>Confronto:</b> ${escapeHtml(row.confrontationLabel)}`,
      `<b>APX:</b> ${formatPercentage(row.apx)}`,
      `<b>Ocorrencias:</b> ${row.totalOccurrences}`,
      `<b>Resultados ocorrencias:</b> ${formatSequenceForAlert(rule, row.occurrenceResults ?? [])}`,
      `<b>Proximo jogo:</b> ${row.localPlayedAtLabel}`,
      `<b>Resultado:</b> pendente`,
      `<b>Gatilho metodo:</b> ${formatSequenceForAlert(rule, row.triggerSequence)}`,
      `<b>Hist. Seq. Dia Jogador:</b> ${formatSequenceForAlert(rule, row.daySequence)}`,
      `<b>Hist. Seq. Dia Confronto:</b> ${formatSequenceForAlert(rule, row.confrontationSequence ?? [])}`,
      `<b>WR jogador (${rule.window_days}d):</b> ${row.playerWinRate}%`,
      `<b>WR oponente (${rule.window_days}d):</b> ${row.opponentWinRate}%`,
      `<b>H2H (48j):</b> ${row.h2hLast48.wr}% (${row.h2hLast48.total}j: ${row.h2hLast48.wins}W)`,
      `<b>H2H (24j):</b> ${row.h2hLast24.wr}% (${row.h2hLast24.total}j: ${row.h2hLast24.wins}W)`,
      `<b>Delta H2H:</b> ${(row.h2hLast48.wr - row.h2hLast24.wr) >= 0 ? "+" : ""}${(row.h2hLast48.wr - row.h2hLast24.wr).toFixed(1)}pp`,
      `<b>Janela:</b> ultimos ${rule.window_days} dias`,
    ].join("\n"),
  };
}

function buildFuturePlayerSessionSignal(
  rule: AlertRuleEntity,
  row: FuturePlayerSessionRow,
  dayKey: string,
  recipients: string[],
): EvaluatedSignal {
  return {
    signalKey: `${row.confrontationKey}::${row.fixtureId}`,
    rootSignalKey: `${row.confrontationKey}::${row.fixtureId}`,
    confrontationKey: row.confrontationKey,
    confrontationLabel: row.confrontationLabel,
    dayKey,
    occurrenceMatchId: row.fixtureId,
    occurrencePlayedAt: row.playedAtIso,
    localPlayedAtLabel: row.localPlayedAtLabel,
    result: "-",
    fullTimeScore: "-",
    apx: row.apx,
    initialApx: row.apx,
    currentApx: row.apx,
    apxDelta: 0,
    totalOccurrences: row.totalOccurrences,
    initialTotalOccurrences: row.totalOccurrences,
    currentTotalOccurrences: row.totalOccurrences,
    wins: row.wins,
    draws: row.draws,
    losses: row.losses,
    recipients,
    methodCode: row.methodCode,
    fixtureLabel: row.fixtureLabel,
    groupLabel: row.groupLabel,
    playerName: row.playerName,
    opponentName: row.opponentName,
    occurrenceResults: row.occurrenceResults,
    triggerSequence: row.triggerSequence,
    daySequence: row.daySequence,
    sourceView: "future-player-sessions",
    message: [
      `<b>${escapeHtml(String(rule.league_type))}${rule.series ? ` Serie ${rule.series}` : ""} | ${escapeHtml(String(rule.method_code))}</b>`,
      `<b>Jogador:</b> ${escapeHtml(row.playerName)}`,
      `<b>Oponente:</b> ${escapeHtml(row.opponentName)}`,
      `<b>APX:</b> ${formatPercentage(row.apx)}`,
      `<b>Ocorrencias:</b> ${row.totalOccurrences}`,
      `<b>Resultados ocorrencias:</b> ${formatSequenceForAlert(rule, row.occurrenceResults ?? [])}`,
      `<b>Proximo jogo:</b> ${row.localPlayedAtLabel}`,
      `<b>Resultado:</b> pendente`,
      `<b>Gatilho jogador:</b> ${formatSequenceForAlert(rule, row.triggerSequence)}`,
      `<b>Historico sequencia dia/sessao:</b> ${formatSequenceForAlert(rule, row.daySequence)}`,
      `<b>WR jogador (${rule.window_days}d):</b> ${row.playerWinRate}%`,
      `<b>WR oponente (${rule.window_days}d):</b> ${row.opponentWinRate}%`,
      `<b>H2H (48j):</b> ${row.h2hLast48.wr}% (${row.h2hLast48.total}j: ${row.h2hLast48.wins}W)`,
      `<b>H2H (24j):</b> ${row.h2hLast24.wr}% (${row.h2hLast24.total}j: ${row.h2hLast24.wins}W)`,
      `<b>Delta H2H:</b> ${(row.h2hLast48.wr - row.h2hLast24.wr) >= 0 ? "+" : ""}${(row.h2hLast48.wr - row.h2hLast24.wr).toFixed(1)}pp`,
      `<b>Janela:</b> ultimos ${rule.window_days} dias`,
    ].join("\n"),
  };
}

function buildFutureResolvedSignal(
  rule: AlertRuleEntity,
  dispatch: AlertDispatchEntity,
  storedSignal: NonNullable<StoredDispatchPayload["signal"]>,
  payload: StoredDispatchPayload | null,
  completedFixture: CompletedFutureFixture,
): EvaluatedSignal {
  const inferredPlayers = inferPlayersFromConfrontationLabel(dispatch.confrontation_label);
  const playerName = storedSignal.playerName ?? inferredPlayers.playerName ?? completedFixture.homePlayer;
  const resolvedStats = calculateResolvedApx(storedSignal, getCompletedFixtureResultForPlayer(completedFixture, playerName));
  const opponentName = storedSignal.opponentName ?? inferredPlayers.opponentName ?? completedFixture.awayPlayer;
  const recipients = Array.isArray(payload?.recipients) && payload.recipients.length
    ? payload.recipients.map((item) => item.trim()).filter(Boolean)
    : parseRecipients(dispatch.recipients_snapshot);
  const result = getCompletedFixtureResultForPlayer(completedFixture, playerName);
  const scheduledLabel = storedSignal.localPlayedAtLabel ?? dispatch.occurrence_played_at.toLocaleString("pt-BR");
  const telegramReplyTargets = extractTelegramReplyTargets(dispatch);

  if (storedSignal.sourceView === "future-player-sessions") {
    return {
      signalKey: buildResolvedFutureSignalKey(dispatch.signal_key),
      rootSignalKey: dispatch.signal_key,
      confrontationKey: dispatch.confrontation_key,
      confrontationLabel: dispatch.confrontation_label,
      dayKey: completedFixture.playedAtIso.slice(0, 10),
      occurrenceMatchId: dispatch.occurrence_match_id,
      occurrencePlayedAt: completedFixture.playedAtIso,
      localPlayedAtLabel: completedFixture.localPlayedAtLabel,
      result,
      fullTimeScore: completedFixture.fullTimeScore,
      apx: resolvedStats.currentApx,
      initialApx: resolvedStats.initialApx,
      currentApx: resolvedStats.currentApx,
      apxDelta: resolvedStats.apxDelta,
      totalOccurrences: resolvedStats.currentTotalOccurrences,
      initialTotalOccurrences: resolvedStats.initialTotalOccurrences,
      currentTotalOccurrences: resolvedStats.currentTotalOccurrences,
      wins: resolvedStats.wins,
      draws: resolvedStats.draws,
      losses: resolvedStats.losses,
      telegramReplyTargets,
      recipients,
      methodCode: storedSignal.methodCode ?? String(rule.method_code),
      fixtureLabel: storedSignal.fixtureLabel ?? completedFixture.fixtureLabel,
      groupLabel: storedSignal.groupLabel ?? null,
      playerName,
      opponentName,
      occurrenceResults: storedSignal.occurrenceResults,
      triggerSequence: storedSignal.triggerSequence,
      daySequence: storedSignal.daySequence,
      sourceView: "future-player-sessions",
      message: [
        `<b>Resultado confirmado</b>`,
        `<b>${escapeHtml(String(rule.league_type))}${rule.series ? ` Serie ${rule.series}` : ""} | ${escapeHtml(String(rule.method_code))}</b>`,
        `<b>Jogador:</b> ${escapeHtml(playerName)}`,
        `<b>Oponente:</b> ${escapeHtml(opponentName)}`,
        `<b>APX:</b> ${formatPercentage(resolvedStats.initialApx)} → ${formatPercentage(resolvedStats.currentApx)} | <b>Delta:</b> ${formatSignedPercentage(resolvedStats.apxDelta)}`,
        `<b>Ocorrencias:</b> ${resolvedStats.initialTotalOccurrences} → ${resolvedStats.currentTotalOccurrences}`,
        `<b>Resultados ocorrencias:</b> ${formatSequenceForAlert(rule, storedSignal.occurrenceResults ?? [])}`,
        `<b>Jogo realizado:</b> ${completedFixture.localPlayedAtLabel} | <b>Resultado:</b> ${result} | <b>Placar:</b> ${completedFixture.fullTimeScore}`,
        `<b>Gatilho jogador:</b> ${formatSequenceForAlert(rule, storedSignal.triggerSequence ?? [])}`,
        `<b>Historico sequencia dia/sessao:</b> ${formatSequenceForAlert(rule, storedSignal.daySequence ?? [])}`,
        `<b>Alerta futuro original:</b> ${scheduledLabel}`,
        `<b>Janela:</b> ultimos ${rule.window_days} dias`,
      ].join("\n"),
    };
  }

  return {
    signalKey: buildResolvedFutureSignalKey(dispatch.signal_key),
    rootSignalKey: dispatch.signal_key,
    confrontationKey: dispatch.confrontation_key,
    confrontationLabel: dispatch.confrontation_label,
    dayKey: completedFixture.playedAtIso.slice(0, 10),
    occurrenceMatchId: dispatch.occurrence_match_id,
    occurrencePlayedAt: completedFixture.playedAtIso,
    localPlayedAtLabel: completedFixture.localPlayedAtLabel,
    result,
    fullTimeScore: completedFixture.fullTimeScore,
    apx: resolvedStats.currentApx,
    initialApx: resolvedStats.initialApx,
    currentApx: resolvedStats.currentApx,
    apxDelta: resolvedStats.apxDelta,
    totalOccurrences: resolvedStats.currentTotalOccurrences,
    initialTotalOccurrences: resolvedStats.initialTotalOccurrences,
    currentTotalOccurrences: resolvedStats.currentTotalOccurrences,
    wins: resolvedStats.wins,
    draws: resolvedStats.draws,
    losses: resolvedStats.losses,
    telegramReplyTargets,
    recipients,
    methodCode: storedSignal.methodCode ?? String(rule.method_code),
    fixtureLabel: storedSignal.fixtureLabel ?? completedFixture.fixtureLabel,
    groupLabel: storedSignal.groupLabel ?? null,
    playerName,
    opponentName,
    occurrenceResults: storedSignal.occurrenceResults,
    triggerSequence: storedSignal.triggerSequence,
    daySequence: storedSignal.daySequence,
    confrontationSequence: storedSignal.confrontationSequence,
    sourceView: "future-confrontations",
    message: [
      `<b>Resultado confirmado</b>`,
      `<b>${escapeHtml(String(rule.league_type))}${rule.series ? ` Serie ${rule.series}` : ""} | ${escapeHtml(String(rule.method_code))}</b>`,
      `<b>Confronto:</b> ${escapeHtml(dispatch.confrontation_label)}`,
      `<b>APX:</b> ${formatPercentage(resolvedStats.initialApx)} → ${formatPercentage(resolvedStats.currentApx)} | <b>Delta:</b> ${formatSignedPercentage(resolvedStats.apxDelta)}`,
      `<b>Ocorrencias:</b> ${resolvedStats.initialTotalOccurrences} → ${resolvedStats.currentTotalOccurrences}`,
      `<b>Resultados ocorrencias:</b> ${formatSequenceForAlert(rule, storedSignal.occurrenceResults ?? [])}`,
      `<b>Jogo realizado:</b> ${completedFixture.localPlayedAtLabel} | <b>Resultado:</b> ${result} | <b>Placar:</b> ${completedFixture.fullTimeScore}`,
      `<b>Gatilho metodo:</b> ${formatSequenceForAlert(rule, storedSignal.triggerSequence ?? [])}`,
      `<b>Hist. Seq. Dia Jogador:</b> ${formatSequenceForAlert(rule, storedSignal.daySequence ?? [])}`,
      `<b>Hist. Seq. Dia Confronto:</b> ${formatSequenceForAlert(rule, storedSignal.confrontationSequence ?? [])}`,
      `<b>Alerta futuro original:</b> ${scheduledLabel}`,
      `<b>Janela:</b> ultimos ${rule.window_days} dias`,
    ].join("\n"),
  };
}

function formatSequenceForAlert(rule: AlertRuleEntity, sequence: string[]) {
  if (!sequence.length) {
    return "-";
  }

  const useEmpateNotation = String(rule.method_code).includes("E");

  return sequence
    .map((result) => {
      if (useEmpateNotation && result === "D") {
        return "E";
      }

      return result;
    })
    .join(" ");
}

function formatTriggerSequenceForAlert(rule: AlertRuleEntity, occurrence: ConfrontationOccurrence) {
  return formatSequenceForAlert(rule, occurrence.triggerSequence);
}

function formatOccurrenceDaySequenceForAlert(rule: AlertRuleEntity, occurrence: ConfrontationOccurrence) {
  return formatSequenceForAlert(rule, occurrence.daySequence);
}

function signalToEvaluatedSignal(signal: SignalPreviewItem): EvaluatedSignal {
  return {
    signalKey: signal.signalKey,
    rootSignalKey: signal.rootSignalKey,
    confrontationKey: signal.confrontationKey,
    confrontationLabel: signal.confrontationLabel,
    dayKey: signal.dayKey,
    occurrenceMatchId: signal.occurrenceMatchId,
    occurrencePlayedAt: signal.occurrencePlayedAt,
    localPlayedAtLabel: signal.localPlayedAtLabel,
    result: signal.result,
    fullTimeScore: signal.fullTimeScore,
    apx: signal.apx,
    initialApx: signal.initialApx,
    currentApx: signal.currentApx,
    apxDelta: signal.apxDelta,
    totalOccurrences: signal.totalOccurrences,
    initialTotalOccurrences: signal.initialTotalOccurrences,
    currentTotalOccurrences: signal.currentTotalOccurrences,
    wins: signal.wins,
    draws: signal.draws,
    losses: signal.losses,
    telegramReplyTargets: signal.telegramReplyTargets,
    recipients: signal.recipients,
    message: signal.message,
    methodCode: signal.methodCode,
    fixtureLabel: signal.fixtureLabel,
    groupLabel: signal.groupLabel,
    playerName: signal.playerName,
    opponentName: signal.opponentName,
    occurrenceResults: signal.occurrenceResults,
    triggerSequence: signal.triggerSequence,
    daySequence: signal.daySequence,
    confrontationSequence: signal.confrontationSequence,
    sourceView: signal.sourceView,
  };
}

function parseStoredDispatchPayload(payloadText: string): StoredDispatchPayload | null {
  try {
    const parsed = JSON.parse(payloadText) as StoredDispatchPayload;
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

function extractPendingFutureSignal(payload: StoredDispatchPayload | null) {
  const signal = payload?.signal;
  if (!signal || (signal.sourceView !== "future-confrontations" && signal.sourceView !== "future-player-sessions")) {
    return null;
  }

  if (!signal.occurrenceMatchId) {
    return null;
  }

  if (signal.result && signal.result !== "-") {
    return null;
  }

  if (signal.fullTimeScore && signal.fullTimeScore !== "-") {
    return null;
  }

  return signal;
}

function buildResolvedFutureSignalKey(signalKey: string) {
  return `${signalKey}::resolved`;
}

/**
 * Normalise a confrontation_key into a direction-agnostic pair key so that
 * "EROS||CRYSIS" and "CRYSIS||EROS" are treated as the same confrontation.
 * Handles the three key formats:
 *   - Confrontation methods: "PLAYER_A||PLAYER_B"
 *   - Player session:        "PLAYER::NAME"
 *   - Fav vs Fraco:          "FAV::NAME_A::NAME_B"
 */
function normalizePairKey(confrontationKey: string): string {
  if (confrontationKey.startsWith("FAV::")) {
    const parts = confrontationKey.slice(5).split("::");
    return parts.length >= 2
      ? [...parts].sort((a, b) => a.localeCompare(b, "pt-BR", { sensitivity: "base" })).join("||")
      : confrontationKey;
  }
  if (confrontationKey.startsWith("PLAYER::")) {
    return confrontationKey;               // single-player key, already unique
  }
  const parts = confrontationKey.split("||");
  if (parts.length === 2) {
    return [...parts].sort((a, b) => a.localeCompare(b, "pt-BR", { sensitivity: "base" })).join("||");
  }
  return confrontationKey;
}

function inferPlayersFromConfrontationLabel(confrontationLabel: string) {
  const [playerName, opponentName] = confrontationLabel.split(/\sx\s/i).map((item) => item.trim());

  return {
    playerName: playerName || null,
    opponentName: opponentName || null,
  };
}

function deriveManualOutcomeCounts(initialApx: number, totalOccurrences: number) {
  const safeTotal = Math.max(1, totalOccurrences);
  const boundedApx = Math.min(100, Math.max(0, initialApx));
  const wins = Math.min(safeTotal, Math.max(0, Math.round((boundedApx / 100) * safeTotal)));

  return {
    wins,
    draws: 0,
    losses: Math.max(0, safeTotal - wins),
  };
}

function parseManualScore(score: string | undefined) {
  if (!score) {
    return null;
  }

  const match = score.trim().match(/^(\d+)\s*[-:xX]\s*(\d+)$/);
  if (!match) {
    return null;
  }

  return {
    homeScore: Number(match[1]),
    awayScore: Number(match[2]),
  };
}

function normalizeManualScoreForResult(result: "W" | "D" | "L", score: { homeScore: number; awayScore: number } | null) {
  if (score) {
    if (result === "W" && score.homeScore > score.awayScore) {
      return score;
    }

    if (result === "D" && score.homeScore === score.awayScore) {
      return score;
    }

    if (result === "L" && score.homeScore < score.awayScore) {
      return score;
    }
  }

  if (result === "W") {
    return { homeScore: 2, awayScore: 1 };
  }

  if (result === "L") {
    return { homeScore: 1, awayScore: 2 };
  }

  return { homeScore: 1, awayScore: 1 };
}

function buildManualCompletedFixture(
  dispatch: AlertDispatchEntity,
  storedSignal: NonNullable<StoredDispatchPayload["signal"]>,
  input: { result: "W" | "D" | "L"; fullTimeScore?: string; resolvedAt: Date },
): CompletedFutureFixture {
  const inferredPlayers = inferPlayersFromConfrontationLabel(dispatch.confrontation_label);
  const homePlayer = storedSignal.playerName ?? inferredPlayers.playerName ?? "Teste Futuro";
  const awayPlayer = storedSignal.opponentName ?? inferredPlayers.opponentName ?? "Alertas";
  const normalizedScore = normalizeManualScoreForResult(input.result, parseManualScore(input.fullTimeScore));

  return {
    fixtureId: `${dispatch.signal_key}::manual-result`,
    playedAtIso: input.resolvedAt.toISOString(),
    localPlayedAtLabel: input.resolvedAt.toLocaleString("pt-BR"),
    fixtureLabel: storedSignal.fixtureLabel ?? dispatch.confrontation_label,
    homePlayer,
    awayPlayer,
    homeScore: normalizedScore.homeScore,
    awayScore: normalizedScore.awayScore,
    fullTimeScore: `${normalizedScore.homeScore}-${normalizedScore.awayScore}`,
  };
}

function getCompletedFixtureResultForPlayer(fixture: CompletedFutureFixture, playerName: string) {
  if (fixture.homeScore === fixture.awayScore) {
    return "D";
  }

  const normalizedPlayer = normalizeNameKey(playerName);
  const isHome = normalizedPlayer === normalizeNameKey(fixture.homePlayer);
  const isAway = normalizedPlayer === normalizeNameKey(fixture.awayPlayer);

  if (isHome) {
    return fixture.homeScore > fixture.awayScore ? "W" : "L";
  }

  if (isAway) {
    return fixture.awayScore > fixture.homeScore ? "W" : "L";
  }

  return fixture.homeScore > fixture.awayScore ? "W" : "L";
}

function mapRuleCreateInput(input: AlertRuleInput): Prisma.alert_method_rulesCreateInput {
  return {
    name: input.name,
    is_active: input.isActive ?? true,
    transport_channel: input.transportType ?? "webhook",
    league_type: input.leagueType,
    method_code: input.methodCode,
    series: input.series,
    player_name: normalizeOptionalString(input.playerName),
    apx_min: new Prisma.Decimal(input.apxMin ?? 0),
    min_occurrences: input.minOccurrences ?? 1,
    window_days: input.windowDays ?? 30,
    recipients: serializeRecipients(input.recipients),
    webhook_url: normalizeOptionalString(input.webhookUrl),
    note: normalizeOptionalString(input.note),
  } as Prisma.alert_method_rulesCreateInput;
}

function mapRuleUpdateInput(input: AlertRuleUpdateInput): Prisma.alert_method_rulesUpdateInput {
  return {
    ...(input.name !== undefined ? { name: input.name } : {}),
    ...(input.isActive !== undefined ? { is_active: input.isActive } : {}),
    ...(input.transportType !== undefined ? { transport_channel: input.transportType } : {}),
    ...(input.leagueType !== undefined ? { league_type: input.leagueType } : {}),
    ...(input.methodCode !== undefined ? { method_code: input.methodCode } : {}),
    ...(input.series !== undefined ? { series: input.series ?? null } : {}),
    ...(input.playerName !== undefined ? { player_name: normalizeOptionalString(input.playerName) } : {}),
    ...(input.apxMin !== undefined ? { apx_min: new Prisma.Decimal(input.apxMin) } : {}),
    ...(input.minOccurrences !== undefined ? { min_occurrences: input.minOccurrences } : {}),
    ...(input.windowDays !== undefined ? { window_days: input.windowDays } : {}),
    ...(input.recipients !== undefined ? { recipients: serializeRecipients(input.recipients) } : {}),
    ...(input.webhookUrl !== undefined ? { webhook_url: normalizeOptionalString(input.webhookUrl) } : {}),
    ...(input.note !== undefined ? { note: normalizeOptionalString(input.note) } : {}),
  } as Prisma.alert_method_rulesUpdateInput;
}

function serializeRule(rule: AlertRuleEntity) {
  return {
    id: rule.id.toString(),
    name: rule.name,
    isActive: rule.is_active,
    transportType: getRuleTransportType(rule),
    leagueType: rule.league_type,
    methodCode: rule.method_code,
    series: rule.series,
    playerName: (rule as AlertRuleEntity & { player_name?: string | null }).player_name ?? null,
    apxMin: toNumber(rule.apx_min),
    minOccurrences: rule.min_occurrences,
    windowDays: rule.window_days,
    recipients: parseRecipients(rule.recipients),
    webhookUrl: rule.webhook_url,
    note: rule.note,
    createdAt: rule.created_at.toISOString(),
    updatedAt: rule.updated_at.toISOString(),
    lastEvaluatedAt: rule.last_evaluated_at?.toISOString() ?? null,
  };
}

function serializeDispatch(
  dispatch: AlertDispatchEntity & { rule?: { name: string; method_code: string; league_type: string } | null },
) {
  const payload = parseStoredDispatchPayload(dispatch.payload_text);

  return {
    id: dispatch.id.toString(),
    ruleId: dispatch.rule_id.toString(),
    ruleName: dispatch.rule?.name ?? null,
    leagueType: dispatch.rule?.league_type ?? null,
    methodCode: dispatch.rule?.method_code ?? null,
    signalKey: dispatch.signal_key,
    confrontationKey: dispatch.confrontation_key,
    confrontationLabel: dispatch.confrontation_label,
    dayKey: dispatch.day_key,
    occurrenceMatchId: dispatch.occurrence_match_id,
    occurrencePlayedAt: dispatch.occurrence_played_at.toISOString(),
    apx: toNumber(dispatch.apx),
    totalOccurrences: dispatch.total_occurrences,
    recipients: parseRecipients(dispatch.recipients_snapshot),
    eventType: payload?.eventType ?? inferDispatchEventTypeFromSignalKey(dispatch.signal_key),
    payloadText: dispatch.payload_text,
    transportStatus: dispatch.transport_status,
    transportResponse: dispatch.transport_response,
    sentAt: dispatch.sent_at?.toISOString() ?? null,
    createdAt: dispatch.created_at.toISOString(),
    updatedAt: dispatch.updated_at.toISOString(),
  };
}

function getDispatchEventTypeFromSignal(signal: Pick<EvaluatedSignal, "signalKey">): DispatchEventType {
  return inferDispatchEventTypeFromSignalKey(signal.signalKey);
}

function inferDispatchEventTypeFromSignalKey(signalKey: string): DispatchEventType {
  return signalKey.endsWith("::resolved") ? "result_followup" : "initial_signal";
}

function parseRecipients(value: string) {
  return value
    .split(/[;,\n]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function serializeRecipients(recipients: string[]) {
  return recipients.map((item) => item.trim()).filter(Boolean).join(", ");
}

function normalizeOptionalString(value: string | null | undefined) {
  const normalized = value?.trim();
  return normalized ? normalized : null;
}

function normalizeConfrontationKey(label: string) {
  return label
    .split(" x ")
    .map((item) => item.trim().toLowerCase())
    .sort((left, right) => left.localeCompare(right, "pt-BR", { sensitivity: "base" }))
    .join("||");
}

function normalizeNameKey(value: string) {
  return value.trim().toLowerCase();
}

function formatPercentage(value: number) {
  return `${value.toFixed(2)}%`;
}

function formatSignedPercentage(value: number) {
  const formatted = `${Math.abs(value).toFixed(2)}%`;
  if (value > 0) {
    return `+${formatted}`;
  }

  if (value < 0) {
    return `-${formatted}`;
  }

  return formatted;
}

function toNumber(value: Prisma.Decimal | number | string) {
  return typeof value === "number" ? value : Number(value);
}

function buildMemoryDispatchRule(ruleId: bigint) {
  const rule = getMemoryRule(ruleId);
  if (!rule) {
    return null;
  }

  return {
    name: rule.name,
    method_code: rule.method_code,
    league_type: rule.league_type,
  };
}

function isAlertsTablesUnavailableError(error: unknown) {
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    if (error.code === "P2021" && ["alert_method_rules", "alert_method_dispatches"].includes(String(error.meta?.table ?? ""))) {
      return true;
    }

    if (error.code === "P2022") {
      const column = String(error.meta?.column ?? "").toLowerCase();
      if (column.includes("player_name") || column.includes("alert_method_rules") || column.includes("alert_method_dispatches")) {
        return true;
      }
    }

    if (error.code === "P6001") {
      return true;
    }
  }

  if (error instanceof Prisma.PrismaClientInitializationError) {
    const message = error.message.toLowerCase();
    const touchesAlertsTables = message.includes("alert_method_rules") || message.includes("alert_method_dispatches");
    const isConnectivityIssue =
      message.includes("can't reach database server") ||
      message.includes("connect timeout") ||
      message.includes("timed out") ||
      message.includes("connection reset") ||
      message.includes("connection closed") ||
      message.includes("connection refused");

    return touchesAlertsTables && isConnectivityIssue;
  }

  if (error instanceof Prisma.PrismaClientUnknownRequestError || error instanceof Error) {
    const message = error.message.toLowerCase();
    const touchesAlertsTables = message.includes("alert_method_rules") || message.includes("alert_method_dispatches");
    const isPermissionOrMissingTableIssue =
      message.includes("the url must start with the protocol") ||
      message.includes("command denied") ||
      message.includes("unknown column") ||
      message.includes("column does not exist") ||
      message.includes("doesn't exist") ||
      message.includes("does not exist") ||
      message.includes("no such table");

    const isConnectivityIssue =
      message.includes("can't reach database server") ||
      message.includes("connect timeout") ||
      message.includes("timed out") ||
      message.includes("connection reset") ||
      message.includes("connection closed") ||
      message.includes("connection refused");

    return touchesAlertsTables && (isPermissionOrMissingTableIssue || isConnectivityIssue);
  }

  return false;
}

async function withAlertsPersistence<T>(prismaOperation: () => Promise<T>, fallbackOperation: () => T | Promise<T>) {
  try {
    const result = await prismaOperation();
    alertsPersistenceMode = "database";
    return result;
  } catch (error) {
    if (isAlertsTablesUnavailableError(error)) {
      alertsPersistenceMode = "memory";
      const fallback = await fallbackOperation();
      // Garante array vazio se fallback for undefined/null
      if (fallback === undefined || fallback === null) return [] as any;
      return fallback;
    }
    throw error;
  }
}

function toRuleInput(rule: ReturnType<typeof serializeRule>): AlertRuleInput {
  return {
    name: rule.name,
    isActive: rule.isActive,
    transportType: rule.transportType,
    leagueType: rule.leagueType as AlertLeagueType,
    methodCode: rule.methodCode as AlertMethodCode,
    series: (rule.series as AlertSeriesCode | null) ?? undefined,
    playerName: rule.playerName,
    apxMin: rule.apxMin,
    minOccurrences: rule.minOccurrences,
    windowDays: rule.windowDays,
    recipients: rule.recipients,
    webhookUrl: rule.webhookUrl,
    note: rule.note,
  };
}

function buildRuleSignature(rule: AlertRuleInput) {
  return JSON.stringify({
    name: rule.name.trim().toLowerCase(),
    isActive: rule.isActive ?? true,
    transportType: rule.transportType ?? "webhook",
    leagueType: rule.leagueType,
    methodCode: rule.methodCode,
    series: rule.series ?? null,
    playerName: normalizeOptionalString(rule.playerName),
    apxMin: Number(rule.apxMin ?? 0),
    minOccurrences: rule.minOccurrences ?? 1,
    windowDays: rule.windowDays ?? 30,
    recipients: [...rule.recipients].map((item) => item.trim()).filter(Boolean).sort(),
    webhookUrl: normalizeOptionalString(rule.webhookUrl),
    note: normalizeOptionalString(rule.note),
  });
}

function matchesRulePlayerFilter(rule: AlertRuleEntity, playerName: string | null | undefined) {
  const configuredPlayer = normalizePlayerName((rule as AlertRuleEntity & { player_name?: string | null }).player_name ?? null);
  if (!configuredPlayer) {
    return true;
  }

  return configuredPlayer === normalizePlayerName(playerName);
}

function normalizePlayerName(value: string | null | undefined) {
  return value?.trim().replace(/\s+/gu, " ").toUpperCase() ?? "";
}

function getRuleTransportType(rule: AlertRuleEntity): AlertTransportType {
  return ((rule as AlertRuleEntity & { transport_channel?: string }).transport_channel ?? "webhook") === "telegram"
    ? "telegram"
    : "webhook";
}

async function persistDispatchResult(dispatchId: bigint, status: string, responseText: string | null, sentAt?: Date) {
  await withAlertsPersistence(
    () =>
      prisma.alert_method_dispatches.update({
        where: { id: dispatchId },
        data: {
          transport_status: status,
          transport_response: responseText,
          ...(sentAt ? { sent_at: sentAt } : {}),
        },
      }),
    () =>
      updateMemoryDispatch(dispatchId, {
        transport_status: status,
        transport_response: responseText,
        ...(sentAt ? { sent_at: sentAt } : {}),
      }),
  );
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

async function sendTelegramMessage(
  chatIds: string[],
  message: string,
  options?: { editMessageIdByChatId?: Map<string, number> },
) {
  const botToken = env.TELEGRAM_BOT_TOKEN;
  if (!botToken) {
    throw new Error("TELEGRAM_BOT_TOKEN nao configurado");
  }

  const responses = [] as string[];
  for (const chatId of chatIds) {
    const messageIdToEdit = options?.editMessageIdByChatId?.get(chatId);
    if (typeof messageIdToEdit === "number") {
      const editResponse = await fetch(`https://api.telegram.org/bot${botToken}/editMessageText`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          chat_id: chatId,
          message_id: messageIdToEdit,
          text: message,
          parse_mode: "HTML",
          disable_web_page_preview: true,
        }),
      });

      const editResponseText = await editResponse.text();
      if (editResponse.ok) {
        responses.push(`chat ${chatId} [edited ${messageIdToEdit}]: ${editResponseText}`);
        continue;
      }
    }

    const sendResponse = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        chat_id: chatId,
        text: message,
        parse_mode: "HTML",
        disable_web_page_preview: true,
      }),
    });

    const sendResponseText = await sendResponse.text();
    if (!sendResponse.ok) {
      throw new Error(`Telegram respondeu ${sendResponse.status}: ${sendResponseText}`);
    }

    responses.push(`chat ${chatId}: ${sendResponseText}`);
  }

  return responses.join("\n");
}

async function findCompletedFutureFixtureById(fixtureId: string): Promise<CompletedFutureFixture | null> {
  const [prefix, rawId] = fixtureId.split("-");
  const numericId = Number(rawId);
  if (!prefix || !rawId || !Number.isFinite(numericId)) {
    return null;
  }

  if (prefix === "GT") {
    const match = await prisma.gt_gtapi_fixtures.findUnique({
      where: { id_fixture: numericId },
      select: {
        id_fixture: true,
        match_kickoff: true,
        home_player: true,
        away_player: true,
        home_team: true,
        away_team: true,
        home_score_ft: true,
        away_score_ft: true,
      },
    });
    if (!match || match.home_score_ft === null || match.away_score_ft === null) {
      return null;
    }

    return {
      fixtureId,
      playedAtIso: match.match_kickoff.toISOString(),
      localPlayedAtLabel: match.match_kickoff.toLocaleString("pt-BR"),
      fixtureLabel: `${normalizeFixturePlayerName(match.home_player || match.home_team)} x ${normalizeFixturePlayerName(match.away_player || match.away_team)}`,
      homePlayer: normalizeFixturePlayerName(match.home_player || match.home_team),
      awayPlayer: normalizeFixturePlayerName(match.away_player || match.away_team),
      homeScore: Number(match.home_score_ft),
      awayScore: Number(match.away_score_ft),
      fullTimeScore: `${Number(match.home_score_ft)}x${Number(match.away_score_ft)}`,
    };
  }

  if (prefix === "EBATTLE" || prefix === "VOLTA") {
    const match = await prisma.ebattle_ebattleapi_fixtures.findUnique({
      where: { id_fixture: numericId },
      select: {
        id_fixture: true,
        match_kickoff: true,
        home_player: true,
        away_player: true,
        home_team: true,
        away_team: true,
        home_score_ft: true,
        away_score_ft: true,
      },
    });
    if (!match || match.home_score_ft === null || match.away_score_ft === null) {
      return null;
    }

    return {
      fixtureId,
      playedAtIso: match.match_kickoff.toISOString(),
      localPlayedAtLabel: match.match_kickoff.toLocaleString("pt-BR"),
      fixtureLabel: `${normalizeFixturePlayerName(match.home_player || match.home_team)} x ${normalizeFixturePlayerName(match.away_player || match.away_team)}`,
      homePlayer: normalizeFixturePlayerName(match.home_player || match.home_team),
      awayPlayer: normalizeFixturePlayerName(match.away_player || match.away_team),
      homeScore: Number(match.home_score_ft),
      awayScore: Number(match.away_score_ft),
      fullTimeScore: `${Number(match.home_score_ft)}x${Number(match.away_score_ft)}`,
    };
  }

  return null;
}

function normalizeFixturePlayerName(value: string | null | undefined) {
  return (value ?? "").trim().replace(/\s+/g, " ") || "-";
}

function buildGoogleSheetsSignal(signal: EvaluatedSignal): GoogleSheetsDispatchLogPayload["signal"] {
  return {
    signalKey: signal.signalKey,
    rootSignalKey: signal.rootSignalKey,
    confrontationKey: signal.confrontationKey,
    confrontationLabel: signal.confrontationLabel,
    fixtureLabel: signal.fixtureLabel,
    groupLabel: signal.groupLabel,
    dayKey: signal.dayKey,
    occurrenceMatchId: signal.occurrenceMatchId,
    occurrencePlayedAt: signal.occurrencePlayedAt,
    localPlayedAtLabel: signal.localPlayedAtLabel,
    result: signal.result,
    fullTimeScore: signal.fullTimeScore,
    apx: signal.apx,
    initialApx: signal.initialApx,
    currentApx: signal.currentApx,
    apxDelta: signal.apxDelta,
    totalOccurrences: signal.totalOccurrences,
    initialTotalOccurrences: signal.initialTotalOccurrences,
    currentTotalOccurrences: signal.currentTotalOccurrences,
    wins: signal.wins,
    draws: signal.draws,
    losses: signal.losses,
    methodCode: signal.methodCode,
    playerName: signal.playerName,
    opponentName: signal.opponentName,
    occurrenceResults: signal.occurrenceResults,
    triggerSequence: signal.triggerSequence,
    daySequence: signal.daySequence,
    sourceView: signal.sourceView,
  };
}

function calculateResolvedApx(storedSignal: NonNullable<StoredDispatchPayload["signal"]>, result: string) {
  const initialApx = typeof storedSignal.initialApx === "number"
    ? storedSignal.initialApx
    : typeof storedSignal.apx === "number"
      ? storedSignal.apx
      : 0;
  const initialTotalOccurrences = typeof storedSignal.initialTotalOccurrences === "number"
    ? storedSignal.initialTotalOccurrences
    : typeof storedSignal.totalOccurrences === "number"
      ? storedSignal.totalOccurrences
      : 0;
  const wins = typeof storedSignal.wins === "number"
    ? storedSignal.wins
    : Math.round((initialApx / 100) * initialTotalOccurrences);
  const draws = typeof storedSignal.draws === "number" ? storedSignal.draws : 0;
  const losses = typeof storedSignal.losses === "number" ? storedSignal.losses : Math.max(0, initialTotalOccurrences - wins - draws);
  const currentTotalOccurrences = initialTotalOccurrences + 1;
  const currentWins = wins + (result === "W" ? 1 : 0);
  const currentDraws = draws + (result === "D" ? 1 : 0);
  const currentLosses = losses + (result === "L" ? 1 : 0);
  const currentApx = currentTotalOccurrences ? Number(((currentWins / currentTotalOccurrences) * 100).toFixed(2)) : 0;

  return {
    initialApx,
    currentApx,
    apxDelta: Number((currentApx - initialApx).toFixed(2)),
    initialTotalOccurrences,
    currentTotalOccurrences,
    wins: currentWins,
    draws: currentDraws,
    losses: currentLosses,
  };
}

function extractTelegramReplyTargets(dispatch: AlertDispatchEntity | null) {
  const targets = [] as Array<{ chatId: string; messageId: number }>;
  const responseText = dispatch?.transport_response ?? "";
  if (!responseText) {
    return targets;
  }

  for (const line of responseText.split(/\r?\n/)) {
    const match = /^chat\s+(.+?):\s+(\{.*\})$/u.exec(line.trim());
    if (!match) {
      continue;
    }

    try {
      const payload = JSON.parse(match[2]) as { result?: { message_id?: number } };
      const messageId = payload.result?.message_id;
      if (typeof messageId === "number") {
        targets.push({ chatId: match[1], messageId });
      }
    } catch {
      continue;
    }
  }

  return targets;
}

function appendGoogleSheetsInfoToTransportResponse(baseResponse: string | null, attempt: GoogleSheetsDispatchAttempt) {
  const base = baseResponse?.trim();
  return [base, `[google-sheets] ${attempt.info}`].filter(Boolean).join("\n");
}

async function logGoogleSheetsDispatchBestEffort(payload: GoogleSheetsDispatchLogPayload): Promise<GoogleSheetsDispatchAttempt> {
  const webhookUrl = env.ALERTS_GOOGLE_SHEETS_WEBHOOK_URL;
  if (!webhookUrl) {
    return {
      enabled: false,
      ok: false,
      info: "desabilitado: ALERTS_GOOGLE_SHEETS_WEBHOOK_URL nao configurada",
    };
  }

  try {
    const response = await postGoogleSheetsDispatch(webhookUrl, payload);

    if (!response.ok) {
      console.error(`Falha ao registrar dispatch no Google Sheets: ${response.status} ${response.responseText}`);
      return {
        enabled: true,
        ok: false,
        info: `falhou: HTTP ${response.status} ${truncateGoogleSheetsResponse(response.responseText)}`,
        status: response.status,
        responseText: response.responseText,
      };
    }

    return {
      enabled: true,
      ok: true,
      info: `ok: HTTP ${response.status} ${truncateGoogleSheetsResponse(response.responseText)}`,
      status: response.status,
      responseText: response.responseText,
    };
  } catch (error) {
    console.error("Falha ao registrar dispatch no Google Sheets", error);
    return {
      enabled: true,
      ok: false,
      info: `erro: ${error instanceof Error ? error.message : "falha inesperada"}`,
    };
  }
}

function truncateGoogleSheetsResponse(responseText: string) {
  const normalized = responseText.replace(/\s+/gu, " ").trim();
  if (!normalized) {
    return "sem resposta";
  }

  return normalized.length > 240 ? `${normalized.slice(0, 237)}...` : normalized;
}

async function postGoogleSheetsDispatch(webhookUrl: string, payload: GoogleSheetsDispatchLogPayload) {
  const response = await fetch(webhookUrl, {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify(payload),
  });
  const responseText = await response.text();

  return {
    ok: response.ok,
    status: response.status,
    redirected: response.redirected,
    url: response.url,
    responseText,
  };
}