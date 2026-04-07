"use client";

import { useState } from "react";
import { SurfaceCard } from "../../../components/shell/app-shell";

export type PastMethodLogRow = {
  id: string;
  methodCode: string;
  playerName: string;
  series: string;
  playedAtIso: string;
  playedAtLabel: string;
  confrontationLabel: string;
  fullTimeScore: string;
  apx: number;
  totalOccurrences: number;
  result: string;
};

type PastMethodsLogTableProps = {
  rows: PastMethodLogRow[];
};

export function PastMethodsLogTable({ rows }: PastMethodsLogTableProps) {
  const methodCounts = rows.reduce<Record<string, number>>((accumulator, row) => {
    accumulator[row.methodCode] = (accumulator[row.methodCode] ?? 0) + 1;
    return accumulator;
  }, {});

  const methodTabs = Object.keys(methodCounts)
    .sort((left, right) => left.localeCompare(right, "pt-BR"))
    .map((methodCode) => ({
      value: methodCode,
      label: methodCode,
      count: methodCounts[methodCode],
    }));

  const [activeMethod, setActiveMethod] = useState<string>(methodTabs[0]?.value ?? "all");

  const filteredRows = activeMethod === "all" ? rows : rows.filter((row) => row.methodCode === activeMethod);
  const tabs = [...methodTabs, { value: "all", label: "Todos", count: rows.length }];
  const summary = buildMethodDashboard(filteredRows);

  return (
    <SurfaceCard>
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="text-xs uppercase tracking-[0.2em] text-brand-strong">Logs</p>
          <h2 className="mt-3 font-display text-3xl text-ink">Metodos recentes</h2>
          <p className="mt-3 text-sm leading-7 text-ink/68">Troque de aba para ver um metodo por vez sem recarregar a pagina inteira.</p>
        </div>

        <p className="text-xs uppercase tracking-[0.16em] text-ink/48">{filteredRows.length} registro(s)</p>
      </div>

      <div className="mt-5 overflow-x-auto pb-1">
        <div className="flex min-w-max gap-3">
          {tabs.map((tab) => (
            <button
              key={tab.value}
              type="button"
              onClick={() => setActiveMethod(tab.value)}
              className={`inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm font-semibold transition ${
                activeMethod === tab.value ? "bg-[#20352e] text-white" : "border border-ink/10 bg-white text-ink hover:border-ink/20"
              }`}
            >
              <span>{tab.label}</span>
              <span className={`rounded-full px-2.5 py-0.5 text-[11px] ${activeMethod === tab.value ? "bg-white/15 text-white" : "bg-[#f7f4ec] text-ink/72"}`}>{tab.count}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="mt-6 grid gap-4 xl:grid-cols-[1.4fr_1fr]">
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          <DashboardCard label="Volume" value={summary.totalRows.toLocaleString("pt-BR")} />
          <DashboardCard label="W" value={summary.wins.toLocaleString("pt-BR")} tone="success" />
          <DashboardCard label="D / E" value={summary.draws.toLocaleString("pt-BR")} tone="warning" />
          <DashboardCard label="L" value={summary.losses.toLocaleString("pt-BR")} tone="danger" />
          <DashboardCard label="APX medio" value={`${summary.averageApx.toFixed(2)}%`} />
          <DashboardCard label="Ocorrencia media" value={summary.averageOccurrences.toFixed(2)} />
        </div>

        <div className="grid gap-4">
          <div className="rounded-[1.15rem] border border-ink/10 bg-[#f7f4ec] p-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-xs uppercase tracking-[0.16em] text-brand-strong">Top Series</p>
                <p className="mt-2 text-sm text-ink/70">Series com maior volume dentro do metodo filtrado.</p>
              </div>
              <span className="text-xs uppercase tracking-[0.14em] text-ink/48">{summary.topSeries.length} serie(s)</span>
            </div>

            {summary.topSeries.length ? (
              <div className="mt-4 space-y-3">
                {summary.topSeries.map((series) => (
                  <div key={series.name} className="rounded-[1rem] border border-ink/10 bg-white/80 px-4 py-3">
                    <div className="flex items-center justify-between gap-3">
                      <p className="font-semibold text-ink">Serie {series.name}</p>
                      <span className="rounded-full bg-[#20352e] px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-white">
                        {series.total} registro(s)
                      </span>
                    </div>
                    <div className="mt-2 flex flex-wrap gap-2 text-xs text-ink/62">
                      <span>W: {series.wins}</span>
                      <span>D/E: {series.draws}</span>
                      <span>L: {series.losses}</span>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="mt-4 rounded-[1rem] border border-dashed border-ink/15 bg-white/60 px-4 py-5 text-sm text-ink/58">
                Nenhuma serie identificada para este metodo.
              </div>
            )}
          </div>

          <div className="rounded-[1.15rem] border border-ink/10 bg-[#f7f4ec] p-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-xs uppercase tracking-[0.16em] text-brand-strong">Top jogadores</p>
                <p className="mt-2 text-sm text-ink/70">Ordenados por APX total dentro do metodo filtrado.</p>
              </div>
              <span className="text-xs uppercase tracking-[0.14em] text-ink/48">{summary.topPlayers.length} jogador(es)</span>
            </div>

            {summary.topPlayers.length ? (
              <div className="mt-4 space-y-3">
                {summary.topPlayers.map((player) => (
                  <div key={player.name} className="rounded-[1rem] border border-ink/10 bg-white/80 px-4 py-3">
                    <div className="flex items-center justify-between gap-3">
                      <p className="font-semibold text-ink">{player.name}</p>
                      <span className="rounded-full bg-[#20352e] px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-white">
                        APX total {player.totalApx.toFixed(2)}%
                      </span>
                    </div>
                    <div className="mt-2 flex flex-wrap gap-2 text-xs text-ink/62">
                      <span>Registros: {player.total}</span>
                      <span>W: {player.wins}</span>
                      <span>D/E: {player.draws}</span>
                      <span>L: {player.losses}</span>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="mt-4 rounded-[1rem] border border-dashed border-ink/15 bg-white/60 px-4 py-5 text-sm text-ink/58">
                Nenhum jogador identificado para este metodo.
              </div>
            )}
          </div>
        </div>
      </div>

      {filteredRows.length ? (
        <div className="mt-6 overflow-x-auto">
          <div className="min-w-[1060px] overflow-hidden rounded-[1.2rem] border border-ink/10 bg-white/70">
            <div className="grid grid-cols-[1.1fr_1.7fr_0.6fr_0.8fr_0.7fr_0.9fr_0.7fr] gap-4 border-b border-ink/10 bg-[#f7f4ec] px-5 py-4 text-[11px] font-semibold uppercase tracking-[0.16em] text-ink/55">
              <p>Data/Hora</p>
              <p>Confronto</p>
              <p>Serie</p>
              <p>Placar</p>
              <p>APX</p>
              <p>Ocorrencias</p>
              <p>Resultado</p>
            </div>

            <div>
              {filteredRows.map((row) => (
                <article key={row.id} className="grid grid-cols-[1.1fr_1.7fr_0.6fr_0.8fr_0.7fr_0.9fr_0.7fr] gap-4 border-b border-ink/10 px-5 py-4 text-sm text-ink/72 last:border-b-0">
                  <p className="font-medium text-ink">{row.playedAtLabel}</p>
                  <p className="font-medium text-ink">{row.confrontationLabel}</p>
                  <p>{row.series}</p>
                  <p>{row.fullTimeScore}</p>
                  <p>{row.apx.toFixed(2)}%</p>
                  <p>{row.totalOccurrences}</p>
                  <p>
                    <span className={`inline-flex min-w-10 items-center justify-center rounded-full px-3 py-1 text-xs font-semibold uppercase tracking-[0.14em] ${getResultClassName(row.result)}`}>
                      {row.result}
                    </span>
                  </p>
                </article>
              ))}
            </div>
          </div>
        </div>
      ) : (
        <div className="mt-6 rounded-[1.2rem] border border-dashed border-ink/15 bg-white/45 px-5 py-8 text-sm text-ink/60">
          Nenhum registro encontrado para este metodo.
        </div>
      )}
    </SurfaceCard>
  );
}

function getResultClassName(result: string) {
  if (result === "W") {
    return "bg-emerald-100 text-emerald-800";
  }

  if (result === "L") {
    return "bg-rose-100 text-rose-800";
  }

  if (result === "D" || result === "E") {
    return "bg-amber-100 text-amber-900";
  }

  return "bg-slate-100 text-slate-700";
}

function DashboardCard({ label, value, tone = "default" }: { label: string; value: string; tone?: "default" | "success" | "warning" | "danger" }) {
  const toneClassName =
    tone === "success"
      ? "bg-emerald-50 border-emerald-200 text-emerald-900"
      : tone === "warning"
        ? "bg-amber-50 border-amber-200 text-amber-900"
        : tone === "danger"
          ? "bg-rose-50 border-rose-200 text-rose-900"
          : "bg-white/80 border-ink/10 text-ink";

  return (
    <div className={`rounded-[1.05rem] border px-4 py-4 ${toneClassName}`}>
      <p className="text-xs uppercase tracking-[0.16em]">{label}</p>
      <p className="mt-2 text-2xl font-semibold">{value}</p>
    </div>
  );
}

function buildMethodDashboard(rows: PastMethodLogRow[]) {
  const totalRows = rows.length;
  const wins = rows.filter((row) => row.result === "W").length;
  const draws = rows.filter((row) => row.result === "D" || row.result === "E").length;
  const losses = rows.filter((row) => row.result === "L").length;
  const averageApx = totalRows ? rows.reduce((sum, row) => sum + row.apx, 0) / totalRows : 0;
  const averageOccurrences = totalRows ? rows.reduce((sum, row) => sum + row.totalOccurrences, 0) / totalRows : 0;
  const seriesMap = rows.reduce<Record<string, { total: number; wins: number; draws: number; losses: number }>>((accumulator, row) => {
    const current = accumulator[row.series] ?? { total: 0, wins: 0, draws: 0, losses: 0 };
    current.total += 1;

    if (row.result === "W") {
      current.wins += 1;
    } else if (row.result === "L") {
      current.losses += 1;
    } else if (row.result === "D" || row.result === "E") {
      current.draws += 1;
    }

    accumulator[row.series] = current;
    return accumulator;
  }, {});

  const playerMap = rows.reduce<
    Record<string, { total: number; wins: number; draws: number; losses: number; apxTotal: number }>
  >((accumulator, row) => {
    const current = accumulator[row.playerName] ?? { total: 0, wins: 0, draws: 0, losses: 0, apxTotal: 0 };
    current.total += 1;
    current.apxTotal += row.apx;

    if (row.result === "W") {
      current.wins += 1;
    } else if (row.result === "L") {
      current.losses += 1;
    } else if (row.result === "D" || row.result === "E") {
      current.draws += 1;
    }

    accumulator[row.playerName] = current;
    return accumulator;
  }, {});

  const topPlayers = Object.entries(playerMap)
    .map(([name, data]) => ({
      name,
      total: data.total,
      wins: data.wins,
      draws: data.draws,
      losses: data.losses,
      totalApx: data.apxTotal,
    }))
    .sort((left, right) => {
      if (right.totalApx !== left.totalApx) {
        return right.totalApx - left.totalApx;
      }

      return right.total - left.total;
    })
    .slice(0, 5);

  const topSeries = Object.entries(seriesMap)
    .map(([name, data]) => ({
      name,
      total: data.total,
      wins: data.wins,
      draws: data.draws,
      losses: data.losses,
    }))
    .sort((left, right) => {
      if (right.total !== left.total) {
        return right.total - left.total;
      }

      return left.name.localeCompare(right.name, "pt-BR");
    })
    .slice(0, 5);

  return {
    totalRows,
    wins,
    draws,
    losses,
    averageApx,
    averageOccurrences,
    topSeries,
    topPlayers,
  };
}
