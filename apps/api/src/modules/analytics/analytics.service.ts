import type {
  AnalyticsH2HRequest,
  AnalyticsOverviewRequest,
  AnalyticsRiskRequest,
  AnalyticsScheduleRequest,
  AnalyticsTiltRequest,
} from "../../core/analytics";
import { AnalyticsService as CoreAnalyticsService } from "../../core/analytics";

export class AnalyticsService {
  private readonly core = new CoreAnalyticsService();

  async getOverview(request: AnalyticsOverviewRequest) {
    return this.core.getOverview(request);
  }

  async getSchedule(request: AnalyticsScheduleRequest) {
    return this.core.getSchedule(request);
  }

  async getTilt(request: AnalyticsTiltRequest) {
    return this.core.getTilt(request);
  }

  async getH2H(request: AnalyticsH2HRequest) {
    return this.core.getH2H(request);
  }

  async getRisk(request: AnalyticsRiskRequest) {
    return this.core.getRisk(request);
  }
}