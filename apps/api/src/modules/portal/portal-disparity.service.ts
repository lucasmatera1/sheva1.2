import { mkdir, readdir, rename, unlink, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { getDisparityOperationalWindow } from "../../core/live-analytics";
import { createLogger } from "../../core/logger";
import { prisma } from "../../core/prisma";

const log = createLogger("disparity");

type RawGtDisparityMatch = {
  id_fixture: string | number;
  id_season: number | null;
  match_kickoff: Date;
  home_player: string | null;
  away_player: string | null;
  home_score_ft: number | null;
  away_score_ft: number | null;
};

type PortalDisparityPlayerSnapshot = {
  id: string;
  name: string;
};

type PortalDisparityPairHistorySnapshot = {
  matchId: string;
  playedAt: string;
  localTimeLabel: string;
  playerOneGoals: number;
  playerTwoGoals: number;
  resultCode: "1" | "2" | "E";
  scoreLabel: string;
  fixtureLabel: string;
  playerOneIsHome: boolean;
};

type PortalDisparityPairRowSnapshot = {
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
  history: PortalDisparityPairHistorySnapshot[];
};

type PortalDisparityPairSnapshot = {
  generatedAt: string;
  lastSuccessfulSyncAt: string | null;
  lastPublishedAt: string | null;
  leagueType: "GT LEAGUE";
  players: {
    playerOne: string;
    playerTwo: string;
  };
  totalRows: number;
  totalMatches: number;
  rows: PortalDisparityPairRowSnapshot[];
};

type PortalDisparityIndexSnapshot = {
  generatedAt: string;
  lastSuccessfulSyncAt: string | null;
  lastPublishedAt: string | null;
  leagueType: "GT LEAGUE";
  lookbackDays: number;
  playerCount: number;
  pairCount: number;
  players: PortalDisparityPlayerSnapshot[];
  pairs: Array<{
    pairKey: string;
    playerOne: string;
    playerTwo: string;
    totalRows: number;
    totalMatches: number;
    lastPlayedAt: string | null;
  }>;
};

type CanonicalPairEvent = {
  matchId: string;
  seasonId: number | null;
  playedAt: Date;
  playerOneGoals: number;
  playerTwoGoals: number;
  resultCode: "1" | "2" | "E";
  fixtureLabel: string;
  playerOneIsHome: boolean;
};

const PORTAL_GT_DISPARITY_REFRESH_INTERVAL_MS = 10 * 60 * 1000;
const PORTAL_GT_DISPARITY_LOOKBACK_DAYS = 120;
const DISPARITY_TIME_ZONE = "America/Sao_Paulo";

let gtDisparityRefreshTimer: NodeJS.Timeout | null = null;
let gtDisparitySyncInProgress = false;

function getApiWorkspaceRoot() {
  const cwd = process.cwd();
  const normalized = cwd.replace(/\\/g, "/").toLowerCase();

  if (normalized.endsWith("/apps/api")) {
    return cwd;
  }

  return resolve(cwd, "apps", "api");
}

function getPortalDisparityRootDirectory() {
  return resolve(getApiWorkspaceRoot(), "tmp", "portal-disparity");
}

function getPortalDisparityViewsDirectory() {
  return resolve(getPortalDisparityRootDirectory(), "views");
}

function getPortalDisparityPairsDirectory() {
  return resolve(getPortalDisparityRootDirectory(), "pairs", "gt-league");
}

function getPortalDisparityIndexPath() {
  return resolve(getPortalDisparityViewsDirectory(), "gt-league.json");
}

function getLegacyDisparityOptionsSnapshotPath() {
  return resolve(
    getApiWorkspaceRoot(),
    "tmp",
    "portal-disparity-options",
    "views",
    "gt-league.json",
  );
}

function normalizeName(value: string) {
  return value.trim().replace(/\s+/g, " ");
}

function normalizeKey(value: string) {
  return normalizeName(value).toUpperCase();
}

function buildPlayerId(name: string) {
  return normalizeKey(name).replace(/[^A-Z0-9]+/g, "-");
}

function buildPairKey(playerOne: string, playerTwo: string) {
  const first = normalizeKey(playerOne).replace(/[^A-Z0-9]+/g, "-");
  const second = normalizeKey(playerTwo).replace(/[^A-Z0-9]+/g, "-");
  return `${first}__${second}`;
}

function getRecentDaysStart(dayCount: number) {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  start.setDate(start.getDate() - dayCount);
  return start;
}

function formatOperationalDateKey(dayKey: string) {
  const [year, month, day] = dayKey.split("-").map(Number);

  return new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "short",
    timeZone: DISPARITY_TIME_ZONE,
  }).format(new Date(Date.UTC(year, (month ?? 1) - 1, day ?? 1)));
}

function formatOperationalTime(date: Date) {
  return new Intl.DateTimeFormat("pt-BR", {
    timeStyle: "short",
    timeZone: DISPARITY_TIME_ZONE,
  }).format(date);
}

async function persistSnapshot(
  targetPath: string,
  payload: Record<string, unknown> | Array<unknown>,
) {
  const directory = dirname(targetPath);
  await mkdir(directory, { recursive: true });
  const tempPath = `${targetPath}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(tempPath, JSON.stringify(payload, null, 2), "utf8");
  await rename(tempPath, targetPath);
}

function buildCanonicalEvent(match: RawGtDisparityMatch): {
  pairKey: string;
  playerOne: string;
  playerTwo: string;
  event: CanonicalPairEvent;
} | null {
  const homePlayer = match.home_player ? normalizeName(match.home_player) : "";
  const awayPlayer = match.away_player ? normalizeName(match.away_player) : "";

  if (!homePlayer || !awayPlayer) {
    return null;
  }

  if (
    typeof match.home_score_ft !== "number" ||
    typeof match.away_score_ft !== "number"
  ) {
    return null;
  }

  const homeKey = normalizeKey(homePlayer);
  const awayKey = normalizeKey(awayPlayer);
  const playerOneIsHome = homeKey.localeCompare(awayKey) <= 0;
  const playerOne = playerOneIsHome ? homePlayer : awayPlayer;
  const playerTwo = playerOneIsHome ? awayPlayer : homePlayer;
  const playerOneGoals = playerOneIsHome
    ? match.home_score_ft
    : match.away_score_ft;
  const playerTwoGoals = playerOneIsHome
    ? match.away_score_ft
    : match.home_score_ft;
  const resultCode =
    playerOneGoals > playerTwoGoals
      ? "1"
      : playerOneGoals < playerTwoGoals
        ? "2"
        : "E";

  return {
    pairKey: buildPairKey(playerOne, playerTwo),
    playerOne,
    playerTwo,
    event: {
      matchId: `GT-${match.id_fixture}`,
      seasonId: match.id_season,
      playedAt: match.match_kickoff,
      playerOneGoals,
      playerTwoGoals,
      resultCode,
      fixtureLabel: `${homePlayer} x ${awayPlayer}`,
      playerOneIsHome,
    },
  };
}

async function buildGtDisparitySnapshots() {
  const matches = await prisma.gt_gtapi_fixtures.findMany({
    where: {
      match_kickoff: {
        gte: getRecentDaysStart(PORTAL_GT_DISPARITY_LOOKBACK_DAYS),
      },
    },
    select: {
      id_fixture: true,
      id_season: true,
      match_kickoff: true,
      home_player: true,
      away_player: true,
      home_score_ft: true,
      away_score_ft: true,
    },
    orderBy: {
      match_kickoff: "asc",
    },
  });

  const players = new Map<string, PortalDisparityPlayerSnapshot>();
  const pairs = new Map<
    string,
    {
      playerOne: string;
      playerTwo: string;
      events: CanonicalPairEvent[];
    }
  >();

  for (const match of matches) {
    const canonicalEvent = buildCanonicalEvent(match);

    if (!canonicalEvent) {
      continue;
    }

    players.set(normalizeKey(canonicalEvent.playerOne), {
      id: buildPlayerId(canonicalEvent.playerOne),
      name: canonicalEvent.playerOne,
    });
    players.set(normalizeKey(canonicalEvent.playerTwo), {
      id: buildPlayerId(canonicalEvent.playerTwo),
      name: canonicalEvent.playerTwo,
    });

    const current = pairs.get(canonicalEvent.pairKey) ?? {
      playerOne: canonicalEvent.playerOne,
      playerTwo: canonicalEvent.playerTwo,
      events: [],
    };
    current.events.push(canonicalEvent.event);
    pairs.set(canonicalEvent.pairKey, current);
  }

  const generatedAt = new Date().toISOString();
  const pairSnapshots = new Map<string, PortalDisparityPairSnapshot>();
  const indexPairs: PortalDisparityIndexSnapshot["pairs"] = [];

  for (const [pairKey, pair] of pairs.entries()) {
    const groupedMatches = new Map<string, CanonicalPairEvent[]>();

    for (const event of pair.events.sort(
      (left, right) => left.playedAt.getTime() - right.playedAt.getTime(),
    )) {
      const dayKey = getDisparityOperationalWindow(
        event.playedAt,
        "GT LEAGUE",
      ).dayKey;
      const current = groupedMatches.get(dayKey) ?? [];
      current.push(event);
      groupedMatches.set(dayKey, current);
    }

    const rows: PortalDisparityPairRowSnapshot[] = Array.from(
      groupedMatches.entries(),
    )
      .map(([dayKey, dayMatches]) => {
        const sortedMatches = [...dayMatches].sort(
          (left, right) => left.playedAt.getTime() - right.playedAt.getTime(),
        );
        const startedAt = sortedMatches[0]?.playedAt ?? null;
        const seasonIds = Array.from(
          new Set(
            sortedMatches
              .map((match) => match.seasonId)
              .filter((seasonId): seasonId is number => seasonId !== null),
          ),
        ).sort((left, right) => left - right);
        const seasonStartId = seasonIds[0] ?? null;
        const seasonEndId = seasonIds[seasonIds.length - 1] ?? null;
        const history = sortedMatches.map((match) => ({
          matchId: match.matchId,
          playedAt: match.playedAt.toISOString(),
          localTimeLabel: formatOperationalTime(match.playedAt),
          playerOneGoals: match.playerOneGoals,
          playerTwoGoals: match.playerTwoGoals,
          resultCode: match.resultCode,
          scoreLabel: `${match.playerOneGoals}-${match.playerTwoGoals}`,
          fixtureLabel: match.fixtureLabel,
          playerOneIsHome: match.playerOneIsHome,
        }));

        const playerOneWins = history.filter(
          (item) => item.resultCode === "1",
        ).length;
        const draws = history.filter((item) => item.resultCode === "E").length;
        const playerTwoWins = history.filter(
          (item) => item.resultCode === "2",
        ).length;

        return {
          championshipKey: dayKey,
          dayKey,
          seasonId: seasonStartId,
          seasonLabel:
            seasonStartId !== null && seasonEndId !== null
              ? seasonStartId === seasonEndId
                ? String(seasonStartId)
                : `${seasonStartId}-${seasonEndId}`
              : null,
          displayLabel: formatOperationalDateKey(dayKey),
          dateLabel: formatOperationalDateKey(dayKey),
          playedAt: startedAt?.toISOString() ?? null,
          playerOneWins,
          draws,
          playerTwoWins,
          totalGames: history.length,
          history,
        };
      })
      .sort(
        (left, right) =>
          new Date(right.playedAt ?? 0).getTime() -
          new Date(left.playedAt ?? 0).getTime(),
      );

    const snapshot: PortalDisparityPairSnapshot = {
      generatedAt,
      lastSuccessfulSyncAt: generatedAt,
      lastPublishedAt: generatedAt,
      leagueType: "GT LEAGUE",
      players: {
        playerOne: pair.playerOne,
        playerTwo: pair.playerTwo,
      },
      totalRows: rows.length,
      totalMatches: pair.events.length,
      rows,
    };

    pairSnapshots.set(pairKey, snapshot);
    indexPairs.push({
      pairKey,
      playerOne: pair.playerOne,
      playerTwo: pair.playerTwo,
      totalRows: snapshot.totalRows,
      totalMatches: snapshot.totalMatches,
      lastPlayedAt: rows[0]?.playedAt ?? null,
    });
  }

  const playersSnapshot = Array.from(players.values()).sort((left, right) =>
    left.name.localeCompare(right.name, "pt-BR", { sensitivity: "base" }),
  );

  const indexSnapshot: PortalDisparityIndexSnapshot = {
    generatedAt,
    lastSuccessfulSyncAt: generatedAt,
    lastPublishedAt: generatedAt,
    leagueType: "GT LEAGUE",
    lookbackDays: PORTAL_GT_DISPARITY_LOOKBACK_DAYS,
    playerCount: playersSnapshot.length,
    pairCount: indexPairs.length,
    players: playersSnapshot,
    pairs: indexPairs.sort(
      (left, right) =>
        left.playerOne.localeCompare(right.playerOne, "pt-BR", {
          sensitivity: "base",
        }) ||
        left.playerTwo.localeCompare(right.playerTwo, "pt-BR", {
          sensitivity: "base",
        }),
    ),
  };

  return {
    generatedAt,
    playersSnapshot,
    pairSnapshots,
    indexSnapshot,
  };
}

async function runPortalGTDisparityRefreshSafely() {
  if (gtDisparitySyncInProgress) {
    return;
  }

  gtDisparitySyncInProgress = true;

  try {
    const snapshots = await buildGtDisparitySnapshots();
    const pairsDirectory = getPortalDisparityPairsDirectory();

    await mkdir(pairsDirectory, { recursive: true });

    const writtenFileNames = new Set<string>();

    for (const [pairKey, snapshot] of snapshots.pairSnapshots.entries()) {
      const fileName = `${pairKey}.json`;
      const targetPath = resolve(pairsDirectory, fileName);
      await persistSnapshot(targetPath, snapshot);
      writtenFileNames.add(fileName);
    }

    try {
      const existingFiles = await readdir(pairsDirectory, {
        withFileTypes: true,
      });

      await Promise.all(
        existingFiles
          .filter(
            (entry) =>
              entry.isFile() &&
              entry.name.endsWith(".json") &&
              !writtenFileNames.has(entry.name),
          )
          .map((entry) => unlink(resolve(pairsDirectory, entry.name))),
      );
    } catch {
      // Cleanup is best-effort.
    }

    await persistSnapshot(
      getLegacyDisparityOptionsSnapshotPath(),
      snapshots.playersSnapshot,
    );
    await persistSnapshot(
      getPortalDisparityIndexPath(),
      snapshots.indexSnapshot,
    );
  } catch (error) {
    log.error(
      { err: error },
      "Falha ao atualizar snapshots de disparidade da GT League",
    );
  } finally {
    gtDisparitySyncInProgress = false;
  }
}

export function triggerPortalGTDisparityRefresh() {
  if (gtDisparitySyncInProgress) {
    return;
  }

  void runPortalGTDisparityRefreshSafely();
}

export function startPortalGTDisparityRunner() {
  if (gtDisparityRefreshTimer) {
    return;
  }

  void runPortalGTDisparityRefreshSafely();

  gtDisparityRefreshTimer = setInterval(() => {
    void runPortalGTDisparityRefreshSafely();
  }, PORTAL_GT_DISPARITY_REFRESH_INTERVAL_MS);

  log.info(
    { intervalMs: PORTAL_GT_DISPARITY_REFRESH_INTERVAL_MS },
    "Snapshots de disparidade da GT League ativos",
  );
}
