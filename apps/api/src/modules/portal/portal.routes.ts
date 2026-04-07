import { Router } from "express";
import {
  getPortalGTLiveTableFresh,
  triggerPortalGTLiveTableRefresh,
} from "./portal-gt-live-table.service";
import { getPortalLiveFeed } from "./portal-live-feed.service";
import { getGtSeriesHealthLive } from "../../core/live-analytics";
import {
  listPortalMethodCatalog,
  listPortalMethodOccurrences,
  syncPortalMethodOccurrences,
} from "./portal-method-occurrences.service";

const router = Router();

router.get("/live-feed", async (request, response, next) => {
  try {
    const toArray = (value: unknown) =>
      Array.isArray(value)
        ? value.filter((item): item is string => typeof item === "string")
        : typeof value === "string"
          ? [value]
          : [];

    const feed = await getPortalLiveFeed({
      leagueTypes: toArray(request.query.leagueType),
    });

    if (!feed) {
      response.status(503).json({
        generatedAt: new Date().toISOString(),
        source: "stale",
        rows: [],
        buildMs: 0,
        warning: "Live-feed ainda nao esta pronto.",
      });
      return;
    }

    response.json(feed);
  } catch (error) {
    next(error);
  }
});

router.get("/gt-live-table", async (request, response, next) => {
  try {
    const historyDays =
      typeof request.query.historyDays === "string"
        ? Number.parseInt(request.query.historyDays, 10)
        : Number.NaN;

    const snapshot = await getPortalGTLiveTableFresh({
      historyDays: Number.isFinite(historyDays) ? historyDays : undefined,
    });
    response.json(snapshot);
  } catch (error) {
    next(error);
  }
});

router.get("/gt-series-health", async (_request, response, next) => {
  try {
    response.json(await getGtSeriesHealthLive());
  } catch (error) {
    next(error);
  }
});

router.get("/method-catalog", async (request, response, next) => {
  try {
    const leagueType =
      typeof request.query.leagueType === "string"
        ? request.query.leagueType
        : undefined;

    response.json({
      generatedAt: new Date().toISOString(),
      rows: await listPortalMethodCatalog(leagueType),
    });
  } catch (error) {
    next(error);
  }
});

router.get("/method-occurrences", async (request, response, next) => {
  try {
    const leagueType =
      typeof request.query.leagueType === "string"
        ? request.query.leagueType
        : "";
    const dayCountRaw =
      typeof request.query.dayCount === "string"
        ? Number.parseInt(request.query.dayCount, 10)
        : Number.NaN;
    const toArray = (value: unknown) =>
      Array.isArray(value)
        ? value.filter((item): item is string => typeof item === "string")
        : typeof value === "string"
          ? [value]
          : [];

    if (!leagueType) {
      response.status(400).json({
        message: "leagueType e obrigatorio",
      });
      return;
    }

    response.json(
      await listPortalMethodOccurrences({
        leagueType,
        dayCount:
          Number.isFinite(dayCountRaw) && dayCountRaw > 0
            ? dayCountRaw
            : undefined,
        series: toArray(request.query.series),
        methodCodes: toArray(request.query.methodCode),
      }),
    );
  } catch (error) {
    next(error);
  }
});

router.post("/method-occurrences/refresh", async (request, response, next) => {
  try {
    const leagueType =
      typeof request.query.leagueType === "string"
        ? request.query.leagueType
        : "GT LEAGUE";

    await syncPortalMethodOccurrences();

    response.json(
      await listPortalMethodOccurrences({
        leagueType,
        dayCount: 30,
      }),
    );
  } catch (error) {
    next(error);
  }
});

export { router as portalRouter };
