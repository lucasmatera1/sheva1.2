const LEAGUE_PARAM_MAP = {
  "gt-league": "GT LEAGUE",
  "8min-battle": "8MIN BATTLE",
  h2h: "H2H",
  "6min-volta": "6MIN VOLTA",
} as const;

type LeagueParam = keyof typeof LEAGUE_PARAM_MAP;
type LeagueType = (typeof LEAGUE_PARAM_MAP)[LeagueParam];

function resolveLeagueParam(value: string): LeagueType | null {
  return LEAGUE_PARAM_MAP[value as LeagueParam] ?? null;
}

export { LEAGUE_PARAM_MAP, resolveLeagueParam };