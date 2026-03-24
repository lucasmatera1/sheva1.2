import { getDisparityPlayerLive, getDisparityPlayersLive } from "../../core/live-analytics";

type DisparityMode = "GT" | "Volta" | "Basket";

function resolveLeagueType(mode: DisparityMode) {
  if (mode === "GT") return "GT LEAGUE";
  if (mode === "Volta") return "6MIN VOLTA";
  return "H2H";
}

export class DisparityService {
  async listPlayers(mode: DisparityMode, query?: string) {
    return getDisparityPlayersLive(resolveLeagueType(mode), query);
  }

  async getPlayer(mode: DisparityMode, playerId: string, options?: { forceRefresh?: boolean }) {
    return getDisparityPlayerLive(resolveLeagueType(mode), decodeURIComponent(playerId), options);
  }
}