import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

function normalize(value) {
  return String(value ?? "").trim().toLowerCase();
}

async function main() {
  const rows = await prisma.ebattle_ebattleapi_fixtures.findMany({
    where: {
      season_name: {
        startsWith: "Volta",
      },
    },
    select: {
      id_fixture: true,
      season_name: true,
      match_kickoff: true,
      home_player: true,
      away_player: true,
      home_score_ft: true,
      away_score_ft: true,
    },
    orderBy: {
      match_kickoff: "asc",
    },
  });

  const filtered = rows.filter((row) => {
    const home = normalize(row.home_player);
    const away = normalize(row.away_player);
    return [home, away].includes("sheva") && [home, away].includes("fantazer");
  });

  console.log(`count=${filtered.length}`);
  for (const row of filtered) {
    console.log(`${row.id_fixture} | ${new Date(row.match_kickoff).toISOString()} | ${row.home_player} x ${row.away_player} | ${row.home_score_ft}-${row.away_score_ft} | ${row.season_name}`);
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });