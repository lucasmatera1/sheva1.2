export interface PerformanceMetrics {
  totalGames: number;
  wins: number;
  draws: number;
  losses: number;
  winRate: number;
  goalDifference: number;
  goalsForAverage: number;
  goalsAgainstAverage: number;
  totalGoalsAverage: number;
  over15Rate: number;
  over25Rate: number;
  over35Rate: number;
  under15Rate: number;
  under25Rate: number;
  under35Rate: number;
  bttsRate: number;
  cleanSheetRate: number;
  scoredRate: number;
  concededRate: number;
}

export interface ProfitMetrics {
  entries: number;
  greens: number;
  reds: number;
  voids: number;
  hitRate: number;
  averageOdd: number;
  netProfit: number;
  roi: number;
  yield: number;
  maxDrawdown: number;
  profitFactor: number;
  maxGreenStreak: number;
  maxRedStreak: number;
}

export interface DashboardOverview {
  totalMatches: number;
  totalLeagues: number;
  totalPlayers: number;
  averageGoals: number;
  over25Rate: number;
  bttsRate: number;
  generalProfit: number;
  topPlayers: Array<{ name: string; winRate: number; profit: number }>;
  worstPlayers: Array<{ name: string; winRate: number; profit: number }>;
  bestMethods: Array<{ name: string; netProfit: number; roi: number }>;
}