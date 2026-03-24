import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

type MatchResult = "W" | "D" | "L";
type StreakType = "W" | "L";

type PlayerMatch = {
  localMonth: string;
  result: MatchResult;
};

type Aggregate = {
  player: string;
  streakType: StreakType;
  streakLength: number;
  totalOccurrences: number;
  nextWins: number;
  nextLosses: number;
};

function toSaoPauloDateParts(value: Date) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(value);

  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? "00";

  return {
    year: get("year"),
    month: get("month"),
  };
}

function toLocalMonthKey(value: Date) {
  const parts = toSaoPauloDateParts(value);
  return `${parts.year}-${parts.month}`;
}

function toPlayerResult(homePlayer: string | null, awayPlayer: string | null, homeScore: number | null, awayScore: number | null, player: string) {
  const normalizedPlayer = player.toUpperCase();
  const isHome = (homePlayer ?? "").toUpperCase() === normalizedPlayer;
  const goalsFor = isHome ? homeScore : awayScore;
  const goalsAgainst = isHome ? awayScore : homeScore;

  if (goalsFor === null || goalsAgainst === null) return "D";
  if (goalsFor > goalsAgainst) return "W";
  if (goalsFor < goalsAgainst) return "L";
  return "D";
}

async function main() {
  const minOccurrences = 3;
  const minRate = 70;
  const utcStart = new Date("2026-02-28T00:00:00Z");
  const utcEnd = new Date("2026-04-01T23:59:59Z");

  const rows = await prisma.gt_gtapi_fixtures.findMany({
    where: {
      match_kickoff: { gte: utcStart, lt: utcEnd },
    },
    orderBy: [{ match_kickoff: "asc" }, { id_fixture: "asc" }],
  });

  const players = new Set<string>();
  for (const row of rows) {
    if (row.home_player) players.add(row.home_player.toUpperCase());
    if (row.away_player) players.add(row.away_player.toUpperCase());
  }

  const playerMatchesMap = new Map<string, PlayerMatch[]>();

  for (const player of players) {
    const matches = rows
      .filter((row) => {
        const homePlayer = (row.home_player ?? "").toUpperCase();
        const awayPlayer = (row.away_player ?? "").toUpperCase();
        return homePlayer === player || awayPlayer === player;
      })
      .map((row) => ({
        localMonth: toLocalMonthKey(row.match_kickoff),
        result: toPlayerResult(row.home_player, row.away_player, row.home_score_ft, row.away_score_ft, player),
      }))
      .filter((match) => match.localMonth === "2026-03");

    if (matches.length > 0) {
      playerMatchesMap.set(player, matches);
    }
  }

  const aggregates = new Map<string, Aggregate>();

  for (const [player, matches] of playerMatchesMap.entries()) {
    let currentStart = 0;

    while (currentStart < matches.length) {
      const currentResult = matches[currentStart]?.result;
      if (currentResult !== "W" && currentResult !== "L") {
        currentStart += 1;
        continue;
      }

      let currentEnd = currentStart;
      while (currentEnd + 1 < matches.length && matches[currentEnd + 1]?.result === currentResult) {
        currentEnd += 1;
      }

      const nextMatch = matches[currentEnd + 1];
      if (nextMatch && (nextMatch.result === "W" || nextMatch.result === "L")) {
        const streakLength = currentEnd - currentStart + 1;
        const key = `${player}|${currentResult}|${streakLength}`;
        const existing = aggregates.get(key) ?? {
          player,
          streakType: currentResult,
          streakLength,
          totalOccurrences: 0,
          nextWins: 0,
          nextLosses: 0,
        };

        existing.totalOccurrences += 1;
        if (nextMatch.result === "W") existing.nextWins += 1;
        if (nextMatch.result === "L") existing.nextLosses += 1;

        aggregates.set(key, existing);
      }

      currentStart = currentEnd + 1;
    }
  }

  const results = Array.from(aggregates.values())
    .map((item) => ({
      ...item,
      rate: Number(((item.nextWins / item.totalOccurrences) * 100).toFixed(2)),
    }))
    .filter((item) => item.totalOccurrences >= minOccurrences && item.rate > minRate)
    .sort((left, right) => {
      if (right.totalOccurrences !== left.totalOccurrences) return right.totalOccurrences - left.totalOccurrences;
      if (right.rate !== left.rate) return right.rate - left.rate;
      if (left.player !== right.player) return left.player.localeCompare(right.player);
      if (left.streakType !== right.streakType) return left.streakType.localeCompare(right.streakType);
      return left.streakLength - right.streakLength;
    });

  for (const item of results) {
    console.log(`${item.player} ${item.streakType}${item.streakLength} ${item.nextWins}/${item.totalOccurrences} ${item.rate}%`);
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