import Link from "next/link";
import { PortalShell } from "@/components/portal-shell";

export default async function AccountPasswordPage() {
  return (
    <PortalShell
      title="Alterar Senha"
      eyebrow="Minha conta"
      description="Ponto de entrada para o gerenciamento da credencial do portal."
    >
      <section className="glass-panel rounded-[0.75rem] px-6 py-6">
        <div className="max-w-2xl">
          <div className="text-xs uppercase tracking-[0.26em] text-sage">Credencial</div>
          <h3 className="mt-3 font-display text-3xl text-ivory">Gerenciamento de senha</h3>
          <p className="mt-4 text-sm leading-7 text-mist">
            A senha atual do portal ainda esta conectada ao ambiente/configuracao local. Se quiser, no proximo passo
            eu posso transformar isso em um fluxo real de troca de senha dentro da propria interface.
          </p>

          <div className="mt-6 flex flex-wrap gap-3">
            <Link
              href="/account/profile"
              className="rounded-[0.65rem] border border-white/10 bg-white/5 px-4 py-3 text-xs font-semibold uppercase tracking-[0.22em] text-ivory transition hover:border-gold/40 hover:text-gold"
            >
              Ver dados cadastrais
            </Link>
            <Link
              href="/security/logins"
              className="rounded-[0.65rem] border border-white/10 bg-white/5 px-4 py-3 text-xs font-semibold uppercase tracking-[0.22em] text-ivory transition hover:border-gold/40 hover:text-gold"
            >
              Abrir auditoria
            </Link>
          </div>
        </div>
      </section>
    </PortalShell>
  );
}
