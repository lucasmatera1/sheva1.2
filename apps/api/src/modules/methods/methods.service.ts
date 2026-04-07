import { evaluateMethodDefinition, type MethodContext, type MethodDefinition } from "@sheva/shared";
import {
  computeAlertPlayerStats,
  getConfrontationMethodsLive,
  getDashboardLeagueCurrentJLive,
  getDisparityOperationalWindow,
  getMethodEvaluationLive,
  getMethodSummariesLive,
  hasPendingPriorConfrontationGame,
} from "../../core/live-analytics";
import { mockMethods } from "../../core/mock-data";

type ConfrontationMethodsLeagueType = "GT LEAGUE" | "8MIN BATTLE" | "6MIN VOLTA";
type ConfrontationMethodCode =
  | "T+"
  | "E"
  | "(2E)"
  | "(2D)"
  | "(2D+)"
  | "(3D)"
  | "(3D+)"
  | "(4D)"
  | "(4D+)"
  | "HC-2"
  | "HC-3"
  | "HC-4"
  | "HC-5";
type ConfrontationSeriesCode = "A" | "B" | "C" | "D" | "E" | "F" | "G";

type ConfrontationMethodsOptions = {
  series?: ConfrontationSeriesCode;
  includeHistory?: boolean;
  confrontationKey?: string;
  days?: number;
};

type CurrentLeagueSnapshot = Awaited<ReturnType<typeof getDashboardLeagueCurrentJLive>>;
type CurrentLeagueFixture = CurrentLeagueSnapshot["fixtures"][number];
type CurrentLeaguePlayer = CurrentLeagueSnapshot["players"][number];
type SequencePreviewItem = {
  result: "W" | "D" | "L";
  localTimeLabel: string;
  scoreLabel: string;
  confrontationLabel: string;
  playerGoals: number;
  opponentGoals: number;
};

type FutureConfrontationMethodsOptions = {
  series?: ConfrontationSeriesCode;
  methodCode?: ConfrontationMethodCode;
  methodCodes?: ConfrontationMethodCode[];
  days?: number;
  apxMin?: number;
  minOccurrences?: number;
  includePlayerStats?: boolean;
};

const FUTURE_CONFRONTATION_SEQUENCE_PREVIEW_LENGTH = 4;

const CONFRONTATION_METHOD_CODES: ConfrontationMethodCode[] = [
  "T+",
  "E",
  "(2E)",
  "(2D)",
  "(2D+)",
  "(3D)",
  "(3D+)",
  "(4D)",
  "(4D+)",
  "HC-2",
  "HC-3",
  "HC-4",
  "HC-5",
];

export class MethodsService {
  async listMethods() {
    return getMethodSummariesLive();
  }

  async getConfrontationMethods(
    leagueType: ConfrontationMethodsLeagueType,
    methodCode: ConfrontationMethodCode,
    options?: ConfrontationMethodsOptions,
  ) {
    return getConfrontationMethodsLive(leagueType, methodCode, options);
  }

  async getFutureConfrontationMethods(leagueType: ConfrontationMethodsLeagueType, options: FutureConfrontationMethodsOptions = {}) {
    const snapshot = (await getDashboardLeagueCurrentJLive(leagueType, {
      scope: leagueType === "GT LEAGUE" ? "window" : "day",
    })) as CurrentLeagueSnapshot;
    const daySnapshot =
      leagueType === "GT LEAGUE" || leagueType === "8MIN BATTLE"
        ? ((await getDashboardLeagueCurrentJLive(leagueType, {
            scope: "day",
          })) as CurrentLeagueSnapshot)
        : snapshot;
    const selectedMethodCodes = options.methodCodes?.length
      ? options.methodCodes
      : options.methodCode
        ? [options.methodCode]
        : CONFRONTATION_METHOD_CODES;
    const playersByName = new Map(snapshot.players.map((player) => [normalizeNameKey(player.name), player]));
    const dayPlayersByName = new Map(
      daySnapshot.players.map((player) => [normalizeNameKey(player.name), player]),
    );
    // GT LEAGUE: only dispatch for fixtures within 2 hours to avoid premature alerts
    const gtHorizonMs = leagueType === "GT LEAGUE" ? 2 * 60 * 60 * 1000 : Infinity;
    const upcomingFixtures = buildNextFixtures(snapshot.fixtures, leagueType === "GT LEAGUE" ? options.series : undefined, gtHorizonMs);
    const candidateRows = upcomingFixtures.flatMap((fixture) => {
      return buildFixturePerspectives(fixture).flatMap(({ playerName, opponentName, confrontationKey, confrontationLabel }) => {
        const player = playersByName.get(normalizeNameKey(playerName));
        const dayPlayer = dayPlayersByName.get(normalizeNameKey(playerName));
        const dayOpponent = dayPlayersByName.get(normalizeNameKey(opponentName));
        if (!player) {
          return [];
        }

        if (
          hasPendingPriorConfrontationGame(
            snapshot.fixtures,
            [playerName, opponentName],
            new Date(fixture.playedAt).getTime(),
          )
        ) {
          return [];
        }

        const confrontationRecentMatches = player.recentMatches
          .filter((match) => normalizeNameKey(match.opponent) === normalizeNameKey(opponentName))
          .filter((match) => new Date(match.playedAt).getTime() < new Date(fixture.playedAt).getTime())
          .sort((left, right) => new Date(left.playedAt).getTime() - new Date(right.playedAt).getTime());
        const playerDaySequenceBeforeFixture = player.recentMatches
          .filter((match) => new Date(match.playedAt).getTime() < new Date(fixture.playedAt).getTime())
          .sort((left, right) => new Date(left.playedAt).getTime() - new Date(right.playedAt).getTime())
          .map((match) => match.result as "W" | "D" | "L");
        const playerDaySequenceDetails = (dayPlayer?.recentMatches ?? [])
          .filter((match) => new Date(match.playedAt).getTime() < new Date(fixture.playedAt).getTime())
          .sort((left, right) => new Date(left.playedAt).getTime() - new Date(right.playedAt).getTime())
          .map((match) => buildSequencePreviewItem(match, playerName));
        const opponentDaySequenceDetails = (dayOpponent?.recentMatches ?? [])
          .filter((match) => new Date(match.playedAt).getTime() < new Date(fixture.playedAt).getTime())
          .sort((left, right) => new Date(left.playedAt).getTime() - new Date(right.playedAt).getTime())
          .map((match) => buildSequencePreviewItem(match, opponentName));

        return selectedMethodCodes.flatMap((methodCode) => {
          const confrontationMatchesInScope = confrontationRecentMatches.filter((match) =>
            isFutureConfrontationHistoryInScope(
              leagueType,
              methodCode,
              fixture,
              match,
            ),
          );
          const historySequence = confrontationMatchesInScope.map(
            (match) => match.result as "W" | "D" | "L",
          );

          if (!matchesFutureMethod(methodCode, leagueType, historySequence)) {
            return [];
          }

          return {
            fixture,
            playerName,
            opponentName,
            confrontationKey,
            confrontationLabel,
            methodCode,
            historySequence,
            playerDaySequence: playerDaySequenceBeforeFixture,
            confrontationSequenceDetails: confrontationMatchesInScope.map(
              (match) => buildSequencePreviewItem(match, playerName),
            ),
            playerDaySequenceDetails,
            opponentDaySequenceDetails,
          };
        });
      });
    });
    const methodsToLoad = Array.from(new Set(candidateRows.map((row) => row.methodCode)));
    const candidateConfrontationKeysByMethod = new Map<
      ConfrontationMethodCode,
      string[]
    >();

    for (const methodCode of methodsToLoad) {
      candidateConfrontationKeysByMethod.set(
        methodCode,
        Array.from(
          new Set(
            candidateRows
              .filter((row) => row.methodCode === methodCode)
              .map((row) => row.confrontationKey),
          ),
        ),
      );
    }

    const historicalResponses = await Promise.all(
      methodsToLoad.map((methodCode) =>
        getConfrontationMethodsLive(leagueType, methodCode, {
          series: options.series,
          includeHistory: true,
          confrontationKeys:
            candidateConfrontationKeysByMethod.get(methodCode) ?? [],
          days: options.days,
        }),
      ),
    );
    const historyByMethod = new Map(
      historicalResponses.map((response) => [response.methodCode, new Map(response.rows.map((row) => [row.confrontationKey, row]))]),
    );

    const includePlayerStats = options.includePlayerStats ?? true;
    const rows = (await Promise.all(candidateRows.map(async ({ fixture, playerName, opponentName, confrontationKey, confrontationLabel, methodCode, historySequence, playerDaySequence, confrontationSequenceDetails, playerDaySequenceDetails, opponentDaySequenceDetails }) => {
      const historicalRow = historyByMethod.get(methodCode)?.get(confrontationKey) ?? null;
      if (!historicalRow) {
        return [];
      }

      const historicalStatsBeforeFixture = buildHistoricalStatsBeforeFixture(historicalRow.history, fixture.playedAt);
      if (historicalStatsBeforeFixture.totalOccurrences === 0) {
        return [];
      }

      if (typeof options.apxMin === "number" && historicalStatsBeforeFixture.apx < options.apxMin) {
        return [];
      }

      if (typeof options.minOccurrences === "number" && historicalStatsBeforeFixture.totalOccurrences < options.minOccurrences) {
        return [];
      }

      const triggerSequence = getFutureMethodTriggerSequence(methodCode, historySequence);
      const alertStats = includePlayerStats
        ? await computeAlertPlayerStats(
            leagueType,
            playerName,
            opponentName,
            options.days ?? 30,
          )
        : {
            playerWinRate: 0,
            opponentWinRate: 0,
            h2hLast48: { total: 0, wins: 0, wr: 0 },
            h2hLast24: { total: 0, wins: 0, wr: 0 },
          };

      return {
        fixtureId: fixture.id,
        confrontationKey,
        confrontationLabel,
        fixtureLabel: `${fixture.homePlayer} x ${fixture.awayPlayer}`,
        leagueType,
        groupLabel: fixture.groupLabel ?? null,
        seasonId: fixture.seasonId,
        playedAtIso: fixture.playedAt,
        localPlayedAtLabel: new Date(fixture.playedAt).toLocaleString("pt-BR"),
        playerName,
        opponentName,
        methodCode,
        apx: historicalStatsBeforeFixture.apx,
        totalOccurrences: historicalStatsBeforeFixture.totalOccurrences,
        wins: historicalStatsBeforeFixture.wins,
        draws: historicalStatsBeforeFixture.draws,
        losses: historicalStatsBeforeFixture.losses,
        occurrenceResults: historicalStatsBeforeFixture.occurrenceResults,
        triggerSequence,
        daySequence: playerDaySequence,
        confrontationSequence: getFutureMethodConfrontationSequence(methodCode, historySequence),
        confrontationSequenceDetails,
        playerOneDaySequence: playerDaySequenceDetails,
        playerTwoDaySequence: opponentDaySequenceDetails,
        playerWinRate: alertStats.playerWinRate,
        opponentWinRate: alertStats.opponentWinRate,
        h2hLast48: alertStats.h2hLast48,
        h2hLast24: alertStats.h2hLast24,
      };
    }))).flat();

    rows.sort(
      (left, right) =>
        new Date(left.playedAtIso).getTime() - new Date(right.playedAtIso).getTime() ||
        right.apx - left.apx ||
        right.totalOccurrences - left.totalOccurrences ||
        left.confrontationLabel.localeCompare(right.confrontationLabel, "pt-BR", { sensitivity: "base" }),
    );

    return {
      generatedAt: new Date().toISOString(),
      leagueType,
      currentWindow: snapshot.currentWindow,
      availableMethods: CONFRONTATION_METHOD_CODES.map((code) => ({ code, label: code })),
      rows,
    };
  }

  async evaluate(methodId: string, context: MethodContext) {
    const liveMethod = await getMethodEvaluationLive(methodId);

    if (liveMethod) {
      const mockMethod = mockMethods.find((item) => item.id === methodId) ?? mockMethods[0];
      const definition = mockMethod as MethodDefinition;

      return {
        method: liveMethod,
        signal: evaluateMethodDefinition(definition, context),
      };
    }

    const method = mockMethods.find((item) => item.id === methodId);

    if (!method) {
      return null;
    }

    const definition = method as MethodDefinition;
    return {
      method,
      signal: evaluateMethodDefinition(definition, context),
    };
  }
}

function buildNextFixtures(fixtures: CurrentLeagueFixture[], series?: ConfrontationSeriesCode, maxHorizonMs = Infinity) {
  const now = Date.now();
  const nextFixturesByPair = new Map<string, CurrentLeagueFixture>();

  for (const fixture of [...fixtures].sort((left, right) => new Date(left.playedAt).getTime() - new Date(right.playedAt).getTime())) {
    const fixtureAt = new Date(fixture.playedAt).getTime();
    if (Number.isNaN(fixtureAt)) {
      continue;
    }

    if (fixtureAt < now) {
      continue;
    }

    if (fixtureAt - now > maxHorizonMs) {
      continue;
    }

    if (series && fixture.groupLabel !== series) {
      continue;
    }

    const pairKey = buildSortedPairKey(fixture.homePlayer, fixture.awayPlayer);
    if (!nextFixturesByPair.has(pairKey)) {
      nextFixturesByPair.set(pairKey, fixture);
    }
  }

  return Array.from(nextFixturesByPair.values());
}

function buildFixturePerspectives(fixture: CurrentLeagueFixture) {
  return [
    {
      playerName: fixture.homePlayer,
      opponentName: fixture.awayPlayer,
      confrontationKey: `${normalizeNameKey(fixture.homePlayer).toUpperCase()}||${normalizeNameKey(fixture.awayPlayer).toUpperCase()}`,
      confrontationLabel: `${fixture.homePlayer} x ${fixture.awayPlayer}`,
    },
    {
      playerName: fixture.awayPlayer,
      opponentName: fixture.homePlayer,
      confrontationKey: `${normalizeNameKey(fixture.awayPlayer).toUpperCase()}||${normalizeNameKey(fixture.homePlayer).toUpperCase()}`,
      confrontationLabel: `${fixture.awayPlayer} x ${fixture.homePlayer}`,
    },
  ];
}

function buildSortedPairKey(playerA: string, playerB: string) {
  return [playerA, playerB]
    .map((item) => normalizeNameKey(item))
    .sort((left, right) => left.localeCompare(right, "pt-BR", { sensitivity: "base" }))
    .join("||");
}

function normalizeNameKey(value: string) {
  return value.trim().replace(/\s+/g, " ").toUpperCase();
}

function buildHistoricalStatsBeforeFixture(
  history: Array<{
    playedAtIso: string;
    result: "W" | "D" | "L";
  }>,
  fixturePlayedAtIso: string,
) {
  const fixturePlayedAt = new Date(fixturePlayedAtIso).getTime();
  const filteredHistory = history.filter((occurrence) => new Date(occurrence.playedAtIso).getTime() < fixturePlayedAt);
  const wins = filteredHistory.filter((occurrence) => occurrence.result === "W").length;
  const draws = filteredHistory.filter((occurrence) => occurrence.result === "D").length;
  const losses = filteredHistory.filter((occurrence) => occurrence.result === "L").length;
  const totalOccurrences = filteredHistory.length;

  return {
    apx: totalOccurrences ? Number(((wins / totalOccurrences) * 100).toFixed(2)) : 0,
    totalOccurrences,
    wins,
    draws,
    losses,
    occurrenceResults: filteredHistory
      .slice()
      .reverse()
      .map((occurrence) => occurrence.result),
  };
}

function matchesFutureMethod(
  methodCode: ConfrontationMethodCode,
  leagueType: ConfrontationMethodsLeagueType,
  sequence: Array<"W" | "D" | "L">,
) {
  const previousOne = sequence.slice(-1);
  const previousTwo = sequence.slice(-2);
  const previousThree = sequence.slice(-3);
  const previousFour = sequence.slice(-4);

  switch (methodCode) {
    case "HC-2":
    case "HC-3":
    case "HC-4":
    case "HC-5":
      return matchesFutureHandicapMethod(methodCode, leagueType, sequence);
    case "T+":
      return previousOne.length === 1 && previousOne[0] === "L" && !isAllResults(previousTwo, "L", 2);
    case "E":
      return previousOne.length === 1 && previousOne[0] === "D" && !isAllResults(previousTwo, "D", 2);
    case "(2E)":
      return isAllResults(previousTwo, "D", 2) && !isAllResults(previousThree, "D", 3);
    case "(2D)":
      return isExactNonWinSequence(previousTwo, 2) && !isExactNonWinSequence(previousThree, 3);
    case "(2D+)":
      return isAllResults(previousTwo, "L", 2) && !isAllResults(previousThree, "L", 3);
    case "(3D)":
      return isExactNonWinSequence(previousThree, 3) && !isExactNonWinSequence(previousFour, 4);
    case "(3D+)":
      return isAllResults(previousThree, "L", 3) && !isAllResults(previousFour, "L", 4);
    case "(4D)":
      return isExactNonWinSequence(previousFour, 4);
    case "(4D+)":
      return isAllResults(previousFour, "L", 4);
    default:
      return false;
  }
}

function isAllResults(sequence: Array<"W" | "D" | "L">, expected: "D" | "L", length: number) {
  return sequence.length === length && sequence.every((result) => result === expected);
}

function isExactNonWinSequence(sequence: Array<"W" | "D" | "L">, length: number) {
  return sequence.length === length && sequence.every((result) => result === "D" || result === "L") && sequence.includes("L");
}

function buildSequencePreviewItem(
  match: CurrentLeaguePlayer["recentMatches"][number],
  playerName: string,
): SequencePreviewItem {
  const [homeGoalsRaw = "0", awayGoalsRaw = "0"] = match.scoreLabel.split("-");
  const homeGoals = Number(homeGoalsRaw);
  const awayGoals = Number(awayGoalsRaw);
  const isHome = normalizeNameKey(match.homePlayer) === normalizeNameKey(playerName);

  return {
    result: match.result as "W" | "D" | "L",
    localTimeLabel: new Intl.DateTimeFormat("pt-BR", {
      timeStyle: "short",
      timeZone: "America/Sao_Paulo",
    }).format(new Date(match.playedAt)),
    scoreLabel: match.scoreLabel,
    confrontationLabel: `${match.homePlayer} x ${match.awayPlayer}`,
    playerGoals: isHome ? homeGoals : awayGoals,
    opponentGoals: isHome ? awayGoals : homeGoals,
  };
}

function getFutureMethodTriggerSequence(methodCode: ConfrontationMethodCode, sequence: Array<"W" | "D" | "L">) {
  switch (methodCode) {
    case "HC-2":
    case "HC-3":
    case "HC-4":
    case "HC-5":
      return sequence;
    case "T+":
    case "E":
      return sequence.slice(-1);
    case "(2E)":
    case "(2D)":
    case "(2D+)":
      return sequence.slice(-2);
    case "(3D)":
    case "(3D+)":
      return sequence.slice(-3);
    case "(4D)":
    case "(4D+)":
      return sequence.slice(-4);
    default:
      return [];
  }
}

function isHandicapConfrontationMethod(
  methodCode: ConfrontationMethodCode,
): methodCode is "HC-2" | "HC-3" | "HC-4" | "HC-5" {
  return (
    methodCode === "HC-2" ||
    methodCode === "HC-3" ||
    methodCode === "HC-4" ||
    methodCode === "HC-5"
  );
}

function getFutureMethodConfrontationSequence(
  methodCode: ConfrontationMethodCode,
  sequence: Array<"W" | "D" | "L">,
) {
  if (isHandicapConfrontationMethod(methodCode)) {
    return sequence;
  }

  return sequence.slice(-FUTURE_CONFRONTATION_SEQUENCE_PREVIEW_LENGTH);
}

function getHandicapGap(methodCode: ConfrontationMethodCode) {
  switch (methodCode) {
    case "HC-2":
      return 2;
    case "HC-3":
      return 3;
    case "HC-4":
      return 4;
    case "HC-5":
      return 5;
    default:
      return null;
  }
}

function getConfrontationScopeMaxGames(
  leagueType: ConfrontationMethodsLeagueType,
) {
  return leagueType === "6MIN VOLTA" ? 8 : 6;
}

function matchesFutureHandicapMethod(
  methodCode: ConfrontationMethodCode,
  leagueType: ConfrontationMethodsLeagueType,
  sequence: Array<"W" | "D" | "L">,
) {
  const targetGap = getHandicapGap(methodCode);
  if (targetGap === null) {
    return false;
  }

  if (sequence.length === 0 || sequence.length >= getConfrontationScopeMaxGames(leagueType)) {
    return false;
  }

  const playerWins = sequence.filter((result) => result === "W").length;
  const opponentWins = sequence.filter((result) => result === "L").length;
  return opponentWins - playerWins === targetGap;
}

function buildFutureConfrontationScopeKey(
  leagueType: ConfrontationMethodsLeagueType,
  playedAtIso: string,
  seasonId: number | null,
) {
  const playedAt = new Date(playedAtIso);
  if (Number.isNaN(playedAt.getTime())) {
    return null;
  }

  if (leagueType === "GT LEAGUE" || leagueType === "6MIN VOLTA") {
    const operationalWindow = getDisparityOperationalWindow(playedAt, leagueType);
    return `${leagueType}-${operationalWindow.dayKey}-${operationalWindow.windowLabel}`;
  }

  if (typeof seasonId === "number") {
    return `${leagueType}-${seasonId}`;
  }

  return `${leagueType}-${playedAt.toISOString().slice(0, 10)}`;
}

function isFutureConfrontationHistoryInScope(
  leagueType: ConfrontationMethodsLeagueType,
  methodCode: ConfrontationMethodCode,
  fixture: CurrentLeagueFixture,
  match: CurrentLeaguePlayer["recentMatches"][number],
) {
  if (!isHandicapConfrontationMethod(methodCode)) {
    return true;
  }

  const fixtureScopeKey = buildFutureConfrontationScopeKey(
    leagueType,
    fixture.playedAt,
    fixture.seasonId,
  );
  const matchScopeKey = buildFutureConfrontationScopeKey(
    leagueType,
    match.playedAt,
    match.seasonId,
  );

  if (!fixtureScopeKey || !matchScopeKey) {
    return true;
  }

  return fixtureScopeKey === matchScopeKey;
}
