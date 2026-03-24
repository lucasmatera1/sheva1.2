import { AppShell, SurfaceCard } from "../../../../components/shell/app-shell";

export const dynamic = "force-dynamic";

export default function MethodsConfrontos6MinVoltaPage() {
  return (
    <AppShell
      eyebrow="Metodos"
      title="Confrontos 6min Volta"
      description="Area reservada para a leitura de confrontos do 6min Volta."
    >
      <SurfaceCard>
        <p className="text-xs uppercase tracking-[0.2em] text-brand-strong">6min Volta</p>
        <h2 className="mt-3 font-display text-3xl text-ink">Confrontos por liga</h2>
        <p className="mt-3 max-w-2xl text-sm leading-7 text-ink/68">
          Esta rota esta pronta para receber a modelagem especifica de confrontos do 6min Volta.
        </p>
      </SurfaceCard>
    </AppShell>
  );
}