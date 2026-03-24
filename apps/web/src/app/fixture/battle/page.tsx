import Link from "next/link";
import { AppShell, SurfaceCard } from "../../../components/shell/app-shell";
import { FixtureLeagueList, FixtureLeagueNav, getUpcomingFixturesData } from "../fixture-shared";

export const dynamic = "force-dynamic";

export default async function FixtureBattlePage() {
  const { leagueMap } = await getUpcomingFixturesData();

  return (
    <AppShell
      eyebrow="Fixture"
      title="8min - Battle"
      description="Leitura dedicada dos futurematches de 8MIN BATTLE, sem misturar com GT ou Volta."
    >
      <FixtureLeagueNav leagueMap={leagueMap} activeRoutePath="/fixture/battle" />
      <SurfaceCard>
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-xs uppercase tracking-[0.24em] text-brand-strong">Categoria isolada</p>
            <h2 className="mt-2 font-display text-3xl text-ink">Fixtures apenas de 8min - Battle</h2>
          </div>
          <Link href="/fixture" className="rounded-full border border-ink/10 bg-white px-5 py-2 text-sm font-semibold text-ink/72 transition hover:border-ink/20 hover:text-ink">
            Ver todas
          </Link>
        </div>
      </SurfaceCard>
      <FixtureLeagueList leagueType="8MIN BATTLE" label="8min - Battle" leagueMap={leagueMap} />
    </AppShell>
  );
}