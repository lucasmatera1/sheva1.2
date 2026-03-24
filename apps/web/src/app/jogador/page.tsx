import Link from "next/link";
import { AppShell, SurfaceCard } from "../../components/shell/app-shell";
import { fetchApi } from "../../lib/api";
import { formatNumber, formatPercent } from "../../lib/format";
import { PLAYER_MODES } from "../../lib/player-mode";

export const dynamic = "force-dynamic";

type PlayerPreview = {
  id: string;
  name: string;
  totalGames: number;
  wins: number;
  draws: number;
  losses: number;
  winRate: number;
};

export default async function JogadorPage() {
  const modeSnapshots = await Promise.all(
    PLAYER_MODES.map(async (mode) => {
      const players =
        (await fetchApi<PlayerPreview[]>(`/players?leagueType=${encodeURIComponent(mode.leagueType)}&limit=5&minGames=5&sortBy=winRate`)) ?? [];

      return {
        mode,
        players,
        highlight: players[0] ?? null,
      };
    }),
  );

  return (
    <AppShell
      eyebrow="Jogador"
      title="Analise focada por jogador"
      description="Escolha o modo da liga, abra a lista de jogadores daquele ambiente e entre no card individual para ver apenas os jogos daquele recorte. As URLs seguem o padrao /jogador/modo/nome-do-jogador."
    >
      <SurfaceCard>
        <div className="grid gap-4 md:grid-cols-3">
          {modeSnapshots.map(({ mode, players, highlight }) => (
            <section key={mode.slug} className="relative overflow-hidden rounded-[1.6rem] border border-ink/10 bg-white/72 p-5">
              <div className={`absolute inset-y-0 right-0 w-32 ${mode.glowClassName}`} />
              <div className="relative">
                <div className="flex items-center gap-3">
                  <span className={`inline-flex h-11 w-11 items-center justify-center rounded-2xl text-sm font-semibold tracking-[0.2em] ${mode.badgeClassName}`}>{mode.shortCode}</span>
                  <div>
                    <p className="text-xs uppercase tracking-[0.2em] text-brand-strong">Modo</p>
                    <h2 className="mt-1 font-display text-2xl text-ink">{mode.title}</h2>
                  </div>
                </div>
                <p className="mt-4 text-sm leading-6 text-ink/70">{mode.description}</p>
                <div className="mt-5 grid gap-3 sm:grid-cols-2">
                  <div className="rounded-[1rem] border border-ink/10 bg-white/70 px-4 py-3">
                    <p className="text-xs uppercase tracking-[0.2em] text-brand-strong">Jogadores no topo</p>
                    <p className="mt-2 text-xl font-semibold text-ink">{formatNumber(players.length)}</p>
                  </div>
                  <div className="rounded-[1rem] border border-ink/10 bg-white/70 px-4 py-3">
                    <p className="text-xs uppercase tracking-[0.2em] text-brand-strong">Destaque atual</p>
                    <p className="mt-2 text-base font-semibold text-ink">{highlight?.name ?? "Sem dados"}</p>
                  </div>
                </div>
                <p className="mt-4 text-sm text-ink/65">{mode.note}</p>
                <div className="mt-5 flex gap-3">
                  <Link href={mode.href} className={`rounded-full px-5 py-3 text-sm font-semibold ${mode.buttonClassName}`}>
                    Escolher jogador
                  </Link>
                </div>
              </div>
            </section>
          ))}
        </div>
      </SurfaceCard>

      <section className="grid gap-6 xl:grid-cols-3">
        {modeSnapshots.map(({ mode, players }) => (
          <SurfaceCard key={`${mode.slug}-players`}>
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-xs uppercase tracking-[0.2em] text-brand-strong">Preview</p>
                <h2 className="mt-2 font-display text-2xl text-ink">{mode.title}</h2>
              </div>
              <Link href={mode.href} className="text-sm font-semibold text-ink/70">
                Ver lista
              </Link>
            </div>

            <div className="mt-4 space-y-3">
              {players.map((player) => (
                <Link
                  key={`${mode.slug}-${player.id}`}
                  href={`${mode.href}/${encodeURIComponent(player.name)}`}
                  className="block rounded-[1.1rem] border border-ink/10 bg-white/72 px-4 py-3 text-sm text-ink transition hover:-translate-y-0.5 hover:bg-[#edf3df]"
                >
                  <div className="flex items-center justify-between gap-3">
                    <span className="font-medium">{player.name}</span>
                    <span>{formatPercent(player.winRate)}</span>
                  </div>
                  <p className="mt-2 text-ink/66">{formatNumber(player.totalGames)} jogos | {formatNumber(player.wins)}V {formatNumber(player.draws)}E {formatNumber(player.losses)}D</p>
                </Link>
              ))}
            </div>
          </SurfaceCard>
        ))}
      </section>
    </AppShell>
  );
}