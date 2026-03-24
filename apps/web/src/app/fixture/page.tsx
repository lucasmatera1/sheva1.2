import { AppShell, SurfaceCard } from "../../components/shell/app-shell";
import { FixtureLeagueList, FixtureLeagueNav, FIXTURE_LEAGUES, formatFixtureDate, getUpcomingFixturesData, type UpcomingFixturesResponse } from "./fixture-shared";

export const dynamic = "force-dynamic";

export default async function FixturePage() {
  const { data, leagueMap, nearestFixture, nextTenFixtures, staleVolta } = await getUpcomingFixturesData();
  const warning = data?.warning;

  return (
    <AppShell
      eyebrow="Fixture"
      title="Proximos jogos"
      description="Leitura direta das tabelas de futurematches para acompanhar os proximos jogos disponiveis na base ativa."
    >
      <FixtureLeagueNav leagueMap={leagueMap} />

      <SurfaceCard>
        <div className="flex flex-col gap-5 xl:flex-row xl:items-end xl:justify-between">
          <div>
            <p className="text-xs uppercase tracking-[0.24em] text-brand-strong">Futurematches</p>
            <h2 className="mt-2 font-display text-3xl text-ink">Entrada dedicada de fixtures</h2>
            <p className="mt-3 max-w-2xl text-sm leading-7 text-ink/68">
              Esta aba mostra os jogos futuros a partir das tabelas de futurematches, separados por liga e ordenados pelo kickoff mais proximo.
            </p>
          </div>

          <div className="grid gap-3 sm:grid-cols-3">
            <div className="rounded-[1rem] border border-ink/10 bg-white/70 px-4 py-4">
              <p className="text-[11px] uppercase tracking-[0.18em] text-brand-strong">Fixtures futuros</p>
              <p className="mt-2 text-2xl font-semibold text-ink">{data?.totalFixtures ?? 0}</p>
            </div>
            <div className="rounded-[1rem] border border-ink/10 bg-white/70 px-4 py-4">
              <p className="text-[11px] uppercase tracking-[0.18em] text-brand-strong">Ligas com agenda</p>
              <p className="mt-2 text-2xl font-semibold text-ink">{data?.leagues.length ?? 0}</p>
            </div>
            <div className="rounded-[1rem] border border-ink/10 bg-white/70 px-4 py-4">
              <p className="text-[11px] uppercase tracking-[0.18em] text-brand-strong">Proximo kickoff</p>
              <p className="mt-2 text-sm font-semibold text-ink">{nearestFixture ? formatFixtureDate(nearestFixture.playedAt) : "Sem fixtures"}</p>
            </div>
          </div>
        </div>

        {warning ? (
          <div className="mt-5 rounded-[1.1rem] border border-amber-400/25 bg-amber-50/70 px-4 py-4 text-sm text-ink/72">
            {warning}
          </div>
        ) : null}

        {staleVolta ? (
          <div className="mt-5 rounded-[1.1rem] border border-[#7a3f34]/15 bg-[#7a3f34]/6 px-4 py-4 text-sm text-ink/72">
            <p className="font-semibold text-ink">Observacao do Volta</p>
            <p className="mt-2 leading-7">
              A liga 6MIN VOLTA aparece aqui exatamente como estiver na tabela de futurematches. No estado atual da base, ela nao acompanha o mesmo frescor de GT e 8MIN BATTLE.
            </p>
          </div>
        ) : null}
      </SurfaceCard>

      {nextTenFixtures.length ? (
        <SurfaceCard>
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-xs uppercase tracking-[0.24em] text-brand-strong">Fila imediata</p>
              <h2 className="mt-2 font-display text-3xl text-ink">Proximos 10 fixtures</h2>
            </div>
            <p className="text-xs uppercase tracking-[0.16em] text-ink/52">Ordenado pelo kickoff mais proximo</p>
          </div>

          <div className="mt-5 overflow-x-auto">
            <table className="min-w-full text-left text-sm text-ink">
              <thead>
                <tr className="border-b border-ink/10 text-xs uppercase tracking-[0.18em] text-ink/55">
                  <th className="px-3 py-3">Liga</th>
                  <th className="px-3 py-3">Kickoff</th>
                  <th className="px-3 py-3">Mandante</th>
                  <th className="px-3 py-3">Visitante</th>
                  <th className="px-3 py-3">Temp.</th>
                </tr>
              </thead>
              <tbody>
                {nextTenFixtures.map((fixture) => (
                  <tr key={`top10-${fixture.id}`} className="border-b border-ink/10 last:border-b-0">
                    <td className="px-3 py-3 font-semibold text-ink">{fixture.leagueType}</td>
                    <td className="px-3 py-3 font-medium">{formatFixtureDate(fixture.playedAt)}</td>
                    <td className="px-3 py-3">{fixture.homePlayer}</td>
                    <td className="px-3 py-3">{fixture.awayPlayer}</td>
                    <td className="px-3 py-3">{fixture.seasonId ?? "-"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </SurfaceCard>
      ) : null}

      {!data || data.leagues.length === 0 ? (
        <SurfaceCard>
          <div className="rounded-[1.4rem] border border-dashed border-ink/15 bg-white/45 px-5 py-8 text-sm text-ink/60">
            Nenhum fixture futuro encontrado nas tabelas de futurematches.
          </div>
        </SurfaceCard>
      ) : (
        <section className="grid gap-6 xl:grid-cols-3">
          {FIXTURE_LEAGUES.map((item) => {
            return (
              <FixtureLeagueList key={item.leagueType} leagueType={item.leagueType} label={item.label} leagueMap={leagueMap} warning={warning} />
            );
          })}
        </section>
      )}
    </AppShell>
  );
}