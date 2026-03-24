import { getPlayerResultCode, getResultNumericScore, roundAnalytics } from "./normalizers";
import type { AnalyticsMatch, MatchResultCode, SequenceWindowSummary, WindowAnalytics } from "./types";

const DEFAULT_WINDOW_SIZES = [5, 10, 15] as const;

export function buildWindowAnalytics(matches: AnalyticsMatch[], playerName: string, sizes: number[] = [...DEFAULT_WINDOW_SIZES]): WindowAnalytics[] {
  const playerMatches = [...matches]
    .filter((match) => match.normalizedHomePlayer === playerName.toUpperCase().trim() || match.normalizedAwayPlayer === playerName.toUpperCase().trim())
    .sort((left, right) => left.playedAt.getTime() - right.playedAt.getTime());

  return sizes.map((size) => {
    const summaries = buildSlidingWindowSummaries(playerMatches, playerName, size);

    return {
      size,
      totalWindows: summaries.length,
      worstWindow: summaries.reduce<SequenceWindowSummary | null>((current, candidate) => {
        if (!current) {
          return candidate;
        }

        return compareWorstWindow(candidate, current) < 0 ? candidate : current;
      }, null),
      bestWindow: summaries.reduce<SequenceWindowSummary | null>((current, candidate) => {
        if (!current) {
          return candidate;
        }

        return compareBestWindow(candidate, current) < 0 ? candidate : current;
      }, null),
    };
  });
}

export function buildSlidingWindowSummaries(matches: AnalyticsMatch[], playerName: string, size: number) {
  if (size <= 0 || matches.length < size) {
    return [];
  }

  const summaries: SequenceWindowSummary[] = [];

  for (let start = 0; start <= matches.length - size; start += 1) {
    const windowMatches = matches.slice(start, start + size);
    const sequence = windowMatches.map((match) => getPlayerResultCode(match, playerName));
    summaries.push(summarizeWindow(windowMatches, sequence, size));
  }

  return summaries;
}

function summarizeWindow(windowMatches: AnalyticsMatch[], sequence: MatchResultCode[], size: number): SequenceWindowSummary {
  const wins = sequence.filter((result) => result === "W").length;
  const draws = sequence.filter((result) => result === "D").length;
  const losses = sequence.filter((result) => result === "L").length;
  const score = roundAnalytics(sequence.reduce((sum, result) => sum + getResultNumericScore(result), 0));

  return {
    size,
    startMatchId: windowMatches[0]?.id ?? "",
    endMatchId: windowMatches.at(-1)?.id ?? "",
    startAt: windowMatches[0]?.playedAt.toISOString() ?? "",
    endAt: windowMatches.at(-1)?.playedAt.toISOString() ?? "",
    wins,
    draws,
    losses,
    winRate: size ? roundAnalytics((wins / size) * 100) : 0,
    lossRate: size ? roundAnalytics((losses / size) * 100) : 0,
    score,
    sequence,
  };
}

function compareWorstWindow(left: SequenceWindowSummary, right: SequenceWindowSummary) {
  if (left.score !== right.score) {
    return left.score - right.score;
  }

  if (left.losses !== right.losses) {
    return right.losses - left.losses;
  }

  return right.endAt.localeCompare(left.endAt);
}

function compareBestWindow(left: SequenceWindowSummary, right: SequenceWindowSummary) {
  if (left.score !== right.score) {
    return right.score - left.score;
  }

  if (left.wins !== right.wins) {
    return right.wins - left.wins;
  }

  return right.endAt.localeCompare(left.endAt);
}