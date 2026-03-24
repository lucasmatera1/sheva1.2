import { Router } from "express";
import { getLeagueDetailLive, getLeagueStatsLive } from "../../core/live-analytics";
import { resolveLeagueParam } from "./league-map";

const router = Router();

function parseDaysQuery(value: unknown) {
  if (typeof value !== "string") {
    return undefined;
  }

  const parsed = Number(value);

  if (!Number.isFinite(parsed) || parsed <= 0) {
    return undefined;
  }

  return Math.floor(parsed);
}

router.get("/", async (request, response, next) => {
  try {
    const days = parseDaysQuery(request.query.days);
    response.json(await getLeagueStatsLive(days));
  } catch (error) {
    next(error);
  }
});

router.get("/:leagueId", async (request, response, next) => {
  try {
    const leagueType = resolveLeagueParam(request.params.leagueId);
    const days = parseDaysQuery(request.query.days);

    if (!leagueType) {
      response.status(404).json({ message: "Liga nao encontrada" });
      return;
    }

    const detail = await getLeagueDetailLive(leagueType, days);

    if (!detail) {
      response.status(404).json({ message: "Liga nao encontrada" });
      return;
    }

    response.json(detail);
  } catch (error) {
    next(error);
  }
});

export { router as leaguesRouter };