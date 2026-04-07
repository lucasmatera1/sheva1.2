import {
  getGtPanoramaLive,
  getGtRaioXLive,
  getDisparityPairLive,
  getDisparityPlayerLive,
  getDisparityPlayerOptionsLive,
  getDisparityPlayersLive,
} from "../../core/live-analytics";

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

  async listPlayerOptions(mode: DisparityMode, query?: string) {
    return getDisparityPlayerOptionsLive(resolveLeagueType(mode), query);
  }

  async getPair(mode: DisparityMode, playerOne: string, playerTwo: string) {
    return getDisparityPairLive(
      resolveLeagueType(mode),
      decodeURIComponent(playerOne),
      decodeURIComponent(playerTwo),
    );
  }

  async getPanorama(mode: DisparityMode, dayKey?: string) {
    if (mode !== "GT") {
      return null;
    }

    return getGtPanoramaLive(dayKey);
  }

  async getRaioX(mode: DisparityMode) {
    if (mode !== "GT") {
      return null;
    }

    return getGtRaioXLive();
  }

  async getPlayer(
    mode: DisparityMode,
    playerId: string,
    options?: { forceRefresh?: boolean },
  ) {
    return getDisparityPlayerLive(
      resolveLeagueType(mode),
      decodeURIComponent(playerId),
      options,
    );
  }
}
