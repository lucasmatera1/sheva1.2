import Link from "next/link";
import { AppShell, SurfaceCard } from "../../../components/shell/app-shell";
import { ConfrontationRowItem } from "./confrontation-row";
import { fetchApi } from "../../../lib/api";
import { formatNumber, formatPercent } from "../../../lib/format";
import type { ConfrontationMethodsResponse, LeagueApiValue, LeagueQueryValue, MethodCode, ResultCode, SeriesCode } from "./types";

export const dynamic = "force-dynamic";

const LEAGUE_OPTIONS: Array<{ queryValue: LeagueQueryValue; apiValue: LeagueApiValue; label: string }> = [
  { queryValue: "gtleague", apiValue: "GT LEAGUE", label: "GT League" },
  { queryValue: "8minbattle", apiValue: "8MIN BATTLE", label: "8min Battle" },
  { queryValue: "6minvolta", apiValue: "6MIN VOLTA", label: "6min Volta" },
];

const METHOD_OPTIONS: MethodCode[] = ["T+", "E", "(2E)", "(2D)", "(2D+)", "(3D)", "(3D+)", "(4D)", "(4D+)"];
const SERIES_OPTIONS: SeriesCode[] = ["A", "B", "C", "D", "E", "F", "G"];
const DAYS_FILTER_OPTIONS = [7, 15, 21, 30, 45, 60] as const;
const SORT_OPTIONS = ["default", "confronto-asc", "confronto-desc", "apx-desc", "apx-asc"] as const;
type SortOption = (typeof SORT_OPTIONS)[number];

function buildPageHref(
  league: LeagueQueryValue,
  method: MethodCode,
  series?: SeriesCode,
  confrontationQuery?: string,
  apxMin?: number,
  sort?: SortOption,
  days?: number,
) {
  const params = new URLSearchParams({ league, method });

  if (league === "gtleague" && series) {
    params.set("series", series);
  }

  if (confrontationQuery) {
    params.set("confronto", confrontationQuery);
  }

  if (apxMin && apxMin > 0) {
    params.set("apxMin", String(apxMin));
  }

  if (sort && sort !== "default") {
    params.set("sort", sort);
  }

  if (days) {
    params.set("days", String(days));
  }

  return `/methods/confrontos?${params.toString()}`;
}

async function getConfrontationMethods(leagueType: LeagueApiValue, methodCode: MethodCode, series?: SeriesCode, days?: number) {
  const query = new URLSearchParams({ leagueType, methodCode });

  if (leagueType === "GT LEAGUE" && series) {
    query.set("series", series);
  }

  if (days) {
    query.set("days", String(days));
  }

  query.set("includeHistory", "0");

  return fetchApi<ConfrontationMethodsResponse>(`/methods/confrontations?${query.toString()}`, {
    revalidate: 30,
  });
}

export default async function MethodsConfrontosPage({
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
      : "(2D)";
  const selectedSeries =
    selectedLeagueQuery === "gtleague" &&
    typeof params?.series === "string" &&
    SERIES_OPTIONS.includes(params.series.toUpperCase() as SeriesCode)
      ? (params.series.toUpperCase() as SeriesCode)
      : undefined;
  const selectedConfrontationQuery = typeof params?.confronto === "string" ? params.confronto.trim() : "";
  const selectedApxMinRaw = typeof params?.apxMin === "string" ? Number(params.apxMin) : 0;
  const selectedApxMin = Number.isFinite(selectedApxMinRaw) && selectedApxMinRaw > 0 ? selectedApxMinRaw : 0;
  const selectedDaysRaw = typeof params?.days === "string" ? Number(params.days) : 30;
  const selectedDays = DAYS_FILTER_OPTIONS.includes(selectedDaysRaw as (typeof DAYS_FILTER_OPTIONS)[number]) ? selectedDaysRaw : 30;
  const selectedSort =
    typeof params?.sort === "string" && SORT_OPTIONS.includes(params.sort as SortOption)
      ? (params.sort as SortOption)
      : "default";
  const selectedLeague = LEAGUE_OPTIONS.find((item) => item.queryValue === selectedLeagueQuery) ?? LEAGUE_OPTIONS[0];
  const data = await getConfrontationMethods(selectedLeague.apiValue, selectedMethod, selectedSeries, selectedDays);
  const normalizedConfrontationQuery = selectedConfrontationQuery.toLocaleLowerCase("pt-BR");
  const filteredRows =
    data?.rows.filter((row) => {
      const matchesConfrontation = normalizedConfrontationQuery
        ? row.confrontationLabel.toLocaleLowerCase("pt-BR").includes(normalizedConfrontationQuery)
        : true;

      return matchesConfrontation && row.apx >= selectedApxMin;
    }) ?? [];
  const sortedRows = [...filteredRows].sort((left, right) => {
    switch (selectedSort) {
      case "confronto-asc":
        return left.confrontationLabel.localeCompare(right.confrontationLabel, "pt-BR", { sensitivity: "base" });
      case "confronto-desc":
        return right.confrontationLabel.localeCompare(left.confrontationLabel, "pt-BR", { sensitivity: "base" });
      case "apx-asc":
        return left.apx - right.apx || left.confrontationLabel.localeCompare(right.confrontationLabel, "pt-BR", { sensitivity: "base" });
      case "apx-desc":
        return right.apx - left.apx || left.confrontationLabel.localeCompare(right.confrontationLabel, "pt-BR", { sensitivity: "base" });
      default:
        return 0;
    }
  });

  return (
    <AppShell
      eyebrow="Metodos"
      title="Metodos Confrontos"
      description="Leitura dos metodos por confronto jogador x jogador, com ocorrencias, distribuicao W/D/L e historico expandivel."
    >
      <SurfaceCard>
        <p className="text-xs uppercase tracking-[0.2em] text-brand-strong">Ligas</p>
        <h2 className="mt-3 font-display text-3xl text-ink">Base de Confrontos</h2>
        <p className="mt-3 max-w-3xl text-sm leading-7 text-ink/68">
          Selecione a liga e o metodo para consolidar todas as ocorrencias por confronto e abrir o historico completo de cada gatilho.
        </p>

        <div className="mt-6 flex flex-wrap gap-3">
          {LEAGUE_OPTIONS.map((league) => (
            <Link
              key={league.queryValue}
              href={buildPageHref(league.queryValue, selectedMethod, undefined, selectedConfrontationQuery, selectedApxMin, selectedSort, selectedDays)}
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
                  href={buildPageHref(
                    selectedLeague.queryValue,
                    selectedMethod,
                    selectedSeries === series ? undefined : series,
                    selectedConfrontationQuery,
                    selectedApxMin,
                    selectedSort,
                    selectedDays,
                  )}
                  className={`inline-flex rounded-full border px-5 py-3 text-sm font-semibold transition ${selectedSeries === series ? "border-transparent bg-[#20352e] text-white" : "border-ink/10 bg-white/75 text-ink/70 hover:border-ink/20 hover:text-ink"}`}
                >
                  {`Serie ${series}`}
                </Link>
              ))}
            </div>
          </div>
        ) : null}

        <div className="mt-6 flex flex-wrap gap-3">
          {METHOD_OPTIONS.map((method) => (
            <Link
              key={method}
              href={buildPageHref(selectedLeague.queryValue, method, selectedSeries, selectedConfrontationQuery, selectedApxMin, selectedSort, selectedDays)}
              className={`inline-flex rounded-full border px-4 py-2 text-sm font-semibold transition ${selectedMethod === method ? "border-transparent bg-[#20352e] text-white" : "border-ink/10 bg-white/75 text-ink/70 hover:border-ink/20 hover:text-ink"}`}
            >
              {method}
            </Link>
          ))}
        </div>

        <div className="mt-6">
          <p className="text-xs uppercase tracking-[0.2em] text-brand-strong">Periodo</p>
          <div className="mt-3 flex flex-wrap gap-3">
            {DAYS_FILTER_OPTIONS.map((days) => (
              <Link
                key={days}
                href={buildPageHref(selectedLeague.queryValue, selectedMethod, selectedSeries, selectedConfrontationQuery, selectedApxMin, selectedSort, days)}
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
            <p className="text-xs uppercase tracking-[0.2em] text-brand-strong">Metodo selecionado</p>
            <h3 className="mt-2 font-display text-3xl text-ink">{selectedMethod}</h3>
            <p className="mt-2 text-sm text-ink/65">Liga: {selectedLeague.label}</p>
            {selectedLeague.queryValue === "gtleague" ? (
              <p className="mt-1 text-sm text-ink/55">Serie: {selectedSeries ? `Serie ${selectedSeries}` : "todas"}</p>
            ) : null}
            <p className="mt-1 text-sm text-ink/55">Periodo: ultimos {selectedDays} dias</p>
            {selectedMethod === "T+" ? (
              <p className="mt-1 max-w-2xl text-sm text-ink/55">
                O metodo conta o jogo atual quando jogador1 chega nele apos perder o ultimo confronto contra jogador2, no padrao L.
              </p>
            ) : null}
            {selectedMethod === "E" ? (
              <p className="mt-1 max-w-2xl text-sm text-ink/55">
                O metodo conta o jogo atual quando jogador1 chega nele apos empatar o ultimo confronto contra jogador2, no padrao D.
              </p>
            ) : null}
            {selectedMethod === "(2D)" ? (
              <p className="mt-1 max-w-2xl text-sm text-ink/55">
                O metodo conta o jogo atual quando jogador1 chega nele apos 2 jogos sem ganhar contra jogador2, com exatamente 1 derrota e 1 empate nos 2 jogos anteriores, em qualquer ordem.
              </p>
            ) : null}
            {selectedMethod === "(2D+)" ? (
              <p className="mt-1 max-w-2xl text-sm text-ink/55">
                O metodo conta o jogo atual quando jogador1 chega nele apos 2 derrotas seguidas contra jogador2 nos 2 jogos anteriores, no padrao L L.
              </p>
            ) : null}
            {selectedMethod === "(3D)" ? (
              <p className="mt-1 max-w-2xl text-sm text-ink/55">
                O metodo conta o jogo atual quando os 3 jogos anteriores contra jogador2 sao sem vencer, com pelo menos 1 derrota nessa sequencia.
              </p>
            ) : null}
            {selectedMethod === "(4D)" ? (
              <p className="mt-1 max-w-2xl text-sm text-ink/55">
                O metodo conta o jogo atual quando os 4 jogos anteriores contra jogador2 sao sem vencer, com pelo menos 1 derrota nessa sequencia.
              </p>
            ) : null}
          </div>
          <p className="text-xs uppercase tracking-[0.16em] text-ink/48">{formatNumber(sortedRows.length)} confronto(s) com ocorrencia</p>
        </div>

        {!data ? (
          <div className="mt-6 rounded-[1.2rem] border border-dashed border-ink/15 bg-white/45 px-5 py-8 text-sm text-ink/60">
            Nao foi possivel carregar a leitura de confrontos agora.
          </div>
        ) : sortedRows.length ? (
          <div className="mt-6 overflow-hidden rounded-[1.15rem] border border-ink/10 bg-white/72">
            <div className="hidden grid-cols-[1.35fr_0.55fr_0.45fr_0.45fr_0.45fr_0.6fr_0.8fr] gap-3 border-b border-ink/10 bg-white/70 px-4 py-3 text-[11px] uppercase tracking-[0.16em] text-brand-strong md:grid">
              <div>
                <span>Confronto</span>
                <form className="mt-2">
                  <input
                    name="confronto"
                    defaultValue={selectedConfrontationQuery}
                    placeholder="Filtrar confronto"
                    className="w-full rounded-full border border-ink/10 bg-white/90 px-3 py-2 text-[11px] normal-case tracking-normal text-ink outline-none placeholder:text-ink/35"
                  />
                  <input type="hidden" name="league" value={selectedLeague.queryValue} />
                  <input type="hidden" name="method" value={selectedMethod} />
                  {selectedSeries ? <input type="hidden" name="series" value={selectedSeries} /> : null}
                  {selectedApxMin ? <input type="hidden" name="apxMin" value={selectedApxMin} /> : null}
                  {selectedSort !== "default" ? <input type="hidden" name="sort" value={selectedSort} /> : null}
                  <input type="hidden" name="days" value={selectedDays} />
                </form>
                <div className="mt-2 flex gap-2 text-[10px] normal-case tracking-normal">
                  <Link
                    href={buildPageHref(selectedLeague.queryValue, selectedMethod, selectedSeries, selectedConfrontationQuery, selectedApxMin, "confronto-asc", selectedDays)}
                    className={selectedSort === "confronto-asc" ? "font-semibold text-ink" : "text-ink/55 hover:text-ink"}
                  >
                    A-Z
                  </Link>
                  <Link
                    href={buildPageHref(selectedLeague.queryValue, selectedMethod, selectedSeries, selectedConfrontationQuery, selectedApxMin, "confronto-desc", selectedDays)}
                    className={selectedSort === "confronto-desc" ? "font-semibold text-ink" : "text-ink/55 hover:text-ink"}
                  >
                    Z-A
                  </Link>
                </div>
              </div>
              <span>Ocorr.</span>
              <span>W</span>
              <span>D</span>
              <span>L</span>
              <div>
                <span>Apx</span>
                <form className="mt-2">
                  <input
                    name="apxMin"
                    type="number"
                    min="0"
                    max="100"
                    step="1"
                    inputMode="numeric"
                    defaultValue={selectedApxMin ? String(selectedApxMin) : ""}
                    placeholder="Min %"
                    className="w-full rounded-full border border-ink/10 bg-white/90 px-3 py-2 text-[11px] normal-case tracking-normal text-ink outline-none placeholder:text-ink/35"
                  />
                  <input type="hidden" name="league" value={selectedLeague.queryValue} />
                  <input type="hidden" name="method" value={selectedMethod} />
                  {selectedSeries ? <input type="hidden" name="series" value={selectedSeries} /> : null}
                  {selectedConfrontationQuery ? <input type="hidden" name="confronto" value={selectedConfrontationQuery} /> : null}
                  {selectedSort !== "default" ? <input type="hidden" name="sort" value={selectedSort} /> : null}
                  <input type="hidden" name="days" value={selectedDays} />
                </form>
                <div className="mt-2 flex gap-2 text-[10px] normal-case tracking-normal">
                  <Link
                    href={buildPageHref(selectedLeague.queryValue, selectedMethod, selectedSeries, selectedConfrontationQuery, selectedApxMin, "apx-desc", selectedDays)}
                    className={selectedSort === "apx-desc" ? "font-semibold text-ink" : "text-ink/55 hover:text-ink"}
                  >
                    Maior-menor
                  </Link>
                  <Link
                    href={buildPageHref(selectedLeague.queryValue, selectedMethod, selectedSeries, selectedConfrontationQuery, selectedApxMin, "apx-asc", selectedDays)}
                    className={selectedSort === "apx-asc" ? "font-semibold text-ink" : "text-ink/55 hover:text-ink"}
                  >
                    Menor-maior
                  </Link>
                </div>
              </div>
              <span className="text-right">Historico</span>
            </div>
            <div>
              {sortedRows.map((row) => (
                <ConfrontationRowItem
                  key={row.confrontationKey}
                  row={row}
                  leagueType={selectedLeague.apiValue}
                  methodCode={selectedMethod}
                  series={selectedSeries}
                  days={selectedDays}
                />
              ))}
            </div>
          </div>
        ) : (
          <div className="mt-6 rounded-[1.2rem] border border-dashed border-ink/15 bg-white/45 px-5 py-8 text-sm text-ink/60">
            Nenhuma ocorrencia encontrada para {selectedMethod} em {selectedLeague.label}
            {selectedSeries ? ` na Serie ${selectedSeries}` : ""}
            {selectedDays ? ` nos ultimos ${selectedDays} dias` : ""}
            {selectedConfrontationQuery ? ` com filtro de confronto "${selectedConfrontationQuery}"` : ""}
            {selectedApxMin ? ` e Apx minimo de ${selectedApxMin}%.` : "."}
          </div>
        )}
      </SurfaceCard>
    </AppShell>
  );
}
