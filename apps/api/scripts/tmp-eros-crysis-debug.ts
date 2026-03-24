import { PrismaClient } from "@prisma/client";
import { config } from "dotenv";
config({ path: "../../.env" });

const prisma = new PrismaClient();

async function main() {
  const p1 = "Eros";
  const p2 = "Crysis";
  // Wider range to see confrontation history
  const start = new Date("2026-03-01T00:00:00.000Z");
  const end = new Date("2026-03-21T06:00:00.000Z");

  const rows = await prisma.gt_gtapi_fixtures.findMany({
    where: {
      match_kickoff: { gte: start, lt: end },
      OR: [
        { home_player: { contains: p1 }, away_player: { contains: p2 } },
        { home_player: { contains: p2 }, away_player: { contains: p1 } },
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
    const hs = r.home_score_ft;
    const as2 = r.away_score_ft;
    // Result from Eros perspective
    const isErosHome = (r.home_player ?? "").toLowerCase().includes("eros");
    const erosScore = isErosHome ? hs : as2;
    const oppScore = isErosHome ? as2 : hs;
    const res = erosScore == null || oppScore == null ? "?" : erosScore > oppScore ? "W" : erosScore < oppScore ? "L" : "D";

    const sep = prevSeason !== null && Number(r.id_season) !== prevSeason ? "\n---" : "";
    if (sep) console.log(sep);
    prevSeason = Number(r.id_season);

    console.log(
      r.match_kickoff.toISOString().slice(0, 19).replace("T", " "),
      `s=${r.id_season}`,
      `Eros:${res}`.padEnd(8),
      `${erosScore}-${oppScore}`.padEnd(5),
      `${r.home_player} vs ${r.away_player}`.padEnd(30),
      r.grupo ?? "",
    );
  }
  console.log("\nTotal:", rows.length);

  // Also check future matches
  const future = await prisma.gt_gtapi_futurematches.findMany({
    where: {
      OR: [
        { home_player: { contains: p1 }, away_player: { contains: p2 } },
        { home_player: { contains: p2 }, away_player: { contains: p1 } },
      ],
    },
    select: {
      id_fixture: true,
      id_season: true,
      match_kickoff: true,
      home_player: true,
      away_player: true,
      grupo: true,
    },
    orderBy: { match_kickoff: "asc" },
  });
  console.log("\nFuture matches:", future.length);
  for (const r of future) {
    console.log(
      r.match_kickoff.toISOString().slice(0, 19).replace("T", " "),
      `s=${r.id_season}`,
      `${r.home_player} vs ${r.away_player}`,
      r.grupo ?? "",
    );
  }

  await prisma.$disconnect();
}
main();
