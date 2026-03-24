import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const p1 = "SHEVA";
  const p2 = "BOB";

  // Check both days: 14/03 and 15/03
  for (const date of ["2026-03-14", "2026-03-15"]) {
    const start = new Date(date + "T03:00:00Z");
    const end = new Date(
      new Date(start.getTime() + 24 * 60 * 60 * 1000).toISOString(),
    );

    const rows = await prisma.h2h_h2hapi_fixtures.findMany({
      where: {
        OR: [
          { home_player: p1, away_player: p2 },
          { home_player: p2, away_player: p1 },
        ],
        match_kickoff: { gte: start, lt: end },
      },
      select: {
        id_fixture: true,
        match_kickoff: true,
        home_player: true,
        away_player: true,
        home_score_ft: true,
        away_score_ft: true,
        match_status: true,
      },
      orderBy: { match_kickoff: "asc" },
    });

    console.log(`\n=== ${date} === (${rows.length} jogos encontrados)`);
    for (const r of rows) {
      const dt = new Date(r.match_kickoff).toISOString().slice(0, 19);
      console.log(
        `  ${dt} | ${r.home_player} ${r.home_score_ft}-${r.away_score_ft} ${r.away_player} | status: ${r.match_status} | id: ${r.id_fixture}`,
      );
    }
  }

  // Also check: are there games with different casing or name variants?
  const allSheva = await prisma.h2h_h2hapi_fixtures.findMany({
    where: {
      match_kickoff: {
        gte: new Date("2026-03-14T03:00:00Z"),
        lt: new Date("2026-03-16T03:00:00Z"),
      },
      OR: [
        { home_player: { contains: "SHEVA" } },
        { away_player: { contains: "SHEVA" } },
        { home_player: { contains: "BOB" } },
        { away_player: { contains: "BOB" } },
      ],
    },
    select: {
      id_fixture: true,
      match_kickoff: true,
      home_player: true,
      away_player: true,
      home_score_ft: true,
      away_score_ft: true,
      match_status: true,
    },
    orderBy: { match_kickoff: "asc" },
  });

  console.log(
    `\n=== Todos os jogos com SHEVA ou BOB (14-15/03): ${allSheva.length} ===`,
  );
  for (const r of allSheva) {
    const dt = new Date(r.match_kickoff).toISOString().slice(0, 19);
    const pair = `${r.home_player} vs ${r.away_player}`;
    console.log(
      `  ${dt} | ${pair.padEnd(30)} | ${r.home_score_ft}-${r.away_score_ft} | status: ${r.match_status}`,
    );
  }

  await prisma.$disconnect();
}

main();
