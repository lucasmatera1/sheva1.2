import { PortalShell } from "@/components/portal-shell";
import { formatDateTime, formatPercent } from "@/lib/format";
import { getPortalDashboardData } from "@/lib/portal-api";

export default async function MethodsPage() {
  const data = await getPortalDashboardData();

  return (
    <PortalShell
      title="Metodos"
      eyebrow="Operacao"
      description="Regras ativas e historico recente de disparos espelhados da API atual."
    >
      <section className="grid gap-4 md:grid-cols-4">
        <article className="glass-panel rounded-[0.85rem] px-5 py-5">
          <div className="text-xs uppercase tracking-[0.24em] text-sage">Ativas</div>
          <div className="mt-3 text-4xl font-semibold text-ivory">{data.metrics.activeRules}</div>
          <p className="mt-2 text-sm text-mist">Regras ligadas no motor.</p>
        </article>
        <article className="glass-panel rounded-[0.85rem] px-5 py-5">
          <div className="text-xs uppercase tracking-[0.24em] text-sage">GT</div>
          <div className="mt-3 text-4xl font-semibold text-ivory">{data.metrics.gtRules}</div>
          <p className="mt-2 text-sm text-mist">Regras da GT LEAGUE.</p>
        </article>
        <article className="glass-panel rounded-[0.85rem] px-5 py-5">
          <div className="text-xs uppercase tracking-[0.24em] text-sage">Jogadores</div>
          <div className="mt-3 text-4xl font-semibold text-ivory">{data.metrics.targetedPlayers}</div>
          <p className="mt-2 text-sm text-mist">Jogadores com regra especifica.</p>
        </article>
        <article className="glass-panel rounded-[0.85rem] px-5 py-5">
          <div className="text-xs uppercase tracking-[0.24em] text-sage">Ultimo envio</div>
          <div className="mt-3 text-2xl font-semibold text-ivory">
            {data.latestDispatch ? formatDateTime(data.latestDispatch.sentAt ?? data.latestDispatch.createdAt) : "--"}
          </div>
          <p className="mt-2 text-sm text-mist">Ultimo dispatch conhecido.</p>
        </article>
      </section>

      <section className="glass-panel rounded-[0.85rem] px-6 py-6">
        <div className="text-xs uppercase tracking-[0.26em] text-sage">Regras ativas</div>
        <h2 className="mt-2 font-display text-3xl text-ivory">Base atual do motor</h2>

        <div className="mt-6 overflow-hidden rounded-[0.7rem] border border-white/8">
          <table className="min-w-full divide-y divide-white/8 text-left text-sm">
            <thead className="bg-white/5 text-xs uppercase tracking-[0.24em] text-sage">
              <tr>
                <th className="px-4 py-4 font-medium">Regra</th>
                <th className="px-4 py-4 font-medium">Liga</th>
                <th className="px-4 py-4 font-medium">Metodo</th>
                <th className="px-4 py-4 font-medium">Escopo</th>
                <th className="px-4 py-4 font-medium">Janela</th>
                <th className="px-4 py-4 font-medium">Atualizada</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/8 bg-black/10 text-mist">
              {data.rules.map((rule) => (
                <tr key={rule.id}>
                  <td className="px-4 py-4">
                    <div className="font-medium text-ivory">{rule.name}</div>
                    <div className="mt-1 text-xs text-sage">{rule.note ?? "Sem anotacao"}</div>
                  </td>
                  <td className="px-4 py-4 text-ivory">{rule.leagueType}</td>
                  <td className="px-4 py-4 text-ivory">{rule.methodCode}</td>
                  <td className="px-4 py-4">
                    <div className="text-ivory">{rule.playerName ?? "Regra global"}</div>
                    <div className="mt-1 text-xs uppercase tracking-[0.18em] text-sage">{rule.series ?? "Serie livre"}</div>
                  </td>
                  <td className="px-4 py-4 text-ivory">{rule.windowDays}d / APX {formatPercent(rule.apxMin)}</td>
                  <td className="px-4 py-4 text-ivory">{formatDateTime(rule.updatedAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="glass-panel rounded-[0.85rem] px-6 py-6">
        <div className="text-xs uppercase tracking-[0.26em] text-sage">Dispatches recentes</div>
        <h2 className="mt-2 font-display text-3xl text-ivory">Fluxo ja disparado</h2>

        <div className="mt-6 overflow-hidden rounded-[0.7rem] border border-white/8">
          <table className="min-w-full divide-y divide-white/8 text-left text-sm">
            <thead className="bg-white/5 text-xs uppercase tracking-[0.24em] text-sage">
              <tr>
                <th className="px-4 py-4 font-medium">Horario</th>
                <th className="px-4 py-4 font-medium">Confronto</th>
                <th className="px-4 py-4 font-medium">Metodo</th>
                <th className="px-4 py-4 font-medium">Evento</th>
                <th className="px-4 py-4 font-medium">APX</th>
                <th className="px-4 py-4 font-medium">Ocorrencias</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/8 bg-black/10 text-mist">
              {data.recentDispatches.map((dispatch) => (
                <tr key={dispatch.id}>
                  <td className="px-4 py-4 text-ivory">{formatDateTime(dispatch.sentAt ?? dispatch.createdAt)}</td>
                  <td className="px-4 py-4">
                    <div className="font-medium text-ivory">{dispatch.confrontationLabel ?? "--"}</div>
                    <div className="mt-1 text-xs uppercase tracking-[0.18em] text-sage">{dispatch.leagueType}</div>
                  </td>
                  <td className="px-4 py-4 text-ivory">{dispatch.methodCode}</td>
                  <td className="px-4 py-4 text-ivory">{dispatch.eventType}</td>
                  <td className="px-4 py-4 text-ivory">{formatPercent(dispatch.apx)}</td>
                  <td className="px-4 py-4 text-ivory">{dispatch.totalOccurrences ?? "--"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </PortalShell>
  );
}
