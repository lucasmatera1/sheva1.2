import { getDashboardLeagueCurrentJLive } from "../src/core/live-analytics";

type SeqResult = "W" | "D" | "L";

type MethodCode = "4W" | "4D" | "5D-";

interface Entry {
  windowKey: string;
  gameIndex: number;
  nextResult: SeqResult;
  opponent: string;
  scoreLabel: string;
}

interface PlayerMethodStats {
  player: string;
  method: MethodCode;
  totalEntries: number;
  wins: number;
  draws: number;
  losses: number;
  apx: number;
  entries: Entry[];
}

function detectEntries(
  sequence: SeqResult[],
  method: MethodCode,
): number[] {
  const positions: number[] = [];

  for (let i = 1; i < sequence.length; i++) {
    const beforeSlice = sequence.slice(0, i);

    if (method === "4W") {
      const last4 = beforeSlice.slice(-4);
      const last5 = beforeSlice.slice(-5);
      if (
        last4.length === 4 &&
        last4.every((r) => r === "W") &&
        !(last5.length === 5 && last5.every((r) => r === "W"))
      ) {
        positions.push(i);
      }
    } else if (method === "4D") {
      const last4 = beforeSlice.slice(-4);
      const last5 = beforeSlice.slice(-5);
      if (
        last4.length === 4 &&
        last4.every((r) => r === "L") &&
        !(last5.length === 5 && last5.every((r) => r === "L"))
      ) {
        positions.push(i);
      }
    } else if (method === "5D-") {
      // 5 jogos sem vitória (D ou L), mas não 6
      const last5 = beforeSlice.slice(-5);
      const last6 = beforeSlice.slice(-6);
      if (
        last5.length === 5 &&
        last5.every((r) => r !== "W") &&
        !(last6.length === 6 && last6.every((r) => r !== "W"))
      ) {
        positions.push(i);
      }
    }
  }

  return positions;
}

void (async () => {
  const league = "GT LEAGUE" as const;
  const snapshot = await getDashboardLeagueCurrentJLive(league, {
    scope: "window",
  });

  // Determine 21-day cutoff
  const now = new Date();
  const cutoff = new Date(now.getTime() - 21 * 24 * 60 * 60 * 1000);

  const methods: MethodCode[] = ["4W", "4D", "5D-"];
  const allStats: PlayerMethodStats[] = [];

  for (const player of snapshot.players) {
    // Collect all windows (current + previous)
    const windows = [
      {
        key:
          snapshot.currentWindow.dayKey +
          "|" +
          snapshot.currentWindow.windowLabel,
        sequence: player.daySequence,
        matches: player.recentMatches,
        latestPlayedAt: player.latestPlayedAt,
      },
      ...player.previousWindows.map((w) => ({
        key: w.key,
        sequence: w.sequence,
        matches: w.matches,
        latestPlayedAt: w.latestPlayedAt,
      })),
    ];

    for (const method of methods) {
      const entries: Entry[] = [];

      for (const win of windows) {
        // Filter by 21-day window
        if (win.latestPlayedAt) {
          const winDate = new Date(win.latestPlayedAt);
          if (winDate < cutoff) continue;
        }

        const seq = win.sequence ?? [];
        const positions = detectEntries(seq, method);

        for (const pos of positions) {
          if (pos < seq.length) {
            const match = win.matches?.[pos];
            entries.push({
              windowKey: win.key,
              gameIndex: pos,
              nextResult: seq[pos],
              opponent: match?.opponent ?? "?",
              scoreLabel: match?.scoreLabel ?? "?",
            });
          }
        }
      }

      if (entries.length > 0) {
        const wins = entries.filter((e) => e.nextResult === "W").length;
        const draws = entries.filter((e) => e.nextResult === "D").length;
        const losses = entries.filter((e) => e.nextResult === "L").length;
        // 4W: esperamos L (reversão), APX = taxa de derrotas
        // 4D/5D-: esperamos W (reversão), APX = taxa de vitórias
        const successCount = method === "4W" ? losses : wins;
        allStats.push({
          player: player.name,
          method,
          totalEntries: entries.length,
          wins,
          draws,
          losses,
          apx: Math.round((successCount / entries.length) * 10000) / 100,
          entries,
        });
      }
    }
  }

  // Sort by method, then by totalEntries desc
  allStats.sort((a, b) => {
    if (a.method !== b.method) return a.method.localeCompare(b.method);
    return b.totalEntries - a.totalEntries;
  });

  // Print summary table
  console.log(`\n=== APX POR JOGADOR (${league}) - Últimos 21 dias ===\n`);

  for (const method of methods) {
    const methodStats = allStats.filter((s) => s.method === method);
    console.log(`\n--- ${method} ---`);
    if (methodStats.length === 0) {
      console.log("  Nenhuma entrada encontrada.");
      continue;
    }
    console.log(
      "  Jogador".padEnd(22) +
        "Entradas".padEnd(12) +
        "W".padEnd(6) +
        "D".padEnd(6) +
        "L".padEnd(6) +
        "APX%",
    );
    console.log("  " + "-".repeat(60));
    for (const s of methodStats) {
      console.log(
        `  ${s.player.padEnd(20)}${String(s.totalEntries).padEnd(12)}${String(s.wins).padEnd(6)}${String(s.draws).padEnd(6)}${String(s.losses).padEnd(6)}${s.apx.toFixed(2)}%`,
      );
    }

    // Totals for method
    const totalEntries = methodStats.reduce(
      (sum, s) => sum + s.totalEntries,
      0,
    );
    const totalWins = methodStats.reduce((sum, s) => sum + s.wins, 0);
    const totalDraws = methodStats.reduce((sum, s) => sum + s.draws, 0);
    const totalLosses = methodStats.reduce((sum, s) => sum + s.losses, 0);
    const totalApx =
      totalEntries > 0
        ? Math.round(((method === "4W" ? totalLosses : totalWins) / totalEntries) * 10000) / 100
        : 0;
    console.log("  " + "-".repeat(60));
    console.log(
      `  ${"TOTAL".padEnd(20)}${String(totalEntries).padEnd(12)}${String(totalWins).padEnd(6)}${String(totalDraws).padEnd(6)}${String(totalLosses).padEnd(6)}${totalApx.toFixed(2)}%`,
    );
  }

  // Detail per method: show each entry's next game
  for (const method of methods) {
    const methodStats = allStats.filter((s) => s.method === method);
    if (methodStats.length === 0) continue;
    console.log(`\n\n=== DETALHES ${method} — Próximo jogo após entrada ===\n`);
    for (const s of methodStats) {
      console.log(`  ${s.player} (${s.totalEntries} entradas, APX ${s.apx.toFixed(2)}%):`);
      for (const e of s.entries) {
        console.log(`    ${e.nextResult} ${e.scoreLabel} vs ${e.opponent}  [${e.windowKey}]`);
      }
    }
  }

  // Also output JSON for detailed view
  const jsonOutput = allStats.map((s) => ({
    player: s.player,
    method: s.method,
    totalEntries: s.totalEntries,
    wins: s.wins,
    draws: s.draws,
    losses: s.losses,
    apx: s.apx,
    games: s.entries.map((e) => ({
      result: e.nextResult,
      score: e.scoreLabel,
      opponent: e.opponent,
      window: e.windowKey,
    })),
  }));

  console.log("\n\n=== JSON ===");
  console.log(JSON.stringify(jsonOutput, null, 2));

  process.exit(0);
})();
