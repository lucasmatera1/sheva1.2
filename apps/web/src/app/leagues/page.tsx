import Link from "next/link";
import { AppShell, SurfaceCard } from "../../components/shell/app-shell";
import { fetchApi } from "../../lib/api";
import { formatDecimal, formatNumber, formatPercent } from "../../lib/format";
import { getLeagueUi } from "../../lib/league-ui";

export const dynamic = "force-dynamic";

type LeagueRow = {
  leagueType: string;
  totalGames: number;
  averageGoals: number;
  drawRate: number;
  over25Rate: number;
  bttsRate: number;
};

function sanitizeDays(value?: string) {
  const parsed = Number(value);

  if (!Number.isFinite(parsed) || parsed <= 0) {
    return 30;
  }

  return Math.floor(parsed);
}

export default async function LeaguesPage({ searchParams }: { searchParams: Promise<{ days?: string }> }) {
  const params = await searchParams;
  const selectedDays = sanitizeDays(params.days);
  const leagues = (await fetchApi<LeagueRow[]>(`/leagues?days=${selectedDays}`)) ?? [];

  return (
    <AppShell
      eyebrow="Ligas"
      title="Escolha a liga para aprofundar"
      description="A aba de ligas agora funciona como selecao direta. O recorte abre por padrao nos 30 dias mais recentes, mas voce pode escolher qualquer janela para recalcular todos os cards."
    >
      <SurfaceCard>
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="text-xs uppercase tracking-[0.25em] text-brand-strong">Filtro de dias</p>
            <p className="mt-2 text-sm text-ink/68">A listagem geral de ligas considera por padrao os 30 dias mais recentes. Ajuste para qualquer numero de dias e entre na liga mantendo a mesma janela.</p>
          </div>

          <form className="flex flex-col gap-3 sm:flex-row sm:items-end" method="get">
            <label className="text-sm text-ink/72">
              Quantos dias deseja analisar?
              <input
                type="number"
                name="days"
                min="1"
                defaultValue={String(selectedDays)}
                className="mt-2 w-full rounded-[1rem] border border-ink/10 bg-white px-4 py-3 text-ink outline-none sm:w-44"
              />
            </label>
            <button type="submit" className="rounded-full bg-[#20352e] px-5 py-3 text-sm font-semibold text-white">
              Aplicar filtro
            </button>
          </form>
        </div>

        <div className="mt-4 flex flex-wrap gap-3">
          {[7, 15, 30, 45, 60, 90].map((presetDays) => {
            const active = presetDays === selectedDays;

            return (
              <Link
                key={presetDays}
                href={`/leagues?days=${presetDays}`}
                className={`rounded-full px-4 py-3 text-sm font-semibold transition ${active ? "bg-[#20352e] text-white" : "border border-ink/10 bg-white text-ink hover:bg-[#edf3df]"}`}
              >
                Ultimos {presetDays} dias
              </Link>
            );
          })}
        </div>
      </SurfaceCard>

      <section className="grid gap-6 lg:grid-cols-2">
        {leagues.map((league) => (
          <SurfaceCard key={league.leagueType} className="relative overflow-hidden border-white/60">
            {(() => {
              const leagueUi = getLeagueUi(league.leagueType);

              return (
                <>
                  <div className={`absolute inset-y-0 right-0 w-44 ${leagueUi.glowClassName}`} />
                  <div className="relative flex flex-col gap-4">
                    <div className="flex items-start justify-between gap-4">
                      <div>
                        <div className="flex items-center gap-3">
                          <span className={`inline-flex h-11 w-11 items-center justify-center rounded-2xl text-sm font-semibold tracking-[0.2em] ${leagueUi.badgeClassName}`}>{leagueUi.shortCode}</span>
                          <div>
                            <p className="text-xs uppercase tracking-[0.3em] text-brand-strong">{league.leagueType}</p>
                            <p className="mt-1 text-sm text-ink/58">{leagueUi.summary}</p>
                          </div>
                        </div>
                        <h2 className="mt-4 font-display text-3xl text-ink">{formatNumber(league.totalGames)} jogos analisados</h2>
                        <p className="mt-2 text-sm text-ink/68">Media {formatDecimal(league.averageGoals)} gols | Draw {formatPercent(league.drawRate)} | Over 2.5 {formatPercent(league.over25Rate)} | BTTS {formatPercent(league.bttsRate)}</p>
                      </div>

                      <div className="hidden rounded-[1.35rem] border border-ink/10 bg-white/72 px-4 py-4 text-right lg:block">
                        <p className="text-xs uppercase tracking-[0.2em] text-brand-strong">Destaque</p>
                        <p className="mt-2 max-w-[11rem] text-sm text-ink/72">{leagueUi.note}</p>
                      </div>
                    </div>

                    <div className="mt-2 grid gap-3 md:grid-cols-3">
                      <div className="rounded-[1.15rem] border border-ink/10 bg-white/70 px-4 py-3 text-sm">
                        <p className="text-xs uppercase tracking-[0.2em] text-brand-strong">Media</p>
                        <p className="mt-1 text-lg font-semibold text-ink">{formatDecimal(league.averageGoals)}</p>
                      </div>
                      <div className="rounded-[1.15rem] border border-ink/10 bg-white/70 px-4 py-3 text-sm">
                        <p className="text-xs uppercase tracking-[0.2em] text-brand-strong">Over 2.5</p>
                        <p className="mt-1 text-lg font-semibold text-ink">{formatPercent(league.over25Rate)}</p>
                      </div>
                      <div className="rounded-[1.15rem] border border-ink/10 bg-white/70 px-4 py-3 text-sm">
                        <p className="text-xs uppercase tracking-[0.2em] text-brand-strong">BTTS</p>
                        <p className="mt-1 text-lg font-semibold text-ink">{formatPercent(league.bttsRate)}</p>
                      </div>
                    </div>

                    <div className="mt-4 flex gap-3">
                      <Link href={`${leagueUi.href}?days=${selectedDays}`} className={`rounded-full px-5 py-3 text-sm font-semibold ${leagueUi.buttonClassName}`}>Acessar liga</Link>
                    </div>
                  </div>
                </>
              );
            })()}
          </SurfaceCard>
        ))}
      </section>
    </AppShell>
  );
}