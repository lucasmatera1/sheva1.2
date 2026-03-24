export type MarketType =
  | "match_winner"
  | "over_2_5"
  | "btts_yes"
  | "lay_player"
  | "custom";

export type SignalResult = "green" | "red" | "void";

export interface MethodFilterConfig {
  leagues?: string[];
  periods?: {
    from?: string;
    to?: string;
  };
  minimumGames?: number;
  minOdd?: number;
  maxOdd?: number;
}

export interface MethodRuleConfig {
  key: string;
  operator: "gt" | "gte" | "lt" | "lte" | "eq" | "between";
  value: number | string | [number, number];
}

export interface MethodDefinition {
  id: string;
  name: string;
  description: string;
  market: MarketType;
  filters: MethodFilterConfig;
  rules: MethodRuleConfig[];
}

export interface MethodContext {
  leagueCode: string;
  homePlayer: string;
  awayPlayer: string;
  homeRecentWinRate: number;
  awayRecentWinRate: number;
  homeGoalsForAverage: number;
  awayGoalsForAverage: number;
  homeGoalsAgainstAverage: number;
  awayGoalsAgainstAverage: number;
  bttsRate: number;
  over25Rate: number;
  homeOdd?: number;
  awayOdd?: number;
}

export interface MethodSignal {
  shouldEnter: boolean;
  reason: string[];
}

export interface BacktestEntry {
  matchId: string;
  leagueCode: string;
  playerRef: string;
  odd: number;
  result: SignalResult;
  profit: number;
  playedAt: string;
}