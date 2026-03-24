import { getPlayerResultCode, roundAnalytics } from "./normalizers";
import type { AnalyticsMatch, MatchResultCode, ResultStreak, StreakMetrics } from "./types";

export function buildResultSequence(matches: AnalyticsMatch[], playerName: string): MatchResultCode[] {
  return [...matches]
    .sort((left, right) => left.playedAt.getTime() - right.playedAt.getTime())
    .filter((match) => match.normalizedHomePlayer === playerName.toUpperCase().trim() || match.normalizedAwayPlayer === playerName.toUpperCase().trim())
    .map((match) => getPlayerResultCode(match, playerName));
}

export function buildStreakMetrics(matches: AnalyticsMatch[], playerName: string): StreakMetrics {
  const results = buildResultSequence(matches, playerName);
  const wins = results.filter((result) => result === "W").length;
  const draws = results.filter((result) => result === "D").length;
  const losses = results.filter((result) => result === "L").length;
  const totalGames = results.length;

  return {
    totalGames,
    wins,
    draws,
    losses,
    winRate: totalGames ? roundAnalytics((wins / totalGames) * 100) : 0,
    lossRate: totalGames ? roundAnalytics((losses / totalGames) * 100) : 0,
    drawRate: totalGames ? roundAnalytics((draws / totalGames) * 100) : 0,
    balance: wins - losses,
    longestWinStreak: getLongestPureStreak(results, "W"),
    longestLossStreak: getLongestPureStreak(results, "L"),
    longestNoWinStreak: getLongestNoWinStreak(results),
    averageWinStreak: getAveragePureRunLength(results, "W"),
    averageLossStreak: getAveragePureRunLength(results, "L"),
    currentStreak: getCurrentStreak(results),
    currentNoWinStreak: getCurrentNoWinStreak(results),
    recoveryRateAfterLoss: getRecoveryRateAfterLoss(results),
    winAfterLossRate: getTransitionRate(results, "L", "W"),
    lossAfterWinRate: getTransitionRate(results, "W", "L"),
    bestRecoveryRun: getBestRecoveryRun(results),
  };
}

export function getLongestPureStreak(results: MatchResultCode[], target: Extract<MatchResultCode, "W" | "L">) {
  let longest = 0;
  let current = 0;

  for (const result of results) {
    current = result === target ? current + 1 : 0;
    longest = Math.max(longest, current);
  }

  return longest;
}

export function getLongestNoWinStreak(results: MatchResultCode[]) {
  let longest = 0;
  let current = 0;

  // A regra de no-win considera L e D como continuidade e so quebra com W.
  for (const result of results) {
    current = result === "W" ? 0 : current + 1;
    longest = Math.max(longest, current);
  }

  return longest;
}

export function getAveragePureRunLength(results: MatchResultCode[], target: Extract<MatchResultCode, "W" | "L">) {
  const runs = collectPureRuns(results, target);
  if (!runs.length) {
    return 0;
  }

  return roundAnalytics(runs.reduce((sum, value) => sum + value, 0) / runs.length);
}

export function getCurrentStreak(results: MatchResultCode[]): ResultStreak | null {
  const latest = results.at(-1);
  if (!latest) {
    return null;
  }

  let count = 0;
  for (let index = results.length - 1; index >= 0; index -= 1) {
    if (results[index] !== latest) {
      break;
    }

    count += 1;
  }

  return { type: latest, count };
}

export function getCurrentNoWinStreak(results: MatchResultCode[]) {
  let count = 0;

  for (let index = results.length - 1; index >= 0; index -= 1) {
    if (results[index] === "W") {
      break;
    }

    count += 1;
  }

  return count;
}

export function getTransitionRate(results: MatchResultCode[], from: MatchResultCode, to: MatchResultCode) {
  let samples = 0;
  let hits = 0;

  for (let index = 0; index < results.length - 1; index += 1) {
    if (results[index] !== from) {
      continue;
    }

    samples += 1;
    if (results[index + 1] === to) {
      hits += 1;
    }
  }

  return samples ? roundAnalytics((hits / samples) * 100) : 0;
}

export function getRecoveryRateAfterLoss(results: MatchResultCode[]) {
  let samples = 0;
  let recoveries = 0;

  for (let index = 0; index < results.length - 1; index += 1) {
    if (results[index] !== "L") {
      continue;
    }

    samples += 1;
    if (results[index + 1] !== "L") {
      recoveries += 1;
    }
  }

  return samples ? roundAnalytics((recoveries / samples) * 100) : 0;
}

export function getBestRecoveryRun(results: MatchResultCode[]) {
  let best = 0;
  let index = 1;

  while (index < results.length) {
    if (results[index - 1] !== "L" || results[index] !== "W") {
      index += 1;
      continue;
    }

    let run = 0;
    while (index < results.length && results[index] === "W") {
      run += 1;
      index += 1;
    }

    best = Math.max(best, run);
  }

  return best;
}

function collectPureRuns(results: MatchResultCode[], target: Extract<MatchResultCode, "W" | "L">) {
  const runs: number[] = [];
  let current = 0;

  for (const result of results) {
    if (result === target) {
      current += 1;
      continue;
    }

    if (current > 0) {
      runs.push(current);
      current = 0;
    }
  }

  if (current > 0) {
    runs.push(current);
  }

  return runs;
}