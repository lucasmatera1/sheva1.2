import Link from "next/link";
import { PortalShell } from "@/components/portal-shell";
import { formatDateTime, formatPercent } from "@/lib/format";
import { getPortalDashboardData } from "@/lib/portal-api";

function DatabaseIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="none" aria-hidden="true" className="h-5 w-5">
      <ellipse cx="10" cy="5.25" rx="5.25" ry="2.25" stroke="currentColor" strokeWidth="1.4" />
      <path d="M4.75 5.5v4.25c0 1.24 2.35 2.25 5.25 2.25s5.25-1.01 5.25-2.25V5.5" stroke="currentColor" strokeWidth="1.4" />
      <path d="M4.75 9.75V14c0 1.24 2.35 2.25 5.25 2.25s5.25-1.01 5.25-2.25V9.75" stroke="currentColor" strokeWidth="1.4" />
    </svg>
  );
}

function TelegramIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="none" aria-hidden="true" className="h-5 w-5">
      <path d="m16.25 4.25-2.48 11.67c-.18.86-.68 1.07-1.4.67l-3.2-2.36-1.54 1.48c-.17.17-.31.31-.65.31l.23-3.27 5.96-5.39c.26-.23-.06-.35-.4-.12l-7.37 4.64-3.17-.99c-.69-.22-.7-.69.14-1.02l12.39-4.77c.58-.21 1.08.14.89 1.15Z" stroke="currentColor" strokeWidth="1.35" strokeLinejoin="round" />
    </svg>
  );
}

function PulseIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="none" aria-hidden="true" className="h-5 w-5">
      <path d="M2.75 10h3.1l1.6-3.5 2.85 7 2.05-4.5h4.9" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function ShieldIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="none" aria-hidden="true" className="h-5 w-5">
      <path d="M10 3.25 5.25 5v4.36c0 3.09 1.98 5.88 4.75 6.89 2.77-1.01 4.75-3.8 4.75-6.89V5L10 3.25Z" stroke="currentColor" strokeWidth="1.45" strokeLinejoin="round" />
      <path d="m8.25 9.75 1.2 1.2 2.3-2.7" stroke="currentColor" strokeWidth="1.45" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function ClockIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="none" aria-hidden="true" className="h-5 w-5">
      <circle cx="10" cy="10" r="6.25" stroke="currentColor" strokeWidth="1.45" />
      <path d="M10 6.5v3.8l2.45 1.45" stroke="currentColor" strokeWidth="1.45" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function SectionArrow() {
  return (
    <svg viewBox="0 0 20 20" fill="none" aria-hidden="true" className="h-4 w-4">
      <path d="m7.5 5 5 5-5 5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function MetricSpark({ variant }: { variant: "dispatches" | "coverage" }) {
  const stroke = variant === "dispatches" ? "rgba(215, 178, 109, 0.62)" : "rgba(106, 192, 177, 0.52)";
  const fill = variant === "dispatches" ? "rgba(215, 178, 109, 0.08)" : "rgba(106, 192, 177, 0.08)";
  const path =
    variant === "dispatches"
      ? "M2 34 C 10 31, 18 18, 26 20 S 42 34, 50 27 S 66 7, 74 11 S 90 29, 98 19"
      : "M2 29 C 10 19, 18 23, 26 17 S 42 9, 50 14 S 66 31, 74 24 S 90 8, 98 13";

  return (
    <svg viewBox="0 0 100 40" aria-hidden="true" className="absolute inset-x-4 bottom-3 h-16 w-[calc(100%-2rem)] opacity-80">
      <path d="M2 38 2 34" stroke={stroke} strokeWidth="0.8" opacity="0.55" />
      <path d={`${path} L98 40 L2 40 Z`} fill={fill} />
      <path d={path} stroke={stroke} strokeWidth="1.7" fill="none" strokeLinecap="round" />
      <path d="M2 32 H98" stroke="rgba(255,255,255,0.06)" strokeWidth="0.8" />
    </svg>
  );
}

function TopStatusCard({
  label,
  value,
  detail,
  icon,
}: {
  label: string;
  value: string;
  detail: string;
  icon: React.ReactNode;
}) {
  return (
    <div className="soft-panel rounded-[0.75rem] px-4 py-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-[11px] uppercase tracking-[0.24em] text-sage">{label}</div>
          <div className="mt-2 text-xl font-semibold text-ivory">{value}</div>
        </div>
        <div className="flex h-10 w-10 items-center justify-center rounded-[0.7rem] border border-white/10 bg-white/5 text-sand">
          {icon}
        </div>
      </div>
      <p className="mt-3 text-sm leading-6 text-mist">{detail}</p>
    </div>
  );
}

function MetricCard({
  label,
  value,
  detail,
  icon,
  accent,
  spark,
}: {
  label: string;
  value: string;
  detail: string;
  icon: React.ReactNode;
  accent: "sand" | "teal" | "blue";
  spark?: "dispatches" | "coverage";
}) {
  const accentClass =
    accent === "sand" ? "text-sand" : accent === "teal" ? "text-[#87d8c7]" : "text-[#cbd8e3]";

  return (
    <article className="glass-panel relative overflow-hidden rounded-[0.85rem] px-5 py-5">
      {spark ? <MetricSpark variant={spark} /> : null}
      <div className="relative">
        <div className="flex items-start justify-between gap-3">
          <div className="text-[11px] uppercase tracking-[0.24em] text-sage">{label}</div>
          <div className={`flex h-10 w-10 items-center justify-center rounded-[0.7rem] border border-white/10 bg-white/5 ${accentClass}`}>
            {icon}
          </div>
        </div>

        <div className={`mt-5 text-[3rem] font-semibold leading-none tracking-tight ${accentClass}`}>{value}</div>
        <p className="mt-3 max-w-[14rem] text-sm leading-6 text-mist">{detail}</p>
      </div>
    </article>
  );
}

function DispatchRow({
  time,
  confrontation,
  league,
  method,
  apx,
  status,
}: {
  time: string;
  confrontation: string;
  league: string;
  method: string;
  apx: string;
  status: string;
}) {
  return (
    <div className="soft-panel rounded-[0.75rem] px-4 py-4">
      <div className="grid gap-4 lg:grid-cols-[148px_minmax(0,1fr)_118px_92px_112px] lg:items-center">
        <div>
          <div className="text-[11px] uppercase tracking-[0.22em] text-sage">Horario</div>
          <div className="mt-2 text-sm font-semibold text-ivory">{time}</div>
        </div>

        <div>
          <div className="text-[11px] uppercase tracking-[0.22em] text-sage">Confronto</div>
          <div className="mt-2 text-sm font-semibold text-ivory">{confrontation}</div>
          <div className="mt-1 text-xs uppercase tracking-[0.18em] text-sage">{league}</div>
        </div>

        <div>
          <div className="text-[11px] uppercase tracking-[0.22em] text-sage">Metodo</div>
          <div className="mt-2 text-sm text-ivory">{method}</div>
        </div>

        <div>
          <div className="text-[11px] uppercase tracking-[0.22em] text-sage">APX</div>
          <div className="mt-2 text-sm text-ivory">{apx}</div>
        </div>

        <div>
          <div className="text-[11px] uppercase tracking-[0.22em] text-sage">Status</div>
          <span className="mt-2 inline-flex rounded-[0.55rem] border border-emerald-300/20 bg-emerald-400/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] text-emerald-200">
            {status}
          </span>
        </div>
      </div>
    </div>
  );
}

function AuditRow({
  username,
  time,
  ip,
  location,
  success,
}: {
  username: string;
  time: string;
  ip: string;
  location: string;
  success: boolean;
}) {
  return (
    <div className="soft-panel rounded-[0.75rem] px-4 py-4">
      <div className="grid gap-4 lg:grid-cols-[160px_148px_140px_minmax(0,1fr)_112px] lg:items-center">
        <div>
          <div className="text-[11px] uppercase tracking-[0.22em] text-sage">Usuario</div>
          <div className="mt-2 text-sm font-semibold text-ivory">{username}</div>
        </div>
        <div>
          <div className="text-[11px] uppercase tracking-[0.22em] text-sage">Horario</div>
          <div className="mt-2 text-sm text-ivory">{time}</div>
        </div>
        <div>
          <div className="text-[11px] uppercase tracking-[0.22em] text-sage">IP</div>
          <div className="mt-2 text-sm text-ivory">{ip}</div>
        </div>
        <div>
          <div className="text-[11px] uppercase tracking-[0.22em] text-sage">Localizacao</div>
          <div className="mt-2 text-sm text-mist">{location}</div>
        </div>
        <div>
          <div className="text-[11px] uppercase tracking-[0.22em] text-sage">Status</div>
          <span
            className={`mt-2 inline-flex rounded-[0.55rem] px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] ${
              success
                ? "border border-emerald-300/20 bg-emerald-400/10 text-emerald-200"
                : "border border-coral/30 bg-coral/10 text-coral"
            }`}
          >
            {success ? "Sucesso" : "Falha"}
          </span>
        </div>
      </div>
    </div>
  );
}

export default async function PortalDashboardPage() {
  const data = await getPortalDashboardData();

  const metrics = [
    {
      label: "Regras ativas",
      value: String(data.metrics.activeRules),
      detail: `${data.metrics.gtRules} configuracoes ativas dedicadas ao universo GT.`,
      icon: <DatabaseIcon />,
      accent: "sand" as const,
    },
    {
      label: "Disparos",
      value: String(data.metrics.sentDispatches),
      detail: `${data.metrics.resolvedDispatches} registros ja retornaram com follow-up resolvido.`,
      icon: <PulseIcon />,
      accent: "teal" as const,
      spark: "dispatches" as const,
    },
    {
      label: "Cobertura",
      value: String(data.metrics.leaguesCovered),
      detail: `${data.metrics.targetedPlayers} jogadores estao dentro de configuracoes especificas.`,
      icon: <ShieldIcon />,
      accent: "blue" as const,
      spark: "coverage" as const,
    },
    {
      label: "Seguranca",
      value: `${data.auditSummary.successfulLogins}/${data.auditSummary.totalAttempts}`,
      detail: `${data.auditSummary.failedLogins} tentativa(s) falharam no recorte recente.`,
      icon: <ClockIcon />,
      accent: "sand" as const,
    },
  ];

  return (
    <PortalShell
      title="Overview"
      eyebrow="Centro de comando"
      description="Leitura operacional do portal com foco em sinais recentes, estabilidade do motor e acesso da equipe."
    >
      <section className="grid gap-4 xl:grid-cols-[1.18fr_0.82fr]">
        <article className="glass-panel rounded-[0.85rem] px-6 py-6 sm:px-7">
          <div className="space-y-6">
            <div className="space-y-3">
              <div className="inline-flex rounded-[0.65rem] border border-gold/18 bg-gold/10 px-3 py-1 text-[11px] uppercase tracking-[0.24em] text-gold">
                bDb intelligence
              </div>
              <h2 className="max-w-3xl font-display text-[3.2rem] leading-[0.95] text-ivory">
                Operacao e visibilidade de metodo num unico painel.
              </h2>
              <p className="max-w-3xl text-sm leading-7 text-mist sm:text-[0.96rem]">
                A composicao abaixo prioriza leitura rapida: status do motor, disponibilidade do transporte e
                rastreio de atividade recente sem ruído visual desnecessario.
              </p>
            </div>

            <div className="grid gap-3 md:grid-cols-3">
              <TopStatusCard
                label="Persistencia"
                value={data.alertStatus.persistenceMode}
                detail={data.alertStatus.isVolatile ? "A API ainda opera em modo volatil." : "Persistencia estavel detectada."}
                icon={<DatabaseIcon />}
              />
              <TopStatusCard
                label="Telegram"
                value={data.alertStatus.telegramConfigured ? "Conectado" : "Desligado"}
                detail={`${data.alertStatus.defaultTelegramChatIds.length} destino(s) padrao reconhecidos.`}
                icon={<TelegramIcon />}
              />
              <TopStatusCard
                label="Monitoramento"
                value={data.latestDispatch ? formatDateTime(data.latestDispatch.sentAt ?? data.latestDispatch.createdAt) : "--"}
                detail="Horario mais recente confirmado pelo portal."
                icon={<ClockIcon />}
              />
            </div>
          </div>
        </article>

        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-2">
          {metrics.map((metric) => (
            <MetricCard
              key={metric.label}
              label={metric.label}
              value={metric.value}
              detail={metric.detail}
              icon={metric.icon}
              accent={metric.accent}
              spark={metric.spark}
            />
          ))}
        </div>
      </section>

      <section className="grid gap-4 xl:grid-cols-[1.1fr_0.9fr]">
        <article className="glass-panel rounded-[0.85rem] px-6 py-6">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <div className="text-[11px] uppercase tracking-[0.26em] text-sage">Fluxo recente</div>
              <h3 className="mt-2 font-display text-3xl text-ivory">Ultimos disparos</h3>
            </div>
            <Link
              href="/methods"
              className="inline-flex items-center gap-2 rounded-[0.65rem] border border-white/10 bg-white/5 px-4 py-2 text-xs font-semibold uppercase tracking-[0.22em] text-ivory transition hover:border-gold/40 hover:text-gold"
            >
              Ver tudo
              <SectionArrow />
            </Link>
          </div>

          <div className="mt-6 space-y-3">
            {data.recentDispatches.slice(0, 6).map((dispatch) => (
              <DispatchRow
                key={dispatch.id}
                time={formatDateTime(dispatch.sentAt ?? dispatch.createdAt)}
                confrontation={dispatch.confrontationLabel ?? "--"}
                league={dispatch.leagueType}
                method={dispatch.methodCode}
                apx={formatPercent(dispatch.apx)}
                status={dispatch.transportStatus}
              />
            ))}
          </div>
        </article>

        <article className="glass-panel rounded-[0.85rem] px-6 py-6">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <div className="text-[11px] uppercase tracking-[0.26em] text-sage">Seguranca</div>
              <h3 className="mt-2 font-display text-3xl text-ivory">Acessos recentes</h3>
            </div>
            <Link
              href="/security/logins"
              className="inline-flex items-center gap-2 rounded-[0.65rem] border border-white/10 bg-white/5 px-4 py-2 text-xs font-semibold uppercase tracking-[0.22em] text-ivory transition hover:border-gold/40 hover:text-gold"
            >
              Auditoria
              <SectionArrow />
            </Link>
          </div>

          <div className="mt-6 space-y-3">
            {data.loginAudit.slice(0, 6).map((entry) => (
              <AuditRow
                key={entry.id}
                username={entry.username || "Usuario desconhecido"}
                time={formatDateTime(entry.attemptedAt)}
                ip={entry.ip ?? "--"}
                location={entry.location.label}
                success={entry.success}
              />
            ))}

            {data.loginAudit.length === 0 ? (
              <div className="soft-panel rounded-[0.75rem] px-4 py-5 text-sm text-mist">
                Nenhum acesso registrado ainda.
              </div>
            ) : null}
          </div>
        </article>
      </section>
    </PortalShell>
  );
}
