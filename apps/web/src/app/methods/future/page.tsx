import Link from "next/link";
import { AppShell, SurfaceCard } from "../../../components/shell/app-shell";
import { fetchApi } from "../../../lib/api";
import { formatNumber, formatPercent } from "../../../lib/format";
import { compareFutureRows, formatRelativeKickoff, getFuturePriorityMeta, type FutureSortBy } from "./priority";
import { FutureLiveToolbar } from "./future-live-toolbar";
import type { FutureConfrontationMethodsResponse, LeagueApiValue, LeagueQueryValue, MethodCode, ResultCode, SeriesCode } from "./types";

export const dynamic = "force-dynamic";

const LEAGUE_OPTIONS: Array<{ queryValue: LeagueQueryValue; apiValue: LeagueApiValue; label: string }> = [
  { queryValue: "gtleague", apiValue: "GT LEAGUE", label: "GT League" },
  { queryValue: "8minbattle", apiValue: "8MIN BATTLE", label: "8min Battle" },
  { queryValue: "6minvolta", apiValue: "6MIN VOLTA", label: "6min Volta" },
];

const METHOD_OPTIONS: MethodCode[] = ["T+", "E", "(2E)", "(2D)", "(2D+)", "(3D)", "(3D+)", "(4D)", "(4D+)"];
const SERIES_OPTIONS: SeriesCode[] = ["A", "B", "C", "D", "E", "F", "G"];
const DAYS_FILTER_OPTIONS = [7, 15, 21, 30, 45, 60] as const;
const SORT_OPTIONS = ["kickoff", "apx", "occurrences", "priority"] as const;

function buildPageHref(
  league: LeagueQueryValue,
  method: MethodCode,
  series?: SeriesCode,
  apxMin?: number,
  minOccurrences?: number,
  days?: number,
  sortBy: FutureSortBy = "kickoff",
) {
  const params = new URLSearchParams({ league, method });

  if (league === "gtleague" && series) {
    params.set("series", series);
  }

  if (apxMin && apxMin > 0) {
    params.set("apxMin", String(apxMin));
  }

  if (minOccurrences && minOccurrences > 1) {
    params.set("minOccurrences", String(minOccurrences));
  }

  if (days) {
    params.set("days", String(days));
  }

  params.set("sort", sortBy);

  return `/methods/future?${params.toString()}`;
}

async function getFutureMethods(
  leagueType: LeagueApiValue,
  methodCode?: MethodCode,
  series?: SeriesCode,
  days?: number,
  apxMin?: number,
  minOccurrences?: number,
) {
  const query = new URLSearchParams({ leagueType });

  if (methodCode) {
    query.set("methodCode", methodCode);
  }

  if (leagueType === "GT LEAGUE" && series) {
    query.set("series", series);
  }

  if (days) {
    query.set("days", String(days));
  }

  if (typeof apxMin === "number" && apxMin > 0) {
    query.set("apxMin", String(apxMin));
  }

  if (typeof minOccurrences === "number" && minOccurrences > 1) {
    query.set("minOccurrences", String(minOccurrences));
  }

  return fetchApi<FutureConfrontationMethodsResponse>(`/methods/future-confrontations?${query.toString()}`, {
    revalidate: false,
    cache: "no-store",
  });
}

function getSequencePillClass(result: ResultCode) {
  if (result === "W") {
    return "bg-[#20352e] text-white";
  }

  if (result === "L") {
    return "bg-[#7a3f34] text-white";
  }

  return "bg-[#c6b487] text-ink";
}

function renderSequence(sequence: ResultCode[]) {
  if (!sequence.length) {
    return <span className="text-xs text-ink/45">-</span>;
  }

  return (
    <div className="flex flex-wrap gap-1.5">
      {sequence.map((result, index) => (
        <span key={`${result}-${index}`} className={`inline-flex min-w-8 items-center justify-center rounded-full px-2.5 py-1 text-[11px] font-semibold ${getSequencePillClass(result)}`}>
          {result}
        </span>
      ))}
    </div>
  );
}

function getApxTone(apx: number) {
  if (apx >= 70) {
    return "bg-[#20352e] text-white";
  }

  if (apx >= 50) {
    return "bg-[#d8c48e] text-ink";
  }

  return "bg-[#eadfd6] text-[#7a3f34]";
}

export default async function MethodsFuturePage({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = searchParams ? await searchParams : undefined;
  const selectedLeagueQuery =
    typeof params?.league === "string" && LEAGUE_OPTIONS.some((item) => item.queryValue === params.league)
      ? (params.league as LeagueQueryValue)
      : "gtleague";
  const selectedMethod =
    typeof params?.method === "string" && METHOD_OPTIONS.includes(params.method as MethodCode)
      ? (params.method as MethodCode)
      : "(2D+)";
  const selectedSeries =
    selectedLeagueQuery === "gtleague" &&
    typeof params?.series === "string" &&
    SERIES_OPTIONS.includes(params.series.toUpperCase() as SeriesCode)
      ? (params.series.toUpperCase() as SeriesCode)
      : undefined;
  const selectedApxMinRaw = typeof params?.apxMin === "string" ? Number(params.apxMin) : 0;
  const selectedApxMin = Number.isFinite(selectedApxMinRaw) && selectedApxMinRaw > 0 ? selectedApxMinRaw : 0;
  const selectedMinOccurrencesRaw = typeof params?.minOccurrences === "string" ? Number(params.minOccurrences) : 1;
  const selectedMinOccurrences = Number.isInteger(selectedMinOccurrencesRaw) && selectedMinOccurrencesRaw > 0 ? selectedMinOccurrencesRaw : 1;
  const selectedDaysRaw = typeof params?.days === "string" ? Number(params.days) : 30;
  const selectedDays = DAYS_FILTER_OPTIONS.includes(selectedDaysRaw as (typeof DAYS_FILTER_OPTIONS)[number]) ? selectedDaysRaw : 30;
  const selectedSort = typeof params?.sort === "string" && SORT_OPTIONS.includes(params.sort as FutureSortBy) ? (params.sort as FutureSortBy) : "kickoff";
  const selectedLeague = LEAGUE_OPTIONS.find((item) => item.queryValue === selectedLeagueQuery) ?? LEAGUE_OPTIONS[0];
  const data = await getFutureMethods(selectedLeague.apiValue, selectedMethod, selectedSeries, selectedDays, selectedApxMin, selectedMinOccurrences);
  const rows = (data?.rows ?? []).sort((left, right) => compareFutureRows(left, right, selectedSort));
  const nextRow = rows[0] ?? null;
  const strongestRow = rows.reduce<typeof rows[number] | null>((best, row) => {
    if (!best || row.apx > best.apx) {
      return row;
    }

    return best;
  }, null);

  return (
    <AppShell
      eyebrow="Metodos"
      title="Future Metodos"
      description="Painel dedicado aos proximos confrontos que ainda nao aconteceram e ja entram em algum metodo com base no historico do dia corrente."
    >
      <SurfaceCard>
        <p className="text-xs uppercase tracking-[0.2em] text-brand-strong">Leitura futura</p>
        <h2 className="mt-3 font-display text-3xl text-ink">Painel de Future Metodos</h2>
        <p className="mt-3 max-w-3xl text-sm leading-7 text-ink/68">
          Cada linha representa o proximo fixture pendente de um confronto e a perspectiva do jogador que ja entra no gatilho do metodo antes do jogo acontecer.
        </p>

        <div className="mt-6 flex flex-wrap gap-3">
          {LEAGUE_OPTIONS.map((league) => (
            <Link
              key={league.queryValue}
              href={buildPageHref(league.queryValue, selectedMethod, undefined, selectedApxMin, selectedMinOccurrences, selectedDays, selectedSort)}
              className={`inline-flex rounded-full border px-5 py-3 text-sm font-semibold transition ${selectedLeague.queryValue === league.queryValue ? "border-transparent bg-[#20352e] text-white" : "border-ink/10 bg-white/75 text-ink/70 hover:border-ink/20 hover:text-ink"}`}
            >
              {league.label}
            </Link>
          ))}
        </div>

        {selectedLeague.queryValue === "gtleague" ? (
          <div className="mt-6">
            <p className="text-xs uppercase tracking-[0.2em] text-brand-strong">Series</p>
            <div className="mt-3 flex flex-wrap gap-3">
              {SERIES_OPTIONS.map((series) => (
                <Link
                  key={series}
                  href={buildPageHref(selectedLeague.queryValue, selectedMethod, selectedSeries === series ? undefined : series, selectedApxMin, selectedMinOccurrences, selectedDays, selectedSort)}
                  className={`inline-flex rounded-full border px-5 py-3 text-sm font-semibold transition ${selectedSeries === series ? "border-transparent bg-[#20352e] text-white" : "border-ink/10 bg-white/75 text-ink/70 hover:border-ink/20 hover:text-ink"}`}
                >
                  {`Serie ${series}`}
                </Link>
              ))}
            </div>
          </div>
        ) : null}

        <div className="mt-6">
          <p className="text-xs uppercase tracking-[0.2em] text-brand-strong">Metodo</p>
          <div className="mt-3 flex flex-wrap gap-3">
            {METHOD_OPTIONS.map((method) => (
              <Link
                key={method}
                href={buildPageHref(selectedLeague.queryValue, method, selectedSeries, selectedApxMin, selectedMinOccurrences, selectedDays, selectedSort)}
                className={`inline-flex rounded-full border px-4 py-2 text-sm font-semibold transition ${selectedMethod === method ? "border-transparent bg-[#20352e] text-white" : "border-ink/10 bg-white/75 text-ink/70 hover:border-ink/20 hover:text-ink"}`}
              >
                {method}
              </Link>
            ))}
          </div>
        </div>

        <div className="mt-6">
          <p className="text-xs uppercase tracking-[0.2em] text-brand-strong">Periodo</p>
          <div className="mt-3 flex flex-wrap gap-3">
            {DAYS_FILTER_OPTIONS.map((days) => (
              <Link
                key={days}
                href={buildPageHref(selectedLeague.queryValue, selectedMethod, selectedSeries, selectedApxMin, selectedMinOccurrences, days, selectedSort)}
                className={`inline-flex rounded-full border px-4 py-2 text-sm font-semibold transition ${selectedDays === days ? "border-transparent bg-[#20352e] text-white" : "border-ink/10 bg-white/75 text-ink/70 hover:border-ink/20 hover:text-ink"}`}
              >
                {days === 7 ? "Ultimos 7 dias" : days === 15 ? "Ultimos 15" : days === 21 ? "Ultimos 21 dias" : days === 30 ? "Ultimos 30" : days === 45 ? "Ultimos 45" : "Ultimos 60"}
              </Link>
            ))}
          </div>
        </div>
      </SurfaceCard>

      <SurfaceCard>
        <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="text-xs uppercase tracking-[0.2em] text-brand-strong">Janela atual</p>
            <h3 className="mt-2 font-display text-3xl text-ink">{data?.currentWindow.dayLabel ?? "Sem leitura"}</h3>
            <p className="mt-2 text-sm text-ink/65">Liga: {selectedLeague.label}</p>
            <p className="mt-1 text-sm text-ink/55">Metodo: {selectedMethod}</p>
            <p className="mt-1 text-sm text-ink/55">Periodo historico: ultimos {selectedDays} dias</p>
            {selectedMethod === "T+" ? (
              <p className="mt-1 max-w-2xl text-sm text-ink/55">
                O recorte considera apenas confrontos futuros cujo ultimo historico do mesmo par terminou em derrota para a perspectiva exibida, no padrao L.
              </p>
            ) : null}
            {selectedMethod === "E" ? (
              <p className="mt-1 max-w-2xl text-sm text-ink/55">
                O recorte considera apenas confrontos futuros cujo ultimo historico do mesmo par terminou em empate para a perspectiva exibida, no padrao D.
              </p>
            ) : null}
            <p className="mt-1 text-sm text-ink/55">Recorte backend: APX minimo {selectedApxMin || 0} | Occ minima {selectedMinOccurrences}</p>
            <p className="mt-1 text-sm text-ink/55">Ordenacao ativa: {selectedSort === "kickoff" ? "horario mais proximo" : selectedSort === "apx" ? "maior APX" : selectedSort === "occurrences" ? "mais ocorrencias" : "prioridade operacional"}</p>
          </div>
          <p className="text-xs uppercase tracking-[0.16em] text-ink/48">{formatNumber(rows.length)} oportunidade(s) futura(s)</p>
        </div>

        <div className="mt-6 grid gap-4 lg:grid-cols-3">
          <div className="rounded-[1.1rem] border border-ink/10 bg-white/72 p-4">
            <p className="text-xs uppercase tracking-[0.16em] text-brand-strong">Proximo sinal</p>
            <p className="mt-2 text-base font-semibold text-ink">{nextRow ? nextRow.fixtureLabel : "Nenhum no recorte"}</p>
            <p className="mt-1 text-sm text-ink/60">{nextRow ? formatRelativeKickoff(nextRow.playedAtIso) : "Sem kickoff futuro agora"}</p>
            {nextRow ? <span className={`mt-3 inline-flex rounded-full px-3 py-1.5 text-xs font-semibold ${getFuturePriorityMeta(nextRow).className}`}>{getFuturePriorityMeta(nextRow).label}</span> : null}
          </div>
          <div className="rounded-[1.1rem] border border-ink/10 bg-white/72 p-4">
            <p className="text-xs uppercase tracking-[0.16em] text-brand-strong">Maior APX</p>
            <p className="mt-2 text-base font-semibold text-ink">{strongestRow ? formatPercent(strongestRow.apx) : "-"}</p>
            <p className="mt-1 text-sm text-ink/60">{strongestRow ? strongestRow.confrontationLabel : "Sem oportunidade ativa"}</p>
          </div>
          <div className="rounded-[1.1rem] border border-ink/10 bg-white/72 p-4">
            <p className="text-xs uppercase tracking-[0.16em] text-brand-strong">Leitura ao vivo</p>
            <p className="mt-2 text-base font-semibold text-ink">{data?.generatedAt ? new Date(data.generatedAt).toLocaleTimeString("pt-BR") : "-"}</p>
            <p className="mt-1 text-sm text-ink/60">Atualizacao manual ou automatica pela barra live</p>
          </div>
        </div>

        <FutureLiveToolbar
          league={selectedLeagueQuery}
          method={selectedMethod}
          series={selectedSeries}
          apxMin={selectedApxMin}
          minOccurrences={selectedMinOccurrences}
          days={selectedDays}
          sortBy={selectedSort}
          generatedAt={data?.generatedAt}
          totalRows={rows.length}
        />

        {!data ? (
          <div className="mt-6 rounded-[1.2rem] border border-dashed border-ink/15 bg-white/45 px-5 py-8 text-sm text-ink/60">
            Nao foi possivel carregar os future metodos agora.
          </div>
        ) : rows.length ? (
          <div className="mt-6 overflow-hidden rounded-[1.15rem] border border-ink/10 bg-white/72">
            <div className="hidden grid-cols-[0.8fr_1fr_1fr_0.55fr_0.75fr_1fr_0.55fr_0.45fr] gap-3 border-b border-ink/10 bg-white/70 px-4 py-3 text-[11px] uppercase tracking-[0.16em] text-brand-strong xl:grid">
              <div>Proximo jogo</div>
              <div>Fixture</div>
              <div>Leitura metodo</div>
              <div>Metodo</div>
              <div>Gatilho</div>
              <div>Historico dia</div>
              <div>APX</div>
              <div>Occ</div>
            </div>

            <div className="divide-y divide-ink/8">
              {rows.map((row, index) => (
                <div
                  key={`${row.fixtureId}-${row.confrontationKey}-${row.methodCode}`}
                  className={`grid gap-4 px-4 py-4 xl:grid-cols-[0.9fr_1fr_1fr_0.55fr_0.75fr_1fr_0.55fr_0.45fr] xl:items-center ${index === 0 ? "bg-[#f3ecdc]" : "bg-transparent"}`}
                >
                  <div>
                    <p className="text-xs uppercase tracking-[0.16em] text-brand-strong xl:hidden">Proximo jogo</p>
                    <div className="flex flex-wrap items-center gap-2">
                      {index === 0 ? <span className="inline-flex rounded-full bg-[#7a3f34] px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-white">Proximo</span> : null}
                      <span className={`inline-flex rounded-full px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] ${getFuturePriorityMeta(row).className}`}>{getFuturePriorityMeta(row).label}</span>
                      <span className="inline-flex rounded-full border border-ink/10 bg-white px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-ink/70">{formatRelativeKickoff(row.playedAtIso)}</span>
                    </div>
                    <p className="mt-2 text-sm font-semibold text-ink">{row.localPlayedAtLabel}</p>
                    <p className="mt-1 text-xs text-ink/55">Grupo {row.groupLabel ?? "-"}</p>
                  </div>

                  <div>
                    <p className="text-xs uppercase tracking-[0.16em] text-brand-strong xl:hidden">Fixture</p>
                    <p className="text-sm font-semibold text-ink">{row.fixtureLabel}</p>
                  </div>

                  <div>
                    <p className="text-xs uppercase tracking-[0.16em] text-brand-strong xl:hidden">Leitura metodo</p>
                    <p className="text-sm font-semibold text-ink">{row.confrontationLabel}</p>
                    <p className="mt-1 text-xs text-ink/55">Jogador em sinal: {row.playerName} | Contra: {row.opponentName}</p>
                  </div>

                  <div>
                    <p className="text-xs uppercase tracking-[0.16em] text-brand-strong xl:hidden">Metodo</p>
                    <span className="inline-flex rounded-full bg-[#20352e] px-3 py-1.5 text-xs font-semibold text-white">{row.methodCode}</span>
                  </div>

                  <div>
                    <p className="text-xs uppercase tracking-[0.16em] text-brand-strong xl:hidden">Gatilho</p>
                    {renderSequence(row.triggerSequence)}
                  </div>

                  <div>
                    <p className="text-xs uppercase tracking-[0.16em] text-brand-strong xl:hidden">Historico dia</p>
                    {renderSequence(row.daySequence)}
                  </div>

                  <div>
                    <p className="text-xs uppercase tracking-[0.16em] text-brand-strong xl:hidden">APX</p>
                    <span className={`inline-flex rounded-full px-3 py-1.5 text-xs font-semibold ${getApxTone(row.apx)}`}>{formatPercent(row.apx)}</span>
                  </div>

                  <div>
                    <p className="text-xs uppercase tracking-[0.16em] text-brand-strong xl:hidden">Occ</p>
                    <p className="text-sm font-semibold text-ink">{formatNumber(row.totalOccurrences)}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ) : (
          <div className="mt-6 rounded-[1.2rem] border border-dashed border-ink/15 bg-white/45 px-5 py-8 text-sm text-ink/60">
            Nenhum future metodo encontrado para os filtros atuais. Isso normalmente significa que nao existe proximo confronto pendente ja entrando no gatilho antes de acontecer.
          </div>
        )}
      </SurfaceCard>
    </AppShell>
  );
}