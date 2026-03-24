import Link from "next/link";
import { AppShell, SurfaceCard } from "../../components/shell/app-shell";
import { fetchApi } from "../../lib/api";
import { DASHBOARD_LEAGUES } from "./dashboard-shared";
import { getLeagueUi } from "../../lib/league-ui";

export const revalidate = 15;

type UpcomingFixturesResponse = {
  generatedAt: string;
  totalFixtures: number;
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

export default async function DashboardPage() {
  const data = await fetchApi<UpcomingFixturesResponse>("/dashboard/upcoming-fixtures", { revalidate: 15 });
  const leagueCountMap = new Map((data?.leagues ?? []).map((league) => [league.leagueType, league.totalFixtures]));

  return (
    <AppShell
      eyebrow="Dashboard"
      title="Dashboard"
      description="Entrada direta por liga para navegar rapidamente pelo ecossistema ativo."
    >
      <section className="grid gap-5 lg:grid-cols-3">
        {DASHBOARD_LEAGUES.map((league) => {
          const ui = getLeagueUi(league.leagueType);
          const totalFixtures = leagueCountMap.get(league.leagueType) ?? 0;

          return (
            <Link
              key={league.leagueType}
              href={league.routePath}
              className={`flex min-h-[180px] flex-col justify-between rounded-[1.75rem] border border-ink/10 px-6 py-6 shadow-panel transition hover:-translate-y-0.5 ${ui.buttonClassName}`}
            >
              <div>
                <p className="text-xs uppercase tracking-[0.24em] text-white/72">Liga</p>
                <h2 className="mt-3 font-display text-4xl text-white">{ui.title}</h2>
                <p className="mt-3 max-w-sm text-sm leading-7 text-white/78">{league.summary}</p>
              </div>
              <div className="flex items-end justify-between gap-3">
                <span className="rounded-full bg-white/18 px-3 py-2 text-xs font-semibold uppercase tracking-[0.14em] text-white">
                  {ui.shortCode}
                </span>
                <span className="text-right text-sm font-semibold text-white/88">{totalFixtures} fixture(s)</span>
              </div>
            </Link>
          );
        })}
      </section>

      {!data ? (
        <SurfaceCard>
          <div className="rounded-[1.4rem] border border-dashed border-ink/15 bg-white/45 px-5 py-8 text-sm text-ink/60">
            Nao foi possivel ler os futurematches agora, mas as entradas por liga permanecem disponiveis.
          </div>
        </SurfaceCard>
      ) : null}
    </AppShell>
  );
}