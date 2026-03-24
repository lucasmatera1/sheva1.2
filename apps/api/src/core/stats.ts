import type { PerformanceMetrics } from "@sheva/shared";

export interface MatchLike {
  homeScore: number;
  awayScore: number;
  isHomeSample?: boolean;
}

const round = (value: number) => Number(value.toFixed(4));

export const calculatePerformanceMetrics = (matches: MatchLike[]): PerformanceMetrics => {
  const totalGames = matches.length;
  const totals = matches.reduce(
    (accumulator, match) => {
      const goalsFor = match.isHomeSample === false ? match.awayScore : match.homeScore;
      const goalsAgainst = match.isHomeSample === false ? match.homeScore : match.awayScore;
      const totalGoals = match.homeScore + match.awayScore;

      accumulator.goalsFor += goalsFor;
      accumulator.goalsAgainst += goalsAgainst;
      accumulator.wins += goalsFor > goalsAgainst ? 1 : 0;
      accumulator.draws += goalsFor === goalsAgainst ? 1 : 0;
      accumulator.losses += goalsFor < goalsAgainst ? 1 : 0;
      accumulator.over15 += totalGoals > 1.5 ? 1 : 0;
      accumulator.over25 += totalGoals > 2.5 ? 1 : 0;
      accumulator.over35 += totalGoals > 3.5 ? 1 : 0;
      accumulator.under15 += totalGoals < 1.5 ? 1 : 0;
      accumulator.under25 += totalGoals < 2.5 ? 1 : 0;
      accumulator.under35 += totalGoals < 3.5 ? 1 : 0;
      accumulator.btts += match.homeScore > 0 && match.awayScore > 0 ? 1 : 0;
      accumulator.cleanSheet += goalsAgainst === 0 ? 1 : 0;
      accumulator.scored += goalsFor > 0 ? 1 : 0;
      accumulator.conceded += goalsAgainst > 0 ? 1 : 0;
      return accumulator;
    },
    {
      goalsFor: 0,
      goalsAgainst: 0,
      wins: 0,
      draws: 0,
      losses: 0,
      over15: 0,
      over25: 0,
      over35: 0,
      under15: 0,
      under25: 0,
      under35: 0,
      btts: 0,
      cleanSheet: 0,
      scored: 0,
      conceded: 0,
    },
  );

  return {
    totalGames,
    wins: totals.wins,
    draws: totals.draws,
    losses: totals.losses,
    winRate: totalGames ? round((totals.wins / totalGames) * 100) : 0,
    goalDifference: totals.goalsFor - totals.goalsAgainst,
    goalsForAverage: totalGames ? round(totals.goalsFor / totalGames) : 0,
    goalsAgainstAverage: totalGames ? round(totals.goalsAgainst / totalGames) : 0,
    totalGoalsAverage: totalGames ? round((totals.goalsFor + totals.goalsAgainst) / totalGames) : 0,
    over15Rate: totalGames ? round((totals.over15 / totalGames) * 100) : 0,
    over25Rate: totalGames ? round((totals.over25 / totalGames) * 100) : 0,
    over35Rate: totalGames ? round((totals.over35 / totalGames) * 100) : 0,
    under15Rate: totalGames ? round((totals.under15 / totalGames) * 100) : 0,
    under25Rate: totalGames ? round((totals.under25 / totalGames) * 100) : 0,
    under35Rate: totalGames ? round((totals.under35 / totalGames) * 100) : 0,
    bttsRate: totalGames ? round((totals.btts / totalGames) * 100) : 0,
    cleanSheetRate: totalGames ? round((totals.cleanSheet / totalGames) * 100) : 0,
    scoredRate: totalGames ? round((totals.scored / totalGames) * 100) : 0,
    concededRate: totalGames ? round((totals.conceded / totalGames) * 100) : 0,
  };
};