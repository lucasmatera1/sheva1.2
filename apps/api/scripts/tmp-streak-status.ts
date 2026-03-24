import { getDashboardLeagueCurrentJLive } from "../src/core/live-analytics";

void (async () => {
  const snap = await getDashboardLeagueCurrentJLive("GT LEAGUE", { scope: "window" });
  const result = snap.players
    .map((p) => {
      const seq = p.daySequence;
      let trailingW = 0;
      for (let i = seq.length - 1; i >= 0; i--) {
        if (seq[i] === "W") trailingW++;
        else break;
      }
      let trailingL = 0;
      for (let i = seq.length - 1; i >= 0; i--) {
        if (seq[i] === "L") trailingL++;
        else break;
      }
      let trailingNoW = 0;
      for (let i = seq.length - 1; i >= 0; i--) {
        if (seq[i] !== "W") trailingNoW++;
        else break;
      }
      return {
        name: p.name,
        trailingW,
        trailingL,
        trailingNoW,
        last8: seq.slice(-8).join(" "),
        upcoming: p.upcomingFixtures.length,
        nextAt: p.nextFixtureAt,
      };
    })
    .sort(
      (a, b) =>
        Math.max(b.trailingW, b.trailingL, b.trailingNoW) -
        Math.max(a.trailingW, a.trailingL, a.trailingNoW),
    );

  console.log("Jogador       W    L    NoW  Ultimos 8           Prox  Status");
  console.log("-".repeat(85));

  for (const p of result) {
    const tags: string[] = [];
    if (p.trailingW >= 4) tags.push("** JA ENTROU 4W **");
    else if (p.trailingW === 3) tags.push("4W: falta 1W");
    if (p.trailingL >= 4) tags.push("** JA ENTROU 4D **");
    else if (p.trailingL === 3) tags.push("4D: falta 1L");
    if (p.trailingNoW >= 5) tags.push("** JA ENTROU 5D- **");
    else if (p.trailingNoW === 4) tags.push("5D-: falta 1 sem W");
    else if (p.trailingNoW === 3) tags.push("5D-: falta 2 sem W");

    const status = tags.length > 0 ? tags.join(" | ") : "-";
    console.log(
      `${p.name.padEnd(14)}${String(p.trailingW).padEnd(5)}${String(p.trailingL).padEnd(5)}${String(p.trailingNoW).padEnd(5)}${p.last8.padEnd(20)}${String(p.upcoming).padEnd(6)}${status}`,
    );
  }

  process.exit(0);
})();
