import { PrismaClient } from "@prisma/client";
import { config } from "dotenv";
config({ path: "../../.env" });

const prisma = new PrismaClient();

async function main() {
  const player = "Crysis";
  const start = new Date("2026-03-19T00:00:00.000Z");
  const end = new Date("2026-03-21T06:00:00.000Z");

  const rows = await prisma.gt_gtapi_fixtures.findMany({
    where: {
      match_kickoff: { gte: start, lt: end },
      OR: [
        { home_player: { contains: player } },
        { away_player: { contains: player } },
      ],
    },
    select: {
      id_fixture: true,
      id_season: true,
      match_kickoff: true,
      home_player: true,
      away_player: true,
      home_score_ft: true,
      away_score_ft: true,
      grupo: true,
    },
    orderBy: { match_kickoff: "asc" },
  });

  let prevSeason: number | null = null;
  for (const r of rows) {
    const isHome = (r.home_player ?? "").toLowerCase().includes(player.toLowerCase());
    const pScore = isHome ? r.home_score_ft : r.away_score_ft;
    const oScore = isHome ? r.away_score_ft : r.home_score_ft;
    const result = pScore == null || oScore == null ? "?" : pScore > oScore ? "W" : pScore < oScore ? "L" : "D";
    const sep = prevSeason !== null && r.id_season !== prevSeason ? "\n---" : "";
    if (sep) console.log(sep);
    prevSeason = r.id_season ? Number(r.id_season) : null;
    const opp = isHome ? r.away_player : r.home_player;
    console.log(
      r.match_kickoff.toISOString().slice(0, 19).replace("T", " "),
      `s=${r.id_season}`,
      result.padEnd(2),
      `${pScore}-${oScore}`.padEnd(5),
      `${player} vs ${opp}`.padEnd(30),
      r.grupo ?? "",
    );
  }
  console.log("\nTotal:", rows.length);
  await prisma.$disconnect();
}
main();
