"use client";

import { useState } from "react";
import { SurfaceCard } from "../../components/shell/app-shell";
import { DashboardDaySelector } from "./dashboard-day-selector";
import { DashboardPlayerTable } from "./dashboard-player-table";

type DashboardSequenceResult = "W" | "D" | "L";
type DashboardViewMode = "recent" | "future";

type DashboardGtPlayer = {
  id: string;
  name: string;
  leagueGroup?: string | null;
  totalGames: number;
  wins: number;
  draws: number;
  losses: number;
  winRate: number;
  currentWindowGames: number;
  upcomingWindowGames: number;
  daySequence: Array<"W" | "D" | "L">;
  latestPlayedAt: string | null;
  nextFixtureAt: string | null;
  upcomingFixtures: Array<{
    id: string;
    playedAt: string;
    homePlayer: string;
    awayPlayer: string;
    opponent: string;
    seasonId: number | null;
  }>;
  recentMatches: Array<{
    id: string;
    playedAt: string;
    homePlayer: string;
    awayPlayer: string;
    opponent: string;
    seasonId: number | null;
    result: "W" | "D" | "L";
    scoreLabel: string;
  }>;
  previousWindows: Array<{
    key: string;
    dayLabel: string;
    windowLabel: string;
    rangeLabel: string;
    totalGames: number;
    wins: number;
    draws: number;
    losses: number;
    latestPlayedAt: string | null;
    sequence: Array<"W" | "D" | "L">;
    matches: Array<{
      id: string;
      playedAt: string;
      homePlayer: string;
      awayPlayer: string;
      opponent: string;
      seasonId: number | null;
      result: "W" | "D" | "L";
      scoreLabel: string;
    }>;
  }>;
  hasPreviousWindows: boolean;
};

type DashboardGtFutureRow = {
  key: string;
  confrontationLabel: string;
  sequence: DashboardSequenceResult[];
  apx: number | null;
  fixturePlayedAt: string;
  seasonId: number | null;
  groupLabel?: string | null;
};

type DashboardGtViewProps = {
  activeRoutePath: string;
  availableDays: Array<{
    dayKey: string;
    dayLabel: string;
  }>;
  availableGroups: string[];
  initialSelectedDayKey?: string;
  initialSelectedGroup?: string;
  initialSelectedView?: DashboardViewMode;
  refreshToken?: string;
  players: DashboardGtPlayer[];
  futureRows: DashboardGtFutureRow[];
};

function formatPercentValue(value: number, digits = 0) {
  return `${value.toFixed(digits)}%`;
}

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "short",
    timeStyle: "short",
  }).format(new Date(value));
}

function getSequenceClass(result: DashboardSequenceResult) {
  if (result === "W") {
    return "bg-[#20352e] text-white";
  }

  if (result === "L") {
    return "bg-[#7a3f34] text-white";
  }

  return "bg-[#c6b487] text-ink";
}

function getGtSeriesCode(label?: string | null) {
  if (!label) {
    return null;
  }

  const normalized = label.trim().toUpperCase();
  const directMatch = normalized.match(/^[A-Z]$/)?.[0];
  if (directMatch) {
    return directMatch;
  }

  const suffixMatch = normalized.match(/([A-Z])$/);
  return suffixMatch?.[1] ?? null;
}

function formatSeriesLabel(group: string) {
  return `Serie ${group.trim().toUpperCase()}`;
}

export function DashboardGtView({
  activeRoutePath,
  availableDays,
  availableGroups,
  initialSelectedDayKey,
  initialSelectedGroup,
  initialSelectedView = "recent",
  refreshToken,
  players,
  futureRows,
}: DashboardGtViewProps) {
  const [selectedGroup, setSelectedGroup] = useState<string | undefined>(
    initialSelectedGroup,
  );
  const [selectedView, setSelectedView] =
    useState<DashboardViewMode>(initialSelectedView);

  const filteredPlayers = selectedGroup
    ? players.filter(
        (player) => getGtSeriesCode(player.leagueGroup) === selectedGroup,
      )
    : players;
  const filteredFutureRows = selectedGroup
    ? futureRows.filter(
        (row) => getGtSeriesCode(row.groupLabel) === selectedGroup,
      )
    : futureRows;

  return (
    <>
      <SurfaceCard>
        <div className="flex flex-col gap-4">
          <div>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-xs uppercase tracking-[0.18em] text-brand-strong">
                Series da liga
              </p>
              <span className="text-xs text-ink/55">
                Filtro instantaneo, sem recarregar a pagina.
              </span>
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => setSelectedGroup(undefined)}
                className={`inline-flex rounded-full border px-4 py-2 text-sm font-semibold transition ${!selectedGroup ? "border-transparent bg-[#20352e] text-white" : "border-ink/10 bg-white/75 text-ink/70 hover:border-ink/20 hover:text-ink"}`}
              >
                Todas as series
              </button>
              {availableGroups.map((group) => (
                <button
                  key={group}
                  type="button"
                  onClick={() => setSelectedGroup(group)}
                  className={`inline-flex rounded-full border px-4 py-2 text-sm font-semibold transition ${selectedGroup === group ? "border-transparent bg-[#20352e] text-white" : "border-ink/10 bg-white/75 text-ink/70 hover:border-ink/20 hover:text-ink"}`}
                >
                  {formatSeriesLabel(group)}
                </button>
              ))}
            </div>
          </div>

          <div>
            <p className="text-xs uppercase tracking-[0.18em] text-brand-strong">
              Dias
            </p>
            <DashboardDaySelector
              activeRoutePath={activeRoutePath}
              days={availableDays}
              refreshToken={refreshToken}
              selectedDayKey={initialSelectedDayKey}
              selectedGroup={selectedGroup}
              selectedView={selectedView}
            />
          </div>

          <div>
            <p className="text-xs uppercase tracking-[0.18em] text-brand-strong">
              Visualizacao
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => setSelectedView("recent")}
                className={`inline-flex rounded-full border px-4 py-2 text-sm font-semibold transition ${selectedView === "recent" ? "border-transparent bg-[#20352e] text-white" : "border-ink/10 bg-white/75 text-ink/70 hover:border-ink/20 hover:text-ink"}`}
              >
                Jogos passados
              </button>
              <button
                type="button"
                onClick={() => setSelectedView("future")}
                className={`inline-flex rounded-full border px-4 py-2 text-sm font-semibold transition ${selectedView === "future" ? "border-transparent bg-[#20352e] text-white" : "border-ink/10 bg-white/75 text-ink/70 hover:border-ink/20 hover:text-ink"}`}
              >
                Jogos futuros
              </button>
            </div>
          </div>
        </div>
      </SurfaceCard>

      {selectedView === "future" ? (
        <SurfaceCard>
          <div>
            <p className="text-xs uppercase tracking-[0.2em] text-brand-strong">
              Jogos futuros
            </p>
            <p className="mt-2 text-sm text-ink/65">
              Confronto, serie, sequencia do dia e APX do filtro selecionado.
            </p>
          </div>

          <div className="mt-6 min-w-0">
            {filteredFutureRows.length ? (
              <div className="overflow-hidden rounded-[1.1rem] border border-ink/10 bg-white/72">
                <div className="hidden grid-cols-[1.1fr_0.55fr_1.45fr_0.45fr] gap-3 border-b border-ink/10 bg-white/70 px-4 py-3 text-[11px] uppercase tracking-[0.16em] text-brand-strong md:grid">
                  <span>Confronto</span>
                  <span>Serie</span>
                  <span>Sequencia</span>
                  <span className="text-right">Apx</span>
                </div>
                <div>
                  {filteredFutureRows.map((fixture) => (
                    <article
                      key={fixture.key}
                      className="grid gap-3 border-b border-ink/10 px-4 py-4 text-sm text-ink/78 last:border-b-0 md:grid-cols-[1.1fr_0.55fr_1.45fr_0.45fr] md:items-center"
                    >
                      <div>
                        <p className="font-semibold text-ink">
                          {fixture.confrontationLabel}
                        </p>
                        <p className="mt-1 text-[10px] uppercase tracking-[0.12em] text-ink/48">
                          {formatDateTime(fixture.fixturePlayedAt)} | Temporada{" "}
                          {fixture.seasonId ?? "-"}
                        </p>
                      </div>
                      <div>
                        <span className="inline-flex rounded-full border border-ink/10 bg-white px-3 py-1 text-xs font-semibold text-ink/70">
                          {getGtSeriesCode(fixture.groupLabel)
                            ? formatSeriesLabel(
                                getGtSeriesCode(fixture.groupLabel)!,
                              )
                            : "Sem serie"}
                        </span>
                      </div>
                      <div>
                        {fixture.sequence.length ? (
                          <>
                            <div className="flex flex-wrap gap-2">
                              {fixture.sequence.map((result, index) => (
                                <span
                                  key={`${fixture.key}-${index}`}
                                  className={`inline-flex h-5 min-w-5 items-center justify-center rounded-full text-[10px] font-semibold ${getSequenceClass(result)}`}
                                >
                                  {result}
                                </span>
                              ))}
                            </div>
                            <p className="mt-2 text-[10px] uppercase tracking-[0.12em] text-ink/48">
                              Historico do dia no mesmo J
                            </p>
                          </>
                        ) : (
                          <p className="text-xs text-ink/55">
                            Sem historico anterior no dia.
                          </p>
                        )}
                      </div>
                      <div className="text-left md:text-right">
                        <span
                          className={`inline-flex rounded-full px-3 py-1 text-sm font-semibold ${fixture.apx === null ? "border border-ink/10 bg-white text-ink/55" : "bg-[#20352e] text-white"}`}
                        >
                          {fixture.apx === null
                            ? "-"
                            : formatPercentValue(fixture.apx, 0)}
                        </span>
                      </div>
                    </article>
                  ))}
                </div>
              </div>
            ) : (
              <div className="rounded-[1.1rem] border border-dashed border-ink/15 bg-white/45 px-4 py-5 text-sm text-ink/60">
                Nenhum fixture futuro encontrado para este filtro.
              </div>
            )}
          </div>
        </SurfaceCard>
      ) : (
        <SurfaceCard>
          <div>
            <p className="text-xs uppercase tracking-[0.2em] text-brand-strong">
              Jogos passados
            </p>
            <p className="mt-2 text-sm text-ink/65">
              Sequencia completa do dia por player, agora com a serie visivel no
              filtro e na tabela.
            </p>
          </div>

          <div className="mt-6 min-w-0">
            {filteredPlayers.length ? (
              <DashboardPlayerTable
                players={filteredPlayers}
                leagueType="GT LEAGUE"
                showLeagueGroup
              />
            ) : (
              <div className="rounded-[1.2rem] border border-dashed border-ink/15 bg-white/45 px-5 py-8 text-sm text-ink/60">
                Nenhum jogo recente encontrado para este filtro da GT League.
              </div>
            )}
          </div>
        </SurfaceCard>
      )}
    </>
  );
}
