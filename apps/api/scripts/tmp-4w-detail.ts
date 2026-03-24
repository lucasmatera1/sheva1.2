import { getDashboardLeagueCurrentJLive } from "../src/core/live-analytics";

type SeqResult = "W" | "D" | "L";

void (async () => {
  const snapshot = await getDashboardLeagueCurrentJLive("GT LEAGUE", {
    scope: "window",
  });
  const now = new Date();
  const cutoff = new Date(now.getTime() - 21 * 24 * 60 * 60 * 1000);
  const targets = ["BANEGA", "CYCLOP", "SPARK"];

  for (const playerName of targets) {
    const player = snapshot.players.find(
      (p) => p.name.toUpperCase() === playerName,
    );
    if (!player) {
      console.log(playerName + ": NAO ENCONTRADO");
      continue;
    }

    const windows = [
      {
        key:
          snapshot.currentWindow.dayKey +
          "|" +
          snapshot.currentWindow.windowLabel,
        dayLabel: snapshot.currentWindow.dayLabel,
        windowLabel: snapshot.currentWindow.windowLabel,
        sequence: player.daySequence,
        matches: player.recentMatches,
        latestPlayedAt: player.latestPlayedAt,
      },
      ...player.previousWindows.map((w) => ({
        key: w.key,
        dayLabel: w.dayLabel,
        windowLabel: w.windowLabel,
        sequence: w.sequence,
        matches: w.matches,
        latestPlayedAt: w.latestPlayedAt,
      })),
    ];

    console.log("\n========== " + playerName + " ==========");

    for (const win of windows) {
      if (win.latestPlayedAt && new Date(win.latestPlayedAt) < cutoff)
        continue;
      const seq: SeqResult[] = (win.sequence ?? []) as SeqResult[];

      // detect 4W entries
      const positions: number[] = [];
      for (let i = 1; i < seq.length; i++) {
        const before = seq.slice(0, i);
        const last4 = before.slice(-4);
        const last5 = before.slice(-5);
        if (
          last4.length === 4 &&
          last4.every((r) => r === "W") &&
          !(last5.length === 5 && last5.every((r) => r === "W"))
        ) {
          positions.push(i);
        }
      }
      if (positions.length === 0) continue;

      console.log(
        "\n  --- " +
          win.dayLabel +
          " " +
          win.windowLabel +
          " (" +
          win.key +
          ") ---",
      );
      console.log("  Sequencia: " + seq.join(" "));
      console.log("");
      console.log("  Historico completo:");
      const matches = win.matches ?? [];
      for (let i = 0; i < matches.length; i++) {
        const m = matches[i];
        const isEntry = positions.includes(i);
        const isPartOfStreak = positions.some((p) => i >= p - 4 && i < p);
        let tag = "";
        if (isEntry)
          tag = "  <<<< PROXIMO JOGO APOS 4W";
        else if (isPartOfStreak) tag = "  [4W streak]";
        console.log(
          "    Jogo " +
            String(i + 1).padStart(2) +
            ": " +
            seq[i] +
            " " +
            m.scoreLabel +
            " vs " +
            m.opponent +
            tag,
        );
      }
    }
  }
  process.exit(0);
})();
