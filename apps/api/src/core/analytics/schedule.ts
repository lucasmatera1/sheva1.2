import { applyMinimumGames } from "./filters";
import { ANALYTICS_TIME_BUCKET_LABELS, ANALYTICS_WEEKDAY_LABELS, getHourLabel, getPlayerResultCode, roundAnalytics } from "./normalizers";
import { computeProfitabilityScore } from "./scoring";
import { getAveragePureRunLength } from "./streaks";
import type { AnalyticsMatch, ScheduleAnalytics, ScheduleHeatmapCell, TimeBucket, TimePerformanceRow } from "./types";

type ScheduleRowAccumulator = {
  label: string;
  hour?: number;
  weekday?: number;
  timeBucket?: TimeBucket;
  results: Array<"W" | "D" | "L">;
};

export function buildScheduleAnalytics(matches: AnalyticsMatch[], playerName: string, minGames = 0): ScheduleAnalytics {
  const playerMatches = [...matches]
    .filter((match) => match.normalizedHomePlayer === playerName.toUpperCase().trim() || match.normalizedAwayPlayer === playerName.toUpperCase().trim())
    .sort((left, right) => left.playedAt.getTime() - right.playedAt.getTime());

  const byHour = finalizeRows(buildGroupedRows(playerMatches, playerName, "hour"), minGames);
  const byWeekday = finalizeRows(buildGroupedRows(playerMatches, playerName, "weekday"), minGames);
  const byTimeBucket = finalizeRows(buildGroupedRows(playerMatches, playerName, "timeBucket"), minGames);
  const heatmap = buildHeatmap(playerMatches, playerName);
  const rankedHeatmap = heatmap.filter((cell) => cell.totalGames >= Math.max(minGames, 1));

  return {
    byHour,
    byWeekday,
    byTimeBucket,
    heatmap,
    bestHour: pickBestRow(byHour),
    worstHour: pickWorstRow(byHour),
    bestWeekday: pickBestRow(byWeekday),
    worstWeekday: pickWorstRow(byWeekday),
    bestTimeBucket: pickBestRow(byTimeBucket),
    worstTimeBucket: pickWorstRow(byTimeBucket),
    bestDayHour: pickBestHeatmapCell(rankedHeatmap),
    worstDayHour: pickWorstHeatmapCell(rankedHeatmap),
  };
}

function buildGroupedRows(matches: AnalyticsMatch[], playerName: string, mode: "hour" | "weekday" | "timeBucket") {
  const grouped = new Map<string, ScheduleRowAccumulator>();

  for (const match of matches) {
    const result = getPlayerResultCode(match, playerName);

    if (mode === "hour") {
      if (match.hour === null) {
        continue;
      }

      const key = String(match.hour);
      const current = grouped.get(key) ?? { label: getHourLabel(match.hour), hour: match.hour, results: [] };
      current.results.push(result);
      grouped.set(key, current);
      continue;
    }

    if (mode === "weekday") {
      if (match.weekday === null) {
        continue;
      }

      const key = String(match.weekday);
      const current = grouped.get(key) ?? { label: ANALYTICS_WEEKDAY_LABELS[match.weekday] ?? `Dia ${match.weekday}`, weekday: match.weekday, results: [] };
      current.results.push(result);
      grouped.set(key, current);
      continue;
    }

    if (!match.timeBucket) {
      continue;
    }

    const current = grouped.get(match.timeBucket) ?? { label: ANALYTICS_TIME_BUCKET_LABELS[match.timeBucket], timeBucket: match.timeBucket, results: [] };
    current.results.push(result);
    grouped.set(match.timeBucket, current);
  }

  return Array.from(grouped.entries()).map(([key, row]) => toPerformanceRow(key, row));
}

function toPerformanceRow(key: string, row: ScheduleRowAccumulator): TimePerformanceRow {
  const wins = row.results.filter((result) => result === "W").length;
  const draws = row.results.filter((result) => result === "D").length;
  const losses = row.results.filter((result) => result === "L").length;
  const totalGames = row.results.length;
  const averageWinStreak = getAveragePureRunLength(row.results, "W");
  const averageLossStreak = getAveragePureRunLength(row.results, "L");

  return {
    key,
    label: row.label,
    hour: row.hour,
    weekday: row.weekday,
    timeBucket: row.timeBucket,
    totalGames,
    wins,
    draws,
    losses,
    winRate: totalGames ? roundAnalytics((wins / totalGames) * 100) : 0,
    lossRate: totalGames ? roundAnalytics((losses / totalGames) * 100) : 0,
    drawRate: totalGames ? roundAnalytics((draws / totalGames) * 100) : 0,
    averageWinStreak,
    averageLossStreak,
    profitabilityScore: totalGames
      ? computeProfitabilityScore({
          winRate: (wins / totalGames) * 100,
          lossRate: (losses / totalGames) * 100,
          totalGames,
          averageWinStreak,
          averageLossStreak,
        })
      : null,
  };
}

function finalizeRows(rows: TimePerformanceRow[], minGames: number) {
  return applyMinimumGames(rows, minGames).sort((left, right) => {
    if (left.hour !== undefined && right.hour !== undefined) {
      return left.hour - right.hour;
    }

    if (left.weekday !== undefined && right.weekday !== undefined) {
      return left.weekday - right.weekday;
    }

    return left.label.localeCompare(right.label);
  });
}

function buildHeatmap(matches: AnalyticsMatch[], playerName: string): ScheduleHeatmapCell[] {
  const buckets = new Map<string, Array<"W" | "D" | "L">>();

  for (const match of matches) {
    if (match.hour === null || match.weekday === null) {
      continue;
    }

    const key = `${match.weekday}-${match.hour}`;
    const current = buckets.get(key) ?? [];
    current.push(getPlayerResultCode(match, playerName));
    buckets.set(key, current);
  }

  const cells: ScheduleHeatmapCell[] = [];
  for (let weekday = 0; weekday < 7; weekday += 1) {
    for (let hour = 0; hour < 24; hour += 1) {
      const results = buckets.get(`${weekday}-${hour}`) ?? [];
      const wins = results.filter((result) => result === "W").length;
      const draws = results.filter((result) => result === "D").length;
      const losses = results.filter((result) => result === "L").length;
      const totalGames = results.length;
      const averageWinStreak = getAveragePureRunLength(results, "W");
      const averageLossStreak = getAveragePureRunLength(results, "L");

      cells.push({
        weekday,
        weekdayLabel: ANALYTICS_WEEKDAY_LABELS[weekday] ?? `Dia ${weekday}`,
        hour,
        hourLabel: getHourLabel(hour),
        totalGames,
        winRate: totalGames ? roundAnalytics((wins / totalGames) * 100) : 0,
        lossRate: totalGames ? roundAnalytics((losses / totalGames) * 100) : 0,
        drawRate: totalGames ? roundAnalytics((draws / totalGames) * 100) : 0,
        profitabilityScore: totalGames
          ? computeProfitabilityScore({
              winRate: (wins / totalGames) * 100,
              lossRate: (losses / totalGames) * 100,
              totalGames,
              averageWinStreak,
              averageLossStreak,
            })
          : null,
      });
    }
  }

  return cells;
}

function pickBestRow(rows: TimePerformanceRow[]) {
  return rows.reduce<TimePerformanceRow | null>((best, row) => {
    if (!best) {
      return row;
    }

    if (row.winRate !== best.winRate) {
      return row.winRate > best.winRate ? row : best;
    }

    if (row.totalGames !== best.totalGames) {
      return row.totalGames > best.totalGames ? row : best;
    }

    return best;
  }, null);
}

function pickWorstRow(rows: TimePerformanceRow[]) {
  return rows.reduce<TimePerformanceRow | null>((worst, row) => {
    if (!worst) {
      return row;
    }

    if (row.winRate !== worst.winRate) {
      return row.winRate < worst.winRate ? row : worst;
    }

    if (row.totalGames !== worst.totalGames) {
      return row.totalGames > worst.totalGames ? row : worst;
    }

    return worst;
  }, null);
}

function pickBestHeatmapCell(cells: ScheduleHeatmapCell[]) {
  return cells.reduce<ScheduleHeatmapCell | null>((best, cell) => {
    if (!best) {
      return cell;
    }

    const cellScore = cell.profitabilityScore ?? -1;
    const bestScore = best.profitabilityScore ?? -1;

    if (cellScore !== bestScore) {
      return cellScore > bestScore ? cell : best;
    }

    if (cell.winRate !== best.winRate) {
      return cell.winRate > best.winRate ? cell : best;
    }

    return cell.totalGames > best.totalGames ? cell : best;
  }, null);
}

function pickWorstHeatmapCell(cells: ScheduleHeatmapCell[]) {
  return cells.reduce<ScheduleHeatmapCell | null>((worst, cell) => {
    if (!worst) {
      return cell;
    }

    const cellScore = cell.profitabilityScore ?? 101;
    const worstScore = worst.profitabilityScore ?? 101;

    if (cellScore !== worstScore) {
      return cellScore < worstScore ? cell : worst;
    }

    if (cell.lossRate !== worst.lossRate) {
      return cell.lossRate > worst.lossRate ? cell : worst;
    }

    return cell.totalGames > worst.totalGames ? cell : worst;
  }, null);
}