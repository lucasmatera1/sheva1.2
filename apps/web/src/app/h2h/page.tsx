import { MetricBarChart } from "../../components/charts/metric-bar-chart";
import { H2HSearchForm } from "../../components/h2h/h2h-search-form";
import { AppShell, SurfaceCard } from "../../components/shell/app-shell";
import { fetchApi } from "../../lib/api";
import { formatDate, formatNumber, formatPercent } from "../../lib/format";

export const dynamic = "force-dynamic";

type DashboardSummary = {
  topPlayers: Array<{ name: string; winRate: number; profit: number }>;
  worstPlayers: Array<{ name: string; winRate: number; profit: number }>;
};

type H2HResponse = {
  playerA: string;
  playerB: string;
  totalMatches: number;
  winsA: number;
  winsB: number;
  draws: number;
  goalsA: number;
  goalsB: number;
  averageGoals: number;
  averageGoalsA: number;
  averageGoalsB: number;
  over25Rate: number;
  bttsRate: number;
  dominance: number;
  goalBands: { over15Rate: number; over25Rate: number; over35Rate: number };
  leagueBreakdown: Array<{ leagueType: string; totalMatches: number; winsA: number; winsB: number; draws: number }>;
  recentForm: {
    playerA: { last5: { winRate: number }; last10: { winRate: number } };
    playerB: { last5: { winRate: number }; last10: { winRate: number } };
  };
  scorelines: Array<{ score: string; count: number }>;
  recentMatches: Array<{ matchId: string; playedAt: string; leagueType: string; homePlayer: string; awayPlayer: string; playerAScore: number; playerBScore: number; totalGoals: number; winner: string }>;
};

export default async function H2HPage({ searchParams }: { searchParams: Promise<{ playerAId?: string; playerBId?: string }> }) {
  const params = await searchParams;
  const dashboard = await fetchApi<DashboardSummary>("/dashboard/overview");
  const suggestions = Array.from(new Set([...(dashboard?.topPlayers ?? []), ...(dashboard?.worstPlayers ?? [])].map((player) => player.name)));
  const playerAId = params.playerAId ?? suggestions[0] ?? "Mexican";
  const playerBId = params.playerBId ?? suggestions[1] ?? "Bear";
  const h2h = playerAId && playerBId ? await fetchApi<H2HResponse>(`/h2h?playerAId=${encodeURIComponent(playerAId)}&playerBId=${encodeURIComponent(playerBId)}`) : null;

  return (
    <AppShell
      eyebrow="H2H"
      title="Comparador de confronto direto"
      description="Escolha dois nomes da base real para medir dominancia, perfil de gols, distribuicao por liga e o recorte dos confrontos mais recentes."
    >
      <SurfaceCard>
        <H2HSearchForm initialPlayerA={playerAId} initialPlayerB={playerBId} initialSuggestions={suggestions} />
      </SurfaceCard>

      {h2h ? (
        <>
          <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            {[
              ["Confrontos", formatNumber(h2h.totalMatches)],
              ["Vitorias A", formatNumber(h2h.winsA)],
              ["Vitorias B", formatNumber(h2h.winsB)],
              ["Dominancia", formatPercent(h2h.dominance)],
            ].map(([label, value]) => (
              <SurfaceCard key={label} className="p-4">
                <p className="text-xs uppercase tracking-[0.25em] text-brand-strong">{label}</p>
                <p className="mt-2 text-3xl font-semibold text-ink">{value}</p>
              </SurfaceCard>
            ))}
          </section>

          <section className="grid gap-6 xl:grid-cols-[0.85fr_1.15fr]">
            <SurfaceCard>
              <h2 className="font-display text-3xl text-ink">Resumo do duelo</h2>
              <div className="mt-5 grid gap-3 sm:grid-cols-2">
                {[
                  ["Gols A", formatNumber(h2h.goalsA)],
                  ["Gols B", formatNumber(h2h.goalsB)],
                  ["Media gols", formatNumber(Number(h2h.averageGoals.toFixed(2)))],
                  ["BTTS", formatPercent(h2h.bttsRate)],
                  ["Over 2.5", formatPercent(h2h.over25Rate)],
                  ["Over 3.5", formatPercent(h2h.goalBands.over35Rate)],
                ].map(([label, value]) => (
                  <div key={label} className="rounded-[1rem] border border-ink/10 bg-white/70 px-4 py-3">
                    <p className="text-xs uppercase tracking-[0.2em] text-brand-strong">{label}</p>
                    <p className="mt-2 text-xl font-semibold text-ink">{value}</p>
                  </div>
                ))}
              </div>
            </SurfaceCard>

            <SurfaceCard>
              <h2 className="font-display text-3xl text-ink">Forma fora do confronto</h2>
              <div className="mt-5 grid gap-3 md:grid-cols-2">
                <div className="rounded-[1rem] border border-ink/10 bg-white/70 px-4 py-4">
                  <p className="text-xs uppercase tracking-[0.2em] text-brand-strong">{h2h.playerA}</p>
                  <p className="mt-2 text-lg font-semibold text-ink">Last 5: {formatPercent(h2h.recentForm.playerA.last5.winRate)}</p>
                  <p className="mt-1 text-sm text-ink/68">Last 10: {formatPercent(h2h.recentForm.playerA.last10.winRate)}</p>
                </div>
                <div className="rounded-[1rem] border border-ink/10 bg-white/70 px-4 py-4">
                  <p className="text-xs uppercase tracking-[0.2em] text-brand-strong">{h2h.playerB}</p>
                  <p className="mt-2 text-lg font-semibold text-ink">Last 5: {formatPercent(h2h.recentForm.playerB.last5.winRate)}</p>
                  <p className="mt-1 text-sm text-ink/68">Last 10: {formatPercent(h2h.recentForm.playerB.last10.winRate)}</p>
                </div>
              </div>
              <div className="mt-5 rounded-[1rem] border border-ink/10 bg-white/70 px-4 py-4 text-sm text-ink/72">
                <p>Placar mais comum:</p>
                <div className="mt-3 flex flex-wrap gap-2">
                  {h2h.scorelines.map((row) => (
                    <span key={row.score} className="rounded-full border border-ink/10 bg-[#edf3df] px-3 py-2 text-ink">{row.score} ({formatNumber(row.count)})</span>
                  ))}
                </div>
              </div>
            </SurfaceCard>
          </section>

          <section className="grid gap-6 xl:grid-cols-2">
            <SurfaceCard>
              <h2 className="font-display text-2xl text-ink">Placar mais frequente</h2>
              <div className="mt-4">
                <MetricBarChart
                  data={h2h.scorelines.map((row) => ({ label: row.score, value: row.count }))}
                  labelKey="label"
                  valueKey="value"
                />
              </div>
            </SurfaceCard>

            <SurfaceCard>
              <h2 className="font-display text-2xl text-ink">Distribuicao por liga</h2>
              <div className="mt-4">
                <MetricBarChart
                  data={h2h.leagueBreakdown.map((row) => ({ label: row.leagueType, value: row.totalMatches }))}
                  labelKey="label"
                  valueKey="value"
                  color="#7a924f"
                />
              </div>
            </SurfaceCard>
          </section>

          <section className="grid gap-6 xl:grid-cols-2">
            <SurfaceCard>
              <h2 className="font-display text-2xl text-ink">Distribuicao por liga</h2>
              <div className="mt-4 space-y-2 text-sm text-ink/75">
                {h2h.leagueBreakdown.map((row) => (
                  <div key={row.leagueType} className="rounded-[1rem] border border-ink/10 bg-white/70 px-4 py-3">
                    <div className="flex items-center justify-between">
                      <span className="font-medium text-ink">{row.leagueType}</span>
                      <span>{formatNumber(row.totalMatches)} jogos</span>
                    </div>
                    <p className="mt-1">A {formatNumber(row.winsA)} | Empates {formatNumber(row.draws)} | B {formatNumber(row.winsB)}</p>
                  </div>
                ))}
              </div>
            </SurfaceCard>

            <SurfaceCard>
              <h2 className="font-display text-2xl text-ink">Confrontos recentes</h2>
              <div className="mt-4 overflow-x-auto">
                <table className="min-w-full text-left text-sm text-ink/78">
                  <thead>
                    <tr className="border-b border-ink/10 text-xs uppercase tracking-[0.2em] text-brand-strong">
                      <th className="py-3 pr-4">Data</th>
                      <th className="py-3 pr-4">Liga</th>
                      <th className="py-3 pr-4">Placar</th>
                      <th className="py-3 pr-4">Vencedor</th>
                    </tr>
                  </thead>
                  <tbody>
                    {h2h.recentMatches.map((match) => (
                      <tr key={match.matchId} className="border-b border-ink/10 last:border-0">
                        <td className="py-3 pr-4">{formatDate(match.playedAt)}</td>
                        <td className="py-3 pr-4">{match.leagueType}</td>
                        <td className="py-3 pr-4">{match.playerAScore}-{match.playerBScore}</td>
                        <td className="py-3 pr-4">{match.winner}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </SurfaceCard>
          </section>
        </>
      ) : null}
    </AppShell>
  );
}