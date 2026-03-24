"use client";

import { useState } from "react";
import { apiUrl } from "../../../lib/api";
import { formatNumber, formatPercent } from "../../../lib/format";
import type { ConfrontationMethodsResponse, ConfrontationRow, LeagueApiValue, MethodCode, ResultCode, SeriesCode } from "./types";

type ConfrontationRowProps = {
  row: ConfrontationRow;
  leagueType: LeagueApiValue;
  methodCode: MethodCode;
  series?: SeriesCode;
  days?: number;
};

function getResultClass(result: ResultCode) {
  if (result === "W") {
    return "bg-[#20352e] text-white";
  }

  if (result === "L") {
    return "bg-[#7a3f34] text-white";
  }

  return "bg-[#c9b458] text-ink";
}

function usesEmpateNotation(methodCode: MethodCode) {
  return methodCode.includes("E");
}

function getDisplayResult(result: ResultCode, methodCode: MethodCode): ResultCode {
  if (result === "D" && usesEmpateNotation(methodCode)) {
    return "E";
  }

  return result;
}

export function ConfrontationRowItem({ row, leagueType, methodCode, series, days }: ConfrontationRowProps) {
  const [detailRow, setDetailRow] = useState<ConfrontationRow | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [hasError, setHasError] = useState(false);

  async function loadDetails() {
    setIsLoading(true);
    setHasError(false);

    try {
      const query = new URLSearchParams({
        leagueType,
        methodCode,
        confrontationKey: row.confrontationKey,
        includeHistory: "1",
      });

      if (leagueType === "GT LEAGUE" && series) {
        query.set("series", series);
      }

      if (days) {
        query.set("days", String(days));
      }

      const response = await fetch(`${apiUrl}/methods/confrontations?${query.toString()}`, {
        cache: "no-store",
      });

      if (!response.ok) {
        throw new Error("Falha ao carregar historico");
      }

      const data = (await response.json()) as ConfrontationMethodsResponse;
      setDetailRow(data.rows[0] ?? { ...row, history: [] });
    } catch {
      setHasError(true);
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <details
      className="group border-b border-ink/10 last:border-b-0"
      onToggle={(event) => {
        if (event.currentTarget.open && !detailRow && !isLoading) {
          void loadDetails();
        }
      }}
    >
      <summary className="cursor-pointer list-none px-4 py-4 [&::-webkit-details-marker]:hidden">
        <div className="grid gap-3 md:grid-cols-[1.35fr_0.55fr_0.45fr_0.45fr_0.45fr_0.45fr_0.8fr] md:items-center">
          <p className="font-semibold text-ink">{row.confrontationLabel}</p>
          <p className="text-sm text-ink/72">{formatNumber(row.totalOccurrences)}</p>
          <p className="text-sm text-ink/72">{formatNumber(row.wins)}</p>
          <p className="text-sm text-ink/72">{formatNumber(row.draws)}</p>
          <p className="text-sm text-ink/72">{formatNumber(row.losses)}</p>
          <p>
            <span className="inline-flex rounded-full bg-[#20352e] px-3 py-1 text-sm font-semibold text-white">{formatPercent(row.apx, 0)}</span>
          </p>
          <p className="text-right text-[11px] font-semibold uppercase tracking-[0.14em] text-brand-strong">
            <span className="group-open:hidden">Expandir historico</span>
            <span className="hidden group-open:inline">Recolher historico</span>
          </p>
        </div>
      </summary>

      <div className="border-t border-ink/10 bg-[#f7f4ea] px-4 py-4">
        {isLoading ? (
          <div className="rounded-[1rem] border border-dashed border-ink/15 bg-white/60 px-4 py-6 text-sm text-ink/60">
            Carregando historico do confronto...
          </div>
        ) : hasError ? (
          <div className="rounded-[1rem] border border-dashed border-[#b7867f] bg-[#fff6f4] px-4 py-6 text-sm text-[#7a3f34]">
            Nao foi possivel carregar o historico deste confronto.
          </div>
        ) : detailRow?.history.length ? (
          <div className="space-y-3">
            {detailRow.history.map((occurrence) => (
              <article key={`${detailRow.confrontationKey}-${occurrence.matchId}-${occurrence.dayKey}`} className="rounded-[1rem] border border-ink/10 bg-white/80 px-4 py-3">
                {(() => {
                  const resultIndex = occurrence.dayHistory.findIndex((dayMatch) => dayMatch.isMethodEntry);
                  const triggerStartIndex = resultIndex >= 0 ? Math.max(0, resultIndex - occurrence.triggerSequence.length) : -1;
                  const [trackedPlayer, opponentPlayer] = detailRow.confrontationLabel.split(" x ");

                  return (
                    <>
                <div className="grid gap-4 xl:grid-cols-[1.2fr_1fr_0.7fr_1.15fr_0.5fr] xl:items-center">
                  <div className="min-w-0">
                    <p className="text-xs uppercase tracking-[0.16em] text-brand-strong">Quando aconteceu</p>
                    <p className="mt-1 font-semibold text-ink">{occurrence.dayLabel} | {occurrence.windowLabel}</p>
                    <p className="mt-1 text-sm text-ink/60">{occurrence.localPlayedAtLabel} | Temporada {occurrence.seasonId ?? "-"} | Placar {occurrence.fullTimeScore}</p>
                  </div>

                  <div className="min-w-0">
                    <p className="text-xs uppercase tracking-[0.16em] text-brand-strong">Confronto</p>
                    <p className="mt-1 font-semibold text-ink">{detailRow.confrontationLabel}</p>
                    <p className="mt-1 text-sm text-ink/60">Jogador analisado: {trackedPlayer}{opponentPlayer ? ` | Adversario: ${opponentPlayer}` : ""}</p>
                  </div>

                  <div>
                    <p className="text-[11px] uppercase tracking-[0.14em] text-ink/52">Gatilho</p>
                    <div className="mt-2 flex flex-wrap gap-2">
                      {occurrence.triggerSequence.length ? (
                        occurrence.triggerSequence.map((result, index) => {
                          const displayResult = getDisplayResult(result, methodCode);

                          return (
                          <span key={`${occurrence.matchId}-trigger-${index}`} className={`inline-flex h-6 min-w-6 items-center justify-center rounded-full text-[10px] font-semibold ${getResultClass(displayResult)}`}>
                            {displayResult}
                          </span>
                        );
                        })
                      ) : (
                        <span className="text-sm text-ink/55">-</span>
                      )}
                    </div>
                  </div>

                  <div className="min-w-0 xl:pl-4">
                    <p className="text-[11px] uppercase tracking-[0.14em] text-ink/52">Sequencia do confronto no dia J</p>
                    <div className="mt-2 flex flex-wrap gap-3">
                      {occurrence.dayHistory.map((dayMatch, index) => {
                        const result = getDisplayResult(dayMatch.result, methodCode);
                        const isResultGame = index === resultIndex;
                        const isTriggerGame = triggerStartIndex >= 0 && index >= triggerStartIndex && index < resultIndex;

                        return (
                          <div key={`${occurrence.matchId}-day-${dayMatch.matchId}`} className="flex min-w-[54px] flex-col items-center gap-1">
                            <span
                              className={`inline-flex min-w-6 items-center justify-center rounded-full font-semibold ${getResultClass(result)} ${isResultGame ? "h-8 min-w-8 px-2 text-sm font-bold ring-2 ring-[#20352e]/20" : isTriggerGame ? "h-7 min-w-7 px-2 text-xs font-bold" : "h-6 min-w-6 text-[10px]"}`}
                            >
                              {result}
                            </span>
                            <span className={`text-center text-[10px] leading-none text-ink/70 ${isResultGame || isTriggerGame ? "font-semibold text-ink/85" : ""}`}>
                              {dayMatch.fullTimeScore}
                            </span>
                            <span className="text-center text-[10px] leading-none text-ink/50">{dayMatch.localTimeLabel}</span>
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  <div className="xl:flex xl:flex-col xl:items-end">
                    <p className="text-[11px] uppercase tracking-[0.14em] text-ink/52">Resultado</p>
                    <span className={`mt-2 inline-flex rounded-full px-3 py-1 text-sm font-semibold ${getResultClass(getDisplayResult(occurrence.result, methodCode))}`}>
                      {getDisplayResult(occurrence.result, methodCode)}
                    </span>
                  </div>
                </div>
                    </>
                  );
                })()}
              </article>
            ))}
          </div>
        ) : (
          <div className="rounded-[1rem] border border-dashed border-ink/15 bg-white/60 px-4 py-6 text-sm text-ink/60">
            Nenhum historico detalhado encontrado para este confronto.
          </div>
        )}
      </div>
    </details>
  );
}