"use client";

import clsx from "clsx";
import Image from "next/image";
import Link from "next/link";
import { useEffect, useState, type ReactNode } from "react";
import { formatCompactDateTime, formatPercent } from "@/lib/format";
import type { PortalOpenSignal } from "@/lib/portal-api";

type SportKey = "ebasketball" | "esoccer";
type LeagueKey =
  | "battle-volta-6min"
  | "battle-8min"
  | "gt-league"
  | "h2h-gg-league"
  | "eadriatic-league"
  | "h2h-nba"
  | "battle-nba";

type SportDefinition = {
  key: SportKey;
  label: string;
};

type LeagueDefinition = {
  key: LeagueKey;
  label: string;
  sport: SportKey;
  logoText: string;
  leagueTypes: string[];
  supportsSeries?: boolean;
  logoSrc?: string;
};

const SPORTS: SportDefinition[] = [
  { key: "ebasketball", label: "E-Basketball" },
  { key: "esoccer", label: "E-Soccer" },
];

const LEAGUES: LeagueDefinition[] = [
  {
    key: "h2h-nba",
    label: "H2H NBA",
    sport: "ebasketball",
    logoText: "H2H",
    leagueTypes: [],
  },
  {
    key: "battle-nba",
    label: "Battle NBA",
    sport: "ebasketball",
    logoText: "BTL",
    leagueTypes: [],
  },
  {
    key: "battle-volta-6min",
    label: "Battle Volta 6min",
    sport: "esoccer",
    logoText: "6V",
    leagueTypes: ["6MIN VOLTA"],
  },
  {
    key: "battle-8min",
    label: "Battle 8min",
    sport: "esoccer",
    logoText: "8B",
    leagueTypes: ["8MIN BATTLE"],
  },
  {
    key: "gt-league",
    label: "GT League",
    sport: "esoccer",
    logoText: "GT",
    leagueTypes: ["GT LEAGUE"],
    supportsSeries: true,
  },
  {
    key: "h2h-gg-league",
    label: "H2H GG League",
    sport: "esoccer",
    logoText: "H2H",
    leagueTypes: ["H2H"],
  },
  {
    key: "eadriatic-league",
    label: "eAdriatic League",
    sport: "esoccer",
    logoText: "ADR",
    leagueTypes: [],
  },
];

const GT_SERIES = ["A", "B", "C", "D", "E", "F", "G"] as const;
const ALL_GT_SERIES = [...GT_SERIES];
const GT_SHORTCUTS = [
  { label: "Panorama", href: "/esoccer/gt-league/panorama" },
  { label: "Raio X", href: "/esoccer/gt-league/raio-x" },
  { label: "Disparidade", href: "/esoccer/gt-league/disparidade" },
  { label: "Metodos", href: "/esoccer/gt-league/metodos" },
] as const;

function SoccerIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="none" aria-hidden="true" className="h-4 w-4">
      <circle cx="10" cy="10" r="6.25" stroke="currentColor" strokeWidth="1.45" />
      <path
        d="m10 5.15 2.45 1.8-.95 2.85h-3l-.95-2.85L10 5.15Z"
        stroke="currentColor"
        strokeWidth="1.25"
        strokeLinejoin="round"
      />
      <path
        d="m8.5 9.8-2.55 1.7.9 2.6m5.3-4.3 2.55 1.7-.9 2.6m-6.1.3h4.6"
        stroke="currentColor"
        strokeWidth="1.25"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function BasketballIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="none" aria-hidden="true" className="h-4 w-4">
      <circle cx="10" cy="10" r="6.25" stroke="currentColor" strokeWidth="1.45" />
      <path
        d="M10 3.75c1.9 1.55 2.85 3.64 2.85 6.25 0 2.6-.95 4.69-2.85 6.25"
        stroke="currentColor"
        strokeWidth="1.45"
        strokeLinecap="round"
      />
      <path
        d="M10 3.75c-1.9 1.55-2.85 3.64-2.85 6.25 0 2.6.95 4.69 2.85 6.25"
        stroke="currentColor"
        strokeWidth="1.45"
        strokeLinecap="round"
      />
      <path
        d="M4 8.25h12M4 11.75h12"
        stroke="currentColor"
        strokeWidth="1.45"
        strokeLinecap="round"
      />
    </svg>
  );
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

function MetricBarsIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" className="h-5 w-5">
      <path
        d="M4 19V11M10 19V6M16 19V9M22 19V4"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
    </svg>
  );
}

function SequenceEventChip({
  item,
  fallbackConfrontationLabel,
}: {
  item: {
    result: "W" | "D" | "L";
    localTimeLabel: string;
    scoreLabel: string;
    confrontationLabel: string;
    playerGoals: number;
    opponentGoals: number;
  };
  fallbackConfrontationLabel?: string;
}) {
  const toneClass =
    item.result === "W"
      ? "portal-live-sequence-badge portal-live-sequence-badge--win"
      : item.result === "D"
        ? "portal-live-sequence-badge portal-live-sequence-badge--draw"
        : "portal-live-sequence-badge portal-live-sequence-badge--loss";

  return (
    <span
      title={`${item.localTimeLabel} | ${item.confrontationLabel || fallbackConfrontationLabel || "Confronto indisponivel"} | ${item.scoreLabel} | ${item.result}`}
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

function SequenceStrip({
  items,
  emptyLabel = "--",
  fallbackConfrontationLabel,
}: {
  items: Array<{
    result: "W" | "D" | "L";
    localTimeLabel: string;
    scoreLabel: string;
    confrontationLabel: string;
    playerGoals: number;
    opponentGoals: number;
  }>;
  emptyLabel?: string;
  fallbackConfrontationLabel?: string;
}) {
  if (items.length === 0) {
    return <span className="text-xs text-mist/45">{emptyLabel}</span>;
  }

  return (
    <div className="flex flex-nowrap gap-0.5">
      {items.map((item, index) => (
        <SequenceEventChip
          key={`${item.localTimeLabel}-${item.scoreLabel}-${item.result}-${index}`}
          item={item}
          fallbackConfrontationLabel={fallbackConfrontationLabel}
        />
      ))}
    </div>
  );
}

function ChevronDownIcon({ open }: { open: boolean }) {
  return (
    <svg
      viewBox="0 0 20 20"
      fill="none"
      aria-hidden="true"
      className={clsx("h-4 w-4 transition", open ? "rotate-180" : "rotate-0")}
    >
      <path
        d="M5 7.5 10 12.5 15 7.5"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
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

function normalizeSeries(series: string | null) {
  if (!series) {
    return null;
  }

  const exactMatch = series.match(/\b([A-G])\b/i);
  if (exactMatch?.[1]) {
    return exactMatch[1].toUpperCase();
  }

  const trailingMatch = series.match(/([A-G])$/i);
  return trailingMatch?.[1] ? trailingMatch[1].toUpperCase() : null;
}

function matchesSport(signal: PortalOpenSignal, sport: SportKey) {
  if (sport === "esoccer") {
    return ["GT LEAGUE", "8MIN BATTLE", "6MIN VOLTA", "H2H"].includes(
      signal.leagueType,
    );
  }

  return false;
}

function getLeagueDefinitionsForSport(sport: SportKey) {
  return LEAGUES.filter((league) => league.sport === sport);
}

function getLeagueTypesForKeys(keys: LeagueKey[]) {
  return Array.from(
    new Set(
      LEAGUES.filter((league) => keys.includes(league.key)).flatMap(
        (league) => league.leagueTypes,
      ),
    ),
  );
}

function LogoSlot({
  label,
  logoText,
  logoSrc,
  active,
}: {
  label: string;
  logoText: string;
  logoSrc?: string;
  active: boolean;
}) {
  return (
    <div
      className={clsx(
        "relative flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-[0.7rem] border text-[10px] font-semibold uppercase tracking-[0.14em]",
        active
          ? "border-obsidian/10 bg-obsidian/10 text-obsidian"
          : "border-white/10 bg-black/20 text-sand",
      )}
    >
      {logoSrc ? (
        <Image
          src={logoSrc}
          alt={label}
          fill
          sizes="36px"
          className="object-contain p-1.5"
        />
      ) : (
        <span>{logoText}</span>
      )}
    </div>
  );
}

function SportPill({
  label,
  active,
  onClick,
  icon,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
  icon: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={clsx(
        "inline-flex items-center gap-3 rounded-[0.85rem] border px-3 py-2 text-sm font-medium transition",
        active
          ? "border-[#b9d5cb]/60 bg-white/8 text-ivory shadow-[inset_0_1px_0_rgba(255,255,255,0.14)]"
          : "border-white/10 bg-white/[0.03] text-mist hover:border-white/18 hover:bg-white/[0.05] hover:text-ivory",
      )}
    >
      <span
        className={clsx(
          "flex h-6 w-6 items-center justify-center rounded-full border",
          active ? "border-[#c9e3da]/55 bg-white/8" : "border-white/12 bg-black/18",
        )}
      >
        {icon}
      </span>
      <span>{label}</span>
    </button>
  );
}

function LeaguePill({
  league,
  active,
  open,
  onClick,
  onToggleDropdown,
}: {
  league: LeagueDefinition;
  active: boolean;
  open?: boolean;
  onClick: () => void;
  onToggleDropdown?: () => void;
}) {
  return (
    <div
      className={clsx(
        "inline-flex items-center gap-2 rounded-[0.85rem] border pr-2 text-sm font-medium transition",
        active
          ? "border-[#b9d5cb]/60 bg-white/8 text-ivory shadow-[inset_0_1px_0_rgba(255,255,255,0.14)]"
          : "border-white/10 bg-white/[0.03] text-mist hover:border-white/18 hover:bg-white/[0.05] hover:text-ivory",
      )}
    >
      <button
        type="button"
        onClick={onClick}
        className="inline-flex items-center gap-3 px-3 py-2"
      >
        <LogoSlot
          label={league.label}
          logoText={league.logoText}
          logoSrc={league.logoSrc}
          active={active}
        />
        <span>{league.label}</span>
      </button>

      {league.supportsSeries ? (
        <button
          type="button"
          onClick={onToggleDropdown}
          aria-label={open ? "Minimizar series" : "Expandir series"}
          className={clsx(
            "flex h-8 w-8 items-center justify-center rounded-[0.65rem] border transition",
            active
              ? "border-white/12 bg-black/15 text-ivory hover:bg-black/25"
              : "border-white/10 bg-black/20 text-mist hover:bg-black/28 hover:text-ivory",
          )}
        >
          <ChevronDownIcon open={Boolean(open)} />
        </button>
      ) : null}
    </div>
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

export function LiveSignalsBoard({ signals }: { signals: PortalOpenSignal[] }) {
  const [liveSignals, setLiveSignals] = useState<PortalOpenSignal[]>(signals);
  const [isHydrating, setIsHydrating] = useState(true);
  const [selectedSport, setSelectedSport] = useState<SportKey>("esoccer");
  const [selectedLeagues, setSelectedLeagues] = useState<LeagueKey[]>(
    getLeagueDefinitionsForSport("esoccer").map((league) => league.key),
  );
  const [gtSeriesOpen, setGtSeriesOpen] = useState(false);
  const [selectedGtSeries, setSelectedGtSeries] =
    useState<string[]>(ALL_GT_SERIES);
  const [methodFilterOpen, setMethodFilterOpen] = useState(false);
  const [methodQuery, setMethodQuery] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedMethods, setSelectedMethods] = useState<string[]>([]);
  const [hasCustomMethodSelection, setHasCustomMethodSelection] =
    useState(false);

  useEffect(() => {
    setLiveSignals(signals);
    setIsHydrating(signals.length === 0);
  }, [signals]);

  useEffect(() => {
    let cancelled = false;
    const requestedLeagueTypes = getLeagueTypesForKeys(selectedLeagues);

    if (requestedLeagueTypes.length === 0) {
      setLiveSignals([]);
      setIsHydrating(false);
      return () => {
        cancelled = true;
      };
    }

    async function hydrateSignals() {
      setIsHydrating(true);

      try {
        const params = new URLSearchParams();
        for (const leagueType of requestedLeagueTypes) {
          params.append("leagueType", leagueType);
        }

        const response = await fetch(`/api/ao-vivo/signals?${params.toString()}`, {
          cache: "no-store",
        });

        if (!response.ok) {
          if (!cancelled) {
            setIsHydrating(false);
          }
          return;
        }

        const nextSignals = (await response.json()) as PortalOpenSignal[];

        if (!cancelled) {
          setLiveSignals(nextSignals);
          setIsHydrating(false);
        }
      } catch {
        // Keep the initial fast payload when the background refresh fails.
        if (!cancelled) {
          setIsHydrating(false);
        }
      }
    }

    void hydrateSignals();

    return () => {
      cancelled = true;
    };
  }, [selectedSport, selectedLeagues.join("|")]);

  const sportSignals = liveSignals.filter((signal) =>
    matchesSport(signal, selectedSport),
  );

  const leagueFilteredSignals = sportSignals.filter((signal) => {
    if (selectedLeagues.length === 0) {
      return true;
    }

    const matchingLeagues = LEAGUES.filter((entry) =>
      selectedLeagues.includes(entry.key),
    );

    if (matchingLeagues.length === 0) {
      return true;
    }

    const matchesAnyLeague = matchingLeagues.some(
      (league) =>
        league.leagueTypes.length > 0 &&
        league.leagueTypes.includes(signal.leagueType),
    );

    if (!matchesAnyLeague) {
      return false;
    }

    if (
      selectedLeagues.includes("gt-league") &&
      signal.leagueType === "GT LEAGUE"
    ) {
      const series = normalizeSeries(signal.series);
      if (selectedGtSeries.length === 0) {
        return true;
      }

      return Boolean(series && selectedGtSeries.includes(series));
    }

    return true;
  });

  const searchedSignals = leagueFilteredSignals.filter((signal) => {
    if (!searchQuery.trim()) {
      return true;
    }

    const query = searchQuery.trim().toLowerCase();
    return (
      signal.confrontationLabel.toLowerCase().includes(query) ||
      signal.methodCode.toLowerCase().includes(query) ||
      signal.leagueType.toLowerCase().includes(query) ||
      (signal.series ?? "").toLowerCase().includes(query)
    );
  });

  const availableMethods = Array.from(
    new Set(searchedSignals.map((signal) => signal.methodCode).filter(Boolean)),
  ).sort((left, right) =>
    left.localeCompare(right, "pt-BR", { sensitivity: "base" }),
  );

  useEffect(() => {
    setSelectedMethods((current) => {
      if (availableMethods.length === 0) {
        return [];
      }

      if (!hasCustomMethodSelection || current.length === 0) {
        return availableMethods;
      }

      const next = current.filter((method) =>
        availableMethods.includes(method),
      );
      return next.length > 0 ? next : availableMethods;
    });
  }, [availableMethods.join("|"), hasCustomMethodSelection]);

  const visibleMethods = availableMethods.filter((method) =>
    method.toLowerCase().includes(methodQuery.trim().toLowerCase()),
  );

  const filteredSignals = searchedSignals.filter((signal) => {
    if (selectedMethods.length === 0) {
      return true;
    }

    return selectedMethods.includes(signal.methodCode);
  });

  function toggleGtSeries(series: string) {
    setSelectedGtSeries((current) =>
      current.includes(series)
        ? current.filter((entry) => entry !== series)
        : [...current, series],
    );
  }

  function toggleMethod(method: string) {
    setHasCustomMethodSelection(true);
    setSelectedMethods((current) =>
      current.includes(method)
        ? current.filter((entry) => entry !== method)
        : [...current, method],
    );
  }

  function selectSport(sport: SportKey) {
    setSelectedSport(sport);
    setSelectedLeagues(
      getLeagueDefinitionsForSport(sport).map((league) => league.key),
    );
    setGtSeriesOpen(false);
    setSelectedGtSeries(ALL_GT_SERIES);
  }

  function selectLeague(league: LeagueDefinition) {
    const wasSelected = selectedLeagues.includes(league.key);

    setSelectedLeagues((current) =>
      current.includes(league.key)
        ? current.filter((entry) => entry !== league.key)
        : [...current, league.key],
    );

    if (league.key === "gt-league") {
      setGtSeriesOpen(!wasSelected);
      return;
    }

    setGtSeriesOpen(false);
  }

  function toggleLeagueDropdown(league: LeagueDefinition) {
    if (!league.supportsSeries) {
      return;
    }

    const wasSelected = selectedLeagues.includes(league.key);

    if (!wasSelected) {
      setSelectedLeagues((current) => [...current, league.key]);
      setGtSeriesOpen(true);
      return;
    }

    setGtSeriesOpen((current) => !current);
  }

  return (
    <section className="glass-panel rounded-[0.9rem] px-5 py-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="text-[2rem] font-semibold uppercase tracking-[0.04em] text-ivory">
            Ao Vivo
          </div>
          <p className="text-[1.05rem] text-mist">Metodos ativos</p>
        </div>
        <div className="pt-1 text-sm uppercase tracking-[0.16em] text-sage">
          {isHydrating ? "Atualizando..." : `${filteredSignals.length} linha(s)`}
        </div>
      </div>

      <div className="mt-5 space-y-4">
        <div className="flex flex-wrap items-center gap-2.5">
          <div className="text-[11px] uppercase tracking-[0.22em] text-sage">
            Atalhos GT
          </div>
          {GT_SHORTCUTS.map((shortcut) => (
            <Link
              key={shortcut.href}
              href={shortcut.href}
              className="inline-flex items-center rounded-[0.72rem] border border-white/10 bg-white/[0.03] px-3.5 py-2 text-sm font-medium text-ivory transition hover:border-white/18 hover:bg-white/[0.06]"
            >
              {shortcut.label}
            </Link>
          ))}
        </div>

        <div className="flex flex-wrap gap-3">
          {SPORTS.map((sport) => (
            <SportPill
              key={sport.key}
              label={sport.label}
              active={selectedSport === sport.key}
              onClick={() => selectSport(sport.key)}
              icon={
                sport.key === "esoccer" ? <SoccerIcon /> : <BasketballIcon />
              }
            />
          ))}
        </div>

        <div className="space-y-2">
          <div className="text-sm font-medium text-sage">Ligas</div>
          <div className="flex flex-wrap gap-3">
            {getLeagueDefinitionsForSport(selectedSport).map((league) => (
              <div key={league.key} className="relative">
                <LeaguePill
                  league={league}
                  active={selectedLeagues.includes(league.key)}
                  open={league.key === "gt-league" && gtSeriesOpen}
                  onClick={() => selectLeague(league)}
                  onToggleDropdown={() => toggleLeagueDropdown(league)}
                />

                {league.key === "gt-league" &&
                selectedLeagues.includes("gt-league") &&
                gtSeriesOpen ? (
                  <div className="absolute left-0 top-[calc(100%+0.6rem)] z-20 w-[14rem] rounded-[0.95rem] border border-white/10 bg-[linear-gradient(180deg,rgba(11,26,22,0.98),rgba(7,18,16,0.96))] p-4 shadow-[0_24px_60px_rgba(3,10,8,0.44)] backdrop-blur-2xl">
                    <div className="text-sm font-semibold text-mist">
                      Series GT League
                    </div>
                    <div className="mt-3 space-y-2">
                      {GT_SERIES.map((series) => (
                        <MethodOptionRow
                          key={series}
                          label={`Serie ${series}`}
                          checked={selectedGtSeries.includes(series)}
                          onClick={() => toggleGtSeries(series)}
                        />
                      ))}
                    </div>
                  </div>
                ) : null}
              </div>
            ))}
          </div>
        </div>

        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <label className="relative block w-full max-w-[15rem]">
            <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sage/70">
              <SearchIcon />
            </span>
            <input
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              placeholder="Buscar"
              className="w-full rounded-[0.8rem] border border-white/10 bg-black/18 px-10 py-2.5 text-sm text-ivory outline-none transition placeholder:text-mist/30 focus:border-white/20 focus:bg-black/24"
            />
          </label>

          <div className="relative self-end md:self-auto">
            <button
              type="button"
              onClick={() => setMethodFilterOpen((current) => !current)}
              className="inline-flex items-center gap-2 rounded-[0.8rem] border border-[#9fc1b7]/25 bg-white/[0.05] px-4 py-2.5 text-sm font-medium text-ivory transition hover:border-[#b9d5cb]/40 hover:bg-white/[0.08]"
            >
              <FilterIcon />
              <span>Filtro de Metodos</span>
            </button>

            {methodFilterOpen ? (
              <div className="absolute right-0 top-[calc(100%+0.6rem)] z-20 w-[16rem] rounded-[0.95rem] border border-white/10 bg-[linear-gradient(180deg,rgba(11,26,22,0.98),rgba(7,18,16,0.96))] p-4 shadow-[0_24px_60px_rgba(3,10,8,0.44)] backdrop-blur-2xl">
                <div className="text-sm font-semibold text-mist">
                  Serie/Metodo
                </div>
                <label className="relative mt-3 block">
                  <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sage/70">
                    <SearchIcon />
                  </span>
                  <input
                    value={methodQuery}
                    onChange={(event) => setMethodQuery(event.target.value)}
                    placeholder="Buscar"
                    className="w-full rounded-[0.75rem] border border-white/10 bg-black/18 px-10 py-2.5 text-sm text-ivory outline-none transition placeholder:text-mist/30 focus:border-white/20 focus:bg-black/24"
                  />
                </label>

                <div className="mt-3 max-h-[16rem] space-y-1 overflow-y-auto pr-1">
                  {visibleMethods.map((method) => (
                    <MethodOptionRow
                      key={method}
                      label={method}
                      checked={selectedMethods.includes(method)}
                      onClick={() => toggleMethod(method)}
                    />
                  ))}

                  {visibleMethods.length === 0 ? (
                    <div className="rounded-[0.7rem] px-2 py-2 text-sm text-mist">
                      Nenhum metodo encontrado.
                    </div>
                  ) : null}
                </div>
              </div>
            ) : null}
          </div>
        </div>

        <div className="overflow-hidden rounded-[0.85rem] border border-white/8">
          <table className="min-w-full divide-y divide-white/8 text-left text-sm">
            <thead className="bg-white/5 text-[11px] uppercase tracking-[0.2em] text-sage">
              <tr>
                <th className="w-[6.1rem] px-2 py-3 font-medium">Data/Hora</th>
                <th className="w-[10.75rem] px-2 py-3 font-medium">Confronto</th>
                <th className="hidden px-4 py-3 font-medium">Metodo</th>
                <th className="hidden px-4 py-3 font-medium">Serie</th>
                <th className="hidden px-4 py-3 font-medium">Liga</th>
                <th className="w-[8rem] px-2 py-3 font-medium">Sequencia</th>
                <th className="w-[28rem] px-3 py-3 font-medium">
                  Dia Jogadores
                </th>
                <th className="w-[5rem] px-2 py-3 text-center font-medium">
                  Metrica
                </th>
                <th className="w-[3.8rem] px-1.5 py-3 text-center font-medium">
                  W
                </th>
                <th className="w-[3.8rem] px-1.5 py-3 text-center font-medium">
                  D
                </th>
                <th className="w-[3.8rem] px-1.5 py-3 text-center font-medium">
                  L
                </th>
                <th className="w-[4.75rem] px-2 py-3 text-center font-medium">
                  Volume
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/8 bg-black/10 text-mist">
              {filteredSignals.map((signal) => {
                const series = normalizeSeries(signal.series);
                const playerOneName =
                  signal.playerOneName ??
                  signal.confrontationLabel.split(" x ").at(0) ??
                  "Player 1";
                const playerTwoName =
                  signal.playerTwoName ??
                  signal.confrontationLabel.split(" x ").at(1) ??
                  "Player 2";
                const microTag = [
                  signal.leagueType,
                  series ? `Serie ${series}` : null,
                  signal.methodCode ? `Metodo ${signal.methodCode}` : null,
                ]
                  .filter(Boolean)
                  .join(" • ");

                return (
                  <tr
                    key={signal.signalKey}
                    data-method-code={signal.methodCode}
                    data-series={series ?? ""}
                    data-league-type={signal.leagueType}
                  >
                    <td className="px-2 py-4 text-ivory">
                      <div className="text-[0.78rem] leading-none tabular-nums">
                        {formatCompactDateTime(signal.occurrencePlayedAt).slice(
                          0,
                          8,
                        )}
                      </div>
                      <div className="mt-1 text-[0.78rem] leading-none tabular-nums text-mist">
                        {formatCompactDateTime(signal.occurrencePlayedAt).slice(
                          9,
                        )}
                      </div>
                    </td>

                    <td className="px-2 py-4 text-ivory">
                      {signal.leagueType === "GT LEAGUE" ? (
                        <Link
                          href={`/esoccer/gt-league/disparidade?player1=${encodeURIComponent(playerOneName)}&player2=${encodeURIComponent(playerTwoName)}`}
                          className="text-[0.9rem] font-semibold leading-none text-ivory underline-offset-4 transition hover:text-coral hover:underline"
                        >
                          {signal.confrontationLabel}
                        </Link>
                      ) : (
                        <div className="text-[0.9rem] font-semibold leading-none text-ivory">
                          {signal.confrontationLabel}
                        </div>
                      )}
                      <div className="mt-1 text-[0.7rem] text-mist/72">
                        {microTag}
                      </div>
                    </td>

                    <td className="hidden px-4 py-4 text-ivory">
                      {signal.methodCode}
                    </td>
                    <td className="hidden px-4 py-4 text-ivory">
                      {series ?? "--"}
                    </td>
                    <td className="hidden px-4 py-4 text-ivory">
                      {signal.leagueType}
                    </td>

                    <td className="px-2 py-4">
                      <SequenceStrip
                        items={signal.confrontationSequence}
                        emptyLabel="Sem H2H"
                        fallbackConfrontationLabel={signal.confrontationLabel}
                      />
                    </td>

                    <td className="px-3 py-4">
                      <div className="min-w-[27rem] space-y-1">
                        <div className="flex items-start gap-1.5">
                          <span className="mt-0.5 inline-flex h-5 min-w-[2rem] shrink-0 items-center justify-center rounded-[0.42rem] border border-white/12 bg-black/12 px-1.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-sage">
                            P1
                          </span>
                          <span className="mt-0.5 w-[3rem] shrink-0 truncate text-[10px] uppercase tracking-[0.08em] text-sage">
                            {playerOneName}
                          </span>
                          <SequenceStrip
                            items={signal.playerOneDaySequence}
                            emptyLabel="--"
                            fallbackConfrontationLabel={signal.confrontationLabel}
                          />
                        </div>
                        <div className="flex items-start gap-1.5">
                          <span className="mt-0.5 inline-flex h-5 min-w-[2rem] shrink-0 items-center justify-center rounded-[0.42rem] border border-white/12 bg-black/12 px-1.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-sage">
                            P2
                          </span>
                          <span className="mt-0.5 w-[3rem] shrink-0 truncate text-[10px] uppercase tracking-[0.08em] text-sage">
                            {playerTwoName}
                          </span>
                          <SequenceStrip
                            items={signal.playerTwoDaySequence}
                            emptyLabel="--"
                            fallbackConfrontationLabel={signal.confrontationLabel}
                          />
                        </div>
                      </div>
                    </td>

                    <td className="px-2 py-4 text-center">
                      <div className="inline-flex flex-col items-center justify-center gap-0.5 text-[#8ab9ae]">
                        <span className="scale-[0.88]">
                          <MetricBarsIcon />
                        </span>
                        <span className="text-[10px] font-medium tabular-nums text-sage">
                          {formatPercent(signal.apx)}
                        </span>
                      </div>
                    </td>

                    <td className="px-1.5 py-4 text-center">
                      <span className="portal-live-total-badge portal-live-total-badge--win inline-flex min-w-[2.9rem] items-center justify-center rounded-[0.45rem] border px-1.5 py-1.25 text-[0.88rem] font-medium tabular-nums">
                        {signal.wins}
                      </span>
                    </td>

                    <td className="px-1.5 py-4 text-center">
                      <span className="portal-live-total-badge portal-live-total-badge--draw inline-flex min-w-[2.9rem] items-center justify-center rounded-[0.45rem] border px-1.5 py-1.25 text-[0.88rem] font-medium tabular-nums">
                        {signal.draws}
                      </span>
                    </td>

                    <td className="px-1.5 py-4 text-center">
                      <span className="portal-live-total-badge portal-live-total-badge--loss inline-flex min-w-[2.9rem] items-center justify-center rounded-[0.45rem] border px-1.5 py-1.25 text-[0.88rem] font-medium tabular-nums">
                        {signal.losses}
                      </span>
                    </td>

                    <td className="px-2 py-4 text-center text-[0.9rem] text-ivory tabular-nums">
                      {signal.totalOccurrences}
                    </td>
                  </tr>
                );
              })}

              {filteredSignals.length === 0 ? (
                <tr>
                  <td colSpan={12} className="px-4 py-6 text-center text-sm text-mist">
                    {isHydrating
                      ? "Carregando sinais ao vivo..."
                      : "Nenhum metodo ativo para o filtro atual."}
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}
