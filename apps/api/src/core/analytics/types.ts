export type AnalyticsLeagueType = "GT LEAGUE" | "8MIN BATTLE" | "6MIN VOLTA" | "H2H";

export type MatchResultCode = "W" | "D" | "L";

export type TimeBucket = "madrugada" | "manha" | "tarde" | "noite";

export type AnalyticsMatch = {
  id: string;
  sourceMatchId: string | number;
  leagueType: AnalyticsLeagueType;
  leagueGroup?: string | null;
  seasonId: number | null;
  playedAt: Date;
  dayKey: string;
  hour: number | null;
  weekday: number | null;
  timeBucket: TimeBucket | null;
  homePlayer: string;
  awayPlayer: string;
  normalizedHomePlayer: string;
  normalizedAwayPlayer: string;
  homeScore: number | null;
  awayScore: number | null;
  isFinished: boolean;
};

export type AnalyticsFilters = {
  playerName?: string;
  opponentName?: string;
  leagueTypes?: AnalyticsLeagueType[];
  startDate?: string;
  endDate?: string;
  minGames?: number;
  includeDraws?: boolean;
  onlyCompletedSessions?: boolean;
  hours?: number[];
  weekdays?: number[];
  timeBuckets?: TimeBucket[];
};

export type ResultStreak = {
  type: MatchResultCode;
  count: number;
};

export type StreakMetrics = {
  totalGames: number;
  wins: number;
  draws: number;
  losses: number;
  winRate: number;
  lossRate: number;
  drawRate: number;
  balance: number;
  longestWinStreak: number;
  longestLossStreak: number;
  longestNoWinStreak: number;
  averageWinStreak: number;
  averageLossStreak: number;
  currentStreak: ResultStreak | null;
  currentNoWinStreak: number;
  recoveryRateAfterLoss: number;
  winAfterLossRate: number;
  lossAfterWinRate: number;
  bestRecoveryRun: number;
};

export type SequenceWindowSummary = {
  size: number;
  startMatchId: string;
  endMatchId: string;
  startAt: string;
  endAt: string;
  wins: number;
  draws: number;
  losses: number;
  winRate: number;
  lossRate: number;
  score: number;
  sequence: MatchResultCode[];
};

export type WindowAnalytics = {
  size: number;
  totalWindows: number;
  worstWindow: SequenceWindowSummary | null;
  bestWindow: SequenceWindowSummary | null;
};

export type TimePerformanceRow = {
  key: string;
  label: string;
  hour?: number;
  weekday?: number;
  timeBucket?: TimeBucket;
  totalGames: number;
  wins: number;
  draws: number;
  losses: number;
  winRate: number;
  lossRate: number;
  drawRate: number;
  averageWinStreak: number;
  averageLossStreak: number;
  profitabilityScore: number | null;
};

export type ScheduleHeatmapCell = {
  weekday: number;
  weekdayLabel: string;
  hour: number;
  hourLabel: string;
  totalGames: number;
  winRate: number;
  lossRate: number;
  drawRate: number;
  profitabilityScore: number | null;
};

export type ScheduleAnalytics = {
  byHour: TimePerformanceRow[];
  byWeekday: TimePerformanceRow[];
  byTimeBucket: TimePerformanceRow[];
  heatmap: ScheduleHeatmapCell[];
  bestHour: TimePerformanceRow | null;
  worstHour: TimePerformanceRow | null;
  bestWeekday: TimePerformanceRow | null;
  worstWeekday: TimePerformanceRow | null;
  bestTimeBucket: TimePerformanceRow | null;
  worstTimeBucket: TimePerformanceRow | null;
  bestDayHour: ScheduleHeatmapCell | null;
  worstDayHour: ScheduleHeatmapCell | null;
};

export type OpponentRelationshipLabel = "muito-perigoso" | "carrasco" | "equilibrado" | "fregues" | "amostra-baixa";

export type OpponentAnalyticsRow = {
  opponent: string;
  totalGames: number;
  wins: number;
  draws: number;
  losses: number;
  winRate: number;
  lossRate: number;
  balance: number;
  currentStreak: ResultStreak | null;
  recentSequence: MatchResultCode[];
  longestNegativeStreak: number;
  mostDangerousHour: number | null;
  mostDangerousLeague: AnalyticsLeagueType | null;
  relationshipLabel: OpponentRelationshipLabel;
  opponentDangerScore: number;
  latestPlayedAt: string | null;
};

export type BankrollConfig = {
  mode: "simulated";
  initialBankroll?: number;
  stakePerGame?: number;
  winAmount?: number;
  lossAmount?: number;
  drawAmount?: number;
};

export type BankrollPoint = {
  matchId: string;
  playedAt: string;
  result: MatchResultCode;
  profit: number;
  balance: number;
  peakBalance: number;
  drawdown: number;
};

export type BankrollAnalytics = {
  mode: "simulated";
  initialBankroll: number;
  totalProfit: number;
  roi: number;
  maxDrawdown: number;
  averageDrawdown: number;
  maxRecoveryLength: number;
  averageRecoveryLength: number;
  timeline: BankrollPoint[];
};

export type TiltLevel = "none" | "leve" | "moderado" | "severo";

export type TiltEpisode = {
  startedAt: string;
  endedAt: string;
  durationMatches: number;
  durationMinutes: number | null;
  lossesInRow: number;
  noWinStreak: number;
  recentWinRate: number;
  leagues: AnalyticsLeagueType[];
  opponents: string[];
  tiltScore: number;
  tiltLevel: TiltLevel;
};

export type TiltAnalytics = {
  currentTilt: TiltEpisode | null;
  episodes: TiltEpisode[];
  tiltScore: number;
  tiltLevel: TiltLevel;
  frequentTiltHours: number[];
  frequentTiltLeagues: AnalyticsLeagueType[];
  alerts: string[];
};

export type SimilarRiskScenario = {
  sequence: MatchResultCode[];
  totalCases: number;
  negativeContinuationRate: number;
  averageFutureProfit: number;
};

export type RiskLevel = "baixo" | "medio" | "alto" | "critico";

export type RiskAnalytics = {
  currentRiskScore: number;
  currentRiskLevel: RiskLevel;
  severeDrawdownRate: number;
  similarScenarios: SimilarRiskScenario[];
  alerts: string[];
};

export type BaseAnalyticsOverview = {
  playerName: string;
  totalMatches: number;
  streaks: StreakMetrics;
  windows: WindowAnalytics[];
  schedule: ScheduleAnalytics;
  opponents: OpponentAnalyticsRow[];
  bankroll: BankrollAnalytics;
  tilt: TiltAnalytics;
  risk: RiskAnalytics;
};