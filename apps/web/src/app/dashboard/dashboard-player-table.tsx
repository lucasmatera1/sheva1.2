"use client";

import { Fragment, useState } from "react";
import { apiUrl } from "../../lib/api";
import { formatDate, formatNumber, formatPercent } from "../../lib/format";

type DashboardSequenceResult = "W" | "D" | "L";

type DashboardPlayerMatchDetail = {
  id: string;
  playedAt: string;
  homePlayer: string;
  awayPlayer: string;
  opponent: string;
  seasonId: number | null;
  result: DashboardSequenceResult;
  scoreLabel: string;
};

type DashboardPlayerFixtureDetail = {
  id: string;
  playedAt: string;
  homePlayer: string;
  awayPlayer: string;
  opponent: string;
  seasonId: number | null;
};

type DashboardPlayerPreviousWindow = {
  key: string;
  dayLabel: string;
  windowLabel: string;
  rangeLabel: string;
  totalGames: number;
  wins: number;
  draws: number;
  losses: number;
  latestPlayedAt: string | null;
  sequence: DashboardSequenceResult[];
  matches: DashboardPlayerMatchDetail[];
};

type DashboardPlayer = {
  id: string;
  name: string;
  leagueGroup?: string | null;
  totalGames: number;
  wins: number;
  draws: number;
  losses: number;
  winRate: number;
  currentWindowGames: number;
  upcomingWindowGames: number;
  daySequence?: DashboardSequenceResult[];
  latestPlayedAt: string | null;
  nextFixtureAt: string | null;
  upcomingFixtures?: DashboardPlayerFixtureDetail[];
  recentMatches?: DashboardPlayerMatchDetail[];
  previousWindows?: DashboardPlayerPreviousWindow[];
  hasPreviousWindows?: boolean;
};

type DashboardMatchGroup = {
  opponent: string;
  matches: DashboardPlayerMatchDetail[];
  expandedMatches?: DashboardPlayerMatchDetail[];
};

type DashboardSnapshotLeagueType = "GT LEAGUE" | "8MIN BATTLE" | "6MIN VOLTA";

const MAX_SEQUENCE_ITEMS = 40;
const confrontationHistoryCache = new Map<
  string,
  DashboardPlayerMatchDetail[]
>();

function normalizeKey(value: string) {
  return value.trim().replace(/\s+/g, " ").toUpperCase();
}

function getLeagueGroupCode(label?: string | null) {
  if (!label) {
    return null;
  }

  const normalized = label.trim().toUpperCase();
  const directMatch = normalized.match(/^[A-Z]$/)?.[0];

  if (directMatch) {
    return directMatch;
  }

  const suffixMatch = normalized.match(/([A-Z])$/);
  return suffixMatch?.[1] ?? null;
}

function formatLeagueGroupLabel(label?: string | null) {
  const code = getLeagueGroupCode(label);
  return code ? `Serie ${code}` : "Sem serie";
}

function getSequenceClass(result: DashboardSequenceResult) {
  if (result === "W") {
    return "bg-[#20352e] text-white";
  }

  if (result === "L") {
    return "bg-[#7a3f34] text-white";
  }

  return "bg-[#c6b487] text-ink";
}

function getWindowApx(window: DashboardPlayerPreviousWindow) {
  if (!window.totalGames) {
    return 0;
  }

  return (window.wins / window.totalGames) * 100;
}

function ExpansionButton({
  label,
  active,
  onClick,
  disabled = false,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`inline-flex items-center rounded-full border px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.14em] transition ${active ? "border-ink/18 bg-ink text-white" : "border-ink/10 bg-white/75 text-ink/65 hover:border-ink/20 hover:text-ink"} ${disabled ? "cursor-wait opacity-80" : ""}`}
    >
      {label}
    </button>
  );
}

function LoadingDot() {
  return (
    <span
      className="inline-flex h-2.5 w-2.5 rounded-full bg-[#7a3f34] animate-pulse"
      aria-hidden="true"
    />
  );
}

function ArrowToggleButton({
  direction,
  active,
  onClick,
  title,
}: {
  direction: "up" | "down";
  active: boolean;
  onClick: () => void;
  title: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      aria-label={title}
      className={`inline-flex h-7 w-7 items-center justify-center rounded-full border text-base leading-none font-semibold shadow-sm transition ${active ? "border-ink bg-ink text-white" : "border-ink/20 bg-[#f8f4ea] text-ink hover:border-ink/35 hover:bg-white"}`}
    >
      {direction === "up" ? "▴" : "▾"}
    </button>
  );
}

function MatchPill({
  result,
  title,
}: {
  result: DashboardSequenceResult;
  title?: string;
}) {
  return (
    <span
      title={title}
      className={`inline-flex h-5 min-w-5 items-center justify-center rounded-full text-[10px] font-semibold ${getSequenceClass(result)}`}
    >
      {result}
    </span>
  );
}

function SequenceDivider() {
  return <span className="mx-1 text-xs font-semibold text-ink/35">|</span>;
}

function computeBlockPoints(results: DashboardSequenceResult[]) {
  let points = 0;
  for (const r of results) {
    if (r === "W") points += 3;
    else if (r === "D") points += 1;
  }
  return points;
}

function renderSequenceWithDividers(
  items: Array<{
    key: string;
    result: DashboardSequenceResult;
    title?: string;
  }>,
  leagueType: DashboardSnapshotLeagueType,
  variant: "pill" | "button" = "pill",
) {
  const usesBlocks = leagueType === "6MIN VOLTA" || leagueType === "GT LEAGUE";

  return items.flatMap((item, index) => {
    const parts = [] as React.ReactNode[];

    if (usesBlocks && index > 0 && index % 8 === 0) {
      parts.push(<SequenceDivider key={`${item.key}-divider-${index}`} />);
    }

    if (variant === "button") {
      parts.push(
        <button
          key={item.key}
          type="button"
          title={item.title}
          className={`inline-flex min-w-9 justify-center rounded-full px-3 py-1 text-xs font-semibold ${getSequenceClass(item.result)}`}
        >
          {item.result}
        </button>,
      );
    } else {
      parts.push(
        <MatchPill key={item.key} result={item.result} title={item.title} />,
      );
    }

    return parts;
  });
}

function renderSequenceBlocks(
  items: Array<{
    key: string;
    result: DashboardSequenceResult;
    title?: string;
  }>,
  leagueType: DashboardSnapshotLeagueType,
  variant: "pill" | "button" = "pill",
) {
  const usesBlocks = leagueType === "6MIN VOLTA" || leagueType === "GT LEAGUE";
  if (!usesBlocks || items.length === 0) {
    return (
      <div className="flex flex-wrap gap-1">
        {renderSequenceWithDividers(items, leagueType, variant)}
      </div>
    );
  }

  const blocks: Array<typeof items> = [];
  for (let i = 0; i < items.length; i += 8) {
    blocks.push(items.slice(i, i + 8));
  }

  return (
    <div className="flex flex-wrap items-end gap-y-1">
      {blocks.map((block, blockIndex) => {
        const pts = computeBlockPoints(block.map((b) => b.result));
        return (
          <Fragment key={`block-${blockIndex}`}>
            {blockIndex > 0 && <SequenceDivider />}
            <div className="flex flex-col items-center">
              <span className="mb-0.5 text-[9px] font-bold tabular-nums text-ink/45">
                {pts}p
              </span>
              <div className="flex gap-0.5">
                {block.map((item) =>
                  variant === "button" ? (
                    <button
                      key={item.key}
                      type="button"
                      title={item.title}
                      className={`inline-flex min-w-9 justify-center rounded-full px-3 py-1 text-xs font-semibold ${getSequenceClass(item.result)}`}
                    >
                      {item.result}
                    </button>
                  ) : (
                    <MatchPill
                      key={item.key}
                      result={item.result}
                      title={item.title}
                    />
                  ),
                )}
              </div>
            </div>
          </Fragment>
        );
      })}
    </div>
  );
}

function formatMatchDay(value: string) {
  return new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "short",
  }).format(new Date(value));
}

function groupMatchesByOpponent(
  playerName: string,
  matches: DashboardPlayerMatchDetail[],
) {
  return Array.from(
    matches.reduce((map, match) => {
      const key = `${playerName} x ${match.opponent}`;
      const current = map.get(key) ?? {
        opponent: match.opponent,
        matches: [] as DashboardPlayerMatchDetail[],
      };
      current.matches.push(match);
      map.set(key, current);
      return map;
    }, new Map<string, DashboardMatchGroup>()),
  ).map(([, value]) => value);
}

function mergeMatchCollections(...collections: DashboardPlayerMatchDetail[][]) {
  return Array.from(
    collections
      .flat()
      .reduce((map, match) => {
        map.set(match.id, match);
        return map;
      }, new Map<string, DashboardPlayerMatchDetail>())
      .values(),
  ).sort(
    (left, right) =>
      new Date(left.playedAt).getTime() - new Date(right.playedAt).getTime(),
  );
}

function groupMatchesByDay(matches: DashboardPlayerMatchDetail[]) {
  return Array.from(
    matches.reduce((map, match) => {
      const key = formatMatchDay(match.playedAt);
      const current = map.get(key) ?? [];
      current.push(match);
      map.set(key, current);
      return map;
    }, new Map<string, DashboardPlayerMatchDetail[]>()),
  )
    .map(([dayLabel, dayMatches]) => ({ dayLabel, matches: dayMatches }))
    .sort(
      (left, right) =>
        new Date(right.matches[0]?.playedAt ?? 0).getTime() -
        new Date(left.matches[0]?.playedAt ?? 0).getTime(),
    );
}

function ConfrontationGroup({
  playerName,
  group,
  scopeKey,
  leagueType,
}: {
  playerName: string;
  group: DashboardMatchGroup;
  scopeKey: string;
  leagueType: DashboardSnapshotLeagueType;
}) {
  const cacheKey = `${leagueType}::${normalizeKey(playerName)}::${normalizeKey(group.opponent)}`;
  const preloadMatches = group.expandedMatches ?? group.matches;
  const cachedMatches = confrontationHistoryCache.get(cacheKey) ?? null;
  const [historyMatches, setHistoryMatches] = useState<
    DashboardPlayerMatchDetail[] | null
  >(cachedMatches);
  const [hasLoadedHistory, setHasLoadedHistory] = useState(
    Boolean(cachedMatches),
  );
  const [isLoadingHistory, setIsLoadingHistory] = useState(false);
  const [historyLoadFailed, setHistoryLoadFailed] = useState(false);
  const latestMatch =
    group.matches[group.matches.length - 1] ?? group.matches[0];
  const expandedMatches = mergeMatchCollections(
    preloadMatches,
    historyMatches ?? [],
  );
  const matchesByDay = groupMatchesByDay(expandedMatches);

  const loadHistory = async (open: boolean) => {
    if (!open || hasLoadedHistory || isLoadingHistory) {
      return;
    }

    setIsLoadingHistory(true);
    setHistoryLoadFailed(false);

    try {
      const query = new URLSearchParams({
        league: leagueType,
        player: playerName,
        opponent: group.opponent,
      });
      const response = await fetch(
        `${apiUrl}/dashboard/confrontation-history?${query.toString()}`,
        { cache: "no-store" },
      );

      if (!response.ok) {
        setHistoryLoadFailed(true);
        return;
      }

      const data = (await response.json()) as DashboardPlayerMatchDetail[];
      const mergedHistory = mergeMatchCollections(preloadMatches, data);
      confrontationHistoryCache.set(cacheKey, mergedHistory);
      setHistoryMatches(mergedHistory);
      setHasLoadedHistory(true);
      setHistoryLoadFailed(false);
    } catch {
      setHistoryLoadFailed(true);
    } finally {
      setIsLoadingHistory(false);
    }
  };

  return (
    <details
      className="group border-b border-ink/10 last:border-b-0"
      onToggle={(event) =>
        loadHistory((event.currentTarget as HTMLDetailsElement).open)
      }
    >
      <summary className="cursor-pointer list-none px-4 py-4 [&::-webkit-details-marker]:hidden">
        <div className="grid gap-3 md:grid-cols-[1.15fr_0.55fr_1.6fr_0.42fr] md:items-center">
          <div>
            <p className="font-semibold text-ink">
              {playerName} x {group.opponent}
            </p>
            <p className="mt-1 text-xs text-ink/55">
              Ultimo:{" "}
              {formatDate(latestMatch?.playedAt ?? new Date().toISOString())}
            </p>
          </div>
          <p className="text-xs uppercase tracking-[0.14em] text-ink/58">
            {group.matches.length} jogo(s)
          </p>
          {renderSequenceBlocks(
            group.matches.map((match) => ({
              key: `${scopeKey}-${group.opponent}-${match.id}`,
              result: match.result,
              title: `${formatDate(match.playedAt)} | ${match.homePlayer} x ${match.awayPlayer} | Placar: ${match.scoreLabel} | Adversario: ${match.opponent}`,
            })),
            leagueType,
          )}
          <div className="text-right text-[11px] font-semibold uppercase tracking-[0.14em] text-brand-strong">
            {isLoadingHistory ? (
              <span className="mr-2 normal-case tracking-normal text-ink/55">
                Carregando...
              </span>
            ) : null}
            {historyLoadFailed ? (
              <span className="mr-2 normal-case tracking-normal text-[#7a3f34]">
                Falha ao carregar
              </span>
            ) : null}
            <span className="group-open:hidden">Expandir</span>
            <span className="hidden group-open:inline">Recolher</span>
          </div>
        </div>
      </summary>

      <div className="border-t border-ink/10 bg-white/72 px-4 py-4">
        <div className="overflow-hidden rounded-[0.9rem] border border-ink/10 bg-white">
          <div className="hidden grid-cols-[0.7fr_1.8fr_0.45fr] gap-3 border-b border-ink/10 bg-[#f8f4ea] px-4 py-3 text-[11px] uppercase tracking-[0.16em] text-brand-strong md:grid">
            <span>Data</span>
            <span>Sequencia</span>
            <span className="text-right">Apx</span>
          </div>
          <div>
            {matchesByDay.map((dayGroup) => {
              const wins = dayGroup.matches.filter(
                (match) => match.result === "W",
              ).length;
              const dayRate = dayGroup.matches.length
                ? (wins / dayGroup.matches.length) * 100
                : 0;

              return (
                <article
                  key={`${scopeKey}-${group.opponent}-${dayGroup.dayLabel}`}
                  className="grid gap-3 border-b border-ink/10 px-4 py-4 text-sm text-ink/78 last:border-b-0 md:grid-cols-[0.7fr_1.8fr_0.45fr] md:items-center"
                >
                  <div>
                    <p className="text-sm font-semibold text-ink">
                      {dayGroup.dayLabel}
                    </p>
                    <p className="mt-1 text-[10px] uppercase tracking-[0.12em] text-ink/48">
                      {dayGroup.matches.length} jogo(s)
                    </p>
                  </div>
                  <div>
                    {renderSequenceBlocks(
                      dayGroup.matches.map((match, matchIndex) => ({
                        key: `${scopeKey}-${dayGroup.dayLabel}-${match.id}-${matchIndex}`,
                        result: match.result,
                        title: `${formatDate(match.playedAt)} | ${match.homePlayer} x ${match.awayPlayer} | Placar: ${match.scoreLabel} | Temporada: ${match.seasonId ?? "-"}`,
                      })),
                      leagueType,
                    )}
                    <p className="mt-2 text-[10px] uppercase tracking-[0.12em] text-ink/48">
                      Mais antigo | mais recente
                    </p>
                  </div>
                  <div className="text-left md:text-right">
                    <span className="inline-flex rounded-full bg-[#20352e] px-3 py-1 text-sm font-semibold text-white">
                      {formatPercent(dayRate, 0)}
                    </span>
                  </div>
                </article>
              );
            })}
          </div>
        </div>
      </div>
    </details>
  );
}

function PlayerRow({
  player,
  leagueType,
  showLeagueGroup = false,
}: {
  player: DashboardPlayer;
  leagueType: DashboardSnapshotLeagueType;
  showLeagueGroup?: boolean;
}) {
  const [showUpcoming, setShowUpcoming] = useState(false);
  const [showPast, setShowPast] = useState(false);
  const [showPreviousWindows, setShowPreviousWindows] = useState(false);
  const [lazyPreviousWindows, setLazyPreviousWindows] = useState<
    DashboardPlayerPreviousWindow[] | null
  >(null);
  const [isLoadingPreviousWindows, setIsLoadingPreviousWindows] =
    useState(false);
  const [previousWindowsLoadFailed, setPreviousWindowsLoadFailed] =
    useState(false);
  const daySequence = player.daySequence ?? [];
  const upcomingFixtures = player.upcomingFixtures ?? [];
  const recentMatches = player.recentMatches ?? [];
  const previousWindows = lazyPreviousWindows ?? player.previousWindows ?? [];
  const canExpandUpcoming =
    player.upcomingWindowGames > 0 || upcomingFixtures.length > 0;
  const canExpandPast = player.totalGames > 0 || recentMatches.length > 0;
  const canExpandPreviousWindows =
    previousWindows.length > 0 || Boolean(player.hasPreviousWindows);
  const visibleDaySequence = daySequence.slice(0, MAX_SEQUENCE_ITEMS);
  const visibleRecentMatches = recentMatches.slice(0, MAX_SEQUENCE_ITEMS);
  const historicalMatches = previousWindows.flatMap((window) => window.matches);
  const recentMatchesByOpponent = groupMatchesByOpponent(
    player.name,
    recentMatches,
  ).map((group) => ({
    ...group,
    expandedMatches: mergeMatchCollections(
      group.matches,
      historicalMatches.filter(
        (match) =>
          normalizeKey(match.opponent) === normalizeKey(group.opponent),
      ),
    ),
  }));

  const loadPreviousWindows = async () => {
    if (
      previousWindows.length > 0 ||
      !player.hasPreviousWindows ||
      isLoadingPreviousWindows
    ) {
      return;
    }

    setIsLoadingPreviousWindows(true);
    setPreviousWindowsLoadFailed(false);

    try {
      const query = new URLSearchParams({
        league: leagueType,
        player: player.name,
      });
      const response = await fetch(
        `${apiUrl}/dashboard/player-previous-windows?${query.toString()}`,
        { cache: "no-store" },
      );

      if (!response.ok) {
        setPreviousWindowsLoadFailed(true);
        return;
      }

      const data = (await response.json()) as DashboardPlayerPreviousWindow[];
      setLazyPreviousWindows(data);
      setPreviousWindowsLoadFailed(false);
    } catch {
      setPreviousWindowsLoadFailed(true);
    } finally {
      setIsLoadingPreviousWindows(false);
    }
  };

  const togglePreviousWindows = () => {
    const nextValue = !showPreviousWindows;
    setShowPreviousWindows(nextValue);
    if (nextValue) {
      void loadPreviousWindows();
    }
  };

  const rootGridClassName = showLeagueGroup
    ? "grid gap-2 xl:grid-cols-[minmax(0,0.82fr)_minmax(0,0.45fr)_minmax(0,0.5fr)_minmax(0,1.7fr)_minmax(0,0.32fr)_minmax(0,0.32fr)_minmax(0,0.6fr)] xl:items-center"
    : "grid gap-2 xl:grid-cols-[minmax(0,0.9fr)_minmax(0,0.5fr)_minmax(0,1.85fr)_minmax(0,0.32fr)_minmax(0,0.32fr)_minmax(0,0.6fr)] xl:items-center";

  return (
    <article className="rounded-[1.35rem] border border-ink/10 bg-white/72 p-4 shadow-sm">
      {showUpcoming ? (
        <div className="mb-4 rounded-[1.1rem] border border-ink/10 bg-white/80 px-4 py-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-xs uppercase tracking-[0.16em] text-brand-strong">
                Proximos jogos da janela
              </p>
              <p className="mt-1 text-sm text-ink/62">
                {upcomingFixtures.length} fixture(s) para {player.name}
              </p>
            </div>
            <ExpansionButton
              label="Recolher acima"
              active
              onClick={() => setShowUpcoming(false)}
            />
          </div>
          <div className="mt-4 overflow-hidden rounded-[0.95rem] border border-ink/10 bg-[#f8f4ea]">
            <div className="hidden grid-cols-[1.05fr_1.2fr_0.9fr_0.8fr] gap-3 border-b border-ink/10 bg-white/50 px-4 py-3 text-[11px] uppercase tracking-[0.16em] text-brand-strong md:grid">
              <span>Data</span>
              <span>Confronto</span>
              <span>Adversario</span>
              <span>Temporada</span>
            </div>
            <div>
              {upcomingFixtures.map((fixture) => (
                <article
                  key={fixture.id}
                  className="grid gap-2 border-b border-ink/10 px-4 py-4 text-sm text-ink/78 last:border-b-0 md:grid-cols-[1.05fr_1.2fr_0.9fr_0.8fr] md:items-center md:gap-3"
                >
                  <p className="text-[11px] uppercase tracking-[0.14em] text-brand-strong md:text-xs md:text-ink/70">
                    {formatDate(fixture.playedAt)}
                  </p>
                  <p className="font-semibold text-ink">
                    {fixture.homePlayer} x {fixture.awayPlayer}
                  </p>
                  <p className="text-xs text-ink/55">{fixture.opponent}</p>
                  <p className="text-xs text-ink/55">
                    {fixture.seasonId ?? "-"}
                  </p>
                </article>
              ))}
            </div>
          </div>
        </div>
      ) : null}

      <div className={rootGridClassName}>
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-lg font-semibold text-ink">{player.name}</p>
            {showLeagueGroup ? (
              <span className="inline-flex rounded-full border border-ink/10 bg-white px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-ink/62">
                {formatLeagueGroupLabel(player.leagueGroup)}
              </span>
            ) : null}
            {canExpandUpcoming ? (
              <ArrowToggleButton
                direction="up"
                active={showUpcoming}
                onClick={() => setShowUpcoming((value) => !value)}
                title={
                  showUpcoming
                    ? "Recolher proximos jogos"
                    : "Expandir proximos jogos"
                }
              />
            ) : null}
            {canExpandPast ? (
              <ArrowToggleButton
                direction="down"
                active={showPast}
                onClick={() => setShowPast((value) => !value)}
                title={
                  showPast
                    ? "Recolher jogos encerrados"
                    : "Expandir jogos encerrados"
                }
              />
            ) : null}
          </div>
          <div className="mt-1 space-y-1 text-[11px] uppercase tracking-[0.16em] text-ink/48">
            <p>{formatNumber(player.totalGames)} jogo(s) no dia</p>
            <p>{formatNumber(player.upcomingWindowGames)} prox.</p>
          </div>
        </div>

        {showLeagueGroup ? (
          <div className="min-w-0 justify-self-start xl:-ml-1">
            <span className="inline-flex rounded-full border border-ink/10 bg-white px-3 py-1 text-xs font-semibold text-ink/68">
              {formatLeagueGroupLabel(player.leagueGroup)}
            </span>
          </div>
        ) : null}

        <div className="min-w-0 justify-self-start xl:-ml-1">
          <p className="text-sm font-semibold text-ink">
            {formatNumber(player.wins)} / {formatNumber(player.draws)} /{" "}
            {formatNumber(player.losses)}
          </p>
          <p className="mt-1 text-xs uppercase tracking-[0.16em] text-ink/48">
            W / D / L
          </p>
        </div>

        <div className="min-w-0">
          {visibleDaySequence.length ? (
            visibleRecentMatches.length ? (
              renderSequenceBlocks(
                visibleRecentMatches.map((match, index) => ({
                  key: `${player.id}-${index}`,
                  result: match.result,
                  title: `${formatDate(match.playedAt)} | ${match.homePlayer} x ${match.awayPlayer} | Placar: ${match.scoreLabel} | Adversario: ${match.opponent}`,
                })),
                leagueType,
              )
            ) : (
              renderSequenceBlocks(
                visibleDaySequence.map((result, index) => ({
                  key: `${player.id}-${index}`,
                  result,
                  title: `Jogo ${index + 1}: ${result}`,
                })),
                leagueType,
              )
            )
          ) : (
            <span className="text-xs text-ink/48">Sem jogos</span>
          )}
          <p className="mt-2 text-[10px] uppercase tracking-[0.12em] text-ink/48">
            Mais antigo | mais recente
          </p>
          {canExpandPreviousWindows ? (
            <div className="mt-3">
              <div className="flex flex-wrap items-center gap-2">
                <ExpansionButton
                  label={
                    showPreviousWindows
                      ? "Ocultar J anteriores"
                      : "Ver J anteriores"
                  }
                  active={showPreviousWindows}
                  onClick={togglePreviousWindows}
                  disabled={isLoadingPreviousWindows}
                />
                {isLoadingPreviousWindows ? (
                  <span className="inline-flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-[#7a3f34]">
                    <LoadingDot />
                    Carregando historico
                  </span>
                ) : null}
                {previousWindowsLoadFailed ? (
                  <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[#7a3f34]">
                    Falha ao carregar
                  </span>
                ) : null}
              </div>
            </div>
          ) : null}
        </div>

        <div className="min-w-0 justify-self-start xl:justify-self-end">
          <span className="inline-flex rounded-full bg-[#20352e] px-3 py-1 text-sm font-semibold text-white">
            {formatPercent(player.winRate)}
          </span>
        </div>

        <div className="min-w-0 justify-self-start xl:justify-self-end">
          <span className="inline-flex rounded-full bg-[#c6b487] px-3 py-1 text-sm font-semibold text-ink">
            {formatNumber(player.wins * 3 + player.draws)}
          </span>
        </div>

        <div className="min-w-0 justify-self-end text-right text-[11px] leading-5 text-ink/60 xl:min-w-[138px]">
          <p>
            {player.latestPlayedAt
              ? `Ultimo: ${formatDate(player.latestPlayedAt)}`
              : "Ultimo: sem jogo"}
          </p>
          <p className="mt-1">
            {player.nextFixtureAt
              ? `Proximo: ${formatDate(player.nextFixtureAt)}`
              : "Proximo: sem fixture"}
          </p>
        </div>
      </div>

      {showPast ? (
        <div className="mt-4 rounded-[1.1rem] border border-ink/10 bg-white/80 px-4 py-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-xs uppercase tracking-[0.16em] text-brand-strong">
                Jogos encerrados do dia
              </p>
              <p className="mt-1 text-sm text-ink/62">
                Lista por confronto com a sequencia W / D / L no recorte atual.
              </p>
            </div>
            <p className="text-xs uppercase tracking-[0.14em] text-ink/52">
              {recentMatches.length} jogo(s)
            </p>
          </div>

          <div className="mt-4 overflow-hidden rounded-[0.95rem] border border-ink/10 bg-[#f8f4ea]">
            <div className="hidden grid-cols-[1.15fr_0.55fr_1.6fr_0.42fr] gap-3 border-b border-ink/10 bg-white/50 px-4 py-3 text-[11px] uppercase tracking-[0.16em] text-brand-strong md:grid">
              <span>Confronto</span>
              <span>Jogos</span>
              <span>Sequencia</span>
              <span className="text-right">Detalhe</span>
            </div>
            <div>
              {recentMatchesByOpponent.map((group) => (
                <ConfrontationGroup
                  key={`${player.id}-${group.opponent}`}
                  playerName={player.name}
                  group={group}
                  scopeKey={`${player.id}-recent`}
                  leagueType={leagueType}
                />
              ))}
            </div>
          </div>
        </div>
      ) : null}

      {showPreviousWindows ? (
        <div className="mt-4 rounded-[1.1rem] border border-ink/10 bg-white/80 px-4 py-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-xs uppercase tracking-[0.16em] text-brand-strong">
                Sequencia dos J anteriores
              </p>
              <p className="mt-1 text-sm text-ink/62">
                Janelas anteriores do mesmo jogador, da mais recente para a mais
                antiga.
              </p>
            </div>
            <p className="text-xs uppercase tracking-[0.14em] text-ink/52">
              {isLoadingPreviousWindows
                ? "Carregando"
                : `${previousWindows.length} J`}
            </p>
          </div>

          {isLoadingPreviousWindows ? (
            <div className="mt-4 rounded-[0.95rem] border border-ink/10 bg-white/70 px-4 py-5">
              <div className="animate-pulse space-y-4">
                <div className="flex items-center justify-between gap-3">
                  <div className="space-y-2">
                    <div className="h-3 w-36 rounded-full bg-[#e7e1d2]" />
                    <div className="h-3 w-56 rounded-full bg-[#efe9dc]" />
                  </div>
                  <div className="h-7 w-24 rounded-full bg-[#e7e1d2]" />
                </div>
                <div className="grid gap-3 md:grid-cols-2">
                  <div className="rounded-[0.85rem] border border-ink/8 bg-[#f8f4ea] p-4">
                    <div className="flex flex-wrap gap-2">
                      {Array.from({ length: 8 }).map((_, index) => (
                        <span
                          key={`skeleton-pill-left-${index}`}
                          className="h-7 w-10 rounded-full bg-[#e7e1d2]"
                        />
                      ))}
                    </div>
                  </div>
                  <div className="rounded-[0.85rem] border border-ink/8 bg-[#f8f4ea] p-4">
                    <div className="flex flex-wrap gap-2">
                      {Array.from({ length: 8 }).map((_, index) => (
                        <span
                          key={`skeleton-pill-right-${index}`}
                          className="h-7 w-10 rounded-full bg-[#efe9dc]"
                        />
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          ) : previousWindows.length ? (
            <div className="mt-4 space-y-3">
              {previousWindows.map((window, index) => (
                <details
                  key={`${player.id}-${window.key}`}
                  open={index === 0}
                  className="group rounded-[0.95rem] border border-ink/10 bg-[#f8f4ea] open:bg-white"
                >
                  <summary className="cursor-pointer list-none px-4 py-3 [&::-webkit-details-marker]:hidden">
                    <div className="flex items-start justify-between gap-4">
                      <div>
                        <p className="text-sm font-semibold text-ink">
                          {window.windowLabel} | {window.dayLabel}
                        </p>
                        <p className="mt-1 text-xs text-ink/55">
                          {window.totalGames} jogo(s) | {window.wins}W{" "}
                          {window.draws}D {window.losses}L | {window.rangeLabel}{" "}
                          | APX {formatPercent(getWindowApx(window))}
                        </p>
                      </div>
                      <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.14em] text-brand-strong">
                        <span className="group-open:hidden">Expandir</span>
                        <span className="hidden group-open:inline">
                          Recolher
                        </span>
                        <span className="inline-block transition-transform duration-200 group-open:rotate-180">
                          ▾
                        </span>
                      </div>
                    </div>
                    <div className="mt-3 flex flex-wrap items-end gap-4">
                      <div className="min-w-0 flex-1">
                        {renderSequenceBlocks(
                          window.matches
                            .slice(0, MAX_SEQUENCE_ITEMS)
                            .map((match, matchIndex) => ({
                              key: `${window.key}-${match.id}-${matchIndex}`,
                              result: match.result,
                              title: `${formatDate(match.playedAt)} | ${match.homePlayer} x ${match.awayPlayer} | Placar: ${match.scoreLabel} | Adversario: ${match.opponent}`,
                            })),
                          leagueType,
                          "button",
                        )}
                      </div>
                      <div className="flex shrink-0 items-center gap-2">
                        <span className="inline-flex rounded-full bg-[#20352e] px-3 py-1 text-sm font-semibold text-white">
                          {formatPercent(getWindowApx(window))}
                        </span>
                        <span className="inline-flex rounded-full bg-[#c6b487] px-3 py-1 text-sm font-semibold text-ink">
                          {formatNumber(window.wins * 3 + window.draws)}
                        </span>
                      </div>
                    </div>
                  </summary>
                  <div className="border-t border-ink/10 px-4 py-4">
                    <div className="overflow-hidden rounded-[0.95rem] border border-ink/10 bg-white/72">
                      <div className="hidden grid-cols-[1.15fr_0.55fr_1.6fr_0.42fr] gap-3 border-b border-ink/10 bg-white/70 px-4 py-3 text-[11px] uppercase tracking-[0.16em] text-brand-strong md:grid">
                        <span>Confronto</span>
                        <span>Jogos</span>
                        <span>Sequencia</span>
                        <span className="text-right">Detalhe</span>
                      </div>
                      <div>
                        {groupMatchesByOpponent(
                          player.name,
                          window.matches,
                        ).map((group) => (
                          <ConfrontationGroup
                            key={`${window.key}-${group.opponent}`}
                            playerName={player.name}
                            group={group}
                            scopeKey={window.key}
                            leagueType={leagueType}
                          />
                        ))}
                      </div>
                    </div>
                  </div>
                </details>
              ))}
            </div>
          ) : previousWindowsLoadFailed ? (
            <div className="mt-4 rounded-[0.95rem] border border-dashed border-[#7a3f34]/30 bg-[#fff5f2] px-4 py-5 text-sm text-[#7a3f34]">
              Nao foi possivel carregar os J anteriores agora. Tente abrir
              novamente em alguns segundos.
            </div>
          ) : (
            <div className="mt-4 rounded-[0.95rem] border border-dashed border-ink/15 bg-white/45 px-4 py-5 text-sm text-ink/60">
              Nenhum J anterior encontrado no recorte carregado para este
              jogador.
            </div>
          )}
        </div>
      ) : null}
    </article>
  );
}

function DashboardPlayerTable({
  players,
  leagueType,
  showLeagueGroup = false,
}: {
  players: DashboardPlayer[];
  leagueType: DashboardSnapshotLeagueType;
  showLeagueGroup?: boolean;
}) {
  const headerGridClassName = showLeagueGroup
    ? "hidden items-center gap-2 border-b border-ink/10 px-2 pb-3 text-[11px] uppercase tracking-[0.16em] text-brand-strong xl:grid xl:grid-cols-[minmax(0,0.82fr)_minmax(0,0.45fr)_minmax(0,0.5fr)_minmax(0,1.7fr)_minmax(0,0.32fr)_minmax(0,0.32fr)_minmax(0,0.6fr)]"
    : "hidden items-center gap-2 border-b border-ink/10 px-2 pb-3 text-[11px] uppercase tracking-[0.16em] text-brand-strong xl:grid xl:grid-cols-[minmax(0,0.9fr)_minmax(0,0.5fr)_minmax(0,1.85fr)_minmax(0,0.32fr)_minmax(0,0.32fr)_minmax(0,0.6fr)]";

  return (
    <Surface>
      <div className={headerGridClassName}>
        <span>Player</span>
        {showLeagueGroup ? <span>Serie</span> : null}
        <span>W / D / L do dia</span>
        <span>Sequencia</span>
        <span className="text-right">Apx</span>
        <span className="text-right">Pontos</span>
        <span className="text-right">Ultimo / proximo</span>
      </div>

      <div className="mt-4 space-y-3">
        {players.map((player) => (
          <PlayerRow
            key={player.id}
            player={player}
            leagueType={leagueType}
            showLeagueGroup={showLeagueGroup}
          />
        ))}
      </div>
    </Surface>
  );
}

function Surface({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}

export { DashboardPlayerTable };
