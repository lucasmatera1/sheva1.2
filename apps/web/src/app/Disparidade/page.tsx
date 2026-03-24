import Link from "next/link";
import { AppShell, SurfaceCard } from "../../components/shell/app-shell";
import { DISPARITY_MODES } from "../../lib/disparity-mode";

export const dynamic = "force-dynamic";

export default function DisparidadePage() {
  return (
    <AppShell
      eyebrow="Disparidade"
      title="Leitura sequencial por campeonato"
      description="Escolha o modo para abrir a leitura de disparidade por jogador."
    >
      <section className="grid gap-6 lg:grid-cols-2">
        {DISPARITY_MODES.map((mode) => (
          <SurfaceCard key={mode.slug} className="relative overflow-hidden border-white/60">
            <div className={`absolute inset-y-0 right-0 w-48 ${mode.glowClassName}`} />
            <div className="relative">
              <div className="flex items-center gap-3">
                <span className={`rounded-full px-4 py-3 text-sm font-semibold ${mode.badgeClassName}`}>{mode.title}</span>
                <div>
                  <p className="text-xs uppercase tracking-[0.25em] text-brand-strong">Modo</p>
                  <p className="mt-1 text-lg font-semibold text-ink">{mode.leagueTypeLabel}</p>
                </div>
              </div>
              <div className="mt-5">
                <Link href={mode.href} className={`rounded-full px-5 py-3 text-sm font-semibold ${mode.buttonClassName}`}>
                  Abrir {mode.title}
                </Link>
              </div>
            </div>
          </SurfaceCard>
        ))}
      </section>
    </AppShell>
  );
}