import { Router } from "express";

const router = Router();

router.get("/health", async (_request, response, next) => {
  try {
    const { getOdbcSourceHealth } = await import("../../core/odbc-source");
    const source = await getOdbcSourceHealth();
    response.json({ status: source.connected ? "ok" : source.configured ? "degraded" : "unconfigured", source });
  } catch (error) {
    next(error);
  }
});

router.get("/schema", async (_request, response, next) => {
  try {
    const { inspectOdbcSourceSchema } = await import("../../core/odbc-source");
    response.json(await inspectOdbcSourceSchema());
  } catch (error) {
    next(error);
  }
});

export { router as sourceRouter };