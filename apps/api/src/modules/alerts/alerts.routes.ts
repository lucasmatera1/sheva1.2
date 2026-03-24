import { Prisma } from "@prisma/client";
import { Router, type Response } from "express";
import { z } from "zod";
import { AlertsService, type AlertRulesBackup } from "./alerts.service";
import { clearDebugWebhookEvents, listDebugWebhookEvents, recordDebugWebhookEvent } from "./alerts.webhook-debug";

const ALERT_LEAGUES = ["GT LEAGUE", "8MIN BATTLE", "6MIN VOLTA"] as const;
const ALERT_METHODS = ["T+", "E", "(2E)", "(2D)", "(2D+)", "(3D)", "(3D+)", "(4D)", "(4D+)", "4D Jogador", "4W Jogador", "Fav T1", "Fav T2", "Fav T3"] as const;
const ALERT_SERIES = ["A", "B", "C", "D", "E", "F", "G"] as const;
const ALERT_DAYS = [7, 15, 21, 30, 45, 60] as const;
const ALERT_TRANSPORTS = ["webhook", "telegram"] as const;

const router = Router();
const service = new AlertsService();

const createRuleSchema = z.object({
  name: z.string().trim().min(1).max(150),
  isActive: z.boolean().optional(),
  transportType: z.enum(ALERT_TRANSPORTS).optional(),
  leagueType: z.enum(ALERT_LEAGUES),
  methodCode: z.enum(ALERT_METHODS),
  series: z.enum(ALERT_SERIES).optional(),
  playerName: z.string().trim().min(1).max(120).optional().nullable(),
  apxMin: z.number().min(0).max(100).optional(),
  minOccurrences: z.number().int().min(1).optional(),
  windowDays: z
    .number()
    .int()
    .refine((value) => ALERT_DAYS.includes(value as (typeof ALERT_DAYS)[number]), { message: "windowDays invalido" })
    .optional(),
  recipients: z.array(z.string().trim().min(1)).min(1),
  webhookUrl: z.string().url().optional().nullable(),
  note: z.string().trim().max(255).optional().nullable(),
});

const updateRuleSchema = z.object({
  name: z.string().trim().min(1).max(150).optional(),
  isActive: z.boolean().optional(),
  transportType: z.enum(ALERT_TRANSPORTS).optional(),
  leagueType: z.enum(ALERT_LEAGUES).optional(),
  methodCode: z.enum(ALERT_METHODS).optional(),
  series: z.enum(ALERT_SERIES).optional().nullable(),
  playerName: z.string().trim().min(1).max(120).optional().nullable(),
  apxMin: z.number().min(0).max(100).optional(),
  minOccurrences: z.number().int().min(1).optional(),
  windowDays: z
    .number()
    .int()
    .refine((value) => ALERT_DAYS.includes(value as (typeof ALERT_DAYS)[number]), { message: "windowDays invalido" })
    .optional(),
  recipients: z.array(z.string().trim().min(1)).min(1).optional(),
  webhookUrl: z.string().url().optional().nullable(),
  note: z.string().trim().max(255).optional().nullable(),
});

const runRulesSchema = z.object({
  ruleId: z.coerce.bigint().optional(),
  dryRun: z.boolean().optional(),
  onlyActive: z.boolean().optional(),
});

const currentSignalsDispatchSchema = z.object({
  maxSignals: z.number().int().min(1).optional(),
});

const testDispatchSchema = z.object({
  signalKey: z.string().trim().min(1).max(255).optional(),
  confrontationLabel: z.string().trim().min(1).max(255).optional(),
  message: z.string().trim().min(1).max(4000).optional(),
});

const testFutureDispatchSchema = z.object({
  rootSignalKey: z.string().trim().min(1).max(255).optional(),
  confrontationLabel: z.string().trim().min(1).max(255).optional(),
  fixtureLabel: z.string().trim().min(1).max(255).optional(),
  scheduledAt: z.string().datetime().optional(),
  apx: z.number().min(0).max(100).optional(),
  totalOccurrences: z.number().int().min(1).optional(),
  occurrenceResults: z.array(z.enum(["W", "D", "L"])).optional(),
  triggerSequence: z.array(z.enum(["W", "D", "L"])).optional(),
  daySequence: z.array(z.enum(["W", "D", "L"])).optional(),
  message: z.string().trim().min(1).max(4000).optional(),
});

const testFutureResolveSchema = z.object({
  rootSignalKey: z.string().trim().min(1).max(255),
  result: z.enum(["W", "D", "L"]).optional(),
  fullTimeScore: z.string().trim().min(1).max(20).optional(),
  resolvedAt: z.string().datetime().optional(),
});

const resolveFutureResultsSchema = z.object({
  ruleId: z.coerce.bigint().optional(),
});

const backupRuleSchema = z.object({
  id: z.string(),
  name: z.string().trim().min(1).max(150),
  isActive: z.boolean(),
  transportType: z.enum(ALERT_TRANSPORTS),
  leagueType: z.enum(ALERT_LEAGUES),
  methodCode: z.enum(ALERT_METHODS),
  series: z.enum(ALERT_SERIES).nullable(),
  playerName: z.string().trim().min(1).max(120).nullable().default(null),
  apxMin: z.number().min(0).max(100),
  minOccurrences: z.number().int().min(1),
  windowDays: z
    .number()
    .int()
    .refine((value) => ALERT_DAYS.includes(value as (typeof ALERT_DAYS)[number]), { message: "windowDays invalido" }),
  recipients: z.array(z.string().trim().min(1)).min(1),
  webhookUrl: z.string().url().nullable(),
  note: z.string().trim().max(255).nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
  lastEvaluatedAt: z.string().nullable(),
});

const backupDispatchSchema = z.object({
  id: z.string(),
  ruleId: z.string(),
  ruleName: z.string().nullable(),
  leagueType: z.string().nullable(),
  methodCode: z.string().nullable(),
  eventType: z.enum(["initial_signal", "result_followup"]).optional().default("initial_signal"),
  signalKey: z.string(),
  confrontationKey: z.string(),
  confrontationLabel: z.string(),
  dayKey: z.string(),
  occurrenceMatchId: z.string(),
  occurrencePlayedAt: z.string(),
  apx: z.number(),
  totalOccurrences: z.number().int().min(1),
  recipients: z.array(z.string().trim().min(1)),
  payloadText: z.string(),
  transportStatus: z.string(),
  transportResponse: z.string().nullable(),
  sentAt: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

const backupSchema = z.object({
  format: z.literal("sheva-method-alert-rules"),
  version: z.union([z.literal(1), z.literal(2)]).transform((value) => (value === 1 ? 2 : value)),
  exportedAt: z.string(),
  persistenceMode: z.enum(["database", "memory"]),
  rules: z.array(backupRuleSchema),
  dispatches: z.array(backupDispatchSchema).optional().default([]),
});

const importBackupSchema = z.object({
  replaceExisting: z.boolean().optional(),
  skipDuplicates: z.boolean().optional(),
  backup: backupSchema,
});

const telegramTestSchema = z.object({
  chatIds: z.array(z.string().trim().min(1)).min(1),
  message: z.string().trim().min(1).max(4000).optional(),
});

const googleSheetsTestSchema = z.object({
  confrontationLabel: z.string().trim().min(1).max(255).optional(),
  message: z.string().trim().min(1).max(4000).optional(),
  rootSignalKey: z.string().trim().min(1).max(255).optional(),
});

router.get("/rules", async (_request, response, next) => {
  try {
    response.json(await service.listRules());
  } catch (error) {
    if (handleAlertsError(error, response)) {
      return;
    }

    next(error);
  }
});

router.get("/status", (_request, response) => {
  response.json(service.getStatus());
});

router.post("/telegram/test", async (request, response, next) => {
  try {
    const parsed = telegramTestSchema.parse(request.body ?? {});
    response.json(await service.sendTelegramTestMessage(parsed));
  } catch (error) {
    if (error instanceof Error && error.message.includes("TELEGRAM_BOT_TOKEN")) {
      response.status(503).json({ message: error.message });
      return;
    }

    if (handleAlertsError(error, response)) {
      return;
    }

    next(error);
  }
});

router.post("/google-sheets/test", async (request, response, next) => {
  try {
    const parsed = googleSheetsTestSchema.parse(request.body ?? {});
    response.json(await service.sendGoogleSheetsTest(parsed));
  } catch (error) {
    if (error instanceof Error && error.message.includes("ALERTS_GOOGLE_SHEETS_WEBHOOK_URL")) {
      response.status(503).json({ message: error.message });
      return;
    }

    if (handleAlertsError(error, response)) {
      return;
    }

    next(error);
  }
});

router.get("/backup", async (_request, response, next) => {
  try {
    response.json(await service.exportRulesBackup());
  } catch (error) {
    if (handleAlertsError(error, response)) {
      return;
    }

    next(error);
  }
});

router.get("/backup/local-status", async (_request, response, next) => {
  try {
    response.json(await service.getLocalBackupStatus());
  } catch (error) {
    if (handleAlertsError(error, response)) {
      return;
    }

    next(error);
  }
});

router.get("/backup/local-history", async (request, response, next) => {
  try {
    const limit = typeof request.query.limit === "string" ? Number(request.query.limit) : 12;
    if (!Number.isFinite(limit) || limit < 1 || limit > 100) {
      response.status(400).json({ message: "limit invalido" });
      return;
    }

    response.json({
      items: await service.listLocalBackupHistory(limit),
    });
  } catch (error) {
    if (handleAlertsError(error, response)) {
      return;
    }

    next(error);
  }
});

router.post("/backup/save-local", async (_request, response, next) => {
  try {
    response.json(await service.saveRulesBackupToLocalFile());
  } catch (error) {
    if (handleAlertsError(error, response)) {
      return;
    }

    next(error);
  }
});

router.post("/rules", async (request, response, next) => {
  try {
    const parsed = createRuleSchema.parse(request.body);
    if (parsed.series && parsed.leagueType !== "GT LEAGUE") {
      response.status(400).json({ message: "series so pode ser usada com GT LEAGUE" });
      return;
    }

    response.status(201).json(await service.createRule(parsed));
  } catch (error) {
    if (handleAlertsError(error, response)) {
      return;
    }

    next(error);
  }
});

router.patch("/rules/:ruleId", async (request, response, next) => {
  try {
    const ruleId = parseRuleId(request.params.ruleId);
    if (!ruleId) {
      response.status(400).json({ message: "ruleId invalido" });
      return;
    }

    const parsed = updateRuleSchema.parse(request.body);
    const updatedRule = await service.updateRule(ruleId, parsed);
    if (!updatedRule) {
      response.status(404).json({ message: "Regra nao encontrada" });
      return;
    }

    response.json(updatedRule);
  } catch (error) {
    if (handleAlertsError(error, response)) {
      return;
    }

    next(error);
  }
});

router.get("/rules/:ruleId/current-signals", async (request, response, next) => {
  try {
    const ruleId = parseRuleId(request.params.ruleId);
    const limit = typeof request.query.limit === "string" ? Number(request.query.limit) : 20;
    if (!ruleId) {
      response.status(400).json({ message: "ruleId invalido" });
      return;
    }

    if (!Number.isFinite(limit) || limit < 1 || limit > 100) {
      response.status(400).json({ message: "limit invalido" });
      return;
    }

    const preview = await service.previewCurrentSignals(ruleId, { limit });
    if (!preview) {
      response.status(404).json({ message: "Regra nao encontrada" });
      return;
    }

    response.json(preview);
  } catch (error) {
    if (handleAlertsError(error, response)) {
      return;
    }

    next(error);
  }
});

router.post("/rules/:ruleId/dispatch-current-signals", async (request, response, next) => {
  try {
    const ruleId = parseRuleId(request.params.ruleId);
    if (!ruleId) {
      response.status(400).json({ message: "ruleId invalido" });
      return;
    }

    const parsed = currentSignalsDispatchSchema.parse(request.body ?? {});
    const result = await service.dispatchCurrentSignals(ruleId, { maxSignals: parsed.maxSignals });
    if (!result) {
      response.status(404).json({ message: "Regra nao encontrada" });
      return;
    }

    response.json(result);
  } catch (error) {
    if (handleAlertsError(error, response)) {
      return;
    }

    next(error);
  }
});

router.post("/rules/:ruleId/test-dispatch", async (request, response, next) => {
  try {
    const ruleId = parseRuleId(request.params.ruleId);
    if (!ruleId) {
      response.status(400).json({ message: "ruleId invalido" });
      return;
    }

    const parsed = testDispatchSchema.parse(request.body ?? {});
    const result = await service.sendTestDispatch(ruleId, parsed);
    if (!result) {
      response.status(404).json({ message: "Regra nao encontrada" });
      return;
    }

    response.json(result);
  } catch (error) {
    if (handleAlertsError(error, response)) {
      return;
    }

    next(error);
  }
});

router.post("/rules/:ruleId/test-future-dispatch", async (request, response, next) => {
  try {
    const ruleId = parseRuleId(request.params.ruleId);
    if (!ruleId) {
      response.status(400).json({ message: "ruleId invalido" });
      return;
    }

    const parsed = testFutureDispatchSchema.parse(request.body ?? {});
    const result = await service.sendTestFutureDispatch(ruleId, parsed);
    if (!result) {
      response.status(404).json({ message: "Regra nao encontrada" });
      return;
    }

    response.json(result);
  } catch (error) {
    if (handleAlertsError(error, response)) {
      return;
    }

    next(error);
  }
});

router.post("/rules/:ruleId/test-future-resolve", async (request, response, next) => {
  try {
    const ruleId = parseRuleId(request.params.ruleId);
    if (!ruleId) {
      response.status(400).json({ message: "ruleId invalido" });
      return;
    }

    const parsed = testFutureResolveSchema.parse(request.body ?? {});
    const result = await service.sendTestFutureResolution(ruleId, parsed);
    if (!result) {
      response.status(404).json({ message: "Regra nao encontrada" });
      return;
    }

    response.json(result);
  } catch (error) {
    if (error instanceof Error && error.message.includes("nao encontrado")) {
      response.status(404).json({ message: error.message });
      return;
    }

    if (handleAlertsError(error, response)) {
      return;
    }

    next(error);
  }
});

router.post("/resolve-future-results", async (request, response, next) => {
  try {
    const parsed = resolveFutureResultsSchema.parse(request.body ?? {});
    response.json(
      await service.resolveFutureResults({
        ruleId: parsed.ruleId,
        source: "manual",
      }),
    );
  } catch (error) {
    if (handleAlertsError(error, response)) {
      return;
    }

    next(error);
  }
});

router.delete("/rules/:ruleId", async (request, response, next) => {
  try {
    const ruleId = parseRuleId(request.params.ruleId);
    if (!ruleId) {
      response.status(400).json({ message: "ruleId invalido" });
      return;
    }

    const deletedRule = await service.deleteRule(ruleId);
    if (!deletedRule) {
      response.status(404).json({ message: "Regra nao encontrada" });
      return;
    }

    response.json({ message: `Regra removida: ${deletedRule.name}`, rule: deletedRule });
  } catch (error) {
    if (handleAlertsError(error, response)) {
      return;
    }

    next(error);
  }
});

router.get("/dispatches", async (request, response, next) => {
  try {
    const parsedRuleId = typeof request.query.ruleId === "string" ? parseRuleId(request.query.ruleId) : undefined;
    const limit = typeof request.query.limit === "string" ? Number(request.query.limit) : undefined;

    if (request.query.ruleId !== undefined && !parsedRuleId) {
      response.status(400).json({ message: "ruleId invalido" });
      return;
    }

    if (limit !== undefined && (!Number.isFinite(limit) || limit < 1 || limit > 200)) {
      response.status(400).json({ message: "limit invalido" });
      return;
    }

    response.json(await service.listDispatches({ ruleId: parsedRuleId ?? undefined, limit }));
  } catch (error) {
    if (handleAlertsError(error, response)) {
      return;
    }

    next(error);
  }
});

router.post("/run", async (request, response, next) => {
  try {
    const parsed = runRulesSchema.parse(request.body ?? {});
    response.json(
      await service.runRules({
        ruleId: parsed.ruleId,
        dryRun: parsed.dryRun,
        onlyActive: parsed.onlyActive,
        source: "manual",
      }),
    );
  } catch (error) {
    if (handleAlertsError(error, response)) {
      return;
    }

    next(error);
  }
});

router.post("/backup/import", async (request, response, next) => {
  try {
    const parsed = importBackupSchema.parse(request.body ?? {});
    response.json(
      await service.importRulesBackup(parsed.backup, {
        replaceExisting: parsed.replaceExisting,
        skipDuplicates: parsed.skipDuplicates,
      }),
    );
  } catch (error) {
    if (handleAlertsError(error, response)) {
      return;
    }

    next(error);
  }
});

router.post("/backup/restore-latest", async (request, response, next) => {
  try {
    const parsed = z
      .object({
        replaceExisting: z.boolean().optional(),
        skipDuplicates: z.boolean().optional(),
      })
      .parse(request.body ?? {});

    response.json(
      await service.restoreRulesFromLocalLatest({
        replaceExisting: parsed.replaceExisting,
        skipDuplicates: parsed.skipDuplicates,
      }),
    );
  } catch (error) {
    if (error instanceof Error && error.message.includes("ENOENT")) {
      response.status(404).json({ message: "Nenhum backup local latest.json foi encontrado no servidor." });
      return;
    }

    if (handleAlertsError(error, response)) {
      return;
    }

    next(error);
  }
});

router.post("/webhook-debug", (request, response) => {
  const event = recordDebugWebhookEvent({
    headers: request.headers,
    body: request.body,
  });

  response.status(201).json({
    message: "Payload recebido pelo coletor local",
    event,
  });
});

router.get("/webhook-debug/events", (_request, response) => {
  response.json({
    total: listDebugWebhookEvents().length,
    events: listDebugWebhookEvents(),
  });
});

router.delete("/webhook-debug/events", (_request, response) => {
  clearDebugWebhookEvents();
  response.json({ message: "Historico do coletor local limpo" });
});

const applyOddsSchema = z.object({
  homePlayer: z.string().trim().min(1),
  awayPlayer: z.string().trim().min(1),
  homeOdd: z.number().positive(),
  awayOdd: z.number().positive(),
  link: z.string().trim().optional(),
});

router.post("/dispatches/odds", async (request, response, next) => {
  try {
    const parsed = applyOddsSchema.parse(request.body);
    const result = await service.applyOddsToDispatch(parsed);
    response.json(result);
  } catch (error) {
    next(error);
  }
});

export { router as alertsRouter };

function parseRuleId(value: string) {
  try {
    return BigInt(value);
  } catch {
    return null;
  }
}

function handleAlertsError(error: unknown, response: Response) {
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    if (error.code === "P2021") {
      response.status(503).json({
        message: "As tabelas de alertas ainda nao existem no banco atual. Execute o SQL de migration com um usuario que tenha permissao de CREATE TABLE.",
      });
      return true;
    }
  }

  if (error instanceof Prisma.PrismaClientInitializationError) {
    response.status(503).json({
      message: "Os alertas nao conseguiram acessar o MySQL remoto neste momento. Tente novamente em instantes.",
    });
    return true;
  }

  if (error instanceof Error && error.message.includes("series so pode ser usada com GT LEAGUE")) {
    response.status(400).json({ message: error.message });
    return true;
  }

  return false;
}