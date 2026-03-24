import { getDashboardLeagueCurrentJLive } from "../src/core/live-analytics";

void (async () => {
  const snap = await getDashboardLeagueCurrentJLive("GT LEAGUE", {
    scope: "window",
  });
  const player = snap.players.find(
    (p) => p.name.toUpperCase() === "ARTHUR",
  );
  if (!player) {
    console.log("NOT FOUND");
    process.exit(1);
  }

  const windows = [
    {
      key:
        snap.currentWindow.dayKey + "|" + snap.currentWindow.windowLabel,
      dayLabel: snap.currentWindow.dayLabel,
      windowLabel: snap.currentWindow.windowLabel,
      sequence: player.daySequence,
      matches: player.recentMatches,
    },
    ...player.previousWindows.map((w) => ({
      key: w.key,
      dayLabel: w.dayLabel,
      windowLabel: w.windowLabel,
      sequence: w.sequence,
      matches: w.matches,
    })),
  ];

  const methods = [
    { name: "5D-", length: 5 },
    { name: "6D-", length: 6 },
  ];

  for (const method of methods) {
    let totalEntries = 0;
    let totalW = 0;
    let totalD = 0;
    let totalL = 0;

    console.log("\n============ " + method.name + " (Arthur) ============\n");

    for (const win of windows) {
      const seq = win.sequence ?? [];
      const positions: number[] = [];

      for (let i = 1; i < seq.length; i++) {
        const before = seq.slice(0, i);
        const lastN = before.slice(-method.length);
        const lastN1 = before.slice(-(method.length + 1));
        const isMatch =
          lastN.length === method.length && lastN.every((r) => r !== "W");
        const isOver =
          lastN1.length === method.length + 1 &&
          lastN1.every((r) => r !== "W");
        if (isMatch && !isOver) {
          positions.push(i);
        }
      }

      if (positions.length === 0) continue;

      totalEntries += positions.length;
      console.log(
        "--- " + win.dayLabel + " " + win.windowLabel + " (" + win.key + ") ---",
      );
      console.log("Seq: " + seq.join(" "));

      for (const pos of positions) {
        const m = win.matches?.[pos];
        let nextGame: string;
        if (m) {
          nextGame = seq[pos] + " " + m.scoreLabel + " vs " + m.opponent;
        } else if (pos < seq.length) {
          nextGame = seq[pos] + " (sem detalhe)";
        } else {
          nextGame = "pendente";
        }

        if (pos < seq.length) {
          if (seq[pos] === "W") totalW++;
          else if (seq[pos] === "D") totalD++;
          else totalL++;
        }

        console.log(
          "  Entrada " + method.name + " no jogo " + (pos + 1) + ": proximo -> " + nextGame,
        );
      }
      console.log("");
    }

    const apx =
      totalEntries > 0
        ? Math.round((totalW / totalEntries) * 10000) / 100
        : 0;
    console.log("========================================");
    console.log("TOTAL ENTRADAS " + method.name + " (Arthur): " + totalEntries);
    console.log(
      "Resultados do proximo jogo: " + totalW + "W " + totalD + "D " + totalL + "L",
    );
    console.log("APX (vitoria apos " + method.name + "): " + apx + "%");
  }
  process.exit(0);
})();
