import { getPlayerResultCode } from "./normalizers";
import { computeRiskScore, getRiskLevel, summarizeRecentLossRate } from "./scoring";
import { getCurrentNoWinStreak, getCurrentStreak } from "./streaks";
import type { AnalyticsMatch, BankrollAnalytics, MatchResultCode, RiskAnalytics, SimilarRiskScenario } from "./types";

const SIMILAR_SEQUENCE_SIZE = 5;
const FUTURE_WINDOW_SIZE = 5;

export function buildRiskAnalytics(matches: AnalyticsMatch[], playerName: string, bankroll: BankrollAnalytics): RiskAnalytics {
  const playerMatches = [...matches]
    .filter((match) => match.normalizedHomePlayer === playerName.toUpperCase().trim() || match.normalizedAwayPlayer === playerName.toUpperCase().trim())
    .sort((left, right) => left.playedAt.getTime() - right.playedAt.getTime());
  const sequence = playerMatches.map((match) => getPlayerResultCode(match, playerName));
  const currentSequence = sequence.slice(-SIMILAR_SEQUENCE_SIZE);
  const similarScenarios = currentSequence.length >= 3 ? buildSimilarScenarios(sequence, currentSequence) : [];
  const currentStreak = getCurrentStreak(sequence);
  const currentLossStreak = currentStreak?.type === "L" ? currentStreak.count : 0;
  const similarScenarioRate = similarScenarios[0]?.negativeContinuationRate ?? 0;
  const riskScore = computeRiskScore({
    currentNoWinStreak: getCurrentNoWinStreak(sequence),
    currentLossStreak,
    recentLossRate: summarizeRecentLossRate(sequence.slice(-10)),
    maxDrawdown: bankroll.maxDrawdown,
    similarScenarioRate,
  });

  return {
    currentRiskScore: riskScore,
    currentRiskLevel: getRiskLevel(riskScore),
    severeDrawdownRate: buildSevereDrawdownRate(bankroll),
    similarScenarios,
    alerts: buildRiskAlerts({
      currentLossStreak,
      currentNoWinStreak: getCurrentNoWinStreak(sequence),
      maxDrawdown: bankroll.maxDrawdown,
      similarScenarioRate,
      riskScore,
    }),
  };
}

function buildSimilarScenarios(sequence: MatchResultCode[], currentSequence: MatchResultCode[]): SimilarRiskScenario[] {
  const scenarios: SimilarRiskScenario[] = [];

  for (let index = 0; index <= sequence.length - currentSequence.length - FUTURE_WINDOW_SIZE; index += 1) {
    const candidate = sequence.slice(index, index + currentSequence.length);
    if (!isSameSequence(candidate, currentSequence)) {
      continue;
    }

    const future = sequence.slice(index + currentSequence.length, index + currentSequence.length + FUTURE_WINDOW_SIZE);
    const futureProfit = future.reduce((sum, result) => sum + (result === "W" ? 1 : result === "L" ? -1 : 0), 0);
    scenarios.push({
      sequence: candidate,
      totalCases: 1,
      negativeContinuationRate: futureProfit < 0 ? 100 : 0,
      averageFutureProfit: futureProfit,
    });
  }

  if (!scenarios.length) {
    return [];
  }

  const grouped = new Map<string, { totalCases: number; negativeCases: number; totalProfit: number; sequence: MatchResultCode[] }>();
  for (const scenario of scenarios) {
    const key = scenario.sequence.join("");
    const current = grouped.get(key) ?? { totalCases: 0, negativeCases: 0, totalProfit: 0, sequence: scenario.sequence };
    current.totalCases += 1;
    current.negativeCases += scenario.negativeContinuationRate > 0 ? 1 : 0;
    current.totalProfit += scenario.averageFutureProfit;
    grouped.set(key, current);
  }

  return Array.from(grouped.values())
    .map((group) => ({
      sequence: group.sequence,
      totalCases: group.totalCases,
      negativeContinuationRate: group.totalCases ? (group.negativeCases / group.totalCases) * 100 : 0,
      averageFutureProfit: group.totalCases ? group.totalProfit / group.totalCases : 0,
    }))
    .sort((left, right) => right.negativeContinuationRate - left.negativeContinuationRate || right.totalCases - left.totalCases);
}

function buildSevereDrawdownRate(bankroll: BankrollAnalytics) {
  if (!bankroll.timeline.length) {
    return 0;
  }

  const threshold = bankroll.maxDrawdown * 0.7;
  if (threshold <= 0) {
    return 0;
  }

  const severePoints = bankroll.timeline.filter((point) => point.drawdown >= threshold).length;
  return (severePoints / bankroll.timeline.length) * 100;
}

function buildRiskAlerts(input: {
  currentLossStreak: number;
  currentNoWinStreak: number;
  maxDrawdown: number;
  similarScenarioRate: number;
  riskScore: number;
}) {
  const alerts: string[] = [];

  if (input.currentLossStreak >= 3) {
    alerts.push(`Sequencia atual de ${input.currentLossStreak} derrotas puras elevou o risco.`);
  }

  if (input.currentNoWinStreak >= 5) {
    alerts.push(`O bloco atual sem vitoria chegou a ${input.currentNoWinStreak} jogos.`);
  }

  if (input.similarScenarioRate >= 60) {
    alerts.push(`Padrao recente se parece com cenarios historicos que continuaram negativos em ${Math.round(input.similarScenarioRate)}% das vezes.`);
  }

  if (input.maxDrawdown >= 5) {
    alerts.push(`O drawdown maximo simulado ja atingiu ${input.maxDrawdown.toFixed(2)} unidades.`);
  }

  if (!alerts.length && input.riskScore >= 35) {
    alerts.push("Risco crescente detectado pela combinacao de sequencia recente e drawdown.");
  }

  return alerts;
}

function isSameSequence(left: MatchResultCode[], right: MatchResultCode[]) {
  return left.length === right.length && left.every((result, index) => result === right[index]);
}