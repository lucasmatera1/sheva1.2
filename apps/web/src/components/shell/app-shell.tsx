import Link from "next/link";
import type { ReactNode } from "react";

const navigation = [
  { href: "/dashboard", label: "Dashboard" },
  { href: "/IA", label: "IA" },
  { href: "/fixture", label: "Fixture" },
  { href: "/leagues", label: "Ligas" },
  { href: "/Disparidade", label: "Disparidade" },
  { href: "/jogador", label: "Jogador" },
  { href: "/players", label: "Jogadores" },
  { href: "/methods", label: "Metodos" },
  { href: "/methods/future", label: "Future Metodos" },
  { href: "/methods/alerts", label: "Alertas" },
  { href: "/backtest", label: "Backtest" },
  { href: "/h2h", label: "H2H" },
  { href: "/h2h/basket", label: "H2H Basket" },
];

type AppShellProps = {
  title: string;
  eyebrow: string;
  description: string;
  children: ReactNode;
};

export function AppShell({ title, eyebrow, description, children }: AppShellProps) {
  return (
    <main className="min-h-screen px-1 py-6 sm:px-1.5 lg:px-2 xl:px-3">
      <div className="mx-auto flex w-full max-w-[1980px] flex-col gap-6">
        <section className="hero-panel overflow-hidden rounded-[2rem] border border-ink/10 px-6 py-6 shadow-panel sm:px-8">
          <div className="flex flex-col gap-6 xl:flex-row xl:items-start xl:justify-between">
            <div className="max-w-3xl">
              <p className="text-xs uppercase tracking-[0.35em] text-brand-strong">{eyebrow}</p>
              <h1 className="mt-4 font-display text-4xl leading-none text-ink sm:text-5xl lg:text-6xl">{title}</h1>
              <p className="mt-4 max-w-2xl text-sm leading-7 text-ink/70 sm:text-base">{description}</p>
            </div>

            <div className="rounded-[1.5rem] border border-white/50 bg-white/55 px-4 py-4 shadow-sm backdrop-blur">
              <p className="text-xs uppercase tracking-[0.3em] text-ink/55">Base ativa</p>
              <p className="mt-2 text-lg font-semibold text-ink">MySQL fifa + agregados reais</p>
            </div>
          </div>

          <nav className="mt-6 flex flex-wrap gap-3">
            {navigation.map((item) => (
              <Link key={item.href} href={item.href} className="nav-pill">
                {item.label}
              </Link>
            ))}
          </nav>
        </section>

        {children}
      </div>
    </main>
  );
}

export function SurfaceCard({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <section className={`rounded-[1.75rem] border border-ink/10 bg-white/78 p-5 shadow-panel backdrop-blur ${className}`}>{children}</section>;
}