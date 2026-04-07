"use client";

import clsx from "clsx";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { PortalGTLiveTableResponse } from "@/lib/portal-api";

const GT_SERIES = ["ALL", "A", "B", "C", "D", "E", "F", "G"] as const;
const GT_HISTORY_DAY_OPTIONS = [5, 10, 15, 30, 60] as const;
const GT_SCORELINE_SEPARATOR_AFTER = new Set([3, 9]);

function formatPercent(value: number) {
  return `${value.toFixed(2)}%`;
}

function HistoryChip({
  item,
}: {
  item: {
    result: "W" | "D" | "L";
    playerGoals: number;
    opponentGoals: number;
    localTimeLabel: string;
    scoreLabel: string;
    confrontationLabel: string;
  };
}) {
  const toneClass =
    item.result === "W"
      ? "portal-live-sequence-badge portal-live-sequence-badge--win"
      : item.result === "D"
        ? "portal-live-sequence-badge portal-live-sequence-badge--draw"
        : "portal-live-sequence-badge portal-live-sequence-badge--loss";

  return (
    <span
      title={`${item.localTimeLabel} | ${item.confrontationLabel} | ${item.scoreLabel} | ${item.result}`}
      className={clsx(
        "inline-grid h-[2.15rem] w-[1.55rem] shrink-0 cursor-help grid-rows-[0.72rem_1fr_0.72rem] items-center rounded-[0.45rem] border text-center transition-colors",
        toneClass,
      )}
    >
      <span className="text-[8.5px] font-medium leading-none tabular-nums text-ivory/88">
        {item.playerGoals}
      </span>
      <span className="text-[9.5px] font-semibold leading-none tracking-[0.08em]">
        {item.result}
      </span>
      <span className="text-[8.5px] font-medium leading-none tabular-nums text-ivory/72">
        {item.opponentGoals}
      </span>
    </span>
  );
}

function BttsBadge({ value, title }: { value: "S" | "N"; title?: string }) {
  return (
    <span
      title={title}
      className={clsx(
        "portal-gt-btts-badge inline-flex min-w-[1.7rem] cursor-help items-center justify-center rounded-[0.42rem] border px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.08em]",
        value === "S"
          ? "portal-gt-btts-badge--yes"
          : "portal-gt-btts-badge--no",
      )}
    >
      {value}
    </span>
  );
}

function ScorelineCell({ count, total }: { count: number; total: number }) {
  const rate = total > 0 ? (count / total) * 100 : 0;
  return (
    <div className="flex min-h-[2.25rem] min-w-[2.7rem] flex-col items-center justify-center rounded-[0.42rem] border border-white/7 bg-black/12 px-1 py-1 text-center">
      <span className="text-[12px] font-semibold leading-none tabular-nums text-ivory">
        {count}
      </span>
      <span className="mt-0.5 text-[8px] uppercase tracking-[0.08em] text-mist/60">
        {formatPercent(rate)}
      </span>
    </div>
  );
}

function SummaryCard({
  label,
  value,
  helper,
}: {
  label: string;
  value: string;
  helper: string;
}) {
  return (
    <article className="rounded-[0.72rem] border border-white/8 bg-black/14 px-3.5 py-3">
      <div className="text-[10px] uppercase tracking-[0.16em] text-sage">
        {label}
      </div>
      <div className="mt-2 text-[21px] font-semibold leading-none text-ivory">
        {value}
      </div>
      <div className="mt-2 text-[11px] leading-5 text-mist">{helper}</div>
    </article>
  );
}

function formatDateTimeCompact(iso: string) {
  try {
    return new Intl.DateTimeFormat("pt-BR", {
      dateStyle: "short",
      timeStyle: "short",
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}

export function GTLeagueLiveBoard({
  liveTable,
}: {
  liveTable: PortalGTLiveTableResponse | null;
}) {
  const normalizeHistoryDays = (value?: number | null) =>
    GT_HISTORY_DAY_OPTIONS.includes(
      value as (typeof GT_HISTORY_DAY_OPTIONS)[number],
    )
      ? (value as (typeof GT_HISTORY_DAY_OPTIONS)[number])
      : 30;
  const [resolvedLiveTable, setResolvedLiveTable] =
    useState<PortalGTLiveTableResponse | null>(liveTable);
  const [isLoading, setIsLoading] = useState(!liveTable);
  const [loadFailed, setLoadFailed] = useState(false);
  const [selectedSeries, setSelectedSeries] =
    useState<(typeof GT_SERIES)[number]>("ALL");
  const [selectedHistoryDays, setSelectedHistoryDays] = useState<
    (typeof GT_HISTORY_DAY_OPTIONS)[number]
  >(normalizeHistoryDays(liveTable?.historyDays));
  const [lastRefreshAt, setLastRefreshAt] = useState<number>(Date.now());
  const [secondsSinceRefresh, setSecondsSinceRefresh] = useState(0);
  const [consecutiveFailures, setConsecutiveFailures] = useState(0);
  const refreshInFlight = useRef(false);

  const STALE_THRESHOLD_SEC = 90;
  const POLL_INTERVAL_MS = 30_000;
  const RETRY_INTERVAL_MS = 10_000;

  useEffect(() => {
    setResolvedLiveTable(liveTable);
    setSelectedHistoryDays(normalizeHistoryDays(liveTable?.historyDays));
    setIsLoading(!liveTable);
    setLoadFailed(false);
    if (liveTable) {
      setLastRefreshAt(Date.now());
      setConsecutiveFailures(0);
    }
  }, [liveTable]);

  const doRefresh = useCallback(async () => {
    if (refreshInFlight.current) return;
    refreshInFlight.current = true;
    try {
      const response = await fetch(
        `/api/gt-league/live-table?historyDays=${selectedHistoryDays}&_t=${Date.now()}`,
        { cache: "no-store" },
      );
      if (!response.ok) {
        setConsecutiveFailures((f) => f + 1);
        return;
      }
      const payload = (await response.json()) as PortalGTLiveTableResponse;
      const prevGeneratedAt = resolvedLiveTable?.generatedAt;
      setResolvedLiveTable(payload);
      if (payload.generatedAt !== prevGeneratedAt) {
        setLastRefreshAt(Date.now());
      }
      if (payload.source === "stale" || payload.source === "backup-only") {
        setConsecutiveFailures((f) => Math.max(f, 1));
      } else {
        setConsecutiveFailures(0);
      }
    } catch {
      setConsecutiveFailures((f) => f + 1);
    } finally {
      refreshInFlight.current = false;
    }
  }, [selectedHistoryDays, resolvedLiveTable?.generatedAt]);

  // Auto-refresh: 30s normal, 10s when stale or failing
  useEffect(() => {
    const intervalMs =
      consecutiveFailures > 0 || secondsSinceRefresh >= STALE_THRESHOLD_SEC
        ? RETRY_INTERVAL_MS
        : POLL_INTERVAL_MS;
    const interval = setInterval(() => void doRefresh(), intervalMs);
    return () => clearInterval(interval);
  }, [doRefresh, consecutiveFailures, secondsSinceRefresh]);

  // Tick seconds since last real data change
  useEffect(() => {
    const tick = setInterval(() => {
      setSecondsSinceRefresh(Math.floor((Date.now() - lastRefreshAt) / 1000));
    }, 1000);
    return () => clearInterval(tick);
  }, [lastRefreshAt]);

  useEffect(() => {
    if (
      resolvedLiveTable &&
      normalizeHistoryDays(resolvedLiveTable.historyDays) ===
        selectedHistoryDays
    ) {
      return;
    }

    let isActive = true;
    const controller = new AbortController();

    const loadLiveTable = async () => {
      setIsLoading(true);
      setLoadFailed(false);

      try {
        const response = await fetch(
          `/api/gt-league/live-table?historyDays=${selectedHistoryDays}`,
          {
            cache: "no-store",
            signal: controller.signal,
          },
        );

        if (!response.ok) {
          throw new Error("GT League live table indisponivel");
        }

        const payload = (await response.json()) as PortalGTLiveTableResponse;

        if (isActive) {
          setResolvedLiveTable(payload);
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

    void loadLiveTable();

    return () => {
      isActive = false;
      controller.abort();
    };
  }, [resolvedLiveTable, selectedHistoryDays]);

  const filteredRows = useMemo(() => {
    return (resolvedLiveTable?.rows ?? []).filter((row) =>
      selectedSeries === "ALL" ? true : row.series === selectedSeries,
    );
  }, [resolvedLiveTable?.rows, selectedSeries]);

  const filteredUpcomingRows = useMemo(() => {
    return (resolvedLiveTable?.upcomingRows ?? []).filter((row) =>
      selectedSeries === "ALL" ? true : row.series === selectedSeries,
    );
  }, [resolvedLiveTable?.upcomingRows, selectedSeries]);

  type UnifiedRow = {
    key: string;
    timeLabel: string;
    timeIso: string;
    confrontationLabel: string;
    playerOneName: string;
    playerTwoName: string;
    series: string | null;
    status: "live" | "upcoming" | "finished";
    scoreLabel: string | null;
    totalMatches: number;
    resultTotals: {
      playerOneWins: number;
      draws: number;
      playerTwoWins: number;
    } | null;
    over05Count: number;
    over05Rate: number;
    bttsCount: number;
    bttsRate: number;
    avgBttsPerDay: number;
    playerOneScoredCount: number;
    playerOneScoredRate: number;
    playerTwoScoredCount: number;
    playerTwoScoredRate: number;
    recentHistory: Array<{
      value: "1" | "2" | "E";
      result: "W" | "D" | "L";
      playerGoals: number;
      opponentGoals: number;
      localTimeLabel: string;
      scoreLabel: string;
      confrontationLabel: string;
    }>;
    recentBttsHistory: Array<{
      value: "S" | "N";
      localTimeLabel: string;
      scoreLabel: string;
    }>;
    scorelineCounts: Record<string, number>;
  };

  const unifiedRows = useMemo<UnifiedRow[]>(() => {
    // Build a lookup from pairKey (normalized, order-independent) to the latest resolved row
    const analysisByPairKey = new Map<string, (typeof filteredRows)[number]>();
    for (const r of filteredRows) {
      analysisByPairKey.set(r.pairKey, r);
    }

    const upcoming: UnifiedRow[] = filteredUpcomingRows.map((r) => {
      const match = analysisByPairKey.get(r.pairKey);
      return {
        key: r.fixtureId,
        timeLabel: r.kickoffLabel,
        timeIso: r.kickoffIso,
        confrontationLabel: r.confrontationLabel,
        playerOneName: r.playerOneName,
        playerTwoName: r.playerTwoName,
        series: r.series,
        status: r.status,
        scoreLabel: match?.scoreLabel ?? null,
        totalMatches: match?.totalMatches ?? 0,
        resultTotals: match?.resultTotals ?? null,
        over05Count: match?.over05Count ?? 0,
        over05Rate: match?.over05Rate ?? 0,
        bttsCount: match?.bttsCount ?? 0,
        bttsRate: match?.bttsRate ?? 0,
        avgBttsPerDay: match?.avgBttsPerDay ?? 0,
        playerOneScoredCount: match?.playerOneScoredCount ?? 0,
        playerOneScoredRate: match?.playerOneScoredRate ?? 0,
        playerTwoScoredCount: match?.playerTwoScoredCount ?? 0,
        playerTwoScoredRate: match?.playerTwoScoredRate ?? 0,
        recentHistory: match?.recentHistory ?? [],
        recentBttsHistory: match?.recentBttsHistory ?? [],
        scorelineCounts: match?.scorelineCounts ?? {},
      };
    });
    return upcoming.sort(
      (a, b) => new Date(a.timeIso).getTime() - new Date(b.timeIso).getTime(),
    );
  }, [filteredUpcomingRows, filteredRows]);

  const scorelineColumns = resolvedLiveTable?.scorelines ?? [];

  return (
    <>
      <section className="glass-panel rounded-[0.9rem] px-5 py-5">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
          <div />

          <div className="grid gap-2.5 sm:grid-cols-2 xl:min-w-[26rem] xl:grid-cols-4">
            <SummaryCard
              label="Jogos do dia"
              value={String(filteredRows.length)}
              helper="Confrontos ja registrados no dia operacional atual."
            />
            <SummaryCard
              label="Historico H2H"
              value={`${selectedHistoryDays} dias`}
              helper="Janela usada para as metricas exibidas."
            />
            <SummaryCard
              label="Dia operacional"
              value={resolvedLiveTable?.dayLabel ?? "--"}
              helper="Recorte atual da GT consolidado no portal."
            />
            <SummaryCard
              label="Atualizado"
              value={
                resolvedLiveTable?.generatedAt
                  ? formatDateTimeCompact(resolvedLiveTable.generatedAt)
                  : "--"
              }
              helper={
                secondsSinceRefresh >= STALE_THRESHOLD_SEC
                  ? `⚠ Dados parados ha ${Math.floor(secondsSinceRefresh / 60)}min${secondsSinceRefresh >= 60 ? ` ${secondsSinceRefresh % 60}s` : ""}`
                  : `Atualizado ha ${secondsSinceRefresh}s`
              }
            />
          </div>
        </div>

        {(secondsSinceRefresh >= STALE_THRESHOLD_SEC ||
          resolvedLiveTable?.source === "stale" ||
          resolvedLiveTable?.source === "backup-only") && (
          <div className="mt-3 flex items-center gap-3 rounded-[0.72rem] border border-amber-500/30 bg-amber-500/10 px-4 py-2.5">
            <span className="text-[12px] font-medium text-amber-300">
              ⚠{" "}
              {resolvedLiveTable?.warning ||
                `Os dados estao sem atualizar ha ${Math.floor(secondsSinceRefresh / 60)} min. O backend pode estar offline ou o banco inacessivel.`}
              {consecutiveFailures > 0 &&
                ` (${consecutiveFailures} tentativa${consecutiveFailures > 1 ? "s" : ""} sem sucesso)`}
            </span>
            <button
              type="button"
              onClick={() => void doRefresh()}
              className="ml-auto shrink-0 rounded-lg border border-amber-500/40 bg-amber-500/20 px-3 py-1.5 text-[11px] font-semibold text-amber-200 transition hover:bg-amber-500/30"
            >
              Tentar agora
            </button>
          </div>
        )}

        <div className="mt-5 flex flex-wrap gap-2.5">
          {GT_HISTORY_DAY_OPTIONS.map((historyDays) => {
            const isActive = selectedHistoryDays === historyDays;

            return (
              <button
                key={historyDays}
                type="button"
                onClick={() => setSelectedHistoryDays(historyDays)}
                className={clsx(
                  "inline-flex items-center gap-2 rounded-[0.68rem] border px-3.5 py-2 text-[13px] font-semibold transition",
                  isActive
                    ? "border-ivory/70 bg-ivory text-forest"
                    : "border-white/14 bg-black/12 text-ivory hover:border-white/22 hover:bg-white/6",
                )}
              >
                <span>{historyDays} dias</span>
              </button>
            );
          })}
        </div>

        <div className="mt-3 flex flex-wrap gap-2.5">
          {GT_SERIES.map((series) => {
            const isActive = selectedSeries === series;
            const count =
              series === "ALL"
                ? (resolvedLiveTable?.rows.length ?? 0)
                : (resolvedLiveTable?.rows ?? []).filter(
                    (row) => row.series === series,
                  ).length;

            return (
              <button
                key={series}
                type="button"
                onClick={() => setSelectedSeries(series)}
                className={clsx(
                  "inline-flex items-center gap-2 rounded-[0.68rem] border px-3.5 py-2 text-[13px] font-semibold transition",
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
                      : count > 0
                        ? "bg-emerald-400/12 text-emerald-100"
                        : "bg-white/8 text-mist",
                  )}
                >
                  {count}
                </span>
              </button>
            );
          })}
        </div>
      </section>

      {isLoading && !resolvedLiveTable ? (
        <section className="glass-panel rounded-[0.9rem] px-6 py-8">
          <div className="rounded-[0.8rem] border border-dashed border-white/10 bg-black/10 px-5 py-10 text-center text-sm text-mist">
            Carregando a leitura do dia operacional da GT League...
          </div>
        </section>
      ) : loadFailed && !resolvedLiveTable ? (
        <section className="glass-panel rounded-[0.9rem] px-6 py-8">
          <div className="rounded-[0.8rem] border border-dashed border-white/10 bg-black/10 px-5 py-10 text-center text-sm text-mist">
            Nao foi possivel carregar a leitura do dia operacional da GT League
            agora.
          </div>
        </section>
      ) : unifiedRows.length === 0 ? (
        <section className="glass-panel rounded-[0.9rem] px-6 py-8">
          <div className="rounded-[0.8rem] border border-dashed border-white/10 bg-black/10 px-5 py-10 text-center text-sm text-mist">
            Nenhum confronto da GT League foi registrado no dia operacional
            atual.
          </div>
        </section>
      ) : (
        <section className="glass-panel overflow-hidden rounded-[0.9rem] px-0 py-0">
          <div className="overflow-x-auto">
            <table className="min-w-[1180px] divide-y divide-white/8 text-[12px]">
              <thead className="bg-white/5 text-[10px] uppercase tracking-[0.15em] text-sage">
                <tr>
                  <th className="portal-sticky-header sticky left-0 z-20 w-[15.75rem] px-3 py-2.5 text-left font-medium">
                    Jogo
                  </th>
                  <th className="portal-sticky-header sticky left-[15.75rem] z-20 w-[2.5rem] px-1 py-2.5 text-center font-medium">
                    No.
                  </th>
                  <th className="px-1.5 py-2.5 text-center font-medium">
                    Over 0.5
                  </th>
                  <th className="px-1.5 py-2.5 text-center font-medium">
                    BTTS %
                  </th>
                  <th className="px-1.5 py-2.5 text-center font-medium">
                    BTTS / Dia
                  </th>
                  {scorelineColumns.map((scoreline, index) => (
                    <th
                      key={scoreline}
                      className={clsx(
                        "px-0.5 py-2.5 text-center font-medium",
                        GT_SCORELINE_SEPARATOR_AFTER.has(index)
                          ? "border-r border-r-white/20 pr-3"
                          : "",
                      )}
                    >
                      {scoreline}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-white/8 bg-black/10">
                {unifiedRows.map((row) => (
                  <tr
                    key={row.key}
                    className="align-top transition hover:bg-white/[0.03]"
                  >
                    <td className="portal-sticky-cell sticky left-0 z-10 w-[15.75rem] px-3 py-2.5">
                      <div className="flex items-center gap-2">
                        {row.status === "live" ? (
                          <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] font-semibold uppercase text-emerald-400">
                            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-400" />
                            Live
                          </span>
                        ) : row.status === "upcoming" ? (
                          <span className="inline-flex shrink-0 items-center rounded-full bg-white/6 px-2 py-0.5 text-[10px] font-medium uppercase text-mist">
                            Prox
                          </span>
                        ) : null}
                        <span className="whitespace-nowrap text-[12px] font-semibold text-ivory">
                          {row.timeLabel} | {row.confrontationLabel}
                        </span>
                      </div>
                      {row.resultTotals && (
                        <div className="mt-1 text-[10px] text-mist/70">
                          {row.series ? `Serie ${row.series}` : "Serie --"} | W{" "}
                          {row.resultTotals.playerOneWins} | D{" "}
                          {row.resultTotals.draws} | L{" "}
                          {row.resultTotals.playerTwoWins}
                          {row.scoreLabel ? ` | ${row.scoreLabel}` : ""}
                        </div>
                      )}
                      {!row.resultTotals && row.series && (
                        <div className="mt-1 text-[10px] text-mist/70">
                          Serie {row.series}
                        </div>
                      )}
                      {row.recentBttsHistory.length > 0 && (
                        <div className="mt-2 flex flex-wrap gap-1">
                          {row.recentBttsHistory.map((item, index) => (
                            <BttsBadge
                              key={`${row.key}-btts-${index}`}
                              value={item.value}
                              title={`${item.localTimeLabel} | ${item.scoreLabel} | BTTS ${item.value}`}
                            />
                          ))}
                        </div>
                      )}
                      {row.recentHistory.length > 0 && (
                        <div className="mt-2 flex flex-wrap gap-0.5">
                          {row.recentHistory.map((item, index) => (
                            <HistoryChip
                              key={`${row.key}-${index}`}
                              item={item}
                            />
                          ))}
                        </div>
                      )}
                    </td>
                    <td className="portal-sticky-cell sticky left-[15.75rem] z-10 w-[2.5rem] px-1 py-2.5 text-center">
                      {row.totalMatches > 0 ? (
                        <div className="text-[11px] tabular-nums text-mist">
                          {row.totalMatches}
                        </div>
                      ) : (
                        <span className="text-mist/40">--</span>
                      )}
                    </td>
                    <td className="px-1.5 py-2.5 text-center">
                      {row.totalMatches > 0 ? (
                        <>
                          <div className="text-[13px] font-semibold tabular-nums text-ivory">
                            {row.over05Count}
                          </div>
                          <div className="mt-1 text-[9px] uppercase tracking-[0.1em] text-mist/65">
                            {formatPercent(row.over05Rate)}
                          </div>
                        </>
                      ) : (
                        <span className="text-mist/40">--</span>
                      )}
                    </td>
                    <td className="px-1.5 py-2.5 text-center">
                      {row.totalMatches > 0 ? (
                        <>
                          <div className="text-[13px] font-semibold tabular-nums text-ivory">
                            {formatPercent(row.bttsRate)}
                          </div>
                          <div className="mt-1 text-[9px] tabular-nums text-mist/65">
                            {row.bttsCount}/{row.totalMatches}
                          </div>
                          <div className="mt-1.5 flex flex-col gap-0.5 text-[9px] tabular-nums">
                            <span
                              className="text-emerald-400/80"
                              title={`${row.playerOneName} marcou em ${row.playerOneScoredCount} jogos`}
                            >
                              {row.playerOneName.split(" ")[0]}{" "}
                              {formatPercent(row.playerOneScoredRate)}
                            </span>
                            <span
                              className="text-sky-400/80"
                              title={`${row.playerTwoName} marcou em ${row.playerTwoScoredCount} jogos`}
                            >
                              {row.playerTwoName.split(" ")[0]}{" "}
                              {formatPercent(row.playerTwoScoredRate)}
                            </span>
                          </div>
                        </>
                      ) : (
                        <span className="text-mist/40">--</span>
                      )}
                    </td>
                    <td className="px-1.5 py-2.5 text-center">
                      {row.totalMatches > 0 ? (
                        <>
                          <div className="text-[13px] font-semibold tabular-nums text-ivory">
                            {row.avgBttsPerDay.toFixed(2)}
                          </div>
                          <div className="mt-1 text-[9px] uppercase tracking-[0.1em] text-mist/65">
                            media
                          </div>
                        </>
                      ) : (
                        <span className="text-mist/40">--</span>
                      )}
                    </td>
                    {scorelineColumns.map((scoreline, index) => (
                      <td
                        key={`${row.key}-${scoreline}`}
                        className={clsx(
                          "px-0.5 py-2.5 text-center",
                          GT_SCORELINE_SEPARATOR_AFTER.has(index)
                            ? "border-r border-r-white/15 pr-3"
                            : "",
                        )}
                      >
                        {row.totalMatches > 0 ? (
                          <ScorelineCell
                            count={row.scorelineCounts[scoreline] ?? 0}
                            total={row.totalMatches}
                          />
                        ) : (
                          <span className="text-mist/40">--</span>
                        )}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </>
  );
}
