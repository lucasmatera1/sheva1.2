import Link from "next/link";
import { SurfaceCard } from "../../components/shell/app-shell";
import { fetchApi } from "../../lib/api";
import { getLeagueUi } from "../../lib/league-ui";

type UpcomingFixturesResponse = {
  generatedAt: string;
  totalFixtures: number;
  warning?: string;
  leagues: Array<{
    leagueType: string;
    totalFixtures: number;
    fixtures: Array<{
      id: string;
      seasonId: number | null;
      playedAt: string;
      homePlayer: string;
      awayPlayer: string;
      groupLabel: string | null;
    }>;
  }>;
};

type UpcomingLeagueFixture = UpcomingFixturesResponse["leagues"][number]["fixtures"][number];

type FixtureLeagueDefinition = {
  leagueType: string;
  label: string;
  routePath: string;
};

const FIXTURE_LEAGUES: FixtureLeagueDefinition[] = [
  { leagueType: "GT LEAGUE", label: "GT League", routePath: "/fixture/gtleague" },
  { leagueType: "8MIN BATTLE", label: "8min - Battle", routePath: "/fixture/battle" },
  { leagueType: "6MIN VOLTA", label: "6min - Volta", routePath: "/fixture/volta" },
];

const FIXTURE_PAGE_LIMIT = 240;

function formatFixtureDate(value: string) {
  return new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "short",
    timeStyle: "short",
    timeZone: "America/Sao_Paulo",
  }).format(new Date(value));
}

async function getUpcomingFixturesData() {
  const data = await fetchApi<UpcomingFixturesResponse>(`/dashboard/upcoming-fixtures?limit=${FIXTURE_PAGE_LIMIT}`, { revalidate: false, cache: "no-store" });
  const orderedFixtures = data?.leagues
    .flatMap((league) => league.fixtures.map((fixture) => ({ ...fixture, leagueType: league.leagueType })))
    .sort((left, right) => new Date(left.playedAt).getTime() - new Date(right.playedAt).getTime()) ?? [];
  const leagueMap = new Map((data?.leagues ?? []).map((league) => [league.leagueType, league]));

  return {
    data,
    orderedFixtures,
    leagueMap,
    nearestFixture: orderedFixtures[0] ?? null,
    nextTenFixtures: orderedFixtures.slice(0, 10),
    staleVolta: data?.leagues.find((league) => league.leagueType === "6MIN VOLTA") ?? null,
  };
}

function FixtureLeagueNav({
  leagueMap,
  activeRoutePath,
}: {
  leagueMap: Map<string, UpcomingFixturesResponse["leagues"][number]>;
  activeRoutePath?: string;
}) {
  return (
    <SurfaceCard>
      <div className="grid gap-4 lg:grid-cols-3">
        {FIXTURE_LEAGUES.map((item) => {
          const league = leagueMap.get(item.leagueType);
          const ui = getLeagueUi(item.leagueType);
          const isActive = item.routePath === activeRoutePath;

          return (
            <Link
              key={`fixture-top-anchor-${item.leagueType}`}
              href={item.routePath}
              className={`flex min-h-[120px] w-full items-center justify-between rounded-[1.6rem] px-7 py-6 text-white shadow-[0_12px_30px_rgba(32,31,27,0.10)] transition hover:-translate-y-0.5 ${ui.buttonClassName} ${isActive ? "ring-4 ring-white/35" : ""}`}
            >
              <div className="flex flex-col items-start justify-center">
                <span className="text-[11px] uppercase tracking-[0.24em] text-white/72">Categoria</span>
                <span className="mt-2 text-2xl font-semibold leading-tight">{item.label}</span>
              </div>
              <span className="flex h-12 min-w-12 items-center justify-center rounded-full bg-white/18 px-4 text-lg font-semibold">
                {league?.totalFixtures ?? 0}
              </span>
            </Link>
          );
        })}
      </div>
    </SurfaceCard>
  );
}

function FixtureLeagueList({
  leagueType,
  label,
  leagueMap,
  warning,
}: {
  leagueType: string;
  label: string;
  leagueMap: Map<string, UpcomingFixturesResponse["leagues"][number]>;
  warning?: string;
}) {
  const league = leagueMap.get(leagueType) ?? { leagueType, totalFixtures: 0, fixtures: [] };
  const ui = getLeagueUi(leagueType);

  return (
    <SurfaceCard>
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs uppercase tracking-[0.24em] text-brand-strong">Liga</p>
          <h2 className="mt-2 font-display text-3xl text-ink">{label}</h2>
          <p className="mt-2 text-sm text-ink/68">{league.totalFixtures} fixture(s) futuro(s) encontrado(s).</p>
        </div>
        <span className={`rounded-full px-3 py-2 text-xs font-semibold ${ui.badgeClassName}`}>{ui.shortCode}</span>
      </div>

      {warning ? (
        <div className="mt-5 rounded-[1.1rem] border border-amber-400/25 bg-amber-50/70 px-4 py-4 text-sm text-ink/72">
          {warning}
        </div>
      ) : null}

      {league.fixtures.length === 0 ? (
        <div className="mt-5 rounded-[1.1rem] border border-dashed border-ink/15 bg-white/45 px-4 py-6 text-sm text-ink/58">
          Nenhum fixture futuro nesta liga.
        </div>
      ) : (
        <div className="mt-5 space-y-3">
          {league.fixtures.map((fixture) => (
            <article key={fixture.id} className="rounded-[1.15rem] border border-ink/10 bg-white/72 px-4 py-4 shadow-[0_1px_0_rgba(32,31,27,0.04)]">
              <p className="text-xs uppercase tracking-[0.16em] text-brand-strong">{formatFixtureDate(fixture.playedAt)}</p>
              <div className="mt-3 space-y-2 text-sm text-ink/82">
                <p className="font-semibold text-ink">{fixture.homePlayer} x {fixture.awayPlayer}</p>
                <p>Temporada: <span className="font-semibold text-ink">{fixture.seasonId ?? "-"}</span></p>
                <p>Grupo: <span className="font-semibold text-ink">{fixture.groupLabel ?? "-"}</span></p>
              </div>
            </article>
          ))}
        </div>
      )}
    </SurfaceCard>
  );
}

export {
  FIXTURE_LEAGUES,
  FixtureLeagueList,
  FixtureLeagueNav,
  formatFixtureDate,
  getUpcomingFixturesData,
  type UpcomingLeagueFixture,
  type UpcomingFixturesResponse,
};