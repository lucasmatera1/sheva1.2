import type { BacktestEntry, DashboardOverview, MethodDefinition } from "@sheva/shared";
import { calculateBacktestMetrics } from "@sheva/shared";

export const mockDashboardOverview: DashboardOverview = {
  totalMatches: 1284,
  totalLeagues: 4,
  totalPlayers: 62,
  averageGoals: 3.18,
  over25Rate: 61.4,
  bttsRate: 57.1,
  generalProfit: 22.35,
  topPlayers: [
    { name: "Sheva Alpha", winRate: 64.2, profit: 8.2 },
    { name: "Ragnar Prime", winRate: 62.8, profit: 6.4 },
    { name: "Nexus FC", winRate: 61.1, profit: 5.8 },
  ],
  worstPlayers: [
    { name: "Beta Zero", winRate: 39.4, profit: -5.1 },
    { name: "Delta Ghost", winRate: 37.2, profit: -4.4 },
    { name: "Omega Trial", winRate: 35.7, profit: -3.9 },
  ],
  bestMethods: [
    { name: "Favorito por forma recente", netProfit: 11.4, roi: 18.7 },
    { name: "Over 2.5 ofensivo", netProfit: 7.8, roi: 12.2 },
    { name: "BTTS pressao alta", netProfit: 3.15, roi: 6.1 },
  ],
};

export const mockPlayers = [
  {
    id: "mock-player-1",
    name: "Sheva Alpha",
    teamName: "Alpha FC",
    winRate: 64.2,
    simulatedProfit: 8.2,
    rating: 89,
  },
  {
    id: "mock-player-2",
    name: "Sheva Beta",
    teamName: "Beta United",
    winRate: 43.8,
    simulatedProfit: -2.4,
    rating: 71,
  },
];

export const mockLeagues = [
  { id: "league-1", code: "H2H", name: "H2H", type: "H2H", _count: { matches: 412 } },
  { id: "league-2", code: "GT", name: "GT LEAGUE", type: "GT_LEAGUE", _count: { matches: 536 } },
  { id: "league-3", code: "6MV", name: "6MIN VOLTA", type: "SIX_MIN_VOLTA", _count: { matches: 188 } },
  { id: "league-4", code: "8MB", name: "8MIN BATTLE", type: "EIGHT_MIN_BATTLE", _count: { matches: 148 } },
];

export const mockMethods: MethodDefinition[] = [
  {
    id: "favorito-forma-recente",
    name: "Favorito por forma recente",
    description: "Entrada no favorito quando a forma recente tem vantagem significativa.",
    market: "match_winner",
    filters: { minimumGames: 10 },
    rules: [{ key: "homeRecentWinRate", operator: "gte", value: 60 }],
  },
  {
    id: "over-25-ofensivo",
    name: "Over 2.5 ofensivo",
    description: "Over 2.5 quando ambos tem media ofensiva alta e defesa permissiva.",
    market: "over_2_5",
    filters: { minimumGames: 8 },
    rules: [
      { key: "homeGoalsForAverage", operator: "gte", value: 1.7 },
      { key: "awayGoalsForAverage", operator: "gte", value: 1.5 },
    ],
  },
];

export const mockBacktestEntries: BacktestEntry[] = [
  {
    matchId: "match-1",
    leagueCode: "GT",
    playerRef: "Sheva Alpha",
    odd: 1.9,
    result: "green",
    profit: 0.9,
    playedAt: "2026-02-15T20:00:00.000Z",
  },
  {
    matchId: "match-2",
    leagueCode: "GT",
    playerRef: "Sheva Alpha",
    odd: 1.85,
    result: "red",
    profit: -1,
    playedAt: "2026-02-18T20:00:00.000Z",
  },
  {
    matchId: "match-3",
    leagueCode: "H2H",
    playerRef: "Sheva Alpha",
    odd: 2.1,
    result: "green",
    profit: 1.1,
    playedAt: "2026-02-24T20:00:00.000Z",
  },
];

export const mockBacktestResult = {
  methodId: "favorito-forma-recente",
  entries: mockBacktestEntries,
  metrics: calculateBacktestMetrics(mockBacktestEntries),
};