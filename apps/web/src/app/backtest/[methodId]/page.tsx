import { notFound } from "next/navigation";
import { MetricBarChart } from "../../../components/charts/metric-bar-chart";
import { MetricLineChart } from "../../../components/charts/metric-line-chart";
import { AppShell, SurfaceCard } from "../../../components/shell/app-shell";
import { fetchApi } from "../../../lib/api";
import { formatNumber, formatPercent, formatUnits } from "../../../lib/format";

export const dynamic = "force-dynamic";

type BacktestResponse = {
  methodId: string;
  methodName: string;
  leagueType: string;
  mode?: string;
  limitations?: string[];
  breakdown: Array<{ playerA: string | null; playerB: string | null; handicap: string | null; entries: number; netProfit: number; roi: number }>;
  segments?: {
    byHandicap: Array<{ handicap: string; entries: number; netProfit: number; roi: number }>;
    topPairs: Array<{ playerA: string | null; playerB: string | null; handicap: string | null; entries: number; netProfit: number; roi: number }>;
    worstPairs: Array<{ playerA: string | null; playerB: string | null; handicap: string | null; entries: number; netProfit: number; roi: number }>;
    equityCurve?: Array<{ index: number; balance: number; playedAt: string }>;
    byMonth?: Array<{ month: string; entries: number; netProfit: number }>;
  };
  metrics: {
    entries: number;
    greens: number;
    reds: number;
    voids: number;
    hitRate: number;
    averageOdd: number;
    netProfit: number;
    roi: number;
    yield: number;
    maxDrawdown: number;
    profitFactor: number;
    maxGreenStreak: number;
    maxRedStreak: number;
  };
};

function pairLabel(row: { playerA: string | null; playerB: string | null; handicap: string | null }) {
  return `${row.playerA ?? "N/A"} x ${row.playerB ?? "N/A"} | ${row.handicap ?? "Sem HC"}`;
}

export default async function BacktestDetailsPage({ params }: { params: Promise<{ methodId: string }> }) {
  const { methodId } = await params;
  const data = await fetchApi<BacktestResponse>(`/backtest/${methodId}`);

  if (!data) {
    notFound();
  }

  return (
    <AppShell
      eyebrow="Backtest agregado"
      title={data.methodName}
      description="Leitura de backtest disponivel para este metodo usando somente os agregados reais da base. Onde a base nao tem tempo de evento, a tela deixa essa limitacao explicita para evitar interpretacao errada."
    >
      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {[
          ["Entradas", formatNumber(data.metrics.entries)],
          ["Lucro liquido", formatUnits(data.metrics.netProfit)],
          ["ROI", formatPercent(data.metrics.roi)],
          ["Profit factor", formatNumber(data.metrics.profitFactor)],
        ].map(([label, value]) => (
          <SurfaceCard key={label} className="p-4">
            <p className="text-xs uppercase tracking-[0.25em] text-brand-strong">{label}</p>
            <p className="mt-2 text-3xl font-semibold text-ink">{value}</p>
          </SurfaceCard>
        ))}
      </section>

      {data.limitations?.length ? (
        <SurfaceCard>
          <p className="text-xs uppercase tracking-[0.25em] text-brand-strong">Limitacoes reais da fonte</p>
          <div className="mt-4 space-y-2 text-sm text-ink/72">
            {data.limitations.map((item) => (
              <p key={item}>{item}</p>
            ))}
          </div>
        </SurfaceCard>
      ) : null}

      <section className="grid gap-6 xl:grid-cols-3">
        <SurfaceCard>
          <h2 className="font-display text-2xl text-ink">Distribuicao</h2>
          <div className="mt-4 space-y-2 text-sm text-ink/75">
            <p>Grupos positivos: {formatNumber(data.metrics.greens)}</p>
            <p>Grupos negativos: {formatNumber(data.metrics.reds)}</p>
            <p>Grupos neutros: {formatNumber(data.metrics.voids)}</p>
            <p>Hit rate por grupo: {formatPercent(data.metrics.hitRate)}</p>
          </div>
        </SurfaceCard>

        <SurfaceCard>
          <h2 className="font-display text-2xl text-ink">Top combinacoes</h2>
          <div className="mt-4 space-y-2 text-sm text-ink/75">
            {(data.segments?.topPairs ?? []).slice(0, 5).map((row) => (
              <div key={`top-${pairLabel(row)}`} className="rounded-[1rem] border border-ink/10 bg-white/70 px-3 py-3">
                <p className="font-medium text-ink">{pairLabel(row)}</p>
                <p className="mt-1">{formatUnits(row.netProfit)} | {formatPercent(row.roi)}</p>
              </div>
            ))}
          </div>
        </SurfaceCard>

        <SurfaceCard>
          <h2 className="font-display text-2xl text-ink">Piores combinacoes</h2>
          <div className="mt-4 space-y-2 text-sm text-ink/75">
            {(data.segments?.worstPairs ?? []).slice(0, 5).map((row) => (
              <div key={`worst-${pairLabel(row)}`} className="rounded-[1rem] border border-ink/10 bg-white/70 px-3 py-3">
                <p className="font-medium text-ink">{pairLabel(row)}</p>
                <p className="mt-1">{formatUnits(row.netProfit)} | {formatPercent(row.roi)}</p>
              </div>
            ))}
          </div>
        </SurfaceCard>
      </section>

      <section className="grid gap-6 xl:grid-cols-2">
        <SurfaceCard>
          <h2 className="font-display text-2xl text-ink">Curva de capital</h2>
          <div className="mt-4">
            <MetricLineChart
              data={(data.segments?.equityCurve ?? []).map((row) => ({ label: row.index, value: row.balance }))}
              labelKey="label"
              valueKey="value"
            />
          </div>
        </SurfaceCard>

        <SurfaceCard>
          <h2 className="font-display text-2xl text-ink">Lucro por handicap</h2>
          <div className="mt-4">
            <MetricBarChart
              data={(data.segments?.byHandicap ?? []).map((row) => ({ label: row.handicap, value: row.netProfit }))}
              labelKey="label"
              valueKey="value"
              color="#7a924f"
            />
          </div>
        </SurfaceCard>
      </section>

      {data.segments?.byMonth?.length ? (
        <SurfaceCard>
          <h2 className="font-display text-2xl text-ink">Lucro mensal</h2>
          <div className="mt-4">
            <MetricBarChart
              data={data.segments.byMonth.map((row) => ({ label: row.month, value: row.netProfit }))}
              labelKey="label"
              valueKey="value"
              color="#20352e"
            />
          </div>
        </SurfaceCard>
      ) : null}

      <section className="grid gap-6 xl:grid-cols-[0.7fr_1.3fr]">
        <SurfaceCard>
          <h2 className="font-display text-2xl text-ink">Handicaps</h2>
          <div className="mt-4 space-y-2 text-sm text-ink/75">
            {(data.segments?.byHandicap ?? []).map((row) => (
              <div key={row.handicap} className="rounded-[1rem] border border-ink/10 bg-white/70 px-3 py-3">
                <div className="flex items-center justify-between">
                  <span className="font-medium text-ink">{row.handicap}</span>
                  <span>{formatUnits(row.netProfit)}</span>
                </div>
                <p className="mt-1">{formatNumber(row.entries)} entradas | ROI {formatPercent(row.roi)}</p>
              </div>
            ))}
          </div>
        </SurfaceCard>

        <SurfaceCard>
          <h2 className="font-display text-2xl text-ink">Breakdown completo</h2>
          <div className="mt-4 overflow-x-auto">
            <table className="min-w-full text-left text-sm text-ink/78">
              <thead>
                <tr className="border-b border-ink/10 text-xs uppercase tracking-[0.2em] text-brand-strong">
                  <th className="py-3 pr-4">Combinacao</th>
                  <th className="py-3 pr-4">Entradas</th>
                  <th className="py-3 pr-4">Lucro</th>
                  <th className="py-3 pr-4">ROI</th>
                </tr>
              </thead>
              <tbody>
                {data.breakdown.map((row) => (
                  <tr key={pairLabel(row)} className="border-b border-ink/10 last:border-0">
                    <td className="py-3 pr-4">{pairLabel(row)}</td>
                    <td className="py-3 pr-4">{formatNumber(row.entries)}</td>
                    <td className="py-3 pr-4">{formatUnits(row.netProfit)}</td>
                    <td className="py-3 pr-4">{formatPercent(row.roi)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </SurfaceCard>
      </section>
    </AppShell>
  );
}