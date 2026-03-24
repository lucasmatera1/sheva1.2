import { Router } from "express";
import { DashboardService } from "./dashboard.service";

type DashboardLeagueType = "GT LEAGUE" | "8MIN BATTLE" | "H2H" | "6MIN VOLTA";
type DashboardSnapshotLeagueType = "GT LEAGUE" | "8MIN BATTLE" | "6MIN VOLTA";

const router = Router();
const service = new DashboardService();
const ALLOWED_WINDOWS = new Set([7, 15, 30, 45, 60]);
const ALLOWED_LEAGUES = new Set<DashboardLeagueType>(["GT LEAGUE", "8MIN BATTLE", "H2H", "6MIN VOLTA"]);
const ALLOWED_SNAPSHOT_LEAGUES = new Set<DashboardSnapshotLeagueType>(["GT LEAGUE", "8MIN BATTLE", "6MIN VOLTA"]);

router.get("/overview", async (request, response, next) => {
  try {
    const rawDays = request.query.days ? Number(request.query.days) : undefined;
    const days = rawDays && ALLOWED_WINDOWS.has(rawDays) ? rawDays : undefined;
    const rawLeague = typeof request.query.league === "string" ? request.query.league : undefined;
    const leagueType = rawLeague && ALLOWED_LEAGUES.has(rawLeague as DashboardLeagueType) ? (rawLeague as DashboardLeagueType) : undefined;
    const overview = await service.getOverview(days, leagueType);
    response.json(overview);
  } catch (error) {
    next(error);
  }
});

router.get("/upcoming-fixtures", async (request, response, next) => {
  try {
    const rawLimit = request.query.limit ? Number(request.query.limit) : undefined;
    response.json(await service.getUpcomingFixtures(rawLimit));
  } catch (error) {
    next(error);
  }
});

router.post("/current-j/refresh", async (request, response, next) => {
  try {
    const rawLeague = typeof request.query.league === "string" ? request.query.league : undefined;
    const leagueType = rawLeague && ALLOWED_SNAPSHOT_LEAGUES.has(rawLeague as DashboardSnapshotLeagueType) ? (rawLeague as DashboardSnapshotLeagueType) : null;
    const rawDayKey = typeof request.query.day === "string" ? request.query.day : undefined;
    const dayKey = rawDayKey && /^\d{4}-\d{2}-\d{2}$/.test(rawDayKey) ? rawDayKey : undefined;

    if (!leagueType) {
      response.status(400).json({ message: "league invalida" });
      return;
    }

    const started = service.triggerCurrentLeagueSnapshotRefresh(leagueType, { dayKey });
    response.status(started ? 202 : 200).json({ accepted: true, started });
  } catch (error) {
    next(error);
  }
});

router.get("/current-j", async (request, response, next) => {
  try {
    const rawLeague = typeof request.query.league === "string" ? request.query.league : undefined;
    const leagueType = rawLeague && ALLOWED_SNAPSHOT_LEAGUES.has(rawLeague as DashboardSnapshotLeagueType) ? (rawLeague as DashboardSnapshotLeagueType) : null;
    const forceRefresh = request.query.refresh === "1";
    const rawDayKey = typeof request.query.day === "string" ? request.query.day : undefined;
    const dayKey = rawDayKey && /^\d{4}-\d{2}-\d{2}$/.test(rawDayKey) ? rawDayKey : undefined;

    if (!leagueType) {
      response.status(400).json({ message: "league invalida" });
      return;
    }

    response.json(await service.getCurrentLeagueSnapshot(leagueType, { forceRefresh, dayKey }));
  } catch (error) {
    next(error);
  }
});

router.get("/confrontation-history", async (request, response, next) => {
  try {
    const rawLeague = typeof request.query.league === "string" ? request.query.league : undefined;
    const leagueType = rawLeague && ALLOWED_SNAPSHOT_LEAGUES.has(rawLeague as DashboardSnapshotLeagueType) ? (rawLeague as DashboardSnapshotLeagueType) : null;
    const playerName = typeof request.query.player === "string" ? request.query.player : null;
    const opponentName = typeof request.query.opponent === "string" ? request.query.opponent : null;

    if (!leagueType || !playerName || !opponentName) {
      response.status(400).json({ message: "league, player e opponent sao obrigatorios" });
      return;
    }

    response.json(await service.getConfrontationHistory(leagueType, playerName, opponentName));
  } catch (error) {
    next(error);
  }
});

router.get("/player-previous-windows", async (request, response, next) => {
  try {
    const rawLeague = typeof request.query.league === "string" ? request.query.league : undefined;
    const leagueType = rawLeague && ALLOWED_SNAPSHOT_LEAGUES.has(rawLeague as DashboardSnapshotLeagueType) ? (rawLeague as DashboardSnapshotLeagueType) : null;
    const playerName = typeof request.query.player === "string" ? request.query.player : null;

    if (!leagueType || !playerName) {
      response.status(400).json({ message: "league e player sao obrigatorios" });
      return;
    }

    response.json(await service.getPlayerPreviousWindows(leagueType, playerName));
  } catch (error) {
    next(error);
  }
});

export { router as dashboardRouter };