import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { getGtLeagueLiveTable } from "../../core/live-analytics";
import { createLogger } from "../../core/logger";

const log = createLogger("gt-live-table");

type PortalGTLiveTableSnapshot = {
  generatedAt: string;
  leagueType: string;
  liveWindowMinutes: number;
  historyDays: number;
  dayKey: string;
  dayLabel: string;
  scorelines: string[];
  totalLiveFixtures: number;
  rows: unknown[];
  upcomingRows: unknown[];
  source: "live" | "backup-only" | "stale";
  warning: string | null;
  lastSuccessfulSyncAt: string | null;
  lastPublishedAt: string | null;
  syncInProgress: boolean;
};

const GT_LIVE_TABLE_REFRESH_INTERVAL_MS = 30_000;
const GT_LIVE_TABLE_DEFAULT_WINDOW_MINUTES = 20;
const GT_LIVE_TABLE_HISTORY_DAY_OPTIONS = [5, 15, 30] as const;
const GT_LIVE_TABLE_DEFAULT_HISTORY_DAYS = 30;
const GT_LIVE_TABLE_DEFAULT_SCORELINES = [
  "0-0",
  "1-1",
  "2-2",
  "3-3",
  "1-0",
  "2-0",
  "2-1",
  "3-0",
  "3-2",
  "3-1",
  "0-1",
  "0-2",
  "1-2",
  "0-3",
  "2-3",
  "1-3",
] as const;

let gtLiveTableCache = new Map<number, PortalGTLiveTableSnapshot>();
let gtLiveTableRefreshTimer: NodeJS.Timeout | null = null;
let gtLiveTableSyncInProgress = new Map<number, boolean>();

function isGtLiveTableSyncInProgress(historyDays?: number) {
  return gtLiveTableSyncInProgress.get(
    normalizeGtLiveTableHistoryDays(historyDays),
  );
}

function setGtLiveTableSyncInProgress(
  historyDays: number,
  isInProgress: boolean,
) {
  gtLiveTableSyncInProgress.set(historyDays, isInProgress);
}

function normalizeGtLiveTableHistoryDays(value?: number | null) {
  return GT_LIVE_TABLE_HISTORY_DAY_OPTIONS.includes(
    value as (typeof GT_LIVE_TABLE_HISTORY_DAY_OPTIONS)[number],
  )
    ? (value as (typeof GT_LIVE_TABLE_HISTORY_DAY_OPTIONS)[number])
    : GT_LIVE_TABLE_DEFAULT_HISTORY_DAYS;
}

function getPortalGTLiveTableDirectory() {
  return resolve(process.cwd(), "tmp", "portal-gt-live-table");
}

function getPortalGTLiveTableSnapshotPath(historyDays?: number) {
  const normalizedHistoryDays = normalizeGtLiveTableHistoryDays(historyDays);
  return resolve(
    getPortalGTLiveTableDirectory(),
    normalizedHistoryDays === GT_LIVE_TABLE_DEFAULT_HISTORY_DAYS
      ? "latest.json"
      : `latest-${normalizedHistoryDays}.json`,
  );
}

async function ensurePortalGTLiveTableStore() {
  await mkdir(getPortalGTLiveTableDirectory(), { recursive: true });
}

async function writeJsonAtomically(path: string, payload: unknown) {
  const tempPath = `${path}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(tempPath, JSON.stringify(payload, null, 2), "utf8");
  await rename(tempPath, path);
}

function createEmptyPortalGTLiveTableSnapshot(
  overrides?: Partial<PortalGTLiveTableSnapshot>,
): PortalGTLiveTableSnapshot {
  const normalizedHistoryDays = normalizeGtLiveTableHistoryDays(
    overrides?.historyDays,
  );
  const now = new Date();
  const fallbackDayKey = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
  }).format(now);
  const fallbackDayLabel = new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "short",
    timeZone: "America/Sao_Paulo",
  }).format(now);

  return {
    generatedAt: new Date().toISOString(),
    leagueType: "GT LEAGUE",
    liveWindowMinutes: GT_LIVE_TABLE_DEFAULT_WINDOW_MINUTES,
    historyDays: normalizedHistoryDays,
    dayKey: fallbackDayKey,
    dayLabel: fallbackDayLabel,
    scorelines: [...GT_LIVE_TABLE_DEFAULT_SCORELINES],
    totalLiveFixtures: 0,
    rows: [],
    upcomingRows: [],
    source: "backup-only",
    warning: "Leitura da GT League aguardando a primeira atualizacao.",
    lastSuccessfulSyncAt: null,
    lastPublishedAt: null,
    syncInProgress: Boolean(isGtLiveTableSyncInProgress(normalizedHistoryDays)),
    ...overrides,
  };
}

function normalizePortalGTLiveTableSnapshot(
  payload: Partial<PortalGTLiveTableSnapshot>,
): PortalGTLiveTableSnapshot {
  const normalizedHistoryDays =
    typeof payload.historyDays === "number"
      ? normalizeGtLiveTableHistoryDays(payload.historyDays)
      : GT_LIVE_TABLE_DEFAULT_HISTORY_DAYS;

  return createEmptyPortalGTLiveTableSnapshot({
    generatedAt:
      typeof payload.generatedAt === "string"
        ? payload.generatedAt
        : new Date().toISOString(),
    leagueType:
      typeof payload.leagueType === "string" ? payload.leagueType : "GT LEAGUE",
    liveWindowMinutes:
      typeof payload.liveWindowMinutes === "number"
        ? payload.liveWindowMinutes
        : GT_LIVE_TABLE_DEFAULT_WINDOW_MINUTES,
    historyDays: normalizedHistoryDays,
    ...(typeof payload.dayKey === "string" && payload.dayKey.length > 0
      ? { dayKey: payload.dayKey }
      : {}),
    ...(typeof payload.dayLabel === "string" && payload.dayLabel.length > 0
      ? { dayLabel: payload.dayLabel }
      : {}),
    scorelines: Array.isArray(payload.scorelines)
      ? payload.scorelines.filter(
          (item): item is string => typeof item === "string",
        )
      : [...GT_LIVE_TABLE_DEFAULT_SCORELINES],
    totalLiveFixtures:
      typeof payload.totalLiveFixtures === "number"
        ? payload.totalLiveFixtures
        : Array.isArray(payload.rows)
          ? payload.rows.length
          : 0,
    rows: Array.isArray(payload.rows) ? payload.rows : [],
    upcomingRows: Array.isArray(payload.upcomingRows)
      ? payload.upcomingRows
      : [],
    source:
      payload.source === "live" ||
      payload.source === "backup-only" ||
      payload.source === "stale"
        ? payload.source
        : "backup-only",
    warning:
      typeof payload.warning === "string" || payload.warning === null
        ? payload.warning
        : null,
    lastSuccessfulSyncAt:
      typeof payload.lastSuccessfulSyncAt === "string"
        ? payload.lastSuccessfulSyncAt
        : null,
    lastPublishedAt:
      typeof payload.lastPublishedAt === "string"
        ? payload.lastPublishedAt
        : null,
    syncInProgress:
      typeof payload.syncInProgress === "boolean"
        ? payload.syncInProgress
        : Boolean(isGtLiveTableSyncInProgress(normalizedHistoryDays)),
  });
}

async function readPersistedPortalGTLiveTableSnapshot(historyDays?: number) {
  try {
    const raw = await readFile(
      getPortalGTLiveTableSnapshotPath(historyDays),
      "utf8",
    );
    return normalizePortalGTLiveTableSnapshot(
      JSON.parse(raw) as Partial<PortalGTLiveTableSnapshot>,
    );
  } catch {
    return null;
  }
}

async function publishPortalGTLiveTableSnapshot(
  snapshot: PortalGTLiveTableSnapshot,
) {
  await ensurePortalGTLiveTableStore();
  const publishedAt = new Date().toISOString();
  const normalizedHistoryDays = normalizeGtLiveTableHistoryDays(
    snapshot.historyDays,
  );
  const nextSnapshot = normalizePortalGTLiveTableSnapshot({
    ...snapshot,
    historyDays: normalizedHistoryDays,
    lastPublishedAt: publishedAt,
    syncInProgress: Boolean(isGtLiveTableSyncInProgress(normalizedHistoryDays)),
  });

  await writeJsonAtomically(
    getPortalGTLiveTableSnapshotPath(nextSnapshot.historyDays),
    nextSnapshot,
  );

  if (nextSnapshot.historyDays === GT_LIVE_TABLE_DEFAULT_HISTORY_DAYS) {
    await writeJsonAtomically(getPortalGTLiveTableSnapshotPath(), nextSnapshot);
  }

  gtLiveTableCache.set(nextSnapshot.historyDays, nextSnapshot);
  return nextSnapshot;
}

async function hydratePortalGTLiveTableSnapshot(historyDays?: number) {
  const normalizedHistoryDays = normalizeGtLiveTableHistoryDays(historyDays);
  const cached = gtLiveTableCache.get(normalizedHistoryDays);
  if (cached) {
    return cached;
  }

  const persisted = await readPersistedPortalGTLiveTableSnapshot(
    normalizedHistoryDays,
  );
  if (persisted) {
    gtLiveTableCache.set(normalizedHistoryDays, persisted);
    return persisted;
  }

  const initialSnapshot = createEmptyPortalGTLiveTableSnapshot({
    historyDays: normalizedHistoryDays,
  });
  return publishPortalGTLiveTableSnapshot(initialSnapshot);
}

async function refreshPortalGTLiveTableInternal(historyDays?: number) {
  const normalizedHistoryDays = normalizeGtLiveTableHistoryDays(historyDays);

  if (isGtLiveTableSyncInProgress(normalizedHistoryDays)) {
    return (
      gtLiveTableCache.get(normalizedHistoryDays) ??
      hydratePortalGTLiveTableSnapshot(normalizedHistoryDays)
    );
  }

  setGtLiveTableSyncInProgress(normalizedHistoryDays, true);

  try {
    const livePayload = await Promise.race([
      getGtLeagueLiveTable({
        historyDays: normalizedHistoryDays,
      }) as Promise<Partial<PortalGTLiveTableSnapshot>>,
      new Promise<never>((_, reject) =>
        setTimeout(
          () => reject(new Error("gt-live-table refresh timeout (180s)")),
          180_000,
        ),
      ),
    ]);

    const published = await publishPortalGTLiveTableSnapshot(
      normalizePortalGTLiveTableSnapshot({
        ...livePayload,
        source: "live",
        warning: null,
        historyDays: normalizedHistoryDays,
        lastSuccessfulSyncAt: new Date().toISOString(),
        syncInProgress: false,
      }),
    );

    log.info(
      {
        historyDays: normalizedHistoryDays,
        rows: published.rows.length,
        upcoming: published.upcomingRows.length,
      },
      "refresh ok",
    );

    return published;
  } catch (error) {
    log.error(
      { err: error },
      "Falha ao atualizar GT League live table do portal",
    );

    const persisted = await hydratePortalGTLiveTableSnapshot(
      normalizedHistoryDays,
    );
    const staleSnapshot = normalizePortalGTLiveTableSnapshot({
      ...persisted,
      source: "stale",
      warning:
        persisted.rows.length > 0
          ? "Leitura da GT League mantida pelo ultimo snapshot valido."
          : "Leitura da GT League indisponivel neste momento.",
      syncInProgress: false,
    });

    await publishPortalGTLiveTableSnapshot(staleSnapshot);
    return staleSnapshot;
  } finally {
    setGtLiveTableSyncInProgress(normalizedHistoryDays, false);
  }
}

async function runPortalGTLiveTableRefreshSafely(historyDays?: number) {
  try {
    await refreshPortalGTLiveTableInternal(historyDays);
  } catch (error) {
    log.error(
      { err: error },
      "Falha nao tratada no refresh do GT League live table",
    );
  }
}

export async function getPortalGTLiveTableSnapshot(options?: {
  historyDays?: number;
}) {
  return hydratePortalGTLiveTableSnapshot(options?.historyDays);
}

const GT_LIVE_TABLE_STALE_THRESHOLD_MS = 60_000;

export async function getPortalGTLiveTableFresh(options?: {
  historyDays?: number;
}): Promise<PortalGTLiveTableSnapshot> {
  const cached = await hydratePortalGTLiveTableSnapshot(options?.historyDays);
  const age = Date.now() - new Date(cached.generatedAt).getTime();

  if (age < GT_LIVE_TABLE_STALE_THRESHOLD_MS && cached.source === "live") {
    return cached;
  }

  try {
    return await refreshPortalGTLiveTableInternal(options?.historyDays);
  } catch {
    return cached;
  }
}

export function triggerPortalGTLiveTableRefresh(options?: {
  historyDays?: number;
}) {
  if (isGtLiveTableSyncInProgress(options?.historyDays)) {
    return;
  }

  void runPortalGTLiveTableRefreshSafely(options?.historyDays);
}

export function startPortalGTLiveTableRunner() {
  if (gtLiveTableRefreshTimer) {
    return;
  }

  const scheduleNextRun = () => {
    gtLiveTableRefreshTimer = setTimeout(() => {
      void (async () => {
        for (const historyDays of GT_LIVE_TABLE_HISTORY_DAY_OPTIONS) {
          await runPortalGTLiveTableRefreshSafely(historyDays);
        }
      })();
      scheduleNextRun();
    }, GT_LIVE_TABLE_REFRESH_INTERVAL_MS);
  };

  void (async () => {
    for (const historyDays of GT_LIVE_TABLE_HISTORY_DAY_OPTIONS) {
      await hydratePortalGTLiveTableSnapshot(historyDays);
      await runPortalGTLiveTableRefreshSafely(historyDays);
    }
  })();

  scheduleNextRun();

  log.info(
    { intervalMs: GT_LIVE_TABLE_REFRESH_INTERVAL_MS },
    "GT League live table do portal ativa",
  );
}
