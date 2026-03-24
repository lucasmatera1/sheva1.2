import { getPlayerOpponentName, getPlayerResultCode, roundAnalytics } from "./normalizers";
import { computeTiltScore, getTiltLevel } from "./scoring";
import type { AnalyticsLeagueType, AnalyticsMatch, BankrollAnalytics, TiltAnalytics, TiltEpisode } from "./types";

export function buildTiltAnalytics(matches: AnalyticsMatch[], playerName: string, bankroll?: BankrollAnalytics): TiltAnalytics {
  const playerMatches = [...matches]
    .filter((match) => match.normalizedHomePlayer === playerName.toUpperCase().trim() || match.normalizedAwayPlayer === playerName.toUpperCase().trim())
    .sort((left, right) => left.playedAt.getTime() - right.playedAt.getTime());
  const episodes = detectTiltEpisodes(playerMatches, playerName, bankroll);
  const currentTilt = episodes.at(-1) ?? null;
  const tiltScore = currentTilt?.tiltScore ?? 0;
  const tiltLevel = currentTilt?.tiltLevel ?? "none";

  return {
    currentTilt,
    episodes,
    tiltScore,
    tiltLevel,
    frequentTiltHours: getFrequentTiltHours(playerMatches, episodes),
    frequentTiltLeagues: getFrequentTiltLeagues(episodes),
    alerts: buildTiltAlerts(episodes),
  };
}

export function detectTiltEpisodes(matches: AnalyticsMatch[], playerName: string, bankroll?: BankrollAnalytics): TiltEpisode[] {
  const episodes: TiltEpisode[] = [];
  let blockStart = 0;

  for (let index = 0; index <= matches.length; index += 1) {
    const result = index < matches.length ? getPlayerResultCode(matches[index], playerName) : "W";

    if (index < matches.length && result !== "W") {
      continue;
    }

    const blockMatches = matches.slice(blockStart, index);
    blockStart = index + 1;

    if (!blockMatches.length) {
      continue;
    }

    const blockResults = blockMatches.map((match) => getPlayerResultCode(match, playerName));
    const lossesInRow = getBlockMaxLossStreak(blockResults);
    const noWinStreak = blockResults.length;

    if (lossesInRow < 2 && noWinStreak < 3) {
      continue;
    }

    const recentContext = matches.slice(Math.max(0, index - 10), index);
    const recentResults = recentContext.map((match) => getPlayerResultCode(match, playerName));
    const recentWins = recentResults.filter((value) => value === "W").length;
    const recentWinRate = recentResults.length ? roundAnalytics((recentWins / recentResults.length) * 100) : 0;
    const startedAt = blockMatches[0].playedAt.toISOString();
    const endedAt = blockMatches.at(-1)?.playedAt.toISOString() ?? startedAt;
    const durationMinutes = blockMatches.length > 1 ? roundAnalytics((blockMatches.at(-1)!.playedAt.getTime() - blockMatches[0].playedAt.getTime()) / 60000) : 0;
    const drawdownForBlock = bankroll ? getBlockMaxDrawdown(bankroll, startedAt, endedAt) : 0;
    const tiltScore = computeTiltScore({
      lossesInRow,
      noWinStreak,
      recentWinRate,
      durationMatches: blockMatches.length,
      maxDrawdown: drawdownForBlock,
    });

    episodes.push({
      startedAt,
      endedAt,
      durationMatches: blockMatches.length,
      durationMinutes,
      lossesInRow,
      noWinStreak,
      recentWinRate,
      leagues: [...new Set(blockMatches.map((match) => match.leagueType))],
      opponents: [...new Set(blockMatches.map((match) => getPlayerOpponentName(match, playerName)))],
      tiltScore,
      tiltLevel: getTiltLevel(tiltScore),
    });
  }

  return episodes;
}

function getBlockMaxLossStreak(results: Array<"W" | "D" | "L">) {
  let longest = 0;
  let current = 0;

  for (const result of results) {
    current = result === "L" ? current + 1 : 0;
    longest = Math.max(longest, current);
  }

  return longest;
}

function getFrequentTiltHours(matches: AnalyticsMatch[], episodes: TiltEpisode[]) {
  const counts = new Map<number, number>();

  for (const episode of episodes) {
    const startedAt = new Date(episode.startedAt).getTime();
    const match = matches.find((item) => item.playedAt.getTime() === startedAt);
    if (match?.hour === null || match?.hour === undefined) {
      continue;
    }

    counts.set(match.hour, (counts.get(match.hour) ?? 0) + 1);
  }

  return Array.from(counts.entries())
    .sort((left, right) => right[1] - left[1])
    .slice(0, 3)
    .map(([hour]) => hour);
}

function getFrequentTiltLeagues(episodes: TiltEpisode[]) {
  const counts = new Map<AnalyticsLeagueType, number>();

  for (const episode of episodes) {
    for (const league of episode.leagues) {
      counts.set(league, (counts.get(league) ?? 0) + 1);
    }
  }

  return Array.from(counts.entries())
    .sort((left, right) => right[1] - left[1])
    .slice(0, 3)
    .map(([league]) => league);
}

function buildTiltAlerts(episodes: TiltEpisode[]) {
  if (!episodes.length) {
    return [];
  }

  const alerts: string[] = [];
  const severeEpisodes = episodes.filter((episode) => episode.tiltLevel === "severo");
  const moderateEpisodes = episodes.filter((episode) => episode.tiltLevel === "moderado");

  if (severeEpisodes.length) {
    alerts.push(`Tilt severo apareceu em ${severeEpisodes.length} bloco(s) historicos.`);
  }

  if (moderateEpisodes.length >= 2) {
    alerts.push(`Ha recorrencia de tilt moderado em ${moderateEpisodes.length} blocos.`);
  }

  const repeatedOpponents = Array.from(
    episodes.reduce<Map<string, number>>((map, episode) => {
      for (const opponent of episode.opponents) {
        map.set(opponent, (map.get(opponent) ?? 0) + 1);
      }
      return map;
    }, new Map()),
  )
    .filter(([, count]) => count >= 2)
    .sort((left, right) => right[1] - left[1]);

  if (repeatedOpponents[0]) {
    alerts.push(`Tilt aparece repetidamente contra ${repeatedOpponents[0][0]}.`);
  }

  return alerts;
}

function getBlockMaxDrawdown(bankroll: BankrollAnalytics, startedAt: string, endedAt: string) {
  return bankroll.timeline
    .filter((point) => point.playedAt >= startedAt && point.playedAt <= endedAt)
    .reduce((maxDrawdown, point) => Math.max(maxDrawdown, point.drawdown), 0);
}