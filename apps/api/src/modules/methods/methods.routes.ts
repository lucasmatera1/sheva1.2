import { Router } from "express";
import { z } from "zod";
import { MethodsService } from "./methods.service";

const router = Router();
const service = new MethodsService();
const ALLOWED_CONFRONTATION_LEAGUES = new Set(["GT LEAGUE", "8MIN BATTLE", "6MIN VOLTA"] as const);
const ALLOWED_CONFRONTATION_METHODS = new Set([
  "T+",
  "E",
  "(2E)",
  "(2D)",
  "(2D+)",
  "(3D)",
  "(3D+)",
  "(4D)",
  "(4D+)",
  "HC-2",
  "HC-3",
  "HC-4",
  "HC-5",
] as const);
const ALLOWED_CONFRONTATION_SERIES = new Set(["A", "B", "C", "D", "E", "F", "G"] as const);
const ALLOWED_CONFRONTATION_DAYS = new Set([7, 15, 21, 30, 45, 60] as const);

const evaluateSchema = z.object({
  leagueCode: z.string(),
  homePlayer: z.string(),
  awayPlayer: z.string(),
  homeRecentWinRate: z.number(),
  awayRecentWinRate: z.number(),
  homeGoalsForAverage: z.number(),
  awayGoalsForAverage: z.number(),
  homeGoalsAgainstAverage: z.number(),
  awayGoalsAgainstAverage: z.number(),
  bttsRate: z.number(),
  over25Rate: z.number(),
  homeOdd: z.number().optional(),
  awayOdd: z.number().optional(),
});

router.get("/", async (_request, response, next) => {
  try {
    response.json(await service.listMethods());
  } catch (error) {
    next(error);
  }
});

router.get("/confrontations", async (request, response, next) => {
  try {
    const rawLeagueType = typeof request.query.leagueType === "string" ? request.query.leagueType : "GT LEAGUE";
    const rawMethodCode = typeof request.query.methodCode === "string" ? request.query.methodCode : "T+";
    const rawSeries = typeof request.query.series === "string" ? request.query.series.trim().toUpperCase() : undefined;
    const includeHistory = !(request.query.includeHistory === "0" || request.query.includeHistory === "false");
    const confrontationKey = typeof request.query.confrontationKey === "string" ? request.query.confrontationKey : undefined;
    const rawDays = typeof request.query.days === "string" ? Number(request.query.days) : undefined;

    if (!ALLOWED_CONFRONTATION_LEAGUES.has(rawLeagueType as (typeof ALLOWED_CONFRONTATION_LEAGUES extends Set<infer T> ? T : never))) {
      response.status(400).json({ message: "leagueType invalida" });
      return;
    }

    if (!ALLOWED_CONFRONTATION_METHODS.has(rawMethodCode as (typeof ALLOWED_CONFRONTATION_METHODS extends Set<infer T> ? T : never))) {
      response.status(400).json({ message: "methodCode invalido" });
      return;
    }

    if (
      rawSeries &&
      !ALLOWED_CONFRONTATION_SERIES.has(rawSeries as (typeof ALLOWED_CONFRONTATION_SERIES extends Set<infer T> ? T : never))
    ) {
      response.status(400).json({ message: "series invalida" });
      return;
    }

    if (
      rawDays !== undefined &&
      (!Number.isFinite(rawDays) || !ALLOWED_CONFRONTATION_DAYS.has(rawDays as (typeof ALLOWED_CONFRONTATION_DAYS extends Set<infer T> ? T : never)))
    ) {
      response.status(400).json({ message: "days invalido" });
      return;
    }

    response.json(
      await service.getConfrontationMethods(
        rawLeagueType as "GT LEAGUE" | "8MIN BATTLE" | "6MIN VOLTA",
        rawMethodCode as
          | "T+"
          | "E"
          | "(2E)"
          | "(2D)"
          | "(2D+)"
          | "(3D)"
          | "(3D+)"
          | "(4D)"
          | "(4D+)"
          | "HC-2"
          | "HC-3"
          | "HC-4"
          | "HC-5",
        {
          series: rawSeries as "A" | "B" | "C" | "D" | "E" | "F" | "G" | undefined,
          includeHistory,
          confrontationKey,
          days: rawDays,
        },
      ),
    );
  } catch (error) {
    next(error);
  }
});

router.get("/future-confrontations", async (request, response, next) => {
  try {
    const rawLeagueType = typeof request.query.leagueType === "string" ? request.query.leagueType : "GT LEAGUE";
    const rawMethodCode = typeof request.query.methodCode === "string" ? request.query.methodCode : undefined;
    const rawSeries = typeof request.query.series === "string" ? request.query.series.trim().toUpperCase() : undefined;
    const rawDays = typeof request.query.days === "string" ? Number(request.query.days) : undefined;
    const rawApxMin = typeof request.query.apxMin === "string" ? Number(request.query.apxMin) : undefined;
    const rawMinOccurrences = typeof request.query.minOccurrences === "string" ? Number(request.query.minOccurrences) : undefined;
    const includePlayerStats =
      request.query.includePlayerStats === undefined
        ? true
        : request.query.includePlayerStats === "1" ||
          request.query.includePlayerStats === "true";

    if (!ALLOWED_CONFRONTATION_LEAGUES.has(rawLeagueType as (typeof ALLOWED_CONFRONTATION_LEAGUES extends Set<infer T> ? T : never))) {
      response.status(400).json({ message: "leagueType invalida" });
      return;
    }

    if (
      rawMethodCode !== undefined &&
      !ALLOWED_CONFRONTATION_METHODS.has(rawMethodCode as (typeof ALLOWED_CONFRONTATION_METHODS extends Set<infer T> ? T : never))
    ) {
      response.status(400).json({ message: "methodCode invalido" });
      return;
    }

    if (
      rawSeries &&
      !ALLOWED_CONFRONTATION_SERIES.has(rawSeries as (typeof ALLOWED_CONFRONTATION_SERIES extends Set<infer T> ? T : never))
    ) {
      response.status(400).json({ message: "series invalida" });
      return;
    }

    if (
      rawDays !== undefined &&
      (!Number.isFinite(rawDays) || !ALLOWED_CONFRONTATION_DAYS.has(rawDays as (typeof ALLOWED_CONFRONTATION_DAYS extends Set<infer T> ? T : never)))
    ) {
      response.status(400).json({ message: "days invalido" });
      return;
    }

    if (rawApxMin !== undefined && (!Number.isFinite(rawApxMin) || rawApxMin < 0 || rawApxMin > 100)) {
      response.status(400).json({ message: "apxMin invalido" });
      return;
    }

    if (rawMinOccurrences !== undefined && (!Number.isInteger(rawMinOccurrences) || rawMinOccurrences < 1)) {
      response.status(400).json({ message: "minOccurrences invalido" });
      return;
    }

    response.json(
      await service.getFutureConfrontationMethods(rawLeagueType as "GT LEAGUE" | "8MIN BATTLE" | "6MIN VOLTA", {
        methodCode: rawMethodCode as
          | "T+"
          | "E"
          | "(2E)"
          | "(2D)"
          | "(2D+)"
          | "(3D)"
          | "(3D+)"
          | "(4D)"
          | "(4D+)"
          | "HC-2"
          | "HC-3"
          | "HC-4"
          | "HC-5"
          | undefined,
        series: rawSeries as "A" | "B" | "C" | "D" | "E" | "F" | "G" | undefined,
        days: rawDays,
        apxMin: rawApxMin,
        minOccurrences: rawMinOccurrences,
        includePlayerStats,
      }),
    );
  } catch (error) {
    next(error);
  }
});

router.post("/:methodId/evaluate", async (request, response, next) => {
  try {
    const context = evaluateSchema.parse(request.body);
    const result = await service.evaluate(request.params.methodId, context);

    if (!result) {
      response.status(404).json({ message: "Metodo nao encontrado" });
      return;
    }

    response.json(result);
  } catch (error) {
    next(error);
  }
});

export { router as methodsRouter };
