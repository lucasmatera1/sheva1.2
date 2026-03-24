import { Router } from "express";
import { BacktestService } from "./backtest.service";

const router = Router();
const service = new BacktestService();

router.get("/:methodId", async (request, response, next) => {
  try {
    response.json(await service.runBacktest(request.params.methodId));
  } catch (error) {
    next(error);
  }
});

export { router as backtestRouter };