import { Router } from "express";
import { getH2HStatsLive } from "../../core/live-analytics";

const router = Router();
const ALLOWED_LEAGUES = new Set(["GT LEAGUE", "8MIN BATTLE", "6MIN VOLTA", "H2H"] as const);

router.get("/", async (request, response, next) => {
  try {
    const { playerAId, playerBId, leagueType } = request.query as {
      playerAId?: string;
      playerBId?: string;
      leagueType?: string;
    };

    if (!playerAId || !playerBId) {
      response.status(400).json({ message: "playerAId e playerBId sao obrigatorios" });
      return;
    }

    const selectedLeague = typeof leagueType === "string" && ALLOWED_LEAGUES.has(leagueType as (typeof ALLOWED_LEAGUES extends Set<infer T> ? T : never))
      ? (leagueType as "GT LEAGUE" | "8MIN BATTLE" | "6MIN VOLTA" | "H2H")
      : undefined;

    response.json(await getH2HStatsLive(String(playerAId), String(playerBId), selectedLeague));
  } catch (error) {
    next(error);
  }
});

export { router as h2hRouter };