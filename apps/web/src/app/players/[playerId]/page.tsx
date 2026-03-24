import { notFound } from "next/navigation";
import { MetricBarChart } from "../../../components/charts/metric-bar-chart";
import { AppShell, SurfaceCard } from "../../../components/shell/app-shell";
import { fetchApi } from "../../../lib/api";
import { formatDate, formatDecimal, formatNumber, formatPercent } from "../../../lib/format";

export const dynamic = "force-dynamic";

type PlayerDetails = {
  player: { id: string; name: string; teamName: string | null };
  metrics: {
    totalGames: number;
    wins: number;
    draws: number;
    losses: number;
    winRate: number;
    goalDifference: number;
    goalsForAverage: number;
    goalsAgainstAverage: number;
    totalGoalsAverage: number;
    over15Rate: number;
    over25Rate: number;
    over35Rate: number;
    under15Rate: number;
    under25Rate: number;
    under35Rate: number;
    bttsRate: number;
    cleanSheetRate: number;
    scoredRate: number;
    concededRate: number;
  };
  recentForm: {
    last5: { sampleSize: number; wins: number; draws: number; losses: number; winRate: number };
    last10: { sampleSize: number; wins: number; draws: number; losses: number; winRate: number };
    last20: { sampleSize: number; wins: number; draws: number; losses: number; winRate: number };
  };
  sequences: {
    current: { type: string; count: number } | null;
    maxWins: number;
    maxLosses: number;
  };
  performanceByLeague: Array<{ leagueType: string; totalGames: number; wins: number; draws: number; losses: number; winRate: number }>;
  splits: {
    home: { totalGames: number; wins: number; draws: number; losses: number; winRate: number; goalsForAverage: number; goalsAgainstAverage: number; over25Rate: number; bttsRate: number };
    away: { totalGames: number; wins: number; draws: number; losses: number; winRate: number; goalsForAverage: number; goalsAgainstAverage: number; over25Rate: number; bttsRate: number };
  };
  trend: { over25Rate: number; under25Rate: number; bttsRate: number };
  opponents: {
    best: Array<{ opponent: string; totalGames: number; wins: number; draws: number; losses: number; winRate: number; goalDifference: number }>;
    toughest: Array<{ opponent: string; totalGames: number; wins: number; draws: number; losses: number; winRate: number; goalDifference: number }>;
  };
  recentMatches: Array<{ matchId: string; playedAt: string; leagueType: string; side: string; opponent: string; score: string; result: string; totalGoals: number }>;
};

export default async function PlayerDetailsPage({ params }: { params: Promise<{ playerId: string }> }) {
  const { playerId } = await params;
  const data = await fetchApi<PlayerDetails>(`/players/${encodeURIComponent(decodeURIComponent(playerId))}`);

  if (!data) {
    notFound();
  }

  return (
    <AppShell
      eyebrow="Player Card"
      title={data.player.name}
      description="Leitura individual com forma recente, splits mandante/visitante, historico curto de partidas e confrontos mais confortaveis ou mais duros."
    >
      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {[
          ["Jogos", formatNumber(data.metrics.totalGames)],
          ["Vitorias", formatNumber(data.metrics.wins)],
          ["Empates", formatNumber(data.metrics.draws)],
          ["Derrotas", formatNumber(data.metrics.losses)],
        ].map(([label, value]) => (
          <SurfaceCard key={label} className="p-4">
            <p className="text-xs uppercase tracking-[0.25em] text-brand-strong">{label}</p>
            <p className="mt-2 text-3xl font-semibold text-ink">{value}</p>
          </SurfaceCard>
        ))}
      </section>

      <section className="grid gap-6 xl:grid-cols-[0.95fr_1.05fr]">
        <SurfaceCard>
          <h2 className="font-display text-3xl text-ink">Matriz de desempenho</h2>
          <div className="mt-5 grid gap-3 sm:grid-cols-2">
            {[
              ["GF medio", formatDecimal(data.metrics.goalsForAverage)],
              ["GA medio", formatDecimal(data.metrics.goalsAgainstAverage)],
              ["Total gols", formatDecimal(data.metrics.totalGoalsAverage)],
              ["BTTS", formatPercent(data.metrics.bttsRate)],
              ["Over 2.5", formatPercent(data.metrics.over25Rate)],
              ["Clean sheet", formatPercent(data.metrics.cleanSheetRate)],
            ].map(([label, value]) => (
              <div key={label} className="rounded-[1.1rem] border border-ink/10 bg-white/70 px-4 py-3">
                <p className="text-xs uppercase tracking-[0.2em] text-brand-strong">{label}</p>
                <p className="mt-2 text-xl font-semibold text-ink">{value}</p>
              </div>
            ))}
          </div>
        </SurfaceCard>

        <SurfaceCard>
          <h2 className="font-display text-3xl text-ink">Forma e sequencias</h2>
          <div className="mt-5 grid gap-3 md:grid-cols-3">
            {[
              { label: "Ultimos 5", form: data.recentForm.last5 },
              { label: "Ultimos 10", form: data.recentForm.last10 },
              { label: "Ultimos 20", form: data.recentForm.last20 },
            ].map(({ label, form }) => {
              return (
                <div key={label} className="rounded-[1.1rem] border border-ink/10 bg-white/70 px-4 py-4">
                  <p className="text-xs uppercase tracking-[0.2em] text-brand-strong">{label}</p>
                  <p className="mt-2 text-2xl font-semibold text-ink">{formatPercent(form.winRate)}</p>
                  <p className="mt-2 text-sm text-ink/68">{form.wins}V {form.draws}E {form.losses}D</p>
                </div>
              );
            })}
          </div>
          <div className="mt-5 grid gap-3 md:grid-cols-3">
            <div className="rounded-[1.1rem] border border-ink/10 bg-white/70 px-4 py-4">
              <p className="text-xs uppercase tracking-[0.2em] text-brand-strong">Sequencia atual</p>
              <p className="mt-2 text-2xl font-semibold text-ink">{data.sequences.current ? `${data.sequences.current.type}${data.sequences.current.count}` : "Sem dado"}</p>
            </div>
            <div className="rounded-[1.1rem] border border-ink/10 bg-white/70 px-4 py-4">
              <p className="text-xs uppercase tracking-[0.2em] text-brand-strong">Max wins</p>
              <p className="mt-2 text-2xl font-semibold text-ink">{formatNumber(data.sequences.maxWins)}</p>
            </div>
            <div className="rounded-[1.1rem] border border-ink/10 bg-white/70 px-4 py-4">
              <p className="text-xs uppercase tracking-[0.2em] text-brand-strong">Max losses</p>
              <p className="mt-2 text-2xl font-semibold text-ink">{formatNumber(data.sequences.maxLosses)}</p>
            </div>
          </div>
        </SurfaceCard>
      </section>

      <section className="grid gap-6 xl:grid-cols-3">
        <SurfaceCard>
          <h2 className="font-display text-2xl text-ink">Split mandante</h2>
          <div className="mt-4 space-y-2 text-sm text-ink/72">
            <p>{formatNumber(data.splits.home.totalGames)} jogos</p>
            <p>Win rate {formatPercent(data.splits.home.winRate)}</p>
            <p>GF {formatDecimal(data.splits.home.goalsForAverage)} | GA {formatDecimal(data.splits.home.goalsAgainstAverage)}</p>
            <p>Over 2.5 {formatPercent(data.splits.home.over25Rate)} | BTTS {formatPercent(data.splits.home.bttsRate)}</p>
          </div>
        </SurfaceCard>

        <SurfaceCard>
          <h2 className="font-display text-2xl text-ink">Split visitante</h2>
          <div className="mt-4 space-y-2 text-sm text-ink/72">
            <p>{formatNumber(data.splits.away.totalGames)} jogos</p>
            <p>Win rate {formatPercent(data.splits.away.winRate)}</p>
            <p>GF {formatDecimal(data.splits.away.goalsForAverage)} | GA {formatDecimal(data.splits.away.goalsAgainstAverage)}</p>
            <p>Over 2.5 {formatPercent(data.splits.away.over25Rate)} | BTTS {formatPercent(data.splits.away.bttsRate)}</p>
          </div>
        </SurfaceCard>

        <SurfaceCard>
          <h2 className="font-display text-2xl text-ink">Por liga</h2>
          <div className="mt-4 space-y-2 text-sm text-ink/72">
            {data.performanceByLeague.map((row) => (
              <div key={row.leagueType} className="rounded-[1rem] border border-ink/10 bg-white/70 px-3 py-3">
                <p className="font-semibold text-ink">{row.leagueType}</p>
                <p className="mt-1">{formatNumber(row.totalGames)} jogos | {formatPercent(row.winRate)}</p>
              </div>
            ))}
          </div>
        </SurfaceCard>
      </section>

      <section className="grid gap-6 xl:grid-cols-2">
        <SurfaceCard>
          <h2 className="font-display text-2xl text-ink">Forma recente</h2>
          <div className="mt-4">
            <MetricBarChart
              data={[
                { label: "Last 5", value: data.recentForm.last5.winRate },
                { label: "Last 10", value: data.recentForm.last10.winRate },
                { label: "Last 20", value: data.recentForm.last20.winRate },
              ]}
              labelKey="label"
              valueKey="value"
            />
          </div>
        </SurfaceCard>

        <SurfaceCard>
          <h2 className="font-display text-2xl text-ink">Mandante x visitante</h2>
          <div className="mt-4">
            <MetricBarChart
              data={[
                { label: "Home WR", value: data.splits.home.winRate },
                { label: "Away WR", value: data.splits.away.winRate },
                { label: "Home O2.5", value: data.splits.home.over25Rate },
                { label: "Away O2.5", value: data.splits.away.over25Rate },
              ]}
              labelKey="label"
              valueKey="value"
              color="#7a924f"
            />
          </div>
        </SurfaceCard>
      </section>

      <section className="grid gap-6 xl:grid-cols-2">
        <SurfaceCard>
          <h2 className="font-display text-2xl text-ink">Melhores confrontos</h2>
          <div className="mt-4 space-y-2">
            {data.opponents.best.map((row) => (
              <div key={`best-${row.opponent}`} className="rounded-[1rem] border border-ink/10 bg-white/70 px-4 py-3 text-sm text-ink/75">
                <div className="flex items-center justify-between">
                  <span className="font-medium text-ink">{row.opponent}</span>
                  <span>{formatPercent(row.winRate)}</span>
                </div>
                <p className="mt-1">Qtde de Jogos {formatNumber(row.totalGames)} | Vitorias {formatNumber(row.wins)} | Empates {formatNumber(row.draws)} | Derrotas {formatNumber(row.losses)}</p>
              </div>
            ))}
          </div>
        </SurfaceCard>

        <SurfaceCard>
          <h2 className="font-display text-2xl text-ink">Confrontos mais duros</h2>
          <div className="mt-4 space-y-2">
            {data.opponents.toughest.map((row) => (
              <div key={`tough-${row.opponent}`} className="rounded-[1rem] border border-ink/10 bg-white/70 px-4 py-3 text-sm text-ink/75">
                <div className="flex items-center justify-between">
                  <span className="font-medium text-ink">{row.opponent}</span>
                  <span>{formatPercent(row.winRate)}</span>
                </div>
                <p className="mt-1">Qtde de Jogos {formatNumber(row.totalGames)} | Vitorias {formatNumber(row.wins)} | Empates {formatNumber(row.draws)} | Derrotas {formatNumber(row.losses)}</p>
              </div>
            ))}
          </div>
        </SurfaceCard>
      </section>

      <SurfaceCard>
        <h2 className="font-display text-2xl text-ink">Partidas recentes</h2>
        <div className="mt-4 overflow-x-auto">
          <table className="min-w-full text-left text-sm text-ink/78">
            <thead>
              <tr className="border-b border-ink/10 text-xs uppercase tracking-[0.2em] text-brand-strong">
                <th className="py-3 pr-4">Data</th>
                <th className="py-3 pr-4">Liga</th>
                <th className="py-3 pr-4">Oponente</th>
                <th className="py-3 pr-4">Score</th>
                <th className="py-3 pr-4">Resultado</th>
              </tr>
            </thead>
            <tbody>
              {data.recentMatches.map((match) => (
                <tr key={match.matchId} className="border-b border-ink/10 last:border-0">
                  <td className="py-3 pr-4">{formatDate(match.playedAt)}</td>
                  <td className="py-3 pr-4">{match.leagueType}</td>
                  <td className="py-3 pr-4">{match.opponent}</td>
                  <td className="py-3 pr-4">{match.score}</td>
                  <td className="py-3 pr-4">{match.result}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </SurfaceCard>
    </AppShell>
  );
}