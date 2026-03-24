import { getPlayerResultCode, normalizeAnalyticsKey } from "./normalizers";
import type { AnalyticsFilters, AnalyticsMatch } from "./types";

export function applyAnalyticsFilters(matches: AnalyticsMatch[], filters: AnalyticsFilters = {}) {
  const playerKey = filters.playerName ? normalizeAnalyticsKey(filters.playerName) : null;
  const opponentKey = filters.opponentName ? normalizeAnalyticsKey(filters.opponentName) : null;

  return matches.filter((match) => {
    if (filters.leagueTypes?.length && !filters.leagueTypes.includes(match.leagueType)) {
      return false;
    }

    if (filters.startDate && !matchesStartAfter(match, filters.startDate)) {
      return false;
    }

    if (filters.endDate && !matchesEndBefore(match, filters.endDate)) {
      return false;
    }

    if (playerKey && match.normalizedHomePlayer !== playerKey && match.normalizedAwayPlayer !== playerKey) {
      return false;
    }

    if (opponentKey) {
      const directOpponentMatch = playerKey
        ? (match.normalizedHomePlayer === playerKey && match.normalizedAwayPlayer === opponentKey) ||
          (match.normalizedAwayPlayer === playerKey && match.normalizedHomePlayer === opponentKey)
        : match.normalizedHomePlayer === opponentKey || match.normalizedAwayPlayer === opponentKey;

      if (!directOpponentMatch) {
        return false;
      }
    }

    if (filters.hours?.length && (match.hour === null || !filters.hours.includes(match.hour))) {
      return false;
    }

    if (filters.weekdays?.length && (match.weekday === null || !filters.weekdays.includes(match.weekday))) {
      return false;
    }

    if (filters.timeBuckets?.length && (!match.timeBucket || !filters.timeBuckets.includes(match.timeBucket))) {
      return false;
    }

    if (filters.includeDraws === false) {
      if (playerKey) {
        return getPlayerResultCode(match, filters.playerName ?? "") !== "D";
      }

      return match.homeScore !== match.awayScore;
    }

    return true;
  });
}

export function applyMinimumGames<T extends { totalGames: number }>(rows: T[], minGames = 0) {
  if (!minGames || minGames <= 0) {
    return rows;
  }

  return rows.filter((row) => row.totalGames >= minGames);
}

function matchesStartAfter(match: AnalyticsMatch, startDate: string) {
  if (isDayKey(startDate)) {
    return match.dayKey >= startDate;
  }

  const parsed = Date.parse(startDate);
  return Number.isFinite(parsed) ? match.playedAt.getTime() >= parsed : true;
}

function matchesEndBefore(match: AnalyticsMatch, endDate: string) {
  if (isDayKey(endDate)) {
    return match.dayKey <= endDate;
  }

  const parsed = Date.parse(endDate);
  return Number.isFinite(parsed) ? match.playedAt.getTime() <= parsed : true;
}

function isDayKey(value: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}