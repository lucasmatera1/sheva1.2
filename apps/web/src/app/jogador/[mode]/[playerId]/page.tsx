import Link from "next/link";
import { notFound } from "next/navigation";
import { MetricBarChart } from "../../../../components/charts/metric-bar-chart";
import { AppShell, SurfaceCard } from "../../../../components/shell/app-shell";
import { fetchApi } from "../../../../lib/api";
import { formatDate, formatDecimal, formatNumber, formatPercent } from "../../../../lib/format";
import { getPlayerModeBySlug } from "../../../../lib/player-mode";

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
  opponents: {
    best: Array<{ opponent: string; totalGames: number; wins: number; draws: number; losses: number; winRate: number; goalDifference: number }>;
    toughest: Array<{ opponent: string; totalGames: number; wins: number; draws: number; losses: number; winRate: number; goalDifference: number }>;
  };
  recentMatches: Array<{ matchId: string; playedAt: string; leagueType: string; side: string; opponent: string; score: string; intervalScore: string | null; result: string; intervalResult: string | null; totalGoals: number }>;
  quickSummary: {
    sampleSize: number;
    latestResult: string | null;
    latestOpponent: string | null;
    latestIntervalResult: string | null;
    maxWinStreak: number;
    maxLossStreak: number;
  };
};

function getResultBadgeClass(result: string | null) {
  switch (result) {
    case "W":
      return "bg-[#20352e] text-white";
    case "L":
      return "bg-[#7a3f34] text-white";
    case "D":
      return "bg-[#d9d4c7] text-ink";
    default:
      return "bg-white/70 text-ink/70";
  }
}

export default async function JogadorDetalhePage({
  params,
}: {
  params: Promise<{ mode: string; playerId: string }>;
}) {
  const { mode: modeSlug, playerId } = await params;
  const mode = getPlayerModeBySlug(modeSlug);

  if (!mode) {
    notFound();
  }

  const data = await fetchApi<PlayerDetails>(`/players/${encodeURIComponent(decodeURIComponent(playerId))}?leagueType=${encodeURIComponent(mode.leagueType)}`);

  if (!data) {
    notFound();
  }

  return (
    <AppShell
      eyebrow="Jogador"
      title={data.player.name}
      description={`Card individual filtrado apenas no modo ${mode.title}. Aqui entram somente os jogos desse recorte.`}
    >
      <SurfaceCard className="relative overflow-hidden border-white/60">
        <div className={`absolute inset-y-0 right-0 w-44 ${mode.glowClassName}`} />
        <div className="relative flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <div className="flex items-center gap-3">
              <span className={`rounded-full px-4 py-3 text-sm font-semibold ${mode.buttonClassName}`}>{mode.title}</span>
            </div>
            <p className="mt-5 text-xs uppercase tracking-[0.25em] text-brand-strong">Modo ativo</p>
            <div className="mt-3">
              <p className="text-lg font-semibold text-ink">{mode.title}</p>
              <p className="text-sm text-ink/68">{mode.note}</p>
            </div>
          </div>

          <div className="flex flex-wrap gap-3">
            <Link href={mode.href} className="rounded-full border border-ink/10 bg-white/75 px-4 py-3 text-sm font-semibold text-ink">
              Trocar jogador
            </Link>
            <Link href="/jogador" className="rounded-full border border-ink/10 bg-white/75 px-4 py-3 text-sm font-semibold text-ink">
              Voltar para modos
            </Link>
          </div>
        </div>
      </SurfaceCard>

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

      <section className="grid gap-6 xl:grid-cols-[0.9fr_1.1fr]">
        <SurfaceCard>
          <h2 className="font-display text-2xl text-ink">Resumo rapido</h2>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <div className="rounded-[1.1rem] border border-ink/10 bg-white/70 px-4 py-4 shadow-sm">
              <p className="text-xs uppercase tracking-[0.2em] text-brand-strong">Historico exibido</p>
              <p className="mt-2 text-xl font-semibold text-ink">{formatNumber(data.quickSummary.sampleSize)} jogos</p>
            </div>
            <div className="rounded-[1.1rem] border border-ink/10 bg-white/70 px-4 py-4 shadow-sm">
              <p className="text-xs uppercase tracking-[0.2em] text-brand-strong">Ultimo adversario</p>
              <p className="mt-2 text-xl font-semibold text-ink">{data.quickSummary.latestOpponent ?? "Sem dado"}</p>
            </div>
            <div className="rounded-[1.1rem] border border-ink/10 bg-white/70 px-4 py-4 shadow-sm">
              <p className="text-xs uppercase tracking-[0.2em] text-brand-strong">Ultimo resultado</p>
              <div className="mt-2">
                <span className={`inline-flex rounded-full px-3 py-1 text-sm font-semibold ${getResultBadgeClass(data.quickSummary.latestResult)}`}>
                  {data.quickSummary.latestResult ?? "Sem dado"}
                </span>
              </div>
            </div>
            <div className="rounded-[1.1rem] border border-ink/10 bg-white/70 px-4 py-4 shadow-sm">
              <p className="text-xs uppercase tracking-[0.2em] text-brand-strong">Resultado no intervalo</p>
              <div className="mt-2">
                <span className={`inline-flex rounded-full px-3 py-1 text-sm font-semibold ${getResultBadgeClass(data.quickSummary.latestIntervalResult)}`}>
                  {data.quickSummary.latestIntervalResult ?? "Sem dado"}
                </span>
              </div>
            </div>
          </div>
        </SurfaceCard>

        <SurfaceCard>
          <h2 className="font-display text-2xl text-ink">Leitura imediata</h2>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <div className="rounded-[1.1rem] border border-ink/10 bg-white/70 px-4 py-4 shadow-sm">
              <p className="text-xs uppercase tracking-[0.2em] text-brand-strong">Aproveitamento</p>
              <p className="mt-2 text-xl font-semibold text-ink">{formatPercent(data.metrics.winRate)}</p>
            </div>
            <div className="rounded-[1.1rem] border border-ink/10 bg-white/70 px-4 py-4 shadow-sm">
              <p className="text-xs uppercase tracking-[0.2em] text-brand-strong">Total de gols medio</p>
              <p className="mt-2 text-xl font-semibold text-ink">{formatDecimal(data.metrics.totalGoalsAverage)}</p>
            </div>
            <div className="rounded-[1.1rem] border border-ink/10 bg-white/70 px-4 py-4 shadow-sm">
              <p className="text-xs uppercase tracking-[0.2em] text-brand-strong">Maior win streak</p>
              <p className="mt-2 text-xl font-semibold text-ink">{formatNumber(data.quickSummary.maxWinStreak)}</p>
            </div>
            <div className="rounded-[1.1rem] border border-ink/10 bg-white/70 px-4 py-4 shadow-sm">
              <p className="text-xs uppercase tracking-[0.2em] text-brand-strong">Maior lose streak</p>
              <p className="mt-2 text-xl font-semibold text-ink">{formatNumber(data.quickSummary.maxLossStreak)}</p>
            </div>
          </div>
        </SurfaceCard>
      </section>

      <section className="grid gap-6 xl:grid-cols-[0.95fr_1.05fr]">
        <SurfaceCard>
          <h2 className="font-display text-3xl text-ink">Matriz de desempenho</h2>
          <div className="mt-5 grid gap-3 sm:grid-cols-2">
            {[
              ["Win rate", formatPercent(data.metrics.winRate)],
              ["GF medio", formatDecimal(data.metrics.goalsForAverage)],
              ["GA medio", formatDecimal(data.metrics.goalsAgainstAverage)],
              ["Total gols", formatDecimal(data.metrics.totalGoalsAverage)],
              ["BTTS", formatPercent(data.metrics.bttsRate)],
              ["Over 2.5", formatPercent(data.metrics.over25Rate)],
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
            ].map(({ label, form }) => (
              <div key={label} className="rounded-[1.1rem] border border-ink/10 bg-white/70 px-4 py-4">
                <p className="text-xs uppercase tracking-[0.2em] text-brand-strong">{label}</p>
                <p className="mt-2 text-2xl font-semibold text-ink">{formatPercent(form.winRate)}</p>
                <p className="mt-2 text-sm text-ink/68">{form.wins}V {form.draws}E {form.losses}D</p>
              </div>
            ))}
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
          <h2 className="font-display text-2xl text-ink">Distribuicao do jogador</h2>
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

      <SurfaceCard className="overflow-hidden border-white/60">
        <div className="flex flex-col gap-4 border-b border-ink/10 pb-5 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="text-xs uppercase tracking-[0.25em] text-brand-strong">Timeline competitiva</p>
            <h2 className="mt-2 font-display text-3xl text-ink">Historico dos ultimos 50 jogos</h2>
            <p className="mt-2 max-w-2xl text-sm text-ink/66">Leitura cronologica com adversario, resultado final e comportamento no intervalo para acelerar a analise individual.</p>
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="rounded-[1rem] border border-ink/10 bg-white/70 px-4 py-3 text-sm shadow-sm">
              <p className="text-xs uppercase tracking-[0.18em] text-brand-strong">Recorte</p>
              <p className="mt-1 font-semibold text-ink">50 jogos</p>
            </div>
            <div className="rounded-[1rem] border border-ink/10 bg-white/70 px-4 py-3 text-sm shadow-sm">
              <p className="text-xs uppercase tracking-[0.18em] text-brand-strong">Ultimo FT</p>
              <p className="mt-1 font-semibold text-ink">{data.recentMatches[0]?.score ?? "Sem dado"}</p>
            </div>
            <div className="rounded-[1rem] border border-ink/10 bg-white/70 px-4 py-3 text-sm shadow-sm">
              <p className="text-xs uppercase tracking-[0.18em] text-brand-strong">Ultimo HT</p>
              <p className="mt-1 font-semibold text-ink">{data.recentMatches[0]?.intervalScore ?? "Sem dado"}</p>
            </div>
          </div>
        </div>

        <div className="mt-5 overflow-x-auto rounded-[1.35rem] border border-ink/10 bg-white/50">
          <table className="min-w-full text-left text-sm text-ink/78">
            <thead>
              <tr className="border-b border-ink/10 bg-white/65 text-xs uppercase tracking-[0.2em] text-brand-strong">
                <th className="px-4 py-4">Data</th>
                <th className="px-4 py-4">Adversario</th>
                <th className="px-4 py-4">Resultado</th>
                <th className="px-4 py-4">Placar final</th>
                <th className="px-4 py-4">Resultado intervalo</th>
                <th className="px-4 py-4">Placar intervalo</th>
              </tr>
            </thead>
            <tbody>
              {data.recentMatches.map((match) => (
                <tr key={match.matchId} className="border-b border-ink/10 transition hover:bg-[#edf3df]/45 last:border-0">
                  <td className="px-4 py-4 align-top font-medium text-ink">{formatDate(match.playedAt)}</td>
                  <td className="px-4 py-4 align-top">
                    <div className="flex flex-col gap-1">
                      <span className="font-semibold text-ink">{match.opponent}</span>
                      <span className="text-xs uppercase tracking-[0.16em] text-ink/48">{match.side === "home" ? "Mandante" : "Visitante"}</span>
                    </div>
                  </td>
                  <td className="px-4 py-4 align-top">
                    <span className={`inline-flex rounded-full px-3 py-1 text-xs font-semibold ${getResultBadgeClass(match.result)}`}>
                      {match.result}
                    </span>
                  </td>
                  <td className="px-4 py-4 align-top">
                    <span className="rounded-full border border-ink/10 bg-white/75 px-3 py-1 font-semibold text-ink">{match.score}</span>
                  </td>
                  <td className="px-4 py-4 align-top">
                    <span className={`inline-flex rounded-full px-3 py-1 text-xs font-semibold ${getResultBadgeClass(match.intervalResult)}`}>
                      {match.intervalResult ?? "Sem dado"}
                    </span>
                  </td>
                  <td className="px-4 py-4 align-top">
                    <span className="rounded-full border border-ink/10 bg-white/75 px-3 py-1 font-semibold text-ink">{match.intervalScore ?? "Sem dado"}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </SurfaceCard>
    </AppShell>
  );
}