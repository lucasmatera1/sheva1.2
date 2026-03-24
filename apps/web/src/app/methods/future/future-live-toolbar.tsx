"use client";

import { useEffect, useState, useTransition } from "react";
import { usePathname, useRouter } from "next/navigation";
import type { FutureSortBy } from "./priority";
import type { LeagueQueryValue, MethodCode, SeriesCode } from "./types";

const REFRESH_OPTIONS = [
  { value: 0, label: "Auto-refresh desligado" },
  { value: 15000, label: "Auto-refresh 15s" },
  { value: 30000, label: "Auto-refresh 30s" },
  { value: 60000, label: "Auto-refresh 60s" },
] as const;

type FutureLiveToolbarProps = {
  league: LeagueQueryValue;
  method: MethodCode;
  series?: SeriesCode;
  apxMin: number;
  minOccurrences: number;
  days: number;
  sortBy: FutureSortBy;
  generatedAt?: string;
  totalRows: number;
};

export function FutureLiveToolbar({ league, method, series, apxMin, minOccurrences, days, sortBy, generatedAt, totalRows }: FutureLiveToolbarProps) {
  const router = useRouter();
  const pathname = usePathname();
  const [isPending, startTransition] = useTransition();
  const [seriesValue, setSeriesValue] = useState(series ?? "");
  const [apxMinValue, setApxMinValue] = useState(apxMin > 0 ? String(apxMin) : "");
  const [minOccurrencesValue, setMinOccurrencesValue] = useState(String(Math.max(1, minOccurrences)));
  const [sortByValue, setSortByValue] = useState<FutureSortBy>(sortBy);
  const [refreshMs, setRefreshMs] = useState(30000);

  useEffect(() => {
    setSeriesValue(series ?? "");
    setApxMinValue(apxMin > 0 ? String(apxMin) : "");
    setMinOccurrencesValue(String(Math.max(1, minOccurrences)));
    setSortByValue(sortBy);
  }, [series, apxMin, minOccurrences, sortBy]);

  useEffect(() => {
    if (!refreshMs) {
      return;
    }

    const intervalId = window.setInterval(() => {
      if (document.hidden) {
        return;
      }

      startTransition(() => {
        router.refresh();
      });
    }, refreshMs);

    return () => window.clearInterval(intervalId);
  }, [refreshMs, router, startTransition]);

  function applyFilters() {
    const params = new URLSearchParams({
      league,
      method,
      days: String(days),
    });
    const parsedApxMin = Number(apxMinValue);
    const parsedMinOccurrences = Number(minOccurrencesValue);

    if (league === "gtleague" && seriesValue) {
      params.set("series", seriesValue);
    }

    if (Number.isFinite(parsedApxMin) && parsedApxMin > 0) {
      params.set("apxMin", String(parsedApxMin));
    }

    if (Number.isInteger(parsedMinOccurrences) && parsedMinOccurrences > 1) {
      params.set("minOccurrences", String(parsedMinOccurrences));
    }

    params.set("sort", sortByValue);

    startTransition(() => {
      router.push(`${pathname}?${params.toString()}`);
    });
  }

  const generatedAtLabel = generatedAt
    ? new Date(generatedAt).toLocaleTimeString("pt-BR", {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      })
    : "-";

  return (
    <div className="mt-6 rounded-[1.15rem] border border-ink/10 bg-white/72 p-4">
      <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-5 xl:flex-1">
          <label className="grid gap-2 text-sm text-ink/65">
            <span className="text-xs uppercase tracking-[0.16em] text-brand-strong">Serie na tabela</span>
            <select
              value={seriesValue}
              disabled={league !== "gtleague"}
              onChange={(event) => setSeriesValue(event.target.value)}
              className="rounded-[0.95rem] border border-ink/10 bg-white px-4 py-3 text-sm text-ink outline-none disabled:bg-sand/40 disabled:text-ink/35"
            >
              <option value="">Todas</option>
              <option value="A">Serie A</option>
              <option value="B">Serie B</option>
              <option value="C">Serie C</option>
              <option value="D">Serie D</option>
              <option value="E">Serie E</option>
              <option value="F">Serie F</option>
              <option value="G">Serie G</option>
            </select>
          </label>

          <label className="grid gap-2 text-sm text-ink/65">
            <span className="text-xs uppercase tracking-[0.16em] text-brand-strong">APX minimo</span>
            <input
              type="number"
              min="0"
              max="100"
              step="0.01"
              value={apxMinValue}
              onChange={(event) => setApxMinValue(event.target.value)}
              placeholder="0"
              className="rounded-[0.95rem] border border-ink/10 bg-white px-4 py-3 text-sm text-ink outline-none"
            />
          </label>

          <label className="grid gap-2 text-sm text-ink/65">
            <span className="text-xs uppercase tracking-[0.16em] text-brand-strong">Occ minima</span>
            <input
              type="number"
              min="1"
              step="1"
              value={minOccurrencesValue}
              onChange={(event) => setMinOccurrencesValue(event.target.value)}
              placeholder="1"
              className="rounded-[0.95rem] border border-ink/10 bg-white px-4 py-3 text-sm text-ink outline-none"
            />
          </label>

          <label className="grid gap-2 text-sm text-ink/65">
            <span className="text-xs uppercase tracking-[0.16em] text-brand-strong">Ordenacao</span>
            <select
              value={sortByValue}
              onChange={(event) => setSortByValue(event.target.value as FutureSortBy)}
              className="rounded-[0.95rem] border border-ink/10 bg-white px-4 py-3 text-sm text-ink outline-none"
            >
              <option value="kickoff">Horario mais proximo</option>
              <option value="apx">Maior APX</option>
              <option value="occurrences">Mais ocorrencias</option>
              <option value="priority">Prioridade operacional</option>
            </select>
          </label>

          <label className="grid gap-2 text-sm text-ink/65">
            <span className="text-xs uppercase tracking-[0.16em] text-brand-strong">Ritmo ao vivo</span>
            <select
              value={refreshMs}
              onChange={(event) => setRefreshMs(Number(event.target.value))}
              className="rounded-[0.95rem] border border-ink/10 bg-white px-4 py-3 text-sm text-ink outline-none"
            >
              {REFRESH_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div className="flex flex-col gap-3 xl:min-w-[18rem]">
          <div className="grid gap-1 text-sm text-ink/62">
            <p>Atualizado as {generatedAtLabel}</p>
            <p>{totalRows} oportunidade(s) exibida(s)</p>
          </div>
          <div className="flex flex-wrap gap-3">
            <button
              type="button"
              onClick={applyFilters}
              className="inline-flex rounded-full bg-[#20352e] px-5 py-3 text-sm font-semibold text-white transition hover:bg-[#172821]"
            >
              {isPending ? "Aplicando..." : "Aplicar filtros"}
            </button>
            <button
              type="button"
              onClick={() => startTransition(() => router.refresh())}
              className="inline-flex rounded-full border border-ink/10 bg-white px-5 py-3 text-sm font-semibold text-ink transition hover:border-ink/20"
            >
              {isPending ? "Atualizando..." : "Atualizar agora"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}