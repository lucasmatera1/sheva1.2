import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

type SeqResult = "W" | "D" | "L";

interface MatchRow {
  id_fixture: number;
  match_kickoff: Date;
  home_player: string;
  away_player: string;
  home_score_ft: number | null;
  away_score_ft: number | null;
  grupo: string | null;
}

interface PlayerMatch {
  kickoff: Date;
  opponent: string;
  result: SeqResult;
  scoreLabel: string;
  fixtureId: number;
  grupo: string | null;
}

interface StreakEntry {
  streakLen: number; // 3 or 4
  streakMatches: PlayerMatch[]; // the 3 or 4 losses
  nextMatch: PlayerMatch | null; // what happened next (null = no next game yet)
  dayKey: string; // day when the streak completed
}

function getResult(
  match: MatchRow,
  playerName: string,
): SeqResult | null {
  if (match.home_score_ft == null || match.away_score_ft == null) return null;
  const isHome =
    match.home_player.trim().toUpperCase() ===
    playerName.trim().toUpperCase();
  const myScore = isHome ? match.home_score_ft : match.away_score_ft;
  const oppScore = isHome ? match.away_score_ft : match.home_score_ft;
  if (myScore > oppScore) return "W";
  if (myScore < oppScore) return "L";
  return "D";
}

function formatDate(d: Date): string {
  return d.toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" });
}

function formatDay(d: Date): string {
  return d.toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" });
}

function formatTime(d: Date): string {
  return d.toLocaleTimeString("pt-BR", {
    timeZone: "America/Sao_Paulo",
    hour: "2-digit",
    minute: "2-digit",
  });
}

void (async () => {
  const now = new Date();
  const cutoff = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

  console.log(`\nPeríodo: ${formatDate(cutoff)} → ${formatDate(now)}`);
  console.log(`Analisando GT League — jogadores com WR > 40%\n`);

  // 1. Load all GT League fixtures in the last 30 days
  const fixtures = await prisma.gt_gtapi_fixtures.findMany({
    where: {
      match_kickoff: { gte: cutoff },
      home_score_ft: { not: null },
      away_score_ft: { not: null },
    },
    select: {
      id_fixture: true,
      match_kickoff: true,
      home_player: true,
      away_player: true,
      home_score_ft: true,
      away_score_ft: true,
      grupo: true,
    },
    orderBy: { match_kickoff: "asc" },
  });

  console.log(`Total de fixtures carregados: ${fixtures.length}`);

  // 2. Build per-player match list (chronological)
  const playerMatchesMap = new Map<string, PlayerMatch[]>();

  function addMatch(player: string, match: PlayerMatch) {
    const key = player.trim().toUpperCase();
    if (!playerMatchesMap.has(key)) playerMatchesMap.set(key, []);
    playerMatchesMap.get(key)!.push(match);
  }

  for (const f of fixtures) {
    const homeResult = getResult(f as MatchRow, f.home_player);
    const awayResult = getResult(f as MatchRow, f.away_player);
    if (homeResult) {
      addMatch(f.home_player, {
        kickoff: f.match_kickoff,
        opponent: f.away_player,
        result: homeResult,
        scoreLabel: `${f.home_score_ft}-${f.away_score_ft}`,
        fixtureId: f.id_fixture,
        grupo: f.grupo,
      });
    }
    if (awayResult) {
      addMatch(f.away_player, {
        kickoff: f.match_kickoff,
        opponent: f.home_player,
        result: awayResult,
        scoreLabel: `${f.home_score_ft}-${f.away_score_ft}`,
        fixtureId: f.id_fixture,
        grupo: f.grupo,
      });
    }
  }

  // 3. Sort each player's matches chronologically
  for (const matches of playerMatchesMap.values()) {
    matches.sort((a, b) => a.kickoff.getTime() - b.kickoff.getTime());
  }

  // 4. Filter players with win rate > 40%
  const qualifiedPlayers: {
    name: string;
    matches: PlayerMatch[];
    wins: number;
    total: number;
    winRate: number;
  }[] = [];

  for (const [name, matches] of playerMatchesMap.entries()) {
    const wins = matches.filter((m) => m.result === "W").length;
    const total = matches.length;
    const winRate = total > 0 ? (wins / total) * 100 : 0;
    if (winRate > 40) {
      qualifiedPlayers.push({ name, matches, wins, total, winRate });
    }
  }

  qualifiedPlayers.sort((a, b) => b.winRate - a.winRate);

  console.log(
    `\nJogadores com WR > 40%: ${qualifiedPlayers.length} de ${playerMatchesMap.size} total\n`,
  );
  console.log("─".repeat(70));
  console.log(
    "  Jogador".padEnd(22) +
      "Jogos".padEnd(8) +
      "W".padEnd(6) +
      "D".padEnd(6) +
      "L".padEnd(6) +
      "WR%",
  );
  console.log("─".repeat(70));
  for (const p of qualifiedPlayers) {
    const draws = p.matches.filter((m) => m.result === "D").length;
    const losses = p.matches.filter((m) => m.result === "L").length;
    console.log(
      `  ${p.name.padEnd(20)}${String(p.total).padEnd(8)}${String(p.wins).padEnd(6)}${String(draws).padEnd(6)}${String(losses).padEnd(6)}${p.winRate.toFixed(1)}%`,
    );
  }

  // 5. Detect 4L and 3L streaks, and what happened next
  function findStreaks(
    matches: PlayerMatch[],
    streakLen: number,
  ): StreakEntry[] {
    const entries: StreakEntry[] = [];
    for (let i = streakLen - 1; i < matches.length; i++) {
      // Check if positions [i-streakLen+1 .. i] are all losses
      let allLosses = true;
      for (let j = i - streakLen + 1; j <= i; j++) {
        if (matches[j].result !== "L") {
          allLosses = false;
          break;
        }
      }
      if (!allLosses) continue;

      // Ensure it's exactly streakLen (not part of a longer streak)
      // For 3L: the match before must NOT be L (or not exist)
      // For 4L: the match before must NOT be L (or not exist)
      const prevIdx = i - streakLen;
      if (prevIdx >= 0 && matches[prevIdx].result === "L") continue;

      // Also skip if this exact streak was already reported as part of a longer 4L
      // (For 3L: skip if the next match is also L, since that whole run would be a 4L)
      // Actually, let's report ALL exact-length sequences. If there are 5L, report:
      //  - 4L starting at position 0 (with next = match at pos 4)
      //  - not 3L from 0-2 since it extends to 4L
      // The user wants "every 3L sequence" and "every 4L sequence" separately.
      // Let's just report the exact streak length matches.

      const streakMatches = matches.slice(i - streakLen + 1, i + 1);
      const nextMatch = i + 1 < matches.length ? matches[i + 1] : null;
      const lastStreakMatch = streakMatches[streakMatches.length - 1];

      entries.push({
        streakLen,
        streakMatches,
        nextMatch,
        dayKey: formatDay(lastStreakMatch.kickoff),
      });
    }
    return entries;
  }

  // Helper: build day-by-day sequence for a player
  function buildDaySequences(
    matches: PlayerMatch[],
  ): Map<string, PlayerMatch[]> {
    const dayMap = new Map<string, PlayerMatch[]>();
    for (const m of matches) {
      const day = formatDay(m.kickoff);
      if (!dayMap.has(day)) dayMap.set(day, []);
      dayMap.get(day)!.push(m);
    }
    return dayMap;
  }

  // ====== 4 LOSSES ANALYSIS ======
  console.log(
    `\n\n${"═".repeat(70)}\n  SEQUÊNCIAS DE 4 DERROTAS CONSECUTIVAS (e o próximo jogo)\n${"═".repeat(70)}`,
  );

  let total4L = 0;
  let total4L_nextW = 0;
  let total4L_nextD = 0;
  let total4L_nextL = 0;
  let total4L_noPending = 0;

  for (const p of qualifiedPlayers) {
    const streaks = findStreaks(p.matches, 4);
    if (streaks.length === 0) continue;

    const daySeqs = buildDaySequences(p.matches);

    console.log(
      `\n  ▸ ${p.name} (WR ${p.winRate.toFixed(1)}%, ${p.total} jogos) — ${streaks.length} ocorrência(s) de 4L`,
    );

    for (const s of streaks) {
      total4L++;
      console.log(`\n    Sequência 4L completada em ${s.dayKey}:`);

      // Show each loss in the streak
      for (let idx = 0; idx < s.streakMatches.length; idx++) {
        const m = s.streakMatches[idx];
        console.log(
          `      ${idx + 1}ª derrota: ${formatTime(m.kickoff)} ${formatDay(m.kickoff)} — ${m.scoreLabel} vs ${m.opponent} (${m.grupo ?? "?"})`,
        );
      }

      if (s.nextMatch) {
        const icon =
          s.nextMatch.result === "W"
            ? "✅"
            : s.nextMatch.result === "D"
              ? "🟡"
              : "❌";
        console.log(
          `    → Próximo jogo: ${icon} ${s.nextMatch.result} ${formatTime(s.nextMatch.kickoff)} ${formatDay(s.nextMatch.kickoff)} — ${s.nextMatch.scoreLabel} vs ${s.nextMatch.opponent} (${s.nextMatch.grupo ?? "?"})`,
        );
        if (s.nextMatch.result === "W") total4L_nextW++;
        else if (s.nextMatch.result === "D") total4L_nextD++;
        else total4L_nextL++;
      } else {
        console.log(
          `    → Próximo jogo: ⏳ Ainda não jogou após a sequência`,
        );
        total4L_noPending++;
      }

      // Show full day sequence for context
      const completionDay = s.dayKey;
      const dayMatches = daySeqs.get(completionDay);
      if (dayMatches) {
        const daySeqStr = dayMatches
          .map(
            (dm) =>
              `${dm.result}(${formatTime(dm.kickoff)} vs ${dm.opponent})`,
          )
          .join(" → ");
        console.log(`    Sequência do dia ${completionDay}: ${daySeqStr}`);
      }
    }
  }

  console.log(`\n${"─".repeat(70)}`);
  console.log(`  RESUMO 4 DERROTAS CONSECUTIVAS:`);
  console.log(`    Total de sequências: ${total4L}`);
  if (total4L > 0) {
    const resolved = total4L - total4L_noPending;
    console.log(`    Próximo jogo W: ${total4L_nextW} (${resolved > 0 ? ((total4L_nextW / resolved) * 100).toFixed(1) : 0}%)`);
    console.log(`    Próximo jogo D: ${total4L_nextD} (${resolved > 0 ? ((total4L_nextD / resolved) * 100).toFixed(1) : 0}%)`);
    console.log(`    Próximo jogo L: ${total4L_nextL} (${resolved > 0 ? ((total4L_nextL / resolved) * 100).toFixed(1) : 0}%)`);
    if (total4L_noPending > 0) console.log(`    Pendentes: ${total4L_noPending}`);
  }

  // ====== 3 LOSSES ANALYSIS ======
  console.log(
    `\n\n${"═".repeat(70)}\n  SEQUÊNCIAS DE 3 DERROTAS CONSECUTIVAS (e o próximo jogo)\n${"═".repeat(70)}`,
  );

  let total3L = 0;
  let total3L_nextW = 0;
  let total3L_nextD = 0;
  let total3L_nextL = 0;
  let total3L_noPending = 0;

  for (const p of qualifiedPlayers) {
    const streaks = findStreaks(p.matches, 3);
    if (streaks.length === 0) continue;

    const daySeqs = buildDaySequences(p.matches);

    console.log(
      `\n  ▸ ${p.name} (WR ${p.winRate.toFixed(1)}%, ${p.total} jogos) — ${streaks.length} ocorrência(s) de 3L`,
    );

    for (const s of streaks) {
      total3L++;
      console.log(`\n    Sequência 3L completada em ${s.dayKey}:`);

      for (let idx = 0; idx < s.streakMatches.length; idx++) {
        const m = s.streakMatches[idx];
        console.log(
          `      ${idx + 1}ª derrota: ${formatTime(m.kickoff)} ${formatDay(m.kickoff)} — ${m.scoreLabel} vs ${m.opponent} (${m.grupo ?? "?"})`,
        );
      }

      if (s.nextMatch) {
        const icon =
          s.nextMatch.result === "W"
            ? "✅"
            : s.nextMatch.result === "D"
              ? "🟡"
              : "❌";
        console.log(
          `    → Próximo jogo: ${icon} ${s.nextMatch.result} ${formatTime(s.nextMatch.kickoff)} ${formatDay(s.nextMatch.kickoff)} — ${s.nextMatch.scoreLabel} vs ${s.nextMatch.opponent} (${s.nextMatch.grupo ?? "?"})`,
        );
        if (s.nextMatch.result === "W") total3L_nextW++;
        else if (s.nextMatch.result === "D") total3L_nextD++;
        else total3L_nextL++;
      } else {
        console.log(
          `    → Próximo jogo: ⏳ Ainda não jogou após a sequência`,
        );
        total3L_noPending++;
      }

      const completionDay = s.dayKey;
      const dayMatches = daySeqs.get(completionDay);
      if (dayMatches) {
        const daySeqStr = dayMatches
          .map(
            (dm) =>
              `${dm.result}(${formatTime(dm.kickoff)} vs ${dm.opponent})`,
          )
          .join(" → ");
        console.log(`    Sequência do dia ${completionDay}: ${daySeqStr}`);
      }
    }
  }

  console.log(`\n${"─".repeat(70)}`);
  console.log(`  RESUMO 3 DERROTAS CONSECUTIVAS:`);
  console.log(`    Total de sequências: ${total3L}`);
  if (total3L > 0) {
    const resolved = total3L - total3L_noPending;
    console.log(`    Próximo jogo W: ${total3L_nextW} (${resolved > 0 ? ((total3L_nextW / resolved) * 100).toFixed(1) : 0}%)`);
    console.log(`    Próximo jogo D: ${total3L_nextD} (${resolved > 0 ? ((total3L_nextD / resolved) * 100).toFixed(1) : 0}%)`);
    console.log(`    Próximo jogo L: ${total3L_nextL} (${resolved > 0 ? ((total3L_nextL / resolved) * 100).toFixed(1) : 0}%)`);
    if (total3L_noPending > 0) console.log(`    Pendentes: ${total3L_noPending}`);
  }

  // ====== COMBINED SUMMARY ======
  console.log(
    `\n\n${"═".repeat(70)}\n  TABELA COMPARATIVA\n${"═".repeat(70)}`,
  );

  const resolved3 = total3L - total3L_noPending;
  const resolved4 = total4L - total4L_noPending;

  console.log(
    "\n  Streak".padEnd(14) +
      "Total".padEnd(10) +
      "→ W".padEnd(10) +
      "→ D".padEnd(10) +
      "→ L".padEnd(10) +
      "APX (W%)",
  );
  console.log("  " + "─".repeat(58));
  console.log(
    `  ${"3L".padEnd(12)}${String(total3L).padEnd(10)}${String(total3L_nextW).padEnd(10)}${String(total3L_nextD).padEnd(10)}${String(total3L_nextL).padEnd(10)}${resolved3 > 0 ? ((total3L_nextW / resolved3) * 100).toFixed(1) : "N/A"}%`,
  );
  console.log(
    `  ${"4L".padEnd(12)}${String(total4L).padEnd(10)}${String(total4L_nextW).padEnd(10)}${String(total4L_nextD).padEnd(10)}${String(total4L_nextL).padEnd(10)}${resolved4 > 0 ? ((total4L_nextW / resolved4) * 100).toFixed(1) : "N/A"}%`,
  );

  // ====== PER-PLAYER TABLE: 3 LOSSES ======
  function buildPlayerTable(streakLen: number) {
    const rows: {
      name: string;
      wr: number;
      total: number;
      nextW: number;
      nextD: number;
      nextL: number;
      pending: number;
    }[] = [];

    for (const p of qualifiedPlayers) {
      const streaks = findStreaks(p.matches, streakLen);
      if (streaks.length === 0) continue;
      let nW = 0, nD = 0, nL = 0, nP = 0;
      for (const s of streaks) {
        if (!s.nextMatch) { nP++; continue; }
        if (s.nextMatch.result === "W") nW++;
        else if (s.nextMatch.result === "D") nD++;
        else nL++;
      }
      rows.push({
        name: p.name,
        wr: p.winRate,
        total: streaks.length,
        nextW: nW,
        nextD: nD,
        nextL: nL,
        pending: nP,
      });
    }
    rows.sort((a, b) => b.total - a.total);
    return rows;
  }

  function printPlayerTable(streakLen: number) {
    const rows = buildPlayerTable(streakLen);
    console.log(
      `\n\n${"═".repeat(80)}\n  TABELA POR JOGADOR — ${streakLen} DERROTAS CONSECUTIVAS (próximo jogo)\n${"═".repeat(80)}`,
    );
    const hdr =
      "  " +
      "Jogador".padEnd(18) +
      "WR%".padEnd(8) +
      "Seq".padEnd(6) +
      "→ W".padEnd(8) +
      "→ D".padEnd(8) +
      "→ L".padEnd(8) +
      "APX%".padEnd(8) +
      "Pend";
    console.log(hdr);
    console.log("  " + "─".repeat(74));

    let tSeq = 0, tW = 0, tD = 0, tL = 0, tP = 0;
    for (const r of rows) {
      const resolved = r.total - r.pending;
      const apx = resolved > 0 ? ((r.nextW / resolved) * 100).toFixed(1) : "—";
      console.log(
        "  " +
          r.name.padEnd(18) +
          `${r.wr.toFixed(1)}%`.padEnd(8) +
          String(r.total).padEnd(6) +
          String(r.nextW).padEnd(8) +
          String(r.nextD).padEnd(8) +
          String(r.nextL).padEnd(8) +
          `${apx}%`.padEnd(8) +
          String(r.pending),
      );
      tSeq += r.total;
      tW += r.nextW;
      tD += r.nextD;
      tL += r.nextL;
      tP += r.pending;
    }
    console.log("  " + "─".repeat(74));
    const tRes = tSeq - tP;
    const tApx = tRes > 0 ? ((tW / tRes) * 100).toFixed(1) : "—";
    console.log(
      "  " +
        "TOTAL".padEnd(18) +
        "".padEnd(8) +
        String(tSeq).padEnd(6) +
        String(tW).padEnd(8) +
        String(tD).padEnd(8) +
        String(tL).padEnd(8) +
        `${tApx}%`.padEnd(8) +
        String(tP),
    );
  }

  printPlayerTable(3);
  printPlayerTable(4);

  await prisma.$disconnect();
  process.exit(0);
})();
