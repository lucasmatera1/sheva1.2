import "../src/core/env.ts";
import { writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { prisma } from "../src/core/prisma.ts";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const outputFile = resolve(scriptDir, "../tmp-volta-window-backtest.json");

const formatter = new Intl.DateTimeFormat("pt-BR", {
  dateStyle: "short",
  timeStyle: "short",
  timeZone: "America/Sao_Paulo",
});

function getParts(date: Date) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);

  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? "00";

  return {
    year: Number(get("year")),
    month: Number(get("month")),
    day: Number(get("day")),
    hour: Number(get("hour")),
    minute: Number(get("minute")),
  };
}

function buildKey(year: number, month: number, day: number) {
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function previousKey(year: number, month: number, day: number) {
  const utc = new Date(Date.UTC(year, month - 1, day));
  utc.setUTCDate(utc.getUTCDate() - 1);
  return buildKey(utc.getUTCFullYear(), utc.getUTCMonth() + 1, utc.getUTCDate());
}

function classify(date: Date) {
  const parts = getParts(date);
  const minuteOfDay = parts.hour * 60 + parts.minute;
  const dayKey = minuteOfDay < 113 ? previousKey(parts.year, parts.month, parts.day) : buildKey(parts.year, parts.month, parts.day);

  let windowLabel = "J3";
  if (minuteOfDay >= 113 && minuteOfDay < 630) {
    windowLabel = "J1";
  } else if (minuteOfDay >= 630 && minuteOfDay < 1045) {
    windowLabel = "J2";
  }

  return { minuteOfDay, dayKey, windowLabel, local: formatter.format(date) };
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
      id_season: true,
      season_name: true,
      match_kickoff: true,
      home_player: true,
      away_player: true,
    },
    orderBy: { match_kickoff: "desc" },
    take: 4000,
  });

  const summary = new Map<
    string,
    {
      dayKey: string;
      windowLabel: string;
      totalGames: number;
      seasonIds: Set<number>;
      firstLocal: string;
      lastLocal: string;
    }
  >();
  const seasonSummary = new Map<
    string,
    {
      dayKey: string;
      windowLabel: string;
      seasonId: number;
      totalGames: number;
      firstLocal: string;
      lastLocal: string;
    }
  >();
  const borderSamples: Array<{
    fixtureId: number;
    seasonId: number;
    local: string;
    dayKey: string;
    windowLabel: string;
    home: string;
    away: string;
  }> = [];

  for (const row of rows) {
    const playedAt = new Date(row.match_kickoff);
    const classified = classify(playedAt);
    const bucketKey = `${classified.dayKey}__${classified.windowLabel}`;
    const current = summary.get(bucketKey) ?? {
      dayKey: classified.dayKey,
      windowLabel: classified.windowLabel,
      totalGames: 0,
      seasonIds: new Set<number>(),
      firstLocal: classified.local,
      lastLocal: classified.local,
    };

    current.totalGames += 1;
    current.seasonIds.add(row.id_season);
    if (classified.local < current.firstLocal) current.firstLocal = classified.local;
    if (classified.local > current.lastLocal) current.lastLocal = classified.local;
    summary.set(bucketKey, current);

    const seasonBucketKey = `${classified.dayKey}__${classified.windowLabel}__${row.id_season}`;
    const currentSeason = seasonSummary.get(seasonBucketKey) ?? {
      dayKey: classified.dayKey,
      windowLabel: classified.windowLabel,
      seasonId: row.id_season,
      totalGames: 0,
      firstLocal: classified.local,
      lastLocal: classified.local,
    };

    currentSeason.totalGames += 1;
    if (classified.local < currentSeason.firstLocal) currentSeason.firstLocal = classified.local;
    if (classified.local > currentSeason.lastLocal) currentSeason.lastLocal = classified.local;
    seasonSummary.set(seasonBucketKey, currentSeason);

    const minute = classified.minuteOfDay;
    const nearBorder = [110,111,112,113,114,115,116,117,118,625,626,627,628,629,630,631,632,633,634,1040,1041,1042,1043,1044,1045,1046,1047,1048,1049].includes(minute);
    if (nearBorder && borderSamples.length < 40) {
      borderSamples.push({
        fixtureId: row.id_fixture,
        seasonId: row.id_season,
        local: classified.local,
        dayKey: classified.dayKey,
        windowLabel: classified.windowLabel,
        home: row.home_player,
        away: row.away_player,
      });
    }
  }

  const ordered = [...summary.values()]
    .map((item) => ({
      dayKey: item.dayKey,
      windowLabel: item.windowLabel,
      totalGames: item.totalGames,
      seasonCount: item.seasonIds.size,
      firstLocal: item.firstLocal,
      lastLocal: item.lastLocal,
    }))
    .sort((a, b) => a.dayKey.localeCompare(b.dayKey) || a.windowLabel.localeCompare(b.windowLabel));

  const orderedSeason = [...seasonSummary.values()]
    .map((item) => ({
      dayKey: item.dayKey,
      windowLabel: item.windowLabel,
      seasonId: item.seasonId,
      totalGames: item.totalGames,
      firstLocal: item.firstLocal,
      lastLocal: item.lastLocal,
    }))
    .sort(
      (a, b) =>
        a.dayKey.localeCompare(b.dayKey) ||
        a.windowLabel.localeCompare(b.windowLabel) ||
        a.seasonId - b.seasonId,
    );

  const stats = {
    totalFixturesAnalysed: rows.length,
    totalBuckets: ordered.length,
    totalSeasonBuckets: orderedSeason.length,
    bucketsOver32: ordered.filter((item) => item.totalGames > 32).slice(0, 20),
    bucketsUnder20: ordered.filter((item) => item.totalGames < 20).slice(0, 20),
    seasonBucketsNot32: orderedSeason.filter((item) => item.totalGames !== 32).slice(0, 40),
    seasonBucketsExact32: orderedSeason.filter((item) => item.totalGames === 32).length,
    seasonSpreadTop: ordered
      .filter((item) => item.seasonCount > 1)
      .sort((a, b) => b.seasonCount - a.seasonCount || b.totalGames - a.totalGames)
      .slice(0, 20),
    sampleSeasonBuckets: orderedSeason.slice(-24),
    sampleRecent: ordered.slice(-18),
    borderSamples,
  };

  writeFileSync(outputFile, JSON.stringify(stats, null, 2));
  console.log(JSON.stringify({ ok: true, file: outputFile }, null, 2));
  await prisma.$disconnect();
}

main().catch(async (error) => {
  console.error(error);
  await prisma.$disconnect();
  process.exit(1);
});
