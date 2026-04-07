import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { getDashboardLeagueCurrentJLive } from "../../core/live-analytics";
import { createLogger } from "../../core/logger";
import { MethodsService } from "../methods/methods.service";

const log = createLogger("live-feed");

type PortalLiveSignalStatus = "future" | "open" | "resolved";
type PortalLiveFeedSource = "live" | "backup-only" | "stale";

type PortalLiveFeedRow = {
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

type PortalLiveFeedResponse = {
  generatedAt: string;
  source: PortalLiveFeedSource;
  rows: PortalLiveFeedRow[];
  buildMs: number;
  warning: string | null;
};

type StoredPortalLiveFeedSnapshot = PortalLiveFeedResponse & {
  persistedAt: string;
  leagueType: string | null;
  lastSuccessfulSyncAt: string | null;
  lastPublishedAt: string | null;
  syncInProgress: boolean;
};

type AlertsLocalBackup = {
  dispatches?: AlertsLocalBackupDispatch[];
};

type AlertsLocalBackupDispatch = {
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

type StoredDispatchPayload = {
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
  };
};

type PortalLiveFeedRegistryCandidate = PortalLiveFeedRow & {
  id: string;
  status: PortalLiveSignalStatus;
  source: "alerts-backup" | "method-preview";
};

type FileStoredPortalLiveFeedRow = {
  id: string;
  signal_key: string;
  confrontation_label: string;
  league_type: string;
  method_code: string;
  series: string | null;
  player_one_name: string | null;
  player_two_name: string | null;
  apx: number;
  total_occurrences: number;
  wins: number;
  draws: number;
  losses: number;
  occurrence_played_at: string;
  local_played_at_label: string;
  confrontation_sequence: PortalLiveFeedRow["confrontationSequence"];
  player_one_day_sequence: PortalLiveFeedRow["playerOneDaySequence"];
  player_two_day_sequence: PortalLiveFeedRow["playerTwoDaySequence"];
  status: PortalLiveSignalStatus;
  source: "alerts-backup" | "method-preview";
  first_seen_at: string;
  last_seen_at: string;
  resolved_at: string | null;
  updated_at: string;
};

type PortalLiveFeedRegistryStore = {
  version: 1;
  updatedAt: string;
  lastSuccessfulSyncAt: string | null;
  lastPublishedAt: string | null;
  rows: FileStoredPortalLiveFeedRow[];
};

const methodsService = new MethodsService();

const LIVE_FEED_REFRESH_INTERVAL_MS = 30_000;
const LIVE_FEED_SIGNAL_LOOKBACK_MS = 45 * 60 * 1000;
const LIVE_FEED_SIGNAL_LOOKAHEAD_MS = 60 * 60 * 1000;
const LIVE_FEED_IN_PROGRESS_GRACE_MS = 20 * 60 * 1000;
const LIVE_FEED_METHOD_HISTORY_DAYS = 60;
const LIVE_FEED_VIEW_LEAGUES = [
  "GT LEAGUE",
  "8MIN BATTLE",
  "6MIN VOLTA",
  "H2H",
] as const;
const LIVE_FEED_PREVIEW_LEAGUES = [
  "GT LEAGUE",
  "8MIN BATTLE",
  "6MIN VOLTA",
] as const;
const LIVE_FEED_PREVIEW_METHOD_CODES = [
  "(2D+)",
  "(3D+)",
  "HC-2",
  "HC-3",
  "HC-4",
  "HC-5",
] as const;

type PreviewLeagueType = (typeof LIVE_FEED_PREVIEW_LEAGUES)[number];
type DashboardLeagueSnapshot = Awaited<
  ReturnType<typeof getDashboardLeagueCurrentJLive>
>;
type DashboardRecentMatch =
  DashboardLeagueSnapshot["players"][number]["recentMatches"][number];

let liveFeedCache: PortalLiveFeedResponse | null = null;
let liveFeedLeagueCache = new Map<string, PortalLiveFeedResponse>();
let isRefreshing = false;
let refreshTimer: NodeJS.Timeout | null = null;

function normalizeNameKey(value: string | null | undefined) {
  return (value ?? "").trim().toUpperCase();
}

function getAlertsLocalBackupPath() {
  return resolve(process.cwd(), "tmp", "alerts-backups", "latest.json");
}

function getPortalLiveFeedDirectory() {
  return resolve(process.cwd(), "tmp", "portal-live-feed");
}

function getPortalLiveFeedViewsDirectory() {
  return resolve(getPortalLiveFeedDirectory(), "views");
}

function getPortalLiveFeedSnapshotPath() {
  return resolve(getPortalLiveFeedDirectory(), "latest.json");
}

function getPortalLiveFeedRegistryPath() {
  return resolve(getPortalLiveFeedDirectory(), "registry.json");
}

function buildPortalLiveFeedLeagueFileName(leagueType: string) {
  return `${leagueType
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")}.json`;
}

function getPortalLiveFeedLeagueSnapshotPath(leagueType: string) {
  return resolve(
    getPortalLiveFeedViewsDirectory(),
    buildPortalLiveFeedLeagueFileName(leagueType),
  );
}

async function ensurePortalLiveFeedStore() {
  await mkdir(getPortalLiveFeedDirectory(), { recursive: true });
  await mkdir(getPortalLiveFeedViewsDirectory(), { recursive: true });
}

async function writeJsonAtomically(path: string, payload: unknown) {
  const tempPath = `${path}.tmp`;
  await writeFile(tempPath, JSON.stringify(payload, null, 2), "utf8");
  await rename(tempPath, path);
}

function createEmptyPortalLiveFeedRegistryStore(): PortalLiveFeedRegistryStore {
  return {
    version: 1,
    updatedAt: new Date(0).toISOString(),
    lastSuccessfulSyncAt: null,
    lastPublishedAt: null,
    rows: [],
  };
}

async function readPersistedPortalLiveFeedRegistry() {
  try {
    const raw = await readFile(getPortalLiveFeedRegistryPath(), "utf8");
    const parsed = JSON.parse(raw) as Partial<PortalLiveFeedRegistryStore>;

    return {
      version: 1,
      updatedAt:
        typeof parsed.updatedAt === "string"
          ? parsed.updatedAt
          : new Date(0).toISOString(),
      lastSuccessfulSyncAt:
        typeof parsed.lastSuccessfulSyncAt === "string"
          ? parsed.lastSuccessfulSyncAt
          : null,
      lastPublishedAt:
        typeof parsed.lastPublishedAt === "string"
          ? parsed.lastPublishedAt
          : null,
      rows: Array.isArray(parsed.rows) ? parsed.rows : [],
    } satisfies PortalLiveFeedRegistryStore;
  } catch {
    return createEmptyPortalLiveFeedRegistryStore();
  }
}

async function writePersistedPortalLiveFeedRegistry(
  store: PortalLiveFeedRegistryStore,
) {
  await ensurePortalLiveFeedStore();
  await writeJsonAtomically(getPortalLiveFeedRegistryPath(), store);
}

async function readPersistedPortalLiveFeedSnapshot(leagueType?: string) {
  try {
    const raw = await readFile(
      leagueType
        ? getPortalLiveFeedLeagueSnapshotPath(leagueType)
        : getPortalLiveFeedSnapshotPath(),
      "utf8",
    );
    const parsed = JSON.parse(raw) as StoredPortalLiveFeedSnapshot;

    return {
      generatedAt: parsed.generatedAt,
      source: parsed.source,
      rows: Array.isArray(parsed.rows) ? parsed.rows : [],
      buildMs: typeof parsed.buildMs === "number" ? parsed.buildMs : 0,
      warning:
        typeof parsed.warning === "string" || parsed.warning === null
          ? parsed.warning
          : null,
    } satisfies PortalLiveFeedResponse;
  } catch {
    return null;
  }
}

function buildSignalMergeKey(signal: PortalLiveFeedRow) {
  return [
    signal.occurrencePlayedAt,
    signal.leagueType.trim().toUpperCase(),
    signal.methodCode.trim().toUpperCase(),
    signal.confrontationLabel.trim().toUpperCase(),
    signal.series?.trim().toUpperCase() ?? "-",
  ].join("||");
}

function getSignalStatus(
  occurrencePlayedAt: string,
  options?: { resolved?: boolean },
): PortalLiveSignalStatus {
  if (options?.resolved) {
    return "resolved";
  }

  const occurrenceAtMs = new Date(occurrencePlayedAt).getTime();
  if (Number.isNaN(occurrenceAtMs)) {
    return "resolved";
  }

  const nowMs = Date.now();
  if (occurrenceAtMs > nowMs) {
    return "future";
  }

  if (occurrenceAtMs >= nowMs - LIVE_FEED_IN_PROGRESS_GRACE_MS) {
    return "open";
  }

  return "resolved";
}

function parseStoredDispatchPayload(payloadText: string) {
  try {
    return JSON.parse(payloadText) as StoredDispatchPayload;
  } catch {
    return null;
  }
}

function inferPlayersFromConfrontationLabel(confrontationLabel: string) {
  const [playerOneName, playerTwoName] = confrontationLabel
    .split(" x ")
    .map((value) => value.trim())
    .filter(Boolean);

  return [playerOneName ?? null, playerTwoName ?? null] as const;
}

function buildSequenceItemTimeLabel(playedAt: string) {
  return new Intl.DateTimeFormat("pt-BR", {
    timeStyle: "short",
    timeZone: "America/Sao_Paulo",
  }).format(new Date(playedAt));
}

function buildSequenceMatchConfrontationLabel(match: DashboardRecentMatch) {
  return `${match.homePlayer} x ${match.awayPlayer}`;
}

function buildSequenceMatchPerspective(
  match: DashboardRecentMatch,
  playerName: string,
) {
  const [homeGoalsRaw = "0", awayGoalsRaw = "0"] = match.scoreLabel.split("-");
  const homeGoals = Number(homeGoalsRaw);
  const awayGoals = Number(awayGoalsRaw);
  const isHome =
    normalizeNameKey(match.homePlayer) === normalizeNameKey(playerName);

  return {
    playerGoals: isHome ? homeGoals : awayGoals,
    opponentGoals: isHome ? awayGoals : homeGoals,
  };
}

function findRecentMatchForSequenceItem(
  item: {
    result: "W" | "D" | "L";
    localTimeLabel: string;
    scoreLabel: string;
    playerGoals: number;
    opponentGoals: number;
  },
  playerName: string,
  recentMatches: DashboardRecentMatch[],
) {
  return recentMatches.find((match) => {
    if (
      buildSequenceItemTimeLabel(match.playedAt) !== item.localTimeLabel ||
      match.scoreLabel !== item.scoreLabel ||
      match.result !== item.result
    ) {
      return false;
    }

    const perspective = buildSequenceMatchPerspective(match, playerName);
    return (
      perspective.playerGoals === item.playerGoals &&
      perspective.opponentGoals === item.opponentGoals
    );
  });
}

function repairSequenceItemsWithRecentMatches(
  items: FileStoredPortalLiveFeedRow["player_one_day_sequence"],
  playerName: string | null,
  recentMatches: DashboardRecentMatch[],
  fallbackConfrontationLabel: string,
  occurrencePlayedAt?: string,
) {
  const filteredRecentMatches =
    typeof occurrencePlayedAt === "string" && occurrencePlayedAt.length > 0
      ? recentMatches
          .filter(
            (match) =>
              new Date(match.playedAt).getTime() <
              new Date(occurrencePlayedAt).getTime(),
          )
          .sort(
            (left, right) =>
              new Date(left.playedAt).getTime() -
              new Date(right.playedAt).getTime(),
          )
      : recentMatches;

  if (!Array.isArray(items) || items.length === 0) {
    if (!playerName) {
      return [];
    }

    return filteredRecentMatches.map((match) => {
      const perspective = buildSequenceMatchPerspective(match, playerName);

      return {
        result: match.result as "W" | "D" | "L",
        localTimeLabel: buildSequenceItemTimeLabel(match.playedAt),
        scoreLabel: match.scoreLabel,
        confrontationLabel: buildSequenceMatchConfrontationLabel(match),
        playerGoals: perspective.playerGoals,
        opponentGoals: perspective.opponentGoals,
      };
    });
  }

  if (!playerName) {
    return items.map((item) => ({
      ...item,
      confrontationLabel:
        typeof item?.confrontationLabel === "string" &&
        item.confrontationLabel.trim().length > 0
          ? item.confrontationLabel
          : fallbackConfrontationLabel,
    }));
  }

  return items.map((item) => {
    if (
      typeof item?.confrontationLabel === "string" &&
      item.confrontationLabel.trim().length > 0
    ) {
      return item;
    }

    const matchedRecent = findRecentMatchForSequenceItem(
      item,
      playerName,
      filteredRecentMatches,
    );

    return {
      ...item,
      confrontationLabel: matchedRecent
        ? buildSequenceMatchConfrontationLabel(matchedRecent)
        : fallbackConfrontationLabel,
    };
  });
}

function rowNeedsSequenceRepair(row: FileStoredPortalLiveFeedRow) {
  const hasMissingLabel = (
    items:
      | FileStoredPortalLiveFeedRow["confrontation_sequence"]
      | FileStoredPortalLiveFeedRow["player_one_day_sequence"]
      | FileStoredPortalLiveFeedRow["player_two_day_sequence"],
  ) =>
    Array.isArray(items) &&
    items.some(
      (item) =>
        typeof item?.confrontationLabel !== "string" ||
        item.confrontationLabel.trim().length === 0,
    );

  return (
    hasMissingLabel(row.confrontation_sequence) ||
    hasMissingLabel(row.player_one_day_sequence) ||
    hasMissingLabel(row.player_two_day_sequence) ||
    !Array.isArray(row.player_one_day_sequence) ||
    row.player_one_day_sequence.length === 0 ||
    !Array.isArray(row.player_two_day_sequence) ||
    row.player_two_day_sequence.length === 0
  );
}

async function repairRegistryStoreSequenceLabels(
  store: PortalLiveFeedRegistryStore,
) {
  const leaguesToRepair = Array.from(
    new Set(
      store.rows
        .filter((row) => rowNeedsSequenceRepair(row))
        .map((row) => row.league_type)
        .filter((leagueType): leagueType is PreviewLeagueType =>
          LIVE_FEED_PREVIEW_LEAGUES.includes(leagueType as PreviewLeagueType),
        ),
    ),
  );

  if (leaguesToRepair.length === 0) {
    return store;
  }

  const snapshotByLeague = new Map<
    PreviewLeagueType,
    DashboardLeagueSnapshot
  >();

  await Promise.all(
    leaguesToRepair.map(async (leagueType) => {
      try {
        const snapshot = await getDashboardLeagueCurrentJLive(leagueType, {
          scope: leagueType === "6MIN VOLTA" ? "window" : "day",
        });
        snapshotByLeague.set(leagueType, snapshot);
      } catch (error) {
        log.error(
          { err: error, leagueType },
          "Falha ao reparar sequencias do live-feed",
        );
      }
    }),
  );

  if (snapshotByLeague.size === 0) {
    return store;
  }

  return {
    ...store,
    rows: store.rows.map((row) => {
      if (!rowNeedsSequenceRepair(row)) {
        return row;
      }

      const snapshot = snapshotByLeague.get(
        row.league_type as PreviewLeagueType,
      );
      if (!snapshot) {
        return row;
      }

      const recentMatchesByPlayer = new Map(
        snapshot.players.map((player) => [
          normalizeNameKey(player.name),
          player.recentMatches,
        ]),
      );

      return {
        ...row,
        confrontation_sequence: Array.isArray(row.confrontation_sequence)
          ? row.confrontation_sequence.map((item) => ({
              ...item,
              confrontationLabel:
                typeof item?.confrontationLabel === "string" &&
                item.confrontationLabel.trim().length > 0
                  ? item.confrontationLabel
                  : row.confrontation_label,
            }))
          : [],
        player_one_day_sequence: repairSequenceItemsWithRecentMatches(
          row.player_one_day_sequence,
          row.player_one_name,
          recentMatchesByPlayer.get(normalizeNameKey(row.player_one_name)) ??
            [],
          row.confrontation_label,
          row.occurrence_played_at,
        ),
        player_two_day_sequence: repairSequenceItemsWithRecentMatches(
          row.player_two_day_sequence,
          row.player_two_name,
          recentMatchesByPlayer.get(normalizeNameKey(row.player_two_name)) ??
            [],
          row.confrontation_label,
          row.occurrence_played_at,
        ),
      };
    }),
  };
}

function sequenceItemsHaveConfrontationLabel(
  items: PortalLiveFeedRow["confrontationSequence"] | undefined,
) {
  return (
    Array.isArray(items) &&
    items.some(
      (item) =>
        typeof item?.confrontationLabel === "string" &&
        item.confrontationLabel.trim().length > 0,
    )
  );
}

function pickSequenceItems(
  previousItems: PortalLiveFeedRow["confrontationSequence"] | undefined,
  nextItems: PortalLiveFeedRow["confrontationSequence"] | undefined,
) {
  if (sequenceItemsHaveConfrontationLabel(nextItems)) {
    return nextItems ?? [];
  }

  if (sequenceItemsHaveConfrontationLabel(previousItems)) {
    return previousItems ?? [];
  }

  if (Array.isArray(nextItems) && nextItems.length > 0) {
    return nextItems;
  }

  return previousItems ?? [];
}

function buildRootSignalKey(
  dispatch: AlertsLocalBackupDispatch,
  payload: StoredDispatchPayload | null,
) {
  return (
    payload?.signal?.rootSignalKey ??
    payload?.rootSignalKey ??
    dispatch.signalKey.replace(/::resolved$/u, "")
  );
}

function toRegistryCandidate(
  row: PortalLiveFeedRow,
  source: PortalLiveFeedRegistryCandidate["source"],
  status: PortalLiveSignalStatus,
): PortalLiveFeedRegistryCandidate {
  return {
    ...row,
    id: buildSignalMergeKey(row),
    source,
    status,
  };
}

async function loadBackupSignalCandidates(): Promise<
  PortalLiveFeedRegistryCandidate[]
> {
  try {
    const backupRaw = await readFile(getAlertsLocalBackupPath(), "utf8");
    const backup = JSON.parse(backupRaw) as AlertsLocalBackup;
    const dispatches = Array.isArray(backup.dispatches)
      ? backup.dispatches
      : [];
    const nowMs = Date.now();
    const windowStartMs = nowMs - LIVE_FEED_SIGNAL_LOOKBACK_MS;
    const windowEndMs = nowMs + LIVE_FEED_SIGNAL_LOOKAHEAD_MS;
    const resolvedRootSignalKeys = new Set<string>();

    for (const dispatch of dispatches) {
      const payload = parseStoredDispatchPayload(dispatch.payloadText);
      const rootSignalKey = buildRootSignalKey(dispatch, payload);
      const eventType = payload?.eventType ?? dispatch.eventType ?? "";

      if (
        eventType === "result_followup" ||
        dispatch.signalKey.endsWith("::resolved")
      ) {
        resolvedRootSignalKeys.add(rootSignalKey);
      }
    }

    const rows = new Map<string, PortalLiveFeedRegistryCandidate>();

    for (const dispatch of dispatches) {
      if (!["sent", "skipped"].includes(dispatch.transportStatus)) {
        continue;
      }

      const payload = parseStoredDispatchPayload(dispatch.payloadText);
      const rootSignalKey = buildRootSignalKey(dispatch, payload);
      const eventType = payload?.eventType ?? dispatch.eventType ?? "";
      const occurrencePlayedAt =
        payload?.signal?.occurrencePlayedAt ?? dispatch.occurrencePlayedAt;
      const occurrenceAtMs = new Date(occurrencePlayedAt).getTime();

      if (
        Number.isNaN(occurrenceAtMs) ||
        occurrenceAtMs < windowStartMs ||
        occurrenceAtMs > windowEndMs
      ) {
        continue;
      }

      const row: PortalLiveFeedRow = {
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
          inferPlayersFromConfrontationLabel(
            payload?.signal?.confrontationLabel ?? dispatch.confrontationLabel,
          )[0] ?? null,
        playerTwoName:
          inferPlayersFromConfrontationLabel(
            payload?.signal?.confrontationLabel ?? dispatch.confrontationLabel,
          )[1] ?? null,
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

      const candidate = toRegistryCandidate(
        row,
        "alerts-backup",
        getSignalStatus(occurrencePlayedAt, {
          resolved:
            eventType === "result_followup" ||
            dispatch.signalKey.endsWith("::resolved") ||
            resolvedRootSignalKeys.has(rootSignalKey),
        }),
      );

      rows.set(candidate.id, candidate);
    }

    return Array.from(rows.values());
  } catch {
    return [];
  }
}

async function loadPreviewSignalCandidatesForLeague(
  leagueType: (typeof LIVE_FEED_PREVIEW_LEAGUES)[number],
): Promise<PortalLiveFeedRegistryCandidate[]> {
  const response = await methodsService.getFutureConfrontationMethods(
    leagueType,
    {
      methodCodes: [...LIVE_FEED_PREVIEW_METHOD_CODES],
      days: LIVE_FEED_METHOD_HISTORY_DAYS,
      includePlayerStats: false,
    },
  );

  return response.rows.map((row) =>
    toRegistryCandidate(
      {
        signalKey: `METHOD_PREVIEW::${row.fixtureId}::${row.methodCode}::${row.confrontationKey}`,
        confrontationLabel: row.confrontationLabel,
        leagueType: row.leagueType,
        methodCode: row.methodCode,
        series: row.groupLabel,
        playerOneName: row.playerName,
        playerTwoName: row.opponentName,
        apx: row.apx,
        totalOccurrences: row.totalOccurrences,
        wins: row.wins,
        draws: row.draws,
        losses: row.losses,
        occurrencePlayedAt: row.playedAtIso,
        localPlayedAtLabel: row.localPlayedAtLabel,
        confrontationSequence: Array.isArray(row.confrontationSequenceDetails)
          ? row.confrontationSequenceDetails
          : [],
        playerOneDaySequence: Array.isArray(row.playerOneDaySequence)
          ? row.playerOneDaySequence
          : [],
        playerTwoDaySequence: Array.isArray(row.playerTwoDaySequence)
          ? row.playerTwoDaySequence
          : [],
      },
      "method-preview",
      getSignalStatus(row.playedAtIso),
    ),
  );
}

async function loadCurrentLiveFeedCandidates() {
  const backupRows = await loadBackupSignalCandidates();
  const previewResults = await Promise.allSettled(
    LIVE_FEED_PREVIEW_LEAGUES.map((leagueType) =>
      loadPreviewSignalCandidatesForLeague(leagueType),
    ),
  );

  const previewRows: PortalLiveFeedRegistryCandidate[] = [];
  const failedLeagues: string[] = [];

  previewResults.forEach((result, index) => {
    if (result.status === "fulfilled") {
      previewRows.push(...result.value);
      return;
    }

    failedLeagues.push(LIVE_FEED_PREVIEW_LEAGUES[index]);
    log.error(
      { err: result.reason, league: LIVE_FEED_PREVIEW_LEAGUES[index] },
      "Falha ao carregar preview da liga no live-feed",
    );
  });

  const rows = new Map<string, PortalLiveFeedRegistryCandidate>();

  for (const row of previewRows) {
    rows.set(row.id, row);
  }

  for (const row of backupRows) {
    const previous = rows.get(row.id);
    rows.set(
      row.id,
      previous
        ? {
            ...row,
            confrontationSequence: pickSequenceItems(
              previous.confrontationSequence,
              row.confrontationSequence,
            ),
            playerOneDaySequence: pickSequenceItems(
              previous.playerOneDaySequence,
              row.playerOneDaySequence,
            ),
            playerTwoDaySequence: pickSequenceItems(
              previous.playerTwoDaySequence,
              row.playerTwoDaySequence,
            ),
            playerOneName: previous.playerOneName ?? row.playerOneName,
            playerTwoName: previous.playerTwoName ?? row.playerTwoName,
          }
        : row,
    );
  }

  return {
    rows: Array.from(rows.values()),
    failedLeagues,
    warning:
      failedLeagues.length > 0
        ? `Preview parcial indisponivel para: ${failedLeagues.join(", ")}.`
        : null,
  };
}

function shouldKeepRegistryRow(
  row: Pick<FileStoredPortalLiveFeedRow, "occurrence_played_at" | "status">,
) {
  const playedAtMs = new Date(row.occurrence_played_at).getTime();
  if (Number.isNaN(playedAtMs)) {
    return false;
  }

  const nowMs = Date.now();
  const windowStartMs = nowMs - LIVE_FEED_SIGNAL_LOOKBACK_MS;
  const windowEndMs = nowMs + LIVE_FEED_SIGNAL_LOOKAHEAD_MS;

  if (playedAtMs < windowStartMs || playedAtMs > windowEndMs) {
    return false;
  }

  return true;
}

function mergeRegistryStore(
  previousStore: PortalLiveFeedRegistryStore,
  candidates: PortalLiveFeedRegistryCandidate[],
) {
  const nowIso = new Date().toISOString();
  const previousRows = new Map(previousStore.rows.map((row) => [row.id, row]));
  const nextRows: FileStoredPortalLiveFeedRow[] = [];

  for (const candidate of candidates) {
    const previous = previousRows.get(candidate.id);
    previousRows.delete(candidate.id);

    nextRows.push({
      id: candidate.id,
      signal_key: candidate.signalKey,
      confrontation_label: candidate.confrontationLabel,
      league_type: candidate.leagueType,
      method_code: candidate.methodCode,
      series: candidate.series,
      player_one_name: candidate.playerOneName,
      player_two_name: candidate.playerTwoName,
      apx: candidate.apx,
      total_occurrences: candidate.totalOccurrences,
      wins: candidate.wins,
      draws: candidate.draws,
      losses: candidate.losses,
      occurrence_played_at: candidate.occurrencePlayedAt,
      local_played_at_label: candidate.localPlayedAtLabel,
      confrontation_sequence: candidate.confrontationSequence,
      player_one_day_sequence: candidate.playerOneDaySequence,
      player_two_day_sequence: candidate.playerTwoDaySequence,
      status: candidate.status,
      source: candidate.source,
      first_seen_at: previous?.first_seen_at ?? nowIso,
      last_seen_at: nowIso,
      resolved_at:
        candidate.status === "resolved"
          ? (previous?.resolved_at ?? nowIso)
          : null,
      updated_at: nowIso,
    });
  }

  for (const previous of previousRows.values()) {
    const nextStatus = getSignalStatus(previous.occurrence_played_at, {
      resolved: previous.status === "resolved",
    });
    const carried: FileStoredPortalLiveFeedRow = {
      ...previous,
      status: nextStatus,
      resolved_at:
        nextStatus === "resolved" ? (previous.resolved_at ?? nowIso) : null,
      updated_at: nextStatus !== previous.status ? nowIso : previous.updated_at,
    };

    if (shouldKeepRegistryRow(carried)) {
      nextRows.push(carried);
    }
  }

  return {
    version: 1,
    updatedAt: nowIso,
    lastSuccessfulSyncAt: previousStore.lastSuccessfulSyncAt,
    lastPublishedAt: previousStore.lastPublishedAt,
    rows: nextRows
      .filter((row) => shouldKeepRegistryRow(row))
      .sort(
        (left, right) =>
          new Date(left.occurrence_played_at).getTime() -
            new Date(right.occurrence_played_at).getTime() ||
          left.confrontation_label.localeCompare(
            right.confrontation_label,
            "pt-BR",
            { sensitivity: "base" },
          ),
      ),
  } satisfies PortalLiveFeedRegistryStore;
}

function sortLiveFeedRows(rows: PortalLiveFeedRow[]) {
  return rows.sort(
    (left, right) =>
      new Date(left.occurrencePlayedAt).getTime() -
        new Date(right.occurrencePlayedAt).getTime() ||
      left.confrontationLabel.localeCompare(right.confrontationLabel, "pt-BR", {
        sensitivity: "base",
      }),
  );
}

function mapRegistryRowToLiveFeedRow(
  row: FileStoredPortalLiveFeedRow,
): PortalLiveFeedRow {
  const normalizeSequenceItems = (
    items: FileStoredPortalLiveFeedRow["confrontation_sequence"],
  ) =>
    Array.isArray(items)
      ? items.map((item) => ({
          ...item,
          confrontationLabel:
            typeof item?.confrontationLabel === "string" &&
            item.confrontationLabel.trim().length > 0
              ? item.confrontationLabel
              : row.confrontation_label,
        }))
      : [];

  return {
    signalKey: row.signal_key,
    confrontationLabel: row.confrontation_label,
    leagueType: row.league_type,
    methodCode: row.method_code,
    series: row.series,
    playerOneName: row.player_one_name ?? null,
    playerTwoName: row.player_two_name ?? null,
    apx: row.apx,
    totalOccurrences: row.total_occurrences,
    wins: row.wins,
    draws: row.draws,
    losses: row.losses,
    occurrencePlayedAt: row.occurrence_played_at,
    localPlayedAtLabel: row.local_played_at_label,
    confrontationSequence: normalizeSequenceItems(row.confrontation_sequence),
    playerOneDaySequence: normalizeSequenceItems(row.player_one_day_sequence),
    playerTwoDaySequence: normalizeSequenceItems(row.player_two_day_sequence),
  };
}

function buildLiveFeedResponseFromRegistry(
  store: PortalLiveFeedRegistryStore,
  options?: {
    leagueType?: string;
    source?: PortalLiveFeedSource;
    buildMs?: number;
    warning?: string | null;
  },
): PortalLiveFeedResponse {
  const activeRows = store.rows.filter(
    (row) =>
      row.status !== "resolved" &&
      (!options?.leagueType || row.league_type === options.leagueType),
  );

  return {
    generatedAt: store.lastPublishedAt ?? store.updatedAt,
    source: options?.source ?? "live",
    rows: sortLiveFeedRows(activeRows.map(mapRegistryRowToLiveFeedRow)),
    buildMs: options?.buildMs ?? 0,
    warning: options?.warning ?? null,
  };
}

function buildCombinedLiveFeedResponse(
  views: PortalLiveFeedResponse[],
  fallback: PortalLiveFeedResponse,
): PortalLiveFeedResponse {
  if (views.length === 0) {
    return fallback;
  }

  return {
    generatedAt:
      views
        .map((view) => view.generatedAt)
        .sort()
        .at(-1) ?? fallback.generatedAt,
    source: views.some((view) => view.source === "live")
      ? "live"
      : fallback.source,
    rows: sortLiveFeedRows(
      views
        .flatMap((view) => view.rows)
        .filter((row, index, sourceRows) => {
          const rowKey = buildSignalMergeKey(row);
          return (
            sourceRows.findIndex(
              (candidate) => buildSignalMergeKey(candidate) === rowKey,
            ) === index
          );
        }),
    ),
    buildMs: views.reduce((total, view) => total + view.buildMs, 0),
    warning: views.find((view) => view.warning)?.warning ?? fallback.warning,
  };
}

async function publishPortalLiveFeedSnapshots(
  store: PortalLiveFeedRegistryStore,
  options?: {
    source?: PortalLiveFeedSource;
    buildMs?: number;
    warning?: string | null;
    failedLeagues?: string[];
  },
) {
  await ensurePortalLiveFeedStore();

  const publishedAt = new Date().toISOString();
  const lastSuccessfulSyncAt = store.lastSuccessfulSyncAt;
  const failedLeagueSet = new Set(options?.failedLeagues ?? []);
  const leagueEntries = [] as Array<{
    leagueType: string;
    response: PortalLiveFeedResponse;
    preservedFromCache: boolean;
  }>;

  for (const leagueType of LIVE_FEED_VIEW_LEAGUES) {
    if (failedLeagueSet.has(leagueType)) {
      const preservedSnapshot =
        liveFeedLeagueCache.get(leagueType) ??
        (await readPersistedPortalLiveFeedSnapshot(leagueType));

      if (preservedSnapshot) {
        leagueEntries.push({
          leagueType,
          response: preservedSnapshot,
          preservedFromCache: true,
        });
        continue;
      }
    }

    const response = buildLiveFeedResponseFromRegistry(store, {
      leagueType,
      source: options?.source ?? "live",
      buildMs: options?.buildMs ?? 0,
      warning: options?.warning ?? null,
    });

    leagueEntries.push({
      leagueType,
      response,
      preservedFromCache: false,
    });
  }

  const combinedResponse = buildCombinedLiveFeedResponse(
    leagueEntries.map((entry) => entry.response),
    buildLiveFeedResponseFromRegistry(store, {
      source: options?.source ?? "live",
      buildMs: options?.buildMs ?? 0,
      warning: options?.warning ?? null,
    }),
  );

  for (const entry of leagueEntries) {
    if (entry.preservedFromCache) {
      continue;
    }

    const payload: StoredPortalLiveFeedSnapshot = {
      ...entry.response,
      persistedAt: publishedAt,
      leagueType: entry.leagueType,
      lastSuccessfulSyncAt,
      lastPublishedAt: publishedAt,
      syncInProgress: isRefreshing,
    };
    await writeJsonAtomically(
      getPortalLiveFeedLeagueSnapshotPath(entry.leagueType),
      payload,
    );
  }

  await writeJsonAtomically(getPortalLiveFeedSnapshotPath(), {
    ...combinedResponse,
    persistedAt: publishedAt,
    leagueType: null,
    lastSuccessfulSyncAt,
    lastPublishedAt: publishedAt,
    syncInProgress: isRefreshing,
  } satisfies StoredPortalLiveFeedSnapshot);

  liveFeedCache = combinedResponse;
  liveFeedLeagueCache = new Map(
    leagueEntries.map((entry) => [entry.leagueType, entry.response]),
  );

  return {
    store: {
      ...store,
      lastPublishedAt: publishedAt,
    } satisfies PortalLiveFeedRegistryStore,
    combinedResponse,
  };
}

async function hydratePortalLiveFeedCache() {
  if (!liveFeedCache) {
    liveFeedCache = await readPersistedPortalLiveFeedSnapshot();
  }

  if (liveFeedLeagueCache.size === 0) {
    const nextCache = new Map<string, PortalLiveFeedResponse>();

    for (const leagueType of LIVE_FEED_VIEW_LEAGUES) {
      const snapshot = await readPersistedPortalLiveFeedSnapshot(leagueType);
      if (snapshot) {
        nextCache.set(leagueType, snapshot);
      }
    }

    liveFeedLeagueCache = nextCache;
  }

  if (liveFeedCache) {
    return liveFeedCache;
  }

  const backupRows = await loadBackupSignalCandidates();
  const initialStore = mergeRegistryStore(
    createEmptyPortalLiveFeedRegistryStore(),
    backupRows,
  );
  const published = await publishPortalLiveFeedSnapshots(initialStore, {
    source: "backup-only",
    buildMs: 0,
    warning:
      backupRows.length > 0
        ? null
        : "Live-feed aguardando primeira atualizacao em background.",
  });

  await writePersistedPortalLiveFeedRegistry(published.store);
  return published.combinedResponse;
}

async function readLeagueViewsFromCacheOrDisk(leagueTypes: string[]) {
  const views: PortalLiveFeedResponse[] = [];

  for (const leagueType of leagueTypes) {
    const cached = liveFeedLeagueCache.get(leagueType);
    if (cached) {
      views.push(cached);
      continue;
    }

    const snapshot = await readPersistedPortalLiveFeedSnapshot(leagueType);
    if (snapshot) {
      liveFeedLeagueCache.set(leagueType, snapshot);
      views.push(snapshot);
    }
  }

  return views;
}

async function refreshLiveFeed() {
  if (isRefreshing) {
    return liveFeedCache;
  }

  isRefreshing = true;
  const startedAt = Date.now();

  try {
    const previousStore = await readPersistedPortalLiveFeedRegistry();
    const currentSync = await loadCurrentLiveFeedCandidates();

    let nextStore = mergeRegistryStore(previousStore, currentSync.rows);
    nextStore = await repairRegistryStoreSequenceLabels(nextStore);
    nextStore = {
      ...nextStore,
      lastSuccessfulSyncAt: new Date().toISOString(),
    };

    const published = await publishPortalLiveFeedSnapshots(nextStore, {
      source: "live",
      buildMs: Date.now() - startedAt,
      failedLeagues: currentSync.failedLeagues,
      warning: currentSync.warning,
    });

    await writePersistedPortalLiveFeedRegistry(published.store);
    return published.combinedResponse;
  } catch (error) {
    log.error({ err: error }, "Falha ao atualizar live-feed do portal");

    if (liveFeedCache) {
      liveFeedCache = {
        ...liveFeedCache,
        source: "stale",
        warning: "Live-feed mantido em cache por falha na atualizacao.",
      };
      return liveFeedCache;
    }

    const stale = {
      generatedAt: new Date().toISOString(),
      source: "stale",
      rows: [],
      buildMs: Date.now() - startedAt,
      warning: "Live-feed indisponivel na primeira carga.",
    } satisfies PortalLiveFeedResponse;
    liveFeedCache = stale;
    return stale;
  } finally {
    isRefreshing = false;
  }
}

export async function getPortalLiveFeed(options?: { leagueTypes?: string[] }) {
  await hydratePortalLiveFeedCache();

  const requestedLeagueTypes = Array.from(
    new Set(
      (options?.leagueTypes ?? [])
        .map((leagueType) => leagueType.trim())
        .filter(Boolean),
    ),
  );

  if (requestedLeagueTypes.length === 0) {
    return liveFeedCache;
  }

  const leagueViews =
    await readLeagueViewsFromCacheOrDisk(requestedLeagueTypes);
  if (leagueViews.length === 0) {
    return {
      generatedAt: liveFeedCache?.generatedAt ?? new Date().toISOString(),
      source: liveFeedCache?.source ?? "stale",
      rows: [],
      buildMs: 0,
      warning: liveFeedCache?.warning ?? null,
    } satisfies PortalLiveFeedResponse;
  }

  return buildCombinedLiveFeedResponse(
    leagueViews,
    liveFeedCache ?? {
      generatedAt: new Date().toISOString(),
      source: "stale",
      rows: [],
      buildMs: 0,
      warning: null,
    },
  );
}

export function triggerPortalLiveFeedRefresh() {
  if (isRefreshing) {
    return;
  }

  void refreshLiveFeed();
}

export function startPortalLiveFeedRunner() {
  if (refreshTimer) {
    return;
  }

  const scheduleNextRun = () => {
    refreshTimer = setTimeout(async () => {
      void refreshLiveFeed();
      scheduleNextRun();
    }, LIVE_FEED_REFRESH_INTERVAL_MS);
  };

  void hydratePortalLiveFeedCache();
  void refreshLiveFeed();
  scheduleNextRun();

  log.info(
    { intervalMs: LIVE_FEED_REFRESH_INTERVAL_MS },
    "Live-feed do portal ativo",
  );
}
