import { prisma } from "../prisma";
import { buildLocalTemporalContext, isVoltaSeasonName, normalizeAnalyticsKey, normalizeAnalyticsName, normalizeLeagueGroup } from "./normalizers";
import type { AnalyticsFilters, AnalyticsMatch } from "./types";
import { applyAnalyticsFilters } from "./filters";

const MATCH_CACHE_TTL_MS = 60_000;
const h2hDataSource = process.env.SHEVA_H2H_SOURCE === "ebasket" ? "ebasket" : "esoccer";

const matchCache: {
  expiresAt: number;
  data: AnalyticsMatch[] | null;
} = {
  expiresAt: 0,
  data: null,
};

type EbasketAnalyticsRow = {
  id_fixture: string | number;
  id_season: number | null;
  match_kickoff: Date;
  home_player: string | null;
  away_player: string | null;
  home_team: string | null;
  away_team: string | null;
  home_score_ft: number | null;
  away_score_ft: number | null;
};

async function loadEbasketAnalyticsMatches(): Promise<EbasketAnalyticsRow[]> {
  return prisma.$queryRaw<EbasketAnalyticsRow[]>`
    SELECT
      id_fixture,
      id_season,
      match_kickoff,
      home_player,
      away_player,
      home_team,
      away_team,
      home_score_ft,
      away_score_ft
    FROM fifa.h2h_ebasket_fixtures_new
    ORDER BY match_kickoff DESC
  `;
}

export async function loadAnalyticsMatches(): Promise<AnalyticsMatch[]> {
  if (matchCache.data && matchCache.expiresAt > Date.now()) {
    return matchCache.data;
  }

  const h2hMatchesPromise = h2hDataSource === "ebasket"
    ? loadEbasketAnalyticsMatches()
    : prisma.h2h_h2hapi_fixtures.findMany({
        select: {
          id_fixture: true,
          id_season: true,
          match_kickoff: true,
          home_player: true,
          away_player: true,
          home_team: true,
          away_team: true,
          home_score_ft: true,
          away_score_ft: true,
        },
      });

  const [gtMatches, ebattleMatches, h2hMatches] = await Promise.all([
    prisma.gt_gtapi_fixtures.findMany({
      select: {
        id_fixture: true,
        id_season: true,
        match_kickoff: true,
        grupo: true,
        home_player: true,
        away_player: true,
        home_team: true,
        away_team: true,
        home_score_ft: true,
        away_score_ft: true,
      },
    }),
    prisma.ebattle_ebattleapi_fixtures.findMany({
      select: {
        id_fixture: true,
        id_season: true,
        season_name: true,
        match_kickoff: true,
        home_player: true,
        away_player: true,
        home_team: true,
        away_team: true,
        home_score_ft: true,
        away_score_ft: true,
      },
    }),
    h2hMatchesPromise,
  ]);

  const unified = [
    ...gtMatches
      .filter((match) => match.home_score_ft !== null && match.away_score_ft !== null)
      .map((match) => buildAnalyticsMatch({
        id: `GT-${match.id_fixture}`,
        sourceMatchId: match.id_fixture,
        leagueType: "GT LEAGUE",
        leagueGroup: normalizeLeagueGroup(match.grupo),
        seasonId: Number(match.id_season ?? 0) || null,
        playedAt: match.match_kickoff,
        homePlayer: match.home_player || match.home_team,
        awayPlayer: match.away_player || match.away_team,
        homeScore: match.home_score_ft ?? 0,
        awayScore: match.away_score_ft ?? 0,
      })),
    ...ebattleMatches
      .filter((match) => match.home_score_ft !== null && match.away_score_ft !== null)
      .map((match) => buildAnalyticsMatch({
        id: `${isVoltaSeasonName(match.season_name) ? "VOLTA" : "EBATTLE"}-${match.id_fixture}`,
        sourceMatchId: match.id_fixture,
        leagueType: isVoltaSeasonName(match.season_name) ? "6MIN VOLTA" : "8MIN BATTLE",
        leagueGroup: null,
        seasonId: Number(match.id_season ?? 0) || null,
        playedAt: match.match_kickoff,
        homePlayer: match.home_player || match.home_team,
        awayPlayer: match.away_player || match.away_team,
        homeScore: match.home_score_ft ?? 0,
        awayScore: match.away_score_ft ?? 0,
      })),
    ...h2hMatches
      .filter((match) => match.home_score_ft !== null && match.away_score_ft !== null)
      .map((match) => buildAnalyticsMatch({
        id: `H2H-${match.id_fixture}`,
        sourceMatchId: match.id_fixture,
        leagueType: "H2H",
        leagueGroup: null,
        seasonId: Number(match.id_season ?? 0) || null,
        playedAt: match.match_kickoff,
        homePlayer: match.home_player || match.home_team || "Mandante",
        awayPlayer: match.away_player || match.away_team || "Visitante",
        homeScore: match.home_score_ft ?? 0,
        awayScore: match.away_score_ft ?? 0,
      })),
  ].sort((left, right) => left.playedAt.getTime() - right.playedAt.getTime());

  matchCache.data = unified;
  matchCache.expiresAt = Date.now() + MATCH_CACHE_TTL_MS;
  return unified;
}

export async function getAnalyticsMatches(filters: AnalyticsFilters = {}) {
  const matches = await loadAnalyticsMatches();
  return applyAnalyticsFilters(matches, filters);
}

function buildAnalyticsMatch(input: {
  id: string;
  sourceMatchId: string | number;
  leagueType: AnalyticsMatch["leagueType"];
  leagueGroup: string | null;
  seasonId: number | null;
  playedAt: Date;
  homePlayer: string;
  awayPlayer: string;
  homeScore: number;
  awayScore: number;
}): AnalyticsMatch {
  const homePlayer = normalizeAnalyticsName(input.homePlayer);
  const awayPlayer = normalizeAnalyticsName(input.awayPlayer);
  const temporal = buildLocalTemporalContext(input.playedAt);

  return {
    id: input.id,
    sourceMatchId: input.sourceMatchId,
    leagueType: input.leagueType,
    leagueGroup: input.leagueGroup,
    seasonId: input.seasonId,
    playedAt: input.playedAt,
    dayKey: temporal.dayKey,
    hour: temporal.hour,
    weekday: temporal.weekday,
    timeBucket: temporal.timeBucket,
    homePlayer,
    awayPlayer,
    normalizedHomePlayer: normalizeAnalyticsKey(homePlayer),
    normalizedAwayPlayer: normalizeAnalyticsKey(awayPlayer),
    homeScore: Number(input.homeScore),
    awayScore: Number(input.awayScore),
    isFinished: true,
  };
}
