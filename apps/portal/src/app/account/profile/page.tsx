import { PortalShell } from "@/components/portal-shell";
import { formatDateTime } from "@/lib/format";
import { readPortalSession } from "@/lib/auth/session";
import { getLoginAuditEntries } from "@/lib/auth/login-audit";

export default async function AccountProfilePage() {
  const session = await readPortalSession();
  const recentAudit = await getLoginAuditEntries(10);
  const lastSuccess = recentAudit.find((entry) => entry.success);

  return (
    <PortalShell
      title="Dados Cadastrais"
      eyebrow="Minha conta"
      description="Dados basicos da sessao e ultimo acesso identificado no portal."
    >
      <section className="grid gap-4 xl:grid-cols-[0.95fr_1.05fr]">
        <article className="glass-panel rounded-[0.75rem] px-6 py-6">
          <div className="text-xs uppercase tracking-[0.26em] text-sage">Perfil</div>
          <h3 className="mt-3 font-display text-3xl text-ivory">Conta ativa</h3>

          <div className="mt-6 grid gap-4">
            <div className="soft-panel rounded-[0.65rem] px-4 py-4">
              <div className="text-[11px] uppercase tracking-[0.24em] text-sage">Usuario</div>
              <div className="mt-2 text-lg font-semibold text-ivory">{session?.username ?? "--"}</div>
            </div>
            <div className="soft-panel rounded-[0.65rem] px-4 py-4">
              <div className="text-[11px] uppercase tracking-[0.24em] text-sage">Sessao</div>
              <div className="mt-2 text-sm text-mist">Cookie assinado com expiracao controlada pelo portal.</div>
            </div>
          </div>
        </article>

        <article className="glass-panel rounded-[0.75rem] px-6 py-6">
          <div className="text-xs uppercase tracking-[0.26em] text-sage">Ultimo acesso</div>
          <h3 className="mt-3 font-display text-3xl text-ivory">Rastro recente</h3>

          <div className="mt-6 grid gap-4">
            <div className="soft-panel rounded-[0.65rem] px-4 py-4">
              <div className="text-[11px] uppercase tracking-[0.24em] text-sage">Horario</div>
              <div className="mt-2 text-sm font-semibold text-ivory">
                {lastSuccess ? formatDateTime(lastSuccess.attemptedAt) : "--"}
              </div>
            </div>
            <div className="soft-panel rounded-[0.65rem] px-4 py-4">
              <div className="text-[11px] uppercase tracking-[0.24em] text-sage">Origem</div>
              <div className="mt-2 text-sm text-mist">{lastSuccess?.location.label ?? "Sem historico recente."}</div>
            </div>
            <div className="soft-panel rounded-[0.65rem] px-4 py-4">
              <div className="text-[11px] uppercase tracking-[0.24em] text-sage">IP</div>
              <div className="mt-2 text-sm text-mist">{lastSuccess?.ip ?? "--"}</div>
            </div>
          </div>
        </article>
      </section>
    </PortalShell>
  );
}
