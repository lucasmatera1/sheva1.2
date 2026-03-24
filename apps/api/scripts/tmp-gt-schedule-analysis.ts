import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();

function toBrt(d: Date) {
  return d.toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
}
function toBrtHour(d: Date) {
  return d.toLocaleTimeString("pt-BR", { timeZone: "America/Sao_Paulo", hour: "2-digit", minute: "2-digit" });
}

async function main() {
  const start = new Date("2026-03-14T00:00:00.000Z");
  const end = new Date("2026-03-20T00:00:00.000Z");

  const rows = await prisma.gt_gtapi_fixtures.findMany({
    where: { match_kickoff: { gte: start, lt: end } },
    select: { match_kickoff: true, home_player: true, away_player: true, id_fixture: true, id_season: true },
    orderBy: { match_kickoff: "asc" },
  });

  // Agrupar por id_season
  const bySeason = new Map<number, typeof rows>();
  for (const r of rows) {
    const sid = r.id_season ?? 0;
    if (!bySeason.has(sid)) bySeason.set(sid, []);
    bySeason.get(sid)!.push(r);
  }

  // Seasons do mesmo grupo de jogadores = mesma "grade"
  // Agrupar seasons em grades por players
  console.log("=== SEASONS AGRUPADAS EM GRADES ===");
  const gradeMap = new Map<string, Array<{ seasonId: number; fixtures: typeof rows }>>();

  for (const [sid, fixtures] of bySeason) {
    const players = new Set<string>();
    for (const f of fixtures) {
      players.add(f.home_player);
      players.add(f.away_player);
    }
    const key = [...players].sort().join(",");
    if (!gradeMap.has(key)) gradeMap.set(key, []);
    gradeMap.get(key)!.push({ seasonId: sid, fixtures });
  }

  for (const [playersKey, seasons] of gradeMap) {
    seasons.sort((a, b) => a.fixtures[0].match_kickoff.getTime() - b.fixtures[0].match_kickoff.getTime());

    // Detectar séries (3 seasons consecutivas por dia/faixa)
    const series: Array<Array<typeof seasons[0]>> = [];
    let currentSeries = [seasons[0]];

    for (let i = 1; i < seasons.length; i++) {
      const lastEnd = currentSeries[currentSeries.length - 1].fixtures.at(-1)!.match_kickoff;
      const nextStart = seasons[i].fixtures[0].match_kickoff;
      const gap = (nextStart.getTime() - lastEnd.getTime()) / 60000;

      if (gap <= 45) {
        currentSeries.push(seasons[i]);
      } else {
        series.push(currentSeries);
        currentSeries = [seasons[i]];
      }
    }
    series.push(currentSeries);

    console.log(`\nPlayers: ${playersKey}`);
    for (const s of series) {
      const allFixtures = s.flatMap((x) => x.fixtures);
      const first = allFixtures[0].match_kickoff;
      const last = allFixtures[allFixtures.length - 1].match_kickoff;
      const seasonIds = s.map((x) => x.seasonId).join(", ");

      // Classificar J baseado na hora BRT do primeiro jogo
      const firstHourBrt = Number(toBrtHour(first).split(":")[0]);
      let jLabel: string;
      if (firstHourBrt >= 1 && firstHourBrt < 9) jLabel = "J1";
      else if (firstHourBrt >= 9 && firstHourBrt < 17) jLabel = "J2";
      else jLabel = "J3";

      console.log(`  ${jLabel} | ${allFixtures.length} jogos | ${toBrt(first)} → ${toBrt(last)} | Seasons: ${seasonIds}`);
    }
  }

  // Agora análise POR JOGADOR com id_season
  console.log("\n\n=== POR JOGADOR: KEVIN ===");
  const kevinGames = rows
    .filter((r) => r.home_player === "Kevin" || r.away_player === "Kevin")
    .sort((a, b) => a.match_kickoff.getTime() - b.match_kickoff.getTime());

  // Agrupar por id_season
  const kevinBySeason = new Map<number, typeof rows>();
  for (const r of kevinGames) {
    const sid = r.id_season ?? 0;
    if (!kevinBySeason.has(sid)) kevinBySeason.set(sid, []);
    kevinBySeason.get(sid)!.push(r);
  }

  const kevinSeasons = [...kevinBySeason.entries()].sort((a, b) => a[1][0].match_kickoff.getTime() - b[1][0].match_kickoff.getTime());

  // Agrupar em grades
  const kevinGrades: Array<{ seasons: Array<{ sid: number; fixtures: typeof rows }>; jLabel: string }> = [];
  let curGradeSeasons: Array<{ sid: number; fixtures: typeof rows }> = [];

  for (const [sid, fixtures] of kevinSeasons) {
    if (curGradeSeasons.length > 0) {
      const lastEnd = curGradeSeasons[curGradeSeasons.length - 1].fixtures.at(-1)!.match_kickoff;
      const gap = (fixtures[0].match_kickoff.getTime() - lastEnd.getTime()) / 60000;
      if (gap > 45) {
        // Finalizar grade anterior
        const firstHourBrt = Number(toBrtHour(curGradeSeasons[0].fixtures[0].match_kickoff).split(":")[0]);
        let jLabel: string;
        if (firstHourBrt >= 1 && firstHourBrt < 9) jLabel = "J1";
        else if (firstHourBrt >= 9 && firstHourBrt < 17) jLabel = "J2";
        else jLabel = "J3";
        kevinGrades.push({ seasons: curGradeSeasons, jLabel });
        curGradeSeasons = [];
      }
    }
    curGradeSeasons.push({ sid, fixtures });
  }
  if (curGradeSeasons.length > 0) {
    const firstHourBrt = Number(toBrtHour(curGradeSeasons[0].fixtures[0].match_kickoff).split(":")[0]);
    let jLabel: string;
    if (firstHourBrt >= 1 && firstHourBrt < 9) jLabel = "J1";
    else if (firstHourBrt >= 9 && firstHourBrt < 17) jLabel = "J2";
    else jLabel = "J3";
    kevinGrades.push({ seasons: curGradeSeasons, jLabel });
  }

  for (const g of kevinGrades) {
    const allF = g.seasons.flatMap((s) => s.fixtures);
    const first = allF[0].match_kickoff;
    const last = allF[allF.length - 1].match_kickoff;
    const sids = g.seasons.map((s) => s.sid);
    console.log(`${g.jLabel} | ${allF.length} jogos | ${toBrt(first)} → ${toBrt(last)}`);
    for (const s of g.seasons) {
      console.log(`  Season ${s.sid}: ${s.fixtures.length} jogos | ${toBrt(s.fixtures[0].match_kickoff)} → ${toBrt(s.fixtures.at(-1)!.match_kickoff)}`);
    }
  }

  await prisma.$disconnect();
}

main();
