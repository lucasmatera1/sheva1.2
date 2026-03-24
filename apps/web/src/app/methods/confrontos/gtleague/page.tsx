import { AppShell, SurfaceCard } from "../../../../components/shell/app-shell";

export const dynamic = "force-dynamic";

export default function MethodsConfrontosGtLeaguePage() {
  return (
    <AppShell
      eyebrow="Metodos"
      title="Confrontos GT League"
      description="Area reservada para a leitura de confrontos da GT League."
    >
      <SurfaceCard>
        <p className="text-xs uppercase tracking-[0.2em] text-brand-strong">GT League</p>
        <h2 className="mt-3 font-display text-3xl text-ink">Confrontos por liga</h2>
        <p className="mt-3 max-w-2xl text-sm leading-7 text-ink/68">
          Esta rota esta pronta para receber a modelagem especifica de confrontos da GT League.
        </p>
      </SurfaceCard>
    </AppShell>
  );
}