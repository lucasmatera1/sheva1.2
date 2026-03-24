import { clampAnalyticsScore, roundAnalytics } from "./normalizers";
import type { MatchResultCode, RiskLevel, TiltLevel } from "./types";

export function computeTiltScore(input: {
  lossesInRow: number;
  noWinStreak: number;
  recentWinRate: number;
  durationMatches: number;
  maxDrawdown?: number;
}) {
  const lossesWeight = Math.min(input.lossesInRow * 14, 35);
  const noWinWeight = Math.min(input.noWinStreak * 7, 30);
  const recentWinPenalty = Math.min(Math.max(0, 50 - input.recentWinRate) * 0.7, 25);
  const durationWeight = Math.min(input.durationMatches * 2, 10);
  const drawdownWeight = Math.min(Math.max(0, input.maxDrawdown ?? 0) * 0.25, 10);

  return clampAnalyticsScore(lossesWeight + noWinWeight + recentWinPenalty + durationWeight + drawdownWeight);
}

export function getTiltLevel(score: number): TiltLevel {
  if (score >= 75) {
    return "severo";
  }

  if (score >= 55) {
    return "moderado";
  }

  if (score >= 35) {
    return "leve";
  }

  return "none";
}

export function computeOpponentDangerScore(input: { totalGames: number; lossRate: number; longestNegativeStreak: number; recentSequence: MatchResultCode[] }) {
  const sampleWeight = Math.min(input.totalGames / 12, 1) * 20;
  const recentLossRate = input.recentSequence.length
    ? (input.recentSequence.filter((result) => result === "L").length / input.recentSequence.length) * 100
    : 0;
  const streakWeight = Math.min(input.longestNegativeStreak * 7, 20);

  return clampAnalyticsScore(input.lossRate * 0.55 + recentLossRate * 0.15 + sampleWeight + streakWeight);
}

export function computeRecoveryScore(input: { recoveryRateAfterLoss: number; bestRecoveryRun: number; currentNoWinStreak: number }) {
  const recoveryWeight = input.recoveryRateAfterLoss * 0.65;
  const runWeight = Math.min(input.bestRecoveryRun * 6, 24);
  const currentPenalty = Math.min(input.currentNoWinStreak * 8, 24);

  return clampAnalyticsScore(recoveryWeight + runWeight - currentPenalty);
}

export function computeProfitabilityScore(input: { winRate: number; lossRate: number; totalGames: number; averageWinStreak: number; averageLossStreak: number }) {
  const sampleWeight = Math.min(input.totalGames / 25, 1) * 15;
  const consistencyWeight = Math.max(0, input.averageWinStreak - input.averageLossStreak) * 5;
  const netRate = input.winRate - input.lossRate;

  return clampAnalyticsScore(netRate * 0.7 + input.winRate * 0.25 + sampleWeight + consistencyWeight);
}

export function computeRiskScore(input: {
  currentNoWinStreak: number;
  currentLossStreak: number;
  recentLossRate: number;
  maxDrawdown: number;
  similarScenarioRate: number;
}) {
  const noWinWeight = Math.min(input.currentNoWinStreak * 8, 24);
  const lossWeight = Math.min(input.currentLossStreak * 12, 24);
  const recentWeight = Math.min(input.recentLossRate * 0.3, 20);
  const drawdownWeight = Math.min(input.maxDrawdown * 0.35, 18);
  const scenarioWeight = Math.min(input.similarScenarioRate * 0.22, 14);

  return clampAnalyticsScore(noWinWeight + lossWeight + recentWeight + drawdownWeight + scenarioWeight);
}

export function getRiskLevel(score: number): RiskLevel {
  if (score >= 75) {
    return "critico";
  }

  if (score >= 55) {
    return "alto";
  }

  if (score >= 35) {
    return "medio";
  }

  return "baixo";
}

export function summarizeRecentLossRate(sequence: MatchResultCode[]) {
  if (!sequence.length) {
    return 0;
  }

  const losses = sequence.filter((result) => result === "L").length;
  return roundAnalytics((losses / sequence.length) * 100);
}