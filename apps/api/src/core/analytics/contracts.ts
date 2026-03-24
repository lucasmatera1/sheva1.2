import type {
  AnalyticsFilters,
  BankrollConfig,
  BaseAnalyticsOverview,
  OpponentAnalyticsRow,
  RiskAnalytics,
  ScheduleAnalytics,
  TiltAnalytics,
} from "./types";

export type AnalyticsResponseMeta = {
  generatedAt: string;
  totalMatchesLoaded: number;
  totalMatchesFiltered: number;
  notes: string[];
};

export type AnalyticsResponseEnvelope<TData> = {
  filters: AnalyticsFilters;
  meta: AnalyticsResponseMeta;
  data: TData;
};

export type AnalyticsOverviewRequest = AnalyticsFilters & {
  playerName: string;
  windowSizes?: number[];
  bankrollConfig?: BankrollConfig;
};

export type AnalyticsScheduleRequest = AnalyticsFilters & {
  playerName: string;
};

export type AnalyticsTiltRequest = AnalyticsFilters & {
  playerName: string;
  bankrollConfig?: BankrollConfig;
};

export type AnalyticsH2HRequest = AnalyticsFilters & {
  playerName: string;
};

export type AnalyticsRiskRequest = AnalyticsFilters & {
  playerName: string;
  bankrollConfig?: BankrollConfig;
};

export type AnalyticsOverviewPayload = BaseAnalyticsOverview & {
  scores: {
    recoveryScore: number;
  };
};

export type AnalyticsOverviewResponse = AnalyticsResponseEnvelope<AnalyticsOverviewPayload>;

export type AnalyticsScheduleResponse = AnalyticsResponseEnvelope<ScheduleAnalytics>;

export type AnalyticsTiltResponse = AnalyticsResponseEnvelope<TiltAnalytics>;

export type AnalyticsH2HResponse = AnalyticsResponseEnvelope<OpponentAnalyticsRow[]>;

export type AnalyticsRiskPayload = {
  risk: RiskAnalytics;
  bankrollMode: BankrollConfig["mode"];
};

export type AnalyticsRiskResponse = AnalyticsResponseEnvelope<AnalyticsRiskPayload>;

export interface AnalyticsServiceContract {
  getOverview(request: AnalyticsOverviewRequest): Promise<AnalyticsOverviewResponse | null>;
  getSchedule(request: AnalyticsScheduleRequest): Promise<AnalyticsScheduleResponse | null>;
  getTilt(request: AnalyticsTiltRequest): Promise<AnalyticsTiltResponse | null>;
  getH2H(request: AnalyticsH2HRequest): Promise<AnalyticsH2HResponse | null>;
  getRisk(request: AnalyticsRiskRequest): Promise<AnalyticsRiskResponse | null>;
}