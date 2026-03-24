import { applyAnalyticsFilters } from "./filters";
import { buildSimulatedBankrollAnalytics } from "./bankroll";
import { buildOpponentAnalytics } from "./h2h";
import { buildRiskAnalytics } from "./risk";
import { buildScheduleAnalytics } from "./schedule";
import { buildStreakMetrics } from "./streaks";
import { buildTiltAnalytics } from "./tilt";
import { buildWindowAnalytics } from "./windows";
import type { AnalyticsFilters, AnalyticsMatch, BankrollConfig, BaseAnalyticsOverview } from "./types";

export function buildBaseAnalyticsOverview(
  matches: AnalyticsMatch[],
  filters: AnalyticsFilters,
  options?: {
    bankrollConfig?: BankrollConfig;
    windowSizes?: number[];
  },
): BaseAnalyticsOverview | null {
  if (!filters.playerName) {
    return null;
  }

  const filteredMatches = applyAnalyticsFilters(matches, filters);
  const bankroll = buildSimulatedBankrollAnalytics(filteredMatches, filters.playerName, options?.bankrollConfig ?? { mode: "simulated" });
  const tilt = buildTiltAnalytics(filteredMatches, filters.playerName, bankroll);
  const risk = buildRiskAnalytics(filteredMatches, filters.playerName, bankroll);

  return {
    playerName: filters.playerName,
    totalMatches: filteredMatches.length,
    streaks: buildStreakMetrics(filteredMatches, filters.playerName),
    windows: buildWindowAnalytics(filteredMatches, filters.playerName, options?.windowSizes),
    schedule: buildScheduleAnalytics(filteredMatches, filters.playerName, filters.minGames),
    opponents: buildOpponentAnalytics(filteredMatches, filters.playerName, filters.minGames),
    bankroll,
    tilt,
    risk,
  };
}