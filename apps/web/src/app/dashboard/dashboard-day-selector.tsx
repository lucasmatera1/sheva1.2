"use client";

import Link from "next/link";
import { useState } from "react";

type DashboardViewMode = "recent" | "future";

type DashboardDaySelectorProps = {
  activeRoutePath: string;
  days: Array<{
    dayKey: string;
    dayLabel: string;
  }>;
  refreshToken?: string;
  selectedDayKey?: string;
  selectedGroup?: string;
  selectedView?: DashboardViewMode;
};

function buildDashboardHref({
  activeRoutePath,
  dayKey,
  refreshToken,
  selectedGroup,
  selectedView,
}: {
  activeRoutePath: string;
  dayKey: string;
  refreshToken?: string;
  selectedGroup?: string;
  selectedView?: DashboardViewMode;
}) {
  const params = new URLSearchParams();

  if (refreshToken) {
    params.set("ts", refreshToken);
  }

  if (selectedView && selectedView !== "recent") {
    params.set("view", selectedView);
  }

  if (selectedGroup) {
    params.set("group", selectedGroup);
  }

  params.set("day", dayKey);

  const query = params.toString();
  return query ? `${activeRoutePath}?${query}` : activeRoutePath;
}

export function DashboardDaySelector({
  activeRoutePath,
  days,
  refreshToken,
  selectedDayKey,
  selectedGroup,
  selectedView = "recent",
}: DashboardDaySelectorProps) {
  const recentDays = days.slice(0, 3);
  const olderDays = days.slice(3);
  const selectedOlderDay =
    olderDays.find((day) => day.dayKey === selectedDayKey) ?? null;
  const [showOlderDays, setShowOlderDays] = useState(Boolean(selectedOlderDay));
  const [searchTerm, setSearchTerm] = useState("");

  const normalizedSearchTerm = searchTerm.trim().toLowerCase();
  const olderDayMatches = normalizedSearchTerm
    ? olderDays.filter(
        (day) =>
          day.dayLabel.toLowerCase().includes(normalizedSearchTerm) ||
          day.dayKey.includes(normalizedSearchTerm),
      )
    : olderDays.slice(0, 12);
  const visibleOlderDays =
    selectedOlderDay && !olderDayMatches.some((day) => day.dayKey === selectedOlderDay.dayKey)
      ? [selectedOlderDay, ...olderDayMatches]
      : olderDayMatches;

  return (
    <div className="mt-3 space-y-3">
      <div className="flex flex-wrap gap-2">
        {recentDays.map((day) => (
          <Link
            key={day.dayKey}
            href={buildDashboardHref({
              activeRoutePath,
              dayKey: day.dayKey,
              refreshToken,
              selectedGroup,
              selectedView,
            })}
            className={`inline-flex rounded-full border px-4 py-2 text-sm font-semibold transition ${selectedDayKey === day.dayKey ? "border-transparent bg-[#20352e] text-white" : "border-ink/10 bg-white/75 text-ink/70 hover:border-ink/20 hover:text-ink"}`}
          >
            {day.dayLabel}
          </Link>
        ))}
      </div>

      {olderDays.length ? (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={() => setShowOlderDays((current) => !current)}
              className={`inline-flex rounded-full border px-4 py-2 text-sm font-semibold transition ${showOlderDays ? "border-transparent bg-[#20352e] text-white" : "border-ink/10 bg-white/75 text-ink/70 hover:border-ink/20 hover:text-ink"}`}
            >
              Pesquisar outros dias
            </button>
            <span className="text-xs uppercase tracking-[0.14em] text-ink/45">
              {olderDays.length} dia(s) anteriores
            </span>
            {selectedOlderDay ? (
              <span className="inline-flex rounded-full border border-[#20352e]/15 bg-[#e9f0eb] px-3 py-1 text-xs font-semibold text-[#20352e]">
                Selecionado: {selectedOlderDay.dayLabel}
              </span>
            ) : null}
          </div>

          {showOlderDays ? (
            <div className="rounded-[1.1rem] border border-ink/10 bg-white/72 p-4">
              <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                <label className="block flex-1">
                  <span className="text-[11px] uppercase tracking-[0.16em] text-brand-strong">Buscar dia</span>
                  <input
                    type="search"
                    value={searchTerm}
                    onChange={(event) => setSearchTerm(event.target.value)}
                    placeholder="Ex.: 26/03/2026 ou 2026-03-26"
                    className="mt-2 w-full rounded-[0.95rem] border border-ink/10 bg-white px-4 py-3 text-sm text-ink outline-none transition placeholder:text-ink/35 focus:border-ink/25"
                  />
                </label>
                <p className="text-xs text-ink/55">
                  {normalizedSearchTerm
                    ? `${visibleOlderDays.length} resultado(s) para "${searchTerm}"`
                    : "Mostrando os dias anteriores mais recentes. Digite para filtrar."}
                </p>
              </div>

              <div className="mt-4 flex flex-wrap gap-2">
                {visibleOlderDays.length ? (
                  visibleOlderDays.map((day) => (
                    <Link
                      key={day.dayKey}
                      href={buildDashboardHref({
                        activeRoutePath,
                        dayKey: day.dayKey,
                        refreshToken,
                        selectedGroup,
                        selectedView,
                      })}
                      className={`inline-flex rounded-full border px-4 py-2 text-sm font-semibold transition ${selectedDayKey === day.dayKey ? "border-transparent bg-[#20352e] text-white" : "border-ink/10 bg-white text-ink/70 hover:border-ink/20 hover:text-ink"}`}
                    >
                      {day.dayLabel}
                    </Link>
                  ))
                ) : (
                  <div className="rounded-[0.95rem] border border-dashed border-ink/15 bg-[#f8f4ea] px-4 py-4 text-sm text-ink/60">
                    Nenhum dia encontrado para esse filtro.
                  </div>
                )}
              </div>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
