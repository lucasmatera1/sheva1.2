"use client";

import clsx from "clsx";
import { useDeferredValue, useEffect, useMemo, useState } from "react";
import type {
  PortalGTRaioXDayRow,
  PortalGTRaioXResponse,
  PortalGTRaioXRow,
} from "@/lib/portal-api";

const GT_SERIES = ["ALL", "A", "B", "C", "D", "E", "F", "G"] as const;
const HIT_RATE_FILTERS = [50, 60, 70, 80] as const;

function matchesHitRateBand(hitRate: number, threshold: (typeof HIT_RATE_FILTERS)[number]) {
  if (threshold === 80) {
    return hitRate >= 80;
  }

  return hitRate >= threshold && hitRate < threshold + 10;
}

function SearchIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="none" aria-hidden="true" className="h-4 w-4">
      <circle cx="9" cy="9" r="4.75" stroke="currentColor" strokeWidth="1.45" />
      <path
        d="m12.5 12.5 3.25 3.25"
        stroke="currentColor"
        strokeWidth="1.45"
        strokeLinecap="round"
      />
    </svg>
  );
}

function MetricCard({
  label,
  value,
  helper,
}: {
  label: string;
  value: string;
  helper: string;
}) {
  return (
    <article className="rounded-[0.8rem] border border-white/8 bg-black/14 px-4 py-4">
      <div className="text-[11px] uppercase tracking-[0.22em] text-sage">
        {label}
      </div>
      <div className="mt-3 text-2xl font-semibold text-ivory">{value}</div>
      <div className="mt-2 text-xs leading-6 text-mist">{helper}</div>
    </article>
  );
}

function ResultBadge({
  resultCode,
  playerOneGoals,
  playerTwoGoals,
  scoreLabel,
  localTimeLabel,
}: {
  resultCode: "1" | "2" | "E";
  playerOneGoals: number;
  playerTwoGoals: number;
  scoreLabel: string;
  localTimeLabel: string;
}) {
  return (
    <div
      title={`${localTimeLabel} | ${scoreLabel}`}
      className={clsx(
        "flex min-w-[2.35rem] flex-col items-center justify-center rounded-[0.55rem] border px-1.5 py-1.5 text-center",
        resultCode === "1" &&
          "border-emerald-300/18 bg-emerald-400/10 text-emerald-100",
        resultCode === "E" &&
          "border-amber-300/18 bg-amber-300/10 text-amber-100",
        resultCode === "2" &&
          "border-rose-300/18 bg-rose-400/10 text-rose-100",
      )}
    >
      <span className="text-[9px] font-medium leading-none opacity-80">
        {playerOneGoals}
      </span>
      <span className="mt-1 text-[12px] font-semibold leading-none">
        {resultCode}
      </span>
      <span className="mt-1 text-[9px] font-medium leading-none opacity-80">
        {playerTwoGoals}
      </span>
    </div>
  );
}

function isQualifyingDay(day: PortalGTRaioXDayRow) {
  return (
    (day.playerOneWins === 2 || day.playerOneWins === 3) &&
    (day.playerTwoWins === 2 || day.playerTwoWins === 3)
  );
}

function formatSeriesLabel(series: string | null) {
  return series ? `Serie ${series}` : "Serie --";
}

function XRayDayCard({
  day,
  playerOneName,
  playerTwoName,
}: {
  day: PortalGTRaioXDayRow;
  playerOneName: string;
  playerTwoName: string;
}) {
  const qualifies = isQualifyingDay(day);

  return (
    <div
      className={clsx(
        "rounded-[0.75rem] border px-3 py-3",
        qualifies
          ? "border-emerald-300/18 bg-emerald-400/10"
          : "border-white/8 bg-black/16",
      )}
    >
      <div className="flex items-center justify-between gap-3">
        <div className="text-[11px] uppercase tracking-[0.18em] text-sage">
          {day.dayLabel}
        </div>
        <div
          className={clsx(
            "inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.16em]",
            qualifies
              ? "bg-emerald-300/18 text-emerald-100"
              : "bg-white/8 text-mist",
          )}
        >
          {qualifies ? "65%+" : "Off"}
        </div>
      </div>

      <div className="mt-4 grid grid-cols-[1fr_auto_1fr] items-end gap-2">
        <div className="text-left">
          <div className="text-[10px] uppercase tracking-[0.18em] text-sage">
            {playerOneName}
          </div>
          <div className="mt-1 text-2xl font-semibold tabular-nums text-ivory">
            {day.playerOneWins}
          </div>
        </div>

        <div className="pb-1 text-center text-xs uppercase tracking-[0.22em] text-sage">
          <div>D {day.draws}</div>
          <div className="mt-1">T {day.totalGames}</div>
        </div>

        <div className="text-right">
          <div className="text-[10px] uppercase tracking-[0.18em] text-sage">
            {playerTwoName}
          </div>
          <div className="mt-1 text-2xl font-semibold tabular-nums text-ivory">
            {day.playerTwoWins}
          </div>
        </div>
      </div>

      <div className="mt-4 flex flex-wrap gap-1.5">
        {day.history.map((match) => (
          <ResultBadge
            key={match.matchId}
            resultCode={match.resultCode}
            playerOneGoals={match.playerOneGoals}
            playerTwoGoals={match.playerTwoGoals}
            scoreLabel={match.scoreLabel}
            localTimeLabel={match.localTimeLabel}
          />
        ))}
      </div>
    </div>
  );
}

function findInitialRow(rows: PortalGTRaioXRow[]) {
  return rows[0]?.confrontationKey ?? null;
}

export function GTRaioXBoard({
  xray,
}: {
  xray: PortalGTRaioXResponse | null;
}) {
  const [resolvedXray, setResolvedXray] = useState<PortalGTRaioXResponse | null>(
    xray,
  );
  const [isLoading, setIsLoading] = useState(!xray);
  const [loadFailed, setLoadFailed] = useState(false);
  const [selectedSeries, setSelectedSeries] =
    useState<(typeof GT_SERIES)[number]>("ALL");
  const [selectedHitRateFilters, setSelectedHitRateFilters] = useState<number[]>(
    [...HIT_RATE_FILTERS],
  );
  const [searchQuery, setSearchQuery] = useState("");
  const deferredSearch = useDeferredValue(searchQuery);
  const [selectedRowKey, setSelectedRowKey] = useState<string | null>(
    findInitialRow(xray?.rows ?? []),
  );

  useEffect(() => {
    setResolvedXray(xray);
    setIsLoading(!xray);
    setLoadFailed(false);
    setSelectedRowKey(findInitialRow(xray?.rows ?? []));
  }, [xray]);

  useEffect(() => {
    if (resolvedXray) {
      return;
    }

    let isActive = true;
    const controller = new AbortController();

    const loadXray = async () => {
      setIsLoading(true);
      setLoadFailed(false);

      try {
        const response = await fetch("/api/disparidade/gt-xray", {
          cache: "no-store",
          signal: controller.signal,
        });

        if (!response.ok) {
          throw new Error("Raio X indisponivel");
        }

        const payload = (await response.json()) as PortalGTRaioXResponse;

        if (isActive) {
          setResolvedXray(payload);
          setSelectedRowKey(findInitialRow(payload.rows ?? []));
        }
      } catch {
        if (isActive) {
          setLoadFailed(true);
        }
      } finally {
        if (isActive) {
          setIsLoading(false);
        }
      }
    };

    void loadXray();

    return () => {
      isActive = false;
      controller.abort();
    };
  }, [resolvedXray]);

  const filteredRows = useMemo(() => {
    const search = deferredSearch.trim().toLowerCase();

    return (resolvedXray?.rows ?? []).filter((row) => {
      if (selectedSeries !== "ALL" && row.series !== selectedSeries) {
        return false;
      }

      if (
        selectedHitRateFilters.length > 0 &&
        !selectedHitRateFilters.some((threshold) =>
          matchesHitRateBand(row.hitRate, threshold as (typeof HIT_RATE_FILTERS)[number]),
        )
      ) {
        return false;
      }

      if (!search) {
        return true;
      }

      return (
        row.confrontationLabel.toLowerCase().includes(search) ||
        row.playerOneName.toLowerCase().includes(search) ||
        row.playerTwoName.toLowerCase().includes(search) ||
        (row.series ?? "").toLowerCase().includes(search)
      );
    });
  }, [deferredSearch, resolvedXray?.rows, selectedHitRateFilters, selectedSeries]);

  useEffect(() => {
    if (filteredRows.length === 0) {
      setSelectedRowKey(null);
      return;
    }

    const stillExists = filteredRows.some(
      (row) => row.confrontationKey === selectedRowKey,
    );
    if (!stillExists) {
      setSelectedRowKey(filteredRows[0]?.confrontationKey ?? null);
    }
  }, [filteredRows, selectedRowKey]);

  const selectedRow = useMemo(
    () =>
      filteredRows.find((row) => row.confrontationKey === selectedRowKey) ??
      filteredRows[0] ??
      null,
    [filteredRows, selectedRowKey],
  );

  const activeSeriesSummary = useMemo(() => {
    if (selectedSeries === "ALL") {
      return resolvedXray?.seriesSummary ?? [];
    }

    return (resolvedXray?.seriesSummary ?? []).filter(
      (entry) => entry.series === selectedSeries,
    );
  }, [resolvedXray?.seriesSummary, selectedSeries]);

  const toggleHitRateFilter = (threshold: (typeof HIT_RATE_FILTERS)[number]) => {
    setSelectedHitRateFilters((current) => {
      if (current.includes(threshold)) {
        const next = current.filter((value) => value !== threshold);
        return next;
      }

      return [...current, threshold].sort((left, right) => left - right);
    });
  };

  return (
    <>
      <section className="glass-panel rounded-[0.9rem] px-6 py-6">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
          <div>
            <div className="text-xs uppercase tracking-[0.26em] text-sage">
              H2H Scanner
            </div>
            <h2 className="mt-2 font-display text-3xl text-ivory">
              Pares com equilibrio forte nos ultimos 10 dias
            </h2>
            <p className="mt-3 max-w-3xl text-sm leading-7 text-mist">
              O par entra no Raio X quando, nos 10 dias operacionais mais
              recentes entre os dois jogadores, ao menos 65% dos dias fecham com
              2 ou 3 vitorias para cada lado.
            </p>
          </div>

          <div className="grid gap-3 sm:grid-cols-2 xl:min-w-[26rem] xl:max-w-[30rem] xl:grid-cols-4">
            <MetricCard
              label="Pares mapeados"
              value={String(resolvedXray?.totalMappedPairs ?? 0)}
              helper={`Pares a partir de ${resolvedXray?.scanMinHitRate ?? 50}%.`}
            />
            <MetricCard
              label="Pares 65%+"
              value={String(resolvedXray?.totalEligiblePairs ?? 0)}
              helper="Corte original principal do Raio X."
            />
            <MetricCard
              label="Pares avaliados"
              value={String(resolvedXray?.totalPairsEvaluated ?? 0)}
              helper="Somente pares com 10 dias completos."
            />
            <MetricCard
              label="Janela"
              value={`${resolvedXray?.minHitRate ?? 65}%`}
              helper={`${resolvedXray?.requiredDays ?? 10} dias em ${resolvedXray?.lookbackDays ?? 45} dias.`}
            />
          </div>
        </div>

        <div className="mt-6 flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
          <div className="flex flex-col gap-4">
            <div className="flex flex-wrap gap-3">
              {GT_SERIES.map((series) => {
                const isActive = selectedSeries === series;
                const seriesCount =
                  series === "ALL"
                    ? filteredRows.length
                    : activeSeriesSummary.find((entry) => entry.series === series)
                        ?.pairs ?? 0;

                return (
                  <button
                    key={series}
                    type="button"
                    onClick={() => setSelectedSeries(series)}
                    className={clsx(
                      "inline-flex items-center gap-2 rounded-[0.75rem] border px-4 py-2.5 text-sm font-semibold transition",
                      isActive
                        ? "border-ivory/70 bg-ivory text-forest"
                        : "border-white/14 bg-black/12 text-ivory hover:border-white/22 hover:bg-white/6",
                    )}
                  >
                    <span>{series === "ALL" ? "Todas" : `Serie ${series}`}</span>
                    <span
                      className={clsx(
                        "inline-flex h-5 min-w-5 items-center justify-center rounded-full px-1.5 text-[10px] font-bold",
                        isActive
                          ? "bg-forest/10 text-forest"
                          : seriesCount > 0
                            ? "bg-emerald-400/12 text-emerald-100"
                            : "bg-white/8 text-mist",
                      )}
                    >
                      {seriesCount}
                    </span>
                  </button>
                );
              })}
            </div>

            <div className="flex flex-wrap gap-3">
              {HIT_RATE_FILTERS.map((threshold) => {
                const isActive = selectedHitRateFilters.includes(threshold);
                const label = threshold === 80 ? "80%+" : `${threshold}%`;

                return (
                  <button
                    key={threshold}
                    type="button"
                    onClick={() => toggleHitRateFilter(threshold)}
                    className={clsx(
                      "inline-flex items-center gap-2 rounded-[0.75rem] border px-4 py-2.5 text-sm font-semibold transition",
                      isActive
                        ? "border-emerald-300/35 bg-emerald-400/12 text-emerald-100"
                        : "border-white/14 bg-black/12 text-mist hover:border-white/22 hover:bg-white/6 hover:text-ivory",
                    )}
                  >
                    <span>{label}</span>
                  </button>
                );
              })}
            </div>
          </div>

          <label className="relative block w-full max-w-md">
            <span className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-mist/60">
              <SearchIcon />
            </span>
            <input
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              placeholder="Buscar confronto ou jogador"
              className="w-full rounded-[0.8rem] border border-white/10 bg-black/18 py-3 pl-11 pr-4 text-sm text-ivory outline-none transition placeholder:text-mist/45 focus:border-white/18 focus:bg-black/22"
            />
          </label>
        </div>
      </section>

      {isLoading && !resolvedXray ? (
        <section className="glass-panel rounded-[0.9rem] px-6 py-8">
          <div className="rounded-[0.8rem] border border-dashed border-white/10 bg-black/10 px-5 py-10 text-center text-sm text-mist">
            Carregando o Raio X da GT League...
          </div>
        </section>
      ) : loadFailed && !resolvedXray ? (
        <section className="glass-panel rounded-[0.9rem] px-6 py-8">
          <div className="rounded-[0.8rem] border border-dashed border-white/10 bg-black/10 px-5 py-10 text-center text-sm text-mist">
            Nao foi possivel carregar o Raio X da GT League agora.
          </div>
        </section>
      ) : filteredRows.length === 0 ? (
        <section className="glass-panel rounded-[0.9rem] px-6 py-8">
          <div className="rounded-[0.8rem] border border-dashed border-white/10 bg-black/10 px-5 py-10 text-center text-sm text-mist">
            Nenhum par atende ao Raio X para os filtros atuais.
          </div>
        </section>
      ) : (
        <section className="grid gap-6 xl:grid-cols-[minmax(0,0.82fr)_minmax(0,1.18fr)]">
          <article className="glass-panel rounded-[0.9rem] px-5 py-5">
            <div className="flex items-center justify-between gap-3 border-b border-white/8 pb-4">
              <div>
                <div className="text-xs uppercase tracking-[0.24em] text-sage">
                  Lista elegivel
                </div>
                <h3 className="mt-2 text-lg font-semibold text-ivory">
                  Pares encontrados
                </h3>
              </div>
              <div className="text-xs uppercase tracking-[0.22em] text-sage">
                {filteredRows.length} linha(s)
              </div>
            </div>

            <div className="mt-5 overflow-hidden rounded-[0.8rem] border border-white/8">
              <table className="min-w-full divide-y divide-white/8 text-sm">
                <thead className="bg-white/5 text-[11px] uppercase tracking-[0.2em] text-sage">
                  <tr>
                    <th className="px-4 py-3 text-left font-medium">Confronto</th>
                    <th className="px-3 py-3 text-center font-medium">Serie</th>
                    <th className="px-3 py-3 text-center font-medium">Taxa</th>
                    <th className="px-3 py-3 text-center font-medium">Dias</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/8 bg-black/10">
                  {filteredRows.map((row) => {
                    const isActive =
                      row.confrontationKey === selectedRow?.confrontationKey;

                    return (
                      <tr
                        key={row.confrontationKey}
                        onClick={() => setSelectedRowKey(row.confrontationKey)}
                        className={clsx(
                          "cursor-pointer transition",
                          isActive ? "bg-white/[0.06]" : "hover:bg-white/[0.03]",
                        )}
                      >
                        <td className="px-4 py-4">
                          <div className="font-medium text-ivory">
                            {row.confrontationLabel}
                          </div>
                          <div className="mt-1 text-xs text-mist/70">
                            {row.qualifyingDays}/{row.sampleDays} dias elegiveis
                          </div>
                        </td>
                        <td className="px-3 py-4 text-center text-mist">
                          {row.series ?? "--"}
                        </td>
                        <td className="px-3 py-4 text-center font-semibold tabular-nums text-ivory">
                          {row.hitRate.toFixed(2)}%
                        </td>
                        <td className="px-3 py-4 text-center font-semibold tabular-nums text-emerald-100">
                          {row.sampleDays}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </article>

          <article className="glass-panel rounded-[0.9rem] px-5 py-5">
            {!selectedRow ? null : (
              <>
                <div className="flex flex-col gap-4 border-b border-white/8 pb-5 lg:flex-row lg:items-end lg:justify-between">
                  <div>
                    <div className="text-xs uppercase tracking-[0.24em] text-sage">
                      Pareamento ativo
                    </div>
                    <h3 className="mt-2 text-2xl font-semibold text-ivory">
                      {selectedRow.confrontationLabel}
                    </h3>
                    <p className="mt-2 text-sm text-mist">
                      {formatSeriesLabel(selectedRow.series)} •{" "}
                      {selectedRow.qualifyingDays}/{selectedRow.sampleDays} dias
                      bateram a leitura • {selectedRow.hitRate.toFixed(2)}%
                    </p>
                  </div>

                  <div className="grid grid-cols-3 gap-3 text-center">
                    <div className="rounded-[0.75rem] border border-white/8 bg-black/14 px-4 py-3">
                      <div className="text-[11px] uppercase tracking-[0.18em] text-sage">
                        {selectedRow.playerOneName}
                      </div>
                      <div className="mt-2 text-xl font-semibold text-ivory">
                        {selectedRow.recentDays.reduce(
                          (sum, day) => sum + day.playerOneWins,
                          0,
                        )}
                      </div>
                    </div>
                    <div className="rounded-[0.75rem] border border-white/8 bg-black/14 px-4 py-3">
                      <div className="text-[11px] uppercase tracking-[0.18em] text-sage">
                        Empates
                      </div>
                      <div className="mt-2 text-xl font-semibold text-ivory">
                        {selectedRow.recentDays.reduce(
                          (sum, day) => sum + day.draws,
                          0,
                        )}
                      </div>
                    </div>
                    <div className="rounded-[0.75rem] border border-white/8 bg-black/14 px-4 py-3">
                      <div className="text-[11px] uppercase tracking-[0.18em] text-sage">
                        {selectedRow.playerTwoName}
                      </div>
                      <div className="mt-2 text-xl font-semibold text-ivory">
                        {selectedRow.recentDays.reduce(
                          (sum, day) => sum + day.playerTwoWins,
                          0,
                        )}
                      </div>
                    </div>
                  </div>
                </div>

                <div className="mt-5 grid gap-3 md:grid-cols-2 2xl:grid-cols-5">
                  {selectedRow.recentDays.map((day) => (
                    <XRayDayCard
                      key={`${selectedRow.confrontationKey}-${day.dayKey}`}
                      day={day}
                      playerOneName={selectedRow.playerOneName}
                      playerTwoName={selectedRow.playerTwoName}
                    />
                  ))}
                </div>

                <div className="mt-6 overflow-hidden rounded-[0.8rem] border border-white/8">
                  <table className="min-w-full divide-y divide-white/8 text-sm">
                    <thead className="bg-white/5 text-[11px] uppercase tracking-[0.2em] text-sage">
                      <tr>
                        <th className="px-4 py-3 text-left font-medium">Data</th>
                        <th className="px-3 py-3 text-center font-medium">
                          {selectedRow.playerOneName}
                        </th>
                        <th className="px-3 py-3 text-center font-medium">E</th>
                        <th className="px-3 py-3 text-center font-medium">
                          {selectedRow.playerTwoName}
                        </th>
                        <th className="w-[1.25rem] px-0 py-3 text-center font-medium text-white/15">
                          |
                        </th>
                        <th className="px-4 py-3 text-left font-medium">History</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-white/8 bg-black/10 text-mist">
                      {selectedRow.recentDays.map((day) => (
                        <tr key={`${selectedRow.confrontationKey}-${day.dayKey}`}>
                          <td className="px-4 py-4">
                            <div className="font-medium text-ivory">
                              {day.dayLabel}
                            </div>
                            <div className="mt-1 text-xs uppercase tracking-[0.18em] text-sage">
                              {formatSeriesLabel(day.series)}
                            </div>
                          </td>
                          <td className="px-3 py-4 text-center">
                            <span
                              className={clsx(
                                "inline-flex min-w-[3rem] items-center justify-center rounded-[0.55rem] px-3 py-1.5 font-semibold tabular-nums",
                                isQualifyingDay(day)
                                  ? "bg-emerald-400/14 text-emerald-100"
                                  : "bg-white/6 text-ivory",
                              )}
                            >
                              {day.playerOneWins}
                            </span>
                          </td>
                          <td className="px-3 py-4 text-center">
                            <span className="inline-flex min-w-[3rem] items-center justify-center rounded-[0.55rem] bg-amber-300/12 px-3 py-1.5 font-semibold tabular-nums text-amber-100">
                              {day.draws}
                            </span>
                          </td>
                          <td className="px-3 py-4 text-center">
                            <span
                              className={clsx(
                                "inline-flex min-w-[3rem] items-center justify-center rounded-[0.55rem] px-3 py-1.5 font-semibold tabular-nums",
                                isQualifyingDay(day)
                                  ? "bg-emerald-400/14 text-emerald-100"
                                  : "bg-white/6 text-ivory",
                              )}
                            >
                              {day.playerTwoWins}
                            </span>
                          </td>
                          <td className="px-0 py-4 text-center text-white/15">|</td>
                          <td className="px-4 py-4">
                            <div className="flex flex-wrap gap-2">
                              {day.history.map((match) => (
                                <ResultBadge
                                  key={match.matchId}
                                  resultCode={match.resultCode}
                                  playerOneGoals={match.playerOneGoals}
                                  playerTwoGoals={match.playerTwoGoals}
                                  scoreLabel={match.scoreLabel}
                                  localTimeLabel={match.localTimeLabel}
                                />
                              ))}
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </article>
        </section>
      )}
    </>
  );
}
