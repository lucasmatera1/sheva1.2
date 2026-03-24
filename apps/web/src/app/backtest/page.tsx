import Link from "next/link";
import { AppShell, SurfaceCard } from "../../components/shell/app-shell";
import { fetchApi } from "../../lib/api";
import { formatNumber, formatPercent, formatUnits } from "../../lib/format";

export const dynamic = "force-dynamic";

type MethodSummary = {
  id: string;
  name: string;
  description: string;
  leagueType: string;
  entries: number;
  netProfit: number;
  roi: number;
};

export default async function BacktestIndexPage() {
  const methods = ((await fetchApi<MethodSummary[]>("/methods")) ?? []).sort((left, right) => right.netProfit - left.netProfit);

  return (
    <AppShell
      eyebrow="Backtest"
      title="Backtests agregados disponiveis"
      description="Como as tabelas de metodo sao agregadas e sem carimbo temporal, os detalhes abaixo mostram leitura por combinacao e handicap, nao uma curva cronologica fiel. Ainda assim, a area ajuda a achar concentracoes de valor e risco."
    >
      <section className="grid gap-4 lg:grid-cols-2">
        {methods.map((method) => (
          <Link key={method.id} href={`/backtest/${method.id}`}>
            <SurfaceCard className="h-full transition hover:-translate-y-0.5 hover:bg-[#edf3df]">
              <p className="text-xs uppercase tracking-[0.3em] text-brand-strong">{method.leagueType}</p>
              <h2 className="mt-3 font-display text-3xl text-ink">{method.name}</h2>
              <div className="mt-5 grid grid-cols-3 gap-3 text-sm">
                <div>
                  <p className="text-xs uppercase tracking-[0.2em] text-brand-strong">Entradas</p>
                  <p className="mt-2 font-semibold text-ink">{formatNumber(method.entries)}</p>
                </div>
                <div>
                  <p className="text-xs uppercase tracking-[0.2em] text-brand-strong">Lucro</p>
                  <p className="mt-2 font-semibold text-ink">{formatUnits(method.netProfit)}</p>
                </div>
                <div>
                  <p className="text-xs uppercase tracking-[0.2em] text-brand-strong">ROI</p>
                  <p className="mt-2 font-semibold text-ink">{formatPercent(method.roi)}</p>
                </div>
              </div>
            </SurfaceCard>
          </Link>
        ))}
      </section>
    </AppShell>
  );
}