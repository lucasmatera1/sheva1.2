import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { Prisma } from "@prisma/client";
import {
  calculateBacktestMetrics,
  evaluateMethodDefinition,
  type BacktestEntry,
  type DashboardOverview,
  type MethodDefinition,
} from "@sheva/shared";
import { prisma } from "./prisma";
import { createLogger } from "./logger";
import { mockMethods } from "./mock-data";

const log = createLogger("live-analytics");

type LeagueType = "GT LEAGUE" | "8MIN BATTLE" | "H2H" | "6MIN VOLTA";

const appScope =
  process.env.SHEVA_APP_SCOPE === "basket" ? "basket" : "default";
const h2hDataSource =
  process.env.SHEVA_H2H_SOURCE === "ebasket" ? "ebasket" : "esoccer";
const EIGHT_MIN_OPERATIONAL_WINDOW_START_MINUTE = 17 * 60 + 30;
const EIGHT_MIN_OPERATIONAL_WINDOW_END_MINUTE = 1 * 60 + 50;

type UnifiedMatch = {
  id: string;
  leagueType: LeagueType;
  leagueGroup?: string | null;
  seasonId: number | null;
  playedAt: Date;
  homePlayer: string;
  awayPlayer: string;
  homeScoreHt: number | null;
  awayScoreHt: number | null;
  homeScore: number;
  awayScore: number;
};

type MethodTableConfig = {
  id: string;
  name: string;
  description: string;
  leagueType: LeagueType;
  tableName: string;
  entriesColumn: string;
  playerOneColumn: string;
  playerTwoColumn: string;
  hcColumn: string;
};

type MethodSummary = {
  id: string;
  name: string;
  description: string;
  leagueType: LeagueType;
  entries: number;
  netProfit: number;
  roi: number;
  source?: "aggregate" | "timeline";
};

type MethodBreakdownRow = {
  playerA: string | null;
  playerB: string | null;
  handicap: string | null;
  entries: number;
  netProfit: number;
  roi: number;
};

type PlayerAggregate = {
  id: string;
  name: string;
  totalGames: number;
  wins: number;
  draws: number;
  losses: number;
  goalsFor: number;
  goalsAgainst: number;
  goalDifference: number;
  winRate: number;
  averageGoalsFor: number;
  averageGoalsAgainst: number;
  over25Rate: number;
  bttsRate: number;
  cleanSheetRate: number;
  scoredRate: number;
  concededRate: number;
  maxWinStreak: number;
  maxLossStreak: number;
};

type FormSample = {
  sampleSize: number;
  wins: number;
  draws: number;
  losses: number;
  winRate: number;
};

type PlayerSplitMetrics = {
  totalGames: number;
  wins: number;
  draws: number;
  losses: number;
  winRate: number;
  goalsForAverage: number;
  goalsAgainstAverage: number;
  over25Rate: number;
  bttsRate: number;
};

type CacheEntry<T> = {
  expiresAt: number;
  data: T | null;
};

type TimelineMethodConfig = {
  id: string;
  leagueType: LeagueType;
  definition: MethodDefinition;
  marketLabel: string;
};

type TimelineMethodSummary = MethodSummary;

type OddRecord = {
  eventId: number;
  matchDatetime: Date;
  marketDatetime: Date;
  homePlayer: string;
  awayPlayer: string;
  homeOdd: number | null;
  awayOdd: number | null;
};

type EbasketRawMatchRow = {
  id_fixture: string | number;
  id_season: number | null;
  match_kickoff: Date;
  home_player: string | null;
  away_player: string | null;
  home_team: string | null;
  away_team: string | null;
  home_score_ht: number | null;
  away_score_ht: number | null;
  home_score_ft: number | null;
  away_score_ft: number | null;
};

async function loadEbasketMatchesFromNewTable(
  since?: Date,
): Promise<EbasketRawMatchRow[]> {
  if (since) {
    return prisma.$queryRaw<EbasketRawMatchRow[]>`
      SELECT
        id_fixture,
        id_season,
        match_kickoff,
        home_player,
        away_player,
        home_team,
        away_team,
        home_score_ht,
        away_score_ht,
        home_score_ft,
        away_score_ft
      FROM fifa.h2h_ebasket_fixtures_new
      WHERE match_kickoff >= ${since}
      ORDER BY match_kickoff DESC
    `;
  }

  return prisma.$queryRaw<EbasketRawMatchRow[]>`
    SELECT
      id_fixture,
      id_season,
      match_kickoff,
      home_player,
      away_player,
      home_team,
      away_team,
      home_score_ht,
      away_score_ht,
      home_score_ft,
      away_score_ft
    FROM fifa.h2h_ebasket_fixtures_new
    ORDER BY match_kickoff DESC
  `;
}

type PlayerListFilters = {
  query?: string;
  limit?: number;
  minGames?: number;
  activeWithinDays?: number;
  leagueType?: LeagueType;
  sortBy?:
    | "winRateDesc"
    | "winRateAsc"
    | "maxWinStreak"
    | "maxLossStreak"
    | "winRate"
    | "profit"
    | "games"
    | "goalsFor";
};

type PlayerDashboardFilters = {
  query?: string;
  limit?: number;
  minGames?: number;
  leagueType?: LeagueType;
};

type PlayerMethodDashboardStat = {
  methodId: string;
  methodName: string;
  leagueType: LeagueType;
  entries: number;
  netProfit: number;
  roi: number;
};

type PlayerMethodAuditFilters = {
  playerName: string;
  leagueType?: LeagueType;
  startDayKey?: string;
  endDayKey?: string;
};

type PlayerMethodAuditEntry = {
  matchId: string;
  dayKey: string;
  localTimeLabel: string;
  localPlayedAtLabel: string;
  seasonId: number | null;
  opponent: string;
  result: "W" | "D" | "L";
  fullTimeScore: string;
  previousTwo: Array<"W" | "D" | "L">;
  previousThree: Array<"W" | "D" | "L">;
  previousFour: Array<"W" | "D" | "L">;
  previousFive: Array<"W" | "D" | "L">;
  enters2LosesStreak: boolean;
  enters2LosesFullStreak: boolean;
  enters3LosesStreak: boolean;
  enters3LosesFullStreak: boolean;
  enters4LosesStreak: boolean;
  enters4LosesFullStreak: boolean;
  enters5LosesStreak: boolean;
  enters5LosesFullStreak: boolean;
};

type PlayerMethodOutcomeSummary = {
  methodId:
    | "2-loses-streak"
    | "2-loses-full-streak"
    | "3-loses-streak"
    | "3-loses-full-streak"
    | "4-loses-streak"
    | "4-loses-full-streak"
    | "5-loses-streak"
    | "5-loses-full-streak";
  label: string;
  entries: number;
  wins: number;
  draws: number;
  losses: number;
  winRate: number;
  drawRate: number;
  lossRate: number;
};

type PlayerMethodAuditLogDay = {
  dayKey: string;
  sequence: string;
  lines: string[];
};

type PlayerMethodAuditHistoryMatch = ReturnType<
  typeof buildDisparityMatchDetail
> & {
  seasonId: number | null;
  isMethodEntry: boolean;
};

type PlayerMethodAuditHistoryDay = {
  dayKey: string;
  displayDate: string;
  sequence: Array<"W" | "D" | "L">;
  matches: PlayerMethodAuditHistoryMatch[];
};

type PlayerMethodAuditPlayer = {
  name: string;
  dailyHistory: PlayerMethodAuditHistoryDay[];
  auditEntries: PlayerMethodAuditEntry[];
  methodSummaries: PlayerMethodOutcomeSummary[];
  logs: PlayerMethodAuditLogDay[];
  summary: {
    totalGames: number;
    validEntries: number;
    twoLosesStreakEntries: number;
    twoLosesFullStreakEntries: number;
    threeLosesStreakEntries: number;
    threeLosesFullStreakEntries: number;
    fourLosesStreakEntries: number;
    fourLosesFullStreakEntries: number;
    fiveLosesStreakEntries: number;
    fiveLosesFullStreakEntries: number;
  };
};

type PlayerMethodAuditResponse = {
  filters: {
    playerName: string;
    leagueType: LeagueType;
    startDayKey: string | null;
    endDayKey: string | null;
  };
  availableDayKeys: string[];
  selectedDayKeys: string[];
  player: PlayerMethodAuditPlayer;
};

export type ConfrontationMethodsLeagueType =
  | "GT LEAGUE"
  | "8MIN BATTLE"
  | "6MIN VOLTA";

export type ConfrontationMethodCode =
  | "T+"
  | "E"
  | "(2E)"
  | "(2D)"
  | "(2D+)"
  | "(3D)"
  | "(3D+)"
  | "(4D)"
  | "(4D+)"
  | "HC-2"
  | "HC-3"
  | "HC-4"
  | "HC-5";

export type ConfrontationSeriesCode = "A" | "B" | "C" | "D" | "E" | "F" | "G";

type ConfrontationMethodOccurrence = {
  matchId: string;
  dayKey: string;
  dayLabel: string;
  windowLabel: string;
  localTimeLabel: string;
  localPlayedAtLabel: string;
  playedAtIso: string;
  seasonId: number | null;
  result: DashboardSequenceResult;
  fullTimeScore: string;
  triggerSequence: DashboardSequenceResult[];
  daySequence: DashboardSequenceResult[];
  dayHistory: Array<{
    matchId: string;
    matchNumber: number;
    localTimeLabel: string;
    localPlayedAtLabel: string;
    result: DashboardSequenceResult;
    fullTimeScore: string;
    isMethodEntry: boolean;
  }>;
};

type ConfrontationMethodRow = {
  confrontationKey: string;
  confrontationLabel: string;
  totalOccurrences: number;
  wins: number;
  draws: number;
  losses: number;
  apx: number;
  history: ConfrontationMethodOccurrence[];
};

export type ConfrontationMethodOccurrenceRecord = {
  leagueType: ConfrontationMethodsLeagueType;
  methodCode: ConfrontationMethodCode;
  series: ConfrontationSeriesCode | null;
  playerName: string;
  opponentName: string;
  confrontationKey: string;
  confrontationLabel: string;
  occurrenceMatchId: string;
  occurrencePlayedAt: string;
  dayKey: string;
  dayLabel: string;
  windowLabel: string;
  seasonId: number | null;
  result: DashboardSequenceResult;
  fullTimeScore: string;
  wins: number;
  draws: number;
  losses: number;
  apx: number;
  totalOccurrences: number;
  triggerSequence: DashboardSequenceResult[];
  daySequence: DashboardSequenceResult[];
  dayHistory: ConfrontationMethodOccurrence["dayHistory"];
};

type ConfrontationMethodsResponse = {
  generatedAt: string;
  leagueType: ConfrontationMethodsLeagueType;
  methodCode: ConfrontationMethodCode;
  availableMethods: Array<{
    code: ConfrontationMethodCode;
    label: string;
  }>;
  rows: ConfrontationMethodRow[];
};

type PlayerSessionMethodCode =
  | "4D Jogador"
  | "4W Jogador"
  | "5D Jogador"
  | "5W Jogador"
  | "Fav T1"
  | "Fav T2"
  | "Fav T3"
  | "Após DL"
  | "Após WDL"
  | "Após LWW"
  | "Após LL"
  | "Após DD"
  | "Após LDW"
  | "Após DLL"
  | "Após WLD"
  | "Após DLD"
  | "Após LLW"
  | "Após LWL"
  | "Após WDD"
  | "Após DLW"
  | "Após LLL"
  | "Após LWD"
  | "Após WWL"
  | "Após WWD"
  | "Após DDW"
  | "Após LLLL";

type FuturePlayerSessionMethodRow = {
  fixtureId: string;
  confrontationKey: string;
  confrontationLabel: string;
  fixtureLabel: string;
  leagueType: ConfrontationMethodsLeagueType;
  groupLabel: string | null;
  seasonId: number | null;
  playedAtIso: string;
  localPlayedAtLabel: string;
  playerName: string;
  opponentName: string;
  methodCode: PlayerSessionMethodCode;
  apx: number;
  totalOccurrences: number;
  wins: number;
  draws: number;
  losses: number;
  occurrenceResults: DashboardSequenceResult[];
  triggerSequence: DashboardSequenceResult[];
  daySequence: DashboardSequenceResult[];
  playerWinRate: number;
  opponentWinRate: number;
  h2hLast48: { total: number; wins: number; wr: number };
  h2hLast24: { total: number; wins: number; wr: number };
};

type FuturePlayerSessionMethodsResponse = {
  generatedAt: string;
  leagueType: ConfrontationMethodsLeagueType;
  currentWindow: DashboardLeagueJSnapshotResponse["currentWindow"];
  availableMethods: Array<{
    code: PlayerSessionMethodCode;
    label: string;
  }>;
  rows: FuturePlayerSessionMethodRow[];
};

type ConfrontationMethodsOptions = {
  series?: ConfrontationSeriesCode;
  includeHistory?: boolean;
  confrontationKey?: string;
  confrontationKeys?: string[];
  days?: number;
};

type DashboardWindowOptions = {
  days?: number;
  leagueType?: LeagueType;
};

type DashboardUpcomingFixture = {
  id: string;
  leagueType: LeagueType;
  seasonId: number | null;
  playedAt: string;
  homePlayer: string;
  awayPlayer: string;
  groupLabel: string | null;
};

type InternalDashboardUpcomingFixture = Omit<
  DashboardUpcomingFixture,
  "playedAt"
> & {
  playedAt: Date;
};

type DashboardUpcomingFixturesResponse = {
  generatedAt: string;
  totalFixtures: number;
  warning?: string;
  leagues: Array<{
    leagueType: LeagueType;
    totalFixtures: number;
    fixtures: DashboardUpcomingFixture[];
  }>;
};

type DashboardSnapshotLeagueType = "GT LEAGUE" | "8MIN BATTLE" | "6MIN VOLTA";

type DashboardSequenceResult = "W" | "D" | "L";

type DashboardPlayerMatchDetail = {
  id: string;
  playedAt: string;
  homePlayer: string;
  awayPlayer: string;
  opponent: string;
  seasonId: number | null;
  result: DashboardSequenceResult;
  scoreLabel: string;
};

type DashboardPlayerFixtureDetail = {
  id: string;
  playedAt: string;
  homePlayer: string;
  awayPlayer: string;
  opponent: string;
  seasonId: number | null;
};

type DashboardPlayerPreviousWindow = {
  key: string;
  dayLabel: string;
  windowLabel: string;
  rangeLabel: string;
  totalGames: number;
  wins: number;
  draws: number;
  losses: number;
  latestPlayedAt: string | null;
  sequence: DashboardSequenceResult[];
  matches: DashboardPlayerMatchDetail[];
};

type DashboardLeagueJSnapshotResponse = {
  generatedAt: string;
  leagueType: DashboardSnapshotLeagueType;
  warning?: string;
  availableDays: Array<{
    dayKey: string;
    dayLabel: string;
  }>;
  currentWindow: {
    dayKey: string;
    dayLabel: string;
    windowLabel: string;
    rangeLabel: string;
    description: string;
    usesOperationalDay: boolean;
  };
  totals: {
    activePlayers: number;
    totalGames: number;
    wins: number;
    draws: number;
    losses: number;
    winRate: number;
    totalDayMatches: number;
    currentWindowPlayedMatches: number;
    currentWindowUpcomingFixtures: number;
  };
  fixtures: Array<{
    id: string;
    playedAt: string;
    homePlayer: string;
    awayPlayer: string;
    seasonId: number | null;
    groupLabel?: string | null;
    pendingResult?: boolean;
  }>;
  players: Array<{
    id: string;
    name: string;
    leagueGroup?: string | null;
    totalGames: number;
    wins: number;
    draws: number;
    losses: number;
    winRate: number;
    currentWindowGames: number;
    upcomingWindowGames: number;
    daySequence: DashboardSequenceResult[];
    latestPlayedAt: string | null;
    nextFixtureAt: string | null;
    upcomingFixtures: DashboardPlayerFixtureDetail[];
    recentMatches: DashboardPlayerMatchDetail[];
    previousWindows: DashboardPlayerPreviousWindow[];
    hasPreviousWindows: boolean;
  }>;
};

type DashboardSnapshotFixture =
  DashboardLeagueJSnapshotResponse["fixtures"][number];

const DISPARITY_VOLTA_LOOKBACK_DAYS = 30;

/**
 * Checks whether any fixture without a confirmed result exists for a given
 * player **before** a target fixture time.
 *
 * This covers two scenarios:
 *   1. "In-flight" games — kickoff already passed but score not yet recorded
 *      (`pendingResult === true`).
 *   2. "Upcoming" games — kickoff is still in the future (no result possible
 *      yet).  Without this the guard has a blind spot: an upcoming game
 *      between the last completed result and the target fixture would be
 *      skipped, causing the evaluation to fire too early with an incomplete
 *      sequence.
 *
 * IMPORTANT — Every "future method" function MUST use an appropriate prior-game
 * guard before emitting a signal. Player-session and favorito-vs-fraco methods
 * depend on the full player timeline and should use this player-wide guard.
 * Confrontation methods depend on the head-to-head timeline and should use the
 * pair-specific guard below.
 */
export function hasPlayerPendingPriorGame(
  fixtures: ReadonlyArray<{
    playedAt: string;
    homePlayer: string;
    awayPlayer: string;
    pendingResult?: boolean;
  }>,
  playerNames: string[],
  fixtureAtMs: number,
): boolean {
  const keys = playerNames.map((n) => normalizeKey(n));
  const nowMs = Date.now();
  return fixtures.some((f) => {
    const fAt = new Date(f.playedAt).getTime();
    if (fAt >= fixtureAtMs) return false;
    // Skip completed games (kickoff in the past AND result already recorded)
    if (!f.pendingResult && fAt <= nowMs) return false;
    const fHome = normalizeKey(f.homePlayer);
    const fAway = normalizeKey(f.awayPlayer);
    return keys.some((k) => fHome === k || fAway === k);
  });
}

export function hasPendingPriorConfrontationGame(
  fixtures: ReadonlyArray<{
    playedAt: string;
    homePlayer: string;
    awayPlayer: string;
    pendingResult?: boolean;
  }>,
  playerNames: [string, string],
  fixtureAtMs: number,
): boolean {
  const pairKey = buildNormalizedPairKey(playerNames[0], playerNames[1]);
  const nowMs = Date.now();
  return fixtures.some((f) => {
    const fAt = new Date(f.playedAt).getTime();
    if (fAt >= fixtureAtMs) return false;
    if (!f.pendingResult && fAt <= nowMs) return false;
    return buildNormalizedPairKey(f.homePlayer, f.awayPlayer) === pairKey;
  });
}

function buildNormalizedPairKey(playerA: string, playerB: string) {
  return [normalizeKey(playerA), normalizeKey(playerB)].sort().join("||");
}

function buildDashboardSnapshotFixtureKey(
  fixture: Pick<
    DashboardSnapshotFixture,
    "playedAt" | "homePlayer" | "awayPlayer" | "seasonId"
  >,
) {
  return `${normalizeKey(fixture.homePlayer)}__${normalizeKey(fixture.awayPlayer)}__${fixture.playedAt}__${fixture.seasonId ?? "-"}`;
}

function shouldPreferDashboardSnapshotFixture(
  candidate: DashboardSnapshotFixture,
  current: DashboardSnapshotFixture,
) {
  const candidateResolved = candidate.pendingResult !== true;
  const currentResolved = current.pendingResult !== true;

  if (candidateResolved !== currentResolved) {
    return candidateResolved;
  }

  const candidateIsFuturePlaceholder = candidate.id.startsWith("GT-FM-");
  const currentIsFuturePlaceholder = current.id.startsWith("GT-FM-");

  if (candidateIsFuturePlaceholder !== currentIsFuturePlaceholder) {
    return !candidateIsFuturePlaceholder;
  }

  return false;
}

function mergeDashboardSnapshotFixtures(fixtures: DashboardSnapshotFixture[]) {
  const mergedFixtures = new Map<string, DashboardSnapshotFixture>();

  for (const fixture of [...fixtures].sort(
    (left, right) =>
      new Date(left.playedAt).getTime() - new Date(right.playedAt).getTime(),
  )) {
    const fixtureKey = buildDashboardSnapshotFixtureKey(fixture);
    const currentFixture = mergedFixtures.get(fixtureKey);

    if (
      !currentFixture ||
      shouldPreferDashboardSnapshotFixture(fixture, currentFixture)
    ) {
      mergedFixtures.set(fixtureKey, fixture);
    }
  }

  return Array.from(mergedFixtures.values()).sort(
    (left, right) =>
      new Date(left.playedAt).getTime() - new Date(right.playedAt).getTime(),
  );
}

function isDashboardSnapshotComplete(
  snapshot: DashboardLeagueJSnapshotResponse,
) {
  return snapshot.players.every(
    (player) =>
      Array.isArray(player.daySequence) &&
      Array.isArray(player.upcomingFixtures) &&
      Array.isArray(player.recentMatches) &&
      Array.isArray(player.previousWindows),
  );
}

type DisparityLeagueType = "GT LEAGUE" | "6MIN VOLTA" | "H2H";

const DISPARITY_OPERATIONAL_TIME_ZONE = "America/Sao_Paulo";

type DisparityConfig = {
  title: string;
  gamesPerOpponent: number;
  gamesPerDay: number;
  operationalDayStartMinute: number;
  windowTwoStartMinute: number;
  windowThreeStartMinute: number;
  windowFourStartMinute?: number;
  windowFiveStartMinute?: number;
};

type DashboardWindowLabel = "J1" | "J2" | "J3" | "J4" | "J5" | "Dia";

type TimelinePlayerState = {
  totalGames: number;
  wins: number;
  goalsFor: number;
  goalsAgainst: number;
  over25Games: number;
  bttsGames: number;
  recentResults: Array<"W" | "D" | "L">;
};

type TimelineBacktestResult = {
  methodId: string;
  methodName: string;
  leagueType: LeagueType;
  mode: "timeline";
  source: "timeline";
  limitations: string[];
  entries: BacktestEntry[];
  breakdown: MethodBreakdownRow[];
  segments: {
    equityCurve: Array<{ index: number; balance: number; playedAt: string }>;
    byMonth: Array<{ month: string; entries: number; netProfit: number }>;
  };
  metrics: ReturnType<typeof calculateBacktestMetrics>;
};

const MATCH_CACHE_TTL_MS = 60_000;
const METHOD_CACHE_TTL_MS = 60_000;
const TIMELINE_CACHE_TTL_MS = 300_000;
const TIMELINE_MATCH_LIMIT = 8_000;
const DASHBOARD_UPCOMING_FIXTURES_CACHE_TTL_MS = 15_000;
const DASHBOARD_CURRENT_J_CACHE_TTL_MS = 15_000;
const DISPARITY_PLAYERS_CACHE_TTL_MS = 60_000;
const DISPARITY_DETAIL_CACHE_TTL_MS = 120_000;
const DISPARITY_PAIR_LOOKBACK_DAYS = 120;
const GT_XRAY_LOOKBACK_DAYS = 45;
const GT_XRAY_REQUIRED_DAY_COUNT = 10;
const GT_XRAY_SCAN_MIN_HIT_RATE = 50;
const GT_XRAY_MIN_HIT_RATE = 65;
const DISPARITY_VOLTA_DETAIL_LOOKBACK_DAYS = 120;
const DISPARITY_VOLTA_DAILY_STUDY_LIMIT = 60;
const DISPARITY_VOLTA_OPPONENT_LIMIT = 120;

const matchCache: CacheEntry<UnifiedMatch[]> = {
  expiresAt: 0,
  data: null,
};

const methodCache: CacheEntry<MethodSummary[]> = {
  expiresAt: 0,
  data: null,
};

const playerMethodCache: CacheEntry<
  Record<string, PlayerMethodDashboardStat[]>
> = {
  expiresAt: 0,
  data: null,
};

const timelineCache: CacheEntry<Record<string, TimelineBacktestResult>> = {
  expiresAt: 0,
  data: null,
};

const dashboardUpcomingFixturesCache: CacheEntry<
  InternalDashboardUpcomingFixture[]
> = {
  expiresAt: 0,
  data: null,
};

const dashboardCurrentJCache: CacheEntry<
  Record<string, DashboardLeagueJSnapshotResponse>
> = {
  expiresAt: 0,
  data: null,
};

const disparityPlayersCache: CacheEntry<
  Record<
    string,
    Array<{
      id: string;
      name: string;
      totalGames: number;
      wins: number;
      draws: number;
      losses: number;
      winRate: number;
    }>
  >
> = {
  expiresAt: 0,
  data: null,
};

const disparityDetailCache: CacheEntry<Record<string, unknown>> = {
  expiresAt: 0,
  data: null,
};
const gtLeagueLiveTableCache = new Map<
  string,
  { data: Record<string, unknown>; expiresAt: number }
>();
const GT_LIVE_TABLE_CACHE_TTL_MS = 30_000;
const GT_LIVE_TABLE_DAY_LOOKBACK_DAYS = 2;
const GT_LIVE_TABLE_RECENT_HISTORY_LIMIT = 10;
const GT_LIVE_TABLE_HISTORY_DAY_OPTIONS = [5, 10, 15, 30, 60] as const;
const GT_LIVE_TABLE_DEFAULT_HISTORY_DAYS = 30;
const GT_LIVE_TABLE_SCORELINES = [
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

function normalizeGtLiveTableHistoryDays(value?: number | null) {
  return GT_LIVE_TABLE_HISTORY_DAY_OPTIONS.includes(
    value as (typeof GT_LIVE_TABLE_HISTORY_DAY_OPTIONS)[number],
  )
    ? (value as (typeof GT_LIVE_TABLE_HISTORY_DAY_OPTIONS)[number])
    : GT_LIVE_TABLE_DEFAULT_HISTORY_DAYS;
}

function getGtRaioXSnapshotPath() {
  return resolve(
    process.cwd(),
    "tmp",
    "portal-xray",
    "views",
    "gt-league.json",
  );
}

function getGtPanoramaSnapshotPath() {
  return resolve(
    process.cwd(),
    "tmp",
    "portal-panorama",
    "views",
    "gt-league.json",
  );
}

function getGtPanoramaDaySnapshotPath(dayKey: string) {
  return resolve(
    process.cwd(),
    "tmp",
    "portal-panorama",
    "views",
    `gt-league-${dayKey}.json`,
  );
}

function getGtDisparityOptionsSnapshotPath() {
  return resolve(
    process.cwd(),
    "tmp",
    "portal-disparity-options",
    "views",
    "gt-league.json",
  );
}

async function persistPortalSnapshot(
  targetPath: string,
  payload: Record<string, unknown> | Array<unknown>,
) {
  const directory = dirname(targetPath);
  await mkdir(directory, { recursive: true });
  const tempPath = `${targetPath}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(tempPath, JSON.stringify(payload, null, 2), "utf8");
  await rename(tempPath, targetPath);
}

async function persistGtRaioXSnapshot(payload: Record<string, unknown>) {
  await persistPortalSnapshot(getGtRaioXSnapshotPath(), payload);
}

async function persistGtPanoramaSnapshot(payload: Record<string, unknown>) {
  await persistPortalSnapshot(getGtPanoramaSnapshotPath(), payload);
  const dayKey = typeof payload.dayKey === "string" ? payload.dayKey : null;
  if (dayKey) {
    await persistPortalSnapshot(getGtPanoramaDaySnapshotPath(dayKey), payload);
  }
}

async function persistGtDisparityOptionsSnapshot(
  payload: Array<{ id: string; name: string }>,
) {
  await persistPortalSnapshot(getGtDisparityOptionsSnapshotPath(), payload);
}

const METHOD_TABLES: MethodTableConfig[] = [
  {
    id: "dados_ult30d_metodo",
    name: "Metodo Ultimos 30D",
    description: "Resumo agregado do metodo base nos ultimos 30 dias.",
    leagueType: "GT LEAGUE",
    tableName: "dados_ult30d_metodo",
    entriesColumn: "count",
    playerOneColumn: "new_player1",
    playerTwoColumn: "new_player2",
    hcColumn: "HC",
  },
  {
    id: "dados_ult30d_metodo3dif",
    name: "Metodo 3 Diferencas",
    description: "Resumo agregado do metodo 3dif nos ultimos 30 dias.",
    leagueType: "GT LEAGUE",
    tableName: "dados_ult30d_metodo3dif",
    entriesColumn: "count",
    playerOneColumn: "new_player1",
    playerTwoColumn: "new_player2",
    hcColumn: "HC",
  },
  {
    id: "dados_ult30d_metodoantigo2d",
    name: "Metodo Antigo 2D",
    description: "Resumo agregado do metodo antigo 2d.",
    leagueType: "GT LEAGUE",
    tableName: "dados_ult30d_metodoantigo2d",
    entriesColumn: "count",
    playerOneColumn: "new_player1",
    playerTwoColumn: "new_player2",
    hcColumn: "HC",
  },
  {
    id: "dados_ult30d_metodoantigo3d",
    name: "Metodo Antigo 3D",
    description: "Resumo agregado do metodo antigo 3d.",
    leagueType: "GT LEAGUE",
    tableName: "dados_ult30d_metodoantigo3d",
    entriesColumn: "count",
    playerOneColumn: "new_player1",
    playerTwoColumn: "new_player2",
    hcColumn: "HC",
  },
  {
    id: "dados_ult30d_2derrotas",
    name: "Metodo 2 Derrotas",
    description: "Resumo agregado do metodo de recuperacao apos 2 derrotas.",
    leagueType: "GT LEAGUE",
    tableName: "dados_ult30d_2derrotas",
    entriesColumn: "count",
    playerOneColumn: "new_player1",
    playerTwoColumn: "new_player2",
    hcColumn: "HC",
  },
  {
    id: "dados_ult30d_3derrotas",
    name: "Metodo 3 Derrotas",
    description: "Resumo agregado do metodo de recuperacao apos 3 derrotas.",
    leagueType: "GT LEAGUE",
    tableName: "dados_ult30d_3derrotas",
    entriesColumn: "count",
    playerOneColumn: "new_player1",
    playerTwoColumn: "new_player2",
    hcColumn: "HC",
  },
  {
    id: "dados_ult30d_troca",
    name: "Metodo Troca",
    description: "Resumo agregado do metodo troca.",
    leagueType: "GT LEAGUE",
    tableName: "dados_ult30d_troca",
    entriesColumn: "count",
    playerOneColumn: "player1",
    playerTwoColumn: "player2",
    hcColumn: "new_HC",
  },
  {
    id: "volta_dados_ult30d_metodo",
    name: "Volta Metodo Ultimos 30D",
    description: "Resumo agregado do metodo base em 6MIN VOLTA.",
    leagueType: "6MIN VOLTA",
    tableName: "volta_dados_ult30d_metodo",
    entriesColumn: "count",
    playerOneColumn: "new_player1",
    playerTwoColumn: "new_player2",
    hcColumn: "HC",
  },
  {
    id: "volta_dados_ult30d_metodo3dif",
    name: "Volta Metodo 3 Diferencas",
    description: "Resumo agregado do metodo 3dif em 6MIN VOLTA.",
    leagueType: "6MIN VOLTA",
    tableName: "volta_dados_ult30d_metodo3dif",
    entriesColumn: "count",
    playerOneColumn: "new_player1",
    playerTwoColumn: "new_player2",
    hcColumn: "HC",
  },
  {
    id: "volta_dados_ult30d_metodoantigo2d",
    name: "Volta Metodo Antigo 2D",
    description: "Resumo agregado do metodo antigo 2d em 6MIN VOLTA.",
    leagueType: "6MIN VOLTA",
    tableName: "volta_dados_ult30d_metodoantigo2d",
    entriesColumn: "count",
    playerOneColumn: "new_player1",
    playerTwoColumn: "new_player2",
    hcColumn: "HC",
  },
  {
    id: "volta_dados_ult30d_metodoantigo3d",
    name: "Volta Metodo Antigo 3D",
    description: "Resumo agregado do metodo antigo 3d em 6MIN VOLTA.",
    leagueType: "6MIN VOLTA",
    tableName: "volta_dados_ult30d_metodoantigo3d",
    entriesColumn: "count",
    playerOneColumn: "new_player1",
    playerTwoColumn: "new_player2",
    hcColumn: "HC",
  },
  {
    id: "volta_dados_ult30d_2derrotas",
    name: "Volta Metodo 2 Derrotas",
    description:
      "Resumo agregado do metodo de recuperacao apos 2 derrotas em 6MIN VOLTA.",
    leagueType: "6MIN VOLTA",
    tableName: "volta_dados_ult30d_2derrotas",
    entriesColumn: "count",
    playerOneColumn: "new_player1",
    playerTwoColumn: "new_player2",
    hcColumn: "HC",
  },
  {
    id: "volta_dados_ult30d_3derrotas",
    name: "Volta Metodo 3 Derrotas",
    description:
      "Resumo agregado do metodo de recuperacao apos 3 derrotas em 6MIN VOLTA.",
    leagueType: "6MIN VOLTA",
    tableName: "volta_dados_ult30d_3derrotas",
    entriesColumn: "count",
    playerOneColumn: "new_player1",
    playerTwoColumn: "new_player2",
    hcColumn: "HC",
  },
  {
    id: "volta_dados_ult30d_troca",
    name: "Volta Metodo Troca",
    description: "Resumo agregado do metodo troca em 6MIN VOLTA.",
    leagueType: "6MIN VOLTA",
    tableName: "volta_dados_ult30d_troca",
    entriesColumn: "count",
    playerOneColumn: "player1",
    playerTwoColumn: "player2",
    hcColumn: "new_HC",
  },
];

const TIMELINE_METHODS: TimelineMethodConfig[] = [
  {
    id: "favorito-forma-recente",
    leagueType: "GT LEAGUE",
    marketLabel: "Match Winner",
    definition: mockMethods[0] as MethodDefinition,
  },
  {
    id: "over-25-ofensivo",
    leagueType: "GT LEAGUE",
    marketLabel: "Over 2.5",
    definition: mockMethods[1] as MethodDefinition,
  },
];

const round = (value: number) => Number(value.toFixed(2));

function normalizeLeagueGroup(leagueType: LeagueType, group?: string | null) {
  if (leagueType !== "GT LEAGUE") {
    return null;
  }

  const normalizedGroup = (group ?? "").trim().toUpperCase();

  return normalizedGroup || null;
}

function getLeagueGroupOrderValue(group: string) {
  const normalizedGroup = group.trim().toUpperCase();
  const firstLetter = normalizedGroup.match(/[A-Z]/)?.[0];

  if (firstLetter) {
    return firstLetter.charCodeAt(0) - 65;
  }

  const numericValue = Number.parseInt(normalizedGroup.replace(/\D+/g, ""), 10);
  return Number.isFinite(numericValue) ? numericValue : Number.MAX_SAFE_INTEGER;
}

function getSequentialGroupLabel(index: number) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  let currentIndex = index;
  let label = "";

  do {
    label = alphabet[currentIndex % 26] + label;
    currentIndex = Math.floor(currentIndex / 26) - 1;
  } while (currentIndex >= 0);

  return `Grupo ${label}`;
}

function filterMatchesByDays(matches: UnifiedMatch[], days?: number) {
  if (!days || days <= 0) {
    return matches;
  }

  const latestPlayedAt = matches[0]?.playedAt;
  if (!latestPlayedAt) {
    return matches;
  }

  const threshold = latestPlayedAt.getTime() - days * 24 * 60 * 60 * 1000;
  return matches.filter((match) => match.playedAt.getTime() >= threshold);
}

function filterMatchesByLeague(
  matches: UnifiedMatch[],
  leagueType?: LeagueType,
) {
  if (!leagueType) {
    return matches;
  }

  return matches.filter((match) => match.leagueType === leagueType);
}

function filterTimelineBacktestByDays(
  backtest: TimelineBacktestResult,
  days?: number,
): TimelineBacktestResult {
  if (!days || days <= 0 || !backtest.entries.length) {
    return backtest;
  }

  const latestPlayedAt = new Date(
    backtest.entries[backtest.entries.length - 1].playedAt,
  );
  const threshold = latestPlayedAt.getTime() - days * 24 * 60 * 60 * 1000;
  const filteredEntries = backtest.entries.filter(
    (entry) => new Date(entry.playedAt).getTime() >= threshold,
  );
  const metrics = calculateBacktestMetrics(filteredEntries);
  const equityCurve = filteredEntries.reduce<
    Array<{ index: number; balance: number; playedAt: string }>
  >((accumulator, entry, entryIndex) => {
    const balance = round(
      (accumulator[accumulator.length - 1]?.balance ?? 0) + entry.profit,
    );
    accumulator.push({
      index: entryIndex + 1,
      balance,
      playedAt: entry.playedAt,
    });
    return accumulator;
  }, []);

  const breakdown = filteredEntries
    .slice(-100)
    .reverse()
    .map((entry) => ({
      playerA: entry.playerRef.split(" x ")[0] ?? null,
      playerB: entry.playerRef.split(" x ")[1] ?? null,
      handicap: backtest.breakdown[0]?.handicap ?? null,
      entries: 1,
      netProfit: entry.profit,
      roi: entry.odd ? round(entry.profit * 100) : 0,
    }));

  const byMonth = Array.from(
    filteredEntries.reduce((map, entry) => {
      const key = entry.playedAt.slice(0, 7);
      const current = map.get(key) ?? { month: key, entries: 0, netProfit: 0 };
      current.entries += 1;
      current.netProfit += entry.profit;
      map.set(key, current);
      return map;
    }, new Map<string, { month: string; entries: number; netProfit: number }>()),
  ).map(([, item]) => ({ ...item, netProfit: round(item.netProfit) }));

  return {
    ...backtest,
    entries: filteredEntries,
    breakdown,
    segments: {
      equityCurve,
      byMonth,
    },
    metrics,
  };
}

const normalizeName = (value: string) => value.trim().replace(/\s+/g, " ");
const normalizeKey = (value: string) => normalizeName(value).toUpperCase();

function buildPlayerId(name: string) {
  return normalizeKey(name).replace(/[^A-Z0-9]+/g, "-");
}

function toDate(value: Date | string) {
  return value instanceof Date ? value : new Date(value);
}

function getRecentMonthsStart(monthCount: number) {
  const now = new Date();
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  start.setMonth(start.getMonth() - monthCount);
  return start;
}

function getRecentDaysStart(dayCount: number) {
  const now = new Date();
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  start.setDate(start.getDate() - dayCount);
  return start;
}

function getWinner(match: UnifiedMatch) {
  if (match.homeScore > match.awayScore) {
    return "home" as const;
  }

  if (match.awayScore > match.homeScore) {
    return "away" as const;
  }

  return "draw" as const;
}

async function loadUnifiedMatches(options?: {
  since?: Date;
  leagueType?: LeagueType;
}): Promise<UnifiedMatch[]> {
  const since = options?.since;
  const leagueType = options?.leagueType;
  const cachedMatches = matchCache.data;
  const hasFreshCache = Boolean(
    cachedMatches && matchCache.expiresAt > Date.now(),
  );
  const basketOnly = appScope === "basket";

  if (hasFreshCache && cachedMatches) {
    const filteredMatches = since
      ? cachedMatches.filter(
          (match) => match.playedAt.getTime() >= since.getTime(),
        )
      : cachedMatches;

    return leagueType
      ? filteredMatches.filter((match) => match.leagueType === leagueType)
      : filteredMatches;
  }

  const shouldLoadGt =
    !basketOnly && (!leagueType || leagueType === "GT LEAGUE");
  const shouldLoadEbattle =
    !basketOnly &&
    (!leagueType ||
      leagueType === "8MIN BATTLE" ||
      leagueType === "6MIN VOLTA");
  const shouldLoadH2h = !basketOnly && (!leagueType || leagueType === "H2H");

  let gtMatches;
  let ebattleMatches;
  let h2hMatches;

  try {
    const h2hMatchesPromise = !shouldLoadH2h
      ? Promise.resolve([])
      : h2hDataSource === "ebasket"
        ? loadEbasketMatchesFromNewTable(since)
        : prisma.h2h_h2hapi_fixtures.findMany({
            ...(since ? { where: { match_kickoff: { gte: since } } } : {}),
            select: {
              id_fixture: true,
              id_season: true,
              match_kickoff: true,
              home_player: true,
              away_player: true,
              home_team: true,
              away_team: true,
              home_score_ht: true,
              away_score_ht: true,
              home_score_ft: true,
              away_score_ft: true,
            },
          });

    [gtMatches, ebattleMatches, h2hMatches] = await Promise.all([
      shouldLoadGt
        ? prisma.gt_gtapi_fixtures.findMany({
            ...(since ? { where: { match_kickoff: { gte: since } } } : {}),
            select: {
              id_fixture: true,
              id_season: true,
              match_kickoff: true,
              grupo: true,
              home_player: true,
              away_player: true,
              home_team: true,
              away_team: true,
              home_score_ht: true,
              away_score_ht: true,
              home_score_ft: true,
              away_score_ft: true,
            },
          })
        : Promise.resolve([]),
      shouldLoadEbattle
        ? prisma.ebattle_ebattleapi_fixtures.findMany({
            ...(since ? { where: { match_kickoff: { gte: since } } } : {}),
            select: {
              id_fixture: true,
              id_season: true,
              season_name: true,
              match_kickoff: true,
              home_player: true,
              away_player: true,
              home_team: true,
              away_team: true,
              home_score_ht: true,
              away_score_ht: true,
              home_score_ft: true,
              away_score_ft: true,
            },
          })
        : Promise.resolve([]),
      shouldLoadH2h ? h2hMatchesPromise : Promise.resolve([]),
    ]);
  } catch (error) {
    if (cachedMatches) {
      const filteredMatches = since
        ? cachedMatches.filter(
            (match) => match.playedAt.getTime() >= since.getTime(),
          )
        : cachedMatches;

      return leagueType
        ? filteredMatches.filter((match) => match.leagueType === leagueType)
        : filteredMatches;
    }

    throw error;
  }

  const unifiedMatches: UnifiedMatch[] = [
    ...gtMatches
      .filter(
        (match) => match.home_score_ft !== null && match.away_score_ft !== null,
      )
      .map((match) => ({
        id: `GT-${match.id_fixture}`,
        leagueType: "GT LEAGUE" as const,
        leagueGroup: normalizeLeagueGroup("GT LEAGUE", match.grupo),
        seasonId: Number(match.id_season ?? 0) || null,
        playedAt: match.match_kickoff,
        homePlayer: normalizeName(match.home_player || match.home_team),
        awayPlayer: normalizeName(
          match.away_player || match.away_team || "Visitante",
        ),
        homeScoreHt:
          match.home_score_ht === null ? null : Number(match.home_score_ht),
        awayScoreHt:
          match.away_score_ht === null ? null : Number(match.away_score_ht),
        homeScore: Number(match.home_score_ft ?? 0),
        awayScore: Number(match.away_score_ft ?? 0),
      })),
    ...ebattleMatches
      .filter(
        (match) => match.home_score_ft !== null && match.away_score_ft !== null,
      )
      .map((match) => ({
        id: `${isVoltaSeasonName(match.season_name) ? "VOLTA" : "EBATTLE"}-${match.id_fixture}`,
        leagueType: isVoltaSeasonName(match.season_name)
          ? ("6MIN VOLTA" as const)
          : ("8MIN BATTLE" as const),
        leagueGroup: null,
        seasonId: Number(match.id_season ?? 0) || null,
        playedAt: match.match_kickoff,
        homePlayer: normalizeName(match.home_player || match.home_team),
        awayPlayer: normalizeName(
          match.away_player || match.away_team || "Visitante",
        ),
        homeScoreHt:
          match.home_score_ht === null ? null : Number(match.home_score_ht),
        awayScoreHt:
          match.away_score_ht === null ? null : Number(match.away_score_ht),
        homeScore: Number(match.home_score_ft ?? 0),
        awayScore: Number(match.away_score_ft ?? 0),
      })),
    ...h2hMatches
      .filter(
        (match) => match.home_score_ft !== null && match.away_score_ft !== null,
      )
      .map((match) => ({
        id: `H2H-${match.id_fixture}`,
        leagueType: "H2H" as const,
        leagueGroup: null,
        seasonId: Number(match.id_season ?? 0) || null,
        playedAt: match.match_kickoff,
        homePlayer: normalizeName(
          match.home_player || match.home_team || "Mandante",
        ),
        awayPlayer: normalizeName(
          match.away_player || match.away_team || "Visitante",
        ),
        homeScoreHt:
          match.home_score_ht === null ? null : Number(match.home_score_ht),
        awayScoreHt:
          match.away_score_ht === null ? null : Number(match.away_score_ht),
        homeScore: Number(match.home_score_ft ?? 0),
        awayScore: Number(match.away_score_ft ?? 0),
      })),
  ].sort((left, right) => right.playedAt.getTime() - left.playedAt.getTime());

  if (!since && !leagueType) {
    matchCache.data = unifiedMatches;
    matchCache.expiresAt = Date.now() + MATCH_CACHE_TTL_MS;
  }

  return leagueType
    ? unifiedMatches.filter((match) => match.leagueType === leagueType)
    : unifiedMatches;
}

async function loadVoltaMatches(options?: {
  since?: Date;
}): Promise<UnifiedMatch[]> {
  const since = options?.since;
  const ebattleMatches = await prisma.ebattle_ebattleapi_fixtures.findMany({
    where: {
      ...(since ? { match_kickoff: { gte: since } } : {}),
      OR: [
        { season_name: { startsWith: "Volta" } },
        { season_name: { startsWith: "volta" } },
      ],
    },
    select: {
      id_fixture: true,
      id_season: true,
      season_name: true,
      match_kickoff: true,
      home_player: true,
      away_player: true,
      home_team: true,
      away_team: true,
      home_score_ht: true,
      away_score_ht: true,
      home_score_ft: true,
      away_score_ft: true,
    },
  });

  return ebattleMatches
    .filter(
      (match) =>
        isVoltaSeasonName(match.season_name) &&
        match.home_score_ft !== null &&
        match.away_score_ft !== null,
    )
    .map((match) => ({
      id: `VOLTA-${match.id_fixture}`,
      leagueType: "6MIN VOLTA" as const,
      leagueGroup: null,
      seasonId: Number(match.id_season ?? 0) || null,
      playedAt: match.match_kickoff,
      homePlayer: normalizeName(match.home_player || match.home_team),
      awayPlayer: normalizeName(match.away_player || match.away_team),
      homeScoreHt:
        match.home_score_ht === null ? null : Number(match.home_score_ht),
      awayScoreHt:
        match.away_score_ht === null ? null : Number(match.away_score_ht),
      homeScore: Number(match.home_score_ft ?? 0),
      awayScore: Number(match.away_score_ft ?? 0),
    }))
    .sort((left, right) => right.playedAt.getTime() - left.playedAt.getTime());
}

async function loadVoltaMatchesForPlayer(
  playerName: string,
  options?: { since?: Date },
): Promise<UnifiedMatch[]> {
  const since = options?.since;
  const ebattleMatches = await prisma.ebattle_ebattleapi_fixtures.findMany({
    where: {
      ...(since ? { match_kickoff: { gte: since } } : {}),
      AND: [
        {
          OR: [
            { season_name: { startsWith: "Volta" } },
            { season_name: { startsWith: "volta" } },
          ],
        },
        {
          OR: [
            { home_player: playerName },
            { away_player: playerName },
            { home_team: playerName },
            { away_team: playerName },
          ],
        },
      ],
    },
    select: {
      id_fixture: true,
      id_season: true,
      season_name: true,
      match_kickoff: true,
      home_player: true,
      away_player: true,
      home_team: true,
      away_team: true,
      home_score_ht: true,
      away_score_ht: true,
      home_score_ft: true,
      away_score_ft: true,
    },
  });

  return ebattleMatches
    .filter(
      (match) =>
        isVoltaSeasonName(match.season_name) &&
        match.home_score_ft !== null &&
        match.away_score_ft !== null,
    )
    .map((match) => ({
      id: `VOLTA-${match.id_fixture}`,
      leagueType: "6MIN VOLTA" as const,
      leagueGroup: null,
      seasonId: Number(match.id_season ?? 0) || null,
      playedAt: match.match_kickoff,
      homePlayer: normalizeName(match.home_player || match.home_team),
      awayPlayer: normalizeName(match.away_player || match.away_team),
      homeScoreHt:
        match.home_score_ht === null ? null : Number(match.home_score_ht),
      awayScoreHt:
        match.away_score_ht === null ? null : Number(match.away_score_ht),
      homeScore: Number(match.home_score_ft ?? 0),
      awayScore: Number(match.away_score_ft ?? 0),
    }))
    .sort((left, right) => right.playedAt.getTime() - left.playedAt.getTime());
}

async function loadVoltaUpcomingFixtures(
  limit = 300,
): Promise<InternalDashboardUpcomingFixture[]> {
  const cappedLimit = Math.min(Math.max(limit, 1), 300);
  const now = new Date();

  const ebattleMatches = await prisma.ebattle_ebattleapi_futurematches.findMany(
    {
      where: {
        match_kickoff: { gte: now },
        OR: [
          { season_name: { startsWith: "Volta" } },
          { season_name: { startsWith: "volta" } },
        ],
      },
      select: {
        id_fixture: true,
        id_season: true,
        season_name: true,
        match_kickoff: true,
        home_player: true,
        away_player: true,
      },
      orderBy: { match_kickoff: "asc" },
      take: 300,
    },
  );

  return ebattleMatches
    .filter((match) => isVoltaSeasonName(match.season_name))
    .map((match) => ({
      id: `VOLTA-${match.id_fixture}`,
      leagueType: "6MIN VOLTA" as const,
      seasonId: Number(match.id_season ?? 0) || null,
      playedAt: match.match_kickoff,
      homePlayer: normalizeName(match.home_player),
      awayPlayer: normalizeName(match.away_player),
      groupLabel: null,
    }))
    .sort((left, right) => left.playedAt.getTime() - right.playedAt.getTime())
    .slice(0, cappedLimit);
}

function buildVoltaFallbackCurrentJWarning(error: unknown) {
  const rawMessage =
    error instanceof Error
      ? error.message
      : "Base live indisponivel no momento.";

  if (rawMessage.includes("Authentication failed")) {
    return "Falha parcial na carga live consolidada. Exibindo snapshot de fallback da base Volta.";
  }

  return "Base live consolidada instavel. Exibindo snapshot de fallback da base Volta.";
}

async function buildVoltaFallbackCurrentJSnapshot(): Promise<DashboardLeagueJSnapshotResponse> {
  const now = new Date();
  const nowTimestamp = now.getTime();
  const dashboardHistoryStart = new Date(
    now.getTime() - 45 * 24 * 60 * 60 * 1000,
  );
  const currentWindow = getDashboardSnapshotWindow(now, "6MIN VOLTA");
  const [allMatches, upcomingFixtures] = await Promise.all([
    loadVoltaMatches({ since: dashboardHistoryStart }),
    loadVoltaUpcomingFixtures(300),
  ]);
  const availableDays = Array.from(
    new Set([
      ...allMatches.map(
        (match) =>
          getDashboardSnapshotWindow(match.playedAt, "6MIN VOLTA").dayKey,
      ),
      ...upcomingFixtures.map(
        (fixture) =>
          getDashboardSnapshotWindow(fixture.playedAt, "6MIN VOLTA").dayKey,
      ),
    ]),
  )
    .sort((left, right) => right.localeCompare(left))
    .map((dayKey) => ({
      dayKey,
      dayLabel: formatOperationalDayKey(dayKey),
    }));
  const dayMatches = allMatches
    .filter(
      (match) =>
        getDashboardSnapshotWindow(match.playedAt, "6MIN VOLTA").dayKey ===
        currentWindow.dayKey,
    )
    .sort((left, right) => left.playedAt.getTime() - right.playedAt.getTime());
  const dayFixtures = upcomingFixtures
    .filter(
      (fixture) =>
        getDashboardSnapshotWindow(fixture.playedAt, "6MIN VOLTA").dayKey ===
        currentWindow.dayKey,
    )
    .sort((left, right) => left.playedAt.getTime() - right.playedAt.getTime());
  const currentWindowMatches = dayMatches.filter((match) =>
    isDashboardSnapshotWindowMatch(match.playedAt, "6MIN VOLTA", currentWindow),
  );
  const visibleCurrentWindowMatches = currentWindowMatches.filter(
    (match) => match.playedAt.getTime() <= nowTimestamp,
  );
  const currentWindowFixtures = Array.from(
    new Map(
      [
        ...dayFixtures.filter((fixture) =>
          isDashboardSnapshotWindowMatch(
            fixture.playedAt,
            "6MIN VOLTA",
            currentWindow,
          ),
        ),
        ...currentWindowMatches
          .filter((match) => match.playedAt.getTime() > nowTimestamp)
          .map((match) => ({
            id: match.id,
            leagueType: "6MIN VOLTA" as const,
            seasonId: match.seasonId,
            playedAt: match.playedAt,
            homePlayer: match.homePlayer,
            awayPlayer: match.awayPlayer,
            groupLabel: null,
          })),
      ]
        .sort(
          (left, right) => left.playedAt.getTime() - right.playedAt.getTime(),
        )
        .map((fixture) => [
          `${fixture.id}__${fixture.playedAt.toISOString()}`,
          fixture,
        ]),
    ).values(),
  );
  const sortedLeagueMatches = [...allMatches].sort(
    (left, right) => left.playedAt.getTime() - right.playedAt.getTime(),
  );
  const sortedSnapshotMatches = [...visibleCurrentWindowMatches].sort(
    (left, right) => left.playedAt.getTime() - right.playedAt.getTime(),
  );
  const sortedDisplayedFixtures = [...currentWindowFixtures].sort(
    (left, right) => left.playedAt.getTime() - right.playedAt.getTime(),
  );
  const snapshotAggregates = buildPlayerAggregates(visibleCurrentWindowMatches);
  const aggregateMap = new Map(
    snapshotAggregates.map((player) => [normalizeKey(player.name), player]),
  );
  const playerNames = new Map<string, string>();
  const currentWindowGames = new Map<string, number>();
  const upcomingWindowGames = new Map<string, number>();
  const daySequenceMap = new Map<string, DashboardSequenceResult[]>();
  const latestPlayedAt = new Map<string, Date>();
  const nextFixtureAt = new Map<string, Date>();
  const allMatchesByPlayer = new Map<string, UnifiedMatch[]>();
  const recentMatchesByPlayer = new Map<string, DashboardPlayerMatchDetail[]>();
  const upcomingFixturesByPlayer = new Map<
    string,
    DashboardPlayerFixtureDetail[]
  >();

  const trackPlayerName = (playerName: string) => {
    const key = normalizeKey(playerName);
    if (!playerNames.has(key)) {
      playerNames.set(key, playerName);
    }
    return key;
  };

  const incrementMap = (map: Map<string, number>, key: string) => {
    map.set(key, (map.get(key) ?? 0) + 1);
  };

  const appendMapItem = <T>(map: Map<string, T[]>, key: string, item: T) => {
    const current = map.get(key) ?? [];
    current.push(item);
    map.set(key, current);
  };

  const updateLatestDate = (
    map: Map<string, Date>,
    key: string,
    value: Date,
  ) => {
    const currentValue = map.get(key);
    if (!currentValue || value.getTime() > currentValue.getTime()) {
      map.set(key, value);
    }
  };

  const updateEarliestDate = (
    map: Map<string, Date>,
    key: string,
    value: Date,
  ) => {
    const currentValue = map.get(key);
    if (!currentValue || value.getTime() < currentValue.getTime()) {
      map.set(key, value);
    }
  };

  const serializePlayerMatch = (
    match: UnifiedMatch,
    playerName: string,
  ): DashboardPlayerMatchDetail => {
    const playerKey = normalizeKey(playerName);
    const isHome = normalizeKey(match.homePlayer) === playerKey;
    return {
      id: match.id,
      playedAt: match.playedAt.toISOString(),
      homePlayer: match.homePlayer,
      awayPlayer: match.awayPlayer,
      opponent: isHome ? match.awayPlayer : match.homePlayer,
      seasonId: match.seasonId,
      result: getPlayerResultCode(match, playerName),
      scoreLabel: `${match.homeScore}-${match.awayScore}`,
    };
  };

  const serializePlayerFixture = (
    fixture: InternalDashboardUpcomingFixture,
    playerName: string,
  ): DashboardPlayerFixtureDetail => {
    const playerKey = normalizeKey(playerName);
    const isHome = normalizeKey(fixture.homePlayer) === playerKey;
    return {
      id: fixture.id,
      playedAt: fixture.playedAt.toISOString(),
      homePlayer: fixture.homePlayer,
      awayPlayer: fixture.awayPlayer,
      opponent: isHome ? fixture.awayPlayer : fixture.homePlayer,
      seasonId: fixture.seasonId,
    };
  };

  const serializeSnapshotFixtureFromMatch = (match: UnifiedMatch) => ({
    id: match.id,
    playedAt: match.playedAt.toISOString(),
    homePlayer: match.homePlayer,
    awayPlayer: match.awayPlayer,
    seasonId: match.seasonId,
    groupLabel: match.leagueGroup ?? null,
  });

  const serializeSnapshotFixtureFromUpcoming = (
    fixture: InternalDashboardUpcomingFixture,
  ) => ({
    id: fixture.id,
    playedAt: fixture.playedAt.toISOString(),
    homePlayer: fixture.homePlayer,
    awayPlayer: fixture.awayPlayer,
    seasonId: fixture.seasonId,
    groupLabel: fixture.groupLabel ?? null,
  });

  for (const match of sortedLeagueMatches) {
    const homeKey = trackPlayerName(match.homePlayer);
    const awayKey = trackPlayerName(match.awayPlayer);
    appendMapItem(allMatchesByPlayer, homeKey, match);
    appendMapItem(allMatchesByPlayer, awayKey, match);
  }

  for (const match of sortedSnapshotMatches) {
    const homeKey = trackPlayerName(match.homePlayer);
    const awayKey = trackPlayerName(match.awayPlayer);
    updateLatestDate(latestPlayedAt, homeKey, match.playedAt);
    updateLatestDate(latestPlayedAt, awayKey, match.playedAt);

    const homeSequence = daySequenceMap.get(homeKey) ?? [];
    homeSequence.push(getPlayerResultCode(match, match.homePlayer));
    daySequenceMap.set(homeKey, homeSequence);
    appendMapItem(
      recentMatchesByPlayer,
      homeKey,
      serializePlayerMatch(match, match.homePlayer),
    );

    const awaySequence = daySequenceMap.get(awayKey) ?? [];
    awaySequence.push(getPlayerResultCode(match, match.awayPlayer));
    daySequenceMap.set(awayKey, awaySequence);
    appendMapItem(
      recentMatchesByPlayer,
      awayKey,
      serializePlayerMatch(match, match.awayPlayer),
    );
  }

  for (const match of visibleCurrentWindowMatches) {
    incrementMap(currentWindowGames, trackPlayerName(match.homePlayer));
    incrementMap(currentWindowGames, trackPlayerName(match.awayPlayer));
  }

  for (const fixture of sortedDisplayedFixtures) {
    const homeKey = trackPlayerName(fixture.homePlayer);
    const awayKey = trackPlayerName(fixture.awayPlayer);
    incrementMap(upcomingWindowGames, homeKey);
    incrementMap(upcomingWindowGames, awayKey);
    updateEarliestDate(nextFixtureAt, homeKey, fixture.playedAt);
    updateEarliestDate(nextFixtureAt, awayKey, fixture.playedAt);
    appendMapItem(
      upcomingFixturesByPlayer,
      homeKey,
      serializePlayerFixture(fixture, fixture.homePlayer),
    );
    appendMapItem(
      upcomingFixturesByPlayer,
      awayKey,
      serializePlayerFixture(fixture, fixture.awayPlayer),
    );
  }

  const activePlayerKeys = new Set<string>([
    ...currentWindowGames.keys(),
    ...upcomingWindowGames.keys(),
  ]);
  const players = Array.from(activePlayerKeys)
    .map((playerKey) => {
      const aggregate = aggregateMap.get(playerKey);
      const playerName =
        playerNames.get(playerKey) ?? aggregate?.name ?? playerKey;
      const allPlayerMatches = allMatchesByPlayer.get(playerKey) ?? [];
      const disparityConfig = getDisparityConfig("6MIN VOLTA");
      const previousWindows = Array.from(
        allPlayerMatches.reduce((map, match) => {
          const snapshotWindow = getDashboardSnapshotWindow(
            match.playedAt,
            "6MIN VOLTA",
          );
          if (
            snapshotWindow.dayKey === currentWindow.dayKey &&
            snapshotWindow.windowLabel === currentWindow.windowLabel
          ) {
            return map;
          }

          const windowKey = `${snapshotWindow.dayKey}|${snapshotWindow.windowLabel}`;
          const currentGroup = map.get(windowKey) ?? {
            snapshotWindow,
            matches: [] as UnifiedMatch[],
          };
          currentGroup.matches.push(match);
          map.set(windowKey, currentGroup);
          return map;
        }, new Map<string, { snapshotWindow: ReturnType<typeof getDashboardSnapshotWindow>; matches: UnifiedMatch[] }>()),
      )
        .map(([windowKey, group]) => {
          const normalizedMatches = getNormalizedDisparityWindowMatches(
            group.matches,
            playerName,
            disparityConfig,
          );
          const matches = [...normalizedMatches].sort(
            (left, right) => left.playedAt.getTime() - right.playedAt.getTime(),
          );
          const sequence = matches.map((match) =>
            getPlayerResultCode(match, playerName),
          );
          const wins = sequence.filter((result) => result === "W").length;
          const draws = sequence.filter((result) => result === "D").length;
          const losses = sequence.filter((result) => result === "L").length;
          return {
            key: windowKey,
            dayLabel: group.snapshotWindow.dayLabel,
            windowLabel: group.snapshotWindow.windowLabel,
            rangeLabel: group.snapshotWindow.rangeLabel,
            totalGames: matches.length,
            wins,
            draws,
            losses,
            latestPlayedAt:
              matches[matches.length - 1]?.playedAt.toISOString() ?? null,
            sequence,
            matches: matches.map((match) =>
              serializePlayerMatch(match, playerName),
            ),
          };
        })
        .sort(
          (left, right) =>
            new Date(right.latestPlayedAt ?? 0).getTime() -
            new Date(left.latestPlayedAt ?? 0).getTime(),
        )
        .slice(0, 8);
      const totalGames = aggregate?.totalGames ?? 0;
      const wins = aggregate?.wins ?? 0;
      const draws = aggregate?.draws ?? 0;
      const losses = aggregate?.losses ?? 0;
      return {
        id: buildPlayerId(playerName),
        name: playerName,
        leagueGroup: null,
        totalGames,
        wins,
        draws,
        losses,
        winRate: totalGames ? round((wins / totalGames) * 100) : 0,
        currentWindowGames: currentWindowGames.get(playerKey) ?? 0,
        upcomingWindowGames: upcomingWindowGames.get(playerKey) ?? 0,
        daySequence: daySequenceMap.get(playerKey) ?? [],
        latestPlayedAt: latestPlayedAt.get(playerKey)?.toISOString() ?? null,
        nextFixtureAt: nextFixtureAt.get(playerKey)?.toISOString() ?? null,
        upcomingFixtures: upcomingFixturesByPlayer.get(playerKey) ?? [],
        recentMatches: recentMatchesByPlayer.get(playerKey) ?? [],
        previousWindows,
        hasPreviousWindows: previousWindows.length > 0,
      };
    })
    .sort(
      (left, right) =>
        right.currentWindowGames - left.currentWindowGames ||
        right.upcomingWindowGames - left.upcomingWindowGames ||
        right.totalGames - left.totalGames ||
        right.winRate - left.winRate ||
        left.name.localeCompare(right.name),
    );

  const totals = players.reduce(
    (accumulator, player) => ({
      activePlayers: accumulator.activePlayers + 1,
      totalGames: accumulator.totalGames + player.totalGames,
      wins: accumulator.wins + player.wins,
      draws: accumulator.draws + player.draws,
      losses: accumulator.losses + player.losses,
      winRate: 0,
      totalDayMatches: dayMatches.length,
      currentWindowPlayedMatches: visibleCurrentWindowMatches.length,
      currentWindowUpcomingFixtures: currentWindowFixtures.length,
    }),
    {
      activePlayers: 0,
      totalGames: 0,
      wins: 0,
      draws: 0,
      losses: 0,
      winRate: 0,
      totalDayMatches: dayMatches.length,
      currentWindowPlayedMatches: visibleCurrentWindowMatches.length,
      currentWindowUpcomingFixtures: currentWindowFixtures.length,
    },
  );

  return {
    generatedAt: now.toISOString(),
    leagueType: "6MIN VOLTA",
    availableDays,
    currentWindow,
    totals: {
      ...totals,
      winRate: totals.totalGames
        ? round((totals.wins / totals.totalGames) * 100)
        : 0,
    },
    fixtures: Array.from(
      new Map(
        [
          ...visibleCurrentWindowMatches.map(serializeSnapshotFixtureFromMatch),
          ...currentWindowFixtures.map(serializeSnapshotFixtureFromUpcoming),
        ]
          .sort(
            (left, right) =>
              new Date(left.playedAt).getTime() -
              new Date(right.playedAt).getTime(),
          )
          .map((fixture) => [
            `${fixture.homePlayer}__${fixture.awayPlayer}__${fixture.playedAt}__${fixture.seasonId ?? "-"}`,
            fixture,
          ]),
      ).values(),
    ),
    players,
  };
}

async function loadMethodSummaries(): Promise<MethodSummary[]> {
  if (methodCache.data && methodCache.expiresAt > Date.now()) {
    return methodCache.data;
  }

  const summaries = await Promise.all(
    METHOD_TABLES.map(async (method) => {
      const rows = await prisma.$queryRawUnsafe<
        Array<{
          entries: bigint | number | null;
          netProfit: number | null;
          roi: number | null;
        }>
      >(
        `
          SELECT
            COALESCE(SUM(COALESCE(__ENTRIES__, 0)), 0) AS entries,
            COALESCE(SUM(CAST(REPLACE(CAST(lucro AS CHAR), ',', '.') AS DECIMAL(18,4))), 0) AS netProfit,
            COALESCE(AVG(CAST(REPLACE(CAST(roi AS CHAR), ',', '.') AS DECIMAL(18,4))), 0) AS roi
          FROM ${method.tableName}
        `.replace(/__ENTRIES__/g, `\`${method.entriesColumn}\``),
      );

      const summary = rows[0] ?? { entries: 0, netProfit: 0, roi: 0 };

      return {
        id: method.id,
        name: method.name,
        description: method.description,
        leagueType: method.leagueType,
        entries: Number(summary.entries ?? 0),
        netProfit: round(Number(summary.netProfit ?? 0)),
        roi: round(Number(summary.roi ?? 0)),
      } satisfies MethodSummary;
    }),
  );

  methodCache.data = summaries;
  methodCache.expiresAt = Date.now() + METHOD_CACHE_TTL_MS;
  return summaries;
}

async function loadPlayerMethodDashboardStats() {
  if (playerMethodCache.data && playerMethodCache.expiresAt > Date.now()) {
    return playerMethodCache.data;
  }

  const playerMethodMap = new Map<
    string,
    Map<
      string,
      PlayerMethodDashboardStat & { roiTotal: number; groups: number }
    >
  >();

  await Promise.all(
    METHOD_TABLES.map(async (method) => {
      const rows = await prisma.$queryRawUnsafe<
        Array<{
          playerA: string | null;
          playerB: string | null;
          entries: bigint | number | null;
          netProfit: number | null;
          roi: number | null;
        }>
      >(
        `
          SELECT
            ${method.playerOneColumn} AS playerA,
            ${method.playerTwoColumn} AS playerB,
            COALESCE(__ENTRIES__, 0) AS entries,
            COALESCE(CAST(REPLACE(CAST(lucro AS CHAR), ',', '.') AS DECIMAL(18,4)), 0) AS netProfit,
            COALESCE(CAST(REPLACE(CAST(roi AS CHAR), ',', '.') AS DECIMAL(18,4)), 0) AS roi
          FROM ${method.tableName}
        `.replace(/__ENTRIES__/g, `\`${method.entriesColumn}\``),
      );

      for (const row of rows) {
        const players = [row.playerA, row.playerB].filter(
          (value): value is string => Boolean(value),
        );

        for (const playerName of players) {
          const playerKey = normalizeKey(playerName);
          const methods =
            playerMethodMap.get(playerKey) ??
            new Map<
              string,
              PlayerMethodDashboardStat & { roiTotal: number; groups: number }
            >();
          const current = methods.get(method.id) ?? {
            methodId: method.id,
            methodName: method.name,
            leagueType: method.leagueType,
            entries: 0,
            netProfit: 0,
            roi: 0,
            roiTotal: 0,
            groups: 0,
          };

          current.entries += Number(row.entries ?? 0);
          current.netProfit += Number(row.netProfit ?? 0);
          current.roiTotal += Number(row.roi ?? 0);
          current.groups += 1;
          methods.set(method.id, current);
          playerMethodMap.set(playerKey, methods);
        }
      }
    }),
  );

  const normalized: Record<string, PlayerMethodDashboardStat[]> = {};

  for (const [playerKey, methods] of playerMethodMap.entries()) {
    normalized[playerKey] = Array.from(methods.values())
      .map((method) => ({
        methodId: method.methodId,
        methodName: method.methodName,
        leagueType: method.leagueType,
        entries: method.entries,
        netProfit: round(method.netProfit),
        roi: method.groups ? round(method.roiTotal / method.groups) : 0,
      }))
      .sort(
        (left, right) =>
          right.entries - left.entries || right.netProfit - left.netProfit,
      );
  }

  playerMethodCache.data = normalized;
  playerMethodCache.expiresAt = Date.now() + METHOD_CACHE_TTL_MS;
  return normalized;
}

async function loadGtOdds(): Promise<OddRecord[]> {
  const rows = await prisma.$queryRawUnsafe<
    Array<{
      event_id: number;
      datetime: Date;
      market_datetime: Date;
      home_player: string | null;
      away_player: string | null;
      player1: string | null;
      player2: string | null;
      player1_odd: Prisma.Decimal | number | null;
      player2_odd: Prisma.Decimal | number | null;
    }>
  >(`
      SELECT event_id, datetime, market_datetime, home_player, away_player, player1, player2, player1_odd, player2_odd
      FROM gt_odds_mlht
      WHERE player1_odd IS NOT NULL OR player2_odd IS NOT NULL
    `);

  return rows.map((row) => ({
    eventId: Number(row.event_id),
    matchDatetime: toDate(row.datetime),
    marketDatetime: toDate(row.market_datetime),
    homePlayer: normalizeName(row.player1 || row.home_player || ""),
    awayPlayer: normalizeName(row.player2 || row.away_player || ""),
    homeOdd: row.player1_odd !== null ? Number(row.player1_odd) : null,
    awayOdd: row.player2_odd !== null ? Number(row.player2_odd) : null,
  }));
}

function buildMethodContext(
  matches: UnifiedMatch[],
  homePlayer: string,
  awayPlayer: string,
) {
  const homeLast10 = summarizeRecentForm(matches, homePlayer, 10);
  const awayLast10 = summarizeRecentForm(matches, awayPlayer, 10);
  const players = buildPlayerAggregates(matches);
  const homeAggregate = players.find(
    (player) => normalizeKey(player.name) === normalizeKey(homePlayer),
  );
  const awayAggregate = players.find(
    (player) => normalizeKey(player.name) === normalizeKey(awayPlayer),
  );

  return {
    leagueCode: "GT",
    homePlayer,
    awayPlayer,
    homeRecentWinRate: homeLast10.winRate,
    awayRecentWinRate: awayLast10.winRate,
    homeGoalsForAverage: homeAggregate?.averageGoalsFor ?? 0,
    awayGoalsForAverage: awayAggregate?.averageGoalsFor ?? 0,
    homeGoalsAgainstAverage: homeAggregate?.averageGoalsAgainst ?? 0,
    awayGoalsAgainstAverage: awayAggregate?.averageGoalsAgainst ?? 0,
    bttsRate: round(
      ((homeAggregate?.bttsRate ?? 0) + (awayAggregate?.bttsRate ?? 0)) / 2,
    ),
    over25Rate: round(
      ((homeAggregate?.over25Rate ?? 0) + (awayAggregate?.over25Rate ?? 0)) / 2,
    ),
  };
}

function buildPairKey(homePlayer: string, awayPlayer: string) {
  return `${normalizeKey(homePlayer)}__${normalizeKey(awayPlayer)}`;
}

function isVoltaSeasonName(value: string | null | undefined) {
  return value ? value.trim().toLowerCase().startsWith("volta") : false;
}

function buildTimelineContext(
  stateMap: Map<string, TimelinePlayerState>,
  homePlayer: string,
  awayPlayer: string,
) {
  const homeState = stateMap.get(normalizeKey(homePlayer));
  const awayState = stateMap.get(normalizeKey(awayPlayer));

  const recentWinRate = (state?: TimelinePlayerState) => {
    if (!state || !state.recentResults.length) {
      return 0;
    }

    return round(
      (state.recentResults.filter((result) => result === "W").length /
        state.recentResults.length) *
        100,
    );
  };

  return {
    leagueCode: "GT",
    homePlayer,
    awayPlayer,
    homeRecentWinRate: recentWinRate(homeState),
    awayRecentWinRate: recentWinRate(awayState),
    homeGoalsForAverage: homeState?.totalGames
      ? round(homeState.goalsFor / homeState.totalGames)
      : 0,
    awayGoalsForAverage: awayState?.totalGames
      ? round(awayState.goalsFor / awayState.totalGames)
      : 0,
    homeGoalsAgainstAverage: homeState?.totalGames
      ? round(homeState.goalsAgainst / homeState.totalGames)
      : 0,
    awayGoalsAgainstAverage: awayState?.totalGames
      ? round(awayState.goalsAgainst / awayState.totalGames)
      : 0,
    bttsRate:
      homeState?.totalGames && awayState?.totalGames
        ? round(
            ((homeState.bttsGames / homeState.totalGames) * 100 +
              (awayState.bttsGames / awayState.totalGames) * 100) /
              2,
          )
        : 0,
    over25Rate:
      homeState?.totalGames && awayState?.totalGames
        ? round(
            ((homeState.over25Games / homeState.totalGames) * 100 +
              (awayState.over25Games / awayState.totalGames) * 100) /
              2,
          )
        : 0,
  };
}

function updateTimelineState(
  stateMap: Map<string, TimelinePlayerState>,
  playerName: string,
  goalsFor: number,
  goalsAgainst: number,
) {
  const key = normalizeKey(playerName);
  const current = stateMap.get(key) ?? {
    totalGames: 0,
    wins: 0,
    goalsFor: 0,
    goalsAgainst: 0,
    over25Games: 0,
    bttsGames: 0,
    recentResults: [],
  };

  current.totalGames += 1;
  current.wins += goalsFor > goalsAgainst ? 1 : 0;
  current.goalsFor += goalsFor;
  current.goalsAgainst += goalsAgainst;
  current.over25Games += goalsFor + goalsAgainst > 2 ? 1 : 0;
  current.bttsGames += goalsFor > 0 && goalsAgainst > 0 ? 1 : 0;
  current.recentResults.push(
    goalsFor > goalsAgainst ? "W" : goalsFor < goalsAgainst ? "L" : "D",
  );
  current.recentResults = current.recentResults.slice(-10);
  stateMap.set(key, current);
}

function findMatchingOdd(
  oddsByPair: Map<string, OddRecord[]>,
  match: UnifiedMatch,
) {
  const pairOdds =
    oddsByPair.get(buildPairKey(match.homePlayer, match.awayPlayer)) ?? [];
  const matchTime = match.playedAt.getTime();

  let best: OddRecord | null = null;
  let bestDiff = Number.POSITIVE_INFINITY;

  for (const row of pairOdds) {
    const diff = Math.abs(row.matchDatetime.getTime() - matchTime);
    if (diff < bestDiff) {
      best = row;
      bestDiff = diff;
    }
  }

  return best;
}

async function computeTimelineBacktests(): Promise<
  Record<string, TimelineBacktestResult>
> {
  if (timelineCache.data && timelineCache.expiresAt > Date.now()) {
    return timelineCache.data;
  }

  const [allMatches, odds] = await Promise.all([
    loadUnifiedMatches(),
    loadGtOdds(),
  ]);
  const gtMatches = allMatches
    .filter((match) => match.leagueType === "GT LEAGUE")
    .sort((left, right) => left.playedAt.getTime() - right.playedAt.getTime())
    .slice(-TIMELINE_MATCH_LIMIT);

  const oddsByPair = odds.reduce((map, row) => {
    const key = buildPairKey(row.homePlayer, row.awayPlayer);
    const current = map.get(key) ?? [];
    current.push(row);
    map.set(key, current);
    return map;
  }, new Map<string, OddRecord[]>());

  const results = Object.fromEntries(
    TIMELINE_METHODS.map((method) => {
      const entries: BacktestEntry[] = [];
      const stateMap = new Map<string, TimelinePlayerState>();

      gtMatches.forEach((match) => {
        const homeState = stateMap.get(normalizeKey(match.homePlayer));
        const awayState = stateMap.get(normalizeKey(match.awayPlayer));
        const homeHistoryCount = homeState?.totalGames ?? 0;
        const awayHistoryCount = awayState?.totalGames ?? 0;

        if (
          homeHistoryCount < (method.definition.filters.minimumGames ?? 0) ||
          awayHistoryCount < (method.definition.filters.minimumGames ?? 0)
        ) {
          updateTimelineState(
            stateMap,
            match.homePlayer,
            match.homeScore,
            match.awayScore,
          );
          updateTimelineState(
            stateMap,
            match.awayPlayer,
            match.awayScore,
            match.homeScore,
          );
          return;
        }

        const matchingOdd = findMatchingOdd(oddsByPair, match);
        const context = buildTimelineContext(
          stateMap,
          match.homePlayer,
          match.awayPlayer,
        );
        const homeOdd = matchingOdd?.homeOdd ?? undefined;
        const awayOdd = matchingOdd?.awayOdd ?? undefined;
        const signal = evaluateMethodDefinition(method.definition, {
          ...context,
          homeOdd,
          awayOdd,
        });

        if (!signal.shouldEnter) {
          updateTimelineState(
            stateMap,
            match.homePlayer,
            match.homeScore,
            match.awayScore,
          );
          updateTimelineState(
            stateMap,
            match.awayPlayer,
            match.awayScore,
            match.homeScore,
          );
          return;
        }

        let result: BacktestEntry["result"] = "void";
        let odd = 0;
        let profit = 0;

        if (method.id === "favorito-forma-recente") {
          if (!homeOdd || homeOdd <= 1) {
            updateTimelineState(
              stateMap,
              match.homePlayer,
              match.homeScore,
              match.awayScore,
            );
            updateTimelineState(
              stateMap,
              match.awayPlayer,
              match.awayScore,
              match.homeScore,
            );
            return;
          }

          odd = homeOdd;
          result = match.homeScore > match.awayScore ? "green" : "red";
          profit = result === "green" ? homeOdd - 1 : -1;
        }

        if (method.id === "over-25-ofensivo") {
          odd = 2;
          result = match.homeScore + match.awayScore > 2 ? "green" : "red";
          profit = result === "green" ? 1 : -1;
        }

        entries.push({
          matchId: match.id,
          leagueCode: "GT",
          playerRef: `${match.homePlayer} x ${match.awayPlayer}`,
          odd: round(odd),
          result,
          profit: round(profit),
          playedAt: match.playedAt.toISOString(),
        });

        updateTimelineState(
          stateMap,
          match.homePlayer,
          match.homeScore,
          match.awayScore,
        );
        updateTimelineState(
          stateMap,
          match.awayPlayer,
          match.awayScore,
          match.homeScore,
        );
      });

      const metrics = calculateBacktestMetrics(entries);

      return [
        method.id,
        {
          methodId: method.id,
          methodName: method.definition.name,
          leagueType: method.leagueType,
          mode: "timeline",
          source: "timeline",
          limitations:
            method.id === "over-25-ofensivo"
              ? [
                  "A base nao oferece odd historica consolidada para Over 2.5, entao este backtest usa odd fixa 2.0 para comparabilidade.",
                ]
              : [],
          entries,
          breakdown: entries
            .slice(-100)
            .reverse()
            .map((entry) => ({
              playerA: entry.playerRef.split(" x ")[0] ?? null,
              playerB: entry.playerRef.split(" x ")[1] ?? null,
              handicap: method.marketLabel,
              entries: 1,
              netProfit: entry.profit,
              roi: entry.odd ? round((entry.profit / 1) * 100) : 0,
            })),
          segments: {
            equityCurve: entries.reduce<
              Array<{ index: number; balance: number; playedAt: string }>
            >((accumulator, entry, entryIndex) => {
              const balance = round(
                (accumulator[accumulator.length - 1]?.balance ?? 0) +
                  entry.profit,
              );
              accumulator.push({
                index: entryIndex + 1,
                balance,
                playedAt: entry.playedAt,
              });
              return accumulator;
            }, []),
            byMonth: Array.from(
              entries.reduce((map, entry) => {
                const key = entry.playedAt.slice(0, 7);
                const current = map.get(key) ?? {
                  month: key,
                  entries: 0,
                  netProfit: 0,
                };
                current.entries += 1;
                current.netProfit += entry.profit;
                map.set(key, current);
                return map;
              }, new Map<string, { month: string; entries: number; netProfit: number }>()),
            ).map(([, item]) => ({
              ...item,
              netProfit: round(item.netProfit),
            })),
          },
          metrics,
        },
      ];
    }),
  ) as Record<string, TimelineBacktestResult>;

  timelineCache.data = results;
  timelineCache.expiresAt = Date.now() + TIMELINE_CACHE_TTL_MS;
  return results;
}

function buildPlayerStreaks(matches: UnifiedMatch[]) {
  const streakMap = new Map<
    string,
    {
      currentWinStreak: number;
      currentLossStreak: number;
      maxWinStreak: number;
      maxLossStreak: number;
    }
  >();
  const chronologicalMatches = [...matches].sort(
    (left, right) => left.playedAt.getTime() - right.playedAt.getTime(),
  );

  const updatePlayerStreak = (
    playerName: string,
    goalsFor: number,
    goalsAgainst: number,
  ) => {
    const key = normalizeKey(playerName);
    const current = streakMap.get(key) ?? {
      currentWinStreak: 0,
      currentLossStreak: 0,
      maxWinStreak: 0,
      maxLossStreak: 0,
    };

    if (goalsFor > goalsAgainst) {
      current.currentWinStreak += 1;
      current.currentLossStreak = 0;
      current.maxWinStreak = Math.max(
        current.maxWinStreak,
        current.currentWinStreak,
      );
    } else if (goalsFor < goalsAgainst) {
      current.currentLossStreak += 1;
      current.currentWinStreak = 0;
      current.maxLossStreak = Math.max(
        current.maxLossStreak,
        current.currentLossStreak,
      );
    } else {
      current.currentWinStreak = 0;
      current.currentLossStreak = 0;
    }

    streakMap.set(key, current);
  };

  for (const match of chronologicalMatches) {
    updatePlayerStreak(match.homePlayer, match.homeScore, match.awayScore);
    updatePlayerStreak(match.awayPlayer, match.awayScore, match.homeScore);
  }

  return streakMap;
}

function buildPlayerAggregates(matches: UnifiedMatch[]) {
  const aggregateMap = new Map<string, PlayerAggregate>();
  const streakMap = buildPlayerStreaks(matches);

  const upsert = (
    playerName: string,
    goalsFor: number,
    goalsAgainst: number,
  ) => {
    const key = normalizeKey(playerName);
    const current = aggregateMap.get(key) ?? {
      id: buildPlayerId(playerName),
      name: playerName,
      totalGames: 0,
      wins: 0,
      draws: 0,
      losses: 0,
      goalsFor: 0,
      goalsAgainst: 0,
      goalDifference: 0,
      winRate: 0,
      averageGoalsFor: 0,
      averageGoalsAgainst: 0,
      over25Rate: 0,
      bttsRate: 0,
      cleanSheetRate: 0,
      scoredRate: 0,
      concededRate: 0,
      maxWinStreak: 0,
      maxLossStreak: 0,
    };

    current.totalGames += 1;
    current.goalsFor += goalsFor;
    current.goalsAgainst += goalsAgainst;
    current.wins += goalsFor > goalsAgainst ? 1 : 0;
    current.draws += goalsFor === goalsAgainst ? 1 : 0;
    current.losses += goalsFor < goalsAgainst ? 1 : 0;
    current.over25Rate += goalsFor + goalsAgainst > 2 ? 1 : 0;
    current.bttsRate += goalsFor > 0 && goalsAgainst > 0 ? 1 : 0;
    current.cleanSheetRate += goalsAgainst === 0 ? 1 : 0;
    current.scoredRate += goalsFor > 0 ? 1 : 0;
    current.concededRate += goalsAgainst > 0 ? 1 : 0;
    aggregateMap.set(key, current);
  };

  for (const match of matches) {
    upsert(match.homePlayer, match.homeScore, match.awayScore);
    upsert(match.awayPlayer, match.awayScore, match.homeScore);
  }

  return Array.from(aggregateMap.values()).map((player) => {
    const streaks = streakMap.get(normalizeKey(player.name));

    return {
      ...player,
      goalDifference: player.goalsFor - player.goalsAgainst,
      winRate: player.totalGames
        ? round((player.wins / player.totalGames) * 100)
        : 0,
      averageGoalsFor: player.totalGames
        ? round(player.goalsFor / player.totalGames)
        : 0,
      averageGoalsAgainst: player.totalGames
        ? round(player.goalsAgainst / player.totalGames)
        : 0,
      over25Rate: player.totalGames
        ? round((player.over25Rate / player.totalGames) * 100)
        : 0,
      bttsRate: player.totalGames
        ? round((player.bttsRate / player.totalGames) * 100)
        : 0,
      cleanSheetRate: player.totalGames
        ? round((player.cleanSheetRate / player.totalGames) * 100)
        : 0,
      scoredRate: player.totalGames
        ? round((player.scoredRate / player.totalGames) * 100)
        : 0,
      concededRate: player.totalGames
        ? round((player.concededRate / player.totalGames) * 100)
        : 0,
      maxWinStreak: streaks?.maxWinStreak ?? 0,
      maxLossStreak: streaks?.maxLossStreak ?? 0,
    };
  });
}

function buildLeagueSnapshot(matches: UnifiedMatch[]) {
  const totalGames = matches.length;
  const totalGoals = matches.reduce(
    (sum, match) => sum + match.homeScore + match.awayScore,
    0,
  );
  const drawMatches = matches.filter(
    (match) => match.homeScore === match.awayScore,
  ).length;
  const over25Matches = matches.filter(
    (match) => match.homeScore + match.awayScore > 2,
  ).length;
  const bttsMatches = matches.filter(
    (match) => match.homeScore > 0 && match.awayScore > 0,
  ).length;
  const players = buildPlayerAggregates(matches)
    .filter((player) => player.totalGames >= 5)
    .sort((left, right) => right.winRate - left.winRate)
    .slice(0, 10)
    .map((player) => ({
      name: player.name,
      totalGames: player.totalGames,
      wins: player.wins,
      draws: player.draws,
      losses: player.losses,
      winRate: player.winRate,
      goalDifference: player.goalDifference,
    }));

  return {
    totalGames,
    averageGoals: totalGames ? round(totalGoals / totalGames) : 0,
    drawRate: totalGames ? round((drawMatches / totalGames) * 100) : 0,
    over25Rate: totalGames ? round((over25Matches / totalGames) * 100) : 0,
    bttsRate: totalGames ? round((bttsMatches / totalGames) * 100) : 0,
    rankingByWinRate: players,
    rankingByProfit: [...players].sort(
      (left, right) => right.goalDifference - left.goalDifference,
    ),
  };
}

function summarizeRecentForm(
  matches: UnifiedMatch[],
  playerName: string,
  sampleSize: number,
) {
  const key = normalizeKey(playerName);
  const filtered = matches
    .filter(
      (match) =>
        normalizeKey(match.homePlayer) === key ||
        normalizeKey(match.awayPlayer) === key,
    )
    .slice(0, sampleSize);

  const wins = filtered.filter((match) => {
    const isHome = normalizeKey(match.homePlayer) === key;
    return isHome
      ? match.homeScore > match.awayScore
      : match.awayScore > match.homeScore;
  }).length;
  const draws = filtered.filter(
    (match) => match.homeScore === match.awayScore,
  ).length;
  const losses = filtered.length - wins - draws;

  return {
    sampleSize: filtered.length,
    wins,
    draws,
    losses,
    winRate: filtered.length ? round((wins / filtered.length) * 100) : 0,
  };
}

function buildSequences(matches: UnifiedMatch[], playerName: string) {
  const key = normalizeKey(playerName);
  const chronological = [...matches]
    .filter(
      (match) =>
        normalizeKey(match.homePlayer) === key ||
        normalizeKey(match.awayPlayer) === key,
    )
    .sort((left, right) => left.playedAt.getTime() - right.playedAt.getTime());

  const results = chronological.map((match) => {
    const isHome = normalizeKey(match.homePlayer) === key;

    if (match.homeScore === match.awayScore) {
      return "D" as const;
    }

    if (
      (isHome && match.homeScore > match.awayScore) ||
      (!isHome && match.awayScore > match.homeScore)
    ) {
      return "W" as const;
    }

    return "L" as const;
  });

  let currentType: "W" | "L" | "D" | null = null;
  let currentCount = 0;
  let maxWins = 0;
  let maxLosses = 0;

  for (const result of results) {
    if (result === currentType) {
      currentCount += 1;
    } else {
      currentType = result;
      currentCount = 1;
    }

    if (result === "W") {
      maxWins = Math.max(maxWins, currentCount);
    }

    if (result === "L") {
      maxLosses = Math.max(maxLosses, currentCount);
    }
  }

  const latestResult = results[results.length - 1] ?? null;
  let latestCount = 0;

  for (let index = results.length - 1; index >= 0; index -= 1) {
    if (results[index] !== latestResult) {
      break;
    }

    latestCount += 1;
  }

  return {
    current: latestResult
      ? {
          type: latestResult,
          count: latestCount,
        }
      : null,
    maxWins,
    maxLosses,
  };
}

function buildLeagueBreakdown(matches: UnifiedMatch[], playerName: string) {
  const key = normalizeKey(playerName);
  const grouped = new Map<
    LeagueType,
    { games: number; wins: number; draws: number; losses: number }
  >();

  for (const match of matches) {
    if (
      normalizeKey(match.homePlayer) !== key &&
      normalizeKey(match.awayPlayer) !== key
    ) {
      continue;
    }

    const bucket = grouped.get(match.leagueType) ?? {
      games: 0,
      wins: 0,
      draws: 0,
      losses: 0,
    };
    const isHome = normalizeKey(match.homePlayer) === key;
    bucket.games += 1;

    if (match.homeScore === match.awayScore) {
      bucket.draws += 1;
    } else if (
      (isHome && match.homeScore > match.awayScore) ||
      (!isHome && match.awayScore > match.homeScore)
    ) {
      bucket.wins += 1;
    } else {
      bucket.losses += 1;
    }

    grouped.set(match.leagueType, bucket);
  }

  return Array.from(grouped.entries()).map(([leagueType, stats]) => ({
    leagueType,
    totalGames: stats.games,
    wins: stats.wins,
    draws: stats.draws,
    losses: stats.losses,
    winRate: stats.games ? round((stats.wins / stats.games) * 100) : 0,
  }));
}

function buildSplitMetrics(
  matches: UnifiedMatch[],
  playerName: string,
  side: "home" | "away",
): PlayerSplitMetrics {
  const key = normalizeKey(playerName);
  const relevantMatches = matches.filter((match) =>
    side === "home"
      ? normalizeKey(match.homePlayer) === key
      : normalizeKey(match.awayPlayer) === key,
  );

  const totals = relevantMatches.reduce(
    (accumulator, match) => {
      const goalsFor = side === "home" ? match.homeScore : match.awayScore;
      const goalsAgainst = side === "home" ? match.awayScore : match.homeScore;

      accumulator.goalsFor += goalsFor;
      accumulator.goalsAgainst += goalsAgainst;
      accumulator.wins += goalsFor > goalsAgainst ? 1 : 0;
      accumulator.draws += goalsFor === goalsAgainst ? 1 : 0;
      accumulator.losses += goalsFor < goalsAgainst ? 1 : 0;
      accumulator.over25 += goalsFor + goalsAgainst > 2 ? 1 : 0;
      accumulator.btts += goalsFor > 0 && goalsAgainst > 0 ? 1 : 0;

      return accumulator;
    },
    {
      goalsFor: 0,
      goalsAgainst: 0,
      wins: 0,
      draws: 0,
      losses: 0,
      over25: 0,
      btts: 0,
    },
  );

  const totalGames = relevantMatches.length;

  return {
    totalGames,
    wins: totals.wins,
    draws: totals.draws,
    losses: totals.losses,
    winRate: totalGames ? round((totals.wins / totalGames) * 100) : 0,
    goalsForAverage: totalGames ? round(totals.goalsFor / totalGames) : 0,
    goalsAgainstAverage: totalGames
      ? round(totals.goalsAgainst / totalGames)
      : 0,
    over25Rate: totalGames ? round((totals.over25 / totalGames) * 100) : 0,
    bttsRate: totalGames ? round((totals.btts / totalGames) * 100) : 0,
  };
}

function buildOpponentBreakdown(matches: UnifiedMatch[], playerName: string) {
  const key = normalizeKey(playerName);
  const grouped = new Map<
    string,
    {
      opponent: string;
      games: number;
      wins: number;
      draws: number;
      losses: number;
      goalDiff: number;
    }
  >();

  for (const match of matches) {
    const isHome = normalizeKey(match.homePlayer) === key;
    const isAway = normalizeKey(match.awayPlayer) === key;

    if (!isHome && !isAway) {
      continue;
    }

    const opponent = isHome ? match.awayPlayer : match.homePlayer;
    const goalsFor = isHome ? match.homeScore : match.awayScore;
    const goalsAgainst = isHome ? match.awayScore : match.homeScore;
    const current = grouped.get(normalizeKey(opponent)) ?? {
      opponent,
      games: 0,
      wins: 0,
      draws: 0,
      losses: 0,
      goalDiff: 0,
    };

    current.games += 1;
    current.wins += goalsFor > goalsAgainst ? 1 : 0;
    current.draws += goalsFor === goalsAgainst ? 1 : 0;
    current.losses += goalsFor < goalsAgainst ? 1 : 0;
    current.goalDiff += goalsFor - goalsAgainst;

    grouped.set(normalizeKey(opponent), current);
  }

  return Array.from(grouped.values()).map((item) => ({
    opponent: item.opponent,
    totalGames: item.games,
    wins: item.wins,
    draws: item.draws,
    losses: item.losses,
    winRate: item.games ? round((item.wins / item.games) * 100) : 0,
    goalDifference: item.goalDiff,
  }));
}

function buildRecentMatches(matches: UnifiedMatch[], playerName: string) {
  const key = normalizeKey(playerName);

  return matches
    .filter(
      (match) =>
        normalizeKey(match.homePlayer) === key ||
        normalizeKey(match.awayPlayer) === key,
    )
    .slice(0, 50)
    .map((match) => {
      const isHome = normalizeKey(match.homePlayer) === key;
      const goalsFor = isHome ? match.homeScore : match.awayScore;
      const goalsAgainst = isHome ? match.awayScore : match.homeScore;
      const intervalGoalsFor =
        match.homeScoreHt === null || match.awayScoreHt === null
          ? null
          : isHome
            ? match.homeScoreHt
            : match.awayScoreHt;
      const intervalGoalsAgainst =
        match.homeScoreHt === null || match.awayScoreHt === null
          ? null
          : isHome
            ? match.awayScoreHt
            : match.homeScoreHt;

      return {
        matchId: match.id,
        playedAt: match.playedAt.toISOString(),
        leagueType: match.leagueType,
        side: isHome ? "home" : "away",
        opponent: isHome ? match.awayPlayer : match.homePlayer,
        score: `${goalsFor}-${goalsAgainst}`,
        intervalScore:
          intervalGoalsFor === null || intervalGoalsAgainst === null
            ? null
            : `${intervalGoalsFor}-${intervalGoalsAgainst}`,
        result:
          goalsFor > goalsAgainst ? "W" : goalsFor < goalsAgainst ? "L" : "D",
        intervalResult:
          intervalGoalsFor === null || intervalGoalsAgainst === null
            ? null
            : intervalGoalsFor > intervalGoalsAgainst
              ? "W"
              : intervalGoalsFor < intervalGoalsAgainst
                ? "L"
                : "D",
        totalGoals: goalsFor + goalsAgainst,
      };
    });
}

function buildRecentFormSequence(
  matches: UnifiedMatch[],
  playerName: string,
  sampleSize: number,
  opponentName?: string,
) {
  const playerKey = normalizeKey(playerName);
  const opponentKey = opponentName ? normalizeKey(opponentName) : null;

  return matches
    .filter(
      (match) =>
        normalizeKey(match.homePlayer) === playerKey ||
        normalizeKey(match.awayPlayer) === playerKey,
    )
    .filter((match) => {
      if (!opponentKey) {
        return true;
      }

      return (
        normalizeKey(match.homePlayer) === opponentKey ||
        normalizeKey(match.awayPlayer) === opponentKey
      );
    })
    .slice(0, sampleSize)
    .reverse()
    .map((match) => getPlayerResultCode(match, playerName));
}

function buildHeadToHeadDashboard(
  matches: UnifiedMatch[],
  playerName: string,
  sampleSize = 8,
) {
  const playerKey = normalizeKey(playerName);
  const grouped = new Map<string, UnifiedMatch[]>();

  for (const match of matches) {
    const isHome = normalizeKey(match.homePlayer) === playerKey;
    const isAway = normalizeKey(match.awayPlayer) === playerKey;

    if (!isHome && !isAway) {
      continue;
    }

    const opponent = isHome ? match.awayPlayer : match.homePlayer;
    const key = normalizeKey(opponent);
    const current = grouped.get(key) ?? [];
    current.push(match);
    grouped.set(key, current);
  }

  return Array.from(grouped.entries())
    .map(([opponentKey, opponentMatches]) => {
      const latestMatch = opponentMatches[0];
      const opponent =
        normalizeKey(latestMatch.homePlayer) === playerKey
          ? latestMatch.awayPlayer
          : latestMatch.homePlayer;
      const results = opponentMatches.map((match) =>
        getPlayerResultCode(match, playerName),
      );
      const wins = results.filter((result) => result === "W").length;
      const draws = results.filter((result) => result === "D").length;
      const losses = results.filter((result) => result === "L").length;

      return {
        opponentKey,
        opponent,
        totalMatches: opponentMatches.length,
        wins,
        draws,
        losses,
        winRate: opponentMatches.length
          ? round((wins / opponentMatches.length) * 100)
          : 0,
        recentForm: buildRecentFormSequence(
          matches,
          playerName,
          sampleSize,
          opponent,
        ),
        latestPlayedAt: latestMatch.playedAt.toISOString(),
      };
    })
    .sort(
      (left, right) =>
        right.totalMatches - left.totalMatches ||
        new Date(right.latestPlayedAt).getTime() -
          new Date(left.latestPlayedAt).getTime(),
    )
    .slice(0, 12);
}

function buildLeagueDistribution(matches: UnifiedMatch[]) {
  const grouped = new Map<
    LeagueType,
    { matches: number; winsA: number; winsB: number; draws: number }
  >();

  for (const match of matches) {
    const bucket = grouped.get(match.leagueType) ?? {
      matches: 0,
      winsA: 0,
      winsB: 0,
      draws: 0,
    };
    bucket.matches += 1;

    if (match.homeScore === match.awayScore) {
      bucket.draws += 1;
    } else if (match.homeScore > match.awayScore) {
      bucket.winsA += 1;
    } else {
      bucket.winsB += 1;
    }

    grouped.set(match.leagueType, bucket);
  }

  return Array.from(grouped.entries()).map(([leagueType, stats]) => ({
    leagueType,
    totalMatches: stats.matches,
    winsA: stats.winsA,
    winsB: stats.winsB,
    draws: stats.draws,
  }));
}

export async function getDashboardOverviewLive(
  options: DashboardWindowOptions = {},
): Promise<DashboardOverview> {
  const allMatches = await loadUnifiedMatches();
  const matches = filterMatchesByDays(
    filterMatchesByLeague(allMatches, options.leagueType),
    options.days,
  );
  const methods = await getDashboardMethodSummariesLive(options);
  const players = buildPlayerAggregates(matches);
  const totalMatches = matches.length;
  const totalLeagues = new Set(matches.map((match) => match.leagueType)).size;
  const totalPlayers = players.length;
  const totalGoals = matches.reduce(
    (sum, match) => sum + match.homeScore + match.awayScore,
    0,
  );
  const over25Matches = matches.filter(
    (match) => match.homeScore + match.awayScore > 2,
  ).length;
  const bttsMatches = matches.filter(
    (match) => match.homeScore > 0 && match.awayScore > 0,
  ).length;
  const bestMethods = [...methods]
    .sort((left, right) => right.netProfit - left.netProfit)
    .slice(0, 5);
  const generalProfit = methods.reduce(
    (sum, method) => sum + method.netProfit,
    0,
  );

  return {
    totalMatches,
    totalLeagues,
    totalPlayers,
    averageGoals: totalMatches ? round(totalGoals / totalMatches) : 0,
    over25Rate: totalMatches ? round((over25Matches / totalMatches) * 100) : 0,
    bttsRate: totalMatches ? round((bttsMatches / totalMatches) * 100) : 0,
    generalProfit: round(generalProfit),
    topPlayers: [...players]
      .filter((player) => player.totalGames >= 10)
      .sort(
        (left, right) =>
          right.winRate - left.winRate ||
          right.goalDifference - left.goalDifference,
      )
      .slice(0, 5)
      .map((player) => ({
        name: player.name,
        totalGames: player.totalGames,
        wins: player.wins,
        draws: player.draws,
        losses: player.losses,
        winRate: player.winRate,
        profit: player.goalDifference,
      })),
    worstPlayers: [...players]
      .filter((player) => player.totalGames >= 10)
      .sort(
        (left, right) =>
          left.winRate - right.winRate ||
          left.goalDifference - right.goalDifference,
      )
      .slice(0, 5)
      .map((player) => ({
        name: player.name,
        totalGames: player.totalGames,
        wins: player.wins,
        draws: player.draws,
        losses: player.losses,
        winRate: player.winRate,
        profit: player.goalDifference,
      })),
    bestMethods: bestMethods.map((method) => ({
      name: method.name,
      netProfit: method.netProfit,
      roi: method.roi,
    })),
  };
}

export async function getLeagueStatsLive(days?: number) {
  const [matches, methods] = await Promise.all([
    loadUnifiedMatches(),
    getMethodSummariesLive(),
  ]);
  const filteredMatches = filterMatchesByDays(matches, days);
  const grouped = new Map<LeagueType, UnifiedMatch[]>();

  for (const match of filteredMatches) {
    const current = grouped.get(match.leagueType) ?? [];
    current.push(match);
    grouped.set(match.leagueType, current);
  }

  return Array.from(grouped.entries()).map(([leagueType, leagueMatches]) => {
    const snapshot = buildLeagueSnapshot(leagueMatches);
    const leagueProfit = methods
      .filter((method) => method.leagueType === leagueType)
      .reduce((sum, method) => sum + method.netProfit, 0);

    return {
      leagueType,
      ...snapshot,
      leagueProfit: round(leagueProfit),
      methodCount: methods.filter((method) => method.leagueType === leagueType)
        .length,
    };
  });
}

export async function getLeagueDetailLive(
  leagueType: LeagueType,
  days?: number,
) {
  const [matches, methods] = await Promise.all([
    loadUnifiedMatches(),
    getMethodSummariesLive(),
  ]);
  const leagueMatches = filterMatchesByDays(
    matches.filter((match) => match.leagueType === leagueType),
    days,
  );

  if (!leagueMatches.length) {
    return null;
  }

  const snapshot = buildLeagueSnapshot(leagueMatches);
  const leagueMethods = methods
    .filter((method) => method.leagueType === leagueType)
    .sort(
      (left, right) =>
        right.entries - left.entries || right.netProfit - left.netProfit,
    );
  const leagueProfit = leagueMethods.reduce(
    (sum, method) => sum + method.netProfit,
    0,
  );
  const segments =
    leagueType === "GT LEAGUE"
      ? Array.from(
          leagueMatches.reduce((map, match) => {
            if (!match.leagueGroup) {
              return map;
            }

            const current = map.get(match.leagueGroup) ?? [];
            current.push(match);
            map.set(match.leagueGroup, current);
            return map;
          }, new Map<string, UnifiedMatch[]>()),
        )
          .sort(
            ([leftGroup], [rightGroup]) =>
              getLeagueGroupOrderValue(leftGroup) -
              getLeagueGroupOrderValue(rightGroup),
          )
          .map(([groupKey, segmentMatches], segmentIndex) => ({
            segmentKey: groupKey,
            segmentLabel: getSequentialGroupLabel(segmentIndex),
            ...buildLeagueSnapshot(segmentMatches),
          }))
      : [];

  return {
    leagueType,
    ...snapshot,
    leagueProfit: round(leagueProfit),
    methods: leagueMethods,
    segments,
  };
}

export async function getPlayersListLive() {
  return getPlayersSearchLive();
}

export async function getPlayersSearchLive(filters: PlayerListFilters = {}) {
  const matches = await loadUnifiedMatches();
  const filteredMatches = filters.leagueType
    ? matches.filter((match) => match.leagueType === filters.leagueType)
    : matches;
  const queryKey = filters.query ? normalizeKey(filters.query) : null;
  const minGames = filters.minGames ?? 0;
  const limit = Math.min(filters.limit ?? 100, 200);
  const activeWithinDays = Math.max(filters.activeWithinDays ?? 30, 1);

  const now = new Date();
  const threshold = now.getTime() - activeWithinDays * 24 * 60 * 60 * 1000;
  const recentPlayersSet = new Set(
    filteredMatches
      .filter((match) => {
        const playedAt =
          match.playedAt instanceof Date
            ? match.playedAt
            : new Date(match.playedAt);
        return playedAt.getTime() >= threshold;
      })
      .flatMap((match) => [
        normalizeKey(match.homePlayer),
        normalizeKey(match.awayPlayer),
      ]),
  );

  const sorted = buildPlayerAggregates(filteredMatches)
    .filter((player) => player.totalGames >= minGames)
    .filter((player) => recentPlayersSet.has(normalizeKey(player.name)))
    .filter((player) =>
      queryKey ? normalizeKey(player.name).includes(queryKey) : true,
    )
    .sort(
      (left, right) =>
        right.winRate - left.winRate ||
        right.goalDifference - left.goalDifference,
    )
    .map((player) => ({
      id: player.id,
      name: player.name,
      teamName: null,
      totalGames: player.totalGames,
      wins: player.wins,
      draws: player.draws,
      losses: player.losses,
      winRate: player.winRate,
      simulatedProfit: player.goalDifference,
      rating: player.winRate,
      goalsForAverage: player.averageGoalsFor,
      goalsAgainstAverage: player.averageGoalsAgainst,
      maxWinStreak: player.maxWinStreak,
      maxLossStreak: player.maxLossStreak,
    }));

  const sortBy = filters.sortBy ?? "winRateDesc";
  const ordered = [...sorted].sort((left, right) => {
    switch (sortBy) {
      case "winRateAsc":
        return (
          left.winRate - right.winRate || right.totalGames - left.totalGames
        );
      case "maxWinStreak":
        return (
          right.maxWinStreak - left.maxWinStreak || right.winRate - left.winRate
        );
      case "maxLossStreak":
        return (
          right.maxLossStreak - left.maxLossStreak ||
          left.winRate - right.winRate
        );
      case "winRate":
      case "winRateDesc":
        return (
          right.winRate - left.winRate ||
          right.simulatedProfit - left.simulatedProfit
        );
      case "games":
        return (
          right.totalGames - left.totalGames || right.winRate - left.winRate
        );
      case "profit":
        return (
          right.simulatedProfit - left.simulatedProfit ||
          right.winRate - left.winRate
        );
      case "goalsFor":
        return (
          right.goalsForAverage - left.goalsForAverage ||
          right.winRate - left.winRate
        );
      default:
        return (
          right.winRate - left.winRate ||
          right.simulatedProfit - left.simulatedProfit
        );
    }
  });

  return ordered.slice(0, limit);
}

export async function getPlayersDashboardLive(
  filters: PlayerDashboardFilters = {},
) {
  const matches = await loadUnifiedMatches();
  const filteredMatches = filterMatchesByLeague(matches, filters.leagueType);
  const queryKey = filters.query ? normalizeKey(filters.query) : null;
  const minGames = filters.minGames ?? 0;
  const limit = Math.min(filters.limit ?? 60, 120);
  const methodStats = await loadPlayerMethodDashboardStats();

  return buildPlayerAggregates(filteredMatches)
    .filter((player) => player.totalGames >= minGames)
    .filter((player) =>
      queryKey ? normalizeKey(player.name).includes(queryKey) : true,
    )
    .sort(
      (left, right) =>
        right.totalGames - left.totalGames || right.winRate - left.winRate,
    )
    .slice(0, limit)
    .map((player) => {
      const playerKey = normalizeKey(player.name);
      const playerMatches = filteredMatches.filter(
        (match) =>
          normalizeKey(match.homePlayer) === playerKey ||
          normalizeKey(match.awayPlayer) === playerKey,
      );

      return {
        id: player.id,
        name: player.name,
        championships: {
          totalChampionships: new Set(
            playerMatches.map((match) => getDisparityChampionshipKey(match)),
          ).size,
          totalLeagues: new Set(playerMatches.map((match) => match.leagueType))
            .size,
        },
        totalMatches: player.totalGames,
        wins: player.wins,
        draws: player.draws,
        losses: player.losses,
        winRate: player.winRate,
        recentForm: buildRecentFormSequence(filteredMatches, player.name, 8),
        headToHead: buildHeadToHeadDashboard(filteredMatches, player.name, 8),
        leagueStats: buildLeagueBreakdown(filteredMatches, player.name).sort(
          (left, right) =>
            right.totalGames - left.totalGames || right.winRate - left.winRate,
        ),
        methodStats: (methodStats[playerKey] ?? []).filter(
          (item) =>
            !filters.leagueType || item.leagueType === filters.leagueType,
        ),
      };
    });
}

export async function getPlayersMethodDashboardLive(
  filters: PlayerDashboardFilters = {},
) {
  const matches = await loadUnifiedMatches();
  const filteredMatches = filterMatchesByLeague(matches, filters.leagueType);
  const queryKey = filters.query ? normalizeKey(filters.query) : null;
  const minGames = filters.minGames ?? 0;
  const limit = Math.min(filters.limit ?? 60, 120);
  const methodStats = await loadPlayerMethodDashboardStats();

  return buildPlayerAggregates(filteredMatches)
    .filter((player) => player.totalGames >= minGames)
    .filter((player) =>
      queryKey ? normalizeKey(player.name).includes(queryKey) : true,
    )
    .map((player) => ({
      id: player.id,
      name: player.name,
      totalGames: player.totalGames,
      wins: player.wins,
      draws: player.draws,
      losses: player.losses,
      winRate: player.winRate,
      methodStats: (methodStats[normalizeKey(player.name)] ?? []).filter(
        (item) => !filters.leagueType || item.leagueType === filters.leagueType,
      ),
    }))
    .filter((player) => player.methodStats.length > 0)
    .sort((left, right) => {
      const leftEntries = left.methodStats.reduce(
        (sum, item) => sum + item.entries,
        0,
      );
      const rightEntries = right.methodStats.reduce(
        (sum, item) => sum + item.entries,
        0,
      );
      return rightEntries - leftEntries || right.winRate - left.winRate;
    })
    .slice(0, limit);
}

export async function getPlayerMethodAuditLive(
  filters: PlayerMethodAuditFilters,
): Promise<PlayerMethodAuditResponse | null> {
  const leagueType = filters.leagueType ?? "GT LEAGUE";
  const matches = filterMatchesByLeague(await loadUnifiedMatches(), leagueType);
  const playerName = normalizeName(filters.playerName);
  const playerKey = normalizeKey(playerName);

  if (!playerName) {
    return null;
  }

  const playerMatches = matches
    .filter(
      (match) =>
        normalizeKey(match.homePlayer) === playerKey ||
        normalizeKey(match.awayPlayer) === playerKey,
    )
    .sort((left, right) => left.playedAt.getTime() - right.playedAt.getTime());

  if (!playerMatches.length) {
    return null;
  }

  const availableDayKeys = Array.from(
    new Set(playerMatches.map((match) => getDisparityOperationalDayKey(match))),
  ).sort((left, right) => right.localeCompare(left));
  const selectedDayKeys = availableDayKeys.filter((dayKey) => {
    if (!filters.startDayKey && !filters.endDayKey) {
      return availableDayKeys.slice(0, 2).includes(dayKey);
    }

    if (filters.startDayKey && dayKey < filters.startDayKey) {
      return false;
    }

    if (filters.endDayKey && dayKey > filters.endDayKey) {
      return false;
    }

    return true;
  });
  const selectedDayKeySet = new Set(selectedDayKeys);

  const filterBySelectedDay = (match: UnifiedMatch) =>
    selectedDayKeySet.size > 0 &&
    selectedDayKeySet.has(getDisparityOperationalDayKey(match));

  const buildAuditEntries = (
    currentPlayerName: string,
  ): PlayerMethodAuditEntry[] => {
    const scopedMatches = matches
      .filter(
        (match) =>
          normalizeKey(match.homePlayer) === normalizeKey(currentPlayerName) ||
          normalizeKey(match.awayPlayer) === normalizeKey(currentPlayerName),
      )
      .filter(filterBySelectedDay)
      .sort(
        (left, right) => left.playedAt.getTime() - right.playedAt.getTime(),
      );
    const byDay = new Map<string, UnifiedMatch[]>();

    for (const match of scopedMatches) {
      const dayKey = getDisparityOperationalDayKey(match);
      const current = byDay.get(dayKey) ?? [];
      current.push(match);
      byDay.set(dayKey, current);
    }

    return Array.from(byDay.values()).flatMap((dayMatches) => {
      const sortedMatches = [...dayMatches].sort(
        (left, right) => left.playedAt.getTime() - right.playedAt.getTime(),
      );

      return sortedMatches.map((match, index) => {
        const detail = buildDisparityMatchDetail(match, currentPlayerName);
        const previousTwo = sortedMatches
          .slice(Math.max(0, index - 2), index)
          .map((item) => getPlayerResultCode(item, currentPlayerName));
        const previousThree = sortedMatches
          .slice(Math.max(0, index - 3), index)
          .map((item) => getPlayerResultCode(item, currentPlayerName));
        const previousFour = sortedMatches
          .slice(Math.max(0, index - 4), index)
          .map((item) => getPlayerResultCode(item, currentPlayerName));
        const previousFive = sortedMatches
          .slice(Math.max(0, index - 5), index)
          .map((item) => getPlayerResultCode(item, currentPlayerName));

        return {
          matchId: match.id,
          dayKey: getDisparityOperationalDayKey(match),
          localTimeLabel: detail.localTimeLabel,
          localPlayedAtLabel: detail.localPlayedAtLabel,
          seasonId: match.seasonId,
          opponent: detail.opponent,
          result: detail.result,
          fullTimeScore: detail.fullTimeScore,
          previousTwo,
          previousThree,
          previousFour,
          previousFive,
          enters2LosesStreak:
            previousTwo.length === 2 &&
            previousTwo.every((value) => value === "D" || value === "L"),
          enters2LosesFullStreak:
            previousTwo.length === 2 &&
            previousTwo.every((value) => value === "L"),
          enters3LosesStreak:
            previousThree.length === 3 &&
            previousThree.every((value) => value === "D" || value === "L"),
          enters3LosesFullStreak:
            previousThree.length === 3 &&
            previousThree.every((value) => value === "L"),
          enters4LosesStreak:
            previousFour.length === 4 &&
            previousFour.every((value) => value === "D" || value === "L"),
          enters4LosesFullStreak:
            previousFour.length === 4 &&
            previousFour.every((value) => value === "L"),
          enters5LosesStreak:
            previousFive.length === 5 &&
            previousFive.every((value) => value === "D" || value === "L"),
          enters5LosesFullStreak:
            previousFive.length === 5 &&
            previousFive.every((value) => value === "L"),
        };
      });
    });
  };

  const buildDailyHistory = (
    currentPlayerName: string,
  ): PlayerMethodAuditHistoryDay[] => {
    const scopedMatches = matches
      .filter(
        (match) =>
          normalizeKey(match.homePlayer) === normalizeKey(currentPlayerName) ||
          normalizeKey(match.awayPlayer) === normalizeKey(currentPlayerName),
      )
      .filter(filterBySelectedDay)
      .sort(
        (left, right) => left.playedAt.getTime() - right.playedAt.getTime(),
      );
    const byDay = new Map<string, UnifiedMatch[]>();

    for (const match of scopedMatches) {
      const dayKey = getDisparityOperationalDayKey(match);
      const current = byDay.get(dayKey) ?? [];
      current.push(match);
      byDay.set(dayKey, current);
    }

    const auditEntryIds = new Set(
      buildAuditEntries(currentPlayerName)
        .filter(
          (entry) =>
            entry.enters2LosesStreak ||
            entry.enters2LosesFullStreak ||
            entry.enters3LosesStreak ||
            entry.enters3LosesFullStreak ||
            entry.enters4LosesStreak ||
            entry.enters4LosesFullStreak ||
            entry.enters5LosesStreak ||
            entry.enters5LosesFullStreak,
        )
        .map((entry) => entry.matchId),
    );

    return Array.from(byDay.entries())
      .map(([dayKey, dayMatches]) => {
        const sortedMatches = [...dayMatches].sort(
          (left, right) => left.playedAt.getTime() - right.playedAt.getTime(),
        );
        const displayDate = sortedMatches[0]
          ? formatDisparityWindowDate(sortedMatches[0].playedAt)
          : dayKey;

        return {
          dayKey,
          displayDate,
          sequence: sortedMatches.map((match) =>
            getPlayerResultCode(match, currentPlayerName),
          ),
          matches: sortedMatches.map((match) => {
            const detail = buildDisparityMatchDetail(match, currentPlayerName);
            return {
              ...detail,
              seasonId: match.seasonId,
              isMethodEntry: auditEntryIds.has(match.id),
            };
          }),
        };
      })
      .sort((left, right) => right.dayKey.localeCompare(left.dayKey));
  };

  const buildMethodSummaries = (
    auditEntries: PlayerMethodAuditEntry[],
  ): PlayerMethodOutcomeSummary[] => {
    const definitions = [
      {
        methodId: "2-loses-streak" as const,
        label: "2 loses streak",
        predicate: (entry: PlayerMethodAuditEntry) => entry.enters2LosesStreak,
      },
      {
        methodId: "2-loses-full-streak" as const,
        label: "2 loses full streak",
        predicate: (entry: PlayerMethodAuditEntry) =>
          entry.enters2LosesFullStreak,
      },
      {
        methodId: "3-loses-streak" as const,
        label: "3 loses streak",
        predicate: (entry: PlayerMethodAuditEntry) => entry.enters3LosesStreak,
      },
      {
        methodId: "3-loses-full-streak" as const,
        label: "3 loses full streak",
        predicate: (entry: PlayerMethodAuditEntry) =>
          entry.enters3LosesFullStreak,
      },
      {
        methodId: "4-loses-streak" as const,
        label: "4 loses streak",
        predicate: (entry: PlayerMethodAuditEntry) => entry.enters4LosesStreak,
      },
      {
        methodId: "4-loses-full-streak" as const,
        label: "4 loses full streak",
        predicate: (entry: PlayerMethodAuditEntry) =>
          entry.enters4LosesFullStreak,
      },
      {
        methodId: "5-loses-streak" as const,
        label: "5 loses streak",
        predicate: (entry: PlayerMethodAuditEntry) => entry.enters5LosesStreak,
      },
      {
        methodId: "5-loses-full-streak" as const,
        label: "5 loses full streak",
        predicate: (entry: PlayerMethodAuditEntry) =>
          entry.enters5LosesFullStreak,
      },
    ];

    return definitions.map(({ methodId, label, predicate }) => {
      const entries = auditEntries.filter(predicate);
      const wins = entries.filter((entry) => entry.result === "W").length;
      const draws = entries.filter((entry) => entry.result === "D").length;
      const losses = entries.filter((entry) => entry.result === "L").length;
      const total = entries.length || 1;

      return {
        methodId,
        label,
        entries: entries.length,
        wins,
        draws,
        losses,
        winRate: round((wins / total) * 100),
        drawRate: round((draws / total) * 100),
        lossRate: round((losses / total) * 100),
      };
    });
  };

  const buildLogs = (
    dailyHistory: PlayerMethodAuditHistoryDay[],
    auditEntries: PlayerMethodAuditEntry[],
  ): PlayerMethodAuditLogDay[] => {
    const auditByMatchId = new Map(
      auditEntries.map((entry) => [entry.matchId, entry]),
    );

    return dailyHistory.map((day) => ({
      dayKey: day.dayKey,
      sequence: day.sequence.join(" "),
      lines: day.matches.map((match) => {
        const audit = auditByMatchId.get(match.matchId);
        const triggers = audit
          ? [
              audit.enters2LosesStreak ? "2LS" : null,
              audit.enters2LosesFullStreak ? "2LFS" : null,
              audit.enters3LosesStreak ? "3LS" : null,
              audit.enters3LosesFullStreak ? "3LFS" : null,
              audit.enters4LosesStreak ? "4LS" : null,
              audit.enters4LosesFullStreak ? "4LFS" : null,
              audit.enters5LosesStreak ? "5LS" : null,
              audit.enters5LosesFullStreak ? "5LFS" : null,
            ]
              .filter((value): value is string => Boolean(value))
              .join(", ")
          : "";

        return [
          match.localTimeLabel,
          `vs ${match.opponent}`,
          `DLW=${match.result}`,
          `placar=${match.fullTimeScore}`,
          `prev2=${audit?.previousTwo.join(" ") || "-"}`,
          `prev3=${audit?.previousThree.join(" ") || "-"}`,
          `gatilhos=${triggers || "-"}`,
        ].join(" | ");
      }),
    }));
  };

  const buildPlayerAudit = (
    currentPlayerName: string,
  ): PlayerMethodAuditPlayer => {
    const auditEntries = buildAuditEntries(currentPlayerName);
    const dailyHistory = buildDailyHistory(currentPlayerName);
    const methodSummaries = buildMethodSummaries(auditEntries);
    const validEntries = auditEntries.filter(
      (item) =>
        item.enters2LosesStreak ||
        item.enters2LosesFullStreak ||
        item.enters3LosesStreak ||
        item.enters3LosesFullStreak ||
        item.enters4LosesStreak ||
        item.enters4LosesFullStreak ||
        item.enters5LosesStreak ||
        item.enters5LosesFullStreak,
    );
    return {
      name: currentPlayerName,
      dailyHistory,
      auditEntries,
      methodSummaries,
      logs: buildLogs(dailyHistory, auditEntries),
      summary: {
        totalGames: auditEntries.length,
        validEntries: validEntries.length,
        twoLosesStreakEntries: auditEntries.filter(
          (item) => item.enters2LosesStreak,
        ).length,
        twoLosesFullStreakEntries: auditEntries.filter(
          (item) => item.enters2LosesFullStreak,
        ).length,
        threeLosesStreakEntries: auditEntries.filter(
          (item) => item.enters3LosesStreak,
        ).length,
        threeLosesFullStreakEntries: auditEntries.filter(
          (item) => item.enters3LosesFullStreak,
        ).length,
        fourLosesStreakEntries: auditEntries.filter(
          (item) => item.enters4LosesStreak,
        ).length,
        fourLosesFullStreakEntries: auditEntries.filter(
          (item) => item.enters4LosesFullStreak,
        ).length,
        fiveLosesStreakEntries: auditEntries.filter(
          (item) => item.enters5LosesStreak,
        ).length,
        fiveLosesFullStreakEntries: auditEntries.filter(
          (item) => item.enters5LosesFullStreak,
        ).length,
      },
    };
  };

  return {
    filters: {
      playerName,
      leagueType,
      startDayKey: filters.startDayKey ?? null,
      endDayKey: filters.endDayKey ?? null,
    },
    availableDayKeys,
    selectedDayKeys,
    player: buildPlayerAudit(playerName),
  };
}

export async function getPlayerStatsLive(
  playerNameOrId: string,
  leagueType?: LeagueType,
) {
  const matches = await loadUnifiedMatches();
  const filteredMatches = filterMatchesByLeague(matches, leagueType);
  const players = buildPlayerAggregates(filteredMatches);
  const requestedKey = normalizeKey(playerNameOrId.replace(/-/g, " "));
  const player = players.find(
    (item) =>
      normalizeKey(item.name) === requestedKey ||
      buildPlayerId(item.name) === playerNameOrId,
  );

  if (!player) {
    return null;
  }

  const playerMatches = matches.filter(
    (match) =>
      normalizeKey(match.homePlayer) === normalizeKey(player.name) ||
      normalizeKey(match.awayPlayer) === normalizeKey(player.name),
  );
  const scopedPlayerMatches = filteredMatches.filter(
    (match) =>
      normalizeKey(match.homePlayer) === normalizeKey(player.name) ||
      normalizeKey(match.awayPlayer) === normalizeKey(player.name),
  );
  const baseMatches = leagueType ? filteredMatches : matches;
  const sequences = buildSequences(baseMatches, player.name);
  const performanceByLeague = buildLeagueBreakdown(baseMatches, player.name);
  const homeSplit = buildSplitMetrics(baseMatches, player.name, "home");
  const awaySplit = buildSplitMetrics(baseMatches, player.name, "away");
  const opponentBreakdown = buildOpponentBreakdown(baseMatches, player.name);
  const recentMatches = buildRecentMatches(baseMatches, player.name);
  const denominator = Math.max(player.totalGames, 1);

  return {
    player: {
      id: player.id,
      name: player.name,
      teamName: null,
    },
    metrics: {
      totalGames: player.totalGames,
      wins: player.wins,
      draws: player.draws,
      losses: player.losses,
      winRate: player.winRate,
      goalDifference: player.goalDifference,
      goalsForAverage: player.averageGoalsFor,
      goalsAgainstAverage: player.averageGoalsAgainst,
      totalGoalsAverage: round(
        player.averageGoalsFor + player.averageGoalsAgainst,
      ),
      over15Rate: round(
        (scopedPlayerMatches.filter(
          (match) => match.homeScore + match.awayScore > 1,
        ).length /
          denominator) *
          100,
      ),
      over25Rate: player.over25Rate,
      over35Rate: round(
        (scopedPlayerMatches.filter(
          (match) => match.homeScore + match.awayScore > 3,
        ).length /
          denominator) *
          100,
      ),
      under15Rate: round(
        (scopedPlayerMatches.filter(
          (match) => match.homeScore + match.awayScore < 2,
        ).length /
          denominator) *
          100,
      ),
      under25Rate: round(
        (scopedPlayerMatches.filter(
          (match) => match.homeScore + match.awayScore < 3,
        ).length /
          denominator) *
          100,
      ),
      under35Rate: round(
        (scopedPlayerMatches.filter(
          (match) => match.homeScore + match.awayScore < 4,
        ).length /
          denominator) *
          100,
      ),
      bttsRate: player.bttsRate,
      cleanSheetRate: player.cleanSheetRate,
      scoredRate: player.scoredRate,
      concededRate: player.concededRate,
    },
    recentForm: {
      last5: summarizeRecentForm(baseMatches, player.name, 5),
      last10: summarizeRecentForm(baseMatches, player.name, 10),
      last20: summarizeRecentForm(baseMatches, player.name, 20),
    },
    sequences,
    performanceByLeague,
    splits: {
      home: homeSplit,
      away: awaySplit,
    },
    trend: {
      over25Rate: player.over25Rate,
      under25Rate: round(100 - player.over25Rate),
      bttsRate: player.bttsRate,
    },
    opponents: {
      best: [...opponentBreakdown]
        .filter((item) => item.totalGames >= 2)
        .sort(
          (left, right) =>
            right.winRate - left.winRate ||
            right.goalDifference - left.goalDifference,
        )
        .slice(0, 5),
      toughest: [...opponentBreakdown]
        .filter((item) => item.totalGames >= 2)
        .sort(
          (left, right) =>
            left.winRate - right.winRate ||
            left.goalDifference - right.goalDifference,
        )
        .slice(0, 5),
    },
    recentMatches,
    quickSummary: {
      sampleSize: recentMatches.length,
      latestResult: recentMatches[0]?.result ?? null,
      latestOpponent: recentMatches[0]?.opponent ?? null,
      latestIntervalResult: recentMatches[0]?.intervalResult ?? null,
      maxWinStreak: sequences.maxWins,
      maxLossStreak: sequences.maxLosses,
    },
    profitSimulation: {
      backing: player.goalDifference,
      laying: round(-player.goalDifference),
    },
  };
}

export async function getH2HStatsLive(
  playerA: string,
  playerB: string,
  leagueType?: "GT LEAGUE" | "8MIN BATTLE" | "6MIN VOLTA" | "H2H",
) {
  const matches = await loadUnifiedMatches();
  const keyA = normalizeKey(playerA);
  const keyB = normalizeKey(playerB);
  const filtered = matches.filter((match) => {
    if (leagueType && match.leagueType !== leagueType) {
      return false;
    }

    const home = normalizeKey(match.homePlayer);
    const away = normalizeKey(match.awayPlayer);
    return (home === keyA && away === keyB) || (home === keyB && away === keyA);
  });

  const winsA = filtered.filter((match) => {
    const home = normalizeKey(match.homePlayer);
    return (
      (home === keyA && match.homeScore > match.awayScore) ||
      (home === keyB && match.awayScore > match.homeScore)
    );
  }).length;
  const winsB = filtered.filter((match) => {
    const home = normalizeKey(match.homePlayer);
    return (
      (home === keyB && match.homeScore > match.awayScore) ||
      (home === keyA && match.awayScore > match.homeScore)
    );
  }).length;
  const draws = filtered.filter(
    (match) => match.homeScore === match.awayScore,
  ).length;
  const goalsA = filtered.reduce((sum, match) => {
    const home = normalizeKey(match.homePlayer);
    return sum + (home === keyA ? match.homeScore : match.awayScore);
  }, 0);
  const goalsB = filtered.reduce((sum, match) => {
    const home = normalizeKey(match.homePlayer);
    return sum + (home === keyB ? match.homeScore : match.awayScore);
  }, 0);

  const recentMatches = filtered.slice(0, 10).map((match) => {
    const home = normalizeKey(match.homePlayer);
    const playerAScore = home === keyA ? match.homeScore : match.awayScore;
    const playerBScore = home === keyB ? match.homeScore : match.awayScore;

    return {
      matchId: match.id,
      playedAt: match.playedAt.toISOString(),
      leagueType: match.leagueType,
      homePlayer: match.homePlayer,
      awayPlayer: match.awayPlayer,
      playerAScore,
      playerBScore,
      totalGoals: match.homeScore + match.awayScore,
      winner:
        playerAScore === playerBScore
          ? "draw"
          : playerAScore > playerBScore
            ? playerA
            : playerB,
    };
  });

  const scorelines = Array.from(
    filtered
      .reduce((map, match) => {
        const home = normalizeKey(match.homePlayer);
        const playerAScore = home === keyA ? match.homeScore : match.awayScore;
        const playerBScore = home === keyB ? match.homeScore : match.awayScore;
        const label = `${playerAScore}-${playerBScore}`;
        map.set(label, (map.get(label) ?? 0) + 1);
        return map;
      }, new Map<string, number>())
      .entries(),
  )
    .map(([score, count]) => ({ score, count }))
    .sort((left, right) => right.count - left.count)
    .slice(0, 5);

  return {
    playerA,
    playerB,
    totalMatches: filtered.length,
    winsA,
    winsB,
    draws,
    goalsA,
    goalsB,
    averageGoals: filtered.length
      ? round(
          filtered.reduce(
            (sum, match) => sum + match.homeScore + match.awayScore,
            0,
          ) / filtered.length,
        )
      : 0,
    averageGoalsA: filtered.length ? round(goalsA / filtered.length) : 0,
    averageGoalsB: filtered.length ? round(goalsB / filtered.length) : 0,
    over25Rate: filtered.length
      ? round(
          (filtered.filter((match) => match.homeScore + match.awayScore > 2)
            .length /
            filtered.length) *
            100,
        )
      : 0,
    bttsRate: filtered.length
      ? round(
          (filtered.filter(
            (match) => match.homeScore > 0 && match.awayScore > 0,
          ).length /
            filtered.length) *
            100,
        )
      : 0,
    dominance: filtered.length
      ? round(((winsA - winsB) / filtered.length) * 100)
      : 0,
    goalBands: {
      over15Rate: filtered.length
        ? round(
            (filtered.filter((match) => match.homeScore + match.awayScore > 1)
              .length /
              filtered.length) *
              100,
          )
        : 0,
      over25Rate: filtered.length
        ? round(
            (filtered.filter((match) => match.homeScore + match.awayScore > 2)
              .length /
              filtered.length) *
              100,
          )
        : 0,
      over35Rate: filtered.length
        ? round(
            (filtered.filter((match) => match.homeScore + match.awayScore > 3)
              .length /
              filtered.length) *
              100,
          )
        : 0,
    },
    leagueBreakdown: buildLeagueDistribution(filtered),
    recentForm: {
      playerA: {
        last5: summarizeRecentForm(matches, playerA, 5),
        last10: summarizeRecentForm(matches, playerA, 10),
      },
      playerB: {
        last5: summarizeRecentForm(matches, playerB, 5),
        last10: summarizeRecentForm(matches, playerB, 10),
      },
    },
    scorelines,
    recentMatches,
  };
}

const CONFRONTATION_METHODS: Array<{
  code: ConfrontationMethodCode;
  label: string;
}> = [
  { code: "T+", label: "T+" },
  { code: "E", label: "E" },
  { code: "(2E)", label: "(2E)" },
  { code: "(2D)", label: "(2D)" },
  { code: "(2D+)", label: "(2D+)" },
  { code: "(3D)", label: "(3D)" },
  { code: "(3D+)", label: "(3D+)" },
  { code: "(4D)", label: "(4D)" },
  { code: "(4D+)", label: "(4D+)" },
  { code: "HC-2", label: "HC-2" },
  { code: "HC-3", label: "HC-3" },
  { code: "HC-4", label: "HC-4" },
  { code: "HC-5", label: "HC-5" },
];

const PLAYER_SESSION_METHODS: Array<{
  code: PlayerSessionMethodCode;
  label: string;
}> = [
  { code: "4D Jogador", label: "4D Jogador" },
  { code: "4W Jogador", label: "4W Jogador" },
  { code: "5D Jogador", label: "5D Jogador" },
  { code: "5W Jogador", label: "5W Jogador" },
  { code: "Fav T1", label: "Fav T1 (Gap≥20 s/ LStr, ≤8j)" },
  { code: "Fav T2", label: "Fav T2 (≤4 jogos do dia)" },
  { code: "Fav T3", label: "Fav T3 (Gap≥15, ≤8j)" },
  { code: "Após DL", label: "Após DL (Volta IA)" },
  { code: "Após WDL", label: "Após WDL (Volta IA)" },
  { code: "Após LWW", label: "Após LWW (Volta IA)" },
  { code: "Após LL", label: "Após LL (Volta IA)" },
  { code: "Após DD", label: "Após DD (Volta IA)" },
  { code: "Após LDW", label: "Após LDW (Volta IA)" },
  { code: "Após DLL", label: "Após DLL (Volta IA)" },
  { code: "Após WLD", label: "Após WLD (Volta IA)" },
  { code: "Após DLD", label: "Após DLD (Volta IA)" },
  { code: "Após LLW", label: "Após LLW (Volta IA)" },
  { code: "Após LWL", label: "Após LWL (Volta IA)" },
  { code: "Após WDD", label: "Após WDD (Volta IA)" },
  { code: "Após DLW", label: "Após DLW (Volta IA)" },
  { code: "Após LLL", label: "Após LLL (Volta IA)" },
  { code: "Após LWD", label: "Após LWD (Volta IA)" },
  { code: "Após WWL", label: "Após WWL (Volta IA)" },
  { code: "Após WWD", label: "Após WWD (Volta IA)" },
  { code: "Após DDW", label: "Após DDW (Volta IA)" },
  { code: "Após LLLL", label: "Após LLLL (GT Serie C)" },
];

function getGtSeriesCode(
  label?: string | null,
): ConfrontationSeriesCode | null {
  if (!label) {
    return null;
  }

  const normalized = label.trim().toUpperCase();
  const directMatch = normalized.match(/^[A-G]$/)?.[0] as
    | ConfrontationSeriesCode
    | undefined;

  if (directMatch) {
    return directMatch;
  }

  const suffixMatch = normalized.match(/([A-G])$/);
  return suffixMatch ? (suffixMatch[1] as ConfrontationSeriesCode) : null;
}

function isNonWinResult(result: DashboardSequenceResult) {
  return result === "D" || result === "L";
}

function buildConfrontationPlayers(homePlayer: string, awayPlayer: string) {
  return [homePlayer, awayPlayer].sort((left, right) =>
    left.localeCompare(right, "pt-BR", { sensitivity: "base" }),
  );
}

function buildOrderedConfrontationKey(
  playerName: string,
  opponentName: string,
) {
  return `${normalizeKey(playerName)}||${normalizeKey(opponentName)}`;
}

function buildSortedConfrontationFilterKey(confrontationKey: string) {
  const [playerName = "", opponentName = ""] = confrontationKey
    .split("||")
    .map((item) => item.trim().toUpperCase());

  return [playerName, opponentName]
    .sort((left, right) =>
      left.localeCompare(right, "pt-BR", { sensitivity: "base" }),
    )
    .join("||");
}

function buildConfrontationMethodTriggerSequence(
  methodCode: ConfrontationMethodCode,
  previousSequence: DashboardSequenceResult[],
  previousOne: DashboardSequenceResult[],
  previousTwo: DashboardSequenceResult[],
  previousThree: DashboardSequenceResult[],
  previousFour: DashboardSequenceResult[],
) {
  switch (methodCode) {
    case "HC-2":
    case "HC-3":
    case "HC-4":
    case "HC-5":
      return previousSequence;
    case "T+":
    case "E":
      return previousOne;
    case "(2E)":
    case "(2D)":
    case "(2D+)":
      return previousTwo;
    case "(3D)":
    case "(3D+)":
      return previousThree;
    case "(4D)":
    case "(4D+)":
      return previousFour;
    default:
      return [];
  }
}

function matchesConfrontationMethod(
  methodCode: ConfrontationMethodCode,
  leagueType: ConfrontationMethodsLeagueType,
  previousSequence: DashboardSequenceResult[],
  _currentResult: DashboardSequenceResult,
  previousOne: DashboardSequenceResult[],
  previousTwo: DashboardSequenceResult[],
  previousThree: DashboardSequenceResult[],
  previousFour: DashboardSequenceResult[],
) {
  switch (methodCode) {
    case "HC-2":
    case "HC-3":
    case "HC-4":
    case "HC-5":
      return matchesConfrontationHandicapMethod(
        methodCode,
        leagueType,
        previousSequence,
      );
    case "T+":
      return (
        previousOne.length === 1 &&
        previousOne[0] === "L" &&
        !hasExactTrailingResults(previousTwo, "L", 2)
      );
    case "E":
      return (
        previousOne.length === 1 &&
        previousOne[0] === "D" &&
        !hasExactTrailingResults(previousTwo, "D", 2)
      );
    case "(2E)":
      return (
        hasExactTrailingResults(previousTwo, "D", 2) &&
        !hasExactTrailingResults(previousThree, "D", 3)
      );
    case "(2D)":
      return (
        hasExactTrailingNonWinSequence(previousTwo, 2) &&
        !hasExactTrailingNonWinSequence(previousThree, 3)
      );
    case "(2D+)":
      return (
        hasExactTrailingResults(previousTwo, "L", 2) &&
        !hasExactTrailingResults(previousThree, "L", 3)
      );
    case "(3D)":
      return (
        hasExactTrailingNonWinSequence(previousThree, 3) &&
        !hasExactTrailingNonWinSequence(previousFour, 4)
      );
    case "(3D+)":
      return (
        hasExactTrailingResults(previousThree, "L", 3) &&
        !hasExactTrailingResults(previousFour, "L", 4)
      );
    case "(4D)":
      return hasExactTrailingNonWinSequence(previousFour, 4);
    case "(4D+)":
      return hasExactTrailingResults(previousFour, "L", 4);
    default:
      return false;
  }
}

function hasExactTrailingResults(
  sequence: DashboardSequenceResult[],
  expected: DashboardSequenceResult,
  length: number,
) {
  return (
    sequence.length === length &&
    sequence.every((result) => result === expected)
  );
}

function hasExactTrailingNonWinSequence(
  sequence: DashboardSequenceResult[],
  length: number,
) {
  return (
    sequence.length === length &&
    sequence.every(isNonWinResult) &&
    sequence.some((result) => result === "L")
  );
}

function hasExactTrailingLossSequence(
  sequence: DashboardSequenceResult[],
  length: number,
) {
  return hasExactTrailingResults(sequence, "L", length);
}

function hasExactTrailingWinSequence(
  sequence: DashboardSequenceResult[],
  length: number,
) {
  return hasExactTrailingResults(sequence, "W", length);
}

function isHandicapConfrontationMethod(
  methodCode: ConfrontationMethodCode,
): methodCode is "HC-2" | "HC-3" | "HC-4" | "HC-5" {
  return (
    methodCode === "HC-2" ||
    methodCode === "HC-3" ||
    methodCode === "HC-4" ||
    methodCode === "HC-5"
  );
}

function getConfrontationHandicapGap(methodCode: ConfrontationMethodCode) {
  switch (methodCode) {
    case "HC-2":
      return 2;
    case "HC-3":
      return 3;
    case "HC-4":
      return 4;
    case "HC-5":
      return 5;
    default:
      return null;
  }
}

function getConfrontationMethodScopeMaxGames(
  leagueType: ConfrontationMethodsLeagueType,
) {
  return leagueType === "6MIN VOLTA" ? 8 : 6;
}

function matchesConfrontationHandicapMethod(
  methodCode: ConfrontationMethodCode,
  leagueType: ConfrontationMethodsLeagueType,
  previousSequence: DashboardSequenceResult[],
) {
  const targetGap = getConfrontationHandicapGap(methodCode);
  if (targetGap === null) {
    return false;
  }

  if (
    previousSequence.length === 0 ||
    previousSequence.length >= getConfrontationMethodScopeMaxGames(leagueType)
  ) {
    return false;
  }

  const playerWins = previousSequence.filter((result) => result === "W").length;
  const opponentWins = previousSequence.filter(
    (result) => result === "L",
  ).length;

  return opponentWins - playerWins === targetGap;
}

function buildConfrontationMethodScopeKey(
  match: UnifiedMatch,
  methodCode: ConfrontationMethodCode,
) {
  if (isHandicapConfrontationMethod(methodCode)) {
    return getDisparityChampionshipKey(match);
  }

  return getDisparityOperationalDayKey(match);
}

function matchesPlayerSessionMethod(
  methodCode: PlayerSessionMethodCode,
  sequence: DashboardSequenceResult[],
) {
  const trailingTwo = sequence.slice(-2);
  const trailingThree = sequence.slice(-3);
  const trailingFour = sequence.slice(-4);
  const trailingFive = sequence.slice(-5);

  switch (methodCode) {
    case "4D Jogador":
      return (
        hasExactTrailingLossSequence(trailingFour, 4) &&
        !hasExactTrailingLossSequence(trailingFive, 5)
      );
    case "4W Jogador":
      return (
        hasExactTrailingWinSequence(trailingFour, 4) &&
        !hasExactTrailingWinSequence(trailingFive, 5)
      );
    case "Após DL":
      return (
        trailingTwo.length === 2 &&
        trailingTwo[0] === "D" &&
        trailingTwo[1] === "L"
      );
    case "Após WDL":
      return (
        trailingThree.length === 3 &&
        trailingThree[0] === "W" &&
        trailingThree[1] === "D" &&
        trailingThree[2] === "L"
      );
    case "Após LWW":
      return (
        trailingThree.length === 3 &&
        trailingThree[0] === "L" &&
        trailingThree[1] === "W" &&
        trailingThree[2] === "W"
      );
    case "Após LL":
      return (
        hasExactTrailingLossSequence(trailingTwo, 2) &&
        !hasExactTrailingLossSequence(trailingThree, 3)
      );
    case "Após DD":
      return (
        trailingTwo.length === 2 &&
        trailingTwo[0] === "D" &&
        trailingTwo[1] === "D"
      );
    case "Após LDW":
      return (
        trailingThree.length === 3 &&
        trailingThree[0] === "L" &&
        trailingThree[1] === "D" &&
        trailingThree[2] === "W"
      );
    case "Após DLL":
      return (
        trailingThree.length === 3 &&
        trailingThree[0] === "D" &&
        trailingThree[1] === "L" &&
        trailingThree[2] === "L"
      );
    case "Após WLD":
      return (
        trailingThree.length === 3 &&
        trailingThree[0] === "W" &&
        trailingThree[1] === "L" &&
        trailingThree[2] === "D"
      );
    case "Após DLD":
      return (
        trailingThree.length === 3 &&
        trailingThree[0] === "D" &&
        trailingThree[1] === "L" &&
        trailingThree[2] === "D"
      );
    case "Após LLW":
      return (
        trailingThree.length === 3 &&
        trailingThree[0] === "L" &&
        trailingThree[1] === "L" &&
        trailingThree[2] === "W"
      );
    case "Após LWL":
      return (
        trailingThree.length === 3 &&
        trailingThree[0] === "L" &&
        trailingThree[1] === "W" &&
        trailingThree[2] === "L"
      );
    case "Após WDD":
      return (
        trailingThree.length === 3 &&
        trailingThree[0] === "W" &&
        trailingThree[1] === "D" &&
        trailingThree[2] === "D"
      );
    case "Após DLW":
      return (
        trailingThree.length === 3 &&
        trailingThree[0] === "D" &&
        trailingThree[1] === "L" &&
        trailingThree[2] === "W"
      );
    case "Após LLL":
      return (
        trailingThree.length === 3 &&
        trailingThree[0] === "L" &&
        trailingThree[1] === "L" &&
        trailingThree[2] === "L"
      );
    case "Após LWD":
      return (
        trailingThree.length === 3 &&
        trailingThree[0] === "L" &&
        trailingThree[1] === "W" &&
        trailingThree[2] === "D"
      );
    case "Após WWL":
      return (
        trailingThree.length === 3 &&
        trailingThree[0] === "W" &&
        trailingThree[1] === "W" &&
        trailingThree[2] === "L"
      );
    case "Após WWD":
      return (
        trailingThree.length === 3 &&
        trailingThree[0] === "W" &&
        trailingThree[1] === "W" &&
        trailingThree[2] === "D"
      );
    case "Após DDW":
      return (
        trailingThree.length === 3 &&
        trailingThree[0] === "D" &&
        trailingThree[1] === "D" &&
        trailingThree[2] === "W"
      );
    case "Após LLLL":
      return (
        hasExactTrailingLossSequence(trailingFour, 4) &&
        !hasExactTrailingLossSequence(trailingFive, 5)
      );
    case "Fav T1":
    case "Fav T2":
    case "Fav T3":
      return false;
    default:
      return false;
  }
}

function buildPlayerSessionWindowKey(
  leagueType: ConfrontationMethodsLeagueType,
  playedAt: Date,
  seasonId?: number | null,
  seasonCache?: Map<number, Date>,
) {
  let windowDate = playedAt;
  if (leagueType === "GT LEAGUE" && seasonId && seasonCache?.has(seasonId)) {
    windowDate = seasonCache.get(seasonId)!;
  }
  const window = getDashboardSnapshotWindow(windowDate, leagueType);
  return leagueType === "GT LEAGUE"
    ? `${window.dayKey}::${window.windowLabel}`
    : window.dayKey;
}

function matchesSeriesFilter(
  series: ConfrontationSeriesCode | undefined,
  leagueType: ConfrontationMethodsLeagueType,
  groupLabel?: string | null,
) {
  if (!series || leagueType !== "GT LEAGUE") {
    return true;
  }

  return getGtSeriesCode(groupLabel) === series;
}

function buildPlayerSessionHistoricalStats(
  matches: UnifiedMatch[],
  leagueType: ConfrontationMethodsLeagueType,
  playerName: string,
  methodCode: PlayerSessionMethodCode,
  seasonCache?: Map<number, Date>,
) {
  const playerKey = normalizeKey(playerName);
  const groupedMatches = new Map<string, UnifiedMatch[]>();

  for (const match of matches) {
    if (
      normalizeKey(match.homePlayer) !== playerKey &&
      normalizeKey(match.awayPlayer) !== playerKey
    ) {
      continue;
    }

    const groupKey = buildPlayerSessionWindowKey(
      leagueType,
      match.playedAt,
      match.seasonId,
      seasonCache,
    );
    const current = groupedMatches.get(groupKey) ?? [];
    current.push(match);
    groupedMatches.set(groupKey, current);
  }

  const occurrenceResults: DashboardSequenceResult[] = [];
  let wins = 0;
  let draws = 0;
  let losses = 0;

  for (const dayMatches of groupedMatches.values()) {
    const sortedMatches = [...dayMatches].sort(
      (left, right) => left.playedAt.getTime() - right.playedAt.getTime(),
    );

    for (let index = 0; index < sortedMatches.length; index += 1) {
      const previousResults = sortedMatches
        .slice(0, index)
        .map((match) => getPlayerResultCode(match, playerName));
      if (!matchesPlayerSessionMethod(methodCode, previousResults)) {
        continue;
      }

      const result = getPlayerResultCode(sortedMatches[index], playerName);
      occurrenceResults.push(result);

      if (result === "W") {
        wins += 1;
      } else if (result === "D") {
        draws += 1;
      } else {
        losses += 1;
      }
    }
  }

  const totalOccurrences = occurrenceResults.length;

  return {
    totalOccurrences,
    wins,
    draws,
    losses,
    apx: totalOccurrences ? round((wins / totalOccurrences) * 100) : 0,
    occurrenceResults,
  };
}

export async function getFuturePlayerSessionMethodsLive(
  leagueType: ConfrontationMethodsLeagueType,
  options: {
    methodCode?: PlayerSessionMethodCode;
    series?: ConfrontationSeriesCode;
    days?: number;
    apxMin?: number;
    minOccurrences?: number;
  } = {},
): Promise<FuturePlayerSessionMethodsResponse> {
  const methodCode = options.methodCode ?? "4D Jogador";
  const snapshot = await getDashboardLeagueCurrentJLive(leagueType, {
    scope: leagueType === "GT LEAGUE" ? "window" : "day",
  });
  const since = getRecentDaysStart(options.days ?? 30);
  const matches = filterMatchesByLeague(
    await loadUnifiedMatches({ since }),
    leagueType,
  )
    .filter((match) =>
      matchesSeriesFilter(options.series, leagueType, match.leagueGroup),
    )
    .sort((left, right) => left.playedAt.getTime() - right.playedAt.getTime());
  const fixtureByPlayer = new Map<
    string,
    DashboardLeagueJSnapshotResponse["fixtures"][number]
  >();

  const now = Date.now();
  // GT LEAGUE: only consider fixtures within 2 hours from now to avoid
  // dispatching alerts for games that are too far ahead in the window.
  const maxFutureHorizonMs =
    leagueType === "GT LEAGUE" ? 2 * 60 * 60 * 1000 : Infinity;

  for (const fixture of [...snapshot.fixtures].sort(
    (left, right) =>
      new Date(left.playedAt).getTime() - new Date(right.playedAt).getTime(),
  )) {
    const fixtureAt = new Date(fixture.playedAt).getTime();
    if (Number.isNaN(fixtureAt) || fixtureAt < now) {
      continue;
    }

    if (fixtureAt - now > maxFutureHorizonMs) {
      continue;
    }

    if (!matchesSeriesFilter(options.series, leagueType, fixture.groupLabel)) {
      continue;
    }

    for (const playerName of [fixture.homePlayer, fixture.awayPlayer]) {
      const playerKey = normalizeKey(playerName);
      if (!fixtureByPlayer.has(playerKey)) {
        fixtureByPlayer.set(playerKey, fixture);
      }
    }
  }

  // Build season start cache for season-aware window classification (GT LEAGUE)
  const methodsSeasonStartCache = new Map<number, Date>();
  if (leagueType === "GT LEAGUE") {
    for (const match of matches) {
      if (match.seasonId) {
        const current = methodsSeasonStartCache.get(match.seasonId);
        if (!current || match.playedAt.getTime() < current.getTime()) {
          methodsSeasonStartCache.set(match.seasonId, match.playedAt);
        }
      }
    }
  }
  const isMethodsSeasonAwareWindowMatch = (
    playedAt: Date,
    seasonId: number | null,
    targetWindow: ReturnType<typeof getDashboardSnapshotWindow>,
  ) => {
    let candidateWindow: ReturnType<typeof getDashboardSnapshotWindow>;
    if (
      leagueType === "GT LEAGUE" &&
      seasonId &&
      methodsSeasonStartCache.has(seasonId)
    ) {
      candidateWindow = getDashboardSnapshotWindow(
        methodsSeasonStartCache.get(seasonId)!,
        leagueType,
      );
    } else {
      candidateWindow = getDashboardSnapshotWindow(playedAt, leagueType);
    }
    if (targetWindow.windowLabel === "Dia") {
      return candidateWindow.dayKey === targetWindow.dayKey;
    }
    return (
      candidateWindow.dayKey === targetWindow.dayKey &&
      candidateWindow.windowLabel === targetWindow.windowLabel
    );
  };

  const rows = snapshot.players.flatMap((player) => {
    const fixture = fixtureByPlayer.get(normalizeKey(player.name));
    if (!fixture) {
      return [];
    }

    const fixtureAt = new Date(fixture.playedAt);
    if (Number.isNaN(fixtureAt.getTime())) {
      return [];
    }

    if (
      hasPlayerPendingPriorGame(
        snapshot.fixtures,
        [player.name],
        fixtureAt.getTime(),
      )
    ) {
      return [];
    }

    const currentDaySequence = matches
      .filter(
        (match) =>
          normalizeKey(match.homePlayer) === normalizeKey(player.name) ||
          normalizeKey(match.awayPlayer) === normalizeKey(player.name),
      )
      .filter((match) => match.playedAt.getTime() < fixtureAt.getTime())
      .filter((match) =>
        isMethodsSeasonAwareWindowMatch(
          match.playedAt,
          match.seasonId,
          snapshot.currentWindow,
        ),
      )
      .map((match) => getPlayerResultCode(match, player.name));

    if (!matchesPlayerSessionMethod(methodCode, currentDaySequence)) {
      return [];
    }

    const historicalStats = buildPlayerSessionHistoricalStats(
      matches,
      leagueType,
      player.name,
      methodCode,
      methodsSeasonStartCache,
    );
    if (!historicalStats.totalOccurrences) {
      return [];
    }

    if (
      typeof options.apxMin === "number" &&
      historicalStats.apx < options.apxMin
    ) {
      return [];
    }

    if (
      typeof options.minOccurrences === "number" &&
      historicalStats.totalOccurrences < options.minOccurrences
    ) {
      return [];
    }

    const opponentName =
      normalizeKey(fixture.homePlayer) === normalizeKey(player.name)
        ? fixture.awayPlayer
        : fixture.homePlayer;

    return [
      {
        fixtureId: fixture.id,
        confrontationKey: `PLAYER::${normalizeKey(player.name)}`,
        confrontationLabel: `${player.name} x ${opponentName}`,
        fixtureLabel: `${fixture.homePlayer} x ${fixture.awayPlayer}`,
        leagueType,
        groupLabel: fixture.groupLabel ?? null,
        seasonId: fixture.seasonId,
        playedAtIso: fixture.playedAt,
        localPlayedAtLabel: fixtureAt.toLocaleString("pt-BR"),
        playerName: player.name,
        opponentName,
        methodCode,
        apx: historicalStats.apx,
        totalOccurrences: historicalStats.totalOccurrences,
        wins: historicalStats.wins,
        draws: historicalStats.draws,
        losses: historicalStats.losses,
        occurrenceResults: historicalStats.occurrenceResults,
        triggerSequence: currentDaySequence.slice(-4),
        daySequence: currentDaySequence,
        ...buildAlertPlayerStats(matches, player.name, opponentName),
      } satisfies FuturePlayerSessionMethodRow,
    ];
  });

  rows.sort(
    (left, right) =>
      new Date(left.playedAtIso).getTime() -
        new Date(right.playedAtIso).getTime() ||
      right.apx - left.apx ||
      right.totalOccurrences - left.totalOccurrences ||
      left.playerName.localeCompare(right.playerName, "pt-BR", {
        sensitivity: "base",
      }),
  );

  return {
    generatedAt: new Date().toISOString(),
    leagueType,
    currentWindow: snapshot.currentWindow,
    availableMethods: PLAYER_SESSION_METHODS,
    rows,
  };
}

const FAV_VS_FRACO_WR_SAMPLE = 100;
const FAV_VS_FRACO_MIN_WR = 50;
const FAV_VS_FRACO_MAX_OPP_WR = 38;

type FavVsFracoTierCode = "Fav T1" | "Fav T2" | "Fav T3";

function getFavVsFracoTierConfig(tier: FavVsFracoTierCode) {
  switch (tier) {
    case "Fav T1":
      return { minGap: 20, maxGameInDay: 8, noLossStreak: true };
    case "Fav T2":
      return { minGap: 15, maxGameInDay: 4, noLossStreak: false };
    case "Fav T3":
      return { minGap: 15, maxGameInDay: 8, noLossStreak: false };
  }
}

function computePlayerWinRates(matches: UnifiedMatch[], sampleSize: number) {
  const playerMatches = new Map<string, UnifiedMatch[]>();
  const playerNames = new Map<string, string>();
  for (const match of matches) {
    const homeKey = normalizeKey(match.homePlayer);
    const awayKey = normalizeKey(match.awayPlayer);
    if (!playerMatches.has(homeKey)) playerMatches.set(homeKey, []);
    if (!playerMatches.has(awayKey)) playerMatches.set(awayKey, []);
    playerMatches.get(homeKey)!.push(match);
    playerMatches.get(awayKey)!.push(match);
    playerNames.set(homeKey, match.homePlayer);
    playerNames.set(awayKey, match.awayPlayer);
  }

  const winRates = new Map<
    string,
    {
      name: string;
      wr: number;
      totalGames: number;
      recentResults: DashboardSequenceResult[];
    }
  >();

  for (const [key, pMatches] of playerMatches) {
    const sorted = [...pMatches].sort(
      (a, b) => b.playedAt.getTime() - a.playedAt.getTime(),
    );
    const sample = sorted.slice(0, sampleSize);
    if (sample.length < 20) continue;
    const realName = playerNames.get(key) ?? key;
    let wins = 0;
    const recentResults: DashboardSequenceResult[] = [];
    for (const m of sample) {
      const result = getPlayerResultCode(m, realName);
      if (result === "W") wins++;
      recentResults.push(result);
    }
    winRates.set(key, {
      name: realName,
      wr: round((wins / sample.length) * 100),
      totalGames: sample.length,
      recentResults,
    });
  }

  return winRates;
}

export type AlertPlayerStats = {
  playerWinRate: number;
  opponentWinRate: number;
  h2hLast48: { total: number; wins: number; wr: number };
  h2hLast24: { total: number; wins: number; wr: number };
};

function computeWRFromMatches(
  matches: UnifiedMatch[],
  playerName: string,
): number {
  const key = normalizeKey(playerName);
  const playerMatches = matches.filter(
    (m) =>
      normalizeKey(m.homePlayer) === key || normalizeKey(m.awayPlayer) === key,
  );
  if (!playerMatches.length) return 0;
  const wins = playerMatches.filter(
    (m) => getPlayerResultCode(m, playerName) === "W",
  ).length;
  return round((wins / playerMatches.length) * 100);
}

function computeH2HFromMatches(
  matches: UnifiedMatch[],
  playerName: string,
  opponentName: string,
  lastN: number,
): { total: number; wins: number; wr: number } {
  const pKey = normalizeKey(playerName);
  const oKey = normalizeKey(opponentName);
  const h2h = matches
    .filter((m) => {
      const h = normalizeKey(m.homePlayer);
      const a = normalizeKey(m.awayPlayer);
      return (h === pKey && a === oKey) || (h === oKey && a === pKey);
    })
    .sort((a, b) => b.playedAt.getTime() - a.playedAt.getTime())
    .slice(0, lastN);
  if (!h2h.length) return { total: 0, wins: 0, wr: 0 };
  const wins = h2h.filter(
    (m) => getPlayerResultCode(m, playerName) === "W",
  ).length;
  return { total: h2h.length, wins, wr: round((wins / h2h.length) * 100) };
}

function buildAlertPlayerStats(
  matches: UnifiedMatch[],
  playerName: string,
  opponentName: string,
): AlertPlayerStats {
  return {
    playerWinRate: computeWRFromMatches(matches, playerName),
    opponentWinRate: computeWRFromMatches(matches, opponentName),
    h2hLast48: computeH2HFromMatches(matches, playerName, opponentName, 48),
    h2hLast24: computeH2HFromMatches(matches, playerName, opponentName, 24),
  };
}

export async function computeAlertPlayerStats(
  leagueType: ConfrontationMethodsLeagueType,
  playerName: string,
  opponentName: string,
  windowDays: number,
): Promise<AlertPlayerStats> {
  const since = getRecentDaysStart(windowDays);
  const allMatches = filterMatchesByLeague(
    await loadUnifiedMatches({ since }),
    leagueType,
  );
  return buildAlertPlayerStats(allMatches, playerName, opponentName);
}

function countPlayerLossStreak(recentResults: DashboardSequenceResult[]) {
  let streak = 0;
  for (const r of recentResults) {
    if (r === "L") streak++;
    else break;
  }
  return streak;
}

function countPlayerGameInDay(
  allMatches: UnifiedMatch[],
  playerName: string,
  fixturePlayedAt: Date,
  leagueType: ConfrontationMethodsLeagueType,
  fixtureSeasonId?: number | null,
  seasonCache?: Map<number, Date>,
) {
  const playerKey = normalizeKey(playerName);
  const getWindowForMatch = (playedAt: Date, seasonId?: number | null) => {
    if (leagueType === "GT LEAGUE" && seasonId && seasonCache?.has(seasonId)) {
      return getDashboardSnapshotWindow(seasonCache.get(seasonId)!, leagueType);
    }
    return getDashboardSnapshotWindow(playedAt, leagueType);
  };
  const fixtureWindow = getWindowForMatch(fixturePlayedAt, fixtureSeasonId);
  let count = 0;

  for (const match of allMatches) {
    if (
      normalizeKey(match.homePlayer) !== playerKey &&
      normalizeKey(match.awayPlayer) !== playerKey
    )
      continue;
    if (match.playedAt.getTime() >= fixturePlayedAt.getTime()) continue;
    const matchWindow = getWindowForMatch(match.playedAt, match.seasonId);
    if (matchWindow.dayKey !== fixtureWindow.dayKey) continue;
    count++;
  }

  return count + 1;
}

export async function getFutureFavoritoVsFracoMethodsLive(
  leagueType: ConfrontationMethodsLeagueType,
  options: {
    methodCode: FavVsFracoTierCode;
    series?: ConfrontationSeriesCode;
    days?: number;
  },
): Promise<FuturePlayerSessionMethodsResponse> {
  const tierConfig = getFavVsFracoTierConfig(options.methodCode);
  const snapshot = await getDashboardLeagueCurrentJLive(leagueType, {
    scope: leagueType === "GT LEAGUE" ? "window" : "day",
  });
  const historySince = getRecentDaysStart(options.days ?? 60);
  const allMatches = filterMatchesByLeague(
    await loadUnifiedMatches({ since: historySince }),
    leagueType,
  )
    .filter((match) =>
      matchesSeriesFilter(options.series, leagueType, match.leagueGroup),
    )
    .sort((a, b) => a.playedAt.getTime() - b.playedAt.getTime());

  const wrSince = getRecentDaysStart(120);
  const wrMatches = filterMatchesByLeague(
    await loadUnifiedMatches({ since: wrSince }),
    leagueType,
  );
  const winRates = computePlayerWinRates(wrMatches, FAV_VS_FRACO_WR_SAMPLE);

  // Build season start cache for GT LEAGUE season-aware window classification
  const favFracoSeasonCache = new Map<number, Date>();
  if (leagueType === "GT LEAGUE") {
    for (const match of allMatches) {
      if (match.seasonId) {
        const current = favFracoSeasonCache.get(match.seasonId);
        if (!current || match.playedAt.getTime() < current.getTime()) {
          favFracoSeasonCache.set(match.seasonId, match.playedAt);
        }
      }
    }
  }

  const rows: FuturePlayerSessionMethodRow[] = [];
  const nowMs = Date.now();
  const favFracoMaxHorizonMs =
    leagueType === "GT LEAGUE" ? 2 * 60 * 60 * 1000 : Infinity;

  for (const fixture of snapshot.fixtures) {
    if (!matchesSeriesFilter(options.series, leagueType, fixture.groupLabel))
      continue;

    const fixtureAt = new Date(fixture.playedAt);
    if (Number.isNaN(fixtureAt.getTime()) || fixtureAt.getTime() < nowMs)
      continue;
    if (fixtureAt.getTime() - nowMs > favFracoMaxHorizonMs) continue;

    if (
      hasPlayerPendingPriorGame(
        snapshot.fixtures,
        [fixture.homePlayer, fixture.awayPlayer],
        fixtureAt.getTime(),
      )
    )
      continue;

    const homeKey = normalizeKey(fixture.homePlayer);
    const awayKey = normalizeKey(fixture.awayPlayer);
    const homeWR = winRates.get(homeKey);
    const awayWR = winRates.get(awayKey);
    if (!homeWR || !awayWR) continue;

    const perspectives = [
      {
        fav: homeWR,
        opp: awayWR,
        favName: fixture.homePlayer,
        oppName: fixture.awayPlayer,
      },
      {
        fav: awayWR,
        opp: homeWR,
        favName: fixture.awayPlayer,
        oppName: fixture.homePlayer,
      },
    ];

    for (const { fav, opp, favName, oppName } of perspectives) {
      if (fav.wr < FAV_VS_FRACO_MIN_WR) continue;
      if (opp.wr >= FAV_VS_FRACO_MAX_OPP_WR) continue;
      const gap = fav.wr - opp.wr;
      if (gap < tierConfig.minGap) continue;

      const gameInDay = countPlayerGameInDay(
        allMatches,
        favName,
        fixtureAt,
        leagueType,
        fixture.seasonId,
        favFracoSeasonCache,
      );
      if (gameInDay > tierConfig.maxGameInDay) continue;

      if (tierConfig.noLossStreak) {
        const lossStreak = countPlayerLossStreak(fav.recentResults);
        if (lossStreak > 0) continue;
      }

      const historicalStats = buildFavVsFracoHistoricalStats(
        allMatches,
        leagueType,
        favName,
        oppName,
        options.methodCode,
        tierConfig,
      );
      const apx =
        historicalStats.totalOccurrences > 0
          ? round(
              (historicalStats.wins / historicalStats.totalOccurrences) * 100,
            )
          : 0;

      rows.push({
        fixtureId: fixture.id,
        confrontationKey: `FAV::${normalizeKey(favName)}::${normalizeKey(oppName)}`,
        confrontationLabel: `${favName} x ${oppName}`,
        fixtureLabel: `${fixture.homePlayer} x ${fixture.awayPlayer}`,
        leagueType,
        groupLabel: fixture.groupLabel ?? null,
        seasonId: fixture.seasonId ?? null,
        playedAtIso: fixture.playedAt,
        localPlayedAtLabel: fixtureAt.toLocaleString("pt-BR"),
        playerName: favName,
        opponentName: oppName,
        methodCode: options.methodCode,
        apx,
        totalOccurrences: historicalStats.totalOccurrences,
        wins: historicalStats.wins,
        draws: historicalStats.draws,
        losses: historicalStats.losses,
        occurrenceResults: historicalStats.occurrenceResults,
        triggerSequence: [
          `WR ${fav.wr}%`,
          `Gap ${gap}pp`,
          `#${gameInDay}`,
        ] as unknown as DashboardSequenceResult[],
        daySequence: fav.recentResults.slice(0, 10),
        ...buildAlertPlayerStats(allMatches, favName, oppName),
      });
    }
  }

  rows.sort(
    (a, b) =>
      new Date(a.playedAtIso).getTime() - new Date(b.playedAtIso).getTime() ||
      b.apx - a.apx ||
      a.playerName.localeCompare(b.playerName, "pt-BR", {
        sensitivity: "base",
      }),
  );

  return {
    generatedAt: new Date().toISOString(),
    leagueType,
    currentWindow: snapshot.currentWindow,
    availableMethods: PLAYER_SESSION_METHODS,
    rows,
  };
}

function buildFavVsFracoHistoricalStats(
  matches: UnifiedMatch[],
  _leagueType: ConfrontationMethodsLeagueType,
  favName: string,
  oppName: string,
  _methodCode: FavVsFracoTierCode,
  _tierConfig: ReturnType<typeof getFavVsFracoTierConfig>,
) {
  const favKey = normalizeKey(favName);
  const oppKey = normalizeKey(oppName);

  const confrontationMatches = matches
    .filter((m) => {
      const h = normalizeKey(m.homePlayer);
      const a = normalizeKey(m.awayPlayer);
      return (h === favKey && a === oppKey) || (h === oppKey && a === favKey);
    })
    .sort((a, b) => a.playedAt.getTime() - b.playedAt.getTime());

  const occurrenceResults: DashboardSequenceResult[] = [];
  let wins = 0;
  let draws = 0;
  let losses = 0;

  for (const match of confrontationMatches) {
    const result = getPlayerResultCode(match, favName);
    occurrenceResults.push(result);
    if (result === "W") wins++;
    else if (result === "D") draws++;
    else losses++;
  }

  return {
    totalOccurrences: occurrenceResults.length,
    wins,
    draws,
    losses,
    apx:
      occurrenceResults.length > 0
        ? round((wins / occurrenceResults.length) * 100)
        : 0,
    occurrenceResults,
  };
}

export async function getConfrontationMethodsLive(
  leagueType: ConfrontationMethodsLeagueType,
  methodCode: ConfrontationMethodCode,
  options: ConfrontationMethodsOptions = {},
): Promise<ConfrontationMethodsResponse> {
  const {
    series,
    includeHistory = true,
    confrontationKey,
    confrontationKeys,
    days,
  } = options;
  const since = days ? getRecentDaysStart(days) : getRecentMonthsStart(3);
  const allowedConfrontationKeys = new Set(
    [
      ...(confrontationKey ? [confrontationKey] : []),
      ...(confrontationKeys ?? []),
    ].map((item) => item.trim().toUpperCase()),
  );
  const allowedGroupedConfrontationKeys = new Set(
    Array.from(allowedConfrontationKeys).map((item) =>
      buildSortedConfrontationFilterKey(item),
    ),
  );
  const matches = (await loadUnifiedMatches({ since, leagueType }))
    .filter((match) => {
      if (!series || leagueType !== "GT LEAGUE") {
        return true;
      }

      return getGtSeriesCode(match.leagueGroup) === series;
    })
    .sort((left, right) => left.playedAt.getTime() - right.playedAt.getTime());
  const groupedMatches = new Map<
    string,
    { players: [string, string]; dayKey: string; matches: UnifiedMatch[] }
  >();

  for (const match of matches) {
    const [playerOne, playerTwo] = buildConfrontationPlayers(
      match.homePlayer,
      match.awayPlayer,
    );
    const confrontationKey = `${normalizeKey(playerOne)}||${normalizeKey(playerTwo)}`;

    if (
      allowedGroupedConfrontationKeys.size > 0 &&
      !allowedGroupedConfrontationKeys.has(confrontationKey)
    ) {
      continue;
    }

    const dayKey = getDisparityOperationalDayKey(match);
    const scopeKey = buildConfrontationMethodScopeKey(match, methodCode);
    const groupKey = `${confrontationKey}||${scopeKey}`;
    const current = groupedMatches.get(groupKey) ?? {
      players: [playerOne, playerTwo] as [string, string],
      dayKey,
      matches: [] as UnifiedMatch[],
    };

    current.matches.push(match);
    groupedMatches.set(groupKey, current);
  }

  const rowsByConfrontation = new Map<string, ConfrontationMethodRow>();

  for (const group of groupedMatches.values()) {
    const sortedMatches = [...group.matches].sort(
      (left, right) => left.playedAt.getTime() - right.playedAt.getTime(),
    );
    const perspectives: Array<{ playerName: string; opponentName: string }> = [
      { playerName: group.players[0], opponentName: group.players[1] },
      { playerName: group.players[1], opponentName: group.players[0] },
    ];

    perspectives.forEach(({ playerName, opponentName }) => {
      const confrontationKey = buildOrderedConfrontationKey(
        playerName,
        opponentName,
      );

      if (
        allowedConfrontationKeys.size > 0 &&
        !allowedConfrontationKeys.has(confrontationKey)
      ) {
        return;
      }

      const confrontationLabel = `${playerName} x ${opponentName}`;
      const daySequence = sortedMatches.map((match) =>
        getPlayerResultCode(match, playerName),
      );

      sortedMatches.forEach((match, index) => {
        const currentResult = daySequence[index];
        const previousSequence = daySequence.slice(0, index);
        const previousOne = daySequence.slice(Math.max(0, index - 1), index);
        const previousTwo = daySequence.slice(Math.max(0, index - 2), index);
        const previousThree = daySequence.slice(Math.max(0, index - 3), index);
        const previousFour = daySequence.slice(Math.max(0, index - 4), index);

        if (
          !matchesConfrontationMethod(
            methodCode,
            leagueType,
            previousSequence,
            currentResult,
            previousOne,
            previousTwo,
            previousThree,
            previousFour,
          )
        ) {
          return;
        }

        const row = rowsByConfrontation.get(confrontationKey) ?? {
          confrontationKey,
          confrontationLabel,
          totalOccurrences: 0,
          wins: 0,
          draws: 0,
          losses: 0,
          apx: 0,
          history: [],
        };

        row.totalOccurrences += 1;
        row.wins += currentResult === "W" ? 1 : 0;
        row.draws += currentResult === "D" ? 1 : 0;
        row.losses += currentResult === "L" ? 1 : 0;

        if (includeHistory) {
          const detail = buildDisparityMatchDetail(match, playerName);
          const dayHistory = sortedMatches.map((dayMatch, dayIndex) => {
            const dayDetail = buildDisparityMatchDetail(dayMatch, playerName);

            return {
              matchId: dayMatch.id,
              matchNumber: dayIndex + 1,
              localTimeLabel: dayDetail.localTimeLabel,
              localPlayedAtLabel: dayDetail.localPlayedAtLabel,
              result: dayDetail.result,
              fullTimeScore: dayDetail.fullTimeScore,
              isMethodEntry: dayMatch.id === match.id,
            };
          });
          const windowLabel =
            leagueType === "GT LEAGUE" || leagueType === "6MIN VOLTA"
              ? getDisparityOperationalWindow(match.playedAt, leagueType)
                  .windowLabel
              : "Dia";

          row.history.push({
            matchId: match.id,
            dayKey: group.dayKey,
            dayLabel: formatOperationalDayKey(group.dayKey),
            windowLabel,
            localTimeLabel: detail.localTimeLabel,
            localPlayedAtLabel: detail.localPlayedAtLabel,
            playedAtIso: match.playedAt.toISOString(),
            seasonId: match.seasonId,
            result: currentResult,
            fullTimeScore: detail.fullTimeScore,
            triggerSequence: buildConfrontationMethodTriggerSequence(
              methodCode,
              previousSequence,
              previousOne,
              previousTwo,
              previousThree,
              previousFour,
            ),
            daySequence,
            dayHistory,
          });
        }

        rowsByConfrontation.set(confrontationKey, row);
      });
    });
  }

  const rows = Array.from(rowsByConfrontation.values())
    .map((row) => ({
      ...row,
      apx: row.totalOccurrences
        ? round((row.wins / row.totalOccurrences) * 100)
        : 0,
      history: [...row.history].sort((left, right) =>
        right.playedAtIso.localeCompare(left.playedAtIso, "pt-BR", {
          sensitivity: "base",
        }),
      ),
    }))
    .sort(
      (left, right) =>
        right.totalOccurrences - left.totalOccurrences ||
        right.wins - left.wins ||
        right.apx - left.apx ||
        left.confrontationLabel.localeCompare(
          right.confrontationLabel,
          "pt-BR",
          { sensitivity: "base" },
        ),
    );

  return {
    generatedAt: new Date().toISOString(),
    leagueType,
    methodCode,
    availableMethods: CONFRONTATION_METHODS,
    rows,
  };
}

export async function getConfrontationMethodOccurrenceRecordsLive(
  leagueType: ConfrontationMethodsLeagueType,
  methodCode: ConfrontationMethodCode,
  options: ConfrontationMethodsOptions = {},
): Promise<ConfrontationMethodOccurrenceRecord[]> {
  const since = options.days
    ? getRecentDaysStart(options.days)
    : getRecentMonthsStart(3);
  const [response, matches] = await Promise.all([
    getConfrontationMethodsLive(leagueType, methodCode, {
      ...options,
      includeHistory: true,
    }),
    loadUnifiedMatches({ since, leagueType }),
  ]);
  const matchesById = new Map(matches.map((match) => [match.id, match]));

  return response.rows
    .flatMap((row) => {
      const [playerName, opponentName] = row.confrontationLabel.split(" x ");

      return row.history.map((occurrence) => {
        const match = matchesById.get(occurrence.matchId);

        return {
          leagueType,
          methodCode,
          series:
            leagueType === "GT LEAGUE"
              ? getGtSeriesCode(match?.leagueGroup ?? null)
              : null,
          playerName,
          opponentName,
          confrontationKey: row.confrontationKey,
          confrontationLabel: row.confrontationLabel,
          occurrenceMatchId: occurrence.matchId,
          occurrencePlayedAt: occurrence.playedAtIso,
          dayKey: occurrence.dayKey,
          dayLabel: occurrence.dayLabel,
          windowLabel: occurrence.windowLabel,
          seasonId: occurrence.seasonId,
          result: occurrence.result,
          fullTimeScore: occurrence.fullTimeScore,
          wins: row.wins,
          draws: row.draws,
          losses: row.losses,
          apx: row.apx,
          totalOccurrences: row.totalOccurrences,
          triggerSequence: occurrence.triggerSequence,
          daySequence: occurrence.daySequence,
          dayHistory: occurrence.dayHistory,
        };
      });
    })
    .sort(
      (left, right) =>
        right.occurrencePlayedAt.localeCompare(
          left.occurrencePlayedAt,
          "pt-BR",
          {
            sensitivity: "base",
          },
        ) ||
        left.confrontationLabel.localeCompare(
          right.confrontationLabel,
          "pt-BR",
          {
            sensitivity: "base",
          },
        ),
    );
}

export async function getMethodSummariesLive() {
  const [aggregateMethods, timelineMethods] = await Promise.all([
    loadMethodSummaries(),
    getTimelineMethodSummariesLive(),
  ]);
  return [...aggregateMethods, ...timelineMethods];
}

export async function getMethodEvaluationLive(methodId: string) {
  const methods = await getMethodSummariesLive();
  return methods.find((method) => method.id === methodId) ?? null;
}

async function getDashboardMethodSummariesLive(
  options: DashboardWindowOptions,
): Promise<MethodSummary[]> {
  const [aggregateMethods, timelineMethods] = await Promise.all([
    loadMethodSummaries(),
    getTimelineMethodSummariesLive(options.days),
  ]);
  const filteredAggregateMethods = options.leagueType
    ? aggregateMethods.filter(
        (method) => method.leagueType === options.leagueType,
      )
    : aggregateMethods;
  const filteredTimelineMethods = options.leagueType
    ? timelineMethods.filter(
        (method) => method.leagueType === options.leagueType,
      )
    : timelineMethods;

  if (!options.leagueType || options.leagueType === "GT LEAGUE") {
    return filteredTimelineMethods;
  }

  return filteredAggregateMethods;
}

export async function getTimelineMethodSummariesLive(
  days?: number,
): Promise<TimelineMethodSummary[]> {
  const backtests = await computeTimelineBacktests();

  return TIMELINE_METHODS.map((method) => {
    const backtest = backtests[method.id]
      ? filterTimelineBacktestByDays(backtests[method.id], days)
      : null;

    return {
      id: method.id,
      name: method.definition.name,
      description: `${method.definition.description} Backtest cronologico em fixtures reais de ${method.leagueType}.`,
      leagueType: method.leagueType,
      entries: backtest?.metrics.entries ?? 0,
      netProfit: backtest?.metrics.netProfit ?? 0,
      roi: backtest?.metrics.roi ?? 0,
      source: "timeline",
    } satisfies TimelineMethodSummary;
  });
}

export async function getRuleBasedBacktestLive(
  methodId: string,
): Promise<TimelineBacktestResult | null> {
  const backtests = await computeTimelineBacktests();
  return backtests[methodId] ?? null;
}

export async function getBacktestSummaryLive(methodId: string) {
  const timelineBacktest = await getRuleBasedBacktestLive(methodId);

  if (timelineBacktest) {
    return timelineBacktest;
  }

  const method = METHOD_TABLES.find((item) => item.id === methodId);

  if (!method) {
    return null;
  }

  const rows = await prisma.$queryRawUnsafe<
    Array<{
      playerA: string | null;
      playerB: string | null;
      handicap: string | null;
      entries: bigint | number | null;
      netProfit: number | null;
      roi: number | null;
    }>
  >(
    `
      SELECT
        ${method.playerOneColumn} AS playerA,
        ${method.playerTwoColumn} AS playerB,
        ${method.hcColumn} AS handicap,
        COALESCE(SUM(COALESCE(__ENTRIES__, 0)), 0) AS entries,
        COALESCE(SUM(CAST(REPLACE(CAST(lucro AS CHAR), ',', '.') AS DECIMAL(18,4))), 0) AS netProfit,
        COALESCE(AVG(CAST(REPLACE(CAST(roi AS CHAR), ',', '.') AS DECIMAL(18,4))), 0) AS roi
      FROM ${method.tableName}
      GROUP BY ${method.playerOneColumn}, ${method.playerTwoColumn}, ${method.hcColumn}
      ORDER BY netProfit DESC
      LIMIT 100
    `.replace(/__ENTRIES__/g, `\`${method.entriesColumn}\``),
  );

  const normalizedRows: MethodBreakdownRow[] = rows.map((row) => ({
    playerA: row.playerA,
    playerB: row.playerB,
    handicap: row.handicap,
    entries: Number(row.entries ?? 0),
    netProfit: round(Number(row.netProfit ?? 0)),
    roi: round(Number(row.roi ?? 0)),
  }));

  const totalEntries = normalizedRows.reduce(
    (sum, row) => sum + row.entries,
    0,
  );
  const netProfit = normalizedRows.reduce((sum, row) => sum + row.netProfit, 0);
  const greenGroups = normalizedRows.filter((row) => row.netProfit > 0);
  const redGroups = normalizedRows.filter((row) => row.netProfit < 0);
  const voidGroups = normalizedRows.filter((row) => row.netProfit === 0);
  const averageRoi = normalizedRows.length
    ? round(
        normalizedRows.reduce((sum, row) => sum + row.roi, 0) /
          normalizedRows.length,
      )
    : 0;
  const grossProfit = greenGroups.reduce((sum, row) => sum + row.netProfit, 0);
  const grossLoss = Math.abs(
    redGroups.reduce((sum, row) => sum + row.netProfit, 0),
  );
  const handicapSummary = Array.from(
    normalizedRows.reduce((map, row) => {
      const key = row.handicap ?? "Sem HC";
      const current = map.get(key) ?? {
        handicap: key,
        entries: 0,
        netProfit: 0,
        roiTotal: 0,
        groups: 0,
      };
      current.entries += row.entries;
      current.netProfit += row.netProfit;
      current.roiTotal += row.roi;
      current.groups += 1;
      map.set(key, current);
      return map;
    }, new Map<string, { handicap: string; entries: number; netProfit: number; roiTotal: number; groups: number }>()),
  )
    .map(([, item]) => ({
      handicap: item.handicap,
      entries: item.entries,
      netProfit: round(item.netProfit),
      roi: item.groups ? round(item.roiTotal / item.groups) : 0,
    }))
    .sort((left, right) => right.netProfit - left.netProfit);

  return {
    methodId,
    methodName: method.name,
    leagueType: method.leagueType,
    mode: "aggregate",
    limitations: [
      "Os dados disponiveis para este metodo sao agregados por combinacao de jogadores e handicap.",
      "Nao existe coluna temporal nessas tabelas, entao curva de capital cronologica e drawdown real nao podem ser reconstruidos com fidelidade.",
    ],
    entries: [],
    breakdown: normalizedRows,
    segments: {
      byHandicap: handicapSummary,
      topPairs: normalizedRows.slice(0, 10),
      worstPairs: [...normalizedRows]
        .sort((left, right) => left.netProfit - right.netProfit)
        .slice(0, 10),
    },
    metrics: {
      entries: totalEntries,
      greens: greenGroups.length,
      reds: redGroups.length,
      voids: voidGroups.length,
      hitRate: normalizedRows.length
        ? round((greenGroups.length / normalizedRows.length) * 100)
        : 0,
      averageOdd: 0,
      netProfit: round(netProfit),
      roi: averageRoi,
      yield: averageRoi,
      maxDrawdown: 0,
      profitFactor: grossLoss
        ? round(grossProfit / grossLoss)
        : greenGroups.length
          ? round(grossProfit)
          : 0,
      maxGreenStreak: 0,
      maxRedStreak: 0,
    },
  };
}

function resolveDisparityPlayerName(playerNameOrId: string) {
  return playerNameOrId.replace(/disp$/i, "").replace(/-/g, " ");
}

function getPlayerResultCode(match: UnifiedMatch, playerName: string) {
  const key = normalizeKey(playerName);
  const isHome = normalizeKey(match.homePlayer) === key;

  if (match.homeScore === match.awayScore) {
    return "D" as const;
  }

  if (
    (isHome && match.homeScore > match.awayScore) ||
    (!isHome && match.awayScore > match.homeScore)
  ) {
    return "W" as const;
  }

  return "L" as const;
}

function getDisparityChampionshipKey(match: UnifiedMatch) {
  const championshipWindow = getDisparityChampionshipWindow(match);

  if (championshipWindow.key) {
    return championshipWindow.key;
  }

  return `${match.leagueType}-${match.playedAt.toISOString().slice(0, 10)}`;
}

function getOperationalDateParts(date: Date) {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: DISPARITY_OPERATIONAL_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });

  const parts = formatter.formatToParts(date);
  const getPart = (type: string) =>
    parts.find((part) => part.type === type)?.value ?? "00";

  return {
    year: Number(getPart("year")),
    month: Number(getPart("month")),
    day: Number(getPart("day")),
    hour: Number(getPart("hour")),
    minute: Number(getPart("minute")),
  };
}

function buildOperationalDateKey(year: number, month: number, day: number) {
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function getPreviousOperationalDateKey(
  year: number,
  month: number,
  day: number,
) {
  const utcDate = new Date(Date.UTC(year, month - 1, day));
  utcDate.setUTCDate(utcDate.getUTCDate() - 1);

  return buildOperationalDateKey(
    utcDate.getUTCFullYear(),
    utcDate.getUTCMonth() + 1,
    utcDate.getUTCDate(),
  );
}

function formatOperationalDayKey(dayKey: string) {
  const [year, month, day] = dayKey.split("-").map((value) => Number(value));
  return new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "short",
    timeZone: DISPARITY_OPERATIONAL_TIME_ZONE,
  }).format(new Date(Date.UTC(year, month - 1, day, 12, 0, 0)));
}

function formatMinuteOfDayLabel(value: number) {
  const hours = Math.floor(value / 60);
  const minutes = value % 60;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

const GT_DASHBOARD_WINDOW_STARTS = {
  j1StartMinute: 0,
  j2StartMinute: 8 * 60,
  j3StartMinute: 16 * 60,
} as const;

const GT_DASHBOARD_RANGE_LABEL_BY_WINDOW: Record<DashboardWindowLabel, string> =
  {
    J1: "00:00-07:30",
    J2: "08:00-15:30",
    J3: "16:00-00:30",
    J4: "J4",
    J5: "J5",
    Dia: "00:00-00:30",
  };

function getGtDashboardOperationalWindow(date: Date) {
  const parts = getOperationalDateParts(date);
  const minuteOfDay = parts.hour * 60 + parts.minute;
  const dayKey = buildOperationalDateKey(parts.year, parts.month, parts.day);

  if (minuteOfDay < GT_DASHBOARD_WINDOW_STARTS.j2StartMinute) {
    return {
      dayKey,
      windowLabel: "J1" as const,
      minuteOfDay,
    };
  }

  if (minuteOfDay < GT_DASHBOARD_WINDOW_STARTS.j3StartMinute) {
    return {
      dayKey,
      windowLabel: "J2" as const,
      minuteOfDay,
    };
  }

  return {
    dayKey,
    windowLabel: "J3" as const,
    minuteOfDay,
  };
}

function buildDefaultRangeLabelByWindow(config: DisparityConfig) {
  return {
    J1: `${formatMinuteOfDayLabel(config.operationalDayStartMinute)}-${formatMinuteOfDayLabel(config.windowTwoStartMinute)}`,
    J2: `${formatMinuteOfDayLabel(config.windowTwoStartMinute)}-${formatMinuteOfDayLabel(config.windowThreeStartMinute)}`,
    J3: `${formatMinuteOfDayLabel(config.windowThreeStartMinute)}-${formatMinuteOfDayLabel(config.operationalDayStartMinute)}`,
  } as const;
}

export function getDisparityOperationalWindow(
  date: Date,
  leagueType: DisparityLeagueType,
) {
  const parts = getOperationalDateParts(date);
  const minuteOfDay = parts.hour * 60 + parts.minute;
  const config = getDisparityConfig(leagueType);

  if (minuteOfDay < config.operationalDayStartMinute) {
    const lastWindow = config.windowFiveStartMinute ? "J5" : "J3";
    return {
      dayKey: getPreviousOperationalDateKey(parts.year, parts.month, parts.day),
      windowLabel: lastWindow,
      minuteOfDay,
    };
  }

  if (minuteOfDay < config.windowTwoStartMinute) {
    return {
      dayKey: buildOperationalDateKey(parts.year, parts.month, parts.day),
      windowLabel: "J1",
      minuteOfDay,
    };
  }

  if (minuteOfDay < config.windowThreeStartMinute) {
    return {
      dayKey: buildOperationalDateKey(parts.year, parts.month, parts.day),
      windowLabel: "J2",
      minuteOfDay,
    };
  }

  if (
    config.windowFourStartMinute &&
    minuteOfDay < config.windowFourStartMinute
  ) {
    return {
      dayKey: buildOperationalDateKey(parts.year, parts.month, parts.day),
      windowLabel: "J3",
      minuteOfDay,
    };
  }

  if (
    config.windowFiveStartMinute &&
    minuteOfDay < config.windowFiveStartMinute
  ) {
    return {
      dayKey: buildOperationalDateKey(parts.year, parts.month, parts.day),
      windowLabel: "J4",
      minuteOfDay,
    };
  }

  const lastWindow = config.windowFiveStartMinute
    ? "J5"
    : config.windowFourStartMinute
      ? "J4"
      : "J3";
  return {
    dayKey: buildOperationalDateKey(parts.year, parts.month, parts.day),
    windowLabel: lastWindow,
    minuteOfDay,
  };
}

function getDisparityChampionshipWindow(match: UnifiedMatch) {
  if (match.leagueType === "H2H") {
    const dayKey = getDisparityLocalDateKey(match.playedAt);

    return {
      key: `H2H-${dayKey}`,
      seasonId: null,
      label: dayKey,
    };
  }

  if (!match.seasonId) {
    return {
      key: null,
      seasonId: null,
      label: null,
    };
  }

  if (match.leagueType === "GT LEAGUE" || match.leagueType === "6MIN VOLTA") {
    const operationalWindow = getDisparityOperationalWindow(
      match.playedAt,
      match.leagueType,
    );

    return {
      key: `${match.leagueType}-${operationalWindow.dayKey}-${operationalWindow.windowLabel}`,
      seasonId: match.seasonId,
      label: String(match.seasonId),
    };
  }

  return {
    key: `${match.leagueType}-${match.seasonId}`,
    seasonId: match.seasonId,
    label: String(match.seasonId),
  };
}

function formatDisparityWindowDate(date: Date) {
  return new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "short",
    timeZone: DISPARITY_OPERATIONAL_TIME_ZONE,
  }).format(date);
}

function formatDisparityOperationalTime(date: Date) {
  return new Intl.DateTimeFormat("pt-BR", {
    timeStyle: "short",
    timeZone: DISPARITY_OPERATIONAL_TIME_ZONE,
  }).format(date);
}

function formatDisparityOperationalDateTime(date: Date) {
  return new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "short",
    timeStyle: "short",
    timeZone: DISPARITY_OPERATIONAL_TIME_ZONE,
  }).format(date);
}

function getDisparityLocalDateKey(date: Date) {
  const parts = getOperationalDateParts(date);
  return buildOperationalDateKey(parts.year, parts.month, parts.day);
}

function getEightMinOperationalDay(date: Date) {
  const parts = getOperationalDateParts(date);
  const minuteOfDay = parts.hour * 60 + parts.minute;

  if (minuteOfDay <= EIGHT_MIN_OPERATIONAL_WINDOW_END_MINUTE) {
    return {
      dayKey: getPreviousOperationalDateKey(parts.year, parts.month, parts.day),
      minuteOfDay,
    };
  }

  return {
    dayKey: buildOperationalDateKey(parts.year, parts.month, parts.day),
    minuteOfDay,
  };
}

function getDisparityOperationalDayKey(match: UnifiedMatch) {
  if (match.leagueType === "8MIN BATTLE") {
    return getEightMinOperationalDay(match.playedAt).dayKey;
  }

  return match.leagueType === "GT LEAGUE" || match.leagueType === "6MIN VOLTA"
    ? getDisparityOperationalWindow(match.playedAt, match.leagueType).dayKey
    : getDisparityLocalDateKey(match.playedAt);
}

function getNormalizedDisparityWindowMatches(
  matches: UnifiedMatch[],
  playerName: string,
  config: DisparityConfig,
) {
  if (!matches.length) {
    return [] as UnifiedMatch[];
  }

  const maxOpponentsPerWindow = Math.max(
    1,
    Math.floor(config.gamesPerDay / config.gamesPerOpponent),
  );
  const byOpponent = new Map<string, UnifiedMatch[]>();

  for (const match of matches) {
    const opponent =
      normalizeKey(match.homePlayer) === normalizeKey(playerName)
        ? match.awayPlayer
        : match.homePlayer;
    const key = normalizeKey(opponent);
    const current = byOpponent.get(key) ?? [];
    current.push(match);
    byOpponent.set(key, current);
  }

  return Array.from(byOpponent.values())
    .sort((left, right) => {
      const latestRight = Math.max(
        ...right.map((match) => match.playedAt.getTime()),
      );
      const latestLeft = Math.max(
        ...left.map((match) => match.playedAt.getTime()),
      );
      return latestRight - latestLeft;
    })
    .slice(0, maxOpponentsPerWindow)
    .flatMap((opponentMatches) =>
      [...opponentMatches]
        .sort(
          (left, right) => left.playedAt.getTime() - right.playedAt.getTime(),
        )
        .slice(-config.gamesPerOpponent),
    )
    .sort((left, right) => right.playedAt.getTime() - left.playedAt.getTime());
}

function buildDisparityMatchDetail(match: UnifiedMatch, playerName: string) {
  const isHome = normalizeKey(match.homePlayer) === normalizeKey(playerName);
  const opponent = isHome ? match.awayPlayer : match.homePlayer;
  const goalsFor = isHome ? match.homeScore : match.awayScore;
  const goalsAgainst = isHome ? match.awayScore : match.homeScore;
  const intervalGoalsFor =
    match.homeScoreHt === null || match.awayScoreHt === null
      ? null
      : isHome
        ? match.homeScoreHt
        : match.awayScoreHt;
  const intervalGoalsAgainst =
    match.homeScoreHt === null || match.awayScoreHt === null
      ? null
      : isHome
        ? match.awayScoreHt
        : match.homeScoreHt;
  const localDateLabel = formatDisparityWindowDate(match.playedAt);
  const localTimeLabel = formatDisparityOperationalTime(match.playedAt);

  return {
    matchId: match.id,
    playedAt: match.playedAt.toISOString(),
    localDateLabel,
    localTimeLabel,
    localPlayedAtLabel: `${localDateLabel}, ${localTimeLabel}`,
    opponent,
    result: getPlayerResultCode(match, playerName),
    intervalScore:
      intervalGoalsFor === null || intervalGoalsAgainst === null
        ? null
        : `${intervalGoalsFor}-${intervalGoalsAgainst}`,
    fullTimeScore: `${goalsFor}-${goalsAgainst}`,
  };
}

function getDisparityChampionshipPresentation(matches: UnifiedMatch[]) {
  const sortedMatches = [...matches].sort(
    (left, right) => left.playedAt.getTime() - right.playedAt.getTime(),
  );
  const championshipWindow = getDisparityChampionshipWindow(sortedMatches[0]);
  const startedAt = sortedMatches[0]?.playedAt ?? null;
  const dateLabel = startedAt ? formatDisparityWindowDate(startedAt) : null;
  const seasonIds = sortedMatches
    .map((match) => match.seasonId)
    .filter((seasonId): seasonId is number => seasonId !== null)
    .sort((left, right) => left - right);
  const seasonStartId = seasonIds[0] ?? championshipWindow.seasonId;
  const seasonEndId =
    seasonIds[seasonIds.length - 1] ?? championshipWindow.seasonId;
  const seasonLabel =
    seasonStartId !== null && seasonEndId !== null
      ? seasonStartId === seasonEndId
        ? String(seasonStartId)
        : `${seasonStartId}-${seasonEndId}`
      : championshipWindow.label;
  const displayLabel =
    seasonLabel && dateLabel
      ? `${dateLabel} | ${seasonLabel}`
      : (seasonLabel ?? dateLabel);

  return {
    ...championshipWindow,
    seasonId: seasonStartId,
    label: seasonLabel,
    startedAt,
    dateLabel,
    displayLabel,
  };
}

function getDisparityConfig(leagueType: DisparityLeagueType): DisparityConfig {
  if (leagueType === "GT LEAGUE") {
    return {
      title: "GT",
      gamesPerOpponent: 6,
      gamesPerDay: 24,
      // GT now starts the operational day at midnight again, so the early
      // fixtures from 00:00 onward belong to the current day.
      operationalDayStartMinute: 0, // 00:00
      windowTwoStartMinute: 8 * 60, // 08:00
      windowThreeStartMinute: 16 * 60, // 16:00
    };
  }

  if (leagueType === "6MIN VOLTA") {
    return {
      title: "Volta",
      gamesPerOpponent: 8,
      gamesPerDay: 40,
      operationalDayStartMinute: 1 * 60 + 53,
      windowTwoStartMinute: 10 * 60 + 30,
      windowThreeStartMinute: 17 * 60 + 25,
    };
  }

  return {
    title: "Basket",
    gamesPerOpponent: 6,
    gamesPerDay: 24,
    operationalDayStartMinute: 0,
    windowTwoStartMinute: 8 * 60,
    windowThreeStartMinute: 16 * 60,
  };
}

function getDashboardSnapshotWindow(
  date: Date,
  leagueType: DashboardSnapshotLeagueType,
) {
  if (leagueType === "GT LEAGUE") {
    const operationalWindow = getGtDashboardOperationalWindow(date);
    const rangeLabelByWindow: Record<string, string> =
      GT_DASHBOARD_RANGE_LABEL_BY_WINDOW;
    const windowLabel = operationalWindow.windowLabel;

    return {
      dayKey: operationalWindow.dayKey,
      dayLabel: formatOperationalDayKey(operationalWindow.dayKey),
      windowLabel,
      rangeLabel: rangeLabelByWindow[windowLabel] ?? windowLabel,
      description: `Dia operacional ${formatOperationalDayKey(operationalWindow.dayKey)} na ${windowLabel}.`,
      usesOperationalDay: true,
    };
  }

  if (leagueType === "6MIN VOLTA") {
    const config = getDisparityConfig(leagueType);
    const operationalWindow = getDisparityOperationalWindow(date, leagueType);
    const rangeLabelByWindow = buildDefaultRangeLabelByWindow(config);
    const windowLabel =
      operationalWindow.windowLabel as keyof typeof rangeLabelByWindow;

    return {
      dayKey: operationalWindow.dayKey,
      dayLabel: formatOperationalDayKey(operationalWindow.dayKey),
      windowLabel,
      rangeLabel: rangeLabelByWindow[windowLabel],
      description: `Dia operacional ${formatOperationalDayKey(operationalWindow.dayKey)} na ${operationalWindow.windowLabel}.`,
      usesOperationalDay: true,
    };
  }

  const dayKey = getEightMinOperationalDay(date).dayKey;
  return {
    dayKey,
    dayLabel: formatOperationalDayKey(dayKey),
    windowLabel: "Dia",
    rangeLabel: "17:30-01:50",
    description: `Dia operacional ${formatOperationalDayKey(dayKey)} no 8MIN BATTLE. Jogos entre 17:30 e 01:50 permanecem na mesma janela.`,
    usesOperationalDay: true,
  };
}

function buildDashboardOperationalDayWindow(
  dayKey: string,
  leagueType: DashboardSnapshotLeagueType,
) {
  if (leagueType === "8MIN BATTLE") {
    return {
      dayKey,
      dayLabel: formatOperationalDayKey(dayKey),
      windowLabel: "Dia",
      rangeLabel: "17:30-01:50",
      description: `Dia operacional ${formatOperationalDayKey(dayKey)} no 8MIN BATTLE. Jogos entre 17:30 e 01:50 permanecem na mesma janela.`,
      usesOperationalDay: true,
    };
  }

  if (leagueType === "GT LEAGUE") {
    return {
      dayKey,
      dayLabel: formatOperationalDayKey(dayKey),
      windowLabel: "Dia",
      rangeLabel: GT_DASHBOARD_RANGE_LABEL_BY_WINDOW.Dia,
      description: `Dia operacional ${formatOperationalDayKey(dayKey)} no painel da GT League. Classificacao por campeonato usando inicios 00:00 / 08:00 / 16:00, com a janela final se estendendo ate 00:30.`,
      usesOperationalDay: true,
    };
  }

  return {
    dayKey,
    dayLabel: formatOperationalDayKey(dayKey),
    windowLabel: "Dia",
    rangeLabel: "00:00-00:00",
    description: `Dia operacional ${formatOperationalDayKey(dayKey)} no painel da liga.`,
    usesOperationalDay: true,
  };
}

function isDashboardSnapshotWindowMatch(
  date: Date,
  leagueType: DashboardSnapshotLeagueType,
  currentWindow: ReturnType<typeof getDashboardSnapshotWindow>,
) {
  const candidateWindow = getDashboardSnapshotWindow(date, leagueType);
  if (currentWindow.windowLabel === "Dia") {
    return candidateWindow.dayKey === currentWindow.dayKey;
  }

  return (
    candidateWindow.dayKey === currentWindow.dayKey &&
    candidateWindow.windowLabel === currentWindow.windowLabel
  );
}

function serializeDashboardUpcomingFixture(
  fixture: InternalDashboardUpcomingFixture,
): DashboardUpcomingFixture {
  return {
    ...fixture,
    playedAt: fixture.playedAt.toISOString(),
  };
}

function buildDashboardUpcomingFixtureLeagues(
  fixtures: InternalDashboardUpcomingFixture[],
) {
  return [
    {
      leagueType: "GT LEAGUE" as const,
      fixtures: fixtures
        .filter((fixture) => fixture.leagueType === "GT LEAGUE")
        .map(serializeDashboardUpcomingFixture),
    },
    {
      leagueType: "8MIN BATTLE" as const,
      fixtures: fixtures
        .filter((fixture) => fixture.leagueType === "8MIN BATTLE")
        .map(serializeDashboardUpcomingFixture),
    },
    {
      leagueType: "H2H" as const,
      fixtures: fixtures
        .filter((fixture) => fixture.leagueType === "H2H")
        .map(serializeDashboardUpcomingFixture),
    },
    {
      leagueType: "6MIN VOLTA" as const,
      fixtures: fixtures
        .filter((fixture) => fixture.leagueType === "6MIN VOLTA")
        .map(serializeDashboardUpcomingFixture),
    },
  ]
    .map((league) => ({
      leagueType: league.leagueType,
      totalFixtures: league.fixtures.length,
      fixtures: league.fixtures,
    }))
    .filter((league) => league.totalFixtures > 0);
}

function buildDashboardUpcomingFixturesWarning(error: unknown) {
  const rawMessage =
    error instanceof Error
      ? error.message
      : "Base live indisponivel no momento.";

  if (rawMessage.includes("Can't reach database server")) {
    return "Nao foi possivel atualizar os futurematches agora porque a conexao com o banco remoto oscilou. Mostrando o ultimo cache disponivel quando existir.";
  }

  if (rawMessage.includes("Authentication failed")) {
    return "Nao foi possivel atualizar os futurematches agora por falha de autenticacao no MySQL remoto.";
  }

  return "Nao foi possivel atualizar os futurematches agora. Tente novamente em instantes.";
}

async function loadDashboardUpcomingFixtures(
  limit = 36,
  leagueType?: LeagueType,
): Promise<InternalDashboardUpcomingFixture[]> {
  const cappedLimit = Math.min(Math.max(limit, 1), 300);
  const cachedFixtures = dashboardUpcomingFixturesCache.data;

  if (cachedFixtures && dashboardUpcomingFixturesCache.expiresAt > Date.now()) {
    const filteredFixtures = leagueType
      ? cachedFixtures.filter((fixture) => fixture.leagueType === leagueType)
      : cachedFixtures;
    return filteredFixtures.slice(0, cappedLimit);
  }

  const now = new Date();
  const maxLimit = 300;
  const basketOnly = appScope === "basket";
  const shouldLoadGt =
    !basketOnly && (!leagueType || leagueType === "GT LEAGUE");
  const shouldLoadEbattle =
    !basketOnly &&
    (!leagueType ||
      leagueType === "8MIN BATTLE" ||
      leagueType === "6MIN VOLTA");
  const shouldLoadH2h = !basketOnly && (!leagueType || leagueType === "H2H");

  let gtMatches;
  let ebattleMatches;
  let h2hMatches;

  try {
    const h2hMatchesPromise = !shouldLoadH2h
      ? Promise.resolve([])
      : h2hDataSource === "ebasket"
        ? Promise.resolve([])
        : prisma.h2h_futurematches.findMany({
            where: { match_kickoff: { gte: now } },
            select: {
              id_fixture: true,
              match_kickoff: true,
              home_player: true,
              away_player: true,
            },
            orderBy: { match_kickoff: "asc" },
            take: maxLimit,
          });

    [gtMatches, ebattleMatches, h2hMatches] = await Promise.all([
      shouldLoadGt
        ? prisma.gt_gtapi_futurematches.findMany({
            where: { match_kickoff: { gte: now } },
            select: {
              id_fixture: true,
              id_season: true,
              match_kickoff: true,
              home_player: true,
              away_player: true,
              group_name: true,
            },
            orderBy: { match_kickoff: "asc" },
            take: maxLimit,
          })
        : Promise.resolve([]),
      shouldLoadEbattle
        ? prisma.ebattle_ebattleapi_futurematches.findMany({
            where: { match_kickoff: { gte: now } },
            select: {
              id_fixture: true,
              id_season: true,
              season_name: true,
              match_kickoff: true,
              home_player: true,
              away_player: true,
            },
            orderBy: { match_kickoff: "asc" },
            take: maxLimit,
          })
        : Promise.resolve([]),
      shouldLoadH2h ? h2hMatchesPromise : Promise.resolve([]),
    ]);
  } catch (error) {
    if (cachedFixtures) {
      const filteredFixtures = leagueType
        ? cachedFixtures.filter((fixture) => fixture.leagueType === leagueType)
        : cachedFixtures;
      return filteredFixtures.slice(0, cappedLimit);
    }

    throw error;
  }

  const fixtures = [
    ...gtMatches.map((match) => ({
      id: `GT-${match.id_fixture}`,
      leagueType: "GT LEAGUE" as const,
      seasonId: Number(match.id_season ?? 0) || null,
      playedAt: match.match_kickoff,
      homePlayer: normalizeName(match.home_player),
      awayPlayer: normalizeName(match.away_player),
      groupLabel: match.group_name ?? null,
    })),
    ...ebattleMatches
      .filter((match) => !isVoltaSeasonName(match.season_name))
      .map((match) => ({
        id: `EBATTLE-${match.id_fixture}`,
        leagueType: "8MIN BATTLE" as const,
        seasonId: Number(match.id_season ?? 0) || null,
        playedAt: match.match_kickoff,
        homePlayer: normalizeName(match.home_player),
        awayPlayer: normalizeName(match.away_player),
        groupLabel: null,
      })),
    ...h2hMatches.map((match) => ({
      id: `H2H-${match.id_fixture}`,
      leagueType: "H2H" as const,
      seasonId: null,
      playedAt: match.match_kickoff,
      homePlayer: normalizeName(match.home_player),
      awayPlayer: normalizeName(match.away_player),
      groupLabel: null,
    })),
    ...ebattleMatches
      .filter((match) => isVoltaSeasonName(match.season_name))
      .map((match) => ({
        id: `VOLTA-${match.id_fixture}`,
        leagueType: "6MIN VOLTA" as const,
        seasonId: Number(match.id_season ?? 0) || null,
        playedAt: match.match_kickoff,
        homePlayer: normalizeName(match.home_player),
        awayPlayer: normalizeName(match.away_player),
        groupLabel: null,
      })),
  ].sort((left, right) => left.playedAt.getTime() - right.playedAt.getTime());

  if (!leagueType) {
    dashboardUpcomingFixturesCache.data = fixtures;
    dashboardUpcomingFixturesCache.expiresAt =
      Date.now() + DASHBOARD_UPCOMING_FIXTURES_CACHE_TTL_MS;
  }

  const filteredFixtures = leagueType
    ? fixtures.filter((fixture) => fixture.leagueType === leagueType)
    : fixtures;
  return filteredFixtures.slice(0, cappedLimit);
}

export async function getDisparityPlayersLive(
  leagueType: DisparityLeagueType,
  query?: string,
) {
  const queryKey = query ? normalizeKey(query) : null;
  const cacheKey = `${leagueType}:${queryKey ?? "all"}`;

  if (
    disparityPlayersCache.data &&
    disparityPlayersCache.expiresAt > Date.now()
  ) {
    const cachedValue = disparityPlayersCache.data[cacheKey];
    if (cachedValue) {
      return cachedValue;
    }
  }

  if (leagueType === "6MIN VOLTA") {
    const result = await loadDisparityVoltaPlayersSummary(query);

    disparityPlayersCache.data = {
      ...(disparityPlayersCache.data ?? {}),
      [cacheKey]: result,
    };
    disparityPlayersCache.expiresAt =
      Date.now() + DISPARITY_PLAYERS_CACHE_TTL_MS;

    return result;
  }

  const matches = filterMatchesByLeague(await loadUnifiedMatches(), leagueType);
  const activeWindowDays = leagueType === "H2H" ? 90 : 30;
  const activeThreshold = Date.now() - activeWindowDays * 24 * 60 * 60 * 1000;
  const activePlayerKeys = new Set(
    matches
      .filter((match) => match.playedAt.getTime() >= activeThreshold)
      .flatMap((match) => [
        normalizeKey(match.homePlayer),
        normalizeKey(match.awayPlayer),
      ]),
  );
  const minimumRecentPlayers =
    leagueType === "H2H" && h2hDataSource === "ebasket" ? 10 : 1;
  const useActiveWindow = activePlayerKeys.size >= minimumRecentPlayers;

  const result = buildDisparityPlayerSummaries(matches)
    .filter((player) =>
      useActiveWindow ? activePlayerKeys.has(normalizeKey(player.name)) : true,
    )
    .filter((player) =>
      queryKey ? normalizeKey(player.name).includes(queryKey) : true,
    )
    .sort(
      (left, right) =>
        right.totalGames - left.totalGames || right.winRate - left.winRate,
    )
    .slice(0, 120)
    .map((player) => ({
      id: `${player.name}disp`,
      name: player.name,
      totalGames: player.totalGames,
      wins: player.wins,
      draws: player.draws,
      losses: player.losses,
      winRate: player.winRate,
    }));

  disparityPlayersCache.data = {
    ...(disparityPlayersCache.data ?? {}),
    [cacheKey]: result,
  };
  disparityPlayersCache.expiresAt = Date.now() + DISPARITY_PLAYERS_CACHE_TTL_MS;

  return result;
}

export async function getDisparityPlayerOptionsLive(
  leagueType: DisparityLeagueType,
  query?: string,
): Promise<Array<{ id: string; name: string }>> {
  const queryKey = query ? normalizeKey(query) : null;

  if (leagueType === "GT LEAGUE") {
    const since = getRecentDaysStart(45);

    try {
      const matches = await prisma.gt_gtapi_fixtures.findMany({
        where: {
          match_kickoff: {
            gte: since,
          },
        },
        select: {
          home_player: true,
          away_player: true,
        },
      });

      const names = new Set<string>();

      for (const match of matches) {
        if (match.home_player) {
          names.add(normalizeName(match.home_player));
        }

        if (match.away_player) {
          names.add(normalizeName(match.away_player));
        }
      }

      const result = Array.from(names)
        .filter((name) =>
          queryKey ? normalizeKey(name).includes(queryKey) : true,
        )
        .sort((left, right) =>
          left.localeCompare(right, "pt-BR", { sensitivity: "base" }),
        )
        .map((name) => ({
          id: buildPlayerId(name),
          name,
        }));

      if (!queryKey) {
        try {
          await persistGtDisparityOptionsSnapshot(result);
        } catch {
          // Snapshot persistence is best-effort.
        }
      }

      return result;
    } catch {
      const fallbackMatches = filterMatchesByLeague(
        await loadUnifiedMatches({ since, leagueType }),
        leagueType,
      );
      const fallbackNames = new Set<string>();

      for (const match of fallbackMatches) {
        fallbackNames.add(normalizeName(match.homePlayer));
        fallbackNames.add(normalizeName(match.awayPlayer));
      }

      const result = Array.from(fallbackNames)
        .filter((name) =>
          queryKey ? normalizeKey(name).includes(queryKey) : true,
        )
        .sort((left, right) =>
          left.localeCompare(right, "pt-BR", { sensitivity: "base" }),
        )
        .map((name) => ({
          id: buildPlayerId(name),
          name,
        }));

      if (!queryKey) {
        try {
          await persistGtDisparityOptionsSnapshot(result);
        } catch {
          // Snapshot persistence is best-effort.
        }
      }

      return result;
    }
  }

  const players = await getDisparityPlayersLive(leagueType, query);
  return players.map((player) => ({
    id: player.id,
    name: player.name,
  }));
}

export async function getDisparityPairLive(
  leagueType: DisparityLeagueType,
  playerOneNameOrId: string,
  playerTwoNameOrId: string,
): Promise<Record<string, unknown> | null> {
  const playerOneName = resolveDisparityPlayerName(playerOneNameOrId);
  const playerTwoName = resolveDisparityPlayerName(playerTwoNameOrId);
  const playerOneKey = normalizeKey(playerOneName);
  const playerTwoKey = normalizeKey(playerTwoName);

  if (!playerOneKey || !playerTwoKey || playerOneKey === playerTwoKey) {
    return null;
  }

  const cacheKey = `${leagueType}:pair:${playerOneKey}:${playerTwoKey}`;

  if (
    disparityDetailCache.data &&
    disparityDetailCache.expiresAt > Date.now()
  ) {
    const cachedValue = disparityDetailCache.data[cacheKey];
    if (cachedValue !== undefined) {
      return cachedValue as ReturnType<
        typeof getDisparityPairLive
      > extends Promise<infer T>
        ? T
        : never;
    }
  }

  const matches = await loadUnifiedMatches({
    since: getRecentDaysStart(DISPARITY_PAIR_LOOKBACK_DAYS),
    leagueType,
  });
  const pairMatches = matches
    .filter((match) => {
      const homeKey = normalizeKey(match.homePlayer);
      const awayKey = normalizeKey(match.awayPlayer);

      return (
        (homeKey === playerOneKey && awayKey === playerTwoKey) ||
        (homeKey === playerTwoKey && awayKey === playerOneKey)
      );
    })
    .sort((left, right) => left.playedAt.getTime() - right.playedAt.getTime());

  const groupedMatches = new Map<string, UnifiedMatch[]>();

  for (const match of pairMatches) {
    const groupKey = getDisparityOperationalDayKey(match);
    const current = groupedMatches.get(groupKey) ?? [];
    current.push(match);
    groupedMatches.set(groupKey, current);
  }

  const rows = Array.from(groupedMatches.entries())
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
      const dateLabel = formatOperationalDayKey(dayKey);

      const history = sortedMatches.map((match) => {
        const playerOneIsHome = normalizeKey(match.homePlayer) === playerOneKey;
        const playerOneGoals = playerOneIsHome
          ? match.homeScore
          : match.awayScore;
        const playerTwoGoals = playerOneIsHome
          ? match.awayScore
          : match.homeScore;
        const resultCode =
          playerOneGoals > playerTwoGoals
            ? "1"
            : playerOneGoals < playerTwoGoals
              ? "2"
              : "E";

        return {
          matchId: match.id,
          playedAt: match.playedAt.toISOString(),
          localTimeLabel: formatDisparityOperationalTime(match.playedAt),
          playerOneGoals,
          playerTwoGoals,
          resultCode,
          scoreLabel: `${playerOneGoals}-${playerTwoGoals}`,
          fixtureLabel: `${match.homePlayer} x ${match.awayPlayer}`,
          playerOneIsHome,
        };
      });

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
        displayLabel: dateLabel,
        dateLabel,
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

  const result = {
    generatedAt: new Date().toISOString(),
    leagueType,
    players: {
      playerOne: playerOneName,
      playerTwo: playerTwoName,
    },
    totalRows: rows.length,
    totalMatches: pairMatches.length,
    rows,
  };

  disparityDetailCache.data = {
    ...(disparityDetailCache.data ?? {}),
    [cacheKey]: result,
  };
  disparityDetailCache.expiresAt = Date.now() + DISPARITY_DETAIL_CACHE_TTL_MS;

  return result;
}

export async function getGtPanoramaLive(
  requestedDayKey?: string,
): Promise<Record<string, unknown>> {
  const leagueType = "GT LEAGUE" as const;
  const currentDayKey =
    requestedDayKey ??
    getDisparityOperationalWindow(new Date(), leagueType).dayKey;
  const cacheKey = `${leagueType}:panorama:${currentDayKey}`;

  log.debug(
    { dayKey: currentDayKey, requested: requestedDayKey ?? "(auto)", cacheKey },
    "panorama-live",
  );

  if (
    disparityDetailCache.data &&
    disparityDetailCache.expiresAt > Date.now()
  ) {
    const cachedValue = disparityDetailCache.data[cacheKey];
    if (cachedValue !== undefined) {
      return cachedValue as ReturnType<
        typeof getGtPanoramaLive
      > extends Promise<infer T>
        ? T
        : never;
    }
  }

  const isHistorical = Boolean(requestedDayKey);

  // Para dias históricos, tentar ler do snapshot salvo em disco.
  if (isHistorical) {
    try {
      const snapshotPath = getGtPanoramaDaySnapshotPath(currentDayKey);
      const raw = await readFile(snapshotPath, "utf8");
      const snapshot = JSON.parse(raw) as Record<string, unknown>;

      // Validar que o snapshot contém seasonStandings (formato atual).
      const groups = Array.isArray(snapshot.seriesGroups)
        ? (snapshot.seriesGroups as Array<Record<string, unknown>>)
        : [];
      const hasStandings = groups.some((g) => Array.isArray(g.seasonStandings));

      if (hasStandings) {
        log.debug(
          { dayKey: currentDayKey },
          "panorama-live lido do snapshot em disco",
        );

        // Colocar no cache de memória também.
        disparityDetailCache.data = {
          ...(disparityDetailCache.data ?? {}),
          [cacheKey]: snapshot,
        };
        disparityDetailCache.expiresAt =
          Date.now() + DISPARITY_DETAIL_CACHE_TTL_MS;

        return snapshot;
      }

      log.debug(
        { dayKey: currentDayKey },
        "panorama-live snapshot em disco desatualizado (sem seasonStandings), regenerando",
      );
    } catch {
      // Snapshot não existe ainda, gerar do banco.
    }
  }

  // For historical days, scope the query to just ±1 day around the requested
  // dayKey instead of loading 14 days of data. This dramatically reduces memory
  // since we filter to a single day anyway.
  let since: Date;
  let until: Date | undefined;
  if (isHistorical && requestedDayKey) {
    const [y, m, d] = requestedDayKey.split("-").map(Number);
    since = new Date(y, m - 1, d - 1, 0, 0, 0);
    until = new Date(y, m - 1, d + 1, 23, 59, 59, 999);
  } else {
    since = getRecentDaysStart(3);
  }
  log.debug(
    { isHistorical, since: since.toISOString(), until: until?.toISOString() },
    "panorama-live query range",
  );
  let matches: UnifiedMatch[] = [];

  try {
    const gtMatches = await prisma.gt_gtapi_fixtures.findMany({
      where: {
        match_kickoff: {
          gte: since,
          ...(until ? { lte: until } : {}),
        },
        home_score_ft: {
          not: null,
        },
        away_score_ft: {
          not: null,
        },
      },
      select: {
        id_fixture: true,
        id_season: true,
        match_kickoff: true,
        grupo: true,
        home_player: true,
        away_player: true,
        home_team: true,
        away_team: true,
        home_score_ht: true,
        away_score_ht: true,
        home_score_ft: true,
        away_score_ft: true,
      },
      orderBy: {
        match_kickoff: "asc",
      },
    });

    matches = gtMatches.map((match) => ({
      id: `GT-${match.id_fixture}`,
      leagueType,
      leagueGroup: normalizeLeagueGroup("GT LEAGUE", match.grupo),
      seasonId: Number(match.id_season ?? 0) || null,
      playedAt: match.match_kickoff,
      homePlayer: normalizeName(match.home_player || match.home_team),
      awayPlayer: normalizeName(
        match.away_player || match.away_team || "Visitante",
      ),
      homeScoreHt:
        match.home_score_ht === null ? null : Number(match.home_score_ht),
      awayScoreHt:
        match.away_score_ht === null ? null : Number(match.away_score_ht),
      homeScore: Number(match.home_score_ft ?? 0),
      awayScore: Number(match.away_score_ft ?? 0),
    }));
    log.debug(
      { fixtures: gtMatches.length, since: since.toISOString() },
      "panorama-live prisma ok",
    );
  } catch (err) {
    log.debug(
      { reason: (err as Error).message },
      "panorama-live prisma falhou, usando fallback",
    );
    matches = filterMatchesByLeague(
      await loadUnifiedMatches({
        since,
        leagueType,
      }),
      leagueType,
    );
  }

  const beforeFilter = matches.length;
  matches = matches
    .filter(
      (match) =>
        getDisparityOperationalDayKey(match) === currentDayKey &&
        (isHistorical || match.playedAt.getTime() <= Date.now()),
    )
    .sort((left, right) => left.playedAt.getTime() - right.playedAt.getTime());
  log.debug(
    { dayKey: currentDayKey, totalDb: beforeFilter, filtered: matches.length },
    "panorama-live filtered",
  );

  const seriesCodes = ["A", "B", "C", "D", "E", "F", "G"] as const;

  const seriesGroups = seriesCodes.map((series) => {
    const seriesMatches = matches.filter(
      (match) => getGtSeriesCode(match.leagueGroup) === series,
    );
    const pairRowsByKey = new Map<
      string,
      {
        confrontationKey: string;
        confrontationLabel: string;
        playerOneName: string;
        playerTwoName: string;
        wins: number;
        draws: number;
        losses: number;
        totalGames: number;
        history: Array<{
          matchId: string;
          playedAtIso: string;
          localTimeLabel: string;
          playerOneGoals: number;
          playerTwoGoals: number;
          result: "W" | "D" | "L";
          scoreLabel: string;
        }>;
      }
    >();
    const playerRowsByKey = new Map<
      string,
      {
        playerName: string;
        wins: number;
        draws: number;
        losses: number;
        totalGames: number;
        apx: number;
        sequence: Array<{
          matchId: string;
          playedAtIso: string;
          localTimeLabel: string;
          opponentName: string;
          result: "W" | "D" | "L";
          fullTimeScore: string;
        }>;
      }
    >();

    for (const match of seriesMatches) {
      const [playerOneName, playerTwoName] = buildConfrontationPlayers(
        match.homePlayer,
        match.awayPlayer,
      );
      const confrontationKey = buildOrderedConfrontationKey(
        playerOneName,
        playerTwoName,
      );
      const playerOneIsHome =
        normalizeKey(match.homePlayer) === normalizeKey(playerOneName);
      const playerOneGoals = playerOneIsHome
        ? match.homeScore
        : match.awayScore;
      const playerTwoGoals = playerOneIsHome
        ? match.awayScore
        : match.homeScore;
      const pairResult =
        playerOneGoals > playerTwoGoals
          ? "W"
          : playerOneGoals < playerTwoGoals
            ? "L"
            : "D";
      const pairRow = pairRowsByKey.get(confrontationKey) ?? {
        confrontationKey,
        confrontationLabel: `${playerOneName} x ${playerTwoName}`,
        playerOneName,
        playerTwoName,
        wins: 0,
        draws: 0,
        losses: 0,
        totalGames: 0,
        history: [],
      };

      pairRow.totalGames += 1;
      pairRow.wins += pairResult === "W" ? 1 : 0;
      pairRow.draws += pairResult === "D" ? 1 : 0;
      pairRow.losses += pairResult === "L" ? 1 : 0;
      pairRow.history.push({
        matchId: match.id,
        playedAtIso: match.playedAt.toISOString(),
        localTimeLabel: formatDisparityOperationalTime(match.playedAt),
        playerOneGoals,
        playerTwoGoals,
        result: pairResult,
        scoreLabel: `${playerOneGoals}-${playerTwoGoals}`,
      });
      pairRowsByKey.set(confrontationKey, pairRow);

      for (const playerName of [match.homePlayer, match.awayPlayer]) {
        const detail = buildDisparityMatchDetail(match, playerName);
        const playerResult = detail.result;
        const playerKey = normalizeKey(playerName);
        const playerRow = playerRowsByKey.get(playerKey) ?? {
          playerName,
          wins: 0,
          draws: 0,
          losses: 0,
          totalGames: 0,
          apx: 0,
          sequence: [],
        };

        playerRow.totalGames += 1;
        playerRow.wins += playerResult === "W" ? 1 : 0;
        playerRow.draws += playerResult === "D" ? 1 : 0;
        playerRow.losses += playerResult === "L" ? 1 : 0;
        playerRow.sequence.push({
          matchId: match.id,
          playedAtIso: match.playedAt.toISOString(),
          localTimeLabel: detail.localTimeLabel,
          opponentName: detail.opponent,
          result: playerResult,
          fullTimeScore: detail.fullTimeScore,
        });
        playerRowsByKey.set(playerKey, playerRow);
      }
    }

    const pairRows = Array.from(pairRowsByKey.values()).sort(
      (left, right) =>
        right.totalGames - left.totalGames ||
        right.wins - left.wins ||
        right.draws - left.draws ||
        left.confrontationLabel.localeCompare(
          right.confrontationLabel,
          "pt-BR",
          { sensitivity: "base" },
        ),
    );
    const playerRows = Array.from(playerRowsByKey.values())
      .map((row) => ({
        ...row,
        apx: row.totalGames ? round((row.wins / row.totalGames) * 100) : 0,
      }))
      .sort(
        (left, right) =>
          right.totalGames - left.totalGames ||
          right.apx - left.apx ||
          right.wins - left.wins ||
          left.playerName.localeCompare(right.playerName, "pt-BR", {
            sensitivity: "base",
          }),
      );

    // --- Season standings (classificação por campeonato) ---
    const matchesBySeason = new Map<number, UnifiedMatch[]>();
    for (const match of seriesMatches) {
      if (!match.seasonId) continue;
      const arr = matchesBySeason.get(match.seasonId) ?? [];
      arr.push(match);
      matchesBySeason.set(match.seasonId, arr);
    }

    const seasonStandings = Array.from(matchesBySeason.entries())
      .sort(([idA, matchesA], [idB, matchesB]) => {
        const tA = matchesA[0]?.playedAt.getTime() ?? 0;
        const tB = matchesB[0]?.playedAt.getTime() ?? 0;
        return tA - tB || idA - idB;
      })
      .map(([seasonId, seasonMatches], index) => {
        const firstKickoff = seasonMatches[0]?.playedAt;
        const windowInfo = firstKickoff
          ? getGtDashboardOperationalWindow(firstKickoff)
          : null;
        const windowLabel = windowInfo?.windowLabel ?? `J${index + 1}`;
        const seasonLabel = `Campeonato ${index + 1}`;

        const playerMap = new Map<
          string,
          {
            playerName: string;
            gp: number;
            wins: number;
            draws: number;
            losses: number;
            gf: number;
            ga: number;
          }
        >();

        for (const match of seasonMatches) {
          for (const side of ["home", "away"] as const) {
            const playerName =
              side === "home" ? match.homePlayer : match.awayPlayer;
            const gf = side === "home" ? match.homeScore : match.awayScore;
            const ga = side === "home" ? match.awayScore : match.homeScore;
            const key = normalizeKey(playerName);
            const row = playerMap.get(key) ?? {
              playerName,
              gp: 0,
              wins: 0,
              draws: 0,
              losses: 0,
              gf: 0,
              ga: 0,
            };
            row.gp += 1;
            row.gf += gf;
            row.ga += ga;
            if (gf > ga) row.wins += 1;
            else if (gf < ga) row.losses += 1;
            else row.draws += 1;
            playerMap.set(key, row);
          }
        }

        const players = Array.from(playerMap.values())
          .map((p) => ({
            ...p,
            pts: p.wins * 3 + p.draws,
            gd: p.gf - p.ga,
            winPct: p.gp ? round((p.wins / p.gp) * 100) : 0,
            drawPct: p.gp ? round((p.draws / p.gp) * 100) : 0,
            lossPct: p.gp ? round((p.losses / p.gp) * 100) : 0,
          }))
          .sort(
            (a, b) =>
              b.pts - a.pts ||
              b.gd - a.gd ||
              b.gf - a.gf ||
              a.playerName.localeCompare(b.playerName, "pt-BR", {
                sensitivity: "base",
              }),
          );

        return {
          seasonId,
          seasonLabel,
          windowLabel,
          players,
        };
      });

    return {
      series,
      pairRows,
      playerRows,
      seasonStandings,
    };
  });

  const result = {
    generatedAt: new Date().toISOString(),
    leagueType,
    dayKey: currentDayKey,
    dayLabel: formatOperationalDayKey(currentDayKey),
    totalMatches: matches.length,
    seriesGroups,
  };

  disparityDetailCache.data = {
    ...(disparityDetailCache.data ?? {}),
    [cacheKey]: result,
  };
  disparityDetailCache.expiresAt = Date.now() + DISPARITY_DETAIL_CACHE_TTL_MS;

  try {
    await persistGtPanoramaSnapshot(result);
  } catch {
    // Snapshot persistence is best-effort.
  }

  return result;
}

export async function getGtRaioXLive(): Promise<Record<string, unknown>> {
  const leagueType = "GT LEAGUE" as const;
  const cacheKey = `${leagueType}:xray:${GT_XRAY_LOOKBACK_DAYS}:${GT_XRAY_REQUIRED_DAY_COUNT}:${GT_XRAY_SCAN_MIN_HIT_RATE}:${GT_XRAY_MIN_HIT_RATE}`;

  if (
    disparityDetailCache.data &&
    disparityDetailCache.expiresAt > Date.now()
  ) {
    const cachedValue = disparityDetailCache.data[cacheKey];
    if (cachedValue !== undefined) {
      return cachedValue as ReturnType<typeof getGtRaioXLive> extends Promise<
        infer T
      >
        ? T
        : never;
    }
  }

  const since = getRecentDaysStart(GT_XRAY_LOOKBACK_DAYS);
  let matches: UnifiedMatch[] = [];

  try {
    const gtMatches = await prisma.gt_gtapi_fixtures.findMany({
      where: {
        match_kickoff: {
          gte: since,
        },
        home_score_ft: {
          not: null,
        },
        away_score_ft: {
          not: null,
        },
      },
      select: {
        id_fixture: true,
        id_season: true,
        match_kickoff: true,
        grupo: true,
        home_player: true,
        away_player: true,
        home_team: true,
        away_team: true,
        home_score_ht: true,
        away_score_ht: true,
        home_score_ft: true,
        away_score_ft: true,
      },
      orderBy: {
        match_kickoff: "asc",
      },
    });

    matches = gtMatches.map((match) => ({
      id: `GT-${match.id_fixture}`,
      leagueType,
      leagueGroup: normalizeLeagueGroup("GT LEAGUE", match.grupo),
      seasonId: Number(match.id_season ?? 0) || null,
      playedAt: match.match_kickoff,
      homePlayer: normalizeName(match.home_player || match.home_team),
      awayPlayer: normalizeName(
        match.away_player || match.away_team || "Visitante",
      ),
      homeScoreHt:
        match.home_score_ht === null ? null : Number(match.home_score_ht),
      awayScoreHt:
        match.away_score_ht === null ? null : Number(match.away_score_ht),
      homeScore: Number(match.home_score_ft ?? 0),
      awayScore: Number(match.away_score_ft ?? 0),
    }));
  } catch {
    matches = filterMatchesByLeague(
      await loadUnifiedMatches({
        since,
        leagueType,
      }),
      leagueType,
    );
  }

  const pairMap = new Map<
    string,
    {
      confrontationKey: string;
      confrontationLabel: string;
      playerOneName: string;
      playerTwoName: string;
      days: Map<
        string,
        {
          dayKey: string;
          dayLabel: string;
          playedAtIso: string;
          series: string | null;
          playerOneWins: number;
          draws: number;
          playerTwoWins: number;
          totalGames: number;
          history: Array<{
            matchId: string;
            playedAtIso: string;
            localTimeLabel: string;
            playerOneGoals: number;
            playerTwoGoals: number;
            resultCode: "1" | "2" | "E";
            scoreLabel: string;
          }>;
        }
      >;
    }
  >();

  for (const match of matches) {
    const [playerOneName, playerTwoName] = buildConfrontationPlayers(
      match.homePlayer,
      match.awayPlayer,
    );
    const confrontationKey = buildOrderedConfrontationKey(
      playerOneName,
      playerTwoName,
    );
    const dayKey = getDisparityOperationalDayKey(match);
    const playerOneIsHome =
      normalizeKey(match.homePlayer) === normalizeKey(playerOneName);
    const playerOneGoals = playerOneIsHome ? match.homeScore : match.awayScore;
    const playerTwoGoals = playerOneIsHome ? match.awayScore : match.homeScore;
    const resultCode =
      playerOneGoals > playerTwoGoals
        ? ("1" as const)
        : playerOneGoals < playerTwoGoals
          ? ("2" as const)
          : ("E" as const);

    const pairEntry = pairMap.get(confrontationKey) ?? {
      confrontationKey,
      confrontationLabel: `${playerOneName} x ${playerTwoName}`,
      playerOneName,
      playerTwoName,
      days: new Map(),
    };
    const currentDay = pairEntry.days.get(dayKey) ?? {
      dayKey,
      dayLabel: formatOperationalDayKey(dayKey),
      playedAtIso: match.playedAt.toISOString(),
      series: getGtSeriesCode(match.leagueGroup),
      playerOneWins: 0,
      draws: 0,
      playerTwoWins: 0,
      totalGames: 0,
      history: [],
    };

    currentDay.playedAtIso = match.playedAt.toISOString();
    currentDay.series = currentDay.series ?? getGtSeriesCode(match.leagueGroup);
    currentDay.totalGames += 1;
    currentDay.playerOneWins += resultCode === "1" ? 1 : 0;
    currentDay.draws += resultCode === "E" ? 1 : 0;
    currentDay.playerTwoWins += resultCode === "2" ? 1 : 0;
    currentDay.history.push({
      matchId: match.id,
      playedAtIso: match.playedAt.toISOString(),
      localTimeLabel: formatDisparityOperationalTime(match.playedAt),
      playerOneGoals,
      playerTwoGoals,
      resultCode,
      scoreLabel: `${playerOneGoals}-${playerTwoGoals}`,
    });

    pairEntry.days.set(dayKey, currentDay);
    pairMap.set(confrontationKey, pairEntry);
  }

  let totalPairsEvaluated = 0;
  const rows = Array.from(pairMap.values())
    .map((pairEntry) => {
      const recentDays = Array.from(pairEntry.days.values())
        .map((day) => ({
          ...day,
          history: [...day.history].sort((left, right) =>
            left.playedAtIso.localeCompare(right.playedAtIso),
          ),
        }))
        .sort((left, right) => right.dayKey.localeCompare(left.dayKey))
        .slice(0, GT_XRAY_REQUIRED_DAY_COUNT);

      if (recentDays.length < GT_XRAY_REQUIRED_DAY_COUNT) {
        return null;
      }

      totalPairsEvaluated += 1;

      const qualifyingDays = recentDays.filter(
        (day) =>
          (day.playerOneWins === 2 || day.playerOneWins === 3) &&
          (day.playerTwoWins === 2 || day.playerTwoWins === 3),
      ).length;
      const hitRate = round(
        (qualifyingDays / GT_XRAY_REQUIRED_DAY_COUNT) * 100,
      );

      if (hitRate < GT_XRAY_SCAN_MIN_HIT_RATE) {
        return null;
      }

      const seriesFrequency = recentDays.reduce((map, day) => {
        const key = day.series ?? "-";
        map.set(key, (map.get(key) ?? 0) + 1);
        return map;
      }, new Map<string, number>());
      const dominantSeriesEntry = Array.from(seriesFrequency.entries()).sort(
        (left, right) =>
          right[1] - left[1] ||
          left[0].localeCompare(right[0], "pt-BR", { sensitivity: "base" }),
      )[0];
      const dominantSeries =
        dominantSeriesEntry?.[0] && dominantSeriesEntry[0] !== "-"
          ? dominantSeriesEntry[0]
          : (recentDays[0]?.series ?? null);

      return {
        confrontationKey: pairEntry.confrontationKey,
        confrontationLabel: pairEntry.confrontationLabel,
        playerOneName: pairEntry.playerOneName,
        playerTwoName: pairEntry.playerTwoName,
        series: dominantSeries,
        qualifyingDays,
        sampleDays: GT_XRAY_REQUIRED_DAY_COUNT,
        hitRate,
        recentDays,
      };
    })
    .filter((row): row is NonNullable<typeof row> => Boolean(row))
    .sort(
      (left, right) =>
        right.hitRate - left.hitRate ||
        right.qualifyingDays - left.qualifyingDays ||
        (left.series ?? "Z").localeCompare(right.series ?? "Z", "pt-BR", {
          sensitivity: "base",
        }) ||
        left.confrontationLabel.localeCompare(
          right.confrontationLabel,
          "pt-BR",
          { sensitivity: "base" },
        ),
    );

  const seriesSummary = (["A", "B", "C", "D", "E", "F", "G"] as const).map(
    (series) => ({
      series,
      pairs: rows.filter((row) => row.series === series).length,
    }),
  );

  const totalEligiblePairs = rows.filter(
    (row) => row.hitRate >= GT_XRAY_MIN_HIT_RATE,
  ).length;

  const result = {
    generatedAt: new Date().toISOString(),
    leagueType,
    lookbackDays: GT_XRAY_LOOKBACK_DAYS,
    requiredDays: GT_XRAY_REQUIRED_DAY_COUNT,
    scanMinHitRate: GT_XRAY_SCAN_MIN_HIT_RATE,
    minHitRate: GT_XRAY_MIN_HIT_RATE,
    totalPairsSeen: pairMap.size,
    totalPairsEvaluated,
    totalMappedPairs: rows.length,
    totalEligiblePairs,
    seriesSummary,
    rows,
  };

  disparityDetailCache.data = {
    ...(disparityDetailCache.data ?? {}),
    [cacheKey]: result,
  };
  disparityDetailCache.expiresAt = Date.now() + DISPARITY_DETAIL_CACHE_TTL_MS;

  try {
    await persistGtRaioXSnapshot(result);
  } catch {
    // Snapshot persistence is best-effort.
  }

  return result;
}

export async function getGtLeagueLiveTable(options?: {
  historyDays?: number;
}): Promise<Record<string, unknown>> {
  const historyDays = normalizeGtLiveTableHistoryDays(options?.historyDays);
  const cacheKey = String(historyDays);

  const cached = gtLeagueLiveTableCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.data;
  }

  const now = new Date();
  const currentDayKey = getDisparityOperationalWindow(now, "GT LEAGUE").dayKey;
  const historySince = new Date(
    now.getTime() - historyDays * 24 * 60 * 60 * 1000,
  );
  const currentDayCandidatesSince = getRecentDaysStart(
    GT_LIVE_TABLE_DAY_LOOKBACK_DAYS,
  );

  const currentDayCandidateRows = await prisma.gt_gtapi_fixtures.findMany({
    where: {
      match_kickoff: {
        gte: currentDayCandidatesSince,
        lte: now,
      },
      home_score_ft: {
        not: null,
      },
      away_score_ft: {
        not: null,
      },
    },
    select: {
      id_fixture: true,
      id_season: true,
      match_kickoff: true,
      grupo: true,
      home_player: true,
      away_player: true,
      home_team: true,
      away_team: true,
      home_score_ht: true,
      away_score_ht: true,
      home_score_ft: true,
      away_score_ft: true,
    },
    orderBy: {
      match_kickoff: "asc",
    },
  });

  const currentDayCandidateMatches = currentDayCandidateRows.map((match) => ({
    id: `GT-${match.id_fixture}`,
    leagueType: "GT LEAGUE" as const,
    leagueGroup: normalizeLeagueGroup("GT LEAGUE", match.grupo),
    seasonId: Number(match.id_season ?? 0) || null,
    playedAt: match.match_kickoff,
    homePlayer: normalizeName(match.home_player || match.home_team),
    awayPlayer: normalizeName(
      match.away_player || match.away_team || "Visitante",
    ),
    homeScoreHt:
      match.home_score_ht === null ? null : Number(match.home_score_ht),
    awayScoreHt:
      match.away_score_ht === null ? null : Number(match.away_score_ht),
    homeScore: Number(match.home_score_ft ?? 0),
    awayScore: Number(match.away_score_ft ?? 0),
  }));

  const currentDayFixtures = currentDayCandidateMatches.filter(
    (match) => getDisparityOperationalDayKey(match) === currentDayKey,
  );

  const currentPlayers = Array.from(
    new Set(
      currentDayFixtures.flatMap((match) => [
        match.homePlayer,
        match.awayPlayer,
      ]),
    ),
  );
  const currentPairKeys = new Set(
    currentDayFixtures.map((match) =>
      buildNormalizedPairKey(match.homePlayer, match.awayPlayer),
    ),
  );

  const historyRows =
    currentPlayers.length > 0
      ? await prisma.gt_gtapi_fixtures.findMany({
          where: {
            match_kickoff: {
              gte: historySince,
              lte: now,
            },
            home_score_ft: {
              not: null,
            },
            away_score_ft: {
              not: null,
            },
            home_player: {
              in: currentPlayers,
            },
            away_player: {
              in: currentPlayers,
            },
          },
          select: {
            id_fixture: true,
            id_season: true,
            match_kickoff: true,
            grupo: true,
            home_player: true,
            away_player: true,
            home_team: true,
            away_team: true,
            home_score_ht: true,
            away_score_ht: true,
            home_score_ft: true,
            away_score_ft: true,
          },
          orderBy: {
            match_kickoff: "asc",
          },
        })
      : [];

  const pairHistoryMap = new Map<string, UnifiedMatch[]>();

  for (const match of historyRows) {
    const normalizedMatch = {
      id: `GT-${match.id_fixture}`,
      leagueType: "GT LEAGUE" as const,
      leagueGroup: normalizeLeagueGroup("GT LEAGUE", match.grupo),
      seasonId: Number(match.id_season ?? 0) || null,
      playedAt: match.match_kickoff,
      homePlayer: normalizeName(match.home_player || match.home_team),
      awayPlayer: normalizeName(
        match.away_player || match.away_team || "Visitante",
      ),
      homeScoreHt:
        match.home_score_ht === null ? null : Number(match.home_score_ht),
      awayScoreHt:
        match.away_score_ht === null ? null : Number(match.away_score_ht),
      homeScore: Number(match.home_score_ft ?? 0),
      awayScore: Number(match.away_score_ft ?? 0),
    } satisfies UnifiedMatch;
    const pairKey = buildNormalizedPairKey(
      normalizedMatch.homePlayer,
      normalizedMatch.awayPlayer,
    );

    if (!currentPairKeys.has(pairKey)) {
      continue;
    }

    const existing = pairHistoryMap.get(pairKey) ?? [];
    existing.push(normalizedMatch);
    pairHistoryMap.set(pairKey, existing);
  }

  const rows = currentDayFixtures.map((fixture) => {
    const pairKey = buildNormalizedPairKey(
      fixture.homePlayer,
      fixture.awayPlayer,
    );
    const historyMatches = (pairHistoryMap.get(pairKey) ?? []).filter(
      (match) => match.playedAt.getTime() < fixture.playedAt.getTime(),
    );
    const scorelineCounts = Object.fromEntries(
      GT_LIVE_TABLE_SCORELINES.map((scoreline) => [scoreline, 0]),
    ) as Record<(typeof GT_LIVE_TABLE_SCORELINES)[number], number>;
    const allDayMatches = (pairHistoryMap.get(pairKey) ?? [])
      .filter((match) => getDisparityOperationalDayKey(match) === currentDayKey)
      .slice(-GT_LIVE_TABLE_RECENT_HISTORY_LIMIT);
    const recentDayMatches = allDayMatches;
    const recentHistory = recentDayMatches.map((match) => {
      const detail = buildDisparityMatchDetail(match, fixture.homePlayer);
      const [goalsForRaw = "", goalsAgainstRaw = ""] =
        detail.fullTimeScore.split("-");
      const goalsFor = Number(goalsForRaw);
      const goalsAgainst = Number(goalsAgainstRaw);
      return {
        value: detail.result === "W" ? "1" : detail.result === "L" ? "2" : "E",
        result: detail.result as "W" | "D" | "L",
        playerGoals: goalsFor,
        opponentGoals: goalsAgainst,
        localTimeLabel: detail.localTimeLabel,
        scoreLabel: `${goalsFor}-${goalsAgainst}`,
        confrontationLabel: `${fixture.homePlayer} x ${fixture.awayPlayer}`,
      };
    });
    const recentBttsHistory = recentDayMatches.map((match) => {
      const detail = buildDisparityMatchDetail(match, fixture.homePlayer);
      const [goalsForRaw = "", goalsAgainstRaw = ""] =
        detail.fullTimeScore.split("-");
      const goalsFor = Number(goalsForRaw);
      const goalsAgainst = Number(goalsAgainstRaw);
      return {
        value: goalsFor > 0 && goalsAgainst > 0 ? "S" : "N",
        localTimeLabel: detail.localTimeLabel,
        scoreLabel: `${goalsFor}-${goalsAgainst}`,
      };
    });
    const dayBttsMap = new Map<string, number>();
    let playerOneWins = 0;
    let draws = 0;
    let playerTwoWins = 0;
    let over05Count = 0;
    let bttsCount = 0;
    let playerOneScoredCount = 0;
    let playerTwoScoredCount = 0;

    for (const match of historyMatches) {
      const detail = buildDisparityMatchDetail(match, fixture.homePlayer);
      const [goalsForRaw = "", goalsAgainstRaw = ""] =
        detail.fullTimeScore.split("-");
      const goalsFor = Number(goalsForRaw);
      const goalsAgainst = Number(goalsAgainstRaw);
      const exactScore =
        `${goalsFor}-${goalsAgainst}` as keyof typeof scorelineCounts;

      if (exactScore in scorelineCounts) {
        scorelineCounts[exactScore] += 1;
      }

      if (goalsFor + goalsAgainst > 0) {
        over05Count += 1;
      }

      if (goalsFor > 0) {
        playerOneScoredCount += 1;
      }
      if (goalsAgainst > 0) {
        playerTwoScoredCount += 1;
      }

      if (goalsFor > 0 && goalsAgainst > 0) {
        bttsCount += 1;
        const dayKey = getDisparityOperationalDayKey(match);
        dayBttsMap.set(dayKey, (dayBttsMap.get(dayKey) ?? 0) + 1);
      }

      if (detail.result === "W") {
        playerOneWins += 1;
      } else if (detail.result === "L") {
        playerTwoWins += 1;
      } else {
        draws += 1;
      }
    }

    const totalMatches = historyMatches.length;
    const bttsRate = totalMatches ? round((bttsCount / totalMatches) * 100) : 0;
    const avgBttsPerDay = dayBttsMap.size
      ? round(bttsCount / dayBttsMap.size)
      : 0;

    return {
      fixtureId: fixture.id,
      pairKey: buildNormalizedPairKey(fixture.homePlayer, fixture.awayPlayer),
      playedAtIso: fixture.playedAt.toISOString(),
      playedAtLabel: formatDisparityOperationalTime(fixture.playedAt),
      confrontationLabel: `${fixture.homePlayer} x ${fixture.awayPlayer}`,
      playerOneName: fixture.homePlayer,
      playerTwoName: fixture.awayPlayer,
      series: getGtSeriesCode(fixture.leagueGroup),
      scoreLabel: `${fixture.homeScore}-${fixture.awayScore}`,
      totalMatches,
      resultTotals: {
        playerOneWins,
        draws,
        playerTwoWins,
      },
      over05Count,
      over05Rate: totalMatches ? round((over05Count / totalMatches) * 100) : 0,
      bttsCount,
      bttsRate,
      avgBttsPerDay,
      playerOneScoredCount,
      playerOneScoredRate: totalMatches
        ? round((playerOneScoredCount / totalMatches) * 100)
        : 0,
      playerTwoScoredCount,
      playerTwoScoredRate: totalMatches
        ? round((playerTwoScoredCount / totalMatches) * 100)
        : 0,
      recentBttsHistory,
      recentHistory,
      scorelineCounts,
    };
  });

  // --- Upcoming & live (in-flight) fixtures ---
  // 1. From gt_gtapi_fixtures: any match from the past 2h without a result.
  //    Wider than the old 20-min window so games whose scores haven't been
  //    collected yet don't disappear. Combined with the frontend showing
  //    completed games, this covers the full operational day.
  const resolvedFixtureIds = new Set(currentDayFixtures.map((f) => f.id));
  const inFlightSince = new Date(now.getTime() - 2 * 60 * 60 * 1000);
  const inFlightFromFixtures = await prisma.gt_gtapi_fixtures.findMany({
    where: {
      match_kickoff: {
        gte: inFlightSince,
        lte: now,
      },
      OR: [{ home_score_ft: null }, { away_score_ft: null }],
      match_status: { not: 4 },
    },
    select: {
      id_fixture: true,
      id_season: true,
      match_kickoff: true,
      grupo: true,
      home_player: true,
      away_player: true,
      home_team: true,
      away_team: true,
    },
    orderBy: { match_kickoff: "asc" },
  });

  // 2. From gt_gtapi_futurematches: upcoming games that haven't started yet.
  const upcomingFromFutures = await prisma.gt_gtapi_futurematches.findMany({
    where: { match_kickoff: { gte: now } },
    select: {
      id_fixture: true,
      id_season: true,
      match_kickoff: true,
      home_player: true,
      away_player: true,
      group_name: true,
    },
    orderBy: { match_kickoff: "asc" },
    take: 200,
  });

  // 3. From gt_gtapi_futurematches: kickoff passed but might not be in fixtures yet.
  //    24h window to catch any game whose fixture record is delayed.
  const inFlightFromFutures = await prisma.gt_gtapi_futurematches.findMany({
    where: {
      match_kickoff: { gte: inFlightSince, lt: now },
    },
    select: {
      id_fixture: true,
      id_season: true,
      match_kickoff: true,
      home_player: true,
      away_player: true,
      group_name: true,
    },
    orderBy: { match_kickoff: "asc" },
  });

  // Build a set of fixture IDs with match_status=4 (cancelled) to also exclude
  // their corresponding futurematches entries.
  const cancelledFixtureIds = new Set(
    (
      await prisma.gt_gtapi_fixtures.findMany({
        where: {
          match_kickoff: { gte: currentDayCandidatesSince },
          match_status: 4,
        },
        select: { id_fixture: true },
      })
    ).map((f) => f.id_fixture),
  );

  // Build live rows from fixtures without result.
  const liveFixtureIds = new Set<string>();
  const liveRows = inFlightFromFixtures
    .filter((m) => {
      const id = `GT-${m.id_fixture}`;
      if (resolvedFixtureIds.has(id)) return false;
      if (
        getDisparityOperationalDayKey({
          playedAt: m.match_kickoff,
          leagueType: "GT LEAGUE",
        } as UnifiedMatch) !== currentDayKey
      )
        return false;
      liveFixtureIds.add(id);
      return true;
    })
    .map((m) => ({
      fixtureId: `GT-${m.id_fixture}`,
      pairKey: buildNormalizedPairKey(
        normalizeName(m.home_player || m.home_team),
        normalizeName(m.away_player || m.away_team),
      ),
      kickoffIso: m.match_kickoff.toISOString(),
      kickoffLabel: formatDisparityOperationalTime(m.match_kickoff),
      confrontationLabel: `${normalizeName(m.home_player || m.home_team)} x ${normalizeName(m.away_player || m.away_team)}`,
      playerOneName: normalizeName(m.home_player || m.home_team),
      playerTwoName: normalizeName(m.away_player || m.away_team),
      series: normalizeLeagueGroup("GT LEAGUE", m.grupo)
        ? getGtSeriesCode(normalizeLeagueGroup("GT LEAGUE", m.grupo))
        : null,
      status: "live" as const,
    }));

  // Add live rows from futurematches (in-flight) that aren't already in fixtures.
  for (const m of inFlightFromFutures) {
    const fmId = `GT-FM-${m.id_fixture}`;
    const fixtureId = `GT-${m.id_fixture}`;
    if (resolvedFixtureIds.has(fixtureId) || liveFixtureIds.has(fixtureId))
      continue;
    if (cancelledFixtureIds.has(m.id_fixture)) continue;
    liveRows.push({
      fixtureId: fmId,
      pairKey: buildNormalizedPairKey(
        normalizeName(m.home_player),
        normalizeName(m.away_player),
      ),
      kickoffIso: m.match_kickoff.toISOString(),
      kickoffLabel: formatDisparityOperationalTime(m.match_kickoff),
      confrontationLabel: `${normalizeName(m.home_player)} x ${normalizeName(m.away_player)}`,
      playerOneName: normalizeName(m.home_player),
      playerTwoName: normalizeName(m.away_player),
      series: normalizeLeagueGroup("GT LEAGUE", m.group_name)
        ? getGtSeriesCode(normalizeLeagueGroup("GT LEAGUE", m.group_name))
        : null,
      status: "live" as const,
    });
  }

  const upcomingRows = [
    ...liveRows,
    ...upcomingFromFutures
      .filter((m) => !cancelledFixtureIds.has(m.id_fixture))
      .map((m) => ({
        fixtureId: `GT-FM-${m.id_fixture}`,
        pairKey: buildNormalizedPairKey(
          normalizeName(m.home_player),
          normalizeName(m.away_player),
        ),
        kickoffIso: m.match_kickoff.toISOString(),
        kickoffLabel: formatDisparityOperationalTime(m.match_kickoff),
        confrontationLabel: `${normalizeName(m.home_player)} x ${normalizeName(m.away_player)}`,
        playerOneName: normalizeName(m.home_player),
        playerTwoName: normalizeName(m.away_player),
        series: normalizeLeagueGroup("GT LEAGUE", m.group_name)
          ? getGtSeriesCode(normalizeLeagueGroup("GT LEAGUE", m.group_name))
          : null,
        status: "upcoming" as const,
      })),
  ];

  const result = {
    generatedAt: now.toISOString(),
    leagueType: "GT LEAGUE",
    liveWindowMinutes: 0,
    historyDays,
    dayKey: currentDayKey,
    dayLabel: formatOperationalDayKey(currentDayKey),
    scorelines: [...GT_LIVE_TABLE_SCORELINES],
    totalLiveFixtures: rows.length,
    rows,
    upcomingRows,
  };

  gtLeagueLiveTableCache.set(cacheKey, {
    data: result,
    expiresAt: Date.now() + GT_LIVE_TABLE_CACHE_TTL_MS,
  });

  return result;
}

export async function getGtSeriesHealthLive(): Promise<
  Record<string, unknown>
> {
  type ServerNowRow = {
    server_now: Date;
  };

  type SeriesOverviewRow = {
    series_code: string;
    fixture_count: bigint | number;
    resolved_count: bigint | number;
    unresolved_count: bigint | number;
    latest_fixture_kickoff: Date | null;
    earliest_future_kickoff: Date | null;
    latest_future_kickoff: Date | null;
    future_count: bigint | number;
    gap_minutes: number | null;
  };

  type SeriesOverlapRow = {
    series_code: string;
    overlap_future_count: bigint | number;
  };

  const [serverNowRows, overviewRows, overlapRows] = await Promise.all([
    prisma.$queryRawUnsafe<ServerNowRow[]>("SELECT NOW() AS server_now"),
    prisma.$queryRawUnsafe<SeriesOverviewRow[]>(`
      WITH fixture_series AS (
        SELECT
          grupo AS series_code,
          COUNT(*) AS fixture_count,
          SUM(CASE WHEN home_score_ft IS NOT NULL AND away_score_ft IS NOT NULL THEN 1 ELSE 0 END) AS resolved_count,
          SUM(CASE WHEN home_score_ft IS NULL OR away_score_ft IS NULL THEN 1 ELSE 0 END) AS unresolved_count,
          MAX(match_kickoff) AS latest_fixture_kickoff
        FROM gt_gtapi_fixtures
        GROUP BY grupo
      ),
      future_series AS (
        SELECT
          REPLACE(group_name, 'Group ', '') AS series_code,
          COUNT(*) AS future_count,
          MIN(match_kickoff) AS earliest_future_kickoff,
          MAX(match_kickoff) AS latest_future_kickoff
        FROM gt_gtapi_futurematches
        GROUP BY group_name
      ),
      combined AS (
        SELECT
          COALESCE(f.series_code, u.series_code) AS series_code,
          COALESCE(f.fixture_count, 0) AS fixture_count,
          COALESCE(f.resolved_count, 0) AS resolved_count,
          COALESCE(f.unresolved_count, 0) AS unresolved_count,
          f.latest_fixture_kickoff,
          u.earliest_future_kickoff,
          u.latest_future_kickoff,
          COALESCE(u.future_count, 0) AS future_count,
          TIMESTAMPDIFF(MINUTE, f.latest_fixture_kickoff, u.earliest_future_kickoff) AS gap_minutes
        FROM fixture_series f
        LEFT JOIN future_series u ON u.series_code = f.series_code
        UNION
        SELECT
          COALESCE(f.series_code, u.series_code) AS series_code,
          COALESCE(f.fixture_count, 0) AS fixture_count,
          COALESCE(f.resolved_count, 0) AS resolved_count,
          COALESCE(f.unresolved_count, 0) AS unresolved_count,
          f.latest_fixture_kickoff,
          u.earliest_future_kickoff,
          u.latest_future_kickoff,
          COALESCE(u.future_count, 0) AS future_count,
          TIMESTAMPDIFF(MINUTE, f.latest_fixture_kickoff, u.earliest_future_kickoff) AS gap_minutes
        FROM future_series u
        LEFT JOIN fixture_series f ON f.series_code = u.series_code
        WHERE f.series_code IS NULL
      )
      SELECT *
      FROM combined
      ORDER BY series_code
    `),
    prisma.$queryRawUnsafe<SeriesOverlapRow[]>(`
      SELECT
        REPLACE(fm.group_name, 'Group ', '') AS series_code,
        COUNT(*) AS overlap_future_count
      FROM gt_gtapi_futurematches fm
      JOIN (
        SELECT
          grupo AS series_code,
          MAX(match_kickoff) AS latest_fixture_kickoff
        FROM gt_gtapi_fixtures
        GROUP BY grupo
      ) fx
        ON fx.series_code = REPLACE(fm.group_name, 'Group ', '')
      WHERE fm.match_kickoff <= fx.latest_fixture_kickoff
      GROUP BY REPLACE(fm.group_name, 'Group ', '')
      ORDER BY series_code
    `),
  ]);

  const serverNow =
    serverNowRows[0]?.server_now instanceof Date
      ? serverNowRows[0].server_now
      : new Date();

  const overlapBySeries = new Map(
    overlapRows.map((row) => [
      row.series_code,
      Number(row.overlap_future_count ?? 0),
    ]),
  );

  const staleThresholdMs = 36 * 60 * 60 * 1000;

  const rows = overviewRows.map((row) => {
    const latestFixtureKickoff = row.latest_fixture_kickoff
      ? new Date(row.latest_fixture_kickoff)
      : null;
    const earliestFutureKickoff = row.earliest_future_kickoff
      ? new Date(row.earliest_future_kickoff)
      : null;
    const latestFutureKickoff = row.latest_future_kickoff
      ? new Date(row.latest_future_kickoff)
      : null;
    const overlapFutureCount = overlapBySeries.get(row.series_code) ?? 0;
    const minutesSinceLatestFixture = latestFixtureKickoff
      ? Math.round(
          (serverNow.getTime() - latestFixtureKickoff.getTime()) / 60_000,
        )
      : null;
    const minutesUntilEarliestFuture = earliestFutureKickoff
      ? Math.round(
          (earliestFutureKickoff.getTime() - serverNow.getTime()) / 60_000,
        )
      : null;

    let status: "healthy" | "stale" | "inconsistent" = "healthy";
    let statusReason = "Fixtures e futurematches seguem uma trilha coerente.";

    if (overlapFutureCount > 0) {
      status = "inconsistent";
      statusReason = `${overlapFutureCount} futurematch(es) ainda aparecem em horario ja coberto por fixtures resolvidos.`;
    } else if (
      latestFixtureKickoff &&
      serverNow.getTime() - latestFixtureKickoff.getTime() > staleThresholdMs &&
      (!earliestFutureKickoff ||
        earliestFutureKickoff.getTime() - latestFixtureKickoff.getTime() >
          staleThresholdMs)
    ) {
      status = "stale";
      statusReason =
        "A serie esta sem fixture recente e sem future timeline coerente no recorte atual.";
    }

    return {
      series: row.series_code,
      fixtureCount: Number(row.fixture_count ?? 0),
      resolvedCount: Number(row.resolved_count ?? 0),
      unresolvedCount: Number(row.unresolved_count ?? 0),
      futureCount: Number(row.future_count ?? 0),
      latestFixtureKickoff: latestFixtureKickoff?.toISOString() ?? null,
      earliestFutureKickoff: earliestFutureKickoff?.toISOString() ?? null,
      latestFutureKickoff: latestFutureKickoff?.toISOString() ?? null,
      gapMinutes:
        row.gap_minutes === null || Number.isNaN(Number(row.gap_minutes))
          ? null
          : Number(row.gap_minutes),
      overlapFutureCount,
      minutesSinceLatestFixture,
      minutesUntilEarliestFuture,
      status,
      statusReason,
    };
  });

  return {
    generatedAt: new Date().toISOString(),
    leagueType: "GT LEAGUE",
    serverNow: serverNow.toISOString(),
    summary: {
      healthy: rows.filter((row) => row.status === "healthy").length,
      stale: rows.filter((row) => row.status === "stale").length,
      inconsistent: rows.filter((row) => row.status === "inconsistent").length,
    },
    rows,
  };
}

export async function getDisparityPlayerLive(
  leagueType: DisparityLeagueType,
  playerNameOrId: string,
  options?: { forceRefresh?: boolean },
): Promise<Record<string, unknown> | null> {
  const requestedKey = normalizeKey(resolveDisparityPlayerName(playerNameOrId));
  const cacheKey = `${leagueType}:${requestedKey}`;

  if (
    !options?.forceRefresh &&
    disparityDetailCache.data &&
    disparityDetailCache.expiresAt > Date.now()
  ) {
    const cachedValue = disparityDetailCache.data[cacheKey];
    if (cachedValue !== undefined) {
      return cachedValue as ReturnType<
        typeof getDisparityPlayerLive
      > extends Promise<infer T>
        ? T
        : never;
    }
  }

  const matches =
    leagueType === "6MIN VOLTA"
      ? await loadVoltaMatchesForPlayer(
          resolveDisparityPlayerName(playerNameOrId),
          {
            since: new Date(
              Date.now() -
                DISPARITY_VOLTA_DETAIL_LOOKBACK_DAYS * 24 * 60 * 60 * 1000,
            ),
          },
        )
      : filterMatchesByLeague(await loadUnifiedMatches(), leagueType);
  const players = buildPlayerAggregates(matches);
  const player = players.find(
    (item) =>
      normalizeKey(item.name) === requestedKey ||
      normalizeKey(buildPlayerId(item.name)) === requestedKey,
  );

  if (!player) {
    return null;
  }

  const playerMatches = matches.filter(
    (match) =>
      normalizeKey(match.homePlayer) === normalizeKey(player.name) ||
      normalizeKey(match.awayPlayer) === normalizeKey(player.name),
  );
  const byChampionship = new Map<string, UnifiedMatch[]>();
  const config = getDisparityConfig(leagueType);

  for (const match of playerMatches) {
    const championshipKey = getDisparityChampionshipKey(match);
    const current = byChampionship.get(championshipKey) ?? [];
    current.push(match);
    byChampionship.set(championshipKey, current);
  }

  const championships = Array.from(byChampionship.entries())
    .map(([championshipKey, championshipMatches]) => {
      const normalizedMatches =
        leagueType === "6MIN VOLTA"
          ? getNormalizedDisparityWindowMatches(
              championshipMatches,
              player.name,
              config,
            )
          : championshipMatches.sort(
              (left, right) =>
                right.playedAt.getTime() - left.playedAt.getTime(),
            );
      const championshipPresentation =
        getDisparityChampionshipPresentation(normalizedMatches);

      return {
        championshipKey,
        seasonId: championshipPresentation.seasonId,
        seasonLabel: championshipPresentation.label,
        displayLabel: championshipPresentation.displayLabel,
        latestPlayedAt: normalizedMatches[0]?.playedAt ?? new Date(0),
        matches: normalizedMatches,
      };
    })
    .filter((championship) => championship.matches.length > 0)
    .sort(
      (left, right) =>
        right.latestPlayedAt.getTime() - left.latestPlayedAt.getTime(),
    );

  const activeChampionship = championships[0];

  if (!activeChampionship) {
    return null;
  }

  const recentGames = [...playerMatches]
    .sort((left, right) => right.playedAt.getTime() - left.playedAt.getTime())
    .slice(0, 30);
  const sequence = recentGames.map((match) =>
    getPlayerResultCode(match, player.name),
  );
  const recentGameDetails = recentGames.map((match) =>
    buildDisparityMatchDetail(match, player.name),
  );
  const wins = sequence.filter((result) => result === "W").length;
  const draws = sequence.filter((result) => result === "D").length;
  const losses = sequence.filter((result) => result === "L").length;
  const recentOpponentMap = new Map<string, UnifiedMatch[]>();
  const playerDays = new Map<string, UnifiedMatch[]>();

  for (const championship of championships) {
    for (const match of championship.matches) {
      const opponent =
        normalizeKey(match.homePlayer) === normalizeKey(player.name)
          ? match.awayPlayer
          : match.homePlayer;
      const current =
        recentOpponentMap.get(
          `${championship.championshipKey}__${normalizeKey(opponent)}`,
        ) ?? [];
      current.push(match);
      recentOpponentMap.set(
        `${championship.championshipKey}__${normalizeKey(opponent)}`,
        current,
      );
    }

    if (leagueType === "6MIN VOLTA") {
      playerDays.set(championship.championshipKey, [...championship.matches]);
      continue;
    }

    for (const match of championship.matches) {
      const dayKey = getDisparityOperationalDayKey(match);
      const currentDayMatches = playerDays.get(dayKey) ?? [];
      currentDayMatches.push(match);
      playerDays.set(dayKey, currentDayMatches);
    }
  }

  const dailySlotStudy = Array.from(playerDays.entries())
    .map(([dayKey, dayMatches]) => {
      const sortedMatches = [...dayMatches].sort(
        (left, right) => left.playedAt.getTime() - right.playedAt.getTime(),
      );
      const championship =
        leagueType === "6MIN VOLTA"
          ? championships.find((item) => item.championshipKey === dayKey)
          : null;
      const displayDate =
        championship?.displayLabel ??
        (sortedMatches[0]
          ? formatDisparityWindowDate(sortedMatches[0].playedAt)
          : dayKey);

      return {
        dayKey,
        filterDateKey: sortedMatches[0]
          ? getDisparityOperationalDayKey(sortedMatches[0])
          : dayKey,
        displayDate,
        matches: sortedMatches.map((match, index) => ({
          slot: index + 1,
          ...buildDisparityMatchDetail(match, player.name),
        })),
      };
    })
    .sort((left, right) => right.dayKey.localeCompare(left.dayKey))
    .slice(
      0,
      leagueType === "6MIN VOLTA"
        ? DISPARITY_VOLTA_DAILY_STUDY_LIMIT
        : Number.MAX_SAFE_INTEGER,
    );
  const maxGamesPerDay = Math.max(
    config.gamesPerDay,
    ...dailySlotStudy.map((day) => day.matches.length),
    0,
  );

  const opponents = Array.from(recentOpponentMap.values())
    .map((opponentMatches) => {
      const sortedMatches = opponentMatches.sort(
        (left, right) => right.playedAt.getTime() - left.playedAt.getTime(),
      );
      const championshipPresentation =
        getDisparityChampionshipPresentation(sortedMatches);
      const opponent =
        normalizeKey(sortedMatches[0].homePlayer) === normalizeKey(player.name)
          ? sortedMatches[0].awayPlayer
          : sortedMatches[0].homePlayer;
      const opponentSequence = sortedMatches.map((match) =>
        getPlayerResultCode(match, player.name),
      );
      const recentMatches = sortedMatches.map((match) =>
        buildDisparityMatchDetail(match, player.name),
      );

      return {
        opponent,
        playedAt: sortedMatches[0].playedAt.toISOString(),
        championshipId: championshipPresentation.seasonId,
        championshipLabel: championshipPresentation.label,
        championshipDisplayLabel: championshipPresentation.displayLabel,
        championshipKey: getDisparityChampionshipKey(sortedMatches[0]),
        games: sortedMatches.length,
        sequence: opponentSequence,
        wins: opponentSequence.filter((result) => result === "W").length,
        draws: opponentSequence.filter((result) => result === "D").length,
        losses: opponentSequence.filter((result) => result === "L").length,
        recentMatches,
      };
    })
    .sort(
      (left, right) =>
        new Date(right.playedAt).getTime() - new Date(left.playedAt).getTime(),
    )
    .slice(
      0,
      leagueType === "6MIN VOLTA" ? DISPARITY_VOLTA_OPPONENT_LIMIT : 240,
    );

  const result = {
    player: {
      id: `${player.name}disp`,
      name: player.name,
    },
    leagueType,
    championship: {
      id: activeChampionship.championshipKey,
      seasonId: activeChampionship.seasonId,
      seasonLabel: activeChampionship.seasonLabel,
      displayLabel: activeChampionship.displayLabel,
      totalGames: activeChampionship.matches.length,
      gamesPerOpponent: config.gamesPerOpponent,
      gamesPerDay: maxGamesPerDay,
      latestPlayedAt: activeChampionship.latestPlayedAt.toISOString(),
    },
    recentWindow: {
      totalGames: recentGames.length,
      wins,
      draws,
      losses,
      winRate: recentGames.length
        ? round((wins / recentGames.length) * 100)
        : 0,
      drawRate: recentGames.length
        ? round((draws / recentGames.length) * 100)
        : 0,
      lossRate: recentGames.length
        ? round((losses / recentGames.length) * 100)
        : 0,
      sequence,
      matches: recentGameDetails,
    },
    dailySlotStudy: {
      maxGamesPerDay,
      days: dailySlotStudy,
    },
    opponents,
  };

  disparityDetailCache.data = {
    ...(disparityDetailCache.data ?? {}),
    [cacheKey]: result,
  };
  disparityDetailCache.expiresAt = Date.now() + DISPARITY_DETAIL_CACHE_TTL_MS;

  return result;
}

export async function getDashboardUpcomingFixturesLive(
  limit = 36,
): Promise<DashboardUpcomingFixturesResponse> {
  const now = new Date();
  try {
    const fixtures = await loadDashboardUpcomingFixtures(limit);
    const leagues = buildDashboardUpcomingFixtureLeagues(fixtures);

    return {
      generatedAt: now.toISOString(),
      totalFixtures: leagues.reduce(
        (sum, league) => sum + league.totalFixtures,
        0,
      ),
      leagues,
    };
  } catch (error) {
    const fallbackFixtures =
      dashboardUpcomingFixturesCache.data?.slice(
        0,
        Math.min(Math.max(limit, 1), 300),
      ) ?? [];
    const leagues = buildDashboardUpcomingFixtureLeagues(fallbackFixtures);

    return {
      generatedAt: now.toISOString(),
      totalFixtures: leagues.reduce(
        (sum, league) => sum + league.totalFixtures,
        0,
      ),
      warning: buildDashboardUpcomingFixturesWarning(error),
      leagues,
    };
  }
}

export async function getDashboardLeagueCurrentJLive(
  leagueType: DashboardSnapshotLeagueType,
  options?: {
    forceRefresh?: boolean;
    dayKey?: string;
    scope?: "day" | "window";
  },
): Promise<DashboardLeagueJSnapshotResponse> {
  const scope = options?.scope ?? "day";
  const cacheKey = `${leagueType}:${options?.dayKey ?? "current"}:${scope}`;
  const cachedSnapshot = dashboardCurrentJCache.data?.[cacheKey] ?? null;

  if (
    !options?.forceRefresh &&
    dashboardCurrentJCache.data &&
    dashboardCurrentJCache.expiresAt > Date.now()
  ) {
    if (cachedSnapshot && isDashboardSnapshotComplete(cachedSnapshot)) {
      return cachedSnapshot;
    }
  }

  try {
    const now = new Date();
    const nowTimestamp = now.getTime();
    const dashboardHistoryStart = new Date(
      now.getTime() - 45 * 24 * 60 * 60 * 1000,
    );
    const pendingFixtureHistoryStart = new Date(
      now.getTime() - 24 * 60 * 60 * 1000,
    );
    const [allMatches, upcomingFixtures] =
      leagueType === "6MIN VOLTA"
        ? await Promise.all([
            loadVoltaMatches({ since: dashboardHistoryStart }),
            loadVoltaUpcomingFixtures(300),
          ])
        : await Promise.all([
            loadUnifiedMatches({
              since: dashboardHistoryStart,
              leagueType,
            }),
            loadDashboardUpcomingFixtures(300, leagueType),
          ]);
    const referenceWindow = getDashboardSnapshotWindow(now, leagueType);
    const supportsOperationalDayScope =
      leagueType === "GT LEAGUE" || leagueType === "8MIN BATTLE";
    const selectedDayKey =
      supportsOperationalDayScope && options?.dayKey
        ? options.dayKey
        : referenceWindow.dayKey;
    const currentWindow =
      supportsOperationalDayScope && scope === "day"
        ? buildDashboardOperationalDayWindow(selectedDayKey, leagueType)
        : referenceWindow;
    const leagueMatches =
      leagueType === "6MIN VOLTA"
        ? allMatches
        : filterMatchesByLeague(allMatches, leagueType);
    const leagueUpcomingFixtures =
      leagueType === "6MIN VOLTA"
        ? upcomingFixtures
        : upcomingFixtures.filter(
            (fixture) => fixture.leagueType === leagueType,
          );

    // For GT LEAGUE, build a cache of seasonId → earliest match time so that
    // every game in a season is classified into the same window (J1/J2/J3)
    // based on when the season started, not by individual game time.
    const seasonStartCache = new Map<number, Date>();
    if (leagueType === "GT LEAGUE") {
      for (const match of leagueMatches) {
        if (match.seasonId) {
          const current = seasonStartCache.get(match.seasonId);
          if (!current || match.playedAt.getTime() < current.getTime()) {
            seasonStartCache.set(match.seasonId, match.playedAt);
          }
        }
      }
      for (const fixture of leagueUpcomingFixtures) {
        if (fixture.seasonId) {
          const current = seasonStartCache.get(fixture.seasonId);
          if (!current || fixture.playedAt.getTime() < current.getTime()) {
            seasonStartCache.set(fixture.seasonId, fixture.playedAt);
          }
        }
      }
    }

    const getSeasonAwareWindow = (playedAt: Date, seasonId: number | null) => {
      if (
        leagueType === "GT LEAGUE" &&
        seasonId &&
        seasonStartCache.has(seasonId)
      ) {
        return getDashboardSnapshotWindow(
          seasonStartCache.get(seasonId)!,
          leagueType,
        );
      }
      return getDashboardSnapshotWindow(playedAt, leagueType);
    };

    const isSeasonAwareWindowMatch = (
      playedAt: Date,
      seasonId: number | null,
      targetWindow: ReturnType<typeof getDashboardSnapshotWindow>,
    ) => {
      const candidateWindow = getSeasonAwareWindow(playedAt, seasonId);
      if (targetWindow.windowLabel === "Dia") {
        return candidateWindow.dayKey === targetWindow.dayKey;
      }
      return (
        candidateWindow.dayKey === targetWindow.dayKey &&
        candidateWindow.windowLabel === targetWindow.windowLabel
      );
    };

    const availableDays = Array.from(
      new Set([
        ...leagueMatches.map(
          (match) =>
            getSeasonAwareWindow(match.playedAt, match.seasonId).dayKey,
        ),
        ...leagueUpcomingFixtures.map(
          (fixture) =>
            getSeasonAwareWindow(fixture.playedAt, fixture.seasonId).dayKey,
        ),
      ]),
    )
      .sort((left, right) => right.localeCompare(left))
      .map((dayKey) => ({
        dayKey,
        dayLabel: formatOperationalDayKey(dayKey),
      }));
    const dayMatches = leagueMatches.filter(
      (match) =>
        getSeasonAwareWindow(match.playedAt, match.seasonId).dayKey ===
        currentWindow.dayKey,
    );
    const dayFixtures = leagueUpcomingFixtures.filter(
      (fixture) =>
        getSeasonAwareWindow(fixture.playedAt, fixture.seasonId).dayKey ===
        currentWindow.dayKey,
    );
    const currentWindowMatches = dayMatches.filter((match) =>
      isSeasonAwareWindowMatch(match.playedAt, match.seasonId, currentWindow),
    );
    const rawCurrentWindowFixtures = leagueUpcomingFixtures.filter((fixture) =>
      isSeasonAwareWindowMatch(
        fixture.playedAt,
        fixture.seasonId,
        currentWindow,
      ),
    );
    const snapshotMatches =
      leagueType === "GT LEAGUE" && scope === "window"
        ? currentWindowMatches
        : dayMatches;
    const displayedFixtures =
      leagueType === "GT LEAGUE" && scope === "day"
        ? dayFixtures
        : rawCurrentWindowFixtures;
    const isCurrentOperationalDay =
      currentWindow.dayKey === referenceWindow.dayKey;
    const visibleSnapshotMatches = isCurrentOperationalDay
      ? snapshotMatches.filter(
          (match) => match.playedAt.getTime() <= nowTimestamp,
        )
      : snapshotMatches;
    const visibleCurrentWindowMatches = isCurrentOperationalDay
      ? currentWindowMatches.filter(
          (match) => match.playedAt.getTime() <= nowTimestamp,
        )
      : currentWindowMatches;
    const currentWindowFixtures = Array.from(
      new Map(
        [
          ...displayedFixtures,
          ...(isCurrentOperationalDay
            ? currentWindowMatches
                .filter((match) => match.playedAt.getTime() > nowTimestamp)
                .map((match) => ({
                  id: match.id,
                  leagueType,
                  seasonId: match.seasonId,
                  playedAt: match.playedAt,
                  homePlayer: match.homePlayer,
                  awayPlayer: match.awayPlayer,
                  groupLabel: match.leagueGroup ?? null,
                }))
            : []),
        ]
          .sort(
            (left, right) => left.playedAt.getTime() - right.playedAt.getTime(),
          )
          .map((fixture) => [
            `${fixture.id}__${fixture.playedAt.toISOString()}`,
            fixture,
          ]),
      ).values(),
    );
    const sortedLeagueMatches = [...leagueMatches].sort(
      (left, right) => left.playedAt.getTime() - right.playedAt.getTime(),
    );
    const sortedSnapshotMatches = [...visibleSnapshotMatches].sort(
      (left, right) => left.playedAt.getTime() - right.playedAt.getTime(),
    );
    const sortedDisplayedFixtures = [...currentWindowFixtures].sort(
      (left, right) => left.playedAt.getTime() - right.playedAt.getTime(),
    );
    const includePreviousWindows = leagueType !== "6MIN VOLTA";
    const snapshotAggregates = buildPlayerAggregates(visibleSnapshotMatches);
    const aggregateMap = new Map(
      snapshotAggregates.map((player) => [normalizeKey(player.name), player]),
    );
    const playersWithPreviousWindows = new Set<string>();
    const playerNames = new Map<string, string>();
    const currentWindowGames = new Map<string, number>();
    const upcomingWindowGames = new Map<string, number>();
    const playerGroups = new Map<string, string>();
    const daySequenceMap = new Map<string, DashboardSequenceResult[]>();
    const latestPlayedAt = new Map<string, Date>();
    const nextFixtureAt = new Map<string, Date>();
    const recentMatchesByPlayer = new Map<
      string,
      DashboardPlayerMatchDetail[]
    >();
    const upcomingFixturesByPlayer = new Map<
      string,
      DashboardPlayerFixtureDetail[]
    >();

    const trackPlayerName = (playerName: string) => {
      const key = normalizeKey(playerName);
      if (!playerNames.has(key)) {
        playerNames.set(key, playerName);
      }
      return key;
    };

    const incrementMap = (map: Map<string, number>, key: string) => {
      map.set(key, (map.get(key) ?? 0) + 1);
    };

    const appendMapItem = <T>(map: Map<string, T[]>, key: string, item: T) => {
      const current = map.get(key) ?? [];
      current.push(item);
      map.set(key, current);
    };

    const updateLatestDate = (
      map: Map<string, Date>,
      key: string,
      value: Date,
    ) => {
      const currentValue = map.get(key);
      if (!currentValue || value.getTime() > currentValue.getTime()) {
        map.set(key, value);
      }
    };

    const updateEarliestDate = (
      map: Map<string, Date>,
      key: string,
      value: Date,
    ) => {
      const currentValue = map.get(key);
      if (!currentValue || value.getTime() < currentValue.getTime()) {
        map.set(key, value);
      }
    };

    const trackPlayerGroup = (key: string, group?: string | null) => {
      if (!group) {
        return;
      }

      playerGroups.set(key, group);
    };

    const serializePlayerMatch = (
      match: UnifiedMatch,
      playerName: string,
    ): DashboardPlayerMatchDetail => {
      const playerKey = normalizeKey(playerName);
      const isHome = normalizeKey(match.homePlayer) === playerKey;
      return {
        id: match.id,
        playedAt: match.playedAt.toISOString(),
        homePlayer: match.homePlayer,
        awayPlayer: match.awayPlayer,
        opponent: isHome ? match.awayPlayer : match.homePlayer,
        seasonId: match.seasonId,
        result: getPlayerResultCode(match, playerName),
        scoreLabel: `${match.homeScore}-${match.awayScore}`,
      };
    };

    const serializePlayerFixture = (
      fixture: InternalDashboardUpcomingFixture,
      playerName: string,
    ): DashboardPlayerFixtureDetail => {
      const playerKey = normalizeKey(playerName);
      const isHome = normalizeKey(fixture.homePlayer) === playerKey;
      return {
        id: fixture.id,
        playedAt: fixture.playedAt.toISOString(),
        homePlayer: fixture.homePlayer,
        awayPlayer: fixture.awayPlayer,
        opponent: isHome ? fixture.awayPlayer : fixture.homePlayer,
        seasonId: fixture.seasonId,
      };
    };

    // Fixtures in gt_gtapi_fixtures with null scores — already kicked off but no result recorded yet.
    const pendingFromFixtures =
      leagueType === "GT LEAGUE"
        ? (
            await prisma.gt_gtapi_fixtures.findMany({
              where: {
                match_kickoff: { gte: pendingFixtureHistoryStart },
                OR: [{ home_score_ft: null }, { away_score_ft: null }],
              },
              select: {
                id_fixture: true,
                id_season: true,
                match_kickoff: true,
                home_player: true,
                away_player: true,
                home_team: true,
                away_team: true,
                grupo: true,
              },
            })
          )
            .map((match) => ({
              id: `GT-${match.id_fixture}`,
              playedAt: match.match_kickoff.toISOString(),
              homePlayer: normalizeName(match.home_player || match.home_team),
              awayPlayer: normalizeName(match.away_player || match.away_team),
              seasonId: Number(match.id_season ?? 0) || null,
              groupLabel:
                normalizeLeagueGroup("GT LEAGUE", match.grupo) ?? null,
              pendingResult: true as const,
            }))
            .filter((fixture) =>
              isSeasonAwareWindowMatch(
                new Date(fixture.playedAt),
                fixture.seasonId,
                currentWindow,
              ),
            )
        : [];

    // Games from futurematches whose kickoff already passed — they left the
    // "upcoming" query (match_kickoff >= now) but may not yet be in fixtures.
    // Without this, there is a blind spot: the game is invisible to the pending
    // guard and a premature signal can fire for a later fixture of the same player.
    const pendingFromInFlightFutures =
      leagueType === "GT LEAGUE"
        ? (
            await prisma.gt_gtapi_futurematches.findMany({
              where: {
                match_kickoff: { gte: pendingFixtureHistoryStart, lt: now },
              },
              select: {
                id_fixture: true,
                id_season: true,
                match_kickoff: true,
                home_player: true,
                away_player: true,
                group_name: true,
              },
            })
          )
            .map((match) => ({
              id: `GT-FM-${match.id_fixture}`,
              playedAt: match.match_kickoff.toISOString(),
              homePlayer: normalizeName(match.home_player),
              awayPlayer: normalizeName(match.away_player),
              seasonId: Number(match.id_season ?? 0) || null,
              groupLabel:
                normalizeLeagueGroup("GT LEAGUE", match.group_name) ?? null,
              pendingResult: true as const,
            }))
            .filter((fixture) =>
              isSeasonAwareWindowMatch(
                new Date(fixture.playedAt),
                fixture.seasonId,
                currentWindow,
              ),
            )
        : [];

    // Merge both sources, deduplicating by composite key (same player pair + kickoff).
    const pendingSnapshotFixtures = Array.from(
      new Map(
        [...pendingFromFixtures, ...pendingFromInFlightFutures].map((f) => [
          `${normalizeKey(f.homePlayer)}__${normalizeKey(f.awayPlayer)}__${f.playedAt}`,
          f,
        ]),
      ).values(),
    );

    const serializeSnapshotFixtureFromMatch = (match: UnifiedMatch) => ({
      id: match.id,
      playedAt: match.playedAt.toISOString(),
      homePlayer: match.homePlayer,
      awayPlayer: match.awayPlayer,
      seasonId: match.seasonId,
      groupLabel: match.leagueGroup ?? null,
      pendingResult: false,
    });

    const serializeSnapshotFixtureFromUpcoming = (
      fixture: InternalDashboardUpcomingFixture,
    ) => ({
      id: fixture.id,
      playedAt: fixture.playedAt.toISOString(),
      homePlayer: fixture.homePlayer,
      awayPlayer: fixture.awayPlayer,
      seasonId: fixture.seasonId,
      groupLabel: fixture.groupLabel ?? null,
      pendingResult: false,
    });

    if (includePreviousWindows) {
      for (const match of sortedLeagueMatches) {
        const homeKey = trackPlayerName(match.homePlayer);
        const awayKey = trackPlayerName(match.awayPlayer);
        const snapshotWindow = getSeasonAwareWindow(
          match.playedAt,
          match.seasonId,
        );
        if (
          snapshotWindow.dayKey !== currentWindow.dayKey ||
          snapshotWindow.windowLabel !== currentWindow.windowLabel
        ) {
          playersWithPreviousWindows.add(homeKey);
          playersWithPreviousWindows.add(awayKey);
        }
        trackPlayerGroup(homeKey, match.leagueGroup);
        trackPlayerGroup(awayKey, match.leagueGroup);
      }
    } else {
      for (const match of sortedLeagueMatches) {
        const homeKey = trackPlayerName(match.homePlayer);
        const awayKey = trackPlayerName(match.awayPlayer);
        const snapshotWindow = getSeasonAwareWindow(
          match.playedAt,
          match.seasonId,
        );
        if (
          snapshotWindow.dayKey !== currentWindow.dayKey ||
          snapshotWindow.windowLabel !== currentWindow.windowLabel
        ) {
          playersWithPreviousWindows.add(homeKey);
          playersWithPreviousWindows.add(awayKey);
        }
      }
    }

    for (const match of sortedSnapshotMatches) {
      const homeKey = trackPlayerName(match.homePlayer);
      const awayKey = trackPlayerName(match.awayPlayer);
      updateLatestDate(latestPlayedAt, homeKey, match.playedAt);
      updateLatestDate(latestPlayedAt, awayKey, match.playedAt);

      const homeSequence = daySequenceMap.get(homeKey) ?? [];
      homeSequence.push(getPlayerResultCode(match, match.homePlayer));
      daySequenceMap.set(homeKey, homeSequence);
      appendMapItem(
        recentMatchesByPlayer,
        homeKey,
        serializePlayerMatch(match, match.homePlayer),
      );

      const awaySequence = daySequenceMap.get(awayKey) ?? [];
      awaySequence.push(getPlayerResultCode(match, match.awayPlayer));
      daySequenceMap.set(awayKey, awaySequence);
      appendMapItem(
        recentMatchesByPlayer,
        awayKey,
        serializePlayerMatch(match, match.awayPlayer),
      );
    }

    for (const match of visibleCurrentWindowMatches) {
      incrementMap(currentWindowGames, trackPlayerName(match.homePlayer));
      incrementMap(currentWindowGames, trackPlayerName(match.awayPlayer));
    }

    for (const fixture of sortedDisplayedFixtures) {
      const homeKey = trackPlayerName(fixture.homePlayer);
      const awayKey = trackPlayerName(fixture.awayPlayer);
      trackPlayerGroup(homeKey, fixture.groupLabel);
      trackPlayerGroup(awayKey, fixture.groupLabel);
      incrementMap(upcomingWindowGames, homeKey);
      incrementMap(upcomingWindowGames, awayKey);
      updateEarliestDate(nextFixtureAt, homeKey, fixture.playedAt);
      updateEarliestDate(nextFixtureAt, awayKey, fixture.playedAt);
      appendMapItem(
        upcomingFixturesByPlayer,
        homeKey,
        serializePlayerFixture(fixture, fixture.homePlayer),
      );
      appendMapItem(
        upcomingFixturesByPlayer,
        awayKey,
        serializePlayerFixture(fixture, fixture.awayPlayer),
      );
    }

    const activePlayerKeys =
      leagueType === "GT LEAGUE"
        ? new Set<string>([
            ...sortedSnapshotMatches.flatMap((match) => [
              trackPlayerName(match.homePlayer),
              trackPlayerName(match.awayPlayer),
            ]),
            ...sortedDisplayedFixtures.flatMap((fixture) => [
              trackPlayerName(fixture.homePlayer),
              trackPlayerName(fixture.awayPlayer),
            ]),
          ])
        : new Set<string>([
            ...currentWindowGames.keys(),
            ...upcomingWindowGames.keys(),
          ]);
    const players = Array.from(activePlayerKeys)
      .map((playerKey) => {
        const aggregate = aggregateMap.get(playerKey);
        const playerName =
          playerNames.get(playerKey) ?? aggregate?.name ?? playerKey;
        const previousWindows: DashboardPlayerPreviousWindow[] = [];
        const totalGames = aggregate?.totalGames ?? 0;
        const wins = aggregate?.wins ?? 0;
        const draws = aggregate?.draws ?? 0;
        const losses = aggregate?.losses ?? 0;
        return {
          id: buildPlayerId(playerName),
          name: playerName,
          leagueGroup: playerGroups.get(playerKey) ?? null,
          totalGames,
          wins,
          draws,
          losses,
          winRate: totalGames ? round((wins / totalGames) * 100) : 0,
          currentWindowGames: currentWindowGames.get(playerKey) ?? 0,
          upcomingWindowGames: upcomingWindowGames.get(playerKey) ?? 0,
          daySequence: daySequenceMap.get(playerKey) ?? [],
          latestPlayedAt: latestPlayedAt.get(playerKey)?.toISOString() ?? null,
          nextFixtureAt: nextFixtureAt.get(playerKey)?.toISOString() ?? null,
          upcomingFixtures: upcomingFixturesByPlayer.get(playerKey) ?? [],
          recentMatches: recentMatchesByPlayer.get(playerKey) ?? [],
          previousWindows,
          hasPreviousWindows: playersWithPreviousWindows.has(playerKey),
        };
      })
      .sort(
        (left, right) =>
          right.currentWindowGames - left.currentWindowGames ||
          right.upcomingWindowGames - left.upcomingWindowGames ||
          right.totalGames - left.totalGames ||
          right.winRate - left.winRate ||
          left.name.localeCompare(right.name),
      );

    const totals = players.reduce(
      (accumulator, player) => ({
        activePlayers: accumulator.activePlayers + 1,
        totalGames: accumulator.totalGames + player.totalGames,
        wins: accumulator.wins + player.wins,
        draws: accumulator.draws + player.draws,
        losses: accumulator.losses + player.losses,
        winRate: 0,
        totalDayMatches: dayMatches.length,
        currentWindowPlayedMatches: visibleCurrentWindowMatches.length,
        currentWindowUpcomingFixtures: currentWindowFixtures.length,
      }),
      {
        activePlayers: 0,
        totalGames: 0,
        wins: 0,
        draws: 0,
        losses: 0,
        winRate: 0,
        totalDayMatches: dayMatches.length,
        currentWindowPlayedMatches: visibleCurrentWindowMatches.length,
        currentWindowUpcomingFixtures: currentWindowFixtures.length,
      },
    );

    const snapshot: DashboardLeagueJSnapshotResponse = {
      generatedAt: now.toISOString(),
      leagueType,
      availableDays,
      currentWindow,
      totals: {
        ...totals,
        winRate: totals.totalGames
          ? round((totals.wins / totals.totalGames) * 100)
          : 0,
      },
      fixtures: mergeDashboardSnapshotFixtures([
        ...pendingSnapshotFixtures,
        ...displayedFixtures.map(serializeSnapshotFixtureFromUpcoming),
        ...(leagueType === "GT LEAGUE"
          ? dayMatches.map(serializeSnapshotFixtureFromMatch)
          : currentWindowMatches.map(serializeSnapshotFixtureFromMatch)),
      ]),
      players,
    };

    dashboardCurrentJCache.data = {
      ...(dashboardCurrentJCache.data ?? {}),
      [cacheKey]: snapshot,
    };
    dashboardCurrentJCache.expiresAt =
      Date.now() + DASHBOARD_CURRENT_J_CACHE_TTL_MS;

    return snapshot;
  } catch (error) {
    if (leagueType === "6MIN VOLTA") {
      try {
        const fallbackSnapshot = await buildVoltaFallbackCurrentJSnapshot();
        const snapshotWithWarning = {
          ...fallbackSnapshot,
          warning: buildVoltaFallbackCurrentJWarning(error),
        };

        dashboardCurrentJCache.data = {
          ...(dashboardCurrentJCache.data ?? {}),
          [cacheKey]: snapshotWithWarning,
        };
        dashboardCurrentJCache.expiresAt =
          Date.now() + DASHBOARD_CURRENT_J_CACHE_TTL_MS;

        return snapshotWithWarning;
      } catch {
        // Mantem o fluxo padrao abaixo se ate o fallback direto da Volta falhar.
      }
    }

    if (cachedSnapshot && isDashboardSnapshotComplete(cachedSnapshot)) {
      const rawMessage =
        error instanceof Error
          ? error.message
          : "Base live indisponivel no momento.";
      const warning = rawMessage.includes("Authentication failed")
        ? "Falha de autenticacao no MySQL remoto. Exibindo o ultimo snapshot valido em cache."
        : "Base live indisponivel no momento. Exibindo o ultimo snapshot valido em cache.";

      return {
        ...cachedSnapshot,
        warning,
      };
    }

    throw error;
  }
}

export async function getDashboardConfrontationHistoryLive(
  leagueType: DashboardSnapshotLeagueType,
  playerName: string,
  opponentName: string,
) {
  let leagueMatches: UnifiedMatch[];

  try {
    leagueMatches = filterMatchesByLeague(
      await loadUnifiedMatches({ leagueType }),
      leagueType,
    );
  } catch (error) {
    if (leagueType !== "6MIN VOLTA") {
      throw error;
    }

    leagueMatches = await loadVoltaMatches();
  }

  const matches = leagueMatches
    .filter((match) => {
      const homeKey = normalizeKey(match.homePlayer);
      const awayKey = normalizeKey(match.awayPlayer);
      const playerKey = normalizeKey(playerName);
      const opponentKey = normalizeKey(opponentName);

      return (
        [homeKey, awayKey].includes(playerKey) &&
        [homeKey, awayKey].includes(opponentKey)
      );
    })
    .sort((left, right) => left.playedAt.getTime() - right.playedAt.getTime());

  return matches.map((match) => ({
    id: match.id,
    playedAt: match.playedAt.toISOString(),
    homePlayer: match.homePlayer,
    awayPlayer: match.awayPlayer,
    opponent:
      normalizeKey(match.homePlayer) === normalizeKey(playerName)
        ? match.awayPlayer
        : match.homePlayer,
    seasonId: match.seasonId,
    result: getPlayerResultCode(match, playerName),
    scoreLabel: `${match.homeScore}-${match.awayScore}`,
  }));
}

export async function getDashboardPlayerPreviousWindowsLive(
  leagueType: DashboardSnapshotLeagueType,
  playerName: string,
) {
  const now = new Date();
  const historyStart = new Date(now.getTime() - 45 * 24 * 60 * 60 * 1000);
  const leagueMatches =
    leagueType === "6MIN VOLTA"
      ? await loadVoltaMatches({ since: historyStart })
      : filterMatchesByLeague(
          await loadUnifiedMatches({ since: historyStart, leagueType }),
          leagueType,
        );
  const requestedKey = normalizeKey(playerName);
  const playerMatches = leagueMatches.filter(
    (match) =>
      normalizeKey(match.homePlayer) === requestedKey ||
      normalizeKey(match.awayPlayer) === requestedKey,
  );

  if (!playerMatches.length) {
    return [] as DashboardPlayerPreviousWindow[];
  }

  const currentWindow = getDashboardSnapshotWindow(now, leagueType);
  const disparityConfig =
    leagueType === "GT LEAGUE" || leagueType === "6MIN VOLTA"
      ? getDisparityConfig(leagueType)
      : null;

  // Build season start cache for GT LEAGUE season-aware window classification
  const seasonStartCache = new Map<number, Date>();
  if (leagueType === "GT LEAGUE") {
    for (const match of leagueMatches) {
      if (match.seasonId) {
        const current = seasonStartCache.get(match.seasonId);
        if (!current || match.playedAt.getTime() < current.getTime()) {
          seasonStartCache.set(match.seasonId, match.playedAt);
        }
      }
    }
  }
  const getSeasonAwareWindowLocal = (
    playedAt: Date,
    seasonId: number | null,
  ) => {
    if (
      leagueType === "GT LEAGUE" &&
      seasonId &&
      seasonStartCache.has(seasonId)
    ) {
      return getDashboardSnapshotWindow(
        seasonStartCache.get(seasonId)!,
        leagueType,
      );
    }
    return getDashboardSnapshotWindow(playedAt, leagueType);
  };

  return Array.from(
    playerMatches.reduce((map, match) => {
      const snapshotWindow = getSeasonAwareWindowLocal(
        match.playedAt,
        match.seasonId,
      );
      if (
        snapshotWindow.dayKey === currentWindow.dayKey &&
        snapshotWindow.windowLabel === currentWindow.windowLabel
      ) {
        return map;
      }

      const windowKey = `${snapshotWindow.dayKey}|${snapshotWindow.windowLabel}`;
      const currentGroup = map.get(windowKey) ?? {
        snapshotWindow,
        matches: [] as UnifiedMatch[],
      };
      currentGroup.matches.push(match);
      map.set(windowKey, currentGroup);
      return map;
    }, new Map<string, { snapshotWindow: ReturnType<typeof getDashboardSnapshotWindow>; matches: UnifiedMatch[] }>()),
  )
    .map(([windowKey, group]) => {
      const normalizedMatches = disparityConfig
        ? getNormalizedDisparityWindowMatches(
            group.matches,
            playerName,
            disparityConfig,
          )
        : [...group.matches].sort(
            (left, right) => right.playedAt.getTime() - left.playedAt.getTime(),
          );
      const matches = [...normalizedMatches].sort(
        (left, right) => left.playedAt.getTime() - right.playedAt.getTime(),
      );
      const sequence = matches.map((match) =>
        getPlayerResultCode(match, playerName),
      );
      const wins = sequence.filter((result) => result === "W").length;
      const draws = sequence.filter((result) => result === "D").length;
      const losses = sequence.filter((result) => result === "L").length;

      return {
        key: windowKey,
        dayLabel: group.snapshotWindow.dayLabel,
        windowLabel: group.snapshotWindow.windowLabel,
        rangeLabel: group.snapshotWindow.rangeLabel,
        totalGames: matches.length,
        wins,
        draws,
        losses,
        latestPlayedAt:
          matches[matches.length - 1]?.playedAt.toISOString() ?? null,
        sequence,
        matches: matches.map((match) => ({
          id: match.id,
          playedAt: match.playedAt.toISOString(),
          homePlayer: match.homePlayer,
          awayPlayer: match.awayPlayer,
          opponent:
            normalizeKey(match.homePlayer) === requestedKey
              ? match.awayPlayer
              : match.homePlayer,
          seasonId: match.seasonId,
          result: getPlayerResultCode(match, playerName),
          scoreLabel: `${match.homeScore}-${match.awayScore}`,
        })),
      } satisfies DashboardPlayerPreviousWindow;
    })
    .sort(
      (left, right) =>
        new Date(right.latestPlayedAt ?? 0).getTime() -
        new Date(left.latestPlayedAt ?? 0).getTime(),
    )
    .slice(0, 8);
}

function buildDisparityPlayerSummaries(matches: UnifiedMatch[]) {
  const aggregateMap = new Map<
    string,
    {
      id: string;
      name: string;
      totalGames: number;
      wins: number;
      draws: number;
      losses: number;
    }
  >();

  const upsert = (
    playerName: string,
    goalsFor: number,
    goalsAgainst: number,
  ) => {
    const key = normalizeKey(playerName);
    const current = aggregateMap.get(key) ?? {
      id: `${playerName}disp`,
      name: playerName,
      totalGames: 0,
      wins: 0,
      draws: 0,
      losses: 0,
    };

    current.totalGames += 1;
    current.wins += goalsFor > goalsAgainst ? 1 : 0;
    current.draws += goalsFor === goalsAgainst ? 1 : 0;
    current.losses += goalsFor < goalsAgainst ? 1 : 0;
    aggregateMap.set(key, current);
  };

  for (const match of matches) {
    upsert(match.homePlayer, match.homeScore, match.awayScore);
    upsert(match.awayPlayer, match.awayScore, match.homeScore);
  }

  return Array.from(aggregateMap.values()).map((player) => ({
    ...player,
    winRate: player.totalGames
      ? round((player.wins / player.totalGames) * 100)
      : 0,
  }));
}

async function loadDisparityVoltaPlayersSummary(query?: string) {
  const since = new Date(
    Date.now() - DISPARITY_VOLTA_LOOKBACK_DAYS * 24 * 60 * 60 * 1000,
  );
  const rows = await prisma.$queryRaw<
    Array<{
      playerKey: string;
      playerName: string;
      totalGames: bigint | number;
      wins: bigint | number;
      draws: bigint | number;
      losses: bigint | number;
    }>
  >(Prisma.sql`
    SELECT
      player_rows.player_key AS playerKey,
      MIN(player_rows.player_name) AS playerName,
      COUNT(*) AS totalGames,
      SUM(CASE WHEN player_rows.goals_for > player_rows.goals_against THEN 1 ELSE 0 END) AS wins,
      SUM(CASE WHEN player_rows.goals_for = player_rows.goals_against THEN 1 ELSE 0 END) AS draws,
      SUM(CASE WHEN player_rows.goals_for < player_rows.goals_against THEN 1 ELSE 0 END) AS losses
    FROM (
      SELECT
        UPPER(TRIM(COALESCE(NULLIF(home_player, ''), home_team))) AS player_key,
        TRIM(COALESCE(NULLIF(home_player, ''), home_team)) AS player_name,
        home_score_ft AS goals_for,
        away_score_ft AS goals_against
      FROM ebattle_ebattleapi_fixtures
      WHERE match_kickoff >= ${since}
        AND home_score_ft IS NOT NULL
        AND away_score_ft IS NOT NULL
        AND (season_name LIKE 'Volta%' OR season_name LIKE 'volta%')

      UNION ALL

      SELECT
        UPPER(TRIM(COALESCE(NULLIF(away_player, ''), away_team))) AS player_key,
        TRIM(COALESCE(NULLIF(away_player, ''), away_team)) AS player_name,
        away_score_ft AS goals_for,
        home_score_ft AS goals_against
      FROM ebattle_ebattleapi_fixtures
      WHERE match_kickoff >= ${since}
        AND home_score_ft IS NOT NULL
        AND away_score_ft IS NOT NULL
        AND (season_name LIKE 'Volta%' OR season_name LIKE 'volta%')
    ) AS player_rows
    GROUP BY player_rows.player_key
  `);

  return rows
    .map((row) => {
      const playerName = normalizeName(row.playerName);
      const totalGames = Number(row.totalGames ?? 0);
      const wins = Number(row.wins ?? 0);
      const draws = Number(row.draws ?? 0);
      const losses = Number(row.losses ?? 0);

      return {
        id: `${playerName}disp`,
        name: playerName,
        totalGames,
        wins,
        draws,
        losses,
        winRate: totalGames ? round((wins / totalGames) * 100) : 0,
      };
    })
    .filter((player) =>
      query ? normalizeKey(player.name).includes(normalizeKey(query)) : true,
    )
    .sort(
      (left, right) =>
        right.totalGames - left.totalGames || right.winRate - left.winRate,
    )
    .slice(0, 120);
}
