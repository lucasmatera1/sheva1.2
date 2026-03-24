import Link from "next/link";
import { AppShell, SurfaceCard } from "../../components/shell/app-shell";
import { fetchApi } from "../../lib/api";
import { formatNumber, formatPercent, formatUnits } from "../../lib/format";

export const dynamic = "force-dynamic";

type PlayerDashboardRow = {
  id: string;
  name: string;
  championships: {
    totalChampionships: number;
    totalLeagues: number;
  };
  totalGames: number;
  wins: number;
  draws: number;
  losses: number;
  winRate: number;
  recentForm: string[];
  headToHead: Array<{
    opponentKey: string;
    opponent: string;
    totalMatches: number;
    wins: number;
    draws: number;
    losses: number;
    winRate: number;
    recentForm: string[];
    latestPlayedAt: string;
  }>;
  leagueStats: Array<{
    leagueType: string;
    totalGames: number;
    wins: number;
    draws: number;
    losses: number;
    winRate: number;
  }>;
  methodStats: Array<{
    methodId: string;
    methodName: string;
    leagueType: string;
    entries: number;
    netProfit: number;
    roi: number;
  }>;
};

function getFormClass(result: string) {
  switch (result) {
    case "W":
      return "bg-[#20352e] text-white";
    case "L":
      return "bg-[#7a3f34] text-white";
    default:
      return "bg-[#d9d4c7] text-ink";
  }
}

export default async function PlayersPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; minGames?: string; leagueType?: string; limit?: string }>;
}) {
  const params = await searchParams;
  const query = params.q ?? "";
  const minGames = params.minGames ?? "10";
  const leagueType = params.leagueType ?? "";
  const limit = params.limit ?? "50";
  const search = new URLSearchParams();
  if (query) search.set("q", query);
  if (minGames) search.set("minGames", minGames);
  if (leagueType) search.set("leagueType", leagueType);
  if (limit) search.set("limit", limit);

  const players = (await fetchApi<PlayerDashboardRow[]>(`/players/dashboard/rows?${search.toString()}`, { cache: "no-store", revalidate: false })) ?? [];
  const averageWinRate = players.length ? players.reduce((sum, player) => sum + player.winRate, 0) / players.length : 0;
  const totalMatches = players.reduce((sum, player) => sum + player.totalGames, 0);
  const totalChampionships = players.reduce((sum, player) => sum + player.championships.totalChampionships, 0);
  const bestPlayer = players[0]?.name ?? "Sem dados";

  return (
    <AppShell
      eyebrow="Jogadores"
      title="Dashboard estatistico de ligas"
      description="Painel de estatisticas com linhas expansíveis por jogador, leitura profissional de confronto direto, recorte por liga e indicadores coloridos de forma recente."
    >
      <SurfaceCard>
        <form className="grid gap-4 md:grid-cols-2 xl:grid-cols-4" method="get">
          <label className="text-sm text-ink/72 xl:col-span-2">
            Buscar jogador
            <input name="q" defaultValue={query} className="mt-2 w-full rounded-[1rem] border border-ink/10 bg-white/80 px-4 py-3 text-ink outline-none" placeholder="Mexican, Bear, Doskata..." />
          </label>
          <label className="text-sm text-ink/72">
            Min. jogos
            <input name="minGames" defaultValue={minGames} className="mt-2 w-full rounded-[1rem] border border-ink/10 bg-white/80 px-4 py-3 text-ink outline-none" />
          </label>
          <label className="text-sm text-ink/72">
            Liga
            <select name="leagueType" defaultValue={leagueType} className="mt-2 w-full rounded-[1rem] border border-ink/10 bg-white/80 px-4 py-3 text-ink outline-none">
              <option value="">Todas</option>
              <option value="GT LEAGUE">GT LEAGUE</option>
              <option value="8MIN BATTLE">8MIN BATTLE</option>
              <option value="H2H">H2H</option>
              <option value="6MIN VOLTA">6MIN VOLTA</option>
            </select>
          </label>
          <label className="text-sm text-ink/72">
            Linhas
            <select name="limit" defaultValue={limit} className="mt-2 w-full rounded-[1rem] border border-ink/10 bg-white/80 px-4 py-3 text-ink outline-none">
              <option value="25">25</option>
              <option value="50">50</option>
              <option value="100">100</option>
            </select>
          </label>
        </form>
      </SurfaceCard>

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <SurfaceCard>
          <p className="text-xs uppercase tracking-[0.2em] text-brand-strong">Jogadores</p>
          <p className="mt-2 text-3xl font-semibold text-ink">{formatNumber(players.length)}</p>
          <p className="mt-2 text-sm text-ink/65">Linhas retornadas no recorte atual.</p>
        </SurfaceCard>
        <SurfaceCard>
          <p className="text-xs uppercase tracking-[0.2em] text-brand-strong">Win rate medio</p>
          <p className="mt-2 text-3xl font-semibold text-ink">{formatPercent(averageWinRate)}</p>
          <p className="mt-2 text-sm text-ink/65">Aproveitamento medio do painel atual.</p>
        </SurfaceCard>
        <SurfaceCard>
          <p className="text-xs uppercase tracking-[0.2em] text-brand-strong">Total de partidas</p>
          <p className="mt-2 text-3xl font-semibold text-ink">{formatNumber(totalMatches)}</p>
          <p className="mt-2 text-sm text-ink/65">Volume somado das linhas exibidas.</p>
        </SurfaceCard>
        <SurfaceCard>
          <p className="text-xs uppercase tracking-[0.2em] text-brand-strong">Campeonatos lidos</p>
          <p className="mt-2 text-3xl font-semibold text-ink">{formatNumber(totalChampionships)}</p>
          <p className="mt-2 text-sm text-ink/65">Melhor destaque atual: {bestPlayer}.</p>
        </SurfaceCard>
      </section>

      <SurfaceCard>
        <div className="hidden items-center gap-4 border-b border-ink/10 px-2 pb-3 text-xs uppercase tracking-[0.18em] text-brand-strong xl:grid xl:grid-cols-[1.7fr_1fr_0.8fr_0.95fr_0.8fr_1.2fr]">
          <span>Player</span>
          <span>Championships</span>
          <span>Matches</span>
          <span>W / D / L</span>
          <span>Winrate</span>
          <span>Recent Form</span>
        </div>

        <div className="mt-4 space-y-3">
          {players.map((player) => (
            <details key={player.id} className="group rounded-[1.45rem] border border-ink/10 bg-white/72 p-4 shadow-sm transition open:bg-[#f6f3e8]">
              <summary className="list-none cursor-pointer">
                <div className="grid gap-4 xl:grid-cols-[1.7fr_1fr_0.8fr_0.95fr_0.8fr_1.2fr] xl:items-center">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="text-lg font-semibold text-ink">{player.name}</p>
                      <p className="mt-1 text-xs uppercase tracking-[0.18em] text-ink/48">Expandir estatisticas</p>
                    </div>
                    <Link href={`/players/${encodeURIComponent(player.name)}`} className="rounded-full border border-ink/10 bg-white/75 px-3 py-1 text-xs font-semibold text-ink hover:bg-[#edf3df]">
                      Perfil
                    </Link>
                  </div>

                  <div>
                    <p className="text-sm font-semibold text-ink">{formatNumber(player.championships.totalChampionships)} campeonatos</p>
                    <p className="mt-1 text-sm text-ink/62">{formatNumber(player.championships.totalLeagues)} ligas</p>
                  </div>

                  <div>
                    <p className="text-lg font-semibold text-ink">{formatNumber(player.totalGames)}</p>
                    <p className="mt-1 text-sm text-ink/62">partidas</p>
                  </div>

                  <div>
                    <p className="text-sm font-semibold text-ink">{formatNumber(player.wins)} / {formatNumber(player.draws)} / {formatNumber(player.losses)}</p>
                    <p className="mt-1 text-xs uppercase tracking-[0.16em] text-ink/48">W / D / L</p>
                  </div>

                  <div>
                    <span className="inline-flex rounded-full bg-[#20352e] px-3 py-1 text-sm font-semibold text-white">{formatPercent(player.winRate)}</span>
                  </div>

                  <div className="overflow-x-auto">
                    <div className="flex min-w-max flex-nowrap gap-2">
                      {player.recentForm.map((result, index) => (
                        <span key={`${player.id}-${index}`} className={`inline-flex h-8 min-w-8 items-center justify-center rounded-full text-xs font-semibold ${getFormClass(result)}`}>
                          {result}
                        </span>
                      ))}
                    </div>
                  </div>
                </div>
              </summary>

              <div className="mt-5 grid gap-5 border-t border-ink/10 pt-5 xl:grid-cols-[1.35fr_0.85fr_0.85fr]">
                <section>
                  <div className="flex items-center justify-between gap-3">
                    <h3 className="font-display text-2xl text-ink">Head to Head</h3>
                    <span className="text-xs uppercase tracking-[0.18em] text-brand-strong">Oldest to newest</span>
                  </div>
                  <div className="mt-4 space-y-3">
                    {player.headToHead.map((row) => (
                      <div key={row.opponentKey} className="rounded-[1.15rem] border border-ink/10 bg-white/72 px-4 py-4">
                        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                          <div>
                            <p className="text-base font-semibold text-ink">vs {row.opponent}</p>
                            <p className="mt-1 text-sm text-ink/62">{formatNumber(row.totalMatches)} jogos | {formatNumber(row.wins)}W {formatNumber(row.draws)}D {formatNumber(row.losses)}L | {formatPercent(row.winRate)}</p>
                          </div>
                          <div className="overflow-x-auto">
                            <div className="flex min-w-max flex-nowrap gap-2">
                              {row.recentForm.map((result, index) => (
                                <span key={`${row.opponentKey}-${index}`} className={`inline-flex h-8 min-w-8 items-center justify-center rounded-full text-xs font-semibold ${getFormClass(result)}`}>
                                  {result}
                                </span>
                              ))}
                            </div>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </section>

                <section>
                  <h3 className="font-display text-2xl text-ink">Stats by League</h3>
                  <div className="mt-4 space-y-3">
                    {player.leagueStats.map((row) => (
                      <div key={row.leagueType} className="rounded-[1.15rem] border border-ink/10 bg-white/72 px-4 py-4">
                        <p className="text-base font-semibold text-ink">{row.leagueType}</p>
                        <p className="mt-2 text-sm text-ink/62">{formatNumber(row.totalGames)} jogos</p>
                        <p className="mt-1 text-sm text-ink/62">{formatNumber(row.wins)}W {formatNumber(row.draws)}D {formatNumber(row.losses)}L</p>
                        <p className="mt-2 text-sm font-semibold text-ink">{formatPercent(row.winRate)}</p>
                      </div>
                    ))}
                  </div>
                </section>

                <section>
                  <h3 className="font-display text-2xl text-ink">Stats by Method</h3>
                  <div className="mt-4 space-y-3">
                    {player.methodStats.length ? (
                      player.methodStats.slice(0, 8).map((row) => (
                        <div key={row.methodId} className="rounded-[1.15rem] border border-ink/10 bg-white/72 px-4 py-4">
                          <p className="text-base font-semibold text-ink">{row.methodName}</p>
                          <p className="mt-1 text-xs uppercase tracking-[0.16em] text-brand-strong">{row.leagueType}</p>
                          <div className="mt-3 grid gap-2 sm:grid-cols-3">
                            <div>
                              <p className="text-[11px] uppercase tracking-[0.16em] text-ink/48">Entries</p>
                              <p className="mt-1 font-semibold text-ink">{formatNumber(row.entries)}</p>
                            </div>
                            <div>
                              <p className="text-[11px] uppercase tracking-[0.16em] text-ink/48">Net</p>
                              <p className="mt-1 font-semibold text-ink">{formatUnits(row.netProfit)}</p>
                            </div>
                            <div>
                              <p className="text-[11px] uppercase tracking-[0.16em] text-ink/48">ROI</p>
                              <p className="mt-1 font-semibold text-ink">{formatPercent(row.roi)}</p>
                            </div>
                          </div>
                        </div>
                      ))
                    ) : (
                      <div className="rounded-[1.15rem] border border-ink/10 bg-white/72 px-4 py-4 text-sm text-ink/62">
                        Nenhum resumo de metodo encontrado para este jogador no recorte atual.
                      </div>
                    )}
                  </div>
                </section>
              </div>
            </details>
          ))}
        </div>
      </SurfaceCard>
    </AppShell>
  );
}