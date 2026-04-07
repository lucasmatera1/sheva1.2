import cors from "cors";
import express from "express";
import { createLogger } from "./core/logger";
import { getDatabaseHealth } from "./core/database";

const log = createLogger("http-basket");
import { analyticsRouter } from "./modules/analytics/analytics.routes";
import { dashboardRouter } from "./modules/dashboard/dashboard.routes";
import { playersRouter } from "./modules/players/players.routes";
import { h2hRouter } from "./modules/h2h/h2h.routes";
import { disparityRouter } from "./modules/disparity/disparity.routes";

export const basketApp = express();

basketApp.use(cors());
basketApp.use(express.json());

basketApp.get("/api/health", (_request, response) => {
  response.json({ status: "ok", scope: "basket" });
});

basketApp.get("/api/health/db", async (_request, response, next) => {
  try {
    const database = await getDatabaseHealth();
    response.json({
      status:
        database.connected || database.mode === "mock" ? "ok" : "degraded",
      database,
      scope: "basket",
    });
  } catch (error) {
    next(error);
  }
});

basketApp.use("/api/dashboard", dashboardRouter);
basketApp.use("/api/analytics", analyticsRouter);
basketApp.use("/api/players", playersRouter);
basketApp.use("/api/h2h", h2hRouter);
basketApp.use("/api/disparity", disparityRouter);

basketApp.use(
  (
    error: unknown,
    _request: express.Request,
    response: express.Response,
    _next: express.NextFunction,
  ) => {
    log.error({ err: error }, "Erro interno no servidor");
    response.status(500).json({
      message: "Erro interno no servidor",
      scope: "basket",
    });
  },
);
