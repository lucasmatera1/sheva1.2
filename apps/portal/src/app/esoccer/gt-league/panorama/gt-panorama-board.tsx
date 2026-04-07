"use client";

import clsx from "clsx";
import Link from "next/link";
import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import type {
  PortalGTPanoramaResponse,
  PortalGTPanoramaSeasonStanding,
} from "@/lib/portal-api";
import { formatPercent } from "@/lib/format";

const GT_SERIES = ["A", "B", "C", "D", "E", "F", "G"] as const;

const OPERATIONAL_TZ = "America/Sao_Paulo";

function getTodayDayKey() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: OPERATIONAL_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "00";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

function buildRecentDayKeys(count: number) {
  const todayKey = getTodayDayKey();
  const [y, m, d] = todayKey.split("-").map(Number);
  const days: { dayKey: string; label: string; isToday: boolean }[] = [];

  for (let i = 0; i < count; i++) {
    const date = new Date(y, m - 1, d - i, 12, 0, 0);
    const dayKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
    const label = new Intl.DateTimeFormat("pt-BR", {
      weekday: "short",
      day: "2-digit",
      month: "2-digit",
    }).format(date);
    days.push({ dayKey, label, isToday: i === 0 });
  }

  return days;
}

function findInitialSeries(panorama: PortalGTPanoramaResponse | null) {
  const firstWithRows = panorama?.seriesGroups.find(
    (group) => group.pairRows.length > 0 || group.playerRows.length > 0,
  );

  return firstWithRows?.series ?? "A";
}

function PanoramaResultBadge({
  result,
  playerOneGoals,
  playerTwoGoals,
  scoreLabel,
  localTimeLabel,
}: {
  result: "W" | "D" | "L";
  playerOneGoals: number;
  playerTwoGoals: number;
  scoreLabel: string;
  localTimeLabel: string;
}) {
  return (
    <div
      title={`${localTimeLabel} | ${scoreLabel}`}
      className={clsx(
        "portal-panorama-result-badge flex min-w-[1.7rem] flex-col items-center justify-center rounded-[0.4rem] border px-0.5 py-0.5 text-center",
        result === "W" &&
          "portal-panorama-result-badge--win border-emerald-300/20 bg-emerald-400/10 text-emerald-100",
        result === "D" &&
          "portal-panorama-result-badge--draw border-amber-300/20 bg-amber-300/10 text-amber-100",
        result === "L" &&
          "portal-panorama-result-badge--loss border-rose-300/20 bg-rose-400/10 text-rose-100",
      )}
    >
      <span className="text-[7px] font-medium leading-none opacity-80">
        {playerOneGoals}
      </span>
      <span className="mt-0.5 text-[10px] font-semibold leading-none">
        {result}
      </span>
      <span className="mt-0.5 text-[7px] font-medium leading-none opacity-80">
        {playerTwoGoals}
      </span>
    </div>
  );
}

function parsePerspectiveScore(score: string) {
  const [goalsForRaw = "", goalsAgainstRaw = ""] = score.split("-");
  const goalsFor = Number(goalsForRaw);
  const goalsAgainst = Number(goalsAgainstRaw);

  return {
    goalsFor: Number.isFinite(goalsFor) ? goalsFor : 0,
    goalsAgainst: Number.isFinite(goalsAgainst) ? goalsAgainst : 0,
  };
}

function SequencePill({
  result,
  goalsFor,
  goalsAgainst,
  title,
}: {
  result: "W" | "D" | "L";
  goalsFor: number;
  goalsAgainst: number;
  title: string;
}) {
  return (
    <div
      title={title}
      className={clsx(
        "portal-panorama-result-badge flex min-w-[1.7rem] flex-col items-center justify-center rounded-[0.4rem] border px-0.5 py-0.5 text-center",
        result === "W" &&
          "portal-panorama-result-badge--win bg-emerald-400/12 text-emerald-100 border-emerald-300/20",
        result === "D" &&
          "portal-panorama-result-badge--draw bg-amber-300/12 text-amber-100 border-amber-300/20",
        result === "L" &&
          "portal-panorama-result-badge--loss bg-rose-400/12 text-rose-100 border-rose-300/20",
      )}
    >
      <span className="text-[7px] font-medium leading-none opacity-80">
        {goalsFor}
      </span>
      <span className="mt-0.5 text-[10px] font-semibold leading-none">
        {result}
      </span>
      <span className="mt-0.5 text-[7px] font-medium leading-none opacity-80">
        {goalsAgainst}
      </span>
    </div>
  );
}

function SeasonStandingsTable({
  standing,
  series,
  dayLabel,
}: {
  standing: PortalGTPanoramaSeasonStanding;
  series: string;
  dayLabel: string;
}) {
  return (
    <div className="flex-1 min-w-0">
      <div className="rounded-t-[0.6rem] bg-blue-600 px-3 py-1.5">
        <span className="text-[11px] font-semibold text-white">
          {standing.seasonLabel} ({dayLabel}) (Group {series})
        </span>
      </div>
      <div className="px-3 py-2 border-x border-white/10 bg-black/20">
        <span className="text-[10px] font-medium text-ivory/60">
          Group {series} Season Standings
        </span>
      </div>
      <div className="overflow-hidden rounded-b-[0.6rem] border border-t-0 border-white/10">
        <table className="min-w-full divide-y divide-white/10 text-left text-[11px]">
          <thead className="bg-white/8 text-[10px] uppercase tracking-[0.15em] text-ivory/70">
            <tr>
              <th className="w-[1.6rem] px-1.5 py-2 text-center font-medium">
                #
              </th>
              <th className="px-2 py-2 font-medium">Player</th>
              <th className="w-[2rem] px-1 py-2 text-center font-medium">GP</th>
              <th className="w-[2rem] px-1 py-2 text-center font-medium">
                PTs
              </th>
              <th className="w-[2rem] px-1 py-2 text-center font-medium">W</th>
              <th className="w-[2rem] px-1 py-2 text-center font-medium">D</th>
              <th className="w-[2rem] px-1 py-2 text-center font-medium">L</th>
              <th className="w-[2rem] px-1 py-2 text-center font-medium">GF</th>
              <th className="w-[2rem] px-1 py-2 text-center font-medium">GA</th>
              <th className="w-[2.2rem] px-1 py-2 text-center font-medium">
                GD
              </th>
              <th className="w-[3rem] px-1 py-2 text-center font-medium">W%</th>
              <th className="w-[3rem] px-1 py-2 text-center font-medium">D%</th>
              <th className="w-[3rem] px-1 py-2 text-center font-medium">L%</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-white/8 bg-black/10 text-mist">
            {standing.players.map((player, idx) => (
              <tr key={player.playerName}>
                <td className="px-1.5 py-2 text-center text-[10px] text-ivory/50">
                  {idx + 1}
                </td>
                <td className="px-2 py-2 text-[11px] font-semibold text-ivory">
                  {player.playerName}
                </td>
                <td className="px-1 py-2 text-center tabular-nums">
                  {player.gp}
                </td>
                <td className="px-1 py-2 text-center font-semibold tabular-nums text-ivory">
                  {player.pts}
                </td>
                <td className="px-1 py-2 text-center tabular-nums text-emerald-400">
                  {player.wins}
                </td>
                <td className="px-1 py-2 text-center tabular-nums text-amber-400">
                  {player.draws}
                </td>
                <td className="px-1 py-2 text-center tabular-nums text-rose-400">
                  {player.losses}
                </td>
                <td className="px-1 py-2 text-center tabular-nums">
                  {player.gf}
                </td>
                <td className="px-1 py-2 text-center tabular-nums">
                  {player.ga}
                </td>
                <td className="px-1 py-2 text-center tabular-nums">
                  {player.gd > 0 ? (
                    <span className="text-emerald-400">+{player.gd}</span>
                  ) : player.gd < 0 ? (
                    <span className="text-rose-400">{player.gd}</span>
                  ) : (
                    <span>0</span>
                  )}
                </td>
                <td className="px-1 py-2 text-center tabular-nums text-emerald-400">
                  {player.winPct.toFixed(2)}
                </td>
                <td className="px-1 py-2 text-center tabular-nums text-amber-400">
                  {player.drawPct.toFixed(2)}
                </td>
                <td className="px-1 py-2 text-center tabular-nums text-rose-400">
                  {player.lossPct.toFixed(2)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function GTPanoramaBoard({
  panorama: initialPanorama,
}: {
  panorama: PortalGTPanoramaResponse | null;
}) {
  const recentDays = useMemo(() => buildRecentDayKeys(14), []);
  const [selectedDay, setSelectedDay] = useState<string | null>(null);
  const [panorama, setPanorama] = useState(initialPanorama);
  const [loading, setLoading] = useState(false);
  const [selectedSeries, setSelectedSeries] = useState(
    findInitialSeries(initialPanorama),
  );

  useEffect(() => {
    setPanorama(initialPanorama);
    setSelectedSeries(findInitialSeries(initialPanorama));
  }, [initialPanorama]);

  const fetchPanoramaForDay = useCallback(async (dayKey: string) => {
    setSelectedDay(dayKey);
    setLoading(true);

    try {
      const response = await fetch(
        `/api/gt-league/panorama?dayKey=${encodeURIComponent(dayKey)}`,
      );

      if (!response.ok) {
        setPanorama(null);
        return;
      }

      const data = (await response.json()) as PortalGTPanoramaResponse;
      setPanorama(data);
      setSelectedSeries(findInitialSeries(data));
    } catch {
      setPanorama(null);
    } finally {
      setLoading(false);
    }
  }, []);

  const selectedGroup = useMemo(
    () =>
      panorama?.seriesGroups.find((group) => group.series === selectedSeries) ??
      panorama?.seriesGroups[0] ??
      null,
    [panorama, selectedSeries],
  );

  const totalPairRows = selectedGroup?.pairRows.length ?? 0;
  const totalPlayerRows = selectedGroup?.playerRows.length ?? 0;

  return (
    <>
      <section className="glass-panel rounded-[0.85rem] px-6 py-6">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <div className="text-xs uppercase tracking-[0.26em] text-sage">
              Resumo do dia
            </div>
            <h2 className="mt-2 font-display text-3xl text-ivory">
              Panorama operacional da GT League
            </h2>
            <p className="mt-3 max-w-3xl text-sm leading-7 text-mist">
              Consolidado dos jogos resolvidos do dia operacional atual. A
              tabela da esquerda resume confronto por confronto; a da direita,
              jogador por jogador.
            </p>
          </div>

          <div className="text-right">
            <div className="text-xs uppercase tracking-[0.22em] text-sage">
              {panorama?.dayLabel ?? "--"}
            </div>
            <div className="mt-2 text-sm text-mist">
              {panorama?.totalMatches ?? 0} jogo(s) resolvido(s) no dia
            </div>
          </div>
        </div>

        <div className="mt-6 flex flex-wrap items-center gap-3">
          <div className="flex flex-wrap gap-2">
            {recentDays.map((day) => {
              const isActive =
                selectedDay === day.dayKey || (!selectedDay && day.isToday);

              return (
                <button
                  key={day.dayKey}
                  type="button"
                  disabled={loading}
                  onClick={() => fetchPanoramaForDay(day.dayKey)}
                  className={clsx(
                    "rounded-[0.6rem] border px-3 py-1.5 text-[11px] font-medium transition",
                    isActive
                      ? "border-ivory/70 bg-ivory text-forest"
                      : "border-white/14 bg-black/12 text-mist hover:border-white/22 hover:bg-white/6",
                    loading && "opacity-50 cursor-wait",
                  )}
                >
                  {day.isToday ? "Hoje" : day.label}
                </button>
              );
            })}
          </div>
          {loading && (
            <span className="text-[11px] text-sage animate-pulse">
              Carregando...
            </span>
          )}
        </div>

        <div className="mt-4 flex flex-wrap gap-3">
          {GT_SERIES.map((series) => {
            const isActive = selectedSeries === series;
            const hasData = Boolean(
              panorama?.seriesGroups.find((group) => group.series === series)
                ?.pairRows.length ||
              panorama?.seriesGroups.find((group) => group.series === series)
                ?.playerRows.length,
            );

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
                <span>Serie {series}</span>
                <span
                  className={clsx(
                    "inline-flex h-5 min-w-5 items-center justify-center rounded-full px-1.5 text-[10px] font-bold",
                    isActive
                      ? "bg-forest/10 text-forest"
                      : hasData
                        ? "bg-emerald-400/12 text-emerald-100"
                        : "bg-white/8 text-mist",
                  )}
                >
                  {hasData ? "ON" : "0"}
                </span>
              </button>
            );
          })}
        </div>
      </section>

      {!panorama || !selectedGroup ? (
        <section className="glass-panel rounded-[0.85rem] px-6 py-6">
          <div className="rounded-[0.75rem] border border-dashed border-white/10 bg-black/10 px-5 py-8 text-center text-sm text-mist">
            Nao foi possivel carregar o panorama da GT League agora.
          </div>
        </section>
      ) : (
        <>
          {selectedGroup.seasonStandings &&
            selectedGroup.seasonStandings.length > 0 && (
              <section className="glass-panel rounded-[0.85rem] px-5 py-5">
                <div className="border-b border-white/8 pb-4">
                  <div className="text-xs uppercase tracking-[0.24em] text-sage">
                    Serie {selectedGroup.series}
                  </div>
                  <h3 className="mt-2 text-lg font-semibold text-ivory">
                    Classificacao por campeonato
                  </h3>
                </div>
                <div className="mt-5 grid gap-4 lg:grid-cols-3">
                  {selectedGroup.seasonStandings.map((standing) => (
                    <SeasonStandingsTable
                      key={standing.seasonId}
                      standing={standing}
                      series={selectedGroup.series}
                      dayLabel={panorama.dayLabel}
                    />
                  ))}
                </div>
              </section>
            )}

          <section className="grid gap-6 xl:grid-cols-[minmax(0,0.82fr)_minmax(0,1.28fr)]">
            <article className="glass-panel rounded-[0.85rem] px-5 py-5">
              <div className="flex items-center justify-between gap-4 border-b border-white/8 pb-4">
                <div>
                  <div className="text-xs uppercase tracking-[0.24em] text-sage">
                    Serie {selectedGroup.series}
                  </div>
                  <h3 className="mt-2 text-lg font-semibold text-ivory">
                    Confrontos do dia
                  </h3>
                </div>
                <div className="text-xs uppercase tracking-[0.22em] text-sage">
                  {totalPairRows} linha(s)
                </div>
              </div>

              {selectedGroup.pairRows.length === 0 ? (
                <div className="mt-5 rounded-[0.75rem] border border-dashed border-white/10 bg-black/10 px-5 py-8 text-center text-sm text-mist">
                  Nenhum confronto resolvido ainda na Serie{" "}
                  {selectedGroup.series}.
                </div>
              ) : (
                <div className="mt-5 overflow-hidden rounded-[0.75rem] border border-white/8">
                  <table className="min-w-full table-fixed divide-y divide-white/8 text-left text-[12px]">
                    <thead className="bg-white/5 text-[11px] uppercase tracking-[0.2em] text-sage">
                      <tr>
                        <th className="w-[8rem] px-2.5 py-3 font-medium">
                          Confronto
                        </th>
                        <th className="px-2.5 py-3 font-medium">Sequencia</th>
                        <th className="w-[2.55rem] px-0.5 py-3 text-center font-medium">
                          W
                        </th>
                        <th className="w-[2.55rem] px-0.5 py-3 text-center font-medium">
                          D
                        </th>
                        <th className="w-[2.55rem] px-0.5 py-3 text-center font-medium">
                          L
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-white/8 bg-black/10 text-mist">
                      {selectedGroup.pairRows.map((row) => (
                        <tr key={row.confrontationKey}>
                          <td className="px-2.5 py-3">
                            <Link
                              href={`/esoccer/gt-league/disparidade?player1=${encodeURIComponent(row.playerOneName)}&player2=${encodeURIComponent(row.playerTwoName)}`}
                              className="group"
                            >
                              <div className="text-[11.5px] font-semibold leading-tight text-ivory underline decoration-ivory/25 underline-offset-2 transition-colors group-hover:text-gold group-hover:decoration-gold/50">
                                {row.confrontationLabel}
                              </div>
                              <div className="mt-1 text-[9px] uppercase tracking-[0.14em] text-mist/70">
                                {row.totalGames} jogo(s) no dia
                              </div>
                            </Link>
                          </td>
                          <td className="px-2.5 py-3">
                            <div className="flex flex-wrap gap-[0.2rem]">
                              {row.history.map((item) => (
                                <PanoramaResultBadge
                                  key={item.matchId}
                                  result={item.result}
                                  playerOneGoals={item.playerOneGoals}
                                  playerTwoGoals={item.playerTwoGoals}
                                  scoreLabel={item.scoreLabel}
                                  localTimeLabel={item.localTimeLabel}
                                />
                              ))}
                            </div>
                          </td>
                          <td className="px-0.5 py-3 text-center">
                            <span className="portal-panorama-total-badge portal-panorama-total-badge--win inline-flex min-w-[2rem] items-center justify-center rounded-[0.42rem] bg-emerald-400/12 px-1 py-1 text-[10px] font-semibold tabular-nums text-emerald-100">
                              {row.wins}
                            </span>
                          </td>
                          <td className="px-0.5 py-3 text-center">
                            <span className="portal-panorama-total-badge portal-panorama-total-badge--draw inline-flex min-w-[2rem] items-center justify-center rounded-[0.42rem] bg-amber-300/12 px-1 py-1 text-[10px] font-semibold tabular-nums text-amber-100">
                              {row.draws}
                            </span>
                          </td>
                          <td className="px-0.5 py-3 text-center">
                            <span className="portal-panorama-total-badge portal-panorama-total-badge--loss inline-flex min-w-[2rem] items-center justify-center rounded-[0.42rem] bg-rose-400/12 px-1 py-1 text-[10px] font-semibold tabular-nums text-rose-100">
                              {row.losses}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </article>

            <article className="glass-panel rounded-[0.85rem] px-5 py-5">
              <div className="flex items-center justify-between gap-4 border-b border-white/8 pb-4">
                <div>
                  <div className="text-xs uppercase tracking-[0.24em] text-sage">
                    Serie {selectedGroup.series}
                  </div>
                  <h3 className="mt-2 text-lg font-semibold text-ivory">
                    Jogadores do dia
                  </h3>
                </div>
                <div className="text-xs uppercase tracking-[0.22em] text-sage">
                  {totalPlayerRows} jogador(es)
                </div>
              </div>

              {selectedGroup.playerRows.length === 0 ? (
                <div className="mt-5 rounded-[0.75rem] border border-dashed border-white/10 bg-black/10 px-5 py-8 text-center text-sm text-mist">
                  Nenhum jogador com jogo resolvido ainda na Serie{" "}
                  {selectedGroup.series}.
                </div>
              ) : (
                <div className="mt-5 overflow-hidden rounded-[0.75rem] border border-white/8">
                  <table className="min-w-full divide-y divide-white/8 text-left text-[12px]">
                    <thead className="bg-white/5 text-[10px] uppercase tracking-[0.2em] text-sage">
                      <tr>
                        <th className="w-[9rem] px-3 py-2.5 font-medium">
                          Jogador
                        </th>
                        <th className="px-2.5 py-2.5 font-medium">Sequencia</th>
                        <th className="w-[2.8rem] px-1 py-2.5 text-center font-medium">
                          Tot
                        </th>
                        <th className="w-[3.2rem] px-1 py-2.5 text-center font-medium">
                          APX
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-white/8 bg-black/10 text-mist">
                      {selectedGroup.playerRows.map((row) => (
                        <tr key={row.playerName}>
                          <td className="px-3 py-2.5">
                            <div className="text-[11.5px] font-semibold leading-tight text-ivory">
                              {row.playerName}
                            </div>
                            <div className="mt-0.5 text-[9px] uppercase tracking-[0.14em] text-mist/70">
                              W {row.wins} • D {row.draws} • L {row.losses}
                            </div>
                          </td>
                          <td className="px-2.5 py-2.5">
                            <div className="flex flex-wrap gap-[0.2rem]">
                              {row.sequence.map((item, index) =>
                                (() => {
                                  const { goalsFor, goalsAgainst } =
                                    parsePerspectiveScore(item.fullTimeScore);

                                  return (
                                    <Fragment key={item.matchId}>
                                      {index > 0 && index % 8 === 0 && (
                                        <div className="mx-0.5 flex items-center">
                                          <div className="h-4 w-px bg-white/20" />
                                        </div>
                                      )}
                                      <SequencePill
                                        result={item.result}
                                        goalsFor={goalsFor}
                                        goalsAgainst={goalsAgainst}
                                        title={`${item.localTimeLabel} | ${item.opponentName} | ${item.fullTimeScore}`}
                                      />
                                    </Fragment>
                                  );
                                })(),
                              )}
                            </div>
                          </td>
                          <td className="px-1 py-2.5 text-center text-[11px] font-semibold tabular-nums text-ivory">
                            {row.totalGames}
                          </td>
                          <td className="px-1 py-2.5 text-center text-[11px] font-semibold tabular-nums text-ivory">
                            {formatPercent(row.apx)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </article>
          </section>
        </>
      )}
    </>
  );
}
