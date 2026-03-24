import { applyAnalyticsFilters } from "./filters";
import { buildOpponentAnalytics } from "./h2h";
import { buildBaseAnalyticsOverview } from "./overview";
import { loadAnalyticsMatches } from "./repository";
import { buildRiskAnalytics } from "./risk";
import { buildScheduleAnalytics } from "./schedule";
import { computeRecoveryScore } from "./scoring";
import { buildSimulatedBankrollAnalytics } from "./bankroll";
import { buildTiltAnalytics } from "./tilt";
import type {
  AnalyticsH2HRequest,
  AnalyticsH2HResponse,
  AnalyticsOverviewRequest,
  AnalyticsOverviewResponse,
  AnalyticsResponseEnvelope,
  AnalyticsResponseMeta,
  AnalyticsRiskRequest,
  AnalyticsRiskResponse,
  AnalyticsScheduleRequest,
  AnalyticsScheduleResponse,
  AnalyticsServiceContract,
  AnalyticsTiltRequest,
  AnalyticsTiltResponse,
} from "./contracts";
import type { AnalyticsFilters, AnalyticsMatch, BankrollConfig } from "./types";

export class AnalyticsService implements AnalyticsServiceContract {
  async getOverview(request: AnalyticsOverviewRequest): Promise<AnalyticsOverviewResponse | null> {
    const matches = await loadAnalyticsMatches();
    const overview = buildBaseAnalyticsOverview(matches, request, {
      bankrollConfig: request.bankrollConfig,
      windowSizes: request.windowSizes,
    });

    if (!overview) {
      return null;
    }

    return this.wrapResponse(matches, request, {
      ...overview,
      scores: {
        recoveryScore: computeRecoveryScore({
          recoveryRateAfterLoss: overview.streaks.recoveryRateAfterLoss,
          bestRecoveryRun: overview.streaks.bestRecoveryRun,
          currentNoWinStreak: overview.streaks.currentNoWinStreak,
        }),
      },
    });
  }

  async getSchedule(request: AnalyticsScheduleRequest): Promise<AnalyticsScheduleResponse | null> {
    const matches = await loadAnalyticsMatches();
    const filteredMatches = applyAnalyticsFilters(matches, request);

    if (!request.playerName || !filteredMatches.length) {
      return null;
    }

    return this.wrapResponse(matches, request, buildScheduleAnalytics(filteredMatches, request.playerName, request.minGames));
  }

  async getTilt(request: AnalyticsTiltRequest): Promise<AnalyticsTiltResponse | null> {
    const matches = await loadAnalyticsMatches();
    const filteredMatches = applyAnalyticsFilters(matches, request);

    if (!request.playerName || !filteredMatches.length) {
      return null;
    }

    const bankroll = buildSimulatedBankrollAnalytics(filteredMatches, request.playerName, request.bankrollConfig ?? { mode: "simulated" });
    return this.wrapResponse(matches, request, buildTiltAnalytics(filteredMatches, request.playerName, bankroll));
  }

  async getH2H(request: AnalyticsH2HRequest): Promise<AnalyticsH2HResponse | null> {
    const matches = await loadAnalyticsMatches();
    const filteredMatches = applyAnalyticsFilters(matches, request);

    if (!request.playerName || !filteredMatches.length) {
      return null;
    }

    return this.wrapResponse(matches, request, buildOpponentAnalytics(filteredMatches, request.playerName, request.minGames));
  }

  async getRisk(request: AnalyticsRiskRequest): Promise<AnalyticsRiskResponse | null> {
    const matches = await loadAnalyticsMatches();
    const filteredMatches = applyAnalyticsFilters(matches, request);

    if (!request.playerName || !filteredMatches.length) {
      return null;
    }

    const bankrollConfig = request.bankrollConfig ?? { mode: "simulated" };
    const bankroll = buildSimulatedBankrollAnalytics(filteredMatches, request.playerName, bankrollConfig);

    return this.wrapResponse(matches, request, {
      risk: buildRiskAnalytics(filteredMatches, request.playerName, bankroll),
      bankrollMode: bankrollConfig.mode,
    });
  }

  private wrapResponse<TData>(matches: AnalyticsMatch[], filters: AnalyticsFilters, data: TData): AnalyticsResponseEnvelope<TData> {
    const filteredMatches = applyAnalyticsFilters(matches, filters);

    return {
      filters,
      meta: this.buildMeta(matches.length, filteredMatches.length, filters),
      data,
    };
  }

  private buildMeta(totalMatchesLoaded: number, totalMatchesFiltered: number, filters: AnalyticsFilters): AnalyticsResponseMeta {
    const notes: string[] = [];

    if (filters.onlyCompletedSessions) {
      notes.push("Filtro de sessoes completas ainda depende de integracao direta com player_daily_history_sessions.");
    }

    if (filters.includeDraws === false) {
      notes.push("Empates foram excluidos dos calculos sensiveis a sequencia e aproveitamento.");
    }

    return {
      generatedAt: new Date().toISOString(),
      totalMatchesLoaded,
      totalMatchesFiltered,
      notes,
    };
  }
}