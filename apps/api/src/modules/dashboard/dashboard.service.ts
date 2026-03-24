import type { DashboardOverview } from "@sheva/shared";
import { getDashboardConfrontationHistoryLive, getDashboardLeagueCurrentJLive, getDashboardOverviewLive, getDashboardPlayerPreviousWindowsLive, getDashboardUpcomingFixturesLive } from "../../core/live-analytics";

type DashboardLeagueType = "GT LEAGUE" | "8MIN BATTLE" | "H2H" | "6MIN VOLTA";
type DashboardSnapshotLeagueType = "GT LEAGUE" | "8MIN BATTLE" | "6MIN VOLTA";
type DashboardSequenceResult = "W" | "D" | "L";

const runningSnapshotRefreshes = new Map<string, Promise<void>>();

type DashboardLeagueSnapshot = {
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
    pendingResult?: boolean;
  }>;
  players: Array<{
    id: string;
    name: string;
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
    upcomingFixtures: Array<{
      id: string;
      playedAt: string;
      homePlayer: string;
      awayPlayer: string;
      opponent: string;
      seasonId: number | null;
    }>;
    recentMatches: Array<{
      id: string;
      playedAt: string;
      homePlayer: string;
      awayPlayer: string;
      opponent: string;
      seasonId: number | null;
      result: DashboardSequenceResult;
      scoreLabel: string;
    }>;
    previousWindows: Array<{
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
      matches: Array<{
        id: string;
        playedAt: string;
        homePlayer: string;
        awayPlayer: string;
        opponent: string;
        seasonId: number | null;
        result: DashboardSequenceResult;
        scoreLabel: string;
      }>;
    }>;
  }>;
};

function buildUnavailableSnapshot(leagueType: DashboardSnapshotLeagueType, error: unknown): DashboardLeagueSnapshot {
  const now = new Date();
  const rawMessage = error instanceof Error ? error.message : "Base live indisponivel no momento.";
  const warning = rawMessage.includes("Authentication failed")
    ? "Falha de autenticacao no MySQL remoto. Revise usuario, senha e permissoes de acesso remoto."
    : "Base live indisponivel no momento.";

  return {
    generatedAt: now.toISOString(),
    leagueType,
    warning: `Nao foi possivel atualizar a base live agora. ${warning}`,
    availableDays: [
      {
        dayKey: now.toISOString().slice(0, 10),
        dayLabel: now.toLocaleDateString("pt-BR"),
      },
    ],
    currentWindow: {
      dayKey: now.toISOString().slice(0, 10),
      dayLabel: now.toLocaleDateString("pt-BR"),
      windowLabel: "Indisponivel",
      rangeLabel: "Sem dados live",
      description: "A liga nao respondeu com dados live. O painel segue acessivel, mas depende da correcao da conexao MySQL para atualizar os numeros reais.",
      usesOperationalDay: true,
    },
    totals: {
      activePlayers: 0,
      totalGames: 0,
      wins: 0,
      draws: 0,
      losses: 0,
      winRate: 0,
      totalDayMatches: 0,
      currentWindowPlayedMatches: 0,
      currentWindowUpcomingFixtures: 0,
    },
    fixtures: [],
    players: [],
  };
}

export class DashboardService {
  async getOverview(days?: number, leagueType?: DashboardLeagueType): Promise<DashboardOverview> {
    return getDashboardOverviewLive({ days, leagueType });
  }

  async getUpcomingFixtures(limit?: number) {
    return getDashboardUpcomingFixturesLive(limit);
  }

  async getCurrentLeagueSnapshot(leagueType: DashboardSnapshotLeagueType, options?: { forceRefresh?: boolean; dayKey?: string }) {
    try {
      return await getDashboardLeagueCurrentJLive(leagueType, options);
    } catch (error) {
      return buildUnavailableSnapshot(leagueType, error);
    }
  }

  async getConfrontationHistory(leagueType: DashboardSnapshotLeagueType, playerName: string, opponentName: string) {
    return getDashboardConfrontationHistoryLive(leagueType, playerName, opponentName);
  }

  async getPlayerPreviousWindows(leagueType: DashboardSnapshotLeagueType, playerName: string) {
    return getDashboardPlayerPreviousWindowsLive(leagueType, playerName);
  }

  triggerCurrentLeagueSnapshotRefresh(leagueType: DashboardSnapshotLeagueType, options?: { dayKey?: string }) {
    const refreshKey = `${leagueType}:${options?.dayKey ?? "current"}`;
    const existingRefresh = runningSnapshotRefreshes.get(refreshKey);

    if (existingRefresh) {
      return false;
    }

    const refreshTask = getDashboardLeagueCurrentJLive(leagueType, {
      forceRefresh: true,
      dayKey: options?.dayKey,
    })
      .then(() => undefined)
      .catch(() => undefined)
      .finally(() => {
        runningSnapshotRefreshes.delete(refreshKey);
      });

    runningSnapshotRefreshes.set(refreshKey, refreshTask);
    return true;
  }
}