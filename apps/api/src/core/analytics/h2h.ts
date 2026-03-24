import { applyMinimumGames } from "./filters";
import { getPlayerOpponentName, getPlayerResultCode, roundAnalytics } from "./normalizers";
import { computeOpponentDangerScore } from "./scoring";
import { getCurrentStreak, getLongestPureStreak } from "./streaks";
import type { AnalyticsLeagueType, AnalyticsMatch, MatchResultCode, OpponentAnalyticsRow, OpponentRelationshipLabel } from "./types";

type OpponentBucket = {
  opponent: string;
  matches: AnalyticsMatch[];
};

export function buildOpponentAnalytics(matches: AnalyticsMatch[], playerName: string, minGames = 0): OpponentAnalyticsRow[] {
  const playerMatches = [...matches]
    .filter((match) => match.normalizedHomePlayer === playerName.toUpperCase().trim() || match.normalizedAwayPlayer === playerName.toUpperCase().trim())
    .sort((left, right) => left.playedAt.getTime() - right.playedAt.getTime());

  const grouped = playerMatches.reduce<Map<string, OpponentBucket>>((map, match) => {
    const opponent = getPlayerOpponentName(match, playerName);
    const key = opponent.toUpperCase().trim();
    const current = map.get(key) ?? { opponent, matches: [] };
    current.matches.push(match);
    map.set(key, current);
    return map;
  }, new Map());

  return applyMinimumGames(
    Array.from(grouped.values())
      .map((bucket) => summarizeOpponent(bucket, playerName))
      .sort((left, right) => right.opponentDangerScore - left.opponentDangerScore || right.totalGames - left.totalGames),
    minGames,
  );
}

function summarizeOpponent(bucket: OpponentBucket, playerName: string): OpponentAnalyticsRow {
  const results = bucket.matches.map((match) => getPlayerResultCode(match, playerName));
  const wins = results.filter((result) => result === "W").length;
  const draws = results.filter((result) => result === "D").length;
  const losses = results.filter((result) => result === "L").length;
  const totalGames = results.length;
  const winRate = totalGames ? roundAnalytics((wins / totalGames) * 100) : 0;
  const lossRate = totalGames ? roundAnalytics((losses / totalGames) * 100) : 0;
  const recentSequence = results.slice(-8);
  const longestNegativeStreak = getLongestPureStreak(results, "L");
  const currentStreak = getCurrentStreak(results);
  const mostDangerousHour = resolveMostDangerousHour(bucket.matches, playerName);
  const mostDangerousLeague = resolveMostDangerousLeague(bucket.matches, playerName);
  const relationshipLabel = classifyOpponentRelationship(totalGames, winRate, lossRate);

  return {
    opponent: bucket.opponent,
    totalGames,
    wins,
    draws,
    losses,
    winRate,
    lossRate,
    balance: wins - losses,
    currentStreak,
    recentSequence,
    longestNegativeStreak,
    mostDangerousHour,
    mostDangerousLeague,
    relationshipLabel,
    opponentDangerScore: computeOpponentDangerScore({ totalGames, lossRate, longestNegativeStreak, recentSequence }),
    latestPlayedAt: bucket.matches.at(-1)?.playedAt.toISOString() ?? null,
  };
}

export function classifyOpponentRelationship(totalGames: number, winRate: number, lossRate: number): OpponentRelationshipLabel {
  if (totalGames >= 10 && lossRate >= 70) {
    return "muito-perigoso";
  }

  if (totalGames >= 5 && lossRate >= 65) {
    return "carrasco";
  }

  if (totalGames >= 5 && winRate >= 65) {
    return "fregues";
  }

  if (totalGames < 5) {
    return "amostra-baixa";
  }

  return "equilibrado";
}

function resolveMostDangerousHour(matches: AnalyticsMatch[], playerName: string) {
  const grouped = matches.reduce<Map<number, { totalGames: number; losses: number }>>((map, match) => {
    if (match.hour === null) {
      return map;
    }

    const current = map.get(match.hour) ?? { totalGames: 0, losses: 0 };
    current.totalGames += 1;
    current.losses += getPlayerResultCode(match, playerName) === "L" ? 1 : 0;
    map.set(match.hour, current);
    return map;
  }, new Map());

  return Array.from(grouped.entries()).reduce<number | null>((bestHour, [hour, data]) => {
    if (bestHour === null) {
      return hour;
    }

    const currentBest = grouped.get(bestHour);
    if (!currentBest) {
      return hour;
    }

    const currentLossRate = data.totalGames ? data.losses / data.totalGames : 0;
    const bestLossRate = currentBest.totalGames ? currentBest.losses / currentBest.totalGames : 0;

    if (currentLossRate !== bestLossRate) {
      return currentLossRate > bestLossRate ? hour : bestHour;
    }

    return data.losses > currentBest.losses ? hour : bestHour;
  }, null);
}

function resolveMostDangerousLeague(matches: AnalyticsMatch[], playerName: string) {
  const grouped = matches.reduce<Map<AnalyticsLeagueType, { totalGames: number; losses: number }>>((map, match) => {
    const current = map.get(match.leagueType) ?? { totalGames: 0, losses: 0 };
    current.totalGames += 1;
    current.losses += getPlayerResultCode(match, playerName) === "L" ? 1 : 0;
    map.set(match.leagueType, current);
    return map;
  }, new Map());

  return Array.from(grouped.entries()).reduce<AnalyticsLeagueType | null>((bestLeague, [league, data]) => {
    if (!bestLeague) {
      return league;
    }

    const currentBest = grouped.get(bestLeague);
    if (!currentBest) {
      return league;
    }

    const currentLossRate = data.totalGames ? data.losses / data.totalGames : 0;
    const bestLossRate = currentBest.totalGames ? currentBest.losses / currentBest.totalGames : 0;

    if (currentLossRate !== bestLossRate) {
      return currentLossRate > bestLossRate ? league : bestLeague;
    }

    return data.losses > currentBest.losses ? league : bestLeague;
  }, null);
}