import Link from "next/link";
import { notFound } from "next/navigation";
import { AppShell, SurfaceCard } from "../../../components/shell/app-shell";
import { fetchApi } from "../../../lib/api";
import { formatNumber, formatPercent } from "../../../lib/format";
import { getPlayerModeBySlug } from "../../../lib/player-mode";

export const dynamic = "force-dynamic";

type PlayerListItem = {
  id: string;
  name: string;
  teamName: string | null;
  totalGames: number;
  wins: number;
  draws: number;
  losses: number;
  winRate: number;
  simulatedProfit: number;
  rating: number;
  goalsForAverage: number;
  goalsAgainstAverage: number;
  maxWinStreak: number;
  maxLossStreak: number;
};

export default async function JogadorModePage({
  params,
  searchParams,
}: {
  params: Promise<{ mode: string }>;
  searchParams: Promise<{ q?: string; minGames?: string; sortBy?: string }>;
}) {
  const { mode: modeSlug } = await params;
  const mode = getPlayerModeBySlug(modeSlug);

  if (!mode) {
    notFound();
  }

  const queryParams = await searchParams;
  const query = queryParams.q ?? "";
  const minGames = queryParams.minGames ?? "1";
  const sortBy = queryParams.sortBy ?? "winRateDesc";
  const search = new URLSearchParams();
  search.set("leagueType", mode.leagueType);
  search.set("limit", "100");
  if (query) search.set("q", query);
  if (minGames) search.set("minGames", minGames);
  if (sortBy) search.set("sortBy", sortBy);

  const players = (await fetchApi<PlayerListItem[]>(`/players?${search.toString()}`)) ?? [];
  const averageWinRate = players.length ? players.reduce((sum, player) => sum + player.winRate, 0) / players.length : 0;
  const bestWinStreak = players.length ? Math.max(...players.map((player) => player.maxWinStreak)) : 0;

  return (
    <AppShell
      eyebrow="Jogador"
      title={`${mode.title}: escolha o jogador`}
      description="Primeiro voce fixa o modo da liga. Depois, abre o jogador para analisar apenas as partidas daquele recorte, sem misturar outras ligas."
    >
      <SurfaceCard className="relative overflow-hidden border-white/60">
        <div className={`absolute inset-y-0 right-0 w-44 ${mode.glowClassName}`} />
        <div className="relative">
          <div className="flex items-center gap-3">
            <span className={`rounded-full px-4 py-3 text-sm font-semibold ${mode.buttonClassName}`}>{mode.title}</span>
          </div>

          <form className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-4" method="get">
            <label className="text-sm text-ink/72 xl:col-span-2">
              Buscar jogador
              <input name="q" defaultValue={query} className="mt-2 w-full rounded-[1rem] border border-ink/10 bg-white/80 px-4 py-3 text-ink outline-none" placeholder="Digite o nome do jogador" />
            </label>
            <label className="text-sm text-ink/72">
              Min. jogos
              <input name="minGames" defaultValue={minGames} className="mt-2 w-full rounded-[1rem] border border-ink/10 bg-white/80 px-4 py-3 text-ink outline-none" />
            </label>
            <label className="text-sm text-ink/72">
              Ordenar por
              <select name="sortBy" defaultValue={sortBy} className="mt-2 w-full rounded-[1rem] border border-ink/10 bg-white/80 px-4 py-3 text-ink outline-none">
                <option value="winRateDesc">Maior aproveitamento</option>
                <option value="winRateAsc">Menor aproveitamento</option>
                <option value="maxWinStreak">Maior win streak</option>
                <option value="maxLossStreak">Maior lose streak</option>
              </select>
            </label>
          </form>
        </div>
      </SurfaceCard>

      <section className="grid gap-4 md:grid-cols-3">
        <SurfaceCard>
          <p className="text-xs uppercase tracking-[0.2em] text-brand-strong">Jogadores retornados</p>
          <p className="mt-2 text-3xl font-semibold text-ink">{formatNumber(players.length)}</p>
          <p className="mt-2 text-sm text-ink/65">Lista filtrada apenas no modo {mode.title}.</p>
        </SurfaceCard>
        <SurfaceCard>
          <p className="text-xs uppercase tracking-[0.2em] text-brand-strong">Win rate medio</p>
          <p className="mt-2 text-3xl font-semibold text-ink">{formatPercent(averageWinRate)}</p>
          <p className="mt-2 text-sm text-ink/65">Media do conjunto atual.</p>
        </SurfaceCard>
        <SurfaceCard>
          <p className="text-xs uppercase tracking-[0.2em] text-brand-strong">Melhor win streak</p>
          <p className="mt-2 text-3xl font-semibold text-ink">{formatNumber(bestWinStreak)}</p>
          <p className="mt-2 text-sm text-ink/65">Maior sequencia de vitorias no recorte.</p>
        </SurfaceCard>
      </section>

      <SurfaceCard>
        <div className="mb-4 flex items-center justify-between gap-3">
          <div>
            <p className="text-xs uppercase tracking-[0.2em] text-brand-strong">Listagem 1 a 100</p>
            <h2 className="mt-2 font-display text-2xl text-ink">Jogadores do modo {mode.title}</h2>
          </div>
          <p className="text-sm text-ink/62">Clique no nome para abrir a analise individual.</p>
        </div>

        <div className="overflow-x-auto rounded-[1.3rem] border border-ink/10 bg-white/55">
          <table className="min-w-full text-left text-sm text-ink/80">
            <thead>
              <tr className="border-b border-ink/10 bg-white/50 text-xs uppercase tracking-[0.18em] text-brand-strong">
                <th className="px-4 py-3">#</th>
                <th className="px-4 py-3">Nome</th>
                <th className="px-4 py-3">Qtde Jogos</th>
                <th className="px-4 py-3">Vitorias</th>
                <th className="px-4 py-3">Empates</th>
                <th className="px-4 py-3">Derrotas</th>
                <th className="px-4 py-3">Aproveitamento</th>
              </tr>
            </thead>
            <tbody>
              {players.map((player, index) => (
                <tr key={player.id} className="border-b border-ink/10 last:border-0 hover:bg-[#edf3df]/50">
                  <td className="px-4 py-3 font-medium text-ink/62">{formatNumber(index + 1)}</td>
                  <td className="px-4 py-3">
                    <Link href={`${mode.href}/${encodeURIComponent(player.name)}`} className="font-semibold text-ink transition hover:text-[#20352e]">
                      {player.name}
                    </Link>
                  </td>
                  <td className="px-4 py-3">{formatNumber(player.totalGames)}</td>
                  <td className="px-4 py-3">{formatNumber(player.wins)}</td>
                  <td className="px-4 py-3">{formatNumber(player.draws)}</td>
                  <td className="px-4 py-3">{formatNumber(player.losses)}</td>
                  <td className="px-4 py-3 font-semibold text-ink">{formatPercent(player.winRate)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </SurfaceCard>
    </AppShell>
  );
}