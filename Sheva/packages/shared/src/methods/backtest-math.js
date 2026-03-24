const round = (value) => Number(value.toFixed(4));
export const calculateBacktestMetrics = (entries) => {
    const entriesCount = entries.length;
    const greens = entries.filter((entry) => entry.result === "green").length;
    const reds = entries.filter((entry) => entry.result === "red").length;
    const voids = entries.filter((entry) => entry.result === "void").length;
    const totalOdd = entries.reduce((sum, entry) => sum + entry.odd, 0);
    const netProfit = entries.reduce((sum, entry) => sum + entry.profit, 0);
    const grossWin = entries.filter((entry) => entry.profit > 0).reduce((sum, entry) => sum + entry.profit, 0);
    const grossLoss = Math.abs(entries.filter((entry) => entry.profit < 0).reduce((sum, entry) => sum + entry.profit, 0));
    let running = 0;
    let peak = 0;
    let maxDrawdown = 0;
    let greenStreak = 0;
    let redStreak = 0;
    let maxGreenStreak = 0;
    let maxRedStreak = 0;
    for (const entry of entries) {
        running += entry.profit;
        peak = Math.max(peak, running);
        maxDrawdown = Math.max(maxDrawdown, peak - running);
        if (entry.result === "green") {
            greenStreak += 1;
            redStreak = 0;
        }
        else if (entry.result === "red") {
            redStreak += 1;
            greenStreak = 0;
        }
        else {
            greenStreak = 0;
            redStreak = 0;
        }
        maxGreenStreak = Math.max(maxGreenStreak, greenStreak);
        maxRedStreak = Math.max(maxRedStreak, redStreak);
    }
    return {
        entries: entriesCount,
        greens,
        reds,
        voids,
        hitRate: entriesCount ? round((greens / entriesCount) * 100) : 0,
        averageOdd: entriesCount ? round(totalOdd / entriesCount) : 0,
        netProfit: round(netProfit),
        roi: entriesCount ? round((netProfit / entriesCount) * 100) : 0,
        yield: entriesCount ? round((netProfit / entriesCount) * 100) : 0,
        maxDrawdown: round(maxDrawdown),
        profitFactor: grossLoss ? round(grossWin / grossLoss) : grossWin ? round(grossWin) : 0,
        maxGreenStreak,
        maxRedStreak,
    };
};
