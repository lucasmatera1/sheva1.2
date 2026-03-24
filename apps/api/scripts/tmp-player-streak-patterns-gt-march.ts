import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

type MatchResult = "W" | "D" | "L";
type StreakType = "W" | "L";
type NextResult = "W" | "L";

type PlayerMatch = {
  id_fixture: number;
  kickoff: Date;
  localMonth: string;
  localLabel: string;
  label: string;
  result: MatchResult;
};

type PatternAggregate = {
  player: string;
  streakType: StreakType;
  streakLength: number;
  nextResult: NextResult;
  occurrences: number;
  hits: number;
  rate: number;
  examples: Array<{
    streakStart: string;
    streakEnd: string;
    nextAt: string;
    streakLabels: string[];
    nextLabel: string;
  }>;
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
    day: get("day"),
    hour: get("hour"),
    minute: get("minute"),
    second: get("second"),
  };
}

function toLocalMonthKey(value: Date) {
  const parts = toSaoPauloDateParts(value);
  return `${parts.year}-${parts.month}`;
}

function toLocalLabel(value: Date) {
  const parts = toSaoPauloDateParts(value);
  return `${parts.day}/${parts.month}/${parts.year} ${parts.hour}:${parts.minute}:${parts.second}`;
}

function toPlayerResult(homePlayer: string | null, awayPlayer: string | null, homeScore: number | null, awayScore: number | null, player: string) {
  const normalizedPlayer = player.toUpperCase();
  const isHome = (homePlayer ?? "").toUpperCase() === normalizedPlayer;
  const goalsFor = isHome ? homeScore : awayScore;
  const goalsAgainst = isHome ? awayScore : homeScore;

  let result: MatchResult = "D";
  if (goalsFor !== null && goalsAgainst !== null) {
    if (goalsFor > goalsAgainst) result = "W";
    else if (goalsFor < goalsAgainst) result = "L";
  }

  return result;
}

async function main() {
  const minOccurrences = 3;
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
        id_fixture: row.id_fixture,
        kickoff: row.match_kickoff,
        localMonth: toLocalMonthKey(row.match_kickoff),
        localLabel: toLocalLabel(row.match_kickoff),
        label: `${row.home_player} x ${row.away_player}`,
        result: toPlayerResult(row.home_player, row.away_player, row.home_score_ft, row.away_score_ft, player),
      }))
      .filter((match) => match.localMonth === "2026-03");

    if (matches.length > 0) {
      playerMatchesMap.set(player, matches);
    }
  }

  const aggregates = new Map<string, PatternAggregate>();

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
        const nextResult = nextMatch.result;
        const key = `${player}|${currentResult}|${streakLength}|${nextResult}`;

        const existing = aggregates.get(key) ?? {
          player,
          streakType: currentResult,
          streakLength,
          nextResult,
          occurrences: 0,
          hits: 0,
          rate: 0,
          examples: [],
        };

        existing.occurrences += 1;
        existing.hits += 1;

        if (existing.examples.length < 3) {
          existing.examples.push({
            streakStart: matches[currentStart]?.localLabel ?? "",
            streakEnd: matches[currentEnd]?.localLabel ?? "",
            nextAt: nextMatch.localLabel,
            streakLabels: matches.slice(currentStart, currentEnd + 1).map((match) => `${match.localLabel} ${match.label}`),
            nextLabel: `${nextMatch.localLabel} ${nextMatch.label}`,
          });
        }

        aggregates.set(key, existing);
      }

      currentStart = currentEnd + 1;
    }
  }

  const grouped = new Map<string, PatternAggregate[]>();
  for (const aggregate of aggregates.values()) {
    const baseKey = `${aggregate.player}|${aggregate.streakType}|${aggregate.streakLength}`;
    const list = grouped.get(baseKey) ?? [];
    list.push(aggregate);
    grouped.set(baseKey, list);
  }

  const results: PatternAggregate[] = [];

  for (const list of grouped.values()) {
    const totalOccurrences = list.reduce((sum, item) => sum + item.occurrences, 0);
    for (const item of list) {
      item.rate = Number(((item.hits / totalOccurrences) * 100).toFixed(2));
      results.push(item);
    }
  }

  const filtered = results
    .filter((item) => item.rate > 70)
    .sort((left, right) => {
      if (right.occurrences !== left.occurrences) return right.occurrences - left.occurrences;
      if (right.rate !== left.rate) return right.rate - left.rate;
      if (left.player !== right.player) return left.player.localeCompare(right.player);
      if (left.streakType !== right.streakType) return left.streakType.localeCompare(right.streakType);
      if (left.streakLength !== right.streakLength) return left.streakLength - right.streakLength;
      return left.nextResult.localeCompare(right.nextResult);
    });

  const meaningful = filtered.filter((item) => item.occurrences >= minOccurrences);

  console.log(
    JSON.stringify(
      {
        scope: "GT players, local month 2026-03",
        minOccurrences,
        totalPlayers: playerMatchesMap.size,
        totalPatternsAbove70: filtered.length,
        totalMeaningfulPatterns: meaningful.length,
        meaningful: meaningful.map((item) => ({
          player: item.player,
          streakType: item.streakType,
          streakLength: item.streakLength,
          nextResult: item.nextResult,
          occurrences: item.occurrences,
          rate: item.rate,
          firstExample: item.examples[0],
        })),
      },
      null,
      2,
    ),
  );
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });