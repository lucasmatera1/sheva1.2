import { Router, type Request } from "express";
import type {
  AnalyticsFilters,
  AnalyticsH2HRequest,
  AnalyticsLeagueType,
  AnalyticsOverviewRequest,
  AnalyticsRiskRequest,
  AnalyticsScheduleRequest,
  AnalyticsTiltRequest,
  BankrollConfig,
  TimeBucket,
} from "../../core/analytics";
import { AnalyticsService } from "./analytics.service";

const router = Router();
const service = new AnalyticsService();

const ALLOWED_LEAGUES = new Set<AnalyticsLeagueType>(["GT LEAGUE", "8MIN BATTLE", "6MIN VOLTA", "H2H"]);
const ALLOWED_TIME_BUCKETS = new Set<TimeBucket>(["madrugada", "manha", "tarde", "noite"]);

router.get("/overview", async (request, response, next) => {
  try {
    const parsed = parseOverviewRequest(request);
    if (typeof parsed === "string") {
      response.status(400).json({ message: parsed });
      return;
    }

    const result = await service.getOverview(parsed);
    if (!result) {
      response.status(404).json({ message: "Analytics overview nao encontrado" });
      return;
    }

    response.json(result);
  } catch (error) {
    next(error);
  }
});

router.get("/schedule", async (request, response, next) => {
  try {
    const parsed = parsePlayerScopedRequest<AnalyticsScheduleRequest>(request);
    if (typeof parsed === "string") {
      response.status(400).json({ message: parsed });
      return;
    }

    const result = await service.getSchedule(parsed);
    if (!result) {
      response.status(404).json({ message: "Analytics schedule nao encontrado" });
      return;
    }

    response.json(result);
  } catch (error) {
    next(error);
  }
});

router.get("/tilt", async (request, response, next) => {
  try {
    const parsed = parsePlayerScopedRequest<AnalyticsTiltRequest>(request, true);
    if (typeof parsed === "string") {
      response.status(400).json({ message: parsed });
      return;
    }

    const result = await service.getTilt(parsed);
    if (!result) {
      response.status(404).json({ message: "Analytics tilt nao encontrado" });
      return;
    }

    response.json(result);
  } catch (error) {
    next(error);
  }
});

router.get("/h2h", async (request, response, next) => {
  try {
    const parsed = parsePlayerScopedRequest<AnalyticsH2HRequest>(request);
    if (typeof parsed === "string") {
      response.status(400).json({ message: parsed });
      return;
    }

    const result = await service.getH2H(parsed);
    if (!result) {
      response.status(404).json({ message: "Analytics h2h nao encontrado" });
      return;
    }

    response.json(result);
  } catch (error) {
    next(error);
  }
});

router.get("/risk", async (request, response, next) => {
  try {
    const parsed = parsePlayerScopedRequest<AnalyticsRiskRequest>(request, true);
    if (typeof parsed === "string") {
      response.status(400).json({ message: parsed });
      return;
    }

    const result = await service.getRisk(parsed);
    if (!result) {
      response.status(404).json({ message: "Analytics risk nao encontrado" });
      return;
    }

    response.json(result);
  } catch (error) {
    next(error);
  }
});

export { router as analyticsRouter };

function parseOverviewRequest(request: Request): AnalyticsOverviewRequest | string {
  const base = parsePlayerScopedRequest<AnalyticsOverviewRequest>(request, true);
  if (typeof base === "string") {
    return base;
  }

  const windowSizes = parseNumberArray(request.query.windowSizes);
  if (windowSizes === null || (request.query.windowSizes !== undefined && !windowSizes.length)) {
    return "windowSizes invalido";
  }

  return {
    ...base,
    ...(windowSizes ? { windowSizes } : {}),
  };
}

function parsePlayerScopedRequest<T extends AnalyticsScheduleRequest | AnalyticsTiltRequest | AnalyticsH2HRequest | AnalyticsRiskRequest>(
  request: Request,
  includeBankrollConfig = false,
): T | string {
  const playerName = parseRequiredString(request.query.playerName);
  if (!playerName) {
    return "playerName e obrigatorio";
  }

  const filters = parseAnalyticsFilters(request);
  if (typeof filters === "string") {
    return filters;
  }

  const bankrollConfig = includeBankrollConfig ? parseBankrollConfig(request) : undefined;
  if (typeof bankrollConfig === "string") {
    return bankrollConfig;
  }

  return {
    playerName,
    ...filters,
    ...(bankrollConfig ? { bankrollConfig } : {}),
  } as T;
}

function parseAnalyticsFilters(request: Request): AnalyticsFilters | string {
  const opponentName = parseOptionalString(request.query.opponentName);
  const leagueTypes = parseLeagueTypes(request.query.leagueTypes);
  if (typeof leagueTypes === "string") {
    return leagueTypes;
  }

  const hours = parseNumberArray(request.query.hours);
  if (hours === null || (request.query.hours !== undefined && !hours.length)) {
    return "hours invalido";
  }

  const weekdays = parseNumberArray(request.query.weekdays);
  if (weekdays === null || (request.query.weekdays !== undefined && !weekdays.length)) {
    return "weekdays invalido";
  }

  const timeBuckets = parseTimeBuckets(request.query.timeBuckets);
  if (typeof timeBuckets === "string") {
    return timeBuckets;
  }

  const minGames = parseOptionalNumber(request.query.minGames);
  if (request.query.minGames !== undefined && minGames === null) {
    return "minGames invalido";
  }

  const includeDraws = parseOptionalBoolean(request.query.includeDraws);
  const onlyCompletedSessions = parseOptionalBoolean(request.query.onlyCompletedSessions);
  const startDate = parseOptionalString(request.query.startDate);
  const endDate = parseOptionalString(request.query.endDate);

  return {
    ...(opponentName ? { opponentName } : {}),
    ...(leagueTypes.length ? { leagueTypes } : {}),
    ...(startDate ? { startDate } : {}),
    ...(endDate ? { endDate } : {}),
    ...(minGames !== null && minGames !== undefined ? { minGames } : {}),
    ...(includeDraws !== undefined ? { includeDraws } : {}),
    ...(onlyCompletedSessions !== undefined ? { onlyCompletedSessions } : {}),
    ...(hours.length ? { hours } : {}),
    ...(weekdays.length ? { weekdays } : {}),
    ...(timeBuckets.length ? { timeBuckets } : {}),
  };
}

function parseBankrollConfig(request: Request): BankrollConfig | string | undefined {
  const initialBankroll = parseOptionalNumber(request.query.initialBankroll);
  const stakePerGame = parseOptionalNumber(request.query.stakePerGame);
  const winAmount = parseOptionalNumber(request.query.winAmount);
  const lossAmount = parseOptionalNumber(request.query.lossAmount);
  const drawAmount = parseOptionalNumber(request.query.drawAmount);

  const hasInvalidNumber =
    (request.query.initialBankroll !== undefined && initialBankroll === null) ||
    (request.query.stakePerGame !== undefined && stakePerGame === null) ||
    (request.query.winAmount !== undefined && winAmount === null) ||
    (request.query.lossAmount !== undefined && lossAmount === null) ||
    (request.query.drawAmount !== undefined && drawAmount === null);

  if (hasInvalidNumber) {
    return "Configuracao de bankroll invalida";
  }

  if (
    initialBankroll === undefined &&
    stakePerGame === undefined &&
    winAmount === undefined &&
    lossAmount === undefined &&
    drawAmount === undefined
  ) {
    return undefined;
  }

  const config: BankrollConfig = {
    mode: "simulated",
  };

  if (initialBankroll !== undefined && initialBankroll !== null) {
    config.initialBankroll = initialBankroll;
  }

  if (stakePerGame !== undefined && stakePerGame !== null) {
    config.stakePerGame = stakePerGame;
  }

  if (winAmount !== undefined && winAmount !== null) {
    config.winAmount = winAmount;
  }

  if (lossAmount !== undefined && lossAmount !== null) {
    config.lossAmount = lossAmount;
  }

  if (drawAmount !== undefined && drawAmount !== null) {
    config.drawAmount = drawAmount;
  }

  return config;
}

function parseLeagueTypes(value: unknown): AnalyticsLeagueType[] | string {
  const items = parseStringArray(value);
  const invalid = items.find((item) => !ALLOWED_LEAGUES.has(item as AnalyticsLeagueType));
  if (invalid) {
    return `leagueTypes invalido: ${invalid}`;
  }

  return items as AnalyticsLeagueType[];
}

function parseTimeBuckets(value: unknown): TimeBucket[] | string {
  const items = parseStringArray(value);
  const invalid = items.find((item) => !ALLOWED_TIME_BUCKETS.has(item as TimeBucket));
  if (invalid) {
    return `timeBuckets invalido: ${invalid}`;
  }

  return items as TimeBucket[];
}

function parseRequiredString(value: unknown) {
  const parsed = parseOptionalString(value);
  return parsed && parsed.length ? parsed : null;
}

function parseOptionalString(value: unknown) {
  if (typeof value !== "string") {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed.length ? trimmed : undefined;
}

function parseOptionalNumber(value: unknown) {
  if (value === undefined) {
    return undefined;
  }

  if (typeof value !== "string" || !value.trim()) {
    return null;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseOptionalBoolean(value: unknown) {
  if (value === undefined) {
    return undefined;
  }

  if (typeof value === "boolean") {
    return value;
  }

  if (typeof value !== "string") {
    return undefined;
  }

  const normalized = value.trim().toLowerCase();
  if (["1", "true", "yes", "y", "sim"].includes(normalized)) {
    return true;
  }

  if (["0", "false", "no", "n", "nao"].includes(normalized)) {
    return false;
  }

  return undefined;
}

function parseStringArray(value: unknown) {
  if (Array.isArray(value)) {
    return value
      .flatMap((item) => (typeof item === "string" ? item.split(",") : []))
      .map((item) => item.trim())
      .filter(Boolean);
  }

  if (typeof value !== "string") {
    return [];
  }

  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function parseNumberArray(value: unknown) {
  const items = parseStringArray(value);
  const numbers = items.map((item) => Number(item));
  if (numbers.some((item) => !Number.isFinite(item))) {
    return null;
  }

  return Array.from(new Set(numbers));
}