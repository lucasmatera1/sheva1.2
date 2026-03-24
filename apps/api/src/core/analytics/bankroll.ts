import { getPlayerResultCode, roundAnalytics } from "./normalizers";
import type { AnalyticsMatch, BankrollAnalytics, BankrollConfig, BankrollPoint, MatchResultCode } from "./types";

const DEFAULT_BANKROLL_CONFIG: Required<BankrollConfig> = {
  mode: "simulated",
  initialBankroll: 0,
  stakePerGame: 1,
  winAmount: 1,
  lossAmount: -1,
  drawAmount: 0,
};

export function buildSimulatedBankrollAnalytics(matches: AnalyticsMatch[], playerName: string, config: BankrollConfig = { mode: "simulated" }): BankrollAnalytics {
  const resolvedConfig = { ...DEFAULT_BANKROLL_CONFIG, ...config };
  const playerMatches = [...matches]
    .filter((match) => match.normalizedHomePlayer === playerName.toUpperCase().trim() || match.normalizedAwayPlayer === playerName.toUpperCase().trim())
    .sort((left, right) => left.playedAt.getTime() - right.playedAt.getTime());

  let balance = resolvedConfig.initialBankroll;
  let peakBalance = resolvedConfig.initialBankroll;
  const recoveryLengths: number[] = [];
  let currentRecoveryLength = 0;
  let inRecovery = false;

  const timeline: BankrollPoint[] = playerMatches.map((match) => {
    const result = getPlayerResultCode(match, playerName);
    const profit = resolveSimulatedProfit(result, resolvedConfig);

    balance = roundAnalytics(balance + profit);
    if (balance >= peakBalance) {
      if (inRecovery) {
        recoveryLengths.push(currentRecoveryLength);
        currentRecoveryLength = 0;
        inRecovery = false;
      }

      peakBalance = balance;
    } else {
      inRecovery = true;
      currentRecoveryLength += 1;
    }

    return {
      matchId: match.id,
      playedAt: match.playedAt.toISOString(),
      result,
      profit,
      balance,
      peakBalance,
      drawdown: roundAnalytics(peakBalance - balance),
    };
  });

  if (inRecovery && currentRecoveryLength > 0) {
    recoveryLengths.push(currentRecoveryLength);
  }

  const totalProfit = timeline.reduce((sum, point) => sum + point.profit, 0);
  const totalExposure = resolvedConfig.stakePerGame * timeline.length;
  const drawdowns = timeline.map((point) => point.drawdown);

  return {
    mode: "simulated",
    initialBankroll: resolvedConfig.initialBankroll,
    totalProfit: roundAnalytics(totalProfit),
    roi: totalExposure ? roundAnalytics((totalProfit / totalExposure) * 100) : 0,
    maxDrawdown: drawdowns.length ? Math.max(...drawdowns) : 0,
    averageDrawdown: drawdowns.length ? roundAnalytics(drawdowns.reduce((sum, value) => sum + value, 0) / drawdowns.length) : 0,
    maxRecoveryLength: recoveryLengths.length ? Math.max(...recoveryLengths) : 0,
    averageRecoveryLength: recoveryLengths.length ? roundAnalytics(recoveryLengths.reduce((sum, value) => sum + value, 0) / recoveryLengths.length) : 0,
    timeline,
  };
}

function resolveSimulatedProfit(result: MatchResultCode, config: Required<BankrollConfig>) {
  if (result === "W") {
    return roundAnalytics(config.winAmount * config.stakePerGame);
  }

  if (result === "L") {
    return roundAnalytics(config.lossAmount * config.stakePerGame);
  }

  return roundAnalytics(config.drawAmount * config.stakePerGame);
}