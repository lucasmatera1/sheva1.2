import { AppShell, SurfaceCard } from "../../../components/shell/app-shell";

export const dynamic = "force-dynamic";

export default function MethodsOverPage() {
  return (
    <AppShell
      eyebrow="Metodos"
      title="Metodos Over"
      description="Area reservada para estudos, filtros e apresentacao da pagina de over."
    >
      <SurfaceCard>
        <p className="text-xs uppercase tracking-[0.2em] text-brand-strong">Em construcao</p>
        <h2 className="mt-3 font-display text-3xl text-ink">Base de Over</h2>
        <p className="mt-3 max-w-2xl text-sm leading-7 text-ink/68">
          Esta rota foi criada para a nova pagina de over dentro da area de metodos.
        </p>
      </SurfaceCard>
    </AppShell>
  );
}
