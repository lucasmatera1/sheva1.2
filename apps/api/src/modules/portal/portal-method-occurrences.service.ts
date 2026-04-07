import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { Prisma } from "@prisma/client";
import { createLogger } from "../../core/logger";
import {
  getConfrontationMethodOccurrenceRecordsLive,
  type ConfrontationMethodCode,
  type ConfrontationMethodsLeagueType,
  type ConfrontationMethodOccurrenceRecord,
} from "../../core/live-analytics";
import { prisma } from "../../core/prisma";

const log = createLogger("method-occurrences");

type PortalMethodCatalogSeed = {
  leagueType: ConfrontationMethodsLeagueType;
  code: ConfrontationMethodCode;
  label: string;
  family: "confrontation";
  status: "active" | "planned" | "disabled";
  syncEnabled: boolean;
  sortOrder: number;
};

type PortalMethodCatalogRow = {
  id: string;
  leagueType: string;
  code: string;
  label: string;
  family: string;
  status: string;
  syncEnabled: boolean;
  sortOrder: number;
  updatedAt: string;
};

export type PortalMethodOccurrenceRow = {
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
};

type PortalMethodOccurrencesResponse = {
  generatedAt: string;
  source: "database" | "file";
  leagueType: string;
  dayKeys: string[];
  rows: PortalMethodOccurrenceRow[];
  lastSuccessfulSyncAt: string | null;
  lastPublishedAt: string | null;
  syncInProgress: boolean;
};

type PortalMethodStorageMode = "database" | "file";

type FileStoredCatalog = {
  id: string;
  league_type: string;
  code: string;
  label: string;
  family: string;
  status: string;
  sync_enabled: boolean;
  sort_order: number;
  created_at: string;
  updated_at: string;
};

type FileStoredOccurrence = {
  id: string;
  league_type: string;
  series: string | null;
  method_code: string;
  player_name: string;
  opponent_name: string;
  confrontation_key: string;
  confrontation_label: string;
  occurrence_match_id: string;
  occurrence_played_at: string;
  day_key: string;
  day_label: string;
  window_label: string;
  season_id: number | null;
  result: "W" | "D" | "L";
  full_time_score: string;
  wins: number;
  draws: number;
  losses: number;
  apx: number;
  total_occurrences: number;
  trigger_sequence_json: string | null;
  day_sequence_json: string | null;
  day_history_json: string | null;
  payload_json: string | null;
  synced_at: string;
  created_at: string;
  updated_at: string;
};

type FileStoredSyncRun = {
  id: string;
  league_type: string;
  method_code: string;
  window_days: number;
  status: string;
  started_at: string;
  finished_at: string | null;
  upserted_count: number;
  removed_count: number;
  skipped_count: number;
  error_message: string | null;
  details_json: string | null;
  created_at: string;
  updated_at: string;
};

type FileStore = {
  version: 1;
  updated_at: string;
  catalog: FileStoredCatalog[];
  occurrences: FileStoredOccurrence[];
  sync_runs: FileStoredSyncRun[];
};

type FileStoredLeagueView = {
  generatedAt: string;
  leagueType: string;
  rows: PortalMethodOccurrenceRow[];
  lastSuccessfulSyncAt: string | null;
  lastPublishedAt: string | null;
};

const PORTAL_METHOD_SYNC_INTERVAL_MS = 5 * 60 * 1000;
const PORTAL_METHOD_SYNC_WINDOW_DAYS = 35;
const PORTAL_METHOD_HISTORY_DAY_COUNT = 30;
const PORTAL_METHOD_FORCE_FILE_STORAGE = true;

const PORTAL_METHOD_CATALOG_SEED: PortalMethodCatalogSeed[] = [
  {
    leagueType: "GT LEAGUE",
    code: "T+",
    label: "T+",
    family: "confrontation",
    status: "active",
    syncEnabled: false,
    sortOrder: 10,
  },
  {
    leagueType: "GT LEAGUE",
    code: "E",
    label: "E",
    family: "confrontation",
    status: "active",
    syncEnabled: false,
    sortOrder: 20,
  },
  {
    leagueType: "GT LEAGUE",
    code: "(2E)",
    label: "(2E)",
    family: "confrontation",
    status: "active",
    syncEnabled: false,
    sortOrder: 30,
  },
  {
    leagueType: "GT LEAGUE",
    code: "(2D)",
    label: "(2D)",
    family: "confrontation",
    status: "active",
    syncEnabled: false,
    sortOrder: 40,
  },
  {
    leagueType: "GT LEAGUE",
    code: "(2D+)",
    label: "(2D+)",
    family: "confrontation",
    status: "active",
    syncEnabled: true,
    sortOrder: 50,
  },
  {
    leagueType: "GT LEAGUE",
    code: "(3D)",
    label: "(3D)",
    family: "confrontation",
    status: "active",
    syncEnabled: false,
    sortOrder: 60,
  },
  {
    leagueType: "GT LEAGUE",
    code: "(3D+)",
    label: "(3D+)",
    family: "confrontation",
    status: "active",
    syncEnabled: true,
    sortOrder: 70,
  },
  {
    leagueType: "GT LEAGUE",
    code: "(4D)",
    label: "(4D)",
    family: "confrontation",
    status: "active",
    syncEnabled: false,
    sortOrder: 80,
  },
  {
    leagueType: "GT LEAGUE",
    code: "(4D+)",
    label: "(4D+)",
    family: "confrontation",
    status: "active",
    syncEnabled: false,
    sortOrder: 90,
  },
  {
    leagueType: "GT LEAGUE",
    code: "HC-2",
    label: "HC-2",
    family: "confrontation",
    status: "active",
    syncEnabled: true,
    sortOrder: 100,
  },
  {
    leagueType: "GT LEAGUE",
    code: "HC-3",
    label: "HC-3",
    family: "confrontation",
    status: "active",
    syncEnabled: true,
    sortOrder: 110,
  },
  {
    leagueType: "GT LEAGUE",
    code: "HC-4",
    label: "HC-4",
    family: "confrontation",
    status: "active",
    syncEnabled: true,
    sortOrder: 120,
  },
  {
    leagueType: "GT LEAGUE",
    code: "HC-5",
    label: "HC-5",
    family: "confrontation",
    status: "active",
    syncEnabled: true,
    sortOrder: 130,
  },
];

let storageReady = false;
let storagePreparing: Promise<void> | null = null;
let storageMode: PortalMethodStorageMode = "file";
let syncTimer: NodeJS.Timeout | null = null;
let syncInProgress = false;

function getApiWorkspaceRoot() {
  const cwd = process.cwd();
  const normalized = cwd.replace(/\\/g, "/").toLowerCase();

  if (normalized.endsWith("/apps/api")) {
    return cwd;
  }

  return resolve(cwd, "apps", "api");
}

function getPortalMethodStorePath() {
  return resolve(
    getApiWorkspaceRoot(),
    "tmp",
    "portal-method-occurrences",
    "latest.json",
  );
}

function getPortalMethodViewsDirectory() {
  return resolve(
    getApiWorkspaceRoot(),
    "tmp",
    "portal-method-occurrences",
    "views",
  );
}

function buildPortalMethodLeagueViewFileName(leagueType: string) {
  return `${leagueType
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")}.json`;
}

function getPortalMethodLeagueViewPath(leagueType: string) {
  return resolve(
    getPortalMethodViewsDirectory(),
    buildPortalMethodLeagueViewFileName(leagueType),
  );
}

function createEmptyFileStore(): FileStore {
  return {
    version: 1,
    updated_at: new Date().toISOString(),
    catalog: [],
    occurrences: [],
    sync_runs: [],
  };
}

function createLocalId(prefix: string) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

function getPrismaMetaCode(error: unknown) {
  if (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.meta &&
    typeof error.meta === "object" &&
    "code" in error.meta
  ) {
    const metaCode = error.meta.code;
    return typeof metaCode === "string" ? metaCode : null;
  }

  return null;
}

function isMissingTableError(error: unknown) {
  const metaCode = getPrismaMetaCode(error);
  return (
    metaCode === "1146" ||
    metaCode === "42S02" ||
    (error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2021")
  );
}

function buildOccurrenceUniqueKey(
  leagueType: string,
  methodCode: string,
  confrontationKey: string,
  occurrenceMatchId: string,
) {
  return [leagueType, methodCode, confrontationKey, occurrenceMatchId].join(
    "||",
  );
}

function buildOccurrenceUniqueKeyFromRecord(
  row: ConfrontationMethodOccurrenceRecord,
) {
  return buildOccurrenceUniqueKey(
    row.leagueType,
    row.methodCode,
    row.confrontationKey,
    row.occurrenceMatchId,
  );
}

async function ensureFileStore() {
  const filePath = getPortalMethodStorePath();
  const directory = resolve(filePath, "..");
  await mkdir(directory, { recursive: true });
  await mkdir(getPortalMethodViewsDirectory(), { recursive: true });

  try {
    await readFile(filePath, "utf8");
  } catch {
    await writeJsonAtomically(filePath, createEmptyFileStore());
  }
}

async function writeJsonAtomically(path: string, payload: unknown) {
  const tempPath = `${path}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(tempPath, JSON.stringify(payload, null, 2), "utf8");
  await rename(tempPath, path);
}

async function readPortalMethodFileStore(): Promise<FileStore> {
  await ensureFileStore();

  try {
    const raw = await readFile(getPortalMethodStorePath(), "utf8");
    return JSON.parse(raw) as FileStore;
  } catch {
    return createEmptyFileStore();
  }
}

async function writePortalMethodFileStore(store: FileStore) {
  await ensureFileStore();
  store.updated_at = new Date().toISOString();
  await writeJsonAtomically(getPortalMethodStorePath(), store);
}

function buildPortalMethodLeagueView(store: FileStore, leagueType: string) {
  const rows = store.occurrences
    .filter((row) => row.league_type === leagueType)
    .sort(
      (left, right) =>
        right.day_key.localeCompare(left.day_key, "pt-BR", {
          sensitivity: "base",
        }) ||
        right.occurrence_played_at.localeCompare(
          left.occurrence_played_at,
          "pt-BR",
          {
            sensitivity: "base",
          },
        ) ||
        left.confrontation_label.localeCompare(
          right.confrontation_label,
          "pt-BR",
          {
            sensitivity: "base",
          },
        ),
    )
    .map(mapFileOccurrenceRow);

  const lastSync = store.sync_runs.find(
    (row) => row.league_type === leagueType && row.status === "success",
  );

  return {
    generatedAt: new Date().toISOString(),
    leagueType,
    rows,
    lastSuccessfulSyncAt: lastSync?.finished_at ?? null,
    lastPublishedAt: new Date().toISOString(),
  } satisfies FileStoredLeagueView;
}

async function publishPortalMethodLeagueViews(store: FileStore) {
  const leagueTypes = new Set<string>([
    ...store.catalog.map((row) => row.league_type),
    ...store.occurrences.map((row) => row.league_type),
    ...store.sync_runs.map((row) => row.league_type),
  ]);

  await Promise.all(
    Array.from(leagueTypes).map(async (leagueType) => {
      const view = buildPortalMethodLeagueView(store, leagueType);
      await writeJsonAtomically(
        getPortalMethodLeagueViewPath(leagueType),
        view,
      );
    }),
  );
}

async function publishPortalMethodLeagueViewsFromDatabase() {
  const leagueTypes = new Set<string>([
    ...PORTAL_METHOD_CATALOG_SEED.map((seed) => seed.leagueType),
  ]);

  const [catalogLeagues, occurrenceLeagues, syncRunLeagues] = await Promise.all(
    [
      prisma.portal_method_catalog.findMany({
        distinct: ["league_type"],
        select: { league_type: true },
      }),
      prisma.portal_method_occurrences.findMany({
        distinct: ["league_type"],
        select: { league_type: true },
      }),
      prisma.portal_method_sync_runs.findMany({
        distinct: ["league_type"],
        select: { league_type: true },
      }),
    ],
  );

  for (const row of [
    ...catalogLeagues,
    ...occurrenceLeagues,
    ...syncRunLeagues,
  ]) {
    if (row.league_type?.trim()) {
      leagueTypes.add(row.league_type.trim());
    }
  }

  await ensureFileStore();

  await Promise.all(
    Array.from(leagueTypes).map(async (leagueType) => {
      const [rows, lastSync] = await Promise.all([
        prisma.portal_method_occurrences.findMany({
          where: {
            league_type: leagueType,
          },
          orderBy: [
            { day_key: "desc" },
            { occurrence_played_at: "desc" },
            { confrontation_label: "asc" },
          ],
        }),
        prisma.portal_method_sync_runs.findFirst({
          where: {
            league_type: leagueType,
            status: "success",
          },
          orderBy: {
            started_at: "desc",
          },
        }),
      ]);

      const payload: FileStoredLeagueView = {
        generatedAt: new Date().toISOString(),
        leagueType,
        rows: rows.map(mapDatabaseOccurrenceRow),
        lastSuccessfulSyncAt: lastSync?.finished_at?.toISOString() ?? null,
        lastPublishedAt: new Date().toISOString(),
      };

      await writeJsonAtomically(
        getPortalMethodLeagueViewPath(leagueType),
        payload,
      );
    }),
  );
}

async function publishSinglePortalMethodLeagueViewFromDatabase(
  leagueType: string,
  rows: ReturnType<typeof mapDatabaseOccurrenceRow>[],
  lastSuccessfulSyncAt: string | null,
) {
  await ensureFileStore();

  const payload: FileStoredLeagueView = {
    generatedAt: new Date().toISOString(),
    leagueType,
    rows,
    lastSuccessfulSyncAt,
    lastPublishedAt: new Date().toISOString(),
  };

  await writeJsonAtomically(getPortalMethodLeagueViewPath(leagueType), payload);
}

async function readPortalMethodLeagueView(
  leagueType: string,
): Promise<FileStoredLeagueView | null> {
  await ensureFileStore();

  try {
    const raw = await readFile(
      getPortalMethodLeagueViewPath(leagueType),
      "utf8",
    );
    const parsed = JSON.parse(raw) as Partial<FileStoredLeagueView> & {
      lastSyncAt?: string | null;
    };

    if (!parsed.lastPublishedAt) {
      const store = await readPortalMethodFileStore();
      await publishPortalMethodLeagueViews(store);
      const republishedRaw = await readFile(
        getPortalMethodLeagueViewPath(leagueType),
        "utf8",
      );

      return JSON.parse(republishedRaw) as FileStoredLeagueView;
    }

    return {
      generatedAt: parsed.generatedAt ?? new Date().toISOString(),
      leagueType: parsed.leagueType ?? leagueType,
      rows: Array.isArray(parsed.rows) ? parsed.rows : [],
      lastSuccessfulSyncAt:
        parsed.lastSuccessfulSyncAt ?? parsed.lastSyncAt ?? null,
      lastPublishedAt: parsed.lastPublishedAt ?? parsed.generatedAt ?? null,
    };
  } catch {
    try {
      const store = await readPortalMethodFileStore();
      await publishPortalMethodLeagueViews(store);
      const raw = await readFile(
        getPortalMethodLeagueViewPath(leagueType),
        "utf8",
      );
      return JSON.parse(raw) as FileStoredLeagueView;
    } catch {
      return null;
    }
  }
}

async function detectDatabaseStorageAvailability() {
  try {
    await prisma.$queryRawUnsafe("SELECT 1 FROM portal_method_catalog LIMIT 1");
    await prisma.$queryRawUnsafe(
      "SELECT 1 FROM portal_method_occurrences LIMIT 1",
    );
    await prisma.$queryRawUnsafe(
      "SELECT 1 FROM portal_method_sync_runs LIMIT 1",
    );
    return true;
  } catch (error) {
    if (isMissingTableError(error)) {
      return false;
    }

    return false;
  }
}

async function tryCreateDatabaseStorage() {
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS portal_method_catalog (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      league_type VARCHAR(32) NOT NULL,
      code VARCHAR(32) NOT NULL,
      label VARCHAR(64) NOT NULL,
      family VARCHAR(24) NOT NULL,
      status VARCHAR(16) NOT NULL DEFAULT 'active',
      sync_enabled BOOLEAN NOT NULL DEFAULT FALSE,
      sort_order SMALLINT UNSIGNED NOT NULL DEFAULT 0,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      UNIQUE KEY uq_portal_method_catalog_league_code (league_type, code),
      KEY idx_portal_method_catalog_league_status (league_type, status, sort_order)
    )
  `);
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS portal_method_occurrences (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      league_type VARCHAR(32) NOT NULL,
      series VARCHAR(1) NULL,
      method_code VARCHAR(32) NOT NULL,
      player_name VARCHAR(120) NOT NULL,
      opponent_name VARCHAR(120) NOT NULL,
      confrontation_key VARCHAR(255) NOT NULL,
      confrontation_label VARCHAR(255) NOT NULL,
      occurrence_match_id VARCHAR(64) NOT NULL,
      occurrence_played_at DATETIME NOT NULL,
      day_key VARCHAR(10) NOT NULL,
      day_label VARCHAR(10) NOT NULL,
      window_label VARCHAR(24) NOT NULL,
      season_id INT NULL,
      result VARCHAR(1) NOT NULL,
      full_time_score VARCHAR(16) NOT NULL,
      wins INT UNSIGNED NOT NULL,
      draws INT UNSIGNED NOT NULL,
      losses INT UNSIGNED NOT NULL,
      apx DECIMAL(5,2) NOT NULL,
      total_occurrences INT UNSIGNED NOT NULL,
      trigger_sequence_json LONGTEXT NULL,
      day_sequence_json LONGTEXT NULL,
      day_history_json LONGTEXT NULL,
      payload_json LONGTEXT NULL,
      synced_at DATETIME NOT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      UNIQUE KEY uq_portal_method_occurrence_unique (league_type, method_code, confrontation_key, occurrence_match_id),
      KEY idx_portal_method_occurrence_league_played (league_type, occurrence_played_at),
      KEY idx_portal_method_occurrence_league_series_played (league_type, series, occurrence_played_at),
      KEY idx_portal_method_occurrence_league_method_played (league_type, method_code, occurrence_played_at)
    )
  `);
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS portal_method_sync_runs (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      league_type VARCHAR(32) NOT NULL,
      method_code VARCHAR(32) NOT NULL,
      window_days SMALLINT UNSIGNED NOT NULL,
      status VARCHAR(16) NOT NULL,
      started_at DATETIME NOT NULL,
      finished_at DATETIME NULL,
      upserted_count INT UNSIGNED NOT NULL DEFAULT 0,
      removed_count INT UNSIGNED NOT NULL DEFAULT 0,
      skipped_count INT UNSIGNED NOT NULL DEFAULT 0,
      error_message LONGTEXT NULL,
      details_json LONGTEXT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      KEY idx_portal_method_sync_runs_lookup (league_type, method_code, started_at),
      KEY idx_portal_method_sync_runs_status (status, started_at)
    )
  `);
}

async function ensurePortalMethodStorage() {
  if (storageReady) {
    return;
  }

  if (storagePreparing) {
    await storagePreparing;
    return;
  }

  storagePreparing = (async () => {
    if (PORTAL_METHOD_FORCE_FILE_STORAGE) {
      storageMode = "file";
      await ensureFileStore();
      storageReady = true;
      return;
    }

    if (await detectDatabaseStorageAvailability()) {
      storageMode = "database";
      storageReady = true;
      return;
    }

    try {
      await tryCreateDatabaseStorage();
      storageMode = "database";
      storageReady = true;
      return;
    } catch (error) {
      storageMode = "file";
      await ensureFileStore();
      storageReady = true;
      log.warn(
        { reason: error instanceof Error ? error.message : String(error) },
        "Portal method occurrences em modo file-backed por indisponibilidade de CREATE/DDL no banco.",
      );
    }
  })();

  try {
    await storagePreparing;
  } finally {
    storagePreparing = null;
  }
}

async function seedPortalMethodCatalog() {
  await ensurePortalMethodStorage();

  if (storageMode === "database") {
    await Promise.all(
      PORTAL_METHOD_CATALOG_SEED.map((seed) =>
        prisma.portal_method_catalog.upsert({
          where: {
            league_type_code: {
              league_type: seed.leagueType,
              code: seed.code,
            },
          },
          update: {
            label: seed.label,
            family: seed.family,
            status: seed.status,
            sync_enabled: seed.syncEnabled,
            sort_order: seed.sortOrder,
          },
          create: {
            league_type: seed.leagueType,
            code: seed.code,
            label: seed.label,
            family: seed.family,
            status: seed.status,
            sync_enabled: seed.syncEnabled,
            sort_order: seed.sortOrder,
          },
        }),
      ),
    );

    return;
  }

  const store = await readPortalMethodFileStore();
  const byKey = new Map<string, FileStoredCatalog>(
    store.catalog.map((row) => [`${row.league_type}||${row.code}`, row]),
  );

  for (const seed of PORTAL_METHOD_CATALOG_SEED) {
    const key = `${seed.leagueType}||${seed.code}`;
    const current = byKey.get(key);
    const nowIso = new Date().toISOString();

    byKey.set(key, {
      id: current?.id ?? createLocalId("catalog"),
      league_type: seed.leagueType,
      code: seed.code,
      label: seed.label,
      family: seed.family,
      status: seed.status,
      sync_enabled: seed.syncEnabled,
      sort_order: seed.sortOrder,
      created_at: current?.created_at ?? nowIso,
      updated_at: nowIso,
    });
  }

  store.catalog = Array.from(byKey.values()).sort(
    (left, right) =>
      left.league_type.localeCompare(right.league_type, "pt-BR", {
        sensitivity: "base",
      }) ||
      left.sort_order - right.sort_order ||
      left.code.localeCompare(right.code, "pt-BR", { sensitivity: "base" }),
  );
  await writePortalMethodFileStore(store);
}

function mapOccurrenceRecordToDatabaseCreateInput(
  row: ConfrontationMethodOccurrenceRecord,
  syncedAt: Date,
): Prisma.portal_method_occurrencesCreateManyInput {
  return {
    league_type: row.leagueType,
    series: row.series,
    method_code: row.methodCode,
    player_name: row.playerName,
    opponent_name: row.opponentName,
    confrontation_key: row.confrontationKey,
    confrontation_label: row.confrontationLabel,
    occurrence_match_id: row.occurrenceMatchId,
    occurrence_played_at: new Date(row.occurrencePlayedAt),
    day_key: row.dayKey,
    day_label: row.dayLabel,
    window_label: row.windowLabel,
    season_id: row.seasonId,
    result: row.result,
    full_time_score: row.fullTimeScore,
    wins: row.wins,
    draws: row.draws,
    losses: row.losses,
    apx: new Prisma.Decimal(row.apx.toFixed(2)),
    total_occurrences: row.totalOccurrences,
    trigger_sequence_json: JSON.stringify(row.triggerSequence),
    day_sequence_json: JSON.stringify(row.daySequence),
    day_history_json: JSON.stringify(row.dayHistory),
    payload_json: JSON.stringify(row),
    synced_at: syncedAt,
  };
}

function mapOccurrenceRecordToFileRow(
  row: ConfrontationMethodOccurrenceRecord,
  syncedAtIso: string,
): FileStoredOccurrence {
  return {
    id: createLocalId("occ"),
    league_type: row.leagueType,
    series: row.series,
    method_code: row.methodCode,
    player_name: row.playerName,
    opponent_name: row.opponentName,
    confrontation_key: row.confrontationKey,
    confrontation_label: row.confrontationLabel,
    occurrence_match_id: row.occurrenceMatchId,
    occurrence_played_at: row.occurrencePlayedAt,
    day_key: row.dayKey,
    day_label: row.dayLabel,
    window_label: row.windowLabel,
    season_id: row.seasonId,
    result: row.result,
    full_time_score: row.fullTimeScore,
    wins: row.wins,
    draws: row.draws,
    losses: row.losses,
    apx: row.apx,
    total_occurrences: row.totalOccurrences,
    trigger_sequence_json: JSON.stringify(row.triggerSequence),
    day_sequence_json: JSON.stringify(row.daySequence),
    day_history_json: JSON.stringify(row.dayHistory),
    payload_json: JSON.stringify(row),
    synced_at: syncedAtIso,
    created_at: syncedAtIso,
    updated_at: syncedAtIso,
  };
}

async function syncCatalogEntryDatabase(seed: PortalMethodCatalogSeed) {
  const startedAt = new Date();
  const syncRun = await prisma.portal_method_sync_runs.create({
    data: {
      league_type: seed.leagueType,
      method_code: seed.code,
      window_days: PORTAL_METHOD_SYNC_WINDOW_DAYS,
      status: "running",
      started_at: startedAt,
      details_json: JSON.stringify({
        syncEnabled: seed.syncEnabled,
        source: "confrontation-live",
      }),
    },
  });

  try {
    const occurrences = await getConfrontationMethodOccurrenceRecordsLive(
      seed.leagueType,
      seed.code,
      {
        includeHistory: true,
        days: PORTAL_METHOD_SYNC_WINDOW_DAYS,
      },
    );
    const syncedAt = new Date();
    const syncWindowStart = new Date(startedAt.getTime());
    syncWindowStart.setDate(
      syncWindowStart.getDate() - PORTAL_METHOD_SYNC_WINDOW_DAYS,
    );
    const uniqueOccurrences = Array.from(
      new Map(
        occurrences.map((row) => [
          buildOccurrenceUniqueKeyFromRecord(row),
          row,
        ]),
      ).values(),
    );
    const currentWindowRows = await prisma.portal_method_occurrences.count({
      where: {
        league_type: seed.leagueType,
        method_code: seed.code,
        occurrence_played_at: {
          gte: syncWindowStart,
        },
      },
    });

    await prisma.$transaction(async (transaction) => {
      await transaction.portal_method_occurrences.deleteMany({
        where: {
          league_type: seed.leagueType,
          method_code: seed.code,
          occurrence_played_at: {
            gte: syncWindowStart,
          },
        },
      });

      if (uniqueOccurrences.length > 0) {
        await transaction.portal_method_occurrences.createMany({
          data: uniqueOccurrences.map((row) =>
            mapOccurrenceRecordToDatabaseCreateInput(row, syncedAt),
          ),
          skipDuplicates: true,
        });
      }

      await transaction.portal_method_sync_runs.update({
        where: {
          id: syncRun.id,
        },
        data: {
          status: "success",
          finished_at: syncedAt,
          upserted_count: uniqueOccurrences.length,
          removed_count: currentWindowRows,
          skipped_count: Math.max(
            occurrences.length - uniqueOccurrences.length,
            0,
          ),
          details_json: JSON.stringify({
            syncEnabled: seed.syncEnabled,
            windowDays: PORTAL_METHOD_SYNC_WINDOW_DAYS,
            source: "confrontation-live",
          }),
        },
      });
    });
  } catch (error) {
    await prisma.portal_method_sync_runs.update({
      where: {
        id: syncRun.id,
      },
      data: {
        status: "failed",
        finished_at: new Date(),
        error_message:
          error instanceof Error
            ? (error.stack ?? error.message)
            : String(error),
      },
    });

    throw error;
  }
}

async function syncCatalogEntryFile(seed: PortalMethodCatalogSeed) {
  const startedAtIso = new Date().toISOString();
  const syncRunId = createLocalId("sync");
  const store = await readPortalMethodFileStore();

  store.sync_runs.unshift({
    id: syncRunId,
    league_type: seed.leagueType,
    method_code: seed.code,
    window_days: PORTAL_METHOD_SYNC_WINDOW_DAYS,
    status: "running",
    started_at: startedAtIso,
    finished_at: null,
    upserted_count: 0,
    removed_count: 0,
    skipped_count: 0,
    error_message: null,
    details_json: JSON.stringify({
      syncEnabled: seed.syncEnabled,
      source: "confrontation-live",
    }),
    created_at: startedAtIso,
    updated_at: startedAtIso,
  });
  await writePortalMethodFileStore(store);

  try {
    const occurrences = await getConfrontationMethodOccurrenceRecordsLive(
      seed.leagueType,
      seed.code,
      {
        includeHistory: true,
        days: PORTAL_METHOD_SYNC_WINDOW_DAYS,
      },
    );
    const uniqueOccurrences = Array.from(
      new Map(
        occurrences.map((row) => [
          buildOccurrenceUniqueKeyFromRecord(row),
          row,
        ]),
      ).values(),
    );
    const syncedAtIso = new Date().toISOString();
    const syncWindowStart = new Date(startedAtIso);
    syncWindowStart.setDate(
      syncWindowStart.getDate() - PORTAL_METHOD_SYNC_WINDOW_DAYS,
    );
    const nextStore = await readPortalMethodFileStore();
    const removedCount = nextStore.occurrences.filter((row) => {
      const playedAt = new Date(row.occurrence_played_at).getTime();

      return (
        row.league_type === seed.leagueType &&
        row.method_code === seed.code &&
        !Number.isNaN(playedAt) &&
        playedAt >= syncWindowStart.getTime()
      );
    }).length;

    nextStore.occurrences = nextStore.occurrences.filter((row) => {
      const playedAt = new Date(row.occurrence_played_at).getTime();

      return !(
        row.league_type === seed.leagueType &&
        row.method_code === seed.code &&
        !Number.isNaN(playedAt) &&
        playedAt >= syncWindowStart.getTime()
      );
    });
    nextStore.occurrences.push(
      ...uniqueOccurrences.map((row) =>
        mapOccurrenceRecordToFileRow(row, syncedAtIso),
      ),
    );
    nextStore.occurrences.sort(
      (left, right) =>
        right.occurrence_played_at.localeCompare(
          left.occurrence_played_at,
          "pt-BR",
          {
            sensitivity: "base",
          },
        ) ||
        left.confrontation_label.localeCompare(
          right.confrontation_label,
          "pt-BR",
          {
            sensitivity: "base",
          },
        ),
    );
    nextStore.sync_runs = nextStore.sync_runs.map((row) =>
      row.id === syncRunId
        ? {
            ...row,
            status: "success",
            finished_at: syncedAtIso,
            upserted_count: uniqueOccurrences.length,
            removed_count: removedCount,
            skipped_count: Math.max(
              occurrences.length - uniqueOccurrences.length,
              0,
            ),
            updated_at: syncedAtIso,
            details_json: JSON.stringify({
              syncEnabled: seed.syncEnabled,
              windowDays: PORTAL_METHOD_SYNC_WINDOW_DAYS,
              source: "confrontation-live",
            }),
          }
        : row,
    );
    nextStore.sync_runs = nextStore.sync_runs
      .sort((left, right) =>
        right.started_at.localeCompare(left.started_at, "pt-BR", {
          sensitivity: "base",
        }),
      )
      .slice(0, 200);
    await writePortalMethodFileStore(nextStore);
  } catch (error) {
    const failedStore = await readPortalMethodFileStore();
    const finishedAtIso = new Date().toISOString();
    failedStore.sync_runs = failedStore.sync_runs.map((row) =>
      row.id === syncRunId
        ? {
            ...row,
            status: "failed",
            finished_at: finishedAtIso,
            error_message:
              error instanceof Error
                ? (error.stack ?? error.message)
                : String(error),
            updated_at: finishedAtIso,
          }
        : row,
    );
    await writePortalMethodFileStore(failedStore);
    throw error;
  }
}

async function syncCatalogEntry(seed: PortalMethodCatalogSeed) {
  if (storageMode === "database") {
    await syncCatalogEntryDatabase(seed);
    return;
  }

  await syncCatalogEntryFile(seed);
}

async function getSyncEnabledCatalogSeeds() {
  await seedPortalMethodCatalog();

  if (storageMode === "database") {
    const rows = await prisma.portal_method_catalog.findMany({
      where: {
        status: "active",
        sync_enabled: true,
      },
      orderBy: [{ sort_order: "asc" }, { code: "asc" }],
    });

    return rows.map<PortalMethodCatalogSeed>((row) => ({
      leagueType: row.league_type as ConfrontationMethodsLeagueType,
      code: row.code as ConfrontationMethodCode,
      label: row.label,
      family: row.family as "confrontation",
      status: row.status as "active" | "planned" | "disabled",
      syncEnabled: row.sync_enabled,
      sortOrder: row.sort_order,
    }));
  }

  const store = await readPortalMethodFileStore();
  return store.catalog
    .filter((row) => row.status === "active" && row.sync_enabled)
    .sort(
      (left, right) =>
        left.sort_order - right.sort_order ||
        left.code.localeCompare(right.code, "pt-BR", { sensitivity: "base" }),
    )
    .map<PortalMethodCatalogSeed>((row) => ({
      leagueType: row.league_type as ConfrontationMethodsLeagueType,
      code: row.code as ConfrontationMethodCode,
      label: row.label,
      family: row.family as "confrontation",
      status: row.status as "active" | "planned" | "disabled",
      syncEnabled: row.sync_enabled,
      sortOrder: row.sort_order,
    }));
}

async function syncPortalMethodOccurrencesInternal() {
  if (syncInProgress) {
    return;
  }

  syncInProgress = true;

  try {
    const catalogEntries = await getSyncEnabledCatalogSeeds();
    const syncErrors: Array<{
      entry: PortalMethodCatalogSeed;
      error: unknown;
    }> = [];

    for (const entry of catalogEntries) {
      try {
        await syncCatalogEntry(entry);
      } catch (error) {
        syncErrors.push({ entry, error });
        log.error(
          { err: error, leagueType: entry.leagueType, code: entry.code },
          "Falha ao sincronizar entry no registry de metodos do portal",
        );
      }
    }

    if (storageMode === "database") {
      await publishPortalMethodLeagueViewsFromDatabase();
    } else {
      const publishedStore = await readPortalMethodFileStore();
      await publishPortalMethodLeagueViews(publishedStore);
    }

    if (syncErrors.length > 0) {
      log.error(
        { failures: syncErrors.length },
        "Sync de ocorrencias de metodos do portal finalizado com falha(s) parcial(is).",
      );
    }
  } finally {
    syncInProgress = false;
  }
}

function mapDatabaseCatalogRow(row: {
  id: bigint;
  league_type: string;
  code: string;
  label: string;
  family: string;
  status: string;
  sync_enabled: boolean;
  sort_order: number;
  updated_at: Date;
}): PortalMethodCatalogRow {
  return {
    id: row.id.toString(),
    leagueType: row.league_type,
    code: row.code,
    label: row.label,
    family: row.family,
    status: row.status,
    syncEnabled: row.sync_enabled,
    sortOrder: row.sort_order,
    updatedAt: row.updated_at.toISOString(),
  };
}

function mapFileCatalogRow(row: FileStoredCatalog): PortalMethodCatalogRow {
  return {
    id: row.id,
    leagueType: row.league_type,
    code: row.code,
    label: row.label,
    family: row.family,
    status: row.status,
    syncEnabled: row.sync_enabled,
    sortOrder: row.sort_order,
    updatedAt: row.updated_at,
  };
}

function mapDatabaseOccurrenceRow(row: {
  id: bigint;
  league_type: string;
  series: string | null;
  method_code: string;
  confrontation_label: string;
  player_name: string;
  opponent_name: string;
  occurrence_played_at: Date;
  day_key: string;
  result: string;
  full_time_score: string;
  wins: number;
  draws: number;
  losses: number;
  apx: Prisma.Decimal;
  total_occurrences: number;
}): PortalMethodOccurrenceRow {
  return {
    id: row.id.toString(),
    leagueType: row.league_type,
    series: row.series ?? "-",
    methodCode: row.method_code,
    confrontationLabel: row.confrontation_label,
    playerName: row.player_name,
    opponentName: row.opponent_name,
    playedAtIso: row.occurrence_played_at.toISOString(),
    dayKey: row.day_key,
    result: row.result as "W" | "D" | "L",
    fullTimeScore: row.full_time_score,
    wins: row.wins,
    draws: row.draws,
    losses: row.losses,
    apx: Number(row.apx),
    totalOccurrences: row.total_occurrences,
  };
}

function mapFileOccurrenceRow(
  row: FileStoredOccurrence,
): PortalMethodOccurrenceRow {
  return {
    id: row.id,
    leagueType: row.league_type,
    series: row.series ?? "-",
    methodCode: row.method_code,
    confrontationLabel: row.confrontation_label,
    playerName: row.player_name,
    opponentName: row.opponent_name,
    playedAtIso: row.occurrence_played_at,
    dayKey: row.day_key,
    result: row.result,
    fullTimeScore: row.full_time_score,
    wins: row.wins,
    draws: row.draws,
    losses: row.losses,
    apx: row.apx,
    totalOccurrences: row.total_occurrences,
  };
}

export async function syncPortalMethodOccurrences() {
  await syncPortalMethodOccurrencesInternal();
}

async function runPortalMethodOccurrencesSyncSafely() {
  try {
    await syncPortalMethodOccurrencesInternal();
  } catch (error) {
    log.error(
      { err: error },
      "Falha ao sincronizar ocorrencias de metodos do portal",
    );
  }
}

export function triggerPortalMethodOccurrencesSync() {
  if (syncInProgress) {
    return;
  }

  void runPortalMethodOccurrencesSyncSafely();
}

export function startPortalMethodOccurrencesSyncRunner() {
  if (syncTimer) {
    return;
  }

  const scheduleNextRun = () => {
    syncTimer = setTimeout(() => {
      void runPortalMethodOccurrencesSyncSafely();
      scheduleNextRun();
    }, PORTAL_METHOD_SYNC_INTERVAL_MS);
  };

  void runPortalMethodOccurrencesSyncSafely();
  scheduleNextRun();

  log.info(
    { intervalMs: PORTAL_METHOD_SYNC_INTERVAL_MS },
    "Sync de ocorrencias de metodos do portal ativo",
  );
}

export async function listPortalMethodCatalog(
  leagueType?: string,
): Promise<PortalMethodCatalogRow[]> {
  await seedPortalMethodCatalog();

  if (storageMode === "database") {
    const rows = await prisma.portal_method_catalog.findMany({
      where: leagueType
        ? {
            league_type: leagueType,
          }
        : undefined,
      orderBy: [{ league_type: "asc" }, { sort_order: "asc" }, { code: "asc" }],
    });

    return rows.map(mapDatabaseCatalogRow);
  }

  const store = await readPortalMethodFileStore();

  return store.catalog
    .filter((row) => (leagueType ? row.league_type === leagueType : true))
    .sort(
      (left, right) =>
        left.league_type.localeCompare(right.league_type, "pt-BR", {
          sensitivity: "base",
        }) ||
        left.sort_order - right.sort_order ||
        left.code.localeCompare(right.code, "pt-BR", { sensitivity: "base" }),
    )
    .map(mapFileCatalogRow);
}

export async function listPortalMethodOccurrences(options: {
  leagueType: string;
  dayCount?: number;
  series?: string[];
  methodCodes?: string[];
}): Promise<PortalMethodOccurrencesResponse> {
  await seedPortalMethodCatalog();

  if (storageMode === "database") {
    const where: Prisma.portal_method_occurrencesWhereInput = {
      league_type: options.leagueType,
    };

    if (options.series?.length) {
      where.series = {
        in: options.series.map((item) => item.trim().toUpperCase()),
      };
    }

    if (options.methodCodes?.length) {
      where.method_code = {
        in: options.methodCodes.map((item) => item.trim()),
      };
    }

    let persistedRows = await prisma.portal_method_occurrences.findMany({
      where,
      orderBy: [
        { day_key: "desc" },
        { occurrence_played_at: "desc" },
        { confrontation_label: "asc" },
      ],
    });

    if (persistedRows.length === 0 && !syncInProgress) {
      await syncPortalMethodOccurrencesInternal();
      persistedRows = await prisma.portal_method_occurrences.findMany({
        where,
        orderBy: [
          { day_key: "desc" },
          { occurrence_played_at: "desc" },
          { confrontation_label: "asc" },
        ],
      });
    } else {
      triggerPortalMethodOccurrencesSync();
    }

    const dayKeys = Array.from(
      new Set(persistedRows.map((row) => row.day_key)),
    ).slice(0, options.dayCount ?? PORTAL_METHOD_HISTORY_DAY_COUNT);
    const selectedDayKeys = new Set(dayKeys);
    const rows = persistedRows
      .filter((row) => selectedDayKeys.has(row.day_key))
      .map(mapDatabaseOccurrenceRow);
    const lastSync = await prisma.portal_method_sync_runs.findFirst({
      where: {
        league_type: options.leagueType,
        status: "success",
      },
      orderBy: {
        started_at: "desc",
      },
    });
    const lastSuccessfulSyncAt = lastSync?.finished_at?.toISOString() ?? null;

    await publishSinglePortalMethodLeagueViewFromDatabase(
      options.leagueType,
      rows,
      lastSuccessfulSyncAt,
    );

    return {
      generatedAt: new Date().toISOString(),
      source: "database",
      leagueType: options.leagueType,
      dayKeys,
      rows,
      lastSuccessfulSyncAt,
      lastPublishedAt: new Date().toISOString(),
      syncInProgress,
    };
  }

  let leagueView = await readPortalMethodLeagueView(options.leagueType);

  if ((!leagueView || leagueView.rows.length === 0) && !syncInProgress) {
    await syncPortalMethodOccurrencesInternal();
    leagueView = await readPortalMethodLeagueView(options.leagueType);
  } else {
    triggerPortalMethodOccurrencesSync();
  }

  const filteredRows = (leagueView?.rows ?? [])
    .filter((row) =>
      options.series?.length
        ? options.series
            .map((item) => item.trim().toUpperCase())
            .includes((row.series ?? "").toUpperCase())
        : true,
    )
    .filter((row) =>
      options.methodCodes?.length
        ? options.methodCodes
            .map((item) => item.trim())
            .includes(row.methodCode)
        : true,
    );

  const dayKeys = Array.from(
    new Set(filteredRows.map((row) => row.dayKey)),
  ).slice(0, options.dayCount ?? PORTAL_METHOD_HISTORY_DAY_COUNT);
  const selectedDayKeys = new Set(dayKeys);
  const rows = filteredRows.filter((row) => selectedDayKeys.has(row.dayKey));

  return {
    generatedAt: new Date().toISOString(),
    source: "file",
    leagueType: options.leagueType,
    dayKeys,
    rows,
    lastSuccessfulSyncAt: leagueView?.lastSuccessfulSyncAt ?? null,
    lastPublishedAt:
      leagueView?.lastPublishedAt ?? leagueView?.generatedAt ?? null,
    syncInProgress,
  };
}
