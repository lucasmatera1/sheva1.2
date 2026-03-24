import Link from "next/link";
import { notFound } from "next/navigation";
import { AppShell, SurfaceCard } from "../../../components/shell/app-shell";
import { fetchApi } from "../../../lib/api";
import { formatDecimal, formatNumber, formatPercent } from "../../../lib/format";
import { getLeagueUi } from "../../../lib/league-ui";

export const dynamic = "force-dynamic";

type LeaguePlayer = {
  name: string;
  totalGames: number;
  wins: number;
  draws: number;
  losses: number;
  winRate: number;
  goalDifference: number;
};

type LeagueSegment = {
  segmentLabel: string;
  totalGames: number;
  averageGoals: number;
  drawRate: number;
  over25Rate: number;
  bttsRate: number;
  rankingByWinRate: LeaguePlayer[];
};

type LeagueDetail = {
  leagueType: string;
  totalGames: number;
  averageGoals: number;
  drawRate: number;
  over25Rate: number;
  bttsRate: number;
  rankingByWinRate: LeaguePlayer[];
  segments: LeagueSegment[];
};

type LeagueSummary = {
  leagueType: string;
  totalGames: number;
  averageGoals: number;
  drawRate: number;
  over25Rate: number;
  bttsRate: number;
};

function getRank(rows: LeagueSummary[], leagueType: string, selector: (row: LeagueSummary) => number) {
  return rows
    .slice()
    .sort((left, right) => selector(right) - selector(left))
    .findIndex((row) => row.leagueType === leagueType) + 1;
}

function sanitizeDays(value?: string) {
  const parsed = Number(value);

  if (!Number.isFinite(parsed) || parsed <= 0) {
    return 30;
  }

  return Math.floor(parsed);
}

export default async function LeagueDetailsPage({
  params,
  searchParams,
}: {
  params: Promise<{ leagueId: string }>;
  searchParams: Promise<{ days?: string }>;
}) {
  const { leagueId } = await params;
  const { days } = await searchParams;
  const selectedDays = sanitizeDays(days);
  const [detail, leagues] = await Promise.all([
    fetchApi<LeagueDetail>(`/leagues/${leagueId}?days=${selectedDays}`),
    fetchApi<LeagueSummary[]>(`/leagues?days=${selectedDays}`),
  ]);

  if (!detail) {
    notFound();
  }

  const leagueUi = getLeagueUi(detail.leagueType);
  const comparisonBase = leagues ?? [];
  const volumeRank = comparisonBase.length ? getRank(comparisonBase, detail.leagueType, (row) => row.totalGames) : 0;
  const goalsRank = comparisonBase.length ? getRank(comparisonBase, detail.leagueType, (row) => row.averageGoals) : 0;
  const overRank = comparisonBase.length ? getRank(comparisonBase, detail.leagueType, (row) => row.over25Rate) : 0;

  return (
    <AppShell
      eyebrow="Ligas"
      title={leagueUi.title}
      description="Detalhe completo da liga escolhida com leitura de volume, comportamento de gols, rankings de jogadores e, quando disponivel na base, divisao interna por serie."
    >
      <SurfaceCard className="relative overflow-hidden border-white/60">
        <div className={`absolute inset-y-0 right-0 w-48 ${leagueUi.glowClassName}`} />
        <div className="relative">
          <div className="flex flex-col gap-6 xl:flex-row xl:items-start xl:justify-between">
            <div className="max-w-3xl">
              <div className="flex items-center gap-3">
                <span className={`inline-flex h-12 w-12 items-center justify-center rounded-2xl text-sm font-semibold tracking-[0.2em] ${leagueUi.badgeClassName}`}>{leagueUi.shortCode}</span>
                <div>
                  <p className="text-xs uppercase tracking-[0.3em] text-brand-strong">Resumo da liga</p>
                  <p className="mt-1 text-sm text-ink/58">{leagueUi.note}</p>
                </div>
              </div>
              <h2 className="mt-4 font-display text-4xl text-ink">{formatNumber(detail.totalGames)} jogos analisados</h2>
              <p className="mt-3 max-w-2xl text-sm text-ink/68">Janela atual de {selectedDays} dias mais recentes. Media {formatDecimal(detail.averageGoals)} gols | Draw {formatPercent(detail.drawRate)} | Over 2.5 {formatPercent(detail.over25Rate)} | BTTS {formatPercent(detail.bttsRate)}</p>
            </div>

            <div className="grid min-w-[18rem] gap-3 md:grid-cols-3 xl:grid-cols-1">
              <div className="rounded-[1.2rem] border border-ink/10 bg-white/74 px-4 py-4 text-sm">
                <p className="text-xs uppercase tracking-[0.2em] text-brand-strong">Ranking em volume</p>
                <p className="mt-2 text-2xl font-semibold text-ink">#{volumeRank || "-"}</p>
              </div>
              <div className="rounded-[1.2rem] border border-ink/10 bg-white/74 px-4 py-4 text-sm">
                <p className="text-xs uppercase tracking-[0.2em] text-brand-strong">Ranking em gols</p>
                <p className="mt-2 text-2xl font-semibold text-ink">#{goalsRank || "-"}</p>
              </div>
              <div className="rounded-[1.2rem] border border-ink/10 bg-white/74 px-4 py-4 text-sm">
                <p className="text-xs uppercase tracking-[0.2em] text-brand-strong">Ranking em over 2.5</p>
                <p className="mt-2 text-2xl font-semibold text-ink">#{overRank || "-"}</p>
              </div>
            </div>
          </div>

          <div className="mt-6 rounded-[1.4rem] border border-ink/10 bg-white/76 p-4">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
              <div>
                <p className="text-xs uppercase tracking-[0.25em] text-brand-strong">Filtro de dias</p>
                <p className="mt-2 text-sm text-ink/68">Por padrao a liga abre nos 30 dias mais recentes. Voce pode escolher qualquer quantidade de dias para recalcular esta pagina.</p>
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
                <button type="submit" className={`rounded-full px-5 py-3 text-sm font-semibold ${leagueUi.buttonClassName}`}>
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
                    href={`${leagueUi.href}?days=${presetDays}`}
                    className={`rounded-full px-4 py-3 text-sm font-semibold transition ${active ? leagueUi.buttonClassName : "border border-ink/10 bg-white text-ink hover:bg-[#edf3df]"}`}
                  >
                    Ultimos {presetDays} dias
                  </Link>
                );
              })}
            </div>
          </div>

          <div className="mt-6 grid gap-3 md:grid-cols-4">
          <div className="rounded-[1.15rem] border border-ink/10 bg-white/70 px-4 py-3 text-sm">
            <p className="text-xs uppercase tracking-[0.2em] text-brand-strong">Jogos</p>
            <p className="mt-1 text-xl font-semibold text-ink">{formatNumber(detail.totalGames)}</p>
          </div>
          <div className="rounded-[1.15rem] border border-ink/10 bg-white/70 px-4 py-3 text-sm">
            <p className="text-xs uppercase tracking-[0.2em] text-brand-strong">Media de gols</p>
            <p className="mt-1 text-xl font-semibold text-ink">{formatDecimal(detail.averageGoals)}</p>
          </div>
          <div className="rounded-[1.15rem] border border-ink/10 bg-white/70 px-4 py-3 text-sm">
            <p className="text-xs uppercase tracking-[0.2em] text-brand-strong">Over 2.5</p>
            <p className="mt-1 text-xl font-semibold text-ink">{formatPercent(detail.over25Rate)}</p>
          </div>
          <div className="rounded-[1.15rem] border border-ink/10 bg-white/70 px-4 py-3 text-sm">
            <p className="text-xs uppercase tracking-[0.2em] text-brand-strong">BTTS</p>
            <p className="mt-1 text-xl font-semibold text-ink">{formatPercent(detail.bttsRate)}</p>
          </div>
        </div>

          <div className="mt-6 flex flex-wrap gap-3">
            <Link href="/leagues" className="rounded-full border border-ink/10 bg-white/75 px-4 py-3 text-sm font-semibold text-ink">Voltar para ligas</Link>
            {comparisonBase
              .filter((league) => league.leagueType !== detail.leagueType)
              .slice(0, 3)
              .map((league) => {
                const relatedLeagueUi = getLeagueUi(league.leagueType);
                return (
                  <Link key={league.leagueType} href={`${relatedLeagueUi.href}?days=${selectedDays}`} className="rounded-full border border-ink/10 bg-white/75 px-4 py-3 text-sm font-semibold text-ink">
                    Ver {relatedLeagueUi.title}
                  </Link>
                );
              })}
          </div>
        </div>
      </SurfaceCard>

      {detail.segments.length ? (
        <section className="grid gap-6 lg:grid-cols-2">
          {detail.segments.map((segment) => (
            <SurfaceCard key={segment.segmentLabel}>
              <p className="text-xs uppercase tracking-[0.3em] text-brand-strong">GT League</p>
              <h2 className="mt-3 font-display text-3xl text-ink">{segment.segmentLabel}</h2>
              <p className="mt-2 text-sm text-ink/68">{formatNumber(segment.totalGames)} jogos | Media {formatDecimal(segment.averageGoals)} | Draw {formatPercent(segment.drawRate)} | Over 2.5 {formatPercent(segment.over25Rate)} | BTTS {formatPercent(segment.bttsRate)}</p>

              <div className="mt-5">
                <h3 className="text-sm font-semibold uppercase tracking-[0.2em] text-ink/60">Jogadores em destaque</h3>
                <div className="mt-3 space-y-2">
                  {segment.rankingByWinRate.slice(0, 5).map((player) => (
                    <div key={`${segment.segmentLabel}-${player.name}-wr`} className="rounded-[1.15rem] border border-ink/10 bg-white/70 px-4 py-3 text-sm">
                      <div className="flex items-center justify-between gap-3">
                        <span className="font-medium text-ink">{player.name}</span>
                        <span>{formatPercent(player.winRate)}</span>
                      </div>
                      <p className="mt-2 text-ink/68">Qtde de Jogos {formatNumber(player.totalGames)} | Vitorias {formatNumber(player.wins)} | Empates {formatNumber(player.draws)} | Derrotas {formatNumber(player.losses)}</p>
                    </div>
                  ))}
                </div>
              </div>
            </SurfaceCard>
          ))}
        </section>
      ) : null}

      <SurfaceCard>
        <h2 className="font-display text-2xl text-ink">Ranking por win rate</h2>
        <div className="mt-4 grid gap-3 lg:grid-cols-2">
          {detail.rankingByWinRate.slice(0, 10).map((player) => (
            <div key={`${player.name}-wr`} className="rounded-[1.15rem] border border-ink/10 bg-white/70 px-4 py-3 text-sm">
              <div className="flex items-center justify-between gap-3">
                <span className="font-medium text-ink">{player.name}</span>
                <span>{formatPercent(player.winRate)}</span>
              </div>
              <p className="mt-2 text-ink/68">Qtde de Jogos {formatNumber(player.totalGames)} | Vitorias {formatNumber(player.wins)} | Empates {formatNumber(player.draws)} | Derrotas {formatNumber(player.losses)}</p>
            </div>
          ))}
        </div>
      </SurfaceCard>
    </AppShell>
  );
}