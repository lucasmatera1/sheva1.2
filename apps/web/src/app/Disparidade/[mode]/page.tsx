import Link from "next/link";
import { notFound } from "next/navigation";
import { AppShell, SurfaceCard } from "../../../components/shell/app-shell";
import { basketApiUrl, fetchApi, fetchApiFromBase } from "../../../lib/api";
import { getDisparityModeBySlug } from "../../../lib/disparity-mode";
import { formatNumber, formatPercent } from "../../../lib/format";

export const dynamic = "force-dynamic";

type DisparityPlayer = {
  id: string;
  name: string;
  totalGames: number;
  wins: number;
  draws: number;
  losses: number;
  winRate: number;
};

export default async function DisparidadeModoPage({
  params,
  searchParams,
}: {
  params: Promise<{ mode: string }>;
  searchParams: Promise<{ q?: string }>;
}) {
  const { mode: modeSlug } = await params;
  const mode = getDisparityModeBySlug(modeSlug);

  if (!mode) {
    notFound();
  }

  const { q = "" } = await searchParams;
  const query = new URLSearchParams();
  if (q) query.set("q", q);
  const apiPath = `/disparity/${mode.slug}${query.toString() ? `?${query.toString()}` : ""}`;
  const playersResponse =
    (mode.slug === "Basket"
      ? await fetchApiFromBase<DisparityPlayer[]>(basketApiUrl, apiPath, {
          revalidate: false,
          cache: "no-store",
          timeoutMs: 20000,
        })
      : await fetchApi<DisparityPlayer[]>(apiPath, {
          revalidate: false,
          cache: "no-store",
        }));
  const players = playersResponse ?? [];

  return (
    <AppShell
      eyebrow="Disparidade"
      title={`${mode.title}: pesquisa por jogador`}
      description={`Pesquisa de jogadores para abrir a leitura de disparidade em ${mode.leagueTypeLabel}.`}
    >
      <SurfaceCard className="relative overflow-hidden border-white/60">
        <div className={`absolute inset-y-0 right-0 w-44 ${mode.glowClassName}`} />
        <div className="relative">
          <div className="flex items-center gap-3">
            <span className={`rounded-full px-4 py-3 text-sm font-semibold ${mode.buttonClassName}`}>{mode.title}</span>
          </div>
          <form method="get" className="mt-6 grid gap-4 md:grid-cols-[1fr_auto]">
            <label className="text-sm text-ink/72">
              Buscar jogador
              <input name="q" defaultValue={q} className="mt-2 w-full rounded-[1rem] border border-ink/10 bg-white/80 px-4 py-3 text-ink outline-none" placeholder={`Pesquisar jogador de ${mode.title}`} />
            </label>
            <button type="submit" className={`self-end rounded-full px-5 py-3 text-sm font-semibold ${mode.buttonClassName}`}>
              Pesquisar
            </button>
          </form>
        </div>
      </SurfaceCard>

      <SurfaceCard>
        <div className="mb-4 flex items-center justify-between gap-3">
          <div>
            <p className="text-xs uppercase tracking-[0.2em] text-brand-strong">Pesquisa</p>
            <h2 className="mt-2 font-display text-2xl text-ink">Jogadores com disparidade ativa</h2>
          </div>
          <p className="text-sm text-ink/62">Clique no jogador para abrir a analise detalhada.</p>
        </div>
        <div className="overflow-x-auto rounded-[1.35rem] border border-ink/10 bg-white/50">
          {players.length > 0 ? (
            <table className="min-w-full text-left text-sm text-ink/80">
              <thead>
                <tr className="border-b border-ink/10 bg-white/65 text-xs uppercase tracking-[0.18em] text-brand-strong">
                  <th className="px-4 py-4">#</th>
                  <th className="px-4 py-4">Jogador</th>
                  <th className="px-4 py-4">Jogos</th>
                  <th className="px-4 py-4">V</th>
                  <th className="px-4 py-4">E</th>
                  <th className="px-4 py-4">D</th>
                  <th className="px-4 py-4">Aproveitamento</th>
                </tr>
              </thead>
              <tbody>
                {players.map((player, index) => (
                  <tr key={player.id} className="border-b border-ink/10 transition hover:bg-[#edf3df]/45 last:border-0">
                    <td className="px-4 py-4">{formatNumber(index + 1)}</td>
                    <td className="px-4 py-4">
                      <Link href={`${mode.href}/${encodeURIComponent(player.id)}`} className="font-semibold text-ink hover:text-[#20352e]">
                        {player.name}
                      </Link>
                    </td>
                    <td className="px-4 py-4">{formatNumber(player.totalGames)}</td>
                    <td className="px-4 py-4">{formatNumber(player.wins)}</td>
                    <td className="px-4 py-4">{formatNumber(player.draws)}</td>
                    <td className="px-4 py-4">{formatNumber(player.losses)}</td>
                    <td className="px-4 py-4 font-semibold text-ink">{formatPercent(player.winRate)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : playersResponse === null ? (
            <div className="px-5 py-10 text-sm text-ink/68">
              Nenhum jogador foi carregado agora. Se a API do modo {mode.title} estiver lenta ou indisponivel, a tela abre mesmo assim e voce pode tentar novamente em alguns segundos.
            </div>
          ) : (
            <div className="px-5 py-10 text-sm text-ink/68">
              Nenhum jogador encontrado para a busca atual{q ? `: "${q}"` : ""}.
              {mode.slug === "Basket" ? " No Basket, a lista considera jogadores ativos nos ultimos 90 dias." : ""}
            </div>
          )}
        </div>
      </SurfaceCard>
    </AppShell>
  );
}