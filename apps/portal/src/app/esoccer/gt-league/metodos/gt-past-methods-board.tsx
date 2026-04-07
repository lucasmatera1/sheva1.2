"use client";

import clsx from "clsx";
import { useEffect, useMemo, useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import type { PortalGTPastMethodRow } from "@/lib/portal-api";
import { formatCompactDateTime } from "@/lib/format";

const GT_SERIES = ["A", "B", "C", "D", "E", "F", "G"] as const;
const PERIODS = [1, 3, 5, 7, 10, 15, 20, 30] as const;
const GT_METHODS_AUTO_REFRESH_MS = 5 * 60 * 1000;
const TABS = [
  { key: "player", label: "Jogador x Metodo" },
  { key: "method", label: "Metodo x Serie" },
  { key: "trend", label: "Tendencia / Recencia" },
] as const;

type TabKey = (typeof TABS)[number]["key"];
type SortDirection = "asc" | "desc";

type SortState = {
  key: string;
  direction: SortDirection;
};

type PlayerMethodRow = {
  id: string;
  playerName: string;
  methodCode: string;
  seriesLabel: string;
  volume: number;
  wins: number;
  draws: number;
  losses: number;
  apx: number;
  lastOccurrenceIso: string;
  lastOccurrenceLabel: string;
  details: PortalGTPastMethodRow[];
};

type MethodSeriesRow = {
  id: string;
  methodCode: string;
  seriesLabel: string;
  players: number;
  volume: number;
  wins: number;
  draws: number;
  losses: number;
  apx: number;
  lastOccurrenceIso: string;
  lastOccurrenceLabel: string;
  details: PortalGTPastMethodRow[];
};

type TrendRow = {
  id: string;
  methodCode: string;
  seriesLabel: string;
  volume1d: number;
  apx1d: number;
  volume3d: number | null;
  apx3d: number | null;
  volume5d: number | null;
  apx5d: number | null;
  delta: number | null;
  lastOccurrenceIso: string;
  lastOccurrenceLabel: string;
  details: PortalGTPastMethodRow[];
};

function buildDistinctDayKeys(rows: PortalGTPastMethodRow[]) {
  return Array.from(new Set(rows.map((row) => row.dayKey))).sort((left, right) =>
    right.localeCompare(left),
  );
}

function normalizeMethodLabel(methodCode: string) {
  return methodCode.trim() || "Sem metodo";
}

function averageApx(rows: PortalGTPastMethodRow[]) {
  if (rows.length === 0) {
    return 0;
  }

  const total = rows.reduce((sum, row) => sum + row.apx, 0);
  return Number((total / rows.length).toFixed(2));
}

function formatPercent(value: number | null) {
  if (value === null || Number.isNaN(value)) {
    return "--";
  }

  return `${value.toFixed(2)}%`;
}

function formatDayLabel(dayKey: string) {
  const [, month, day] = dayKey.split("-");
  return `${day}/${month}`;
}

function countResolvedResults(rows: PortalGTPastMethodRow[]) {
  return rows.reduce(
    (totals, row) => {
      if (row.result === "W") {
        totals.wins += 1;
      } else if (row.result === "L") {
        totals.losses += 1;
      } else {
        totals.draws += 1;
      }

      return totals;
    },
    { wins: 0, draws: 0, losses: 0 },
  );
}

function formatSeriesLabel(seriesValues: string[]) {
  if (seriesValues.length === 0) {
    return "--";
  }

  if (seriesValues.length === 1) {
    return `Serie ${seriesValues[0]}`;
  }

  return `Series ${seriesValues.join(", ")}`;
}

function compareValues(
  left: number | string | null,
  right: number | string | null,
  direction: SortDirection,
) {
  const normalizedLeft = left ?? "";
  const normalizedRight = right ?? "";

  if (typeof normalizedLeft === "number" && typeof normalizedRight === "number") {
    return direction === "asc" ? normalizedLeft - normalizedRight : normalizedRight - normalizedLeft;
  }

  const leftString = String(normalizedLeft);
  const rightString = String(normalizedRight);

  return direction === "asc"
    ? leftString.localeCompare(rightString, "pt-BR", { sensitivity: "base" })
    : rightString.localeCompare(leftString, "pt-BR", { sensitivity: "base" });
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

function FilterIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="none" aria-hidden="true" className="h-4 w-4">
      <path
        d="M4.25 5.25h11.5l-4.5 5v4l-2.5 1.5v-5.5l-4.5-5Z"
        stroke="currentColor"
        strokeWidth="1.45"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" aria-hidden="true" className="h-3.5 w-3.5">
      <path
        d="m3.5 8.1 2.2 2.2 4.8-5"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function DashboardShortcutIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="none" aria-hidden="true" className="h-4 w-4">
      <rect x="3.25" y="3.25" width="5.25" height="5.25" rx="1.1" stroke="currentColor" strokeWidth="1.4" />
      <rect x="11.5" y="3.25" width="5.25" height="5.25" rx="1.1" stroke="currentColor" strokeWidth="1.4" />
      <rect x="3.25" y="11.5" width="5.25" height="5.25" rx="1.1" stroke="currentColor" strokeWidth="1.4" />
      <rect x="11.5" y="11.5" width="5.25" height="5.25" rx="1.1" stroke="currentColor" strokeWidth="1.4" />
    </svg>
  );
}

function HistoryShortcutIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="none" aria-hidden="true" className="h-4 w-4">
      <path
        d="M4.75 6.25V3.75M15.25 6.25V3.75M4.25 8.25H15.75M6.5 11.25H10.25M6.5 14H12.75"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
      />
      <rect x="3.25" y="5.25" width="13.5" height="11.5" rx="2" stroke="currentColor" strokeWidth="1.4" />
    </svg>
  );
}

function RefreshIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="none" aria-hidden="true" className="h-4 w-4">
      <path
        d="M15.8 7.2A6.2 6.2 0 0 0 5.5 5.6M4.2 2.9v3.6h3.6M4.2 12.8A6.2 6.2 0 0 0 14.5 14.4m1.3 2.7v-3.6h-3.6"
        stroke="currentColor"
        strokeWidth="1.45"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function ResultPill({ result }: { result: PortalGTPastMethodRow["result"] }) {
  return (
    <span
      className={clsx(
        "inline-flex min-w-[3rem] items-center justify-center rounded-[0.65rem] px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.18em]",
        result === "W" && "bg-emerald-400/14 text-emerald-100",
        (result === "D" || result === "E") && "bg-amber-300/14 text-amber-100",
        result === "L" && "bg-rose-400/14 text-rose-100",
      )}
    >
      {result}
    </span>
  );
}

function MetricCountBadge({
  tone,
  value,
}: {
  tone: "win" | "draw" | "loss";
  value: number;
}) {
  return (
    <span
      className={clsx(
        "portal-live-total-badge inline-flex min-w-[2.4rem] items-center justify-center rounded-[0.55rem] border px-2.5 py-1 text-xs font-semibold tabular-nums",
        tone === "win" && "portal-live-total-badge--win",
        tone === "draw" && "portal-live-total-badge--draw",
        tone === "loss" && "portal-live-total-badge--loss",
      )}
    >
      {value}
    </span>
  );
}

function SortHeader({
  label,
  active,
  direction,
  onClick,
  align = "left",
}: {
  label: string;
  active: boolean;
  direction: SortDirection;
  onClick: () => void;
  align?: "left" | "center";
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={clsx(
        "inline-flex items-center gap-2 font-medium transition hover:text-ivory",
        align === "center" ? "justify-center text-center" : "justify-start",
      )}
    >
      <span>{label}</span>
      <span className={clsx("text-[10px]", active ? "text-ivory" : "text-sage/55")}>
        {active ? (direction === "asc" ? "ASC" : "DESC") : "--"}
      </span>
    </button>
  );
}

function MethodOptionRow({
  label,
  checked,
  onClick,
}: {
  label: string;
  checked: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-center gap-3 rounded-[0.6rem] px-2 py-2 text-left text-sm text-ivory transition hover:bg-white/[0.05]"
    >
      <span
        className={clsx(
          "flex h-4.5 w-4.5 items-center justify-center rounded-[0.25rem] border",
          checked
            ? "border-[#c9e3da]/60 bg-[#dcece6] text-obsidian"
            : "border-white/18 bg-transparent text-transparent",
        )}
      >
        <CheckIcon />
      </span>
      <span className="truncate">{label}</span>
    </button>
  );
}

function ActiveFilterChip({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  return (
    <span className="inline-flex items-center gap-2 rounded-[0.65rem] border border-white/10 bg-white/[0.04] px-3 py-1.5 text-xs text-mist">
      <span className="uppercase tracking-[0.18em] text-sage">{label}</span>
      <span className="font-medium text-ivory">{value}</span>
    </span>
  );
}

function ExpandedOccurrences({ rows }: { rows: PortalGTPastMethodRow[] }) {
  return (
    <div className="rounded-[0.75rem] border border-white/8 bg-black/15 px-4 py-4">
      <div className="grid gap-2">
        {rows.slice(0, 6).map((row) => (
          <div
            key={row.id}
            className="flex flex-col gap-1 rounded-[0.65rem] border border-white/8 bg-white/[0.03] px-3 py-3 text-sm text-mist md:flex-row md:items-center md:justify-between"
          >
            <div>
              <div className="font-medium text-ivory">{row.confrontationLabel}</div>
              <div className="mt-1 text-xs text-mist/70">
                GT League - Serie {row.series} - Metodo {row.methodCode}
              </div>
            </div>
            <div className="flex items-center gap-3 text-xs md:text-sm">
              <span className="tabular-nums">{row.playedAtLabel}</span>
              <span className="tabular-nums">{row.fullTimeScore}</span>
              <ResultPill result={row.result} />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function EmptyState({ message }: { message: string }) {
  return (
    <div className="rounded-[0.75rem] border border-dashed border-white/10 bg-black/10 px-5 py-10 text-center text-sm text-mist">
      {message}
    </div>
  );
}

function ExpandableTableRow({
  children,
  expanded,
  onToggle,
  expandedContent,
  colSpan,
}: {
  children: ReactNode;
  expanded: boolean;
  onToggle: () => void;
  expandedContent: ReactNode;
  colSpan: number;
}) {
  return (
    <>
      <tr className="cursor-pointer transition hover:bg-white/[0.03]" onClick={onToggle}>
        {children}
      </tr>
      {expanded ? (
        <tr className="bg-black/18">
          <td colSpan={colSpan} className="px-4 py-4">
            {expandedContent}
          </td>
        </tr>
      ) : null}
    </>
  );
}

export function GTPastMethodsBoard({
  rows,
  lastSuccessfulSyncAt,
  lastPublishedAt,
}: {
  rows: PortalGTPastMethodRow[];
  lastSuccessfulSyncAt: string | null;
  lastPublishedAt: string | null;
}) {
  const router = useRouter();
  const [isRefreshing, startRefreshTransition] = useTransition();
  const [isSyncingMethods, setIsSyncingMethods] = useState(false);
  const [activeTab, setActiveTab] = useState<TabKey>("player");
  const [selectedPeriod, setSelectedPeriod] = useState<(typeof PERIODS)[number]>(5);
  const [selectedSeries, setSelectedSeries] = useState<string[]>([...GT_SERIES]);
  const [searchQuery, setSearchQuery] = useState("");
  const [playerFilter, setPlayerFilter] = useState("");
  const [volumeMin, setVolumeMin] = useState("1");
  const [methodFilterOpen, setMethodFilterOpen] = useState(false);
  const [methodQuery, setMethodQuery] = useState("");
  const [selectedMethods, setSelectedMethods] = useState<string[]>([]);
  const [hasCustomMethodSelection, setHasCustomMethodSelection] = useState(false);
  const [expandedRowId, setExpandedRowId] = useState<string | null>(null);
  const [sortByTab, setSortByTab] = useState<Record<TabKey, SortState>>({
    player: { key: "apx", direction: "desc" },
    method: { key: "volume", direction: "desc" },
    trend: { key: "delta", direction: "desc" },
  });
  const [occurrenceSort, setOccurrenceSort] = useState<SortState>({
    key: "playedAtIso",
    direction: "desc",
  });

  const allDayKeys = useMemo(() => buildDistinctDayKeys(rows), [rows]);
  const selectedDayKeys = useMemo(
    () => allDayKeys.slice(0, selectedPeriod),
    [allDayKeys, selectedPeriod],
  );
  const pastResultsDayKeys = useMemo(() => allDayKeys.slice(0, 2), [allDayKeys]);
  const selectedDayKeySet = useMemo(() => new Set(selectedDayKeys), [selectedDayKeys]);
  const pastResultsDayKeySet = useMemo(() => new Set(pastResultsDayKeys), [pastResultsDayKeys]);
  const minimumVolume = Number.parseInt(volumeMin, 10);

  const availableMethods = useMemo(
    () =>
      Array.from(new Set(rows.map((row) => normalizeMethodLabel(row.methodCode)))).sort((left, right) =>
        left.localeCompare(right, "pt-BR", { sensitivity: "base" }),
      ),
    [rows],
  );

  useEffect(() => {
    setSelectedMethods((current) => {
      if (availableMethods.length === 0) return [];
      if (!hasCustomMethodSelection || current.length === 0) return availableMethods;
      const next = current.filter((method) => availableMethods.includes(method));
      return next.length > 0 ? next : availableMethods;
    });
  }, [availableMethods, hasCustomMethodSelection]);

  const visibleMethods = useMemo(
    () =>
      availableMethods.filter((method) =>
        method.toLowerCase().includes(methodQuery.trim().toLowerCase()),
      ),
    [availableMethods, methodQuery],
  );

  const scopedRows = useMemo(() => {
    const normalizedSearch = searchQuery.trim().toLowerCase();
    const normalizedPlayer = playerFilter.trim().toLowerCase();

    return rows.filter((row) => {
      if (!selectedDayKeySet.has(row.dayKey)) return false;
      if (!selectedSeries.includes(row.series.toUpperCase())) return false;
      if (hasCustomMethodSelection && selectedMethods.length === 0) return false;
      if (
        selectedMethods.length > 0 &&
        !selectedMethods.includes(normalizeMethodLabel(row.methodCode))
      ) {
        return false;
      }

      if (
        normalizedPlayer &&
        !row.playerName.toLowerCase().includes(normalizedPlayer) &&
        !row.opponentName.toLowerCase().includes(normalizedPlayer)
      ) {
        return false;
      }

      if (
        normalizedSearch &&
        !row.confrontationLabel.toLowerCase().includes(normalizedSearch) &&
        !row.methodCode.toLowerCase().includes(normalizedSearch) &&
        !row.playerName.toLowerCase().includes(normalizedSearch) &&
        !row.opponentName.toLowerCase().includes(normalizedSearch) &&
        !row.series.toLowerCase().includes(normalizedSearch)
      ) {
        return false;
      }

      return true;
    });
  }, [rows, hasCustomMethodSelection, selectedDayKeySet, selectedMethods, selectedSeries, searchQuery, playerFilter]);

  const playerRows = useMemo(() => {
    const grouped = new Map<string, PortalGTPastMethodRow[]>();

    for (const row of scopedRows) {
      const key = `${row.playerName}::${normalizeMethodLabel(row.methodCode)}`;
      const list = grouped.get(key);
      if (list) list.push(row);
      else grouped.set(key, [row]);
    }

    const next = Array.from(grouped.entries()).map(([id, details]) => {
      const sortedDetails = [...details].sort((left, right) =>
        right.playedAtIso.localeCompare(left.playedAtIso),
      );
      const resultCounts = countResolvedResults(sortedDetails);

      return {
        id,
        playerName: sortedDetails[0]?.playerName ?? "--",
        methodCode: normalizeMethodLabel(sortedDetails[0]?.methodCode ?? ""),
        seriesLabel: formatSeriesLabel(
          Array.from(new Set(sortedDetails.map((detail) => detail.series))).sort(),
        ),
        volume: sortedDetails.length,
        wins: resultCounts.wins,
        draws: resultCounts.draws,
        losses: resultCounts.losses,
        apx: averageApx(sortedDetails),
        lastOccurrenceIso: sortedDetails[0]?.playedAtIso ?? "",
        lastOccurrenceLabel: sortedDetails[0]?.playedAtLabel ?? "--",
        details: sortedDetails,
      } satisfies PlayerMethodRow;
    });

    const filteredByVolume = next.filter((row) =>
      Number.isFinite(minimumVolume) && minimumVolume > 1 ? row.volume >= minimumVolume : true,
    );

    const sortState = sortByTab.player;
    return filteredByVolume.sort((left, right) => {
      switch (sortState.key) {
        case "playerName":
          return compareValues(left.playerName, right.playerName, sortState.direction);
        case "methodCode":
          return compareValues(left.methodCode, right.methodCode, sortState.direction);
        case "seriesLabel":
          return compareValues(left.seriesLabel, right.seriesLabel, sortState.direction);
        case "volume":
          return compareValues(left.volume, right.volume, sortState.direction);
        case "wins":
          return compareValues(left.wins, right.wins, sortState.direction);
        case "draws":
          return compareValues(left.draws, right.draws, sortState.direction);
        case "losses":
          return compareValues(left.losses, right.losses, sortState.direction);
        case "lastOccurrenceIso":
          return compareValues(left.lastOccurrenceIso, right.lastOccurrenceIso, sortState.direction);
        case "apx":
        default:
          return compareValues(left.apx, right.apx, sortState.direction);
      }
    });
  }, [minimumVolume, scopedRows, sortByTab.player]);

  const methodRows = useMemo(() => {
    const grouped = new Map<string, PortalGTPastMethodRow[]>();

    for (const row of scopedRows) {
      const key = `${normalizeMethodLabel(row.methodCode)}::${row.series}`;
      const list = grouped.get(key);
      if (list) list.push(row);
      else grouped.set(key, [row]);
    }

    const next = Array.from(grouped.entries()).map(([id, details]) => {
      const sortedDetails = [...details].sort((left, right) =>
        right.playedAtIso.localeCompare(left.playedAtIso),
      );
      const resultCounts = countResolvedResults(sortedDetails);

      return {
        id,
        methodCode: normalizeMethodLabel(sortedDetails[0]?.methodCode ?? ""),
        seriesLabel: `Serie ${sortedDetails[0]?.series ?? "-"}`,
        players: new Set(sortedDetails.map((detail) => detail.playerName)).size,
        volume: sortedDetails.length,
        wins: resultCounts.wins,
        draws: resultCounts.draws,
        losses: resultCounts.losses,
        apx: averageApx(sortedDetails),
        lastOccurrenceIso: sortedDetails[0]?.playedAtIso ?? "",
        lastOccurrenceLabel: sortedDetails[0]?.playedAtLabel ?? "--",
        details: sortedDetails,
      } satisfies MethodSeriesRow;
    });

    const filteredByVolume = next.filter((row) =>
      Number.isFinite(minimumVolume) && minimumVolume > 1 ? row.volume >= minimumVolume : true,
    );

    const sortState = sortByTab.method;
    return filteredByVolume.sort((left, right) => {
      switch (sortState.key) {
        case "methodCode":
          return compareValues(left.methodCode, right.methodCode, sortState.direction);
        case "seriesLabel":
          return compareValues(left.seriesLabel, right.seriesLabel, sortState.direction);
        case "players":
          return compareValues(left.players, right.players, sortState.direction);
        case "wins":
          return compareValues(left.wins, right.wins, sortState.direction);
        case "draws":
          return compareValues(left.draws, right.draws, sortState.direction);
        case "losses":
          return compareValues(left.losses, right.losses, sortState.direction);
        case "apx":
          return compareValues(left.apx, right.apx, sortState.direction);
        case "lastOccurrenceIso":
          return compareValues(left.lastOccurrenceIso, right.lastOccurrenceIso, sortState.direction);
        case "volume":
        default:
          return compareValues(left.volume, right.volume, sortState.direction);
      }
    });
  }, [minimumVolume, scopedRows, sortByTab.method]);

  const trendRows = useMemo(() => {
    const dayKey1 = new Set(selectedDayKeys.slice(0, 1));
    const dayKey3 = selectedPeriod >= 3 ? new Set(selectedDayKeys.slice(0, 3)) : new Set<string>();
    const dayKey5 = selectedPeriod >= 5 ? new Set(selectedDayKeys.slice(0, 5)) : new Set<string>();
    const grouped = new Map<string, PortalGTPastMethodRow[]>();

    for (const row of scopedRows) {
      const key = `${normalizeMethodLabel(row.methodCode)}::${row.series}`;
      const list = grouped.get(key);
      if (list) list.push(row);
      else grouped.set(key, [row]);
    }

    const next = Array.from(grouped.entries()).map(([id, details]) => {
      const sortedDetails = [...details].sort((left, right) =>
        right.playedAtIso.localeCompare(left.playedAtIso),
      );
      const rows1d = sortedDetails.filter((detail) => dayKey1.has(detail.dayKey));
      const rows3d = selectedPeriod >= 3
        ? sortedDetails.filter((detail) => dayKey3.has(detail.dayKey))
        : [];
      const rows5d = selectedPeriod >= 5
        ? sortedDetails.filter((detail) => dayKey5.has(detail.dayKey))
        : [];
      const apx1d = averageApx(rows1d);
      const apx3d = selectedPeriod >= 3 && rows3d.length > 0 ? averageApx(rows3d) : null;
      const apx5d = selectedPeriod >= 5 && rows5d.length > 0 ? averageApx(rows5d) : null;
      const baseline = apx5d ?? apx3d;

      return {
        id,
        methodCode: normalizeMethodLabel(sortedDetails[0]?.methodCode ?? ""),
        seriesLabel: `Serie ${sortedDetails[0]?.series ?? "-"}`,
        volume1d: rows1d.length,
        apx1d,
        volume3d: selectedPeriod >= 3 ? rows3d.length : null,
        apx3d,
        volume5d: selectedPeriod >= 5 ? rows5d.length : null,
        apx5d,
        delta: baseline !== null ? Number((apx1d - baseline).toFixed(2)) : null,
        lastOccurrenceIso: sortedDetails[0]?.playedAtIso ?? "",
        lastOccurrenceLabel: sortedDetails[0]?.playedAtLabel ?? "--",
        details: sortedDetails,
      } satisfies TrendRow;
    });

    const filteredByVolume = next.filter((row) => {
      if (!Number.isFinite(minimumVolume) || minimumVolume <= 1) return true;
      return row.volume1d >= minimumVolume || (row.volume3d ?? 0) >= minimumVolume || (row.volume5d ?? 0) >= minimumVolume;
    });

    const sortState = sortByTab.trend;
    return filteredByVolume.sort((left, right) => {
      switch (sortState.key) {
        case "methodCode":
          return compareValues(left.methodCode, right.methodCode, sortState.direction);
        case "seriesLabel":
          return compareValues(left.seriesLabel, right.seriesLabel, sortState.direction);
        case "volume1d":
          return compareValues(left.volume1d, right.volume1d, sortState.direction);
        case "apx1d":
          return compareValues(left.apx1d, right.apx1d, sortState.direction);
        case "volume3d":
          return compareValues(left.volume3d, right.volume3d, sortState.direction);
        case "apx3d":
          return compareValues(left.apx3d, right.apx3d, sortState.direction);
        case "volume5d":
          return compareValues(left.volume5d, right.volume5d, sortState.direction);
        case "apx5d":
          return compareValues(left.apx5d, right.apx5d, sortState.direction);
        case "lastOccurrenceIso":
          return compareValues(left.lastOccurrenceIso, right.lastOccurrenceIso, sortState.direction);
        case "delta":
        default:
          return compareValues(left.delta, right.delta, sortState.direction);
      }
    });
  }, [minimumVolume, scopedRows, selectedDayKeys, selectedPeriod, sortByTab.trend]);

  const rawRows = useMemo(() => {
    const pastRows = scopedRows.filter((row) => pastResultsDayKeySet.has(row.dayKey));
    const filteredByVolume = pastRows.filter((row) =>
      Number.isFinite(minimumVolume) && minimumVolume > 1 ? row.totalOccurrences >= minimumVolume : true,
    );

    return [...filteredByVolume].sort((left, right) => {
      switch (occurrenceSort.key) {
        case "confrontationLabel":
          return compareValues(left.confrontationLabel, right.confrontationLabel, occurrenceSort.direction);
        case "methodCode":
          return compareValues(left.methodCode, right.methodCode, occurrenceSort.direction);
        case "wins":
          return compareValues(left.wins, right.wins, occurrenceSort.direction);
        case "draws":
          return compareValues(left.draws, right.draws, occurrenceSort.direction);
        case "losses":
          return compareValues(left.losses, right.losses, occurrenceSort.direction);
        case "apx":
          return compareValues(left.apx, right.apx, occurrenceSort.direction);
        case "totalOccurrences":
          return compareValues(left.totalOccurrences, right.totalOccurrences, occurrenceSort.direction);
        case "result":
          return compareValues(left.result, right.result, occurrenceSort.direction);
        case "playedAtIso":
        default:
          return compareValues(left.playedAtIso, right.playedAtIso, occurrenceSort.direction);
      }
    });
  }, [minimumVolume, occurrenceSort, pastResultsDayKeySet, scopedRows]);

  useEffect(() => {
    setExpandedRowId(null);
  }, [activeTab, playerFilter, searchQuery, selectedMethods, selectedPeriod, selectedSeries, volumeMin]);

  useEffect(() => {
    const intervalId = window.setInterval(() => {
      startRefreshTransition(() => {
        router.refresh();
      });
    }, GT_METHODS_AUTO_REFRESH_MS);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [router, startRefreshTransition]);

  const activeChips = useMemo(() => {
    const chips: Array<{ label: string; value: string }> = [{ label: "Periodo", value: `${selectedPeriod}d` }];

    if (selectedSeries.length < GT_SERIES.length) {
      chips.push({
        label: "Series",
        value:
          selectedSeries.length === 0
            ? "Nenhuma"
            : selectedSeries.length <= 4
              ? selectedSeries.map((series) => `Serie ${series}`).join(", ")
              : `${selectedSeries.length} series`,
      });
    }

    if (selectedMethods.length !== availableMethods.length) {
      chips.push({
        label: "Metodos",
        value:
          selectedMethods.length === 0
            ? "Nenhum"
            : selectedMethods.length <= 3
              ? selectedMethods.join(", ")
              : `${selectedMethods.length} ativos`,
      });
    }

    if (playerFilter.trim()) chips.push({ label: "Jogador", value: playerFilter.trim() });
    if (searchQuery.trim()) chips.push({ label: "Busca", value: searchQuery.trim() });
    if (Number.isFinite(minimumVolume) && minimumVolume > 1) {
      chips.push({ label: "Volume", value: `>= ${minimumVolume}` });
    }

    return chips;
  }, [availableMethods.length, minimumVolume, playerFilter, searchQuery, selectedMethods, selectedPeriod, selectedSeries]);

  function handleTabSort(tab: TabKey, key: string, firstDirection: SortDirection = "desc") {
    setSortByTab((current) => {
      const activeSort = current[tab];
      const nextDirection =
        activeSort.key === key
          ? activeSort.direction === "desc"
            ? "asc"
            : "desc"
          : firstDirection;

      return {
        ...current,
        [tab]: { key, direction: nextDirection },
      };
    });
  }

  function handleOccurrenceSort(key: string, firstDirection: SortDirection = "desc") {
    setOccurrenceSort((current) => ({
      key,
      direction:
        current.key === key
          ? current.direction === "desc"
            ? "asc"
            : "desc"
          : firstDirection,
    }));
  }

  function toggleSeries(series: string) {
    setSelectedSeries((current) =>
      current.includes(series)
        ? current.filter((value) => value !== series)
        : [...current, series].sort((left, right) => left.localeCompare(right)),
    );
  }

  function toggleMethod(method: string) {
    setHasCustomMethodSelection(true);
    setSelectedMethods((current) =>
      current.includes(method)
        ? current.filter((value) => value !== method)
        : [...current, method].sort((left, right) =>
            left.localeCompare(right, "pt-BR", { sensitivity: "base" }),
          ),
    );
  }

  function resetFilters() {
    setSelectedPeriod(5);
    setSelectedSeries([...GT_SERIES]);
    setSearchQuery("");
    setPlayerFilter("");
    setVolumeMin("1");
    setMethodQuery("");
    setHasCustomMethodSelection(false);
    setSelectedMethods(availableMethods);
  }

  const activePlayerSort = sortByTab.player;
  const activeMethodSort = sortByTab.method;
  const activeTrendSort = sortByTab.trend;
  const lastPublishedLabel = formatCompactDateTime(lastPublishedAt);
  const lastSuccessfulSyncLabel = formatCompactDateTime(lastSuccessfulSyncAt);

  async function handleRefresh() {
    setIsSyncingMethods(true);

    try {
      await fetch("/api/gt-league/metodos/refresh", {
        method: "POST",
        cache: "no-store",
      });
    } finally {
      startRefreshTransition(() => {
        router.refresh();
      });
      setIsSyncingMethods(false);
    }
  }

  return (
    <div className="space-y-5">
      <section className="glass-panel sticky top-[5.4rem] z-30 rounded-[0.9rem] px-5 py-4 sm:px-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-3">
            <a
              href="#dashboard"
              className="inline-flex items-center gap-2 rounded-[0.7rem] border border-[#c9e3da]/60 bg-[#e6f1ed] px-4 py-2 text-sm font-medium text-obsidian transition hover:bg-[#f1f7f4]"
            >
              <DashboardShortcutIcon />
              <span>Dashboard</span>
            </a>
            <a
              href="#past-results"
              className="inline-flex items-center gap-2 rounded-[0.7rem] border border-white/10 bg-white/[0.03] px-4 py-2 text-sm font-medium text-mist transition hover:border-white/18 hover:bg-white/[0.05] hover:text-ivory"
            >
              <HistoryShortcutIcon />
              <span>Past Results</span>
            </a>

            <button
              type="button"
              onClick={handleRefresh}
              className={clsx(
                "inline-flex items-center gap-2 rounded-[0.7rem] border px-4 py-2 text-sm font-medium transition",
                isRefreshing || isSyncingMethods
                  ? "border-[#b9d5cb]/40 bg-white/[0.08] text-ivory"
                  : "border-white/10 bg-white/[0.03] text-mist hover:border-white/18 hover:bg-white/[0.05] hover:text-ivory",
              )}
            >
              <RefreshIcon />
              <span>
                {isRefreshing || isSyncingMethods ? "Atualizando..." : "Atualizar"}
              </span>
            </button>
          </div>

          <div className="min-w-[14rem] text-right">
            <div className="text-[9px] uppercase tracking-[0.22em] text-sage">
              Ultima atualizacao
            </div>
            <div className="mt-1 text-xs font-medium text-ivory">
              {lastPublishedLabel}
            </div>
            <div className="mt-0.5 text-[11px] text-mist">Sync: {lastSuccessfulSyncLabel}</div>
          </div>
        </div>
      </section>

      <section id="dashboard" className="glass-panel rounded-[0.9rem] px-5 py-5 sm:px-6">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="space-y-2">
            <div className="text-xs uppercase tracking-[0.26em] text-sage">GT League</div>
            <div>
              <h1 className="font-serif-display text-4xl leading-none text-ivory sm:text-[2.65rem]">
                Dashboard de Metodos
              </h1>
            </div>
          </div>

          <div className="flex flex-col items-start gap-1 text-sm text-mist lg:items-end">
            <div className="text-xs uppercase tracking-[0.22em] text-sage">Base visivel</div>
            <div className="text-xl font-semibold text-ivory">{scopedRows.length} ocorrencia(s)</div>
            <div>{selectedDayKeys.length} dia(s) operacional(is)</div>
          </div>
        </div>

        <div className="mt-8 grid gap-6 xl:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
          <div className="space-y-5">
            <div>
              <div className="text-xs uppercase tracking-[0.22em] text-sage">Periodo</div>
              <div className="mt-3 flex flex-wrap gap-2">
                {PERIODS.map((period) => {
                  const active = selectedPeriod === period;

                  return (
                    <button
                      key={period}
                      type="button"
                      onClick={() => setSelectedPeriod(period)}
                      className={clsx(
                        "rounded-[0.7rem] border px-4 py-2 text-sm font-medium transition",
                        active
                          ? "border-[#b9d5cb]/60 bg-white/8 text-ivory"
                          : "border-white/10 bg-white/[0.03] text-mist hover:border-white/18 hover:bg-white/[0.05] hover:text-ivory",
                      )}
                    >
                      {period} dia{period > 1 ? "s" : ""}
                    </button>
                  );
                })}
              </div>
            </div>

            <div>
              <div className="flex items-center justify-between gap-3">
                <div className="text-xs uppercase tracking-[0.22em] text-sage">Series</div>
                <button
                  type="button"
                  onClick={() => setSelectedSeries([...GT_SERIES])}
                  className="text-xs uppercase tracking-[0.2em] text-sage transition hover:text-ivory"
                >
                  Todas
                </button>
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                {GT_SERIES.map((series) => {
                  const active = selectedSeries.includes(series);

                  return (
                    <button
                      key={series}
                      type="button"
                      onClick={() => toggleSeries(series)}
                      className={clsx(
                        "rounded-[0.75rem] border px-4 py-2 text-sm font-medium transition",
                        active
                          ? "border-[#c9e3da]/60 bg-[#e6f1ed] text-obsidian shadow-[inset_0_1px_0_rgba(255,255,255,0.35)]"
                          : "border-white/10 bg-white/[0.03] text-mist hover:border-white/18 hover:bg-white/[0.05] hover:text-ivory",
                      )}
                    >
                      Serie {series}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>

          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-1">
            <label className="block">
              <span className="text-xs uppercase tracking-[0.22em] text-sage">Busca</span>
              <div className="relative mt-3">
                <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sage/70">
                  <SearchIcon />
                </span>
                <input
                  value={searchQuery}
                  onChange={(event) => setSearchQuery(event.target.value)}
                  placeholder="Confronto, metodo ou serie"
                  className="w-full rounded-[0.8rem] border border-white/10 bg-black/18 px-10 py-2.5 text-sm text-ivory outline-none transition placeholder:text-mist/30 focus:border-white/20 focus:bg-black/24"
                />
              </div>
            </label>

            <label className="block">
              <span className="text-xs uppercase tracking-[0.22em] text-sage">Jogador</span>
              <input
                value={playerFilter}
                onChange={(event) => setPlayerFilter(event.target.value)}
                placeholder="Filtrar jogador ou oponente"
                className="mt-3 w-full rounded-[0.8rem] border border-white/10 bg-black/18 px-4 py-2.5 text-sm text-ivory outline-none transition placeholder:text-mist/30 focus:border-white/20 focus:bg-black/24"
              />
            </label>

            <label className="block">
              <span className="text-xs uppercase tracking-[0.22em] text-sage">Volume minimo</span>
              <input
                value={volumeMin}
                onChange={(event) => setVolumeMin(event.target.value)}
                inputMode="numeric"
                placeholder="1"
                className="mt-3 w-full rounded-[0.8rem] border border-white/10 bg-black/18 px-4 py-2.5 text-sm text-ivory outline-none transition placeholder:text-mist/30 focus:border-white/20 focus:bg-black/24"
              />
            </label>

            <div className="relative block">
              <span className="text-xs uppercase tracking-[0.22em] text-sage">Metodo</span>
              <button
                type="button"
                onClick={() => setMethodFilterOpen((current) => !current)}
                className="mt-3 inline-flex w-full items-center justify-between gap-3 rounded-[0.8rem] border border-[#9fc1b7]/25 bg-white/[0.05] px-4 py-2.5 text-sm font-medium text-ivory transition hover:border-[#b9d5cb]/40 hover:bg-white/[0.08]"
              >
                <span className="inline-flex items-center gap-2">
                  <FilterIcon />
                  <span>Filtro de Metodos</span>
                </span>
                <span className="text-xs uppercase tracking-[0.16em] text-sage">
                  {selectedMethods.length}/{availableMethods.length}
                </span>
              </button>

              {methodFilterOpen ? (
                <div className="absolute right-0 top-[calc(100%+0.6rem)] z-20 w-[18rem] rounded-[0.95rem] border border-white/10 bg-[linear-gradient(180deg,rgba(11,26,22,0.98),rgba(7,18,16,0.96))] p-4 shadow-[0_24px_60px_rgba(3,10,8,0.44)] backdrop-blur-2xl">
                  <div className="mb-3 flex items-center justify-between gap-3">
                    <div className="text-xs uppercase tracking-[0.2em] text-sage">Serie/Metodo</div>
                    <div className="flex items-center gap-3 text-[11px] uppercase tracking-[0.16em] text-sage">
                      <button
                        type="button"
                        onClick={() => {
                          setHasCustomMethodSelection(false);
                          setSelectedMethods(availableMethods);
                        }}
                        className="transition hover:text-ivory"
                      >
                        Todos
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setHasCustomMethodSelection(true);
                          setSelectedMethods([]);
                        }}
                        className="transition hover:text-ivory"
                      >
                        Limpar
                      </button>
                    </div>
                  </div>

                  <div className="relative">
                    <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sage/70">
                      <SearchIcon />
                    </span>
                    <input
                      value={methodQuery}
                      onChange={(event) => setMethodQuery(event.target.value)}
                      placeholder="Buscar metodo"
                      className="w-full rounded-[0.75rem] border border-white/10 bg-black/18 px-10 py-2.5 text-sm text-ivory outline-none transition placeholder:text-mist/30 focus:border-white/20 focus:bg-black/24"
                    />
                  </div>

                  <div className="mt-3 max-h-[15rem] overflow-y-auto pr-1">
                    {visibleMethods.length > 0 ? (
                      <div className="space-y-1">
                        {visibleMethods.map((method) => (
                          <MethodOptionRow
                            key={method}
                            label={method}
                            checked={selectedMethods.includes(method)}
                            onClick={() => toggleMethod(method)}
                          />
                        ))}
                      </div>
                    ) : (
                      <div className="rounded-[0.7rem] px-2 py-2 text-sm text-mist">
                        Nenhum metodo encontrado.
                      </div>
                    )}
                  </div>
                </div>
              ) : null}
            </div>
          </div>
        </div>

        <div className="mt-6 flex flex-wrap items-center gap-2">
          {activeChips.map((chip) => (
            <ActiveFilterChip key={`${chip.label}-${chip.value}`} label={chip.label} value={chip.value} />
          ))}
          <button
            type="button"
            onClick={resetFilters}
            className="inline-flex items-center rounded-[0.65rem] border border-white/10 bg-white/[0.04] px-3 py-1.5 text-xs uppercase tracking-[0.18em] text-sage transition hover:border-white/18 hover:text-ivory"
          >
            Limpar filtros
          </button>
        </div>

        <div className="mt-8">
          <div className="flex flex-wrap gap-2">
            {TABS.map((tab) => {
              const active = activeTab === tab.key;

              return (
                <button
                  key={tab.key}
                  type="button"
                  onClick={() => setActiveTab(tab.key)}
                  className={clsx(
                    "rounded-[0.75rem] border px-4 py-2.5 text-sm font-medium transition",
                    active
                      ? "border-[#c9e3da]/60 bg-[#e6f1ed] text-obsidian"
                      : "border-white/10 bg-white/[0.03] text-mist hover:border-white/18 hover:bg-white/[0.05] hover:text-ivory",
                  )}
                >
                  {tab.label}
                </button>
              );
            })}
          </div>

          <div className="mt-5">
            {activeTab === "player" ? (
              playerRows.length > 0 ? (
                <div className="overflow-hidden rounded-[0.85rem] border border-white/8">
                  <table className="min-w-full divide-y divide-white/8 text-sm">
                    <thead className="bg-white/5 text-[11px] uppercase tracking-[0.2em] text-sage">
                      <tr>
                        <th className="px-4 py-3 text-left">
                          <SortHeader
                            label="Jogador"
                            active={activePlayerSort.key === "playerName"}
                            direction={activePlayerSort.direction}
                            onClick={() => handleTabSort("player", "playerName", "asc")}
                          />
                        </th>
                        <th className="px-4 py-3 text-left">
                          <SortHeader
                            label="Metodo"
                            active={activePlayerSort.key === "methodCode"}
                            direction={activePlayerSort.direction}
                            onClick={() => handleTabSort("player", "methodCode", "asc")}
                          />
                        </th>
                        <th className="px-4 py-3 text-left">
                          <SortHeader
                            label="Series"
                            active={activePlayerSort.key === "seriesLabel"}
                            direction={activePlayerSort.direction}
                            onClick={() => handleTabSort("player", "seriesLabel", "asc")}
                          />
                        </th>
                        <th className="px-4 py-3 text-center">
                          <SortHeader
                            label="Volume"
                            active={activePlayerSort.key === "volume"}
                            direction={activePlayerSort.direction}
                            onClick={() => handleTabSort("player", "volume")}
                            align="center"
                          />
                        </th>
                        <th className="px-3 py-3 text-center">
                          <SortHeader
                            label="W"
                            active={activePlayerSort.key === "wins"}
                            direction={activePlayerSort.direction}
                            onClick={() => handleTabSort("player", "wins")}
                            align="center"
                          />
                        </th>
                        <th className="px-3 py-3 text-center">
                          <SortHeader
                            label="D"
                            active={activePlayerSort.key === "draws"}
                            direction={activePlayerSort.direction}
                            onClick={() => handleTabSort("player", "draws")}
                            align="center"
                          />
                        </th>
                        <th className="px-3 py-3 text-center">
                          <SortHeader
                            label="L"
                            active={activePlayerSort.key === "losses"}
                            direction={activePlayerSort.direction}
                            onClick={() => handleTabSort("player", "losses")}
                            align="center"
                          />
                        </th>
                        <th className="px-4 py-3 text-center">
                          <SortHeader
                            label="APX medio"
                            active={activePlayerSort.key === "apx"}
                            direction={activePlayerSort.direction}
                            onClick={() => handleTabSort("player", "apx")}
                            align="center"
                          />
                        </th>
                        <th className="px-4 py-3 text-right">
                          <SortHeader
                            label="Ultima"
                            active={activePlayerSort.key === "lastOccurrenceIso"}
                            direction={activePlayerSort.direction}
                            onClick={() => handleTabSort("player", "lastOccurrenceIso")}
                          />
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-white/8 bg-black/10">
                      {playerRows.map((row) => {
                        const expanded = expandedRowId === row.id;

                        return (
                          <ExpandableTableRow
                            key={row.id}
                            expanded={expanded}
                            onToggle={() => setExpandedRowId(expanded ? null : row.id)}
                            expandedContent={<ExpandedOccurrences rows={row.details} />}
                            colSpan={9}
                          >
                            <td className="px-4 py-4 font-medium text-ivory">{row.playerName}</td>
                            <td className="px-4 py-4 text-mist">{row.methodCode}</td>
                            <td className="px-4 py-4 text-mist">{row.seriesLabel}</td>
                            <td className="px-4 py-4 text-center font-medium tabular-nums text-ivory">{row.volume}</td>
                            <td className="px-3 py-4 text-center">
                              <MetricCountBadge tone="win" value={row.wins} />
                            </td>
                            <td className="px-3 py-4 text-center">
                              <MetricCountBadge tone="draw" value={row.draws} />
                            </td>
                            <td className="px-3 py-4 text-center">
                              <MetricCountBadge tone="loss" value={row.losses} />
                            </td>
                            <td className="px-4 py-4 text-center font-medium tabular-nums text-ivory">{formatPercent(row.apx)}</td>
                            <td className="px-4 py-4 text-right text-mist">{row.lastOccurrenceLabel}</td>
                          </ExpandableTableRow>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              ) : (
                <EmptyState message="Nenhum agrupamento por jogador encontrado para os filtros atuais." />
              )
            ) : null}

            {activeTab === "method" ? (
              methodRows.length > 0 ? (
                <div className="overflow-hidden rounded-[0.85rem] border border-white/8">
                  <table className="min-w-full divide-y divide-white/8 text-sm">
                    <thead className="bg-white/5 text-[11px] uppercase tracking-[0.2em] text-sage">
                      <tr>
                        <th className="px-4 py-3 text-left">
                          <SortHeader
                            label="Metodo"
                            active={activeMethodSort.key === "methodCode"}
                            direction={activeMethodSort.direction}
                            onClick={() => handleTabSort("method", "methodCode", "asc")}
                          />
                        </th>
                        <th className="px-4 py-3 text-left">
                          <SortHeader
                            label="Serie"
                            active={activeMethodSort.key === "seriesLabel"}
                            direction={activeMethodSort.direction}
                            onClick={() => handleTabSort("method", "seriesLabel", "asc")}
                          />
                        </th>
                        <th className="px-4 py-3 text-center">
                          <SortHeader
                            label="Jogadores"
                            active={activeMethodSort.key === "players"}
                            direction={activeMethodSort.direction}
                            onClick={() => handleTabSort("method", "players")}
                            align="center"
                          />
                        </th>
                        <th className="px-4 py-3 text-center">
                          <SortHeader
                            label="Volume"
                            active={activeMethodSort.key === "volume"}
                            direction={activeMethodSort.direction}
                            onClick={() => handleTabSort("method", "volume")}
                            align="center"
                          />
                        </th>
                        <th className="px-3 py-3 text-center">
                          <SortHeader
                            label="W"
                            active={activeMethodSort.key === "wins"}
                            direction={activeMethodSort.direction}
                            onClick={() => handleTabSort("method", "wins")}
                            align="center"
                          />
                        </th>
                        <th className="px-3 py-3 text-center">
                          <SortHeader
                            label="D"
                            active={activeMethodSort.key === "draws"}
                            direction={activeMethodSort.direction}
                            onClick={() => handleTabSort("method", "draws")}
                            align="center"
                          />
                        </th>
                        <th className="px-3 py-3 text-center">
                          <SortHeader
                            label="L"
                            active={activeMethodSort.key === "losses"}
                            direction={activeMethodSort.direction}
                            onClick={() => handleTabSort("method", "losses")}
                            align="center"
                          />
                        </th>
                        <th className="px-4 py-3 text-center">
                          <SortHeader
                            label="APX medio"
                            active={activeMethodSort.key === "apx"}
                            direction={activeMethodSort.direction}
                            onClick={() => handleTabSort("method", "apx")}
                            align="center"
                          />
                        </th>
                        <th className="px-4 py-3 text-right">
                          <SortHeader
                            label="Ultima"
                            active={activeMethodSort.key === "lastOccurrenceIso"}
                            direction={activeMethodSort.direction}
                            onClick={() => handleTabSort("method", "lastOccurrenceIso")}
                          />
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-white/8 bg-black/10">
                      {methodRows.map((row) => {
                        const expanded = expandedRowId === row.id;

                        return (
                          <ExpandableTableRow
                            key={row.id}
                            expanded={expanded}
                            onToggle={() => setExpandedRowId(expanded ? null : row.id)}
                            expandedContent={<ExpandedOccurrences rows={row.details} />}
                            colSpan={9}
                          >
                            <td className="px-4 py-4 font-medium text-ivory">{row.methodCode}</td>
                            <td className="px-4 py-4 text-mist">{row.seriesLabel}</td>
                            <td className="px-4 py-4 text-center font-medium tabular-nums text-ivory">{row.players}</td>
                            <td className="px-4 py-4 text-center font-medium tabular-nums text-ivory">{row.volume}</td>
                            <td className="px-3 py-4 text-center">
                              <MetricCountBadge tone="win" value={row.wins} />
                            </td>
                            <td className="px-3 py-4 text-center">
                              <MetricCountBadge tone="draw" value={row.draws} />
                            </td>
                            <td className="px-3 py-4 text-center">
                              <MetricCountBadge tone="loss" value={row.losses} />
                            </td>
                            <td className="px-4 py-4 text-center font-medium tabular-nums text-ivory">{formatPercent(row.apx)}</td>
                            <td className="px-4 py-4 text-right text-mist">{row.lastOccurrenceLabel}</td>
                          </ExpandableTableRow>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              ) : (
                <EmptyState message="Nenhum agrupamento por metodo e serie encontrado para os filtros atuais." />
              )
            ) : null}

            {activeTab === "trend" ? (
              trendRows.length > 0 ? (
                <div className="overflow-hidden rounded-[0.85rem] border border-white/8">
                  <table className="min-w-full divide-y divide-white/8 text-sm">
                    <thead className="bg-white/5 text-[11px] uppercase tracking-[0.2em] text-sage">
                      <tr>
                        <th className="px-4 py-3 text-left">
                          <SortHeader
                            label="Metodo"
                            active={activeTrendSort.key === "methodCode"}
                            direction={activeTrendSort.direction}
                            onClick={() => handleTabSort("trend", "methodCode", "asc")}
                          />
                        </th>
                        <th className="px-4 py-3 text-left">
                          <SortHeader
                            label="Serie"
                            active={activeTrendSort.key === "seriesLabel"}
                            direction={activeTrendSort.direction}
                            onClick={() => handleTabSort("trend", "seriesLabel", "asc")}
                          />
                        </th>
                        <th className="px-3 py-3 text-center">
                          <SortHeader
                            label="Vol 1d"
                            active={activeTrendSort.key === "volume1d"}
                            direction={activeTrendSort.direction}
                            onClick={() => handleTabSort("trend", "volume1d")}
                            align="center"
                          />
                        </th>
                        <th className="px-4 py-3 text-center">
                          <SortHeader
                            label="APX 1d"
                            active={activeTrendSort.key === "apx1d"}
                            direction={activeTrendSort.direction}
                            onClick={() => handleTabSort("trend", "apx1d")}
                            align="center"
                          />
                        </th>
                        <th className="px-3 py-3 text-center">
                          <SortHeader
                            label="Vol 3d"
                            active={activeTrendSort.key === "volume3d"}
                            direction={activeTrendSort.direction}
                            onClick={() => handleTabSort("trend", "volume3d")}
                            align="center"
                          />
                        </th>
                        <th className="px-4 py-3 text-center">
                          <SortHeader
                            label="APX 3d"
                            active={activeTrendSort.key === "apx3d"}
                            direction={activeTrendSort.direction}
                            onClick={() => handleTabSort("trend", "apx3d")}
                            align="center"
                          />
                        </th>
                        <th className="px-3 py-3 text-center">
                          <SortHeader
                            label="Vol 5d"
                            active={activeTrendSort.key === "volume5d"}
                            direction={activeTrendSort.direction}
                            onClick={() => handleTabSort("trend", "volume5d")}
                            align="center"
                          />
                        </th>
                        <th className="px-4 py-3 text-center">
                          <SortHeader
                            label="APX 5d"
                            active={activeTrendSort.key === "apx5d"}
                            direction={activeTrendSort.direction}
                            onClick={() => handleTabSort("trend", "apx5d")}
                            align="center"
                          />
                        </th>
                        <th className="px-4 py-3 text-center">
                          <SortHeader
                            label="Delta"
                            active={activeTrendSort.key === "delta"}
                            direction={activeTrendSort.direction}
                            onClick={() => handleTabSort("trend", "delta")}
                            align="center"
                          />
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-white/8 bg-black/10">
                      {trendRows.map((row) => {
                        const expanded = expandedRowId === row.id;

                        return (
                          <ExpandableTableRow
                            key={row.id}
                            expanded={expanded}
                            onToggle={() => setExpandedRowId(expanded ? null : row.id)}
                            expandedContent={<ExpandedOccurrences rows={row.details} />}
                            colSpan={9}
                          >
                            <td className="px-4 py-4 font-medium text-ivory">{row.methodCode}</td>
                            <td className="px-4 py-4 text-mist">{row.seriesLabel}</td>
                            <td className="px-3 py-4 text-center font-medium tabular-nums text-ivory">{row.volume1d}</td>
                            <td className="px-4 py-4 text-center font-medium tabular-nums text-ivory">{formatPercent(row.apx1d)}</td>
                            <td className="px-3 py-4 text-center font-medium tabular-nums text-ivory">
                              {row.volume3d ?? "--"}
                            </td>
                            <td className="px-4 py-4 text-center font-medium tabular-nums text-ivory">
                              {formatPercent(row.apx3d)}
                            </td>
                            <td className="px-3 py-4 text-center font-medium tabular-nums text-ivory">
                              {row.volume5d ?? "--"}
                            </td>
                            <td className="px-4 py-4 text-center font-medium tabular-nums text-ivory">
                              {formatPercent(row.apx5d)}
                            </td>
                            <td
                              className={clsx(
                                "px-4 py-4 text-center font-medium tabular-nums",
                                row.delta === null
                                  ? "text-mist"
                                  : row.delta >= 0
                                    ? "text-emerald-200"
                                    : "text-rose-200",
                              )}
                            >
                              {row.delta === null ? "--" : `${row.delta > 0 ? "+" : ""}${row.delta.toFixed(2)}%`}
                            </td>
                          </ExpandableTableRow>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              ) : (
                <EmptyState message="Nenhuma tendencia recente encontrada para os filtros atuais." />
              )
            ) : null}
          </div>
        </div>
      </section>

      <section id="past-results" className="glass-panel rounded-[0.9rem] px-5 py-5 sm:px-6">
        <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
          <div>
            <div className="text-xs uppercase tracking-[0.26em] text-sage">GT League</div>
            <h2 className="mt-2 font-serif-display text-3xl leading-none text-ivory">Past Metodos</h2>
          </div>

          <div className="text-sm text-mist">
            <div className="text-xs uppercase tracking-[0.22em] text-sage">Recorte atual</div>
            <div className="mt-1 font-medium text-ivory">
              {pastResultsDayKeys.map((dayKey) => formatDayLabel(dayKey)).join(" | ") || "Sem dias"}
            </div>
          </div>
        </div>

        <div className="mt-6">
          {rawRows.length > 0 ? (
            <div className="overflow-hidden rounded-[0.85rem] border border-white/8">
              <table className="min-w-full divide-y divide-white/8 text-sm">
                <thead className="bg-white/5 text-[11px] uppercase tracking-[0.2em] text-sage">
                  <tr>
                    <th className="px-4 py-3 text-left">
                      <SortHeader
                        label="Data/Hora"
                        active={occurrenceSort.key === "playedAtIso"}
                        direction={occurrenceSort.direction}
                        onClick={() => handleOccurrenceSort("playedAtIso")}
                      />
                    </th>
                    <th className="px-4 py-3 text-left">
                      <SortHeader
                        label="Confronto"
                        active={occurrenceSort.key === "confrontationLabel"}
                        direction={occurrenceSort.direction}
                        onClick={() => handleOccurrenceSort("confrontationLabel", "asc")}
                      />
                    </th>
                    <th className="px-4 py-3 text-left">
                      <SortHeader
                        label="Metrica"
                        active={occurrenceSort.key === "methodCode"}
                        direction={occurrenceSort.direction}
                        onClick={() => handleOccurrenceSort("methodCode", "asc")}
                      />
                    </th>
                    <th className="px-3 py-3 text-center">
                      <SortHeader
                        label="W"
                        active={occurrenceSort.key === "wins"}
                        direction={occurrenceSort.direction}
                        onClick={() => handleOccurrenceSort("wins")}
                        align="center"
                      />
                    </th>
                    <th className="px-3 py-3 text-center">
                      <SortHeader
                        label="D"
                        active={occurrenceSort.key === "draws"}
                        direction={occurrenceSort.direction}
                        onClick={() => handleOccurrenceSort("draws")}
                        align="center"
                      />
                    </th>
                    <th className="px-3 py-3 text-center">
                      <SortHeader
                        label="L"
                        active={occurrenceSort.key === "losses"}
                        direction={occurrenceSort.direction}
                        onClick={() => handleOccurrenceSort("losses")}
                        align="center"
                      />
                    </th>
                    <th className="px-4 py-3 text-center">
                      <SortHeader
                        label="APX"
                        active={occurrenceSort.key === "apx"}
                        direction={occurrenceSort.direction}
                        onClick={() => handleOccurrenceSort("apx")}
                        align="center"
                      />
                    </th>
                    <th className="px-4 py-3 text-center">
                      <SortHeader
                        label="Volume"
                        active={occurrenceSort.key === "totalOccurrences"}
                        direction={occurrenceSort.direction}
                        onClick={() => handleOccurrenceSort("totalOccurrences")}
                        align="center"
                      />
                    </th>
                    <th className="px-4 py-3 text-center">
                      <SortHeader
                        label="Resultado"
                        active={occurrenceSort.key === "result"}
                        direction={occurrenceSort.direction}
                        onClick={() => handleOccurrenceSort("result", "asc")}
                        align="center"
                      />
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/8 bg-black/10">
                  {rawRows.map((row) => (
                    <tr key={row.id} className="transition hover:bg-white/[0.03]">
                      <td className="px-4 py-4 text-mist">
                        <div className="font-medium text-ivory">{row.playedAtLabel}</div>
                        <div className="mt-1 text-xs uppercase tracking-[0.18em] text-sage">
                          {formatDayLabel(row.dayKey)}
                        </div>
                      </td>
                      <td className="px-4 py-4">
                        <div className="font-medium text-ivory">{row.confrontationLabel}</div>
                        <div className="mt-1 text-xs text-mist/70">
                          GT League - Serie {row.series} | Metodo {row.methodCode}
                        </div>
                      </td>
                      <td className="px-4 py-4 text-mist">{row.methodCode}</td>
                      <td className="px-3 py-4 text-center">
                        <MetricCountBadge tone="win" value={row.wins} />
                      </td>
                      <td className="px-3 py-4 text-center">
                        <MetricCountBadge tone="draw" value={row.draws} />
                      </td>
                      <td className="px-3 py-4 text-center">
                        <MetricCountBadge tone="loss" value={row.losses} />
                      </td>
                      <td className="px-4 py-4 text-center font-medium tabular-nums text-ivory">{formatPercent(row.apx)}</td>
                      <td className="px-4 py-4 text-center font-medium tabular-nums text-ivory">{row.totalOccurrences}</td>
                      <td className="px-4 py-4 text-center">
                        <ResultPill result={row.result} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <EmptyState message="Nenhum metodo resolvido encontrado para as series e filtros selecionados." />
          )}
        </div>
      </section>
    </div>
  );
}
