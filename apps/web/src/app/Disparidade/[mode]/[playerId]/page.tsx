import { notFound } from "next/navigation";
import { AppShell, SurfaceCard } from "../../../../components/shell/app-shell";
import { basketApiUrl, fetchApi, fetchApiFromBase } from "../../../../lib/api";
import { getDisparityModeBySlug } from "../../../../lib/disparity-mode";
import { formatNumber, formatPercent } from "../../../../lib/format";

export const dynamic = "force-dynamic";

type DisparityRecentMatch = {
  matchId: string;
  playedAt: string;
  localDateLabel: string;
  localTimeLabel: string;
  localPlayedAtLabel: string;
  result: string;
  intervalScore: string | null;
  fullTimeScore: string;
};

type DisparityOpponent = {
  opponent: string;
  playedAt: string;
  championshipId: number | null;
  championshipLabel?: string | null;
  championshipDisplayLabel?: string | null;
  championshipKey: string;
  games: number;
  sequence: string[];
  wins: number;
  draws: number;
  losses: number;
  recentMatches: DisparityRecentMatch[];
};

type DisparityDetail = {
  player: { id: string; name: string };
  leagueType: string;
  championship: {
    id: string;
    seasonId: number | null;
    seasonLabel?: string | null;
    displayLabel?: string | null;
    totalGames: number;
    gamesPerOpponent: number;
    gamesPerDay: number;
    latestPlayedAt: string;
  };
  recentWindow: {
    totalGames: number;
    wins: number;
    draws: number;
    losses: number;
    winRate: number;
    drawRate: number;
    lossRate: number;
    sequence: string[];
    matches: Array<{
      matchId: string;
      playedAt: string;
      localDateLabel: string;
      localTimeLabel: string;
      localPlayedAtLabel: string;
      opponent: string;
      result: string;
      intervalScore: string | null;
      fullTimeScore: string;
    }>;
  };
  dailySlotStudy?: {
    maxGamesPerDay: number;
    days: Array<{
      dayKey: string;
      filterDateKey?: string;
      displayDate: string;
      matches: Array<{
        slot: number;
        matchId: string;
        playedAt: string;
        localDateLabel: string;
        localTimeLabel: string;
        localPlayedAtLabel: string;
        opponent: string;
        result: string;
        intervalScore: string | null;
        fullTimeScore: string;
      }>;
    }>;
  };
  opponents: DisparityOpponent[];
};

type UpcomingFixturesResponse = {
  leagues: Array<{
    leagueType: string;
    fixtures: Array<{
      id: string;
      playedAt: string;
      homePlayer: string;
      awayPlayer: string;
    }>;
  }>;
};

function getBadgeClass(result: string) {
  switch (result) {
    case "W":
      return "bg-[#20352e] text-white";
    case "L":
      return "bg-[#7a3f34] text-white";
    default:
      return "bg-[#d9d4c7] text-ink";
  }
}

function getMatchesOfChampionship<T extends { championshipKey: string; playedAt: string }>(matches: T[], championshipKey: string) {
  return matches
    .filter((match) => match.championshipKey === championshipKey)
    .sort((left, right) => new Date(left.playedAt).getTime() - new Date(right.playedAt).getTime());
}

function getTrailingMatches<T extends { playedAt: string }>(matches: T[], endPlayedAt: string, size: number) {
  const endTime = new Date(endPlayedAt).getTime();

  return [...matches]
    .filter((match) => new Date(match.playedAt).getTime() <= endTime)
    .sort((left, right) => new Date(left.playedAt).getTime() - new Date(right.playedAt).getTime())
    .slice(-size);
}

function getChampionshipTrailingMatches<T extends { championshipKey: string; playedAt: string }>(matches: T[], championshipKey: string, endPlayedAt: string, size: number) {
  return getTrailingMatches(getMatchesOfChampionship(matches, championshipKey), endPlayedAt, size);
}

function getSearchParamValue(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function getPairKey(playerA: string, playerB: string) {
  return [playerA, playerB].sort((left, right) => left.localeCompare(right, "pt-BR")).join("::");
}

function formatUpcomingDateTime(value: string) {
  return new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "short",
    timeStyle: "short",
    timeZone: "America/Sao_Paulo",
  }).format(new Date(value));
}

function SequenceDivider() {
  return <span className="mx-1 text-xs font-semibold text-ink/35">|</span>;
}

function renderSequenceWithDividers(
  items: Array<{ key: string; result: string; title: string }>,
  groupEveryEight: boolean,
) {
  return items.flatMap((item, index) => {
    const parts = [] as React.ReactNode[];

    if (groupEveryEight && index > 0 && index % 8 === 0) {
      parts.push(<SequenceDivider key={`${item.key}-divider-${index}`} />);
    }

    parts.push(
      <button
        key={item.key}
        type="button"
        title={item.title}
        className={`inline-flex min-w-9 justify-center rounded-full px-3 py-1 text-xs font-semibold ${getBadgeClass(item.result)}`}
      >
        {item.result}
      </button>,
    );

    return parts;
  });
}

export default async function DisparidadeJogadorPage({
  params,
  searchParams,
}: {
  params: Promise<{ mode: string; playerId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { mode: modeSlug, playerId } = await params;
  const resolvedSearchParams = await searchParams;
  const mode = getDisparityModeBySlug(modeSlug);

  if (!mode) {
    notFound();
  }

  const forceRefresh = getSearchParamValue(resolvedSearchParams.forceRefresh) === "1";
  const apiQuery = new URLSearchParams();
  if (forceRefresh) {
    apiQuery.set("forceRefresh", "1");
  }
  const apiPath = `/disparity/${mode.slug}/${encodeURIComponent(playerId)}${apiQuery.toString() ? `?${apiQuery.toString()}` : ""}`;
  const data = mode.slug === "Basket"
    ? await fetchApiFromBase<DisparityDetail>(basketApiUrl, apiPath, { cache: "no-store", revalidate: false, timeoutMs: 20000 })
    : await fetchApi<DisparityDetail>(apiPath, { cache: "no-store", revalidate: false });
  const upcomingFixtures = mode.slug === "Basket"
    ? await fetchApiFromBase<UpcomingFixturesResponse>(basketApiUrl, "/dashboard/upcoming-fixtures?limit=240", { cache: "no-store", revalidate: false, timeoutMs: 20000 })
    : await fetchApi<UpcomingFixturesResponse>("/dashboard/upcoming-fixtures?limit=240", { cache: "no-store", revalidate: false });

  if (!data) {
    return (
      <AppShell
        eyebrow="Disparidade"
        title={decodeURIComponent(playerId)}
        description="A rota abriu, mas os dados do jogador nao voltaram da API neste momento."
      >
        <SurfaceCard>
          <p className="text-xs uppercase tracking-[0.2em] text-brand-strong">Falha de carregamento</p>
          <h2 className="mt-3 font-display text-3xl text-ink">Nao foi possivel carregar este jogador agora</h2>
          <p className="mt-3 text-sm leading-7 text-ink/68">
            Isso normalmente indica instabilidade momentanea no servidor de desenvolvimento, recompilacao em andamento ou resposta nula da API.
          </p>
          <div className="mt-5 grid gap-3 sm:grid-cols-2">
            <div className="rounded-[1rem] border border-ink/10 bg-white/70 px-4 py-3">
              <p className="text-xs uppercase tracking-[0.18em] text-brand-strong">Modo</p>
              <p className="mt-2 text-lg font-semibold text-ink">{mode.slug}</p>
            </div>
            <div className="rounded-[1rem] border border-ink/10 bg-white/70 px-4 py-3">
              <p className="text-xs uppercase tracking-[0.18em] text-brand-strong">Jogador</p>
              <p className="mt-2 text-lg font-semibold text-ink">{decodeURIComponent(playerId)}</p>
            </div>
            <div className="rounded-[1rem] border border-ink/10 bg-white/70 px-4 py-3 sm:col-span-2">
              <p className="text-xs uppercase tracking-[0.18em] text-brand-strong">API consultada</p>
              <p className="mt-2 break-all font-mono text-sm font-semibold text-ink">{apiPath}</p>
            </div>
          </div>
        </SurfaceCard>
      </AppShell>
    );
  }

  const shouldGroupSequenceByEight = data.leagueType === "6MIN VOLTA";

  const opponents = [...data.opponents].sort((left, right) => new Date(right.playedAt).getTime() - new Date(left.playedAt).getTime());
  const recentWindowMatches = [...data.recentWindow.matches].sort((left, right) => new Date(left.playedAt).getTime() - new Date(right.playedAt).getTime());
  const startDate = getSearchParamValue(resolvedSearchParams.startDate) ?? "";
  const endDate = getSearchParamValue(resolvedSearchParams.endDate) ?? "";
  const dailySlotStudy = data.dailySlotStudy ?? { maxGamesPerDay: data.championship.gamesPerDay, days: [] };
  const hasManualStudyFilter = Boolean(startDate || endDate);
  const manuallyFilteredStudyDays = dailySlotStudy.days.filter((day) => {
    const comparableDate = day.filterDateKey ?? day.dayKey;

    if (startDate && comparableDate < startDate) {
      return false;
    }

    if (endDate && comparableDate > endDate) {
      return false;
    }

    return true;
  });
  const filteredStudyDays = hasManualStudyFilter ? manuallyFilteredStudyDays : dailySlotStudy.days.slice(0, 20);
  const defaultStudyStartDate = hasManualStudyFilter ? startDate : filteredStudyDays[filteredStudyDays.length - 1]?.dayKey ?? "";
  const defaultStudyEndDate = hasManualStudyFilter ? endDate : filteredStudyDays[0]?.dayKey ?? "";
  const slotTotals = Array.from({ length: dailySlotStudy.maxGamesPerDay }, (_, index) => {
    const slot = index + 1;
    const slotMatches = filteredStudyDays.flatMap((day) => day.matches.filter((match) => match.slot === slot));

    return {
      slot,
      wins: slotMatches.filter((match) => match.result === "W").length,
      draws: slotMatches.filter((match) => match.result === "D").length,
      losses: slotMatches.filter((match) => match.result === "L").length,
    };
  });
  const filteredStudyMatches = filteredStudyDays
    .flatMap((day) => day.matches)
    .sort((left, right) => new Date(left.playedAt).getTime() - new Date(right.playedAt).getTime());
  const filteredStudyWins = filteredStudyMatches.filter((match) => match.result === "W").length;
  const filteredStudyDraws = filteredStudyMatches.filter((match) => match.result === "D").length;
  const filteredStudyLosses = filteredStudyMatches.filter((match) => match.result === "L").length;
  const filteredStudyTotal = filteredStudyMatches.length;
  const filteredStudyWinRate = filteredStudyTotal > 0 ? (filteredStudyWins / filteredStudyTotal) * 100 : 0;
  const relevantUpcomingFixtures = upcomingFixtures?.leagues
    .find((league) => league.leagueType === data.leagueType)
    ?.fixtures
    .filter((fixture) => getPairKey(fixture.homePlayer, fixture.awayPlayer) === getPairKey(data.player.name, fixture.homePlayer === data.player.name ? fixture.awayPlayer : fixture.homePlayer)) ?? [];
  const nextFixtureByOpponent = new Map(
    (upcomingFixtures?.leagues.find((league) => league.leagueType === data.leagueType)?.fixtures ?? [])
      .filter((fixture) => fixture.homePlayer === data.player.name || fixture.awayPlayer === data.player.name)
      .sort((left, right) => new Date(left.playedAt).getTime() - new Date(right.playedAt).getTime())
      .map((fixture) => {
        const opponent = fixture.homePlayer === data.player.name ? fixture.awayPlayer : fixture.homePlayer;
        return [opponent, fixture] as const;
      })
      .filter((entry, index, collection) => collection.findIndex((item) => item[0] === entry[0]) === index),
  );
  const opponentHistoryByName = new Map(
    Array.from(new Set(opponents.map((opponent) => opponent.opponent))).map((opponentName) => {
      const historyRows = opponents
        .filter((opponent) => opponent.opponent === opponentName)
        .map((opponent) => {
          const dayOpponentMatches = opponent.recentMatches.map((match) => ({ ...match, championshipKey: opponent.championshipKey }));
          const recentEightMatches = getChampionshipTrailingMatches(dayOpponentMatches, opponent.championshipKey, opponent.playedAt, 8);

          return {
            championshipKey: opponent.championshipKey,
            analyticalDate: opponent.championshipDisplayLabel ?? opponent.championshipLabel ?? opponent.championshipId ?? "Sem ID",
            totalWins: recentEightMatches.filter((item) => item.result === "W").length,
            totalDraws: recentEightMatches.filter((item) => item.result === "D").length,
            totalLosses: recentEightMatches.filter((item) => item.result === "L").length,
            recentEightMatches,
          };
        })
        .filter((row, index, collection) => collection.findIndex((item) => item.championshipKey === row.championshipKey) === index)
        .sort((left, right) => right.championshipKey.localeCompare(left.championshipKey));

      return [opponentName, historyRows] as const;
    }),
  );
  const studyDayBreakdowns = filteredStudyDays.map((day) => {
    const sortedMatches = [...day.matches].sort((left, right) => left.slot - right.slot);
    const opponentRows = sortedMatches
      .reduce<Array<{
        opponent: string;
        matches: typeof sortedMatches;
      }>>((collection, match) => {
        const existingOpponent = collection.find((item) => item.opponent === match.opponent);

        if (existingOpponent) {
          existingOpponent.matches.push(match);
          return collection;
        }

        collection.push({ opponent: match.opponent, matches: [match] });
        return collection;
      }, [])
      .map((opponent) => {
        const recentEightMatches = [...opponent.matches]
          .sort((left, right) => new Date(left.playedAt).getTime() - new Date(right.playedAt).getTime())
          .slice(-8);
        const nextFixture = nextFixtureByOpponent.get(opponent.opponent) ?? null;
        const previousDays = (opponentHistoryByName.get(opponent.opponent) ?? []).filter((item) => item.championshipKey !== day.dayKey);

        return {
          opponent: opponent.opponent,
          recentEightMatches,
          nextFixture,
          previousDays,
          totalGames: opponent.matches.length,
          totalWins: recentEightMatches.filter((item) => item.result === "W").length,
          totalDraws: recentEightMatches.filter((item) => item.result === "D").length,
          totalLosses: recentEightMatches.filter((item) => item.result === "L").length,
        };
      })
      .sort((left, right) => left.opponent.localeCompare(right.opponent, "pt-BR"));

    return {
      ...day,
      sortedMatches,
      opponentRows,
    };
  });
  const recentUniqueOpponents = opponents
    .filter((opponent, index, collection) => collection.findIndex((item) => item.opponent === opponent.opponent) === index)
    .slice(0, 4)
    .map((opponent) => {
      const dayOpponentMatches = opponent.recentMatches.map((match) => ({ ...match, championshipKey: opponent.championshipKey }));
      const recentEightMatches = getChampionshipTrailingMatches(dayOpponentMatches, opponent.championshipKey, opponent.playedAt, 8);
      const firstMatchOfDay = recentEightMatches[0] ?? null;

      const totalWins = recentEightMatches.filter((item) => item.result === "W").length;
      const totalDraws = recentEightMatches.filter((item) => item.result === "D").length;
      const totalLosses = recentEightMatches.filter((item) => item.result === "L").length;

      return {
        ...opponent,
        analyticalDateLabel: opponent.championshipDisplayLabel ?? opponent.championshipLabel ?? opponent.championshipId ?? "Sem ID",
        recentEightMatches,
        firstMatchOfDay,
        totalWins,
        totalDraws,
        totalLosses,
      };
    })
    .sort((left, right) => left.opponent.localeCompare(right.opponent, "pt-BR"));
  const recentWindowKeys = Array.from(new Set(opponents.map((opponent) => opponent.championshipKey)));
  const historicalWindowKeys = recentWindowKeys.slice(1, 31);
  const historicalDays = historicalWindowKeys.map((windowKey) => {
    const dayRows = opponents
      .filter((opponent) => opponent.championshipKey === windowKey)
      .filter((opponent, index, collection) => collection.findIndex((item) => item.opponent === opponent.opponent) === index)
      .map((opponent) => {
        const dayOpponentMatches = opponent.recentMatches.map((match) => ({ ...match, championshipKey: opponent.championshipKey }));
        const recentEightMatches = getChampionshipTrailingMatches(dayOpponentMatches, opponent.championshipKey, opponent.playedAt, 8);
        const firstMatchOfDay = recentEightMatches[0] ?? null;

        return {
          ...opponent,
          analyticalDate: opponent.championshipDisplayLabel ?? opponent.championshipLabel ?? opponent.championshipId ?? "Sem ID",
          recentEightMatches,
          firstMatchOfDay,
          totalWins: recentEightMatches.filter((item) => item.result === "W").length,
          totalDraws: recentEightMatches.filter((item) => item.result === "D").length,
          totalLosses: recentEightMatches.filter((item) => item.result === "L").length,
        };
      })
      .sort((left, right) => left.opponent.localeCompare(right.opponent, "pt-BR"));

    const dayMatches = dayRows
      .flatMap((opponent) => opponent.recentMatches.map((match) => ({ ...match, championshipKey: opponent.championshipKey })))
      .filter((match) => match.championshipKey === windowKey)
      .sort((left, right) => new Date(left.playedAt).getTime() - new Date(right.playedAt).getTime());

    return {
      dayKey: windowKey,
      analyticalDate: dayRows[0]?.analyticalDate ?? "",
      dayMatches,
      opponents: dayRows,
    };
  }).filter((day) => day.dayMatches.length >= data.championship.gamesPerDay);

  return (
    <AppShell
      eyebrow="Disparidade"
      title={data.player.name}
      description={`Sequencia recente e confrontos agrupados de ${data.player.name} em ${mode.leagueTypeLabel}.`}
    >
      <section className="grid gap-6">
        <SurfaceCard>
          <h2 className="font-display text-2xl text-ink">Ultimos 30 jogos</h2>
          <div className="mt-4 grid gap-3 sm:grid-cols-3">
            <div className="rounded-[1rem] border border-ink/10 bg-white/70 px-4 py-3">
              <p className="text-xs uppercase tracking-[0.2em] text-brand-strong">W</p>
              <p className="mt-2 text-2xl font-semibold text-ink">{formatPercent(data.recentWindow.winRate)}</p>
              <p className="mt-1 text-sm text-ink/62">{formatNumber(data.recentWindow.wins)} jogos</p>
            </div>
            <div className="rounded-[1rem] border border-ink/10 bg-white/70 px-4 py-3">
              <p className="text-xs uppercase tracking-[0.2em] text-brand-strong">D</p>
              <p className="mt-2 text-2xl font-semibold text-ink">{formatPercent(data.recentWindow.drawRate)}</p>
              <p className="mt-1 text-sm text-ink/62">{formatNumber(data.recentWindow.draws)} jogos</p>
            </div>
            <div className="rounded-[1rem] border border-ink/10 bg-white/70 px-4 py-3">
              <p className="text-xs uppercase tracking-[0.2em] text-brand-strong">L</p>
              <p className="mt-2 text-2xl font-semibold text-ink">{formatPercent(data.recentWindow.lossRate)}</p>
              <p className="mt-1 text-sm text-ink/62">{formatNumber(data.recentWindow.losses)} jogos</p>
            </div>
          </div>
          <div className="mt-5 rounded-[1.25rem] border border-ink/10 bg-white/60 p-4">
            <p className="text-xs uppercase tracking-[0.2em] text-brand-strong">Sequencia</p>
            <div className="mt-3 overflow-x-auto pb-1">
              <div className="min-w-max rounded-[1rem] border border-ink/10 bg-white/72 px-4 py-3">
                <div className="flex flex-wrap gap-2">
                  {renderSequenceWithDividers(
                    recentWindowMatches.map((match) => ({
                      key: `recent-window-${match.matchId}`,
                      result: match.result,
                      title: `Partida ${match.matchId} | Data ${match.localPlayedAtLabel} | Adversario ${match.opponent} | HT ${match.intervalScore ?? "sem HT"} | FT ${match.fullTimeScore}`,
                    })),
                    shouldGroupSequenceByEight,
                  )}
                </div>
              </div>
            </div>
          </div>

          <div className="mt-5 rounded-[1.25rem] border border-ink/10 bg-white/60 p-4">
            <div className="flex items-center justify-between gap-3">
              <p className="text-xs uppercase tracking-[0.2em] text-brand-strong">Estudo J1 a J{dailySlotStudy.maxGamesPerDay}</p>
              <p className="text-xs uppercase tracking-[0.16em] text-ink/52">Filtro por data operacional</p>
            </div>
            <form action={`/Disparidade/${mode.slug}/${encodeURIComponent(playerId)}`} method="get" className="mt-4 grid gap-3 rounded-[1rem] border border-ink/10 bg-white/72 p-4 lg:grid-cols-[minmax(220px,1fr)_minmax(220px,1fr)_auto_auto] lg:items-end">
              <label className="flex min-w-[180px] flex-col gap-2 text-xs uppercase tracking-[0.14em] text-brand-strong">
                Data inicial
                <input type="date" name="startDate" defaultValue={defaultStudyStartDate} className="rounded-[0.85rem] border border-ink/10 bg-white px-3 py-2 text-sm font-semibold normal-case tracking-normal text-ink outline-none ring-0 transition focus:border-brand-strong/40 focus:bg-white" />
              </label>
              <label className="flex min-w-[180px] flex-col gap-2 text-xs uppercase tracking-[0.14em] text-brand-strong">
                Data final
                <input type="date" name="endDate" defaultValue={defaultStudyEndDate} className="rounded-[0.85rem] border border-ink/10 bg-white px-3 py-2 text-sm font-semibold normal-case tracking-normal text-ink outline-none ring-0 transition focus:border-brand-strong/40 focus:bg-white" />
              </label>
              <button type="submit" className="rounded-full bg-ink px-5 py-2 text-sm font-semibold text-white transition hover:bg-ink/90">Aplicar</button>
              <button type="submit" name="forceRefresh" value="1" className="rounded-full bg-[#214d66] px-5 py-2 text-sm font-semibold text-white transition hover:bg-[#1b4056]">Forcar atualizacao</button>
              <a href={`/Disparidade/${mode.slug}/${encodeURIComponent(playerId)}`} className="rounded-full border border-ink/10 bg-white px-5 py-2 text-center text-sm font-semibold text-ink/72 transition hover:border-ink/20 hover:text-ink">Limpar</a>
            </form>
            <div className="mt-4 overflow-x-auto rounded-[1rem] border border-ink/10 bg-white/72 shadow-[inset_0_1px_0_rgba(255,255,255,0.35)]">
              <div className="min-w-[1200px]">
                <div className="grid border-b border-ink/10 bg-[#f6f2e8] px-4 py-3 text-xs uppercase tracking-[0.16em] text-brand-strong" style={{ gridTemplateColumns: `180px repeat(${dailySlotStudy.maxGamesPerDay}, minmax(52px, 1fr))` }}>
                  <span className="sticky left-0 z-10 -my-3 flex items-center bg-[#f6f2e8] py-3 font-semibold">Data</span>
                  {slotTotals.map((item) => (
                    <span key={`study-header-${item.slot}`} className="text-center">J{item.slot}</span>
                  ))}
                </div>
                {filteredStudyDays.length === 0 ? (
                  <div className="px-4 py-6 text-sm text-ink/58">Nenhum dado disponivel para o filtro atual.</div>
                ) : null}
                {studyDayBreakdowns.map((day, index) => (
                  <details key={`study-row-${day.dayKey}`} className={`group border-b border-ink/10 last:border-0 ${index % 2 === 0 ? "bg-white/34" : "bg-transparent"}`}>
                    <summary className="cursor-pointer list-none [&::-webkit-details-marker]:hidden">
                      <div className="grid items-center px-4 py-3 text-sm text-ink/80" style={{ gridTemplateColumns: `180px repeat(${dailySlotStudy.maxGamesPerDay}, minmax(52px, 1fr))` }}>
                        <span className="sticky left-0 z-10 -my-3 flex flex-col items-start bg-inherit py-3 font-semibold text-ink">
                          <span className="rounded-full bg-white/80 px-3 py-1 shadow-[0_1px_0_rgba(32,31,27,0.05)]">{day.displayDate}</span>
                          <span className="mt-2 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-brand-strong">
                            <span>{day.opponentRows.length} confrontos</span>
                            <span className="group-open:hidden">Expandir</span>
                            <span className="hidden group-open:inline">Recolher</span>
                            <span className="inline-block transition-transform duration-200 group-open:rotate-180">▾</span>
                          </span>
                        </span>
                        {slotTotals.map((item) => {
                          const match = day.sortedMatches.find((entry) => entry.slot === item.slot);

                          return match ? (
                            <button
                              key={`study-${day.dayKey}-${item.slot}`}
                              type="button"
                              title={`J${item.slot} | Partida ${match.matchId} | Data ${match.localPlayedAtLabel} | Adversario ${match.opponent} | HT ${match.intervalScore ?? "sem HT"} | FT ${match.fullTimeScore}`}
                              className={`mx-auto inline-flex min-w-9 justify-center rounded-full px-3 py-1 text-xs font-semibold shadow-[0_1px_0_rgba(32,31,27,0.06)] ${getBadgeClass(match.result)}`}
                            >
                              {match.result}
                            </button>
                          ) : (
                            <span key={`study-empty-${day.dayKey}-${item.slot}`} className="mx-auto text-xs text-ink/28">-</span>
                          );
                        })}
                      </div>
                    </summary>
                    <div className="border-t border-ink/10 bg-white/66 px-4 py-4">
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <p className="text-sm font-semibold text-ink">{day.displayDate}</p>
                          <p className="mt-1 text-xs uppercase tracking-[0.14em] text-ink/52">{day.opponentRows.length} confrontos no dia</p>
                        </div>
                        <div className="flex flex-wrap gap-2">
                          {renderSequenceWithDividers(
                            day.sortedMatches.map((match) => ({
                              key: `study-sequence-${day.dayKey}-${match.matchId}`,
                              result: match.result,
                              title: `J${match.slot} | Partida ${match.matchId} | Data ${match.localPlayedAtLabel} | Adversario ${match.opponent} | HT ${match.intervalScore ?? "sem HT"} | FT ${match.fullTimeScore}`,
                            })),
                            shouldGroupSequenceByEight,
                          )}
                        </div>
                      </div>
                      <div className="mt-4 overflow-x-auto rounded-[1rem] border border-ink/10 bg-white/72">
                        <div className="min-w-[980px]">
                          <div className="grid grid-cols-[1fr_1.4fr_0.7fr_0.9fr_1.35fr] border-b border-ink/10 bg-white/70 px-4 py-3 text-xs uppercase tracking-[0.16em] text-brand-strong">
                            <span>Data</span>
                            <span>Confronto</span>
                            <span>Jogos</span>
                            <span>Total W/D/L</span>
                            <span>Ultimos 8 do J</span>
                          </div>
                          {day.opponentRows.map((opponent) => (
                            <details key={`study-detail-${day.dayKey}-${opponent.opponent}`} className="group border-b border-ink/10 last:border-0">
                              <summary className="grid cursor-pointer list-none grid-cols-[1fr_1.4fr_0.7fr_0.9fr_1.35fr] items-center gap-3 px-4 py-3 text-sm text-ink/80 [&::-webkit-details-marker]:hidden">
                                <span className="font-semibold text-ink">{day.displayDate}</span>
                                <div>
                                  <p className="font-semibold text-ink">{data.player.name} x {opponent.opponent}</p>
                                  <p className="mt-1 text-xs text-ink/52">
                                    Proximo jogo: {opponent.nextFixture ? formatUpcomingDateTime(opponent.nextFixture.playedAt) : "sem fixture futuro"}
                                  </p>
                                </div>
                                <span className="font-semibold text-ink">{opponent.totalGames}</span>
                                <span className="font-semibold text-ink">{opponent.totalWins}W {opponent.totalDraws}D {opponent.totalLosses}L</span>
                                <div className="flex items-center justify-between gap-3">
                                  <div className="flex flex-wrap gap-2">
                                    {renderSequenceWithDividers(
                                      opponent.recentEightMatches.map((match) => ({
                                        key: `study-detail-match-${day.dayKey}-${opponent.opponent}-${match.matchId}`,
                                        result: match.result,
                                        title: `J${match.slot} | Partida ${match.matchId} | Data ${match.localPlayedAtLabel} | HT ${match.intervalScore ?? "sem HT"} | FT ${match.fullTimeScore}`,
                                      })),
                                      shouldGroupSequenceByEight,
                                    )}
                                  </div>
                                  <span className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.14em] text-brand-strong">
                                    <span className="group-open:hidden">Expandir</span>
                                    <span className="hidden group-open:inline">Recolher</span>
                                    <span className="inline-block transition-transform duration-200 group-open:rotate-180">▾</span>
                                  </span>
                                </div>
                              </summary>
                              <div className="border-t border-ink/10 bg-white/55 px-4 py-4">
                                <p className="text-xs uppercase tracking-[0.14em] text-brand-strong">Dias anteriores do confronto</p>
                                {opponent.previousDays.length === 0 ? (
                                  <p className="mt-3 text-sm text-ink/58">Nenhum dia anterior encontrado para este confronto.</p>
                                ) : (
                                  <div className="mt-3 space-y-3">
                                    {opponent.previousDays.map((historyDay) => (
                                      <div key={`study-history-${day.dayKey}-${opponent.opponent}-${historyDay.championshipKey}`} className="rounded-[0.95rem] border border-ink/10 bg-white/72 px-4 py-3 text-sm text-ink/80">
                                        <div className="flex items-center justify-between gap-3">
                                          <div>
                                            <p className="font-semibold text-ink">{historyDay.analyticalDate}</p>
                                            <p className="mt-1 text-xs text-ink/52">{historyDay.totalWins}W {historyDay.totalDraws}D {historyDay.totalLosses}L</p>
                                          </div>
                                          <div className="flex flex-wrap gap-2">
                                            {renderSequenceWithDividers(
                                              historyDay.recentEightMatches.map((match) => ({
                                                key: `study-history-match-${opponent.opponent}-${historyDay.championshipKey}-${match.matchId}`,
                                                result: match.result,
                                                title: `Partida ${match.matchId} | Data ${match.localPlayedAtLabel} | HT ${match.intervalScore ?? "sem HT"} | FT ${match.fullTimeScore}`,
                                              })),
                                              shouldGroupSequenceByEight,
                                            )}
                                          </div>
                                        </div>
                                      </div>
                                    ))}
                                  </div>
                                )}
                              </div>
                            </details>
                          ))}
                        </div>
                      </div>
                    </div>
                  </details>
                ))}
                <div className="grid items-start border-t border-ink/10 bg-[#efe8d7] px-4 py-3 text-xs font-semibold text-ink/78" style={{ gridTemplateColumns: `180px repeat(${dailySlotStudy.maxGamesPerDay}, minmax(52px, 1fr))` }}>
                  <span className="sticky left-0 z-10 -my-3 flex items-center bg-[#efe8d7] py-3 uppercase tracking-[0.16em] text-brand-strong">Total W/D/L</span>
                  {slotTotals.map((item) => {
                    const total = item.wins + item.draws + item.losses;
                    const pct = total > 0 ? ((item.wins + 0.5 * item.draws) / total * 100).toFixed(1) : "-";
                    return (
                      <span key={`study-total-${item.slot}`} className="mx-auto flex max-w-[62px] flex-col items-center rounded-[0.8rem] bg-white/55 px-2 py-2 text-center leading-4 shadow-[0_1px_0_rgba(32,31,27,0.04)]">
                        <span>{item.wins}W</span>
                        <span>{item.draws}D</span>
                        <span>{item.losses}L</span>
                        <span className="mt-1 text-[11px] font-semibold text-brand-strong">{pct}%</span>
                      </span>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>

          <div className="mt-5 rounded-[1.25rem] border border-ink/10 bg-white/60 p-4">
            <div className="flex items-center justify-between gap-3">
              <p className="text-xs uppercase tracking-[0.2em] text-brand-strong">4 jogadores recentes</p>
                <p className="text-xs uppercase tracking-[0.16em] text-ink/52">Sem repetir adversario</p>
            </div>
            <div className="mt-4 overflow-x-auto rounded-[1rem] border border-ink/10 bg-white/72">
              <div className="min-w-[1080px]">
                <div className="grid grid-cols-[1fr_1.3fr_0.7fr_0.9fr_1.35fr] border-b border-ink/10 bg-white/70 px-4 py-3 text-xs uppercase tracking-[0.16em] text-brand-strong">
                  <span>Data</span>
                  <span>Confronto</span>
                  <span>ID campeonato</span>
                  <span>Total W/L/D</span>
                  <span>Ultimos 8 do J</span>
                </div>
                {recentUniqueOpponents.map((opponent) => (
                  <div key={`${opponent.opponent}-${opponent.championshipKey}`} className="grid grid-cols-[1fr_1.3fr_0.7fr_0.9fr_1.35fr] items-center gap-3 border-b border-ink/10 px-4 py-3 text-sm text-ink/80 last:border-0">
                    <span className="font-semibold text-ink">{opponent.analyticalDateLabel}</span>
                    <div>
                      <p className="font-semibold text-ink">{data.player.name} x {opponent.opponent}</p>
                      {opponent.firstMatchOfDay ? (
                        <p className="mt-1 text-xs text-ink/52">Primeiro jogo: {opponent.firstMatchOfDay.localTimeLabel}</p>
                      ) : null}
                    </div>
                    <span className="font-semibold text-ink">{opponent.championshipLabel ?? opponent.championshipId ?? "Sem ID"}</span>
                    <span className="font-semibold text-ink">{opponent.totalWins}W {opponent.totalDraws}D {opponent.totalLosses}L</span>
                    <div className="flex flex-wrap gap-2">
                      {renderSequenceWithDividers(
                        opponent.recentEightMatches.map((match) => ({
                          key: match.matchId,
                          result: match.result,
                          title: `Partida ${match.matchId} | Data ${match.localPlayedAtLabel} | HT ${match.intervalScore ?? "sem HT"} | FT ${match.fullTimeScore}`,
                        })),
                        shouldGroupSequenceByEight,
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {historicalDays.length ? (
            <div className="mt-5 rounded-[1.25rem] border border-ink/10 bg-white/60 p-4">
              <div className="flex items-center justify-between gap-3">
                <p className="text-xs uppercase tracking-[0.2em] text-brand-strong">Historico de janelas anteriores</p>
                <p className="text-xs uppercase tracking-[0.16em] text-ink/52">Ultimas 30 janelas analiticas</p>
              </div>
              <div className="mt-4 space-y-4">
                {historicalDays.map((day, index) => (
                  <details key={day.dayKey} open={index === 0} className="group rounded-[1rem] border border-ink/10 bg-white/72 open:shadow-[0_10px_30px_rgba(32,31,27,0.06)]">
                    <summary className="cursor-pointer list-none border-b border-ink/10 bg-white/70 px-4 py-3 [&::-webkit-details-marker]:hidden">
                      <div className="flex items-start justify-between gap-4">
                        <div>
                          <p className="text-sm font-semibold text-ink">{day.analyticalDate}</p>
                          <p className="mt-1 text-xs uppercase tracking-[0.14em] text-ink/52">{day.opponents.length} confrontos</p>
                        </div>
                        <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.14em] text-brand-strong">
                          <span className="group-open:hidden">Expandir</span>
                          <span className="hidden group-open:inline">Recolher</span>
                          <span className="inline-block transition-transform duration-200 group-open:rotate-180">▾</span>
                        </div>
                      </div>
                      {day.dayMatches.length ? (
                        <div className="mt-3 flex flex-wrap gap-2">
                          {renderSequenceWithDividers(
                            day.dayMatches.map((match) => ({
                              key: `day-sequence-${day.dayKey}-${match.matchId}`,
                              result: match.result,
                              title: `Partida ${match.matchId} | Data ${match.localPlayedAtLabel} | HT ${match.intervalScore ?? "sem HT"} | FT ${match.fullTimeScore}`,
                            })),
                            shouldGroupSequenceByEight,
                          )}
                        </div>
                      ) : null}
                    </summary>
                    <div className="overflow-x-auto">
                      <div className="min-w-[1080px]">
                        <div className="grid grid-cols-[1fr_1.3fr_0.7fr_0.9fr_1.35fr] border-b border-ink/10 bg-white/70 px-4 py-3 text-xs uppercase tracking-[0.16em] text-brand-strong">
                          <span>Data</span>
                          <span>Confronto</span>
                          <span>ID campeonato</span>
                          <span>Total W/D/L</span>
                          <span>Ultimos 8 do J</span>
                        </div>
                        {day.opponents.map((opponent) => (
                          <div key={`history-${opponent.opponent}-${opponent.championshipKey}-${opponent.playedAt}`} className="grid grid-cols-[1fr_1.3fr_0.7fr_0.9fr_1.35fr] items-center gap-3 border-b border-ink/10 px-4 py-3 text-sm text-ink/80 last:border-0">
                            <span className="font-semibold text-ink">{opponent.analyticalDate}</span>
                            <div>
                              <p className="font-semibold text-ink">{data.player.name} x {opponent.opponent}</p>
                              {opponent.firstMatchOfDay ? (
                                <p className="mt-1 text-xs text-ink/52">Primeiro jogo: {opponent.firstMatchOfDay.localTimeLabel}</p>
                              ) : null}
                            </div>
                            <span className="font-semibold text-ink">{opponent.championshipLabel ?? opponent.championshipId ?? "Sem ID"}</span>
                            <span className="font-semibold text-ink">{opponent.totalWins}W {opponent.totalDraws}D {opponent.totalLosses}L</span>
                            <div className="flex flex-wrap gap-2">
                              {renderSequenceWithDividers(
                                opponent.recentEightMatches.map((match) => ({
                                  key: `history-${opponent.opponent}-${match.matchId}`,
                                  result: match.result,
                                  title: `Partida ${match.matchId} | Data ${match.localPlayedAtLabel} | HT ${match.intervalScore ?? "sem HT"} | FT ${match.fullTimeScore}`,
                                })),
                                shouldGroupSequenceByEight,
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  </details>
                ))}
              </div>
            </div>
          ) : null}

          <div className="mt-5 rounded-[1.25rem] border border-ink/10 bg-white/60 p-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-xs uppercase tracking-[0.2em] text-brand-strong">Resumo final do recorte</p>
                <h2 className="mt-2 font-display text-2xl text-ink">Aproveitamento</h2>
              </div>
              <p className="text-xs uppercase tracking-[0.16em] text-ink/52">Vitorias sobre o total de jogos</p>
            </div>
            <div className="mt-4 grid gap-3 sm:grid-cols-4">
              <div className="rounded-[1rem] border border-ink/10 bg-white/72 px-4 py-4">
                <p className="text-xs uppercase tracking-[0.18em] text-brand-strong">Aproveitamento</p>
                <p className="mt-2 text-2xl font-semibold text-ink">{formatPercent(filteredStudyWinRate)}</p>
              </div>
              <div className="rounded-[1rem] border border-ink/10 bg-white/72 px-4 py-4">
                <p className="text-xs uppercase tracking-[0.18em] text-brand-strong">Total</p>
                <p className="mt-2 text-2xl font-semibold text-ink">{formatNumber(filteredStudyTotal)}</p>
              </div>
              <div className="rounded-[1rem] border border-ink/10 bg-white/72 px-4 py-4">
                <p className="text-xs uppercase tracking-[0.18em] text-brand-strong">Vitorias</p>
                <p className="mt-2 text-2xl font-semibold text-ink">{formatNumber(filteredStudyWins)}</p>
              </div>
              <div className="rounded-[1rem] border border-ink/10 bg-white/72 px-4 py-4">
                <p className="text-xs uppercase tracking-[0.18em] text-brand-strong">D / L</p>
                <p className="mt-2 text-2xl font-semibold text-ink">{formatNumber(filteredStudyDraws)} / {formatNumber(filteredStudyLosses)}</p>
              </div>
            </div>
          </div>
        </SurfaceCard>
      </section>

    </AppShell>
  );
}