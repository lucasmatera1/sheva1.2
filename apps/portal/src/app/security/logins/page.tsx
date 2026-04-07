import { PortalShell } from "@/components/portal-shell";
import { getLoginAuditEntries, getLoginAuditSummary } from "@/lib/auth/login-audit";
import { formatDateTime } from "@/lib/format";

export default async function LoginSecurityPage() {
  const entries = await getLoginAuditEntries(60);
  const summary = getLoginAuditSummary(entries);

  return (
    <PortalShell
      title="Acessos"
      eyebrow="Seguranca"
      description="Auditoria das entradas no portal, com sucesso, falha, IP, localizacao e agente de usuario."
    >
      <section className="grid gap-4 md:grid-cols-4">
        <article className="glass-panel rounded-[0.85rem] px-5 py-5">
          <div className="text-xs uppercase tracking-[0.24em] text-sage">Tentativas</div>
          <div className="mt-3 text-4xl font-semibold text-ivory">{summary.totalAttempts}</div>
          <p className="mt-2 text-sm text-mist">Eventos registrados no arquivo de auditoria.</p>
        </article>
        <article className="glass-panel rounded-[0.85rem] px-5 py-5">
          <div className="text-xs uppercase tracking-[0.24em] text-sage">Sucesso</div>
          <div className="mt-3 text-4xl font-semibold text-ivory">{summary.successfulLogins}</div>
          <p className="mt-2 text-sm text-mist">Autenticacoes concluidas.</p>
        </article>
        <article className="glass-panel rounded-[0.85rem] px-5 py-5">
          <div className="text-xs uppercase tracking-[0.24em] text-sage">Falha</div>
          <div className="mt-3 text-4xl font-semibold text-ivory">{summary.failedLogins}</div>
          <p className="mt-2 text-sm text-mist">Tentativas invalidas ou incompletas.</p>
        </article>
        <article className="glass-panel rounded-[0.85rem] px-5 py-5">
          <div className="text-xs uppercase tracking-[0.24em] text-sage">IPs unicos</div>
          <div className="mt-3 text-4xl font-semibold text-ivory">{summary.uniqueIps}</div>
          <p className="mt-2 text-sm text-mist">Origem de rede observada no historico.</p>
        </article>
      </section>

      <section className="glass-panel rounded-[0.85rem] px-6 py-6">
        <div className="flex items-center justify-between gap-4">
          <div>
            <div className="text-xs uppercase tracking-[0.26em] text-sage">Auditoria</div>
            <h2 className="mt-2 font-display text-3xl text-ivory">Historico completo de acesso</h2>
          </div>
          <div className="text-xs uppercase tracking-[0.22em] text-sage">{entries.length} linha(s)</div>
        </div>

        <div className="mt-6 overflow-hidden rounded-[0.7rem] border border-white/8">
          <table className="min-w-full divide-y divide-white/8 text-left text-sm">
            <thead className="bg-white/5 text-xs uppercase tracking-[0.24em] text-sage">
              <tr>
                <th className="px-4 py-4 font-medium">Data/Hora</th>
                <th className="px-4 py-4 font-medium">Usuario</th>
                <th className="px-4 py-4 font-medium">Status</th>
                <th className="px-4 py-4 font-medium">IP</th>
                <th className="px-4 py-4 font-medium">Localizacao</th>
                <th className="px-4 py-4 font-medium">Origem</th>
                <th className="px-4 py-4 font-medium">Navegador</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/8 bg-black/10 text-mist">
              {entries.map((entry) => (
                <tr key={entry.id}>
                  <td className="px-4 py-4 text-ivory">{formatDateTime(entry.attemptedAt)}</td>
                  <td className="px-4 py-4 text-ivory">{entry.username || "--"}</td>
                  <td className="px-4 py-4">
                    <span
                      className={`inline-flex rounded-[0.55rem] px-3 py-1 text-xs font-semibold uppercase tracking-[0.2em] ${
                        entry.success
                          ? "border border-emerald-300/20 bg-emerald-400/10 text-emerald-200"
                          : "border border-coral/30 bg-coral/10 text-coral"
                      }`}
                    >
                      {entry.success ? "Sucesso" : "Falha"}
                    </span>
                  </td>
                  <td className="px-4 py-4 text-ivory">{entry.ip ?? "--"}</td>
                  <td className="px-4 py-4">
                    <div className="text-ivory">{entry.location.label}</div>
                    {entry.failureReason ? <div className="mt-1 text-xs text-coral">{entry.failureReason}</div> : null}
                  </td>
                  <td className="px-4 py-4 text-ivory">{entry.location.source}</td>
                  <td className="px-4 py-4 text-xs text-mist">{entry.userAgent ?? "--"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </PortalShell>
  );
}
