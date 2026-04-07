import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  getLoginAuditEntries,
  getLoginAuditSummary,
} from "@/lib/auth/login-audit";
import { formatCompactDateTime } from "@/lib/format";

type AlertStatus = {
  persistenceMode: string;
  isVolatile: boolean;
  telegramConfigured: boolean;
  defaultTelegramChatIds: string[];
};

type AlertRule = {
  id: string;
  name: string;
  isActive: boolean;
  leagueType: string;
  methodCode: string;
  series: string | null;
  playerName: string | null;
  apxMin: number;
  windowDays: number;
  note: string | null;
  updatedAt: string;
};

type AlertDispatch = {
  id: string;
  leagueType: string;
  methodCode: string;
  confrontationLabel: string | null;
  apx: number | null;
  totalOccurrences: number | null;
  eventType: string;
  transportStatus: string;
  sentAt: string | null;
  createdAt: string;
};

type AlertDispatchLog = {
  id: string;
  leagueType: string;
  methodCode: string | null;
  signalKey: string;
  confrontationLabel: string;
  occurrencePlayedAt: string;
  apx: number;
  totalOccurrences: number;
  eventType: "initial_signal" | "result_followup";
  payloadText: string;
};

export type PortalOpenSignal = {
  signalKey: string;
  confrontationLabel: string;
  leagueType: string;
  methodCode: string;
  series: string | null;
  playerOneName: string | null;
  playerTwoName: string | null;
  apx: number;
  totalOccurrences: number;
  wins: number;
  draws: number;
  losses: number;
  occurrencePlayedAt: string;
  localPlayedAtLabel: string;
  confrontationSequence: Array<{
    result: "W" | "D" | "L";
    localTimeLabel: string;
    scoreLabel: string;
    confrontationLabel: string;
    playerGoals: number;
    opponentGoals: number;
  }>;
  playerOneDaySequence: Array<{
    result: "W" | "D" | "L";
    localTimeLabel: string;
    scoreLabel: string;
    confrontationLabel: string;
    playerGoals: number;
    opponentGoals: number;
  }>;
  playerTwoDaySequence: Array<{
    result: "W" | "D" | "L";
    localTimeLabel: string;
    scoreLabel: string;
    confrontationLabel: string;
    playerGoals: number;
    opponentGoals: number;
  }>;
};

type PortalFutureConfrontationRow = {
  fixtureId: string;
  confrontationKey: string;
  confrontationLabel: string;
  fixtureLabel: string;
  leagueType: string;
  groupLabel: string | null;
  playedAtIso: string;
  localPlayedAtLabel: string;
  playerName: string;
  opponentName: string;
  methodCode: string;
  apx: number;
  totalOccurrences: number;
  wins: number;
  draws: number;
  losses: number;
  confrontationSequenceDetails?: PortalOpenSignal["confrontationSequence"];
  playerOneDaySequence?: PortalOpenSignal["playerOneDaySequence"];
  playerTwoDaySequence?: PortalOpenSignal["playerTwoDaySequence"];
};

type PortalFutureConfrontationsResponse = {
  rows: PortalFutureConfrontationRow[];
};

type PortalLiveFeedResponse = {
  generatedAt: string;
  source: "live" | "backup-only" | "stale";
  rows: PortalOpenSignal[];
  buildMs: number;
  warning: string | null;
};

type PortalOpenSignalsSnapshotState = {
  signals: PortalOpenSignal[];
  exists: boolean;
  isFresh: boolean;
};

type PortalOpenSignalQueryOptions = {
  leagueTypes?: string[];
};

export type PortalDisparityPlayerOption = {
  id: string;
  name: string;
  totalGames: number;
  wins: number;
  draws: number;
  losses: number;
  winRate: number;
};

export type PortalDisparityPairHistoryItem = {
  matchId: string;
  playedAt: string;
  localTimeLabel: string;
  playerOneGoals: number;
  playerTwoGoals: number;
  resultCode: "1" | "2" | "E";
  scoreLabel: string;
  fixtureLabel?: string;
  playerOneIsHome?: boolean;
};

export type PortalDisparityPairRow = {
  championshipKey: string;
  dayKey: string;
  seasonId: number | null;
  seasonLabel: string | null;
  displayLabel: string | null;
  dateLabel: string | null;
  playedAt: string | null;
  playerOneWins: number;
  draws: number;
  playerTwoWins: number;
  totalGames: number;
  history: PortalDisparityPairHistoryItem[];
};

export type PortalDisparityPairResponse = {
  generatedAt: string;
  leagueType: string;
  players: {
    playerOne: string;
    playerTwo: string;
  };
  totalRows: number;
  totalMatches: number;
  rows: PortalDisparityPairRow[];
};

type PortalGTDisparityIndexSnapshot = {
  generatedAt: string;
  lastSuccessfulSyncAt: string | null;
  lastPublishedAt: string | null;
  leagueType: "GT LEAGUE";
  lookbackDays: number;
  playerCount: number;
  pairCount: number;
  players: Array<{ id: string; name: string }>;
  pairs: Array<{
    pairKey: string;
    playerOne: string;
    playerTwo: string;
    totalRows: number;
    totalMatches: number;
    lastPlayedAt: string | null;
  }>;
};

export type PortalGTPanoramaPairHistoryItem = {
  matchId: string;
  playedAtIso: string;
  localTimeLabel: string;
  playerOneGoals: number;
  playerTwoGoals: number;
  result: "W" | "D" | "L";
  scoreLabel: string;
};

export type PortalGTPanoramaPairRow = {
  confrontationKey: string;
  confrontationLabel: string;
  playerOneName: string;
  playerTwoName: string;
  wins: number;
  draws: number;
  losses: number;
  totalGames: number;
  history: PortalGTPanoramaPairHistoryItem[];
};

export type PortalGTPanoramaPlayerSequenceItem = {
  matchId: string;
  playedAtIso: string;
  localTimeLabel: string;
  opponentName: string;
  result: "W" | "D" | "L";
  fullTimeScore: string;
};

export type PortalGTPanoramaPlayerRow = {
  playerName: string;
  wins: number;
  draws: number;
  losses: number;
  totalGames: number;
  apx: number;
  sequence: PortalGTPanoramaPlayerSequenceItem[];
};

export type PortalGTPanoramaStandingPlayer = {
  playerName: string;
  gp: number;
  pts: number;
  wins: number;
  draws: number;
  losses: number;
  gf: number;
  ga: number;
  gd: number;
  winPct: number;
  drawPct: number;
  lossPct: number;
};

export type PortalGTPanoramaSeasonStanding = {
  seasonId: number;
  seasonLabel: string;
  windowLabel: string;
  players: PortalGTPanoramaStandingPlayer[];
};

export type PortalGTPanoramaSeriesGroup = {
  series: string;
  pairRows: PortalGTPanoramaPairRow[];
  playerRows: PortalGTPanoramaPlayerRow[];
  seasonStandings: PortalGTPanoramaSeasonStanding[];
};

export type PortalGTPanoramaResponse = {
  generatedAt: string;
  leagueType: string;
  dayKey: string;
  dayLabel: string;
  totalMatches: number;
  seriesGroups: PortalGTPanoramaSeriesGroup[];
};

export type PortalGTRaioXHistoryItem = {
  matchId: string;
  playedAtIso: string;
  localTimeLabel: string;
  playerOneGoals: number;
  playerTwoGoals: number;
  resultCode: "1" | "2" | "E";
  scoreLabel: string;
};

export type PortalGTRaioXDayRow = {
  dayKey: string;
  dayLabel: string;
  playedAtIso: string;
  series: string | null;
  playerOneWins: number;
  draws: number;
  playerTwoWins: number;
  totalGames: number;
  history: PortalGTRaioXHistoryItem[];
};

export type PortalGTRaioXRow = {
  confrontationKey: string;
  confrontationLabel: string;
  playerOneName: string;
  playerTwoName: string;
  series: string | null;
  qualifyingDays: number;
  sampleDays: number;
  hitRate: number;
  recentDays: PortalGTRaioXDayRow[];
};

export type PortalGTRaioXResponse = {
  generatedAt: string;
  leagueType: string;
  lookbackDays: number;
  requiredDays: number;
  scanMinHitRate: number;
  minHitRate: number;
  totalPairsSeen: number;
  totalPairsEvaluated: number;
  totalMappedPairs: number;
  totalEligiblePairs: number;
  seriesSummary: Array<{
    series: string;
    pairs: number;
  }>;
  rows: PortalGTRaioXRow[];
};

export type PortalGTLiveTableRow = {
  fixtureId: string;
  pairKey: string;
  playedAtIso: string;
  playedAtLabel: string;
  confrontationLabel: string;
  playerOneName: string;
  playerTwoName: string;
  series: string | null;
  scoreLabel: string;
  totalMatches: number;
  resultTotals: {
    playerOneWins: number;
    draws: number;
    playerTwoWins: number;
  };
  over05Count: number;
  over05Rate: number;
  bttsCount: number;
  bttsRate: number;
  avgBttsPerDay: number;
  playerOneScoredCount: number;
  playerOneScoredRate: number;
  playerTwoScoredCount: number;
  playerTwoScoredRate: number;
  recentBttsHistory: Array<{
    value: "S" | "N";
    localTimeLabel: string;
    scoreLabel: string;
  }>;
  recentHistory: Array<{
    value: "1" | "2" | "E";
    result: "W" | "D" | "L";
    playerGoals: number;
    opponentGoals: number;
    localTimeLabel: string;
    scoreLabel: string;
    confrontationLabel: string;
  }>;
  scorelineCounts: Record<string, number>;
};

export type PortalGTLiveTableUpcomingRow = {
  fixtureId: string;
  pairKey: string;
  kickoffIso: string;
  kickoffLabel: string;
  confrontationLabel: string;
  playerOneName: string;
  playerTwoName: string;
  series: string | null;
  status: "live" | "upcoming";
};

export type PortalGTLiveTableResponse = {
  generatedAt: string;
  leagueType: string;
  liveWindowMinutes: number;
  historyDays: number;
  dayKey: string;
  dayLabel: string;
  scorelines: string[];
  totalLiveFixtures: number;
  rows: PortalGTLiveTableRow[];
  upcomingRows?: PortalGTLiveTableUpcomingRow[];
  source?: "live" | "backup-only" | "stale";
  warning?: string | null;
};

export type PortalGTPastMethodRow = {
  id: string;
  playedAtIso: string;
  playedAtLabel: string;
  dayKey: string;
  confrontationLabel: string;
  playerName: string;
  opponentName: string;
  methodCode: string;
  series: string;
  fullTimeScore: string;
  wins: number;
  draws: number;
  losses: number;
  apx: number;
  totalOccurrences: number;
  result: "W" | "D" | "L" | "E";
};

export type PortalGTPastMethodsData = {
  rows: PortalGTPastMethodRow[];
  lastSuccessfulSyncAt: string | null;
  lastPublishedAt: string | null;
};

type PortalMethodOccurrencesResponse = {
  generatedAt: string;
  source: "database" | "file";
  leagueType: string;
  dayKeys: string[];
  rows: Array<{
    id: string;
    leagueType: string;
    series: string;
    methodCode: string;
    confrontationLabel: string;
    playerName: string;
    opponentName: string;
    playedAtIso: string;
    dayKey: string;
    result: "W" | "D" | "L";
    fullTimeScore: string;
    wins: number;
    draws: number;
    losses: number;
    apx: number;
    totalOccurrences: number;
  }>;
  lastSuccessfulSyncAt: string | null;
  lastPublishedAt: string | null;
  syncInProgress: boolean;
};

type PortalDashboardCurrentJPlayer = {
  id: string;
  name: string;
  totalGames: number;
  wins: number;
  draws: number;
  losses: number;
  winRate: number;
};

type PortalDashboardCurrentJResponse = {
  players?: PortalDashboardCurrentJPlayer[];
};

type PortalDashboardData = {
  alertStatus: AlertStatus;
  rules: AlertRule[];
  recentDispatches: AlertDispatch[];
  latestDispatch: AlertDispatch | null;
  metrics: {
    activeRules: number;
    gtRules: number;
    targetedPlayers: number;
    leaguesCovered: number;
    sentDispatches: number;
    resolvedDispatches: number;
  };
  loginAudit: Awaited<ReturnType<typeof getLoginAuditEntries>>;
  auditSummary: ReturnType<typeof getLoginAuditSummary>;
};

type PortalAlertsLocalBackup = {
  dispatches?: PortalAlertsLocalBackupDispatch[];
};

type PortalAlertsLocalBackupDispatch = {
  signalKey: string;
  confrontationLabel: string;
  leagueType: string | null;
  methodCode: string | null;
  eventType?: string | null;
  transportStatus: string;
  occurrencePlayedAt: string;
  apx: number;
  totalOccurrences: number;
  payloadText: string;
};

type PortalStoredDispatchPayload = {
  eventType?: string;
  rootSignalKey?: string;
  rule?: {
    leagueType?: string;
    methodCode?: string;
  };
  signal?: {
    signalKey?: string;
    rootSignalKey?: string;
    confrontationLabel?: string;
    occurrencePlayedAt?: string;
    localPlayedAtLabel?: string;
    apx?: number;
    totalOccurrences?: number;
    wins?: number;
    draws?: number;
    losses?: number;
    methodCode?: string;
    groupLabel?: string | null;
    result?: string;
    fullTimeScore?: string;
  };
};

const defaultAlertStatus: AlertStatus = {
  persistenceMode: "unknown",
  isVolatile: true,
  telegramConfigured: false,
  defaultTelegramChatIds: [],
};

const PORTAL_HC_METHODS = ["(3D+)", "HC-2", "HC-3", "HC-4", "HC-5"] as const;
const PORTAL_HC_LEAGUES = ["GT LEAGUE", "8MIN BATTLE", "6MIN VOLTA"] as const;
const PORTAL_OPEN_SIGNAL_LOOKBACK_MS = 45 * 60 * 1000;
const PORTAL_OPEN_SIGNAL_LOOKAHEAD_MS = 60 * 60 * 1000;
const PORTAL_OPEN_SIGNAL_IN_PROGRESS_GRACE_MS = 20 * 60 * 1000;

function getPortalAlertsLocalBackupPath() {
  return resolve(
    process.cwd(),
    "..",
    "api",
    "tmp",
    "alerts-backups",
    "latest.json",
  );
}

function getPortalLiveFeedSnapshotPath() {
  return resolve(
    process.cwd(),
    "..",
    "api",
    "tmp",
    "portal-live-feed",
    "latest.json",
  );
}

function buildPortalLiveFeedLeagueViewFileName(leagueType: string) {
  return `${leagueType
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")}.json`;
}

function getPortalLiveFeedLeagueSnapshotPath(leagueType: string) {
  return resolve(
    process.cwd(),
    "..",
    "api",
    "tmp",
    "portal-live-feed",
    "views",
    buildPortalLiveFeedLeagueViewFileName(leagueType),
  );
}

function getPortalMethodOccurrencesSnapshotPath(leagueType: string) {
  const fileName = `${leagueType
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")}.json`;

  return resolve(
    process.cwd(),
    "..",
    "api",
    "tmp",
    "portal-method-occurrences",
    "views",
    fileName,
  );
}

function getPortalGTRaioXSnapshotPath() {
  return resolve(
    process.cwd(),
    "..",
    "api",
    "tmp",
    "portal-xray",
    "views",
    "gt-league.json",
  );
}

function getPortalGTPanoramaSnapshotPath() {
  return resolve(
    process.cwd(),
    "..",
    "api",
    "tmp",
    "portal-panorama",
    "views",
    "gt-league.json",
  );
}

function getPortalGTDisparityOptionsSnapshotPath() {
  return resolve(
    process.cwd(),
    "..",
    "api",
    "tmp",
    "portal-disparity-options",
    "views",
    "gt-league.json",
  );
}

function getPortalGTDisparityIndexSnapshotPath() {
  return resolve(
    process.cwd(),
    "..",
    "api",
    "tmp",
    "portal-disparity",
    "views",
    "gt-league.json",
  );
}

function getPortalGTDisparityPairsDirectory() {
  return resolve(
    process.cwd(),
    "..",
    "api",
    "tmp",
    "portal-disparity",
    "pairs",
    "gt-league",
  );
}

function getPortalGTLiveTableSnapshotPath(historyDays?: number) {
  const normalizedHistoryDays =
    historyDays === 5 ||
    historyDays === 10 ||
    historyDays === 15 ||
    historyDays === 60
      ? historyDays
      : 30;
  return resolve(
    process.cwd(),
    "..",
    "api",
    "tmp",
    "portal-gt-live-table",
    normalizedHistoryDays === 30
      ? "latest.json"
      : `latest-${normalizedHistoryDays}.json`,
  );
}

function getPortalApiBaseUrl() {
  return (
    process.env.PORTAL_API_BASE_URL ??
    process.env.NEXT_PUBLIC_API_URL ??
    "http://localhost:4013/api"
  ).replace(/\/$/, "");
}

function normalizePortalLiveFeedLeagueTypes(leagueTypes?: string[]) {
  return Array.from(
    new Set(
      (leagueTypes ?? [])
        .map((leagueType) => leagueType.trim())
        .filter(Boolean),
    ),
  );
}

function buildPortalLiveFeedApiPath(leagueTypes?: string[]) {
  const normalizedLeagueTypes = normalizePortalLiveFeedLeagueTypes(leagueTypes);

  if (normalizedLeagueTypes.length === 0) {
    return "/portal/live-feed";
  }

  const params = new URLSearchParams();
  for (const leagueType of normalizedLeagueTypes) {
    params.append("leagueType", leagueType);
  }

  return `/portal/live-feed?${params.toString()}`;
}

async function fetchPortalApi<T>(path: string, fallback: T) {
  try {
    const response = await fetch(`${getPortalApiBaseUrl()}${path}`, {
      signal: AbortSignal.timeout(8_000),
      next: {
        revalidate: 20,
      },
    });

    if (!response.ok) {
      return fallback;
    }

    return (await response.json()) as T;
  } catch {
    return fallback;
  }
}

async function fetchPortalApiLiveWithTimeout<T>(
  path: string,
  fallback: T,
  timeoutMs: number,
) {
  try {
    const response = await fetch(`${getPortalApiBaseUrl()}${path}`, {
      signal: AbortSignal.timeout(timeoutMs),
      cache: "no-store",
    });

    if (!response.ok) {
      return fallback;
    }

    return (await response.json()) as T;
  } catch {
    return fallback;
  }
}

async function fetchPortalApiLive<T>(path: string, fallback: T) {
  return fetchPortalApiLiveWithTimeout(path, fallback, 5_000);
}

async function withTimeoutFallback<T>(
  operation: Promise<T>,
  fallback: T,
  timeoutMs: number,
) {
  let timeoutId: NodeJS.Timeout | null = null;

  try {
    return await Promise.race([
      operation,
      new Promise<T>((resolve) => {
        timeoutId = setTimeout(() => resolve(fallback), timeoutMs);
      }),
    ]);
  } finally {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
  }
}

function buildPortalSignalMergeKey(signal: PortalOpenSignal) {
  return [
    signal.occurrencePlayedAt,
    signal.leagueType.trim().toUpperCase(),
    signal.methodCode.trim().toUpperCase(),
    signal.confrontationLabel.trim().toUpperCase(),
    signal.series?.trim().toUpperCase() ?? "-",
  ].join("||");
}

function mergePortalOpenSignalSets(signalSets: PortalOpenSignal[][]) {
  const signals = new Map<string, PortalOpenSignal>();

  for (const signalSet of signalSets) {
    for (const signal of signalSet) {
      signals.set(buildPortalSignalMergeKey(signal), signal);
    }
  }

  return Array.from(signals.values()).sort(
    (left, right) =>
      new Date(left.occurrencePlayedAt).getTime() -
        new Date(right.occurrencePlayedAt).getTime() ||
      left.confrontationLabel.localeCompare(right.confrontationLabel, "pt-BR", {
        sensitivity: "base",
      }),
  );
}

function parsePortalStoredDispatchPayload(payloadText: string) {
  try {
    return JSON.parse(payloadText) as PortalStoredDispatchPayload;
  } catch {
    return null;
  }
}

function normalizePortalSeries(value: string | null | undefined) {
  if (!value?.trim()) {
    return "-";
  }

  const normalized = value.trim();
  const match = normalized.match(/group\s+([a-z0-9]+)/i);
  if (match?.[1]) {
    return match[1].toUpperCase();
  }

  return normalized
    .replace(/^serie\s+/i, "")
    .trim()
    .toUpperCase();
}

function normalizePortalPastResult(value: string | undefined) {
  if (value === "W" || value === "D" || value === "L" || value === "E") {
    return value;
  }

  return null;
}

function buildPortalRootSignalKey(
  dispatch: PortalAlertsLocalBackupDispatch,
  payload: PortalStoredDispatchPayload | null,
) {
  return (
    payload?.signal?.rootSignalKey ??
    payload?.rootSignalKey ??
    dispatch.signalKey.replace(/::resolved$/u, "")
  );
}

async function getPortalSignalsFromLocalBackup(): Promise<PortalOpenSignal[]> {
  try {
    const backupRaw = await readFile(getPortalAlertsLocalBackupPath(), "utf8");
    const backup = JSON.parse(backupRaw) as PortalAlertsLocalBackup;
    const dispatches = Array.isArray(backup.dispatches)
      ? backup.dispatches
      : [];
    const nowMs = Date.now();
    const windowStartMs = nowMs - PORTAL_OPEN_SIGNAL_LOOKBACK_MS;
    const windowEndMs = nowMs + PORTAL_OPEN_SIGNAL_LOOKAHEAD_MS;
    const resolvedRootSignalKeys = new Set<string>();

    for (const dispatch of dispatches) {
      const payload = parsePortalStoredDispatchPayload(dispatch.payloadText);
      const rootSignalKey = buildPortalRootSignalKey(dispatch, payload);
      const eventType = payload?.eventType ?? dispatch.eventType ?? "";

      if (
        eventType === "result_followup" ||
        dispatch.signalKey.endsWith("::resolved")
      ) {
        resolvedRootSignalKeys.add(rootSignalKey);
      }
    }

    const signals = new Map<string, PortalOpenSignal>();

    for (const dispatch of dispatches) {
      if (!["sent", "skipped"].includes(dispatch.transportStatus)) {
        continue;
      }

      const payload = parsePortalStoredDispatchPayload(dispatch.payloadText);
      const rootSignalKey = buildPortalRootSignalKey(dispatch, payload);
      const eventType = payload?.eventType ?? dispatch.eventType ?? "";
      const occurrencePlayedAt =
        payload?.signal?.occurrencePlayedAt ?? dispatch.occurrencePlayedAt;
      const occurrenceAtMs = new Date(occurrencePlayedAt).getTime();

      if (
        eventType === "result_followup" ||
        dispatch.signalKey.endsWith("::resolved") ||
        resolvedRootSignalKeys.has(rootSignalKey) ||
        Number.isNaN(occurrenceAtMs) ||
        occurrenceAtMs < windowStartMs ||
        occurrenceAtMs > windowEndMs
      ) {
        continue;
      }

      const signal: PortalOpenSignal = {
        signalKey: rootSignalKey,
        confrontationLabel:
          payload?.signal?.confrontationLabel ?? dispatch.confrontationLabel,
        leagueType:
          payload?.rule?.leagueType ?? dispatch.leagueType ?? "GT LEAGUE",
        methodCode:
          payload?.signal?.methodCode ??
          payload?.rule?.methodCode ??
          dispatch.methodCode ??
          "",
        series: payload?.signal?.groupLabel ?? null,
        playerOneName:
          (payload?.signal?.confrontationLabel ?? dispatch.confrontationLabel)
            .split(" x ")
            .at(0) ?? null,
        playerTwoName:
          (payload?.signal?.confrontationLabel ?? dispatch.confrontationLabel)
            .split(" x ")
            .at(1) ?? null,
        apx: payload?.signal?.apx ?? dispatch.apx,
        totalOccurrences:
          payload?.signal?.totalOccurrences ?? dispatch.totalOccurrences,
        wins: payload?.signal?.wins ?? 0,
        draws: payload?.signal?.draws ?? 0,
        losses: payload?.signal?.losses ?? 0,
        occurrencePlayedAt,
        localPlayedAtLabel: payload?.signal?.localPlayedAtLabel ?? "",
        confrontationSequence: [],
        playerOneDaySequence: [],
        playerTwoDaySequence: [],
      };

      signals.set(buildPortalSignalMergeKey(signal), signal);
    }

    return Array.from(signals.values()).sort(
      (left, right) =>
        new Date(left.occurrencePlayedAt).getTime() -
          new Date(right.occurrencePlayedAt).getTime() ||
        left.confrontationLabel.localeCompare(
          right.confrontationLabel,
          "pt-BR",
          {
            sensitivity: "base",
          },
        ),
    );
  } catch {
    return [];
  }
}

async function readPortalLiveFeedSnapshotFile(leagueType?: string) {
  try {
    const snapshotRaw = await readFile(
      leagueType
        ? getPortalLiveFeedLeagueSnapshotPath(leagueType)
        : getPortalLiveFeedSnapshotPath(),
      "utf8",
    );
    const snapshot = JSON.parse(snapshotRaw) as PortalLiveFeedResponse & {
      persistedAt?: string;
    };

    return snapshot;
  } catch {
    return null;
  }
}

async function getPortalOpenSignalsFromSnapshot(
  options?: PortalOpenSignalQueryOptions,
): Promise<PortalOpenSignalsSnapshotState> {
  const normalizedLeagueTypes = normalizePortalLiveFeedLeagueTypes(
    options?.leagueTypes,
  );

  const snapshots =
    normalizedLeagueTypes.length === 0
      ? [await readPortalLiveFeedSnapshotFile()]
      : await Promise.all(
          normalizedLeagueTypes.map((leagueType) =>
            readPortalLiveFeedSnapshotFile(leagueType),
          ),
        );

  const validSnapshots = snapshots.filter(
    (snapshot): snapshot is PortalLiveFeedResponse & { persistedAt?: string } =>
      Boolean(snapshot),
  );

  if (validSnapshots.length === 0) {
    return {
      signals: [],
      exists: false,
      isFresh: false,
    };
  }

  const freshnessValues = validSnapshots
    .map((snapshot) => {
      const freshnessReference =
        snapshot.persistedAt ??
        snapshot.generatedAt ??
        new Date(0).toISOString();
      return new Date(freshnessReference).getTime();
    })
    .filter((value) => !Number.isNaN(value));

  if (freshnessValues.length === 0) {
    return {
      signals: [],
      exists: true,
      isFresh: false,
    };
  }

  const freshestSnapshotMs = Math.max(...freshnessValues);

  return {
    signals: filterPortalSignalsToFuture(
      mergePortalOpenSignalSets(
        validSnapshots.map((snapshot) => snapshot.rows ?? []),
      ),
    ),
    exists: true,
    isFresh: Date.now() - freshestSnapshotMs <= 20 * 60 * 1000,
  };
}

function filterPortalSignalsToFuture(signals: PortalOpenSignal[]) {
  const nowMs = Date.now();
  const liveWindowStartMs = nowMs - PORTAL_OPEN_SIGNAL_IN_PROGRESS_GRACE_MS;

  return signals
    .filter((signal) => {
      const occurrenceAtMs = new Date(signal.occurrencePlayedAt).getTime();
      return (
        !Number.isNaN(occurrenceAtMs) && occurrenceAtMs >= liveWindowStartMs
      );
    })
    .sort(
      (left, right) =>
        new Date(left.occurrencePlayedAt).getTime() -
          new Date(right.occurrencePlayedAt).getTime() ||
        left.confrontationLabel.localeCompare(
          right.confrontationLabel,
          "pt-BR",
          {
            sensitivity: "base",
          },
        ),
    );
}

function mapFutureConfrontationRowToPortalSignal(
  row: PortalFutureConfrontationRow,
): PortalOpenSignal {
  const [playerOneName = null, playerTwoName = null] =
    row.confrontationLabel.split(" x ");
  return {
    signalKey: `METHOD_PREVIEW::${row.fixtureId}::${row.methodCode}::${row.confrontationKey}`,
    confrontationLabel: row.fixtureLabel || row.confrontationLabel,
    leagueType: row.leagueType,
    methodCode: row.methodCode,
    series: row.groupLabel,
    playerOneName,
    playerTwoName,
    apx: row.apx,
    totalOccurrences: row.totalOccurrences,
    wins: row.wins,
    draws: row.draws,
    losses: row.losses,
    occurrencePlayedAt: row.playedAtIso,
    localPlayedAtLabel: row.localPlayedAtLabel,
    confrontationSequence: row.confrontationSequenceDetails ?? [],
    playerOneDaySequence: row.playerOneDaySequence ?? [],
    playerTwoDaySequence: row.playerTwoDaySequence ?? [],
  };
}

async function getPortalHandicapOpenSignals(): Promise<PortalOpenSignal[]> {
  const previews = await Promise.all(
    PORTAL_HC_LEAGUES.flatMap((leagueType) =>
      PORTAL_HC_METHODS.map(async (methodCode) => {
        const path = `/methods/future-confrontations?leagueType=${encodeURIComponent(leagueType)}&methodCode=${encodeURIComponent(methodCode)}&days=60`;
        const compactPath = `${path}&includePlayerStats=0`;
        const response =
          await fetchPortalApiLive<PortalFutureConfrontationsResponse>(
            compactPath,
            { rows: [] },
          );

        return response.rows.map(mapFutureConfrontationRowToPortalSignal);
      }),
    ),
  );

  return previews.flat();
}

export async function getPortalDashboardData(): Promise<PortalDashboardData> {
  const [alertStatus, rules, recentDispatches, loginAudit] = await Promise.all([
    fetchPortalApi<AlertStatus>("/alerts/status", defaultAlertStatus),
    fetchPortalApi<AlertRule[]>("/alerts/rules", []),
    fetchPortalApi<AlertDispatch[]>("/alerts/dispatches?limit=12", []),
    getLoginAuditEntries(20),
  ]);

  const activeRules = rules.filter((rule) => rule.isActive);
  const metrics = {
    activeRules: activeRules.length,
    gtRules: activeRules.filter((rule) => rule.leagueType === "GT LEAGUE")
      .length,
    targetedPlayers: activeRules.filter((rule) => Boolean(rule.playerName))
      .length,
    leaguesCovered: new Set(activeRules.map((rule) => rule.leagueType)).size,
    sentDispatches: recentDispatches.filter(
      (dispatch) => dispatch.transportStatus === "sent",
    ).length,
    resolvedDispatches: recentDispatches.filter(
      (dispatch) => dispatch.eventType === "result_followup",
    ).length,
  };

  return {
    alertStatus,
    rules: activeRules,
    recentDispatches,
    latestDispatch: recentDispatches[0] ?? null,
    metrics,
    loginAudit,
    auditSummary: getLoginAuditSummary(loginAudit),
  };
}

export async function getPortalGTPastMethods(): Promise<PortalGTPastMethodsData> {
  let response: PortalMethodOccurrencesResponse = {
    generatedAt: new Date().toISOString(),
    source: "file",
    leagueType: "GT LEAGUE",
    dayKeys: [],
    rows: [],
    lastSuccessfulSyncAt: null,
    lastPublishedAt: null,
    syncInProgress: false,
  };

  try {
    const raw = await readFile(
      getPortalMethodOccurrencesSnapshotPath("GT LEAGUE"),
      "utf8",
    );
    const snapshot = JSON.parse(raw) as Omit<
      PortalMethodOccurrencesResponse,
      "dayKeys" | "syncInProgress" | "source"
    > & {
      rows?: PortalMethodOccurrencesResponse["rows"];
      lastSyncAt?: string | null;
    };
    const snapshotRows = Array.isArray(snapshot.rows) ? snapshot.rows : [];
    const dayKeys = Array.from(
      new Set(snapshotRows.map((row) => row.dayKey)),
    ).slice(0, 30);
    const selectedDayKeys = new Set(dayKeys);

    response = {
      generatedAt: snapshot.generatedAt ?? new Date().toISOString(),
      source: "file",
      leagueType: snapshot.leagueType ?? "GT LEAGUE",
      dayKeys,
      rows: snapshotRows.filter((row) => selectedDayKeys.has(row.dayKey)),
      lastSuccessfulSyncAt:
        snapshot.lastSuccessfulSyncAt ?? snapshot.lastSyncAt ?? null,
      lastPublishedAt: snapshot.lastPublishedAt ?? snapshot.generatedAt ?? null,
      syncInProgress: false,
    };
  } catch {
    // The page intentionally reads only the published snapshot.
  }

  return {
    rows: response.rows.map((row) => ({
      id: row.id,
      playedAtIso: row.playedAtIso,
      playedAtLabel: formatCompactDateTime(row.playedAtIso),
      dayKey: row.dayKey,
      confrontationLabel: row.confrontationLabel,
      playerName: row.playerName,
      opponentName: row.opponentName,
      methodCode: row.methodCode,
      series: normalizePortalSeries(row.series),
      fullTimeScore: row.fullTimeScore,
      wins: row.wins,
      draws: row.draws,
      losses: row.losses,
      apx: row.apx,
      totalOccurrences: row.totalOccurrences,
      result: row.result,
    })),
    lastSuccessfulSyncAt: response.lastSuccessfulSyncAt,
    lastPublishedAt: response.lastPublishedAt,
  };
}

export async function getPortalOpenSignals(
  options?: PortalOpenSignalQueryOptions,
): Promise<PortalOpenSignal[]> {
  const snapshotState = await getPortalOpenSignalsFromSnapshot(options);

  if (snapshotState.isFresh) {
    return snapshotState.signals;
  }

  const feed = await fetchPortalApiLiveWithTimeout<PortalLiveFeedResponse>(
    buildPortalLiveFeedApiPath(options?.leagueTypes),
    {
      generatedAt: new Date().toISOString(),
      source: "stale",
      rows: [],
      buildMs: 0,
      warning: "Live-feed indisponivel.",
    },
    3_000,
  );

  if (feed.source !== "stale") {
    return filterPortalSignalsToFuture(feed.rows);
  }

  if (snapshotState.exists) {
    return snapshotState.signals;
  }

  return filterPortalSignalsToFuture(feed.rows);
}

export async function getPortalInitialOpenSignals(
  options?: PortalOpenSignalQueryOptions,
): Promise<PortalOpenSignal[]> {
  return getPortalOpenSignals(options);
}

export async function getPortalGTDisparityPlayers(): Promise<
  PortalDisparityPlayerOption[]
> {
  try {
    const rawIndex = await readFile(
      getPortalGTDisparityIndexSnapshotPath(),
      "utf8",
    );
    const snapshot = JSON.parse(rawIndex) as PortalGTDisparityIndexSnapshot;

    if (Array.isArray(snapshot.players) && snapshot.players.length > 0) {
      return snapshot.players.map((player) => ({
        id: player.id,
        name: player.name,
        totalGames: 0,
        wins: 0,
        draws: 0,
        losses: 0,
        winRate: 0,
      }));
    }
  } catch {
    // Fall back to the legacy options snapshot below.
  }

  try {
    const raw = await readFile(
      getPortalGTDisparityOptionsSnapshotPath(),
      "utf8",
    );
    const snapshot = JSON.parse(raw) as Array<{ id: string; name: string }>;

    if (Array.isArray(snapshot) && snapshot.length > 0) {
      return snapshot.map((player) => ({
        id: player.id,
        name: player.name,
        totalGames: 0,
        wins: 0,
        draws: 0,
        losses: 0,
        winRate: 0,
      }));
    }
  } catch {
    // Fallback to the API when the snapshot is not ready yet.
  }

  const options = await fetchPortalApiLiveWithTimeout<
    Array<{ id: string; name: string }>
  >("/disparity/GT/options", [], 15_000);

  if (options.length > 0) {
    return options.map((player) => ({
      id: player.id,
      name: player.name,
      totalGames: 0,
      wins: 0,
      draws: 0,
      losses: 0,
      winRate: 0,
    }));
  }

  return fetchPortalApiLiveWithTimeout<PortalDisparityPlayerOption[]>(
    "/disparity/GT",
    [],
    20_000,
  );
}

function normalizeDisparitySnapshotName(value: string) {
  return value.trim().replace(/\s+/g, " ");
}

function normalizeDisparitySnapshotKey(value: string) {
  return normalizeDisparitySnapshotName(value).toUpperCase();
}

function buildPortalGTDisparityPairFileName(
  playerOne: string,
  playerTwo: string,
) {
  const first = normalizeDisparitySnapshotKey(playerOne).replace(
    /[^A-Z0-9]+/g,
    "-",
  );
  const second = normalizeDisparitySnapshotKey(playerTwo).replace(
    /[^A-Z0-9]+/g,
    "-",
  );
  const [left, right] = [first, second].sort((a, b) => a.localeCompare(b));
  return `${left}__${right}.json`;
}

function invertDisparityResultCode(value: "1" | "2" | "E") {
  if (value === "1") {
    return "2";
  }

  if (value === "2") {
    return "1";
  }

  return "E";
}

function orientPortalGTDisparityPairResponse(
  snapshot: PortalDisparityPairResponse,
  requestedPlayerOne: string,
  requestedPlayerTwo: string,
) {
  const canonicalPlayerOneKey = normalizeDisparitySnapshotKey(
    snapshot.players.playerOne,
  );
  const canonicalPlayerTwoKey = normalizeDisparitySnapshotKey(
    snapshot.players.playerTwo,
  );
  const requestedPlayerOneKey =
    normalizeDisparitySnapshotKey(requestedPlayerOne);
  const requestedPlayerTwoKey =
    normalizeDisparitySnapshotKey(requestedPlayerTwo);

  if (
    canonicalPlayerOneKey === requestedPlayerOneKey &&
    canonicalPlayerTwoKey === requestedPlayerTwoKey
  ) {
    return snapshot;
  }

  if (
    canonicalPlayerOneKey !== requestedPlayerTwoKey ||
    canonicalPlayerTwoKey !== requestedPlayerOneKey
  ) {
    return snapshot;
  }

  return {
    ...snapshot,
    players: {
      playerOne: snapshot.players.playerTwo,
      playerTwo: snapshot.players.playerOne,
    },
    rows: snapshot.rows.map((row) => ({
      ...row,
      playerOneWins: row.playerTwoWins,
      playerTwoWins: row.playerOneWins,
      history: row.history.map((item) => ({
        ...item,
        playerOneGoals: item.playerTwoGoals,
        playerTwoGoals: item.playerOneGoals,
        resultCode: invertDisparityResultCode(item.resultCode) as
          | "1"
          | "2"
          | "E",
        scoreLabel: `${item.playerTwoGoals}-${item.playerOneGoals}`,
      })),
    })),
  };
}

export async function getPortalGTDisparityPair(
  playerOne: string,
  playerTwo: string,
): Promise<PortalDisparityPairResponse | null> {
  if (!playerOne || !playerTwo) {
    return null;
  }

  try {
    const raw = await readFile(
      resolve(
        getPortalGTDisparityPairsDirectory(),
        buildPortalGTDisparityPairFileName(playerOne, playerTwo),
      ),
      "utf8",
    );
    const snapshot = JSON.parse(raw) as PortalDisparityPairResponse;

    if (snapshot && Array.isArray(snapshot.rows)) {
      return orientPortalGTDisparityPairResponse(
        snapshot,
        playerOne,
        playerTwo,
      );
    }
  } catch {
    // Fall back to the API when the pair snapshot is not ready yet.
  }

  return fetchPortalApiLiveWithTimeout<PortalDisparityPairResponse | null>(
    `/disparity/GT/pair?player1=${encodeURIComponent(playerOne)}&player2=${encodeURIComponent(playerTwo)}`,
    null,
    20_000,
  );
}

function getPortalGTPanoramaDaySnapshotPath(dayKey: string) {
  return resolve(
    process.cwd(),
    "..",
    "api",
    "tmp",
    "portal-panorama",
    "views",
    `gt-league-${dayKey}.json`,
  );
}

export async function getPortalGTPanorama(options?: {
  dayKey?: string;
}): Promise<PortalGTPanoramaResponse | null> {
  const dayKey = options?.dayKey;

  // Tentar ler snapshot do dia específico ou o snapshot padrão (dia atual).
  try {
    const snapshotPath = dayKey
      ? getPortalGTPanoramaDaySnapshotPath(dayKey)
      : getPortalGTPanoramaSnapshotPath();
    const raw = await readFile(snapshotPath, "utf8");
    return JSON.parse(raw) as PortalGTPanoramaResponse;
  } catch {
    // Snapshot não existe, buscar via API.
  }

  const query = dayKey ? `?dayKey=${encodeURIComponent(dayKey)}` : "";

  return fetchPortalApiLiveWithTimeout<PortalGTPanoramaResponse | null>(
    `/disparity/GT/panorama${query}`,
    null,
    30_000,
  );
}

export async function getPortalGTRaioX(options?: {
  timeoutMs?: number;
}): Promise<PortalGTRaioXResponse | null> {
  try {
    const raw = await readFile(getPortalGTRaioXSnapshotPath(), "utf8");
    return JSON.parse(raw) as PortalGTRaioXResponse;
  } catch {
    // Fallback to the API when the snapshot does not exist yet.
  }

  return fetchPortalApiLiveWithTimeout<PortalGTRaioXResponse | null>(
    "/disparity/GT/xray",
    null,
    options?.timeoutMs ?? 15_000,
  );
}

export async function getPortalGTLiveTable(options?: {
  timeoutMs?: number;
  historyDays?: number;
}): Promise<PortalGTLiveTableResponse | null> {
  try {
    const raw = await readFile(
      getPortalGTLiveTableSnapshotPath(options?.historyDays),
      "utf8",
    );
    return JSON.parse(raw) as PortalGTLiveTableResponse;
  } catch {
    // Fallback to the API when the snapshot is not ready yet.
  }

  return fetchPortalApiLiveWithTimeout<PortalGTLiveTableResponse | null>(
    `/portal/gt-live-table?historyDays=${encodeURIComponent(String(options?.historyDays ?? 30))}`,
    null,
    options?.timeoutMs ?? 12_000,
  );
}
