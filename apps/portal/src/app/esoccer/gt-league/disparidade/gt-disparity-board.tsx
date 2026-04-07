"use client";

import clsx from "clsx";
import { useEffect, useState, useTransition } from "react";
import { usePathname, useRouter } from "next/navigation";
import type {
  PortalDisparityPairResponse,
  PortalDisparityPlayerOption,
} from "@/lib/portal-api";

const DISPARITY_DAY_FILTERS = [5, 10, 15, 30, 60] as const;
const DISPARITY_GAME_SLOTS = [1, 2, 3, 4, 5, 6] as const;
const DISPARITY_ANALYSIS_TABS = [
  { id: "patterns", label: "Padroes" },
  { id: "trend", label: "Tendencia" },
  { id: "orientation", label: "Orientacao" },
  { id: "recurrence", label: "Recorrencia" },
] as const;

type DisparityAnalysisTab = (typeof DISPARITY_ANALYSIS_TABS)[number]["id"];

type GTDisparityBoardProps = {
  players: PortalDisparityPlayerOption[];
  initialPlayerOne: string;
  initialPlayerTwo: string;
};

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
  const toneClass =
    resultCode === "1"
      ? "portal-disparity-result-badge portal-disparity-result-badge--win"
      : resultCode === "E"
        ? "portal-disparity-result-badge portal-disparity-result-badge--draw"
        : "portal-disparity-result-badge portal-disparity-result-badge--loss";

  return (
    <div
      title={`${localTimeLabel} | ${scoreLabel}`}
      className={clsx(
        "flex min-w-[2.7rem] flex-col items-center justify-center rounded-[0.65rem] border px-2 py-1.5 text-center transition-colors",
        toneClass,
      )}
    >
      <span className="text-[10px] font-medium leading-none opacity-80">
        {playerOneGoals}
      </span>
      <span className="mt-1 text-sm font-semibold leading-none">
        {resultCode}
      </span>
      <span className="mt-1 text-[10px] font-medium leading-none opacity-80">
        {playerTwoGoals}
      </span>
    </div>
  );
}

export function GTDisparityBoard({
  players,
  initialPlayerOne,
  initialPlayerTwo,
}: GTDisparityBoardProps) {
  const router = useRouter();
  const pathname = usePathname();
  const [isPending, startTransition] = useTransition();
  const [playerOne, setPlayerOne] = useState(initialPlayerOne);
  const [playerTwo, setPlayerTwo] = useState(initialPlayerTwo);
  const [availablePlayers, setAvailablePlayers] = useState(players);
  const [selectedDayCount, setSelectedDayCount] = useState<(typeof DISPARITY_DAY_FILTERS)[number]>(15);
  const [activeAnalysisTab, setActiveAnalysisTab] = useState<DisparityAnalysisTab>("patterns");
  const [pairData, setPairData] = useState<PortalDisparityPairResponse | null>(
    null,
  );
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    setAvailablePlayers(players);
    setPlayerOne(initialPlayerOne);
    setPlayerTwo(initialPlayerTwo);
  }, [players, initialPlayerOne, initialPlayerTwo]);

  useEffect(() => {
    if (availablePlayers.length > 0) {
      return;
    }

    let isActive = true;
    const controller = new AbortController();

    const loadPlayers = async () => {
      try {
        const response = await fetch("/api/disparidade/gt-options", {
          cache: "no-store",
          signal: controller.signal,
        });

        if (!response.ok) {
          return;
        }

        const payload = (await response.json()) as PortalDisparityPlayerOption[];

        if (isActive && Array.isArray(payload) && payload.length > 0) {
          setAvailablePlayers(payload);
        }
      } catch {
        // Keep the empty-state UX when the retry also fails.
      }
    };

    void loadPlayers();

    return () => {
      isActive = false;
      controller.abort();
    };
  }, [availablePlayers.length]);

  useEffect(() => {
    if (!playerOne || !playerTwo) {
      setPairData(null);
      setIsLoading(false);
      return;
    }

    if (playerOne.trim().toLowerCase() === playerTwo.trim().toLowerCase()) {
      setPairData(null);
      setIsLoading(false);
      return;
    }

    let isActive = true;
    const controller = new AbortController();

    const loadPair = async () => {
      setIsLoading(true);

      try {
        const response = await fetch(
          `/api/disparidade/gt-pair?player1=${encodeURIComponent(playerOne)}&player2=${encodeURIComponent(playerTwo)}`,
          {
            cache: "no-store",
            signal: controller.signal,
          },
        );

        if (!response.ok) {
          if (isActive) {
            setPairData(null);
          }
          return;
        }

        const payload = (await response.json()) as PortalDisparityPairResponse;

        if (isActive) {
          setPairData(payload);
        }
      } catch {
        if (isActive) {
          setPairData(null);
        }
      } finally {
        if (isActive) {
          setIsLoading(false);
        }
      }
    };

    void loadPair();

    return () => {
      isActive = false;
      controller.abort();
    };
  }, [playerOne, playerTwo]);

  const pushSelection = (nextPlayerOne: string, nextPlayerTwo: string) => {
    const params = new URLSearchParams();

    if (nextPlayerOne) {
      params.set("player1", nextPlayerOne);
    }

    if (nextPlayerTwo) {
      params.set("player2", nextPlayerTwo);
    }

    startTransition(() => {
      router.replace(
        params.size > 0 ? `${pathname}?${params.toString()}` : pathname,
        { scroll: false },
      );
    });
  };

  const handlePlayerOneChange = (value: string) => {
    setPlayerOne(value);
    pushSelection(value, playerTwo);
  };

  const handlePlayerTwoChange = (value: string) => {
    setPlayerTwo(value);
    pushSelection(playerOne, value);
  };

  const hasSelection = Boolean(playerOne && playerTwo);
  const hasInvalidSelection =
    hasSelection &&
    playerOne.trim().toLowerCase() === playerTwo.trim().toLowerCase();
  const rows = pairData?.rows ?? [];
  const filteredRows = rows.slice(0, selectedDayCount);
  const buildPatternKey = (row: (typeof filteredRows)[number]) =>
    `${row.playerOneWins}|${row.draws}|${row.playerTwoWins}`;

  const slotSummary = DISPARITY_GAME_SLOTS.map((slotNumber) => {
    const slotIndex = slotNumber - 1;
    let playerOneHits = 0;
    let draws = 0;
    let playerTwoHits = 0;

    for (const row of filteredRows) {
      const match = row.history[slotIndex];

      if (!match) {
        continue;
      }

      if (match.resultCode === "1") {
        playerOneHits += 1;
      } else if (match.resultCode === "E") {
        draws += 1;
      } else {
        playerTwoHits += 1;
      }
    }

    return {
      slotNumber,
      playerOneHits,
      draws,
      playerTwoHits,
      total: playerOneHits + draws + playerTwoHits,
    };
  });

  const patternRows = Array.from(
    filteredRows.reduce(
      (map, row) => {
        const key = buildPatternKey(row);
        const current = map.get(key) ?? {
          key,
          playerOneWins: row.playerOneWins,
          draws: row.draws,
          playerTwoWins: row.playerTwoWins,
          volume: 0,
          rows: [] as typeof filteredRows,
        };
        current.volume += 1;
        current.rows.push(row);
        map.set(key, current);
        return map;
      },
      new Map<
        string,
        {
          key: string;
          playerOneWins: number;
          draws: number;
          playerTwoWins: number;
          volume: number;
          rows: typeof filteredRows;
        }
      >(),
    ),
  )
    .map(([, item]) => ({
      ...item,
      share: filteredRows.length > 0 ? (item.volume / filteredRows.length) * 100 : 0,
      lastSeenLabel: item.rows[0]?.dateLabel ?? "--",
      previousSeenLabel: item.rows[1]?.dateLabel ?? null,
    }))
    .sort(
      (left, right) =>
        right.volume - left.volume ||
        right.playerTwoWins - left.playerTwoWins ||
        left.draws - right.draws ||
        left.playerOneWins - right.playerOneWins,
    );

  const totalsSummary = filteredRows.reduce(
    (accumulator, row) => {
      accumulator.playerOneWins += row.playerOneWins;
      accumulator.draws += row.draws;
      accumulator.playerTwoWins += row.playerTwoWins;
      accumulator.totalGames += row.totalGames;
      return accumulator;
    },
    {
      playerOneWins: 0,
      draws: 0,
      playerTwoWins: 0,
      totalGames: 0,
    },
  );

  const trendWindows = Array.from(
    new Set([3, 5, 10, selectedDayCount].filter((windowSize) => windowSize > 0)),
  )
    .map((windowSize) => {
      const subset = filteredRows.slice(0, windowSize);

      if (subset.length === 0) {
        return null;
      }

      const totals = subset.reduce(
        (accumulator, row) => {
          accumulator.playerOneWins += row.playerOneWins;
          accumulator.draws += row.draws;
          accumulator.playerTwoWins += row.playerTwoWins;
          accumulator.totalGames += row.totalGames;
          return accumulator;
        },
        {
          playerOneWins: 0,
          draws: 0,
          playerTwoWins: 0,
          totalGames: 0,
        },
      );

      const dominantPattern = Array.from(
        subset.reduce(
          (map, row) => {
            const key = buildPatternKey(row);
            const current = map.get(key) ?? {
              key,
              label: `${row.playerOneWins}-${row.draws}-${row.playerTwoWins}`,
              volume: 0,
            };
            current.volume += 1;
            map.set(key, current);
            return map;
          },
          new Map<string, { key: string; label: string; volume: number }>(),
        ),
      )
        .map(([, item]) => item)
        .sort((left, right) => right.volume - left.volume)[0] ?? null;

      return {
        label: `${windowSize} dias`,
        days: subset.length,
        playerOneWins: totals.playerOneWins,
        draws: totals.draws,
        playerTwoWins: totals.playerTwoWins,
        totalGames: totals.totalGames,
        dominantPatternLabel: dominantPattern?.label ?? "--",
        dominantPatternVolume: dominantPattern?.volume ?? 0,
        dominantPatternShare:
          subset.length > 0 && dominantPattern
            ? (dominantPattern.volume / subset.length) * 100
            : 0,
      };
    })
    .filter((item): item is NonNullable<typeof item> => item !== null);

  const orientationRows = [
    {
      label: `${pairData?.players.playerOne ?? "Player1"} x ${pairData?.players.playerTwo ?? "Player2"}`,
      items: filteredRows.flatMap((row) =>
        row.history.filter((match) => match.playerOneIsHome !== false),
      ),
    },
    {
      label: `${pairData?.players.playerTwo ?? "Player2"} x ${pairData?.players.playerOne ?? "Player1"}`,
      items: filteredRows.flatMap((row) =>
        row.history.filter((match) => match.playerOneIsHome === false),
      ),
    },
  ].map((orientation) => {
    const playerOneWins = orientation.items.filter(
      (item) => item.resultCode === "1",
    ).length;
    const draws = orientation.items.filter((item) => item.resultCode === "E").length;
    const playerTwoWins = orientation.items.filter(
      (item) => item.resultCode === "2",
    ).length;

    return {
      ...orientation,
      playerOneWins,
      draws,
      playerTwoWins,
      totalGames: orientation.items.length,
      latestFixtureLabel: orientation.items[0]?.fixtureLabel ?? "--",
      latestTimeLabel: orientation.items[0]?.localTimeLabel ?? "--",
    };
  });

  const currentPattern = filteredRows[0] ? buildPatternKey(filteredRows[0]) : null;
  const previousSamePatternRow = currentPattern
    ? filteredRows.slice(1).find((row) => buildPatternKey(row) === currentPattern) ?? null
    : null;
  const currentPatternDisplay = filteredRows[0]
    ? `${filteredRows[0].playerOneWins}-${filteredRows[0].draws}-${filteredRows[0].playerTwoWins}`
    : "--";
  const currentPatternStat = currentPattern
    ? patternRows.find((row) => row.key === currentPattern) ?? null
    : null;
  const recurrenceRows = patternRows
    .map((pattern) => ({
      key: pattern.key,
      label: `${pattern.playerOneWins}-${pattern.draws}-${pattern.playerTwoWins}`,
      volume: pattern.volume,
      share: pattern.share,
      lastSeenLabel: pattern.lastSeenLabel,
      previousSeenLabel: pattern.previousSeenLabel ?? "--",
      recurs: pattern.volume > 1 ? "Sim" : "Nao",
    }))
    .slice(0, 10);

  return (
    <>
      <section className="glass-panel rounded-[0.85rem] px-6 py-6">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <div className="text-xs uppercase tracking-[0.26em] text-sage">
              Filtro de confronto
            </div>
            <h2 className="mt-2 font-display text-3xl text-ivory">
              Leitura diaria entre dois jogadores
            </h2>
          </div>

          <div className="text-xs uppercase tracking-[0.22em] text-sage">
            {isLoading || isPending
              ? "Atualizando..."
              : `${filteredRows.length} de ${pairData?.totalRows ?? 0} dia(s)`}
          </div>
        </div>

        <div className="mt-6 grid gap-4 md:grid-cols-2">
          <label className="space-y-2">
            <span className="text-xs uppercase tracking-[0.22em] text-sage">
              Player1
            </span>
            <select
              value={playerOne}
              onChange={(event) => handlePlayerOneChange(event.target.value)}
              className="w-full rounded-[0.75rem] border border-white/10 bg-black/18 px-4 py-3 text-sm text-ivory outline-none transition focus:border-white/20 focus:bg-black/24"
            >
              <option value="">Selecione o player1</option>
              {availablePlayers.map((player) => (
                <option key={player.id} value={player.name}>
                  {player.name}
                </option>
              ))}
            </select>
          </label>

          <label className="space-y-2">
            <span className="text-xs uppercase tracking-[0.22em] text-sage">
              Player2
            </span>
            <select
              value={playerTwo}
              onChange={(event) => handlePlayerTwoChange(event.target.value)}
              className="w-full rounded-[0.75rem] border border-white/10 bg-black/18 px-4 py-3 text-sm text-ivory outline-none transition focus:border-white/20 focus:bg-black/24"
            >
              <option value="">Selecione o player2</option>
              {availablePlayers.map((player) => (
                <option key={player.id} value={player.name}>
                  {player.name}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div className="mt-6 flex flex-wrap gap-2">
          {DISPARITY_DAY_FILTERS.map((dayCount) => {
            const isActive = selectedDayCount === dayCount;

            return (
              <button
                key={dayCount}
                type="button"
                onClick={() => setSelectedDayCount(dayCount)}
                className={clsx(
                  "rounded-full border px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.16em] transition",
                  isActive
                    ? "border-ivory/30 bg-ivory text-ink shadow-sm"
                    : "border-white/10 bg-black/10 text-mist hover:border-white/20 hover:bg-black/14",
                )}
              >
                {dayCount} dias
              </button>
            );
          })}
        </div>
      </section>

      <section className="grid gap-5 xl:grid-cols-[minmax(0,1.45fr)_minmax(22rem,0.95fr)]">
        <div className="glass-panel rounded-[0.85rem] px-6 py-6">
        {!hasSelection ? (
          <div className="rounded-[0.75rem] border border-dashed border-white/10 bg-black/10 px-5 py-8 text-center text-sm text-mist">
            Selecione os dois jogadores da GT League para montar a tabela de
            disparidade.
          </div>
        ) : hasInvalidSelection ? (
          <div className="rounded-[0.75rem] border border-coral/25 bg-coral/10 px-5 py-8 text-center text-sm text-coral">
            Escolha dois jogadores diferentes para comparar.
          </div>
        ) : isLoading ? (
          <div className="rounded-[0.75rem] border border-dashed border-white/10 bg-black/10 px-5 py-8 text-center text-sm text-mist">
            Carregando historico do confronto...
          </div>
        ) : filteredRows.length === 0 ? (
          <div className="rounded-[0.75rem] border border-dashed border-white/10 bg-black/10 px-5 py-8 text-center text-sm text-mist">
            Nenhum historico encontrado para esse confronto.
          </div>
        ) : (
          <div className="overflow-hidden rounded-[0.75rem] border border-white/8">
            <table className="min-w-full table-fixed divide-y divide-white/8 text-left text-sm">
              <thead className="bg-white/5 text-[11px] uppercase tracking-[0.2em] text-sage">
                <tr>
                  <th className="w-[7.5rem] px-4 py-3 font-medium">Data</th>
                  <th className="w-[4.75rem] px-2 py-3 text-center font-medium">
                    {pairData?.players.playerOne ?? "Player1"}
                  </th>
                  <th className="w-[4.75rem] px-2 py-3 text-center font-medium">
                    Empate
                  </th>
                  <th className="w-[4.75rem] px-2 py-3 text-center font-medium">
                    {pairData?.players.playerTwo ?? "Player2"}
                  </th>
                  <th className="w-[1.25rem] px-0 py-3 text-center font-medium text-white/15">
                    |
                  </th>
                  <th className="px-4 py-3 font-medium">History</th>
                  <th className="w-[6rem] px-4 py-3 text-center font-medium">
                    Total
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/8 bg-black/10 text-mist">
                {filteredRows.map((row) => (
                  <tr key={row.dayKey}>
                    <td className="px-4 py-4">
                      <div className="font-medium text-ivory">
                        {row.dateLabel ?? "--"}
                      </div>
                    </td>

                    <td className="px-2 py-4 text-center">
                      <span
                        className={clsx(
                          "portal-disparity-total-badge inline-flex min-w-[3rem] items-center justify-center rounded-[0.55rem] px-3 py-1.5 font-semibold tabular-nums",
                          row.playerOneWins > row.playerTwoWins
                            ? "portal-disparity-total-badge--win"
                            : "portal-disparity-total-badge--neutral",
                        )}
                      >
                        {row.playerOneWins}
                      </span>
                    </td>

                    <td className="px-2 py-4 text-center">
                      <span className="portal-disparity-total-badge portal-disparity-total-badge--draw inline-flex min-w-[3rem] items-center justify-center rounded-[0.55rem] px-3 py-1.5 font-semibold tabular-nums">
                        {row.draws}
                      </span>
                    </td>

                    <td className="px-2 py-4 text-center">
                      <span
                        className={clsx(
                          "portal-disparity-total-badge inline-flex min-w-[3rem] items-center justify-center rounded-[0.55rem] px-3 py-1.5 font-semibold tabular-nums",
                          row.playerTwoWins > row.playerOneWins
                            ? "portal-disparity-total-badge--win"
                            : "portal-disparity-total-badge--neutral",
                        )}
                      >
                        {row.playerTwoWins}
                      </span>
                    </td>

                    <td className="px-0 py-4 text-center text-white/15">|</td>

                    <td className="px-4 py-4">
                      <div className="flex flex-wrap gap-2">
                        {row.history.map((match) => (
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

                    <td className="px-4 py-4 text-center font-semibold tabular-nums text-ivory">
                      {row.totalGames}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        </div>

        <div className="space-y-5">
          <section className="glass-panel rounded-[0.85rem] px-5 py-4">
            <div className="flex flex-wrap gap-2">
              {DISPARITY_ANALYSIS_TABS.map((tab) => {
                const isActive = activeAnalysisTab === tab.id;

                return (
                  <button
                    key={tab.id}
                    type="button"
                    onClick={() => setActiveAnalysisTab(tab.id)}
                    className={clsx(
                      "rounded-full border px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.16em] transition",
                      isActive
                        ? "border-ivory/30 bg-ivory text-ink shadow-sm"
                        : "border-white/10 bg-black/10 text-mist hover:border-white/20 hover:bg-black/14",
                    )}
                  >
                    {tab.label}
                  </button>
                );
              })}
            </div>
          </section>

          {activeAnalysisTab === "patterns" ? (
            <>
          <section className="glass-panel rounded-[0.85rem] px-5 py-5">
            <div className="flex items-start justify-between gap-4">
              <div>
                <div className="text-[11px] uppercase tracking-[0.22em] text-sage">
                  Leitura por jogo
                </div>
                <h3 className="mt-2 font-display text-2xl text-ivory">
                  Distribuicao J1 ate J6
                </h3>
              </div>

              <div className="text-right text-[11px] uppercase tracking-[0.2em] text-sage">
                <div>{selectedDayCount} dias</div>
                <div className="mt-1 text-[10px] text-mist">
                  {totalsSummary.totalGames} jogo(s)
                </div>
              </div>
            </div>

            {filteredRows.length === 0 ? (
              <div className="mt-5 rounded-[0.75rem] border border-dashed border-white/10 bg-black/10 px-4 py-6 text-center text-sm text-mist">
                Sem dias suficientes para montar a distribuicao.
              </div>
            ) : (
              <div className="mt-5 overflow-hidden rounded-[0.75rem] border border-white/8">
                <table className="min-w-full table-fixed divide-y divide-white/8 text-left text-sm">
                  <thead className="bg-white/5 text-[11px] uppercase tracking-[0.18em] text-sage">
                    <tr>
                      <th className="w-[6.5rem] px-3 py-3 font-medium">Linha</th>
                      {DISPARITY_GAME_SLOTS.map((slotNumber) => (
                        <th
                          key={slotNumber}
                          className="w-[3.4rem] px-1.5 py-3 text-center font-medium"
                        >
                          J{slotNumber}
                        </th>
                      ))}
                      <th className="w-[4.25rem] px-3 py-3 text-center font-medium">
                        Total
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/8 bg-black/10 text-mist">
                    <tr>
                      <td className="px-3 py-3">
                        <div className="font-medium text-ivory">
                          {pairData?.players.playerOne ?? "Player1"}
                        </div>
                      </td>
                      {slotSummary.map((slot) => (
                        <td key={`p1-${slot.slotNumber}`} className="px-1.5 py-3 text-center">
                          <span className="portal-disparity-total-badge portal-disparity-total-badge--win inline-flex min-w-[2.5rem] items-center justify-center rounded-[0.55rem] px-2 py-1.5 font-semibold tabular-nums">
                            {slot.playerOneHits}
                          </span>
                        </td>
                      ))}
                      <td className="px-3 py-3 text-center">
                        <span className="portal-disparity-total-badge portal-disparity-total-badge--win inline-flex min-w-[2.8rem] items-center justify-center rounded-[0.55rem] px-2.5 py-1.5 font-semibold tabular-nums">
                          {totalsSummary.playerOneWins}
                        </span>
                      </td>
                    </tr>

                    <tr>
                      <td className="px-3 py-3">
                        <div className="font-medium text-ivory">Empates</div>
                      </td>
                      {slotSummary.map((slot) => (
                        <td key={`draw-${slot.slotNumber}`} className="px-1.5 py-3 text-center">
                          <span className="portal-disparity-total-badge portal-disparity-total-badge--draw inline-flex min-w-[2.5rem] items-center justify-center rounded-[0.55rem] px-2 py-1.5 font-semibold tabular-nums">
                            {slot.draws}
                          </span>
                        </td>
                      ))}
                      <td className="px-3 py-3 text-center">
                        <span className="portal-disparity-total-badge portal-disparity-total-badge--draw inline-flex min-w-[2.8rem] items-center justify-center rounded-[0.55rem] px-2.5 py-1.5 font-semibold tabular-nums">
                          {totalsSummary.draws}
                        </span>
                      </td>
                    </tr>

                    <tr>
                      <td className="px-3 py-3">
                        <div className="font-medium text-ivory">
                          {pairData?.players.playerTwo ?? "Player2"}
                        </div>
                      </td>
                      {slotSummary.map((slot) => (
                        <td key={`p2-${slot.slotNumber}`} className="px-1.5 py-3 text-center">
                          <span className="portal-disparity-total-badge portal-disparity-total-badge--loss inline-flex min-w-[2.5rem] items-center justify-center rounded-[0.55rem] px-2 py-1.5 font-semibold tabular-nums">
                            {slot.playerTwoHits}
                          </span>
                        </td>
                      ))}
                      <td className="px-3 py-3 text-center">
                        <span className="portal-disparity-total-badge portal-disparity-total-badge--loss inline-flex min-w-[2.8rem] items-center justify-center rounded-[0.55rem] px-2.5 py-1.5 font-semibold tabular-nums">
                          {totalsSummary.playerTwoWins}
                        </span>
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <section className="glass-panel rounded-[0.85rem] px-5 py-5">
            <div className="flex items-start justify-between gap-4">
              <div>
                <div className="text-[11px] uppercase tracking-[0.22em] text-sage">
                  Rank de padroes
                </div>
                <h3 className="mt-2 font-display text-2xl text-ivory">
                  Padroes de vitorias
                </h3>
              </div>

              <div className="text-right text-[11px] uppercase tracking-[0.2em] text-sage">
                <div>{patternRows.length} padrao(oes)</div>
                <div className="mt-1 text-[10px] text-mist">
                  {selectedDayCount} dias
                </div>
              </div>
            </div>

            {filteredRows.length === 0 ? (
              <div className="mt-5 rounded-[0.75rem] border border-dashed border-white/10 bg-black/10 px-4 py-6 text-center text-sm text-mist">
                Sem dias suficientes para montar o ranking.
              </div>
            ) : (
              <div className="mt-5 overflow-hidden rounded-[0.75rem] border border-white/8">
                <table className="min-w-full table-fixed divide-y divide-white/8 text-left text-sm">
                  <thead className="bg-white/5 text-[11px] uppercase tracking-[0.18em] text-sage">
                    <tr>
                      <th className="px-3 py-3 font-medium">
                        {pairData?.players.playerOne ?? "Player1"}
                      </th>
                      <th className="px-3 py-3 text-center font-medium">Empate</th>
                      <th className="px-3 py-3 text-center font-medium">
                        {pairData?.players.playerTwo ?? "Player2"}
                      </th>
                      <th className="px-3 py-3 text-center font-medium">Volume</th>
                      <th className="px-3 py-3 text-center font-medium">% total</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/8 bg-black/10 text-mist">
                    {patternRows.map((pattern) => (
                      <tr key={pattern.key}>
                        <td className="px-3 py-3 text-center">
                          <span className="portal-disparity-total-badge portal-disparity-total-badge--win inline-flex min-w-[2.8rem] items-center justify-center rounded-[0.55rem] px-2.5 py-1.5 font-semibold tabular-nums">
                            {pattern.playerOneWins}
                          </span>
                        </td>
                        <td className="px-3 py-3 text-center">
                          <span className="portal-disparity-total-badge portal-disparity-total-badge--draw inline-flex min-w-[2.8rem] items-center justify-center rounded-[0.55rem] px-2.5 py-1.5 font-semibold tabular-nums">
                            {pattern.draws}
                          </span>
                        </td>
                        <td className="px-3 py-3 text-center">
                          <span className="portal-disparity-total-badge portal-disparity-total-badge--loss inline-flex min-w-[2.8rem] items-center justify-center rounded-[0.55rem] px-2.5 py-1.5 font-semibold tabular-nums">
                            {pattern.playerTwoWins}
                          </span>
                        </td>
                        <td className="px-3 py-3 text-center">
                          <span className="portal-disparity-total-badge portal-disparity-total-badge--neutral inline-flex min-w-[3rem] items-center justify-center rounded-[0.55rem] px-2.5 py-1.5 font-semibold tabular-nums">
                            {pattern.volume}
                          </span>
                        </td>
                        <td className="px-3 py-3 text-center font-semibold tabular-nums text-ivory">
                          {pattern.share.toFixed(1)}%
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
            </>
          ) : null}

          {activeAnalysisTab === "trend" ? (
            <section className="glass-panel rounded-[0.85rem] px-5 py-5">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <div className="text-[11px] uppercase tracking-[0.22em] text-sage">
                    Tendencia recente
                  </div>
                  <h3 className="mt-2 font-display text-2xl text-ivory">
                    Recencia dos padroes
                  </h3>
                </div>
                <div className="text-right text-[11px] uppercase tracking-[0.2em] text-sage">
                  <div>{trendWindows.length} janela(s)</div>
                  <div className="mt-1 text-[10px] text-mist">
                    {selectedDayCount} dias
                  </div>
                </div>
              </div>

              {trendWindows.length === 0 ? (
                <div className="mt-5 rounded-[0.75rem] border border-dashed border-white/10 bg-black/10 px-4 py-6 text-center text-sm text-mist">
                  Sem dados suficientes para montar a tendencia.
                </div>
              ) : (
                <div className="mt-5 overflow-hidden rounded-[0.75rem] border border-white/8">
                  <table className="min-w-full table-fixed divide-y divide-white/8 text-left text-sm">
                    <thead className="bg-white/5 text-[11px] uppercase tracking-[0.18em] text-sage">
                      <tr>
                        <th className="px-3 py-3 font-medium">Janela</th>
                        <th className="px-3 py-3 text-center font-medium">
                          {pairData?.players.playerOne ?? "Player1"}
                        </th>
                        <th className="px-3 py-3 text-center font-medium">Empate</th>
                        <th className="px-3 py-3 text-center font-medium">
                          {pairData?.players.playerTwo ?? "Player2"}
                        </th>
                        <th className="px-3 py-3 text-center font-medium">Jogos</th>
                        <th className="px-3 py-3 text-center font-medium">Padrao</th>
                        <th className="px-3 py-3 text-center font-medium">% padrao</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-white/8 bg-black/10 text-mist">
                      {trendWindows.map((trend) => (
                        <tr key={trend.label}>
                          <td className="px-3 py-3 font-medium text-ivory">{trend.label}</td>
                          <td className="px-3 py-3 text-center">
                            <span className="portal-disparity-total-badge portal-disparity-total-badge--win inline-flex min-w-[2.8rem] items-center justify-center rounded-[0.55rem] px-2.5 py-1.5 font-semibold tabular-nums">
                              {trend.playerOneWins}
                            </span>
                          </td>
                          <td className="px-3 py-3 text-center">
                            <span className="portal-disparity-total-badge portal-disparity-total-badge--draw inline-flex min-w-[2.8rem] items-center justify-center rounded-[0.55rem] px-2.5 py-1.5 font-semibold tabular-nums">
                              {trend.draws}
                            </span>
                          </td>
                          <td className="px-3 py-3 text-center">
                            <span className="portal-disparity-total-badge portal-disparity-total-badge--loss inline-flex min-w-[2.8rem] items-center justify-center rounded-[0.55rem] px-2.5 py-1.5 font-semibold tabular-nums">
                              {trend.playerTwoWins}
                            </span>
                          </td>
                          <td className="px-3 py-3 text-center">
                            <span className="portal-disparity-total-badge portal-disparity-total-badge--neutral inline-flex min-w-[3rem] items-center justify-center rounded-[0.55rem] px-2.5 py-1.5 font-semibold tabular-nums">
                              {trend.totalGames}
                            </span>
                          </td>
                          <td className="px-3 py-3 text-center font-semibold tabular-nums text-ivory">
                            {trend.dominantPatternLabel}
                          </td>
                          <td className="px-3 py-3 text-center font-semibold tabular-nums text-ivory">
                            {trend.dominantPatternShare.toFixed(1)}%
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          ) : null}

          {activeAnalysisTab === "orientation" ? (
            <section className="glass-panel rounded-[0.85rem] px-5 py-5">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <div className="text-[11px] uppercase tracking-[0.22em] text-sage">
                    Orientacao do confronto
                  </div>
                  <h3 className="mt-2 font-display text-2xl text-ivory">
                    Leitura por lado real
                  </h3>
                </div>
                <div className="text-right text-[11px] uppercase tracking-[0.2em] text-sage">
                  <div>{orientationRows.length} visao(oes)</div>
                  <div className="mt-1 text-[10px] text-mist">
                    {selectedDayCount} dias
                  </div>
                </div>
              </div>

              <div className="mt-5 overflow-hidden rounded-[0.75rem] border border-white/8">
                <table className="min-w-full table-fixed divide-y divide-white/8 text-left text-sm">
                  <thead className="bg-white/5 text-[11px] uppercase tracking-[0.18em] text-sage">
                    <tr>
                      <th className="px-3 py-3 font-medium">Orientacao</th>
                      <th className="px-3 py-3 text-center font-medium">
                        {pairData?.players.playerOne ?? "Player1"}
                      </th>
                      <th className="px-3 py-3 text-center font-medium">Empate</th>
                      <th className="px-3 py-3 text-center font-medium">
                        {pairData?.players.playerTwo ?? "Player2"}
                      </th>
                      <th className="px-3 py-3 text-center font-medium">Jogos</th>
                      <th className="px-3 py-3 text-center font-medium">Ultimo</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/8 bg-black/10 text-mist">
                    {orientationRows.map((orientation) => (
                      <tr key={orientation.label}>
                        <td className="px-3 py-3">
                          <div className="font-medium text-ivory">{orientation.label}</div>
                          <div className="mt-1 text-[11px] text-mist/80">
                            {orientation.latestTimeLabel} | {orientation.latestFixtureLabel}
                          </div>
                        </td>
                        <td className="px-3 py-3 text-center">
                          <span className="portal-disparity-total-badge portal-disparity-total-badge--win inline-flex min-w-[2.8rem] items-center justify-center rounded-[0.55rem] px-2.5 py-1.5 font-semibold tabular-nums">
                            {orientation.playerOneWins}
                          </span>
                        </td>
                        <td className="px-3 py-3 text-center">
                          <span className="portal-disparity-total-badge portal-disparity-total-badge--draw inline-flex min-w-[2.8rem] items-center justify-center rounded-[0.55rem] px-2.5 py-1.5 font-semibold tabular-nums">
                            {orientation.draws}
                          </span>
                        </td>
                        <td className="px-3 py-3 text-center">
                          <span className="portal-disparity-total-badge portal-disparity-total-badge--loss inline-flex min-w-[2.8rem] items-center justify-center rounded-[0.55rem] px-2.5 py-1.5 font-semibold tabular-nums">
                            {orientation.playerTwoWins}
                          </span>
                        </td>
                        <td className="px-3 py-3 text-center">
                          <span className="portal-disparity-total-badge portal-disparity-total-badge--neutral inline-flex min-w-[3rem] items-center justify-center rounded-[0.55rem] px-2.5 py-1.5 font-semibold tabular-nums">
                            {orientation.totalGames}
                          </span>
                        </td>
                        <td className="px-3 py-3 text-center font-semibold tabular-nums text-ivory">
                          {orientation.latestTimeLabel}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          ) : null}

          {activeAnalysisTab === "recurrence" ? (
            <section className="glass-panel rounded-[0.85rem] px-5 py-5">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <div className="text-[11px] uppercase tracking-[0.22em] text-sage">
                    Recorrencia
                  </div>
                  <h3 className="mt-2 font-display text-2xl text-ivory">
                    Repeticao de padroes
                  </h3>
                </div>
                <div className="text-right text-[11px] uppercase tracking-[0.2em] text-sage">
                  <div>{recurrenceRows.length} padrao(oes)</div>
                  <div className="mt-1 text-[10px] text-mist">
                    {selectedDayCount} dias
                  </div>
                </div>
              </div>

              {filteredRows.length === 0 ? (
                <div className="mt-5 rounded-[0.75rem] border border-dashed border-white/10 bg-black/10 px-4 py-6 text-center text-sm text-mist">
                  Sem dados suficientes para montar a recorrencia.
                </div>
              ) : (
                <>
                  <div className="mt-5 grid gap-3 sm:grid-cols-3">
                    <div className="soft-panel rounded-[0.75rem] px-4 py-4">
                      <div className="text-[11px] uppercase tracking-[0.18em] text-sage">
                        Padrao atual
                      </div>
                      <div className="mt-2 text-xl font-semibold text-ivory">
                        {currentPatternDisplay}
                      </div>
                    </div>
                    <div className="soft-panel rounded-[0.75rem] px-4 py-4">
                      <div className="text-[11px] uppercase tracking-[0.18em] text-sage">
                        Ultima repeticao
                      </div>
                      <div className="mt-2 text-xl font-semibold text-ivory">
                        {previousSamePatternRow?.dateLabel ?? "--"}
                      </div>
                    </div>
                    <div className="soft-panel rounded-[0.75rem] px-4 py-4">
                      <div className="text-[11px] uppercase tracking-[0.18em] text-sage">
                        Volume do atual
                      </div>
                      <div className="mt-2 text-xl font-semibold text-ivory">
                        {currentPatternStat?.volume ?? 0}
                      </div>
                    </div>
                  </div>

                  <div className="mt-5 overflow-hidden rounded-[0.75rem] border border-white/8">
                    <table className="min-w-full table-fixed divide-y divide-white/8 text-left text-sm">
                      <thead className="bg-white/5 text-[11px] uppercase tracking-[0.18em] text-sage">
                        <tr>
                          <th className="px-3 py-3 font-medium">Padrao</th>
                          <th className="px-3 py-3 text-center font-medium">Volume</th>
                          <th className="px-3 py-3 text-center font-medium">% total</th>
                          <th className="px-3 py-3 text-center font-medium">Ultima vez</th>
                          <th className="px-3 py-3 text-center font-medium">Anterior</th>
                          <th className="px-3 py-3 text-center font-medium">Recorre</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-white/8 bg-black/10 text-mist">
                        {recurrenceRows.map((pattern) => (
                          <tr key={pattern.key}>
                            <td className="px-3 py-3 font-semibold tabular-nums text-ivory">
                              {pattern.label}
                            </td>
                            <td className="px-3 py-3 text-center">
                              <span className="portal-disparity-total-badge portal-disparity-total-badge--neutral inline-flex min-w-[3rem] items-center justify-center rounded-[0.55rem] px-2.5 py-1.5 font-semibold tabular-nums">
                                {pattern.volume}
                              </span>
                            </td>
                            <td className="px-3 py-3 text-center font-semibold tabular-nums text-ivory">
                              {pattern.share.toFixed(1)}%
                            </td>
                            <td className="px-3 py-3 text-center text-ivory">
                              {pattern.lastSeenLabel}
                            </td>
                            <td className="px-3 py-3 text-center text-mist">
                              {pattern.previousSeenLabel}
                            </td>
                            <td className="px-3 py-3 text-center">
                              <span
                                className={clsx(
                                  "portal-disparity-total-badge inline-flex min-w-[3rem] items-center justify-center rounded-[0.55rem] px-2.5 py-1.5 font-semibold tabular-nums",
                                  pattern.recurs === "Sim"
                                    ? "portal-disparity-total-badge--win"
                                    : "portal-disparity-total-badge--neutral",
                                )}
                              >
                                {pattern.recurs}
                              </span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </>
              )}
            </section>
          ) : null}
        </div>
      </section>
    </>
  );
}
