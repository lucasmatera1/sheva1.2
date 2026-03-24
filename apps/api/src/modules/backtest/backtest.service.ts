import { getBacktestSummaryLive } from "../../core/live-analytics";
import { calculateBacktestMetrics } from "@sheva/shared";
import { mockBacktestResult } from "../../core/mock-data";

export class BacktestService {
  async runBacktest(methodId: string) {
    const liveBacktest = await getBacktestSummaryLive(methodId);

    if (liveBacktest) {
      return liveBacktest;
    }

    return {
      ...mockBacktestResult,
      methodId,
      metrics: calculateBacktestMetrics(mockBacktestResult.entries),
    };
  }
}