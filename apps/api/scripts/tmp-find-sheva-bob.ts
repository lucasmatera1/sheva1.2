import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function searchTable(name: string, findMany: () => Promise<any[]>) {
  console.log(`\n=== ${name} ===`);
  const rows = await findMany();
  console.log(`Found: ${rows.length}`);
  const byDate: Record<string, any[]> = {};
  for (const r of rows) {
    const d = new Date(r.match_kickoff).toISOString().slice(0, 10);
    (byDate[d] ??= []).push(r);
  }
  for (const [date, games] of Object.entries(byDate).sort()) {
    console.log(`  ${date}: ${games.length} jogos`);
    for (const g of games) {
      const t = new Date(g.match_kickoff).toISOString().slice(11, 16);
      console.log(`    ${t} | ${g.home_player} vs ${g.away_player} | status=${g.match_status} | ${g.home_score_ft ?? "?"}-${g.away_score_ft ?? "?"}`);
    }
  }
  return rows;
}

async function main() {
  // Direct confrontations only: Sheva vs Bob (either side), March 2026
  const confrontFilter = {
    OR: [
      { AND: [{ home_player: { contains: "Sheva" } }, { away_player: { contains: "Bob" } }] },
      { AND: [{ home_player: { contains: "Bob" } }, { away_player: { contains: "Sheva" } }] },
    ],
    match_kickoff: { gte: new Date("2026-03-01T00:00:00Z"), lt: new Date("2026-04-01T00:00:00Z") },
  };

  await searchTable("h2h_h2hapi_fixtures", () =>
    prisma.h2h_h2hapi_fixtures.findMany({
      where: confrontFilter,
      select: { id_fixture: true, match_kickoff: true, home_player: true, away_player: true, match_status: true, home_score_ft: true, away_score_ft: true },
      orderBy: { match_kickoff: "asc" },
      take: 200,
    })
  );

  await searchTable("h2h_ebasket_fixtures", () =>
    prisma.h2h_ebasket_fixtures.findMany({
      where: confrontFilter,
      select: { id_fixture: true, match_kickoff: true, home_player: true, away_player: true, match_status: true, home_score_ft: true, away_score_ft: true },
      orderBy: { match_kickoff: "asc" },
      take: 200,
    })
  );

  await searchTable("gt_gtapi_fixtures", () =>
    prisma.gt_gtapi_fixtures.findMany({
      where: confrontFilter,
      select: { id_fixture: true, match_kickoff: true, home_player: true, away_player: true, match_status: true, home_score_ft: true, away_score_ft: true },
      orderBy: { match_kickoff: "asc" },
      take: 200,
    })
  );

  await searchTable("ebattle_ebattleapi_fixtures", () =>
    prisma.ebattle_ebattleapi_fixtures.findMany({
      where: confrontFilter,
      select: { id_fixture: true, match_kickoff: true, home_player: true, away_player: true, match_status: true, home_score_ft: true, away_score_ft: true },
      orderBy: { match_kickoff: "asc" },
      take: 200,
    })
  );

  await searchTable("volta_ebattleapi_fixtures", () =>
    prisma.volta_ebattleapi_fixtures.findMany({
      where: confrontFilter,
      select: { id_fixture: true, match_kickoff: true, home_player: true, away_player: true, match_status: true, home_score_ft: true, away_score_ft: true },
      orderBy: { match_kickoff: "asc" },
      take: 200,
    })
  );

  await prisma.$disconnect();
  process.exit(0);
}

main();
