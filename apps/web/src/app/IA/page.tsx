import { AppShell, SurfaceCard } from "../../components/shell/app-shell";

const IA_BLOCKS = [
  {
    title: "Painel em construcao",
    description: "Esta aba fica reservada para fluxos de IA aplicados ao operativo da base, sem misturar com dashboard, disparity ou backtest.",
  },
  {
    title: "Espaco de prototipagem",
    description: "Use esta rota para concentrar resumos, classificacoes, apoio de leitura e automacoes que dependam de contexto da aplicacao.",
  },
  {
    title: "Ponto de expansao",
    description: "A estrutura ja fica pronta no menu para receber componentes, consultas e ferramentas novas sem alterar a navegacao principal depois.",
  },
];

export default function IAPage() {
  return (
    <AppShell
      eyebrow="IA"
      title="IA"
      description="Area dedicada a recursos assistidos por IA dentro do Sheva, preparada para concentrar novos paines e fluxos de apoio operacional."
    >
      <section className="grid gap-5 xl:grid-cols-3">
        {IA_BLOCKS.map((block) => (
          <SurfaceCard key={block.title} className="relative overflow-hidden border-white/60">
            <div className="absolute inset-y-0 right-0 w-24 bg-[radial-gradient(circle_at_top,rgba(45,120,104,0.18),transparent_72%)]" />
            <div className="relative">
              <p className="text-xs uppercase tracking-[0.22em] text-brand-strong">IA</p>
              <h2 className="mt-3 font-display text-3xl text-ink">{block.title}</h2>
              <p className="mt-3 text-sm leading-7 text-ink/68">{block.description}</p>
            </div>
          </SurfaceCard>
        ))}
      </section>
    </AppShell>
  );
}