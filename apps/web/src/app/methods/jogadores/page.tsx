import Link from "next/link";
import { AppShell, SurfaceCard } from "../../../components/shell/app-shell";
import { fetchApi } from "../../../lib/api";

export const dynamic = "force-dynamic";

type ResultCode = "W" | "D" | "L";

type AuditResponse = {
  filters: {
    playerName: string;
    leagueType: string;
    startDayKey: string | null;
    endDayKey: string | null;
  };
  availableDayKeys: string[];
  selectedDayKeys: string[];
  player: AuditSide;
};

type AuditSide = {
  name: string;
  dailyHistory: Array<{
    dayKey: string;
    displayDate: string;
    sequence: ResultCode[];
    matches: Array<{
      matchId: string;
      localDateLabel: string;
      localTimeLabel: string;
      localPlayedAtLabel: string;
      opponent: string;
      result: ResultCode;
      fullTimeScore: string;
      seasonId: number | null;
      isMethodEntry: boolean;
    }>;
  }>;
  auditEntries: Array<{
    matchId: string;
    dayKey: string;
    localTimeLabel: string;
    localPlayedAtLabel: string;
    seasonId: number | null;
    opponent: string;
    result: ResultCode;
    fullTimeScore: string;
    previousTwo: ResultCode[];
    previousThree: ResultCode[];
    previousFour: ResultCode[];
    previousFive: ResultCode[];
    enters2LosesStreak: boolean;
    enters2LosesFullStreak: boolean;
    enters3LosesStreak: boolean;
    enters3LosesFullStreak: boolean;
    enters4LosesStreak: boolean;
    enters4LosesFullStreak: boolean;
    enters5LosesStreak: boolean;
    enters5LosesFullStreak: boolean;
  }>;
  methodSummaries: Array<{
    methodId: string;
    label: string;
    entries: number;
    wins: number;
    draws: number;
    losses: number;
    winRate: number;
    drawRate: number;
    lossRate: number;
  }>;
  logs: Array<{
    dayKey: string;
    sequence: string;
    lines: string[];
  }>;
  summary: {
    totalGames: number;
    validEntries: number;
    twoLosesStreakEntries: number;
    twoLosesFullStreakEntries: number;
    threeLosesStreakEntries: number;
    threeLosesFullStreakEntries: number;
    fourLosesStreakEntries: number;
    fourLosesFullStreakEntries: number;
    fiveLosesStreakEntries: number;
    fiveLosesFullStreakEntries: number;
  };
};

function resultBadgeClass(result: ResultCode) {
  if (result === "W") {
    return "bg-[#20352e] text-white";
  }

  if (result === "L") {
    return "bg-[#7a3f34] text-white";
  }

  return "bg-[#c9b458] text-ink";
}

function triggerPillClass(active: boolean, tone: "green" | "ink") {
  if (!active) {
    return "border border-ink/10 bg-white/70 text-ink/45";
  }

  return tone === "green" ? "bg-[#7a924f] text-white" : "bg-[#20352e] text-white";
}

function buildAuditPath(player: string, startDay?: string, endDay?: string) {
  const params = new URLSearchParams({ player, leagueType: "GT LEAGUE" });

  if (startDay) {
    params.set("startDay", startDay);
  }

  if (endDay) {
    params.set("endDay", endDay);
  }

  return `/players/methods/jogadores/audit?${params.toString()}`;
}

function TriggerSummaryCard({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-[1rem] border border-ink/10 bg-white/72 px-4 py-4">
      <p className="text-[11px] uppercase tracking-[0.18em] text-brand-strong">{label}</p>
      <p className="mt-2 text-2xl font-semibold text-ink">{value}</p>
    </div>
  );
}

function formatRate(value: number) {
  return `${value.toFixed(2).replace(".", ",")}%`;
}

function MethodSummaryTable({ side }: { side: AuditSide }) {
  return (
    <SurfaceCard>
      <p className="text-xs uppercase tracking-[0.24em] text-brand-strong">Resumo do metodo</p>
      <h2 className="mt-2 font-display text-3xl text-ink">Retorno apos o gatilho</h2>
      <div className="mt-5 overflow-x-auto">
        <table className="min-w-full text-left text-sm text-ink">
          <thead>
            <tr className="border-b border-ink/10 text-xs uppercase tracking-[0.18em] text-ink/55">
              <th className="px-3 py-3">Metodo</th>
              <th className="px-3 py-3">Entradas</th>
              <th className="px-3 py-3">W</th>
              <th className="px-3 py-3">D</th>
              <th className="px-3 py-3">L</th>
              <th className="px-3 py-3">WR</th>
              <th className="px-3 py-3">DR</th>
              <th className="px-3 py-3">LR</th>
            </tr>
          </thead>
          <tbody>
            {side.methodSummaries.map((item) => (
              <tr key={item.methodId} className="border-b border-ink/10 last:border-b-0">
                <td className="px-3 py-3 font-medium">{item.label}</td>
                <td className="px-3 py-3">{item.entries}</td>
                <td className="px-3 py-3">{item.wins}</td>
                <td className="px-3 py-3">{item.draws}</td>
                <td className="px-3 py-3">{item.losses}</td>
                <td className="px-3 py-3">{formatRate(item.winRate)}</td>
                <td className="px-3 py-3">{formatRate(item.drawRate)}</td>
                <td className="px-3 py-3">{formatRate(item.lossRate)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </SurfaceCard>
  );
}

function AuditLogs({ side }: { side: AuditSide }) {
  return (
    <SurfaceCard>
      <p className="text-xs uppercase tracking-[0.24em] text-brand-strong">Logs de auditoria</p>
      <h2 className="mt-2 font-display text-3xl text-ink">Historico bruto do dia</h2>
      <div className="mt-6 space-y-4">
        {side.logs.map((log) => (
          <div key={log.dayKey} className="rounded-[1.4rem] border border-ink/10 bg-[#f7f8f4] p-4">
            <p className="text-xs uppercase tracking-[0.2em] text-brand-strong">{log.dayKey}</p>
            <p className="mt-2 text-sm text-ink/70">Sequencia: {log.sequence}</p>
            <div className="mt-4 overflow-x-auto rounded-[1rem] bg-[#18231f] p-4 text-xs text-[#e6efe9]">
              <pre className="whitespace-pre-wrap font-mono leading-6">{log.lines.join("\n")}</pre>
            </div>
          </div>
        ))}
      </div>
    </SurfaceCard>
  );
}

function HistoryBlock({ side }: { side: AuditSide }) {
  return (
    <SurfaceCard>
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <p className="text-xs uppercase tracking-[0.24em] text-brand-strong">Historico completo</p>
          <h2 className="mt-2 font-display text-3xl text-ink">{side.name}</h2>
        </div>

        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <TriggerSummaryCard label="Jogos no recorte" value={side.summary.totalGames} />
          <TriggerSummaryCard label="Entradas validas" value={side.summary.validEntries} />
          <TriggerSummaryCard label="2 loses streak" value={side.summary.twoLosesStreakEntries} />
          <TriggerSummaryCard label="2 loses full" value={side.summary.twoLosesFullStreakEntries} />
          <TriggerSummaryCard label="3 loses streak" value={side.summary.threeLosesStreakEntries} />
          <TriggerSummaryCard label="3 loses full" value={side.summary.threeLosesFullStreakEntries} />
          <TriggerSummaryCard label="4 loses streak" value={side.summary.fourLosesStreakEntries} />
          <TriggerSummaryCard label="4 loses full" value={side.summary.fourLosesFullStreakEntries} />
          <TriggerSummaryCard label="5 loses streak" value={side.summary.fiveLosesStreakEntries} />
          <TriggerSummaryCard label="5 loses full" value={side.summary.fiveLosesFullStreakEntries} />
        </div>
      </div>

      <div className="mt-6 space-y-4">
        {side.dailyHistory.map((day) => (
          <div key={`${side.name}-${day.dayKey}`} className="rounded-[1.4rem] border border-ink/10 bg-[#f7f8f4] p-4">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
              <div>
                <p className="text-xs uppercase tracking-[0.22em] text-brand-strong">Dia operacional</p>
                <h3 className="mt-2 font-display text-2xl text-ink">{day.dayKey}</h3>
                <p className="mt-1 text-sm text-ink/65">Referencia visual: {day.displayDate}</p>
              </div>

              <div className="flex flex-wrap gap-2">
                {day.sequence.map((result, index) => (
                  <span key={`${day.dayKey}-${index}`} className={`rounded-full px-3 py-1 text-xs font-semibold ${resultBadgeClass(result)}`}>
                    {result}
                  </span>
                ))}
              </div>
            </div>

            <div className="mt-4 overflow-x-auto">
              <table className="min-w-full text-left text-sm text-ink">
                <thead>
                  <tr className="border-b border-ink/10 text-xs uppercase tracking-[0.18em] text-ink/55">
                    <th className="px-3 py-3">Hora</th>
                    <th className="px-3 py-3">Temp.</th>
                    <th className="px-3 py-3">Oponente</th>
                    <th className="px-3 py-3">DLW</th>
                    <th className="px-3 py-3">Placar</th>
                  </tr>
                </thead>
                <tbody>
                  {day.matches.map((match) => (
                    <tr key={match.matchId} className={`border-b border-ink/10 last:border-b-0 ${match.isMethodEntry ? "bg-[#edf3df]" : ""}`}>
                      <td className="px-3 py-3 font-medium">{match.localTimeLabel}</td>
                      <td className="px-3 py-3">{match.seasonId ?? "-"}</td>
                      <td className="px-3 py-3">{match.opponent}</td>
                      <td className="px-3 py-3">
                        <span className={`rounded-full px-3 py-1 text-xs font-semibold ${resultBadgeClass(match.result)}`}>{match.result}</span>
                      </td>
                      <td className="px-3 py-3 font-medium">{match.fullTimeScore}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ))}
      </div>
    </SurfaceCard>
  );
}

export default async function MethodsJogadoresPage({
  searchParams,
}: {
  searchParams: Promise<{ player?: string; startDay?: string; endDay?: string }>;
}) {
  const params = await searchParams;
  const player = params.player?.trim() || "Jack";
  const data = await fetchApi<AuditResponse>(buildAuditPath(player, params.startDay, params.endDay), { revalidate: false, cache: "no-store" });
  const validEntries = data?.player.auditEntries.filter(
    (match) =>
      match.enters2LosesStreak ||
      match.enters2LosesFullStreak ||
      match.enters3LosesStreak ||
      match.enters3LosesFullStreak ||
      match.enters4LosesStreak ||
      match.enters4LosesFullStreak ||
      match.enters5LosesStreak ||
      match.enters5LosesFullStreak,
  ) ?? [];

  return (
    <AppShell
      eyebrow="Metodos"
      title="Metodos Jogadores"
      description="Tela inicial de auditoria dos metodos por jogador, com historico diario completo em D L W e leitura jogo a jogo dos gatilhos, independente de quem foi o adversario."
    >
      <SurfaceCard>
        <div className="flex flex-col gap-5 xl:flex-row xl:items-end xl:justify-between">
          <div>
            <p className="text-xs uppercase tracking-[0.24em] text-brand-strong">Auditoria ativa</p>
            <h2 className="mt-2 font-display text-3xl text-ink">Historico do jogador e prox. jogo</h2>
            <p className="mt-2 max-w-3xl text-sm leading-7 text-ink/68">
              A leitura abaixo usa o historico completo do dia operacional do jogador e verifica o jogo seguinte apos cada sequencia, sem restringir a um adversario especifico.
            </p>
          </div>

          <Link href="/methods" className="inline-flex rounded-full border border-ink/10 bg-white/75 px-5 py-3 text-sm font-semibold text-ink transition hover:bg-[#edf3df]">
            Voltar ao hub de metodos
          </Link>
        </div>

        <form action="/methods/jogadores" className="mt-6 grid gap-4 lg:grid-cols-[1fr_180px_180px_auto]">
          <label className="text-sm text-ink/72">
            <span className="mb-2 block text-xs uppercase tracking-[0.18em] text-brand-strong">Jogador</span>
            <input name="player" defaultValue={player} className="w-full rounded-[1rem] border border-ink/10 bg-white/80 px-4 py-3 text-sm text-ink outline-none" />
          </label>
          <label className="text-sm text-ink/72">
            <span className="mb-2 block text-xs uppercase tracking-[0.18em] text-brand-strong">Dia inicial</span>
            <input type="date" name="startDay" defaultValue={params.startDay ?? data?.selectedDayKeys[data.selectedDayKeys.length - 1] ?? ""} className="w-full rounded-[1rem] border border-ink/10 bg-white/80 px-4 py-3 text-sm text-ink outline-none" />
          </label>
          <label className="text-sm text-ink/72">
            <span className="mb-2 block text-xs uppercase tracking-[0.18em] text-brand-strong">Dia final</span>
            <input type="date" name="endDay" defaultValue={params.endDay ?? data?.selectedDayKeys[0] ?? ""} className="w-full rounded-[1rem] border border-ink/10 bg-white/80 px-4 py-3 text-sm text-ink outline-none" />
          </label>
          <button type="submit" className="inline-flex h-[50px] items-center justify-center self-end rounded-full bg-[#20352e] px-5 text-sm font-semibold text-white">
            Atualizar leitura
          </button>
        </form>

        {data ? (
          <div className="mt-5 rounded-[1.25rem] border border-ink/10 bg-white/65 px-4 py-4 text-sm text-ink/72">
            <p>Intervalo solicitado: {data.filters.startDayKey ?? "inicio automatico"} ate {data.filters.endDayKey ?? "fim automatico"}.</p>
            <p className="mt-2">Dias com partidas encontrados no intervalo: {data.player.dailyHistory.map((day) => day.dayKey).join(", ") || "nenhum dia com jogos"}.</p>
          </div>
        ) : null}

      </SurfaceCard>

      {!data ? (
        <SurfaceCard>
          <p className="text-xs uppercase tracking-[0.24em] text-brand-strong">Sem leitura</p>
          <h2 className="mt-2 font-display text-3xl text-ink">Nao encontrei jogos para este jogador</h2>
          <p className="mt-3 max-w-2xl text-sm leading-7 text-ink/68">Revise o nome informado ou ajuste a janela de dias para uma faixa em que esse jogador tenha partidas.</p>
        </SurfaceCard>
      ) : (
        <>
          <SurfaceCard>
            <p className="text-xs uppercase tracking-[0.24em] text-brand-strong">Entradas validas do metodo</p>
            <h2 className="mt-2 font-display text-3xl text-ink">{data.player.name}</h2>
            <div className="mt-5 overflow-x-auto">
              <table className="min-w-full text-left text-sm text-ink">
                <thead>
                  <tr className="border-b border-ink/10 text-xs uppercase tracking-[0.18em] text-ink/55">
                    <th className="px-3 py-3">Dia</th>
                    <th className="px-3 py-3">Hora</th>
                    <th className="px-3 py-3">Temp.</th>
                    <th className="px-3 py-3">Oponente</th>
                    <th className="px-3 py-3">Prev2</th>
                    <th className="px-3 py-3">Prev3</th>
                    <th className="px-3 py-3">Prev4</th>
                    <th className="px-3 py-3">Prev5</th>
                    <th className="px-3 py-3">Placar</th>
                    <th className="px-3 py-3">DLW</th>
                    <th className="px-3 py-3">Gatilhos</th>
                  </tr>
                </thead>
                <tbody>
                  {validEntries.map((match) => (
                    <tr key={match.matchId} className="border-b border-ink/10 last:border-b-0">
                      <td className="px-3 py-3 font-medium">{match.dayKey}</td>
                      <td className="px-3 py-3">{match.localPlayedAtLabel}</td>
                      <td className="px-3 py-3">{match.seasonId ?? "-"}</td>
                      <td className="px-3 py-3">{match.opponent}</td>
                      <td className="px-3 py-3">{match.previousTwo.join(" ") || "-"}</td>
                      <td className="px-3 py-3">{match.previousThree.join(" ") || "-"}</td>
                      <td className="px-3 py-3">{match.previousFour.join(" ") || "-"}</td>
                      <td className="px-3 py-3">{match.previousFive.join(" ") || "-"}</td>
                      <td className="px-3 py-3 font-medium">{match.fullTimeScore}</td>
                      <td className="px-3 py-3"><span className={`rounded-full px-3 py-1 text-xs font-semibold ${resultBadgeClass(match.result)}`}>{match.result}</span></td>
                      <td className="px-3 py-3">
                        <div className="flex flex-wrap gap-2">
                          <span className={`rounded-full px-3 py-1 text-[11px] font-semibold ${triggerPillClass(match.enters2LosesStreak, "ink")}`}>2 LS</span>
                          <span className={`rounded-full px-3 py-1 text-[11px] font-semibold ${triggerPillClass(match.enters2LosesFullStreak, "green")}`}>2 LFS</span>
                          <span className={`rounded-full px-3 py-1 text-[11px] font-semibold ${triggerPillClass(match.enters3LosesStreak, "ink")}`}>3 LS</span>
                          <span className={`rounded-full px-3 py-1 text-[11px] font-semibold ${triggerPillClass(match.enters3LosesFullStreak, "green")}`}>3 LFS</span>
                          <span className={`rounded-full px-3 py-1 text-[11px] font-semibold ${triggerPillClass(match.enters4LosesStreak, "ink")}`}>4 LS</span>
                          <span className={`rounded-full px-3 py-1 text-[11px] font-semibold ${triggerPillClass(match.enters4LosesFullStreak, "green")}`}>4 LFS</span>
                          <span className={`rounded-full px-3 py-1 text-[11px] font-semibold ${triggerPillClass(match.enters5LosesStreak, "ink")}`}>5 LS</span>
                          <span className={`rounded-full px-3 py-1 text-[11px] font-semibold ${triggerPillClass(match.enters5LosesFullStreak, "green")}`}>5 LFS</span>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </SurfaceCard>

          <section className="grid gap-6">
            <MethodSummaryTable side={data.player} />
            <HistoryBlock side={data.player} />
            <AuditLogs side={data.player} />
          </section>
        </>
      )}
    </AppShell>
  );
}
