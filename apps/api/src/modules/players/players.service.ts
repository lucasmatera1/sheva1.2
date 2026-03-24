import { getPlayerMethodAuditLive, getPlayerStatsLive, getPlayersDashboardLive, getPlayersMethodDashboardLive, getPlayersSearchLive } from "../../core/live-analytics";

export class PlayersService {
  async getDashboardRows(filters?: {
    query?: string;
    limit?: number;
    minGames?: number;
    leagueType?: "GT LEAGUE" | "8MIN BATTLE" | "H2H" | "6MIN VOLTA";
  }) {
    return getPlayersDashboardLive(filters);
  }

  async getMethodDashboardRows(filters?: {
    query?: string;
    limit?: number;
    minGames?: number;
    leagueType?: "GT LEAGUE" | "8MIN BATTLE" | "H2H" | "6MIN VOLTA";
  }) {
    return getPlayersMethodDashboardLive(filters);
  }

  async getMethodAudit(filters: {
    playerName: string;
    leagueType?: "GT LEAGUE" | "8MIN BATTLE" | "H2H" | "6MIN VOLTA";
    startDayKey?: string;
    endDayKey?: string;
  }) {
    return getPlayerMethodAuditLive(filters);
  }

  async listPlayers(filters?: {
    query?: string;
    limit?: number;
    minGames?: number;
    activeWithinDays?: number;
    leagueType?: "GT LEAGUE" | "8MIN BATTLE" | "H2H" | "6MIN VOLTA";
    sortBy?: "winRateDesc" | "winRateAsc" | "maxWinStreak" | "maxLossStreak" | "winRate" | "profit" | "games" | "goalsFor";
  }) {
    return getPlayersSearchLive(filters);
  }

  async getPlayerStats(playerId: string, leagueType?: "GT LEAGUE" | "8MIN BATTLE" | "H2H" | "6MIN VOLTA") {
    return getPlayerStatsLive(decodeURIComponent(playerId), leagueType);
  }
}