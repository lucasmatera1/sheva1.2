import cors from "cors";
import express from "express";
import { createLogger } from "./core/logger";
import { getDatabaseHealth } from "./core/database";

const log = createLogger("http");
import { analyticsRouter } from "./modules/analytics/analytics.routes";
import { dashboardRouter } from "./modules/dashboard/dashboard.routes";
import { playersRouter } from "./modules/players/players.routes";
import { leaguesRouter } from "./modules/leagues/leagues.routes";
import { h2hRouter } from "./modules/h2h/h2h.routes";
import { methodsRouter } from "./modules/methods/methods.routes";
import { alertsRouter } from "./modules/alerts/alerts.routes";
import { backtestRouter } from "./modules/backtest/backtest.routes";
import { disparityRouter } from "./modules/disparity/disparity.routes";
import { sourceRouter } from "./modules/source/source.routes";
import { portalRouter } from "./modules/portal/portal.routes";

export const app = express();

app.use(cors());
app.use(express.json());

// Request logging middleware
app.use((req, res, next) => {
  const start = Date.now();
  res.on("finish", () => {
    const ms = Date.now() - start;
    if (req.path === "/api/health") return;
    log.info(
      { method: req.method, url: req.originalUrl, status: res.statusCode, ms },
      "request",
    );
  });
  next();
});

app.get("/api/health", (_request, response) => {
  response.json({ status: "ok" });
});

app.get("/api/health/db", async (_request, response, next) => {
  try {
    const database = await getDatabaseHealth();
    response.json({
      status:
        database.connected || database.mode === "mock" ? "ok" : "degraded",
      database,
    });
  } catch (error) {
    next(error);
  }
});

app.use("/api/dashboard", dashboardRouter);
app.use("/api/analytics", analyticsRouter);
app.use("/api/players", playersRouter);
app.use("/api/leagues", leaguesRouter);
app.use("/api/h2h", h2hRouter);
app.use("/api/methods", methodsRouter);
app.use("/api/alerts", alertsRouter);
app.use("/api/backtest", backtestRouter);
app.use("/api/disparity", disparityRouter);
app.use("/api/source", sourceRouter);
app.use("/api/portal", portalRouter);

app.use(
  (
    error: unknown,
    _request: express.Request,
    response: express.Response,
    _next: express.NextFunction,
  ) => {
    log.error({ err: error }, "Erro interno no servidor");
    response.status(500).json({
      message: "Erro interno no servidor",
    });
  },
);
