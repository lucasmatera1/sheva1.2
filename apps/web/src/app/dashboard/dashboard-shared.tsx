import Link from "next/link";
import { AppShell, SurfaceCard } from "../../components/shell/app-shell";
import { fetchApi } from "../../lib/api";
import { formatDate, formatNumber, formatPercent } from "../../lib/format";
import { getLeagueUi } from "../../lib/league-ui";
import { DashboardGtView } from "./dashboard-gt-view";
import { DashboardPlayerTable } from "./dashboard-player-table";
import { DashboardRefreshButton } from "./dashboard-refresh-button";

type DashboardLeagueType = "GT LEAGUE" | "8MIN BATTLE" | "6MIN VOLTA";
type DashboardSequenceResult = "W" | "D" | "L";

type DashboardLeagueSnapshotResponse = {
  generatedAt: string;
  leagueType: DashboardLeagueType;
  warning?: string;
  availableDays: Array<{
    dayKey: string;
    dayLabel: string;
  }>;
  currentWindow: {
    dayKey: string;
    dayLabel: string;
    windowLabel: string;
    rangeLabel: string;
    description: string;
    usesOperationalDay: boolean;
  };
  totals: {
    activePlayers: number;
    totalGames: number;
    wins: number;
    draws: number;
    losses: number;
    winRate: number;
    totalDayMatches: number;
    currentWindowPlayedMatches: number;
    currentWindowUpcomingFixtures: number;
  };
  fixtures: Array<{
    id: string;
    playedAt: string;
    homePlayer: string;
    awayPlayer: string;
    seasonId: number | null;
    groupLabel?: string | null;
  }>;
  players: Array<{
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
    daySequence: Array<"W" | "D" | "L">;
    latestPlayedAt: string | null;
    nextFixtureAt: string | null;
    upcomingFixtures: Array<{
      id: string;
      playedAt: string;
      homePlayer: string;
      awayPlayer: string;
      opponent: string;
      seasonId: number | null;
    }>;
    recentMatches: Array<{
      id: string;
      playedAt: string;
      homePlayer: string;
      awayPlayer: string;
      opponent: string;
      seasonId: number | null;
      result: "W" | "D" | "L";
      scoreLabel: string;
    }>;
    previousWindows: Array<{
      key: string;
      dayLabel: string;
      windowLabel: string;
      rangeLabel: string;
      totalGames: number;
      wins: number;
      draws: number;
      losses: number;
      latestPlayedAt: string | null;
      sequence: Array<"W" | "D" | "L">;
      matches: Array<{
        id: string;
        playedAt: string;
        homePlayer: string;
        awayPlayer: string;
        opponent: string;
        seasonId: number | null;
        result: "W" | "D" | "L";
        scoreLabel: string;
      }>;
    }>;
    hasPreviousWindows: boolean;
  }>;
};

type DashboardViewMode = "recent" | "future";

type DashboardRecentMatchEntry = {
  id: string;
  playedAt: string;
  homePlayer: string;
  awayPlayer: string;
  opponent: string;
  seasonId: number | null;
  result: "W" | "D" | "L";
  scoreLabel: string;
  groupLabel?: string | null;
};

const GT_SERIES_ORDER = ["A", "B", "C", "D", "E", "F", "G"] as const;
const DASHBOARD_SNAPSHOT_TIMEOUT_MS = 0;

type GtFutureRow = {
  key: string;
  confrontationLabel: string;
  sequence: DashboardSequenceResult[];
  apx: number | null;
  fixturePlayedAt: string;
  seasonId: number | null;
  groupLabel?: string | null;
};

function buildConfrontationParticipants(playerA: string, playerB: string) {
  return [playerA, playerB].sort((left, right) => left.localeCompare(right, "pt-BR", { sensitivity: "base" }));
}

function buildConfrontationKey(playerA: string, playerB: string) {
  return buildConfrontationParticipants(playerA, playerB).join("||");
}

function getPerspectiveResult(match: Pick<DashboardRecentMatchEntry, "homePlayer" | "awayPlayer" | "scoreLabel">, perspectivePlayer: string): DashboardSequenceResult {
  const [homeScoreRaw, awayScoreRaw] = match.scoreLabel.split("-");
  const homeScore = Number(homeScoreRaw);
  const awayScore = Number(awayScoreRaw);

  if (homeScore === awayScore) {
    return "D";
  }

  const perspectiveIsHome = match.homePlayer === perspectivePlayer;
  const didWin = perspectiveIsHome ? homeScore > awayScore : awayScore > homeScore;

  return didWin ? "W" : "L";
}

function getGtSeriesCode(label?: string | null) {
  if (!label) {
    return null;
  }

  const normalized = label.trim().toUpperCase();
  const directMatch = GT_SERIES_ORDER.find((group) => normalized === group);

  if (directMatch) {
    return directMatch;
  }

  const suffixMatch = normalized.match(/([A-Z])$/);

  if (!suffixMatch) {
    return null;
  }

  const groupCode = suffixMatch[1] as (typeof GT_SERIES_ORDER)[number];
  return GT_SERIES_ORDER.includes(groupCode) ? groupCode : null;
}

function buildGtFutureRows(fixtures: DashboardLeagueSnapshotResponse["fixtures"], matches: DashboardRecentMatchEntry[]) {
  const matchesByPair = matches.reduce((map, match) => {
    const pairKey = buildConfrontationKey(match.homePlayer, match.awayPlayer);
    const current = map.get(pairKey) ?? [];
    current.push(match);
    map.set(pairKey, current);
    return map;
  }, new Map<string, DashboardRecentMatchEntry[]>());

  return fixtures
    .map((fixture) => {
      const pairKey = buildConfrontationKey(fixture.homePlayer, fixture.awayPlayer);
      const history = [...(matchesByPair.get(pairKey) ?? [])].sort((left, right) => new Date(left.playedAt).getTime() - new Date(right.playedAt).getTime());
      const sequence = history.map((match) => getPerspectiveResult(match, fixture.homePlayer));
      const wins = sequence.filter((result) => result === "W").length;

      return {
        key: fixture.id,
        confrontationLabel: `${fixture.homePlayer} x ${fixture.awayPlayer}`,
        sequence,
        apx: sequence.length ? (wins / sequence.length) * 100 : null,
        fixturePlayedAt: fixture.playedAt,
        seasonId: fixture.seasonId,
        groupLabel: fixture.groupLabel ?? null,
      } satisfies GtFutureRow;
    })
    .sort((left, right) => new Date(left.fixturePlayedAt).getTime() - new Date(right.fixturePlayedAt).getTime());
}

type DashboardLeagueDefinition = {
  leagueType: DashboardLeagueType;
  label: string;
  routePath: string;
  title: string;
  summary: string;
};

const DASHBOARD_LEAGUES: DashboardLeagueDefinition[] = [
  {
    leagueType: "GT LEAGUE",
    label: "GT League",
    routePath: "/dashboard/gtleague",
    title: "GT League",
    summary: "Jogadores ativos na J atual com leitura do dia e fechamento de W/D/L.",
  },
  {
    leagueType: "8MIN BATTLE",
    label: "8min - Battle",
    routePath: "/dashboard/8minbattle",
    title: "8min - Battle",
    summary: "Painel do dia com jogadores ativos no ecossistema Battle e fechamento direto por player.",
  },
  {
    leagueType: "6MIN VOLTA",
    label: "6min - Volta",
    routePath: "/dashboard/6minvolta",
    title: "6min - Volta",
    summary: "Leitura da J operacional corrente do Volta com aproveitamento agregado ao fim da grade.",
  },
];

async function getDashboardLeagueSnapshot(leagueType: DashboardLeagueType, refreshToken?: string, dayKey?: string) {
  const query = new URLSearchParams({ league: leagueType });

  if (dayKey) {
    query.set("day", dayKey);
  }

  if (refreshToken) {
    query.set("ts", refreshToken);
  }

  return fetchApi<DashboardLeagueSnapshotResponse>(`/dashboard/current-j?${query.toString()}`, {
    timeoutMs: DASHBOARD_SNAPSHOT_TIMEOUT_MS,
    cache: "no-store",
    revalidate: false,
  });
}

function DashboardLeagueNav({ activeRoutePath }: { activeRoutePath: string }) {
  return (
    <SurfaceCard>
      <div className="grid gap-4 lg:grid-cols-3">
        {DASHBOARD_LEAGUES.map((league) => {
          const ui = getLeagueUi(league.leagueType);
          const isActive = league.routePath === activeRoutePath;

          return (
            <Link
              key={league.leagueType}
              href={league.routePath}
              className={`flex min-h-[128px] items-center justify-between rounded-[1.6rem] border px-7 py-6 shadow-[0_12px_30px_rgba(32,31,27,0.08)] transition hover:-translate-y-0.5 ${isActive ? `${ui.dashboardTabClassName} border-transparent ring-4 ${ui.dashboardTabRingClassName}` : ui.dashboardTabMutedClassName}`}
            >
              <div>
                <p className={`text-[11px] uppercase tracking-[0.24em] ${isActive ? "text-white/72" : "text-current/55"}`}>Dashboard</p>
                <p className="mt-2 text-2xl font-semibold leading-tight">{league.label}</p>
              </div>
              <span className={`rounded-full px-4 py-3 text-sm font-semibold ${isActive ? "bg-white/18 text-white" : ui.badgeClassName}`}>{ui.shortCode}</span>
            </Link>
          );
        })}
      </div>
    </SurfaceCard>
  );
}

async function DashboardLeaguePage({
  leagueType,
  activeRoutePath,
  title,
  description,
  refreshToken,
  selectedGroup,
  selectedView = "recent",
  selectedDayKey,
}: {
  leagueType: DashboardLeagueType;
  activeRoutePath: string;
  title: string;
  description: string;
  refreshToken?: string;
  selectedGroup?: string;
  selectedView?: DashboardViewMode;
  selectedDayKey?: string;
}) {
  const data = await getDashboardLeagueSnapshot(leagueType, refreshToken, selectedDayKey);

  const isGtLeague = leagueType === "GT LEAGUE";
  const normalizedSelectedGroup = getGtSeriesCode(selectedGroup ?? null);
  const resolvedSelectedDayKey = selectedDayKey ?? data?.currentWindow.dayKey;
  const availableGroups = isGtLeague ? GT_SERIES_ORDER.map((group) => group) : [];
  const gtRecentMatches =
    isGtLeague && data
      ? Array.from(
          data.players
            .flatMap((player) =>
              player.recentMatches.map((match) => ({
                ...match,
                groupLabel: player.leagueGroup ?? null,
              })),
            )
            .reduce((map, match) => {
              if (!map.has(match.id)) {
                map.set(match.id, match);
              }

              return map;
            }, new Map<string, DashboardRecentMatchEntry>())
            .values(),
        ).sort((left, right) => new Date(right.playedAt).getTime() - new Date(left.playedAt).getTime())
      : [];
  const gtFutureRows = isGtLeague && data ? buildGtFutureRows(data.fixtures, gtRecentMatches) : [];

  const shouldAutoRefreshUnavailableSnapshot = Boolean(
    data?.warning &&
    data.totals.currentWindowPlayedMatches === 0 &&
    data.totals.currentWindowUpcomingFixtures === 0 &&
    data.players.length === 0,
  );

  return (
    <AppShell eyebrow="Dashboard" title={title} description={description}>
      <DashboardLeagueNav activeRoutePath={activeRoutePath} />

      {!data ? (
        <div className="grid gap-5 xl:grid-cols-[1.4fr_0.8fr]">
          <SurfaceCard>
            <div className="rounded-[1.4rem] border border-dashed border-ink/15 bg-white/45 px-5 py-8 text-sm text-ink/60">
              Nao foi possivel carregar o snapshot da liga agora.
            </div>
          </SurfaceCard>
          <SurfaceCard>
            <DashboardRefreshButton leagueType={leagueType} snapshot={null} autoRefreshOnMount autoRefreshKey="snapshot-null" />
          </SurfaceCard>
        </div>
      ) : (
        <>
          <SurfaceCard>
            {data.warning ? (
              <div className="mb-5 rounded-[1.15rem] border border-[#d8b46b] bg-[#fff7e8] px-4 py-4 text-sm text-[#7a581a]">
                {data.warning}
              </div>
            ) : null}

            <div className="flex flex-col gap-5 xl:flex-row xl:items-end xl:justify-between">
              <div>
                <p className="text-xs uppercase tracking-[0.24em] text-brand-strong">Janela ativa</p>
                <h2 className="mt-2 font-display text-3xl text-ink">
                  {data.currentWindow.usesOperationalDay ? `${data.currentWindow.windowLabel} | ${data.currentWindow.dayLabel}` : data.currentWindow.dayLabel}
                </h2>
                <p className="mt-3 max-w-3xl text-sm leading-7 text-ink/68">{data.currentWindow.description}</p>
              </div>

              <div className="grid gap-3 sm:grid-cols-2 xl:min-w-[520px] xl:grid-cols-4">
                <div className="rounded-[1.15rem] border border-ink/10 bg-white/72 px-4 py-4">
                  <p className="text-[11px] uppercase tracking-[0.18em] text-brand-strong">Faixa</p>
                  <p className="mt-2 text-lg font-semibold text-ink">{data.currentWindow.rangeLabel}</p>
                </div>
                <div className="rounded-[1.15rem] border border-ink/10 bg-white/72 px-4 py-4">
                  <p className="text-[11px] uppercase tracking-[0.18em] text-brand-strong">Jogos fechados</p>
                  <p className="mt-2 text-lg font-semibold text-ink">{formatNumber(data.totals.currentWindowPlayedMatches)}</p>
                </div>
                <div className="rounded-[1.15rem] border border-ink/10 bg-white/72 px-4 py-4">
                  <p className="text-[11px] uppercase tracking-[0.18em] text-brand-strong">Fila da janela</p>
                  <p className="mt-2 text-lg font-semibold text-ink">{formatNumber(data.totals.currentWindowUpcomingFixtures)}</p>
                </div>
                <DashboardRefreshButton
                  leagueType={leagueType}
                  autoRefreshOnMount={shouldAutoRefreshUnavailableSnapshot}
                  autoRefreshKey={shouldAutoRefreshUnavailableSnapshot ? data.generatedAt : undefined}
                  snapshot={{
                    generatedAt: data.generatedAt,
                    currentWindow: data.currentWindow,
                    totals: {
                      currentWindowPlayedMatches: data.totals.currentWindowPlayedMatches,
                      currentWindowUpcomingFixtures: data.totals.currentWindowUpcomingFixtures,
                    },
                  }}
                />
              </div>
            </div>
          </SurfaceCard>

          {isGtLeague ? (
            <DashboardGtView
              activeRoutePath={activeRoutePath}
              availableDays={data.availableDays}
              availableGroups={availableGroups}
              initialSelectedDayKey={resolvedSelectedDayKey}
              initialSelectedGroup={normalizedSelectedGroup ?? undefined}
              initialSelectedView={selectedView}
              refreshToken={refreshToken}
              players={data.players}
              futureRows={gtFutureRows}
            />
          ) : (
            <>
              <SurfaceCard>
                {data.players.length ? (
                  <DashboardPlayerTable players={data.players} leagueType={data.leagueType} />
                ) : (
                  <div className="rounded-[1.2rem] border border-dashed border-ink/15 bg-white/45 px-5 py-8 text-sm text-ink/60">
                    Nenhum jogador encontrado na janela atual desta liga.
                  </div>
                )}
              </SurfaceCard>

              <SurfaceCard>
                <div>
                  <p className="text-xs uppercase tracking-[0.2em] text-brand-strong">Fechamento final</p>
                  <h3 className="mt-2 font-display text-3xl text-ink">{formatPercent(data.totals.winRate)} de aproveitamento</h3>
                  <p className="mt-3 text-sm text-ink/65">
                    {formatNumber(data.totals.totalGames)} jogo(s) no dia com {formatNumber(data.totals.wins)}W {formatNumber(data.totals.draws)}D {formatNumber(data.totals.losses)}L.
                  </p>
                </div>

                <div className="mt-6 min-w-0">
                  <p className="text-[11px] uppercase tracking-[0.16em] text-ink/48">Fixtures da janela</p>
                  {data.fixtures.length ? (
                    <div className="mt-3 overflow-hidden rounded-[1.1rem] border border-ink/10 bg-white/72">
                      <div className="hidden grid-cols-[1.1fr_1.3fr_0.8fr] gap-3 border-b border-ink/10 bg-white/70 px-4 py-3 text-[11px] uppercase tracking-[0.16em] text-brand-strong md:grid">
                        <span>Data</span>
                        <span>Confronto</span>
                        <span>Temporada</span>
                      </div>
                      <div>
                        {data.fixtures.map((fixture) => (
                          <article key={fixture.id} className="grid gap-2 border-b border-ink/10 px-4 py-4 text-sm text-ink/78 last:border-b-0 md:grid-cols-[1.1fr_1.3fr_0.8fr] md:items-center md:gap-3">
                            <p className="text-[11px] uppercase tracking-[0.16em] text-brand-strong md:text-xs md:text-ink/70">{formatDate(fixture.playedAt)}</p>
                            <p className="font-semibold text-ink">{fixture.homePlayer} x {fixture.awayPlayer}</p>
                            <p className="text-xs text-ink/58">Temporada: {fixture.seasonId ?? "-"}</p>
                          </article>
                        ))}
                      </div>
                    </div>
                  ) : (
                    <div className="mt-3 rounded-[1.1rem] border border-dashed border-ink/15 bg-white/45 px-4 py-5 text-sm text-ink/60">
                      Nenhum fixture futuro encontrado para esta janela.
                    </div>
                  )}
                </div>
              </SurfaceCard>
            </>
          )}
        </>
      )}
    </AppShell>
  );
}

export { DASHBOARD_LEAGUES, DashboardLeaguePage };
