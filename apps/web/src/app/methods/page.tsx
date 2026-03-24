import Link from "next/link";
import { AppShell, SurfaceCard } from "../../components/shell/app-shell";

export const dynamic = "force-dynamic";
const methodSections = [
  {
    href: "/methods/jogadores",
    title: "Jogadores",
    description: "Leitura orientada por jogador, com foco em desempenho, recortes e organizacao futura por nome.",
  },
  {
    href: "/methods/confrontos",
    title: "Confrontos",
    description: "Area reservada para cruzamentos por pares, recorrencia de confronto e comportamento historico.",
  },
  {
    href: "/methods/over",
    title: "Over",
    description: "Espaco dedicado para metodos e estudos de over, pronto para a nova modelagem da pagina.",
  },
  {
    href: "/methods/alerts",
    title: "Alertas",
    description: "Cadastro de regras por metodo, execucao em dry-run e acompanhamento dos disparos enviados ao webhook.",
  },
  {
    href: "/methods/future",
    title: "Future",
    description: "Painel dos proximos confrontos que ainda nao aconteceram, mas ja entram em metodo antes do kickoff.",
  },
];

export default function MethodsPage() {
  return (
    <AppShell
      eyebrow="Metodos"
      title="Metodos"
      description="Hub principal da area de metodos. A partir daqui, a navegacao segue para jogadores, confrontos e over."
    >
      <section className="grid gap-5 lg:grid-cols-2 xl:grid-cols-5">
        {methodSections.map((section) => (
          <SurfaceCard key={section.href} className="relative overflow-hidden border-white/60">
            <div className="absolute inset-y-0 right-0 w-24 bg-[radial-gradient(circle_at_top,rgba(112,140,102,0.18),transparent_72%)]" />
            <div className="relative">
              <p className="text-xs uppercase tracking-[0.22em] text-brand-strong">Area</p>
              <h2 className="mt-3 font-display text-3xl text-ink">{section.title}</h2>
              <p className="mt-3 text-sm leading-7 text-ink/68">{section.description}</p>
              <div className="mt-6">
                <Link href={section.href} className="inline-flex rounded-full bg-[#20352e] px-5 py-3 text-sm font-semibold text-white">
                  Abrir {section.title}
                </Link>
              </div>
            </div>
          </SurfaceCard>
        ))}
      </section>
    </AppShell>
  );
}
