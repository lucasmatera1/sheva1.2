"use client";

import { useEffect, useState, useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { apiUrl } from "../../lib/api";

const DASHBOARD_AUTO_REFRESH_INTERVAL_MS = 60000;
const DASHBOARD_SNAPSHOT_CACHE_PREFIX = "sheva.dashboard.snapshot.";
const DASHBOARD_REFRESH_POLL_INTERVAL_MS = 3000;
const DASHBOARD_REFRESH_MAX_WAIT_MS = 120000;
const DASHBOARD_REFRESH_REQUEST_TIMEOUT_MS = 120000;

type DashboardRefreshButtonProps = {
  leagueType: string;
  autoRefreshOnMount?: boolean;
  autoRefreshKey?: string;
  snapshot?: {
    generatedAt: string;
    currentWindow: {
      dayLabel: string;
      windowLabel: string;
      rangeLabel: string;
      usesOperationalDay: boolean;
    };
    totals: {
      currentWindowPlayedMatches: number;
      currentWindowUpcomingFixtures: number;
    };
  } | null;
};

type CachedDashboardSnapshot = {
  snapshot: NonNullable<DashboardRefreshButtonProps["snapshot"]>;
  savedAt: string;
};

function cacheSnapshot(leagueType: string, nextSnapshot: NonNullable<DashboardRefreshButtonProps["snapshot"]>) {
  const nextCachedSnapshot = {
    snapshot: nextSnapshot,
    savedAt: nextSnapshot.generatedAt,
  } satisfies CachedDashboardSnapshot;

  writeCachedSnapshot(leagueType, nextCachedSnapshot);
  return nextCachedSnapshot;
}

function buildNextRoute(pathname: string, searchParams: URLSearchParams, timestamp: string) {
  const nextParams = new URLSearchParams(searchParams.toString());
  nextParams.set("ts", timestamp);
  nextParams.delete("refresh");
  return `${pathname}?${nextParams.toString()}`;
}

function DashboardRefreshButton({ leagueType, autoRefreshOnMount = false, autoRefreshKey, snapshot = null }: DashboardRefreshButtonProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();
  const [cachedSnapshot, setCachedSnapshot] = useState<CachedDashboardSnapshot | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [syncStatus, setSyncStatus] = useState<"idle" | "syncing" | "ok" | "error">(snapshot ? "ok" : "idle");

  useEffect(() => {
    const cachedValue = readCachedSnapshot(leagueType);
    if (cachedValue) {
      setCachedSnapshot(cachedValue);
      if (!snapshot) {
        setSyncStatus("error");
      }
    }
  }, [leagueType]);

  useEffect(() => {
    if (snapshot) {
      const nextCachedSnapshot = cacheSnapshot(leagueType, snapshot);
      setCachedSnapshot(nextCachedSnapshot);
      setSyncStatus("ok");
      return;
    }

    setSyncStatus((current) => (current === "syncing" ? current : cachedSnapshot ? "error" : "idle"));
  }, [leagueType, snapshot]);

  useEffect(() => {
    const runAutoRefresh = () => {
      if (typeof document !== "undefined" && document.visibilityState !== "visible") {
        return;
      }

      triggerRefresh();
    };

    const intervalHandle = setInterval(runAutoRefresh, DASHBOARD_AUTO_REFRESH_INTERVAL_MS);
    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        runAutoRefresh();
      }
    };

    if (typeof document !== "undefined") {
      document.addEventListener("visibilitychange", handleVisibilityChange);
    }

    return () => {
      clearInterval(intervalHandle);
      if (typeof document !== "undefined") {
        document.removeEventListener("visibilitychange", handleVisibilityChange);
      }
    };
  }, [searchParams]);

  const displaySnapshot = snapshot ?? cachedSnapshot?.snapshot ?? null;
  const lastSyncedAt = snapshot?.generatedAt ?? cachedSnapshot?.savedAt ?? null;
  const isBusy = isRefreshing || isPending;

  useEffect(() => {
    if (!autoRefreshOnMount || isBusy) {
      return;
    }

    if (typeof window === "undefined") {
      return;
    }

    const refreshAttemptKey = `${DASHBOARD_SNAPSHOT_CACHE_PREFIX}${leagueType}.auto.${autoRefreshKey ?? snapshot?.generatedAt ?? "empty"}`;

    if (window.sessionStorage.getItem(refreshAttemptKey) === "1") {
      return;
    }

    window.sessionStorage.setItem(refreshAttemptKey, "1");
    void triggerRefresh();
  }, [autoRefreshKey, autoRefreshOnMount, isBusy, leagueType, snapshot?.generatedAt]);

  const triggerRefresh = async () => {
    if (isBusy) {
      return;
    }

    setIsRefreshing(true);
    setSyncStatus("syncing");

    try {
      const params = new URLSearchParams();
      params.set("league", leagueType);
      const optimisticRefreshToken = Date.now().toString();

      try {
        await fetch(`${apiUrl}/dashboard/current-j/refresh?${params.toString()}`, {
          method: "POST",
          cache: "no-store",
          signal: AbortSignal.timeout(DASHBOARD_REFRESH_REQUEST_TIMEOUT_MS),
        });
      } catch {}

      if (!snapshot) {
        startTransition(() => {
          router.replace(buildNextRoute(pathname, searchParams, optimisticRefreshToken), { scroll: false });
          router.refresh();
        });
      }

      const baselineTimestamp = displaySnapshot?.generatedAt ?? cachedSnapshot?.savedAt ?? null;
      const deadline = Date.now() + DASHBOARD_REFRESH_MAX_WAIT_MS;
      let refreshedSnapshot: NonNullable<DashboardRefreshButtonProps["snapshot"]> | null = null;

      while (Date.now() < deadline) {
        await new Promise((resolve) => window.setTimeout(resolve, DASHBOARD_REFRESH_POLL_INTERVAL_MS));

        const pollResponse = await fetch(`${apiUrl}/dashboard/current-j?${params.toString()}`, {
          cache: "no-store",
          signal: AbortSignal.timeout(DASHBOARD_REFRESH_REQUEST_TIMEOUT_MS),
        });

        if (!pollResponse.ok) {
          continue;
        }

        const polledSnapshot = await pollResponse.json() as Partial<NonNullable<DashboardRefreshButtonProps["snapshot"]>>;

        if (!polledSnapshot.generatedAt || !polledSnapshot.currentWindow || !polledSnapshot.totals) {
          continue;
        }

        if (!baselineTimestamp || polledSnapshot.generatedAt !== baselineTimestamp) {
          refreshedSnapshot = polledSnapshot as NonNullable<DashboardRefreshButtonProps["snapshot"]>;
          break;
        }
      }

      if (!refreshedSnapshot) {
        setSyncStatus("error");
        return;
      }

      setCachedSnapshot(cacheSnapshot(leagueType, refreshedSnapshot));
      setSyncStatus("ok");

      startTransition(() => {
        router.replace(buildNextRoute(pathname, searchParams, refreshedSnapshot.generatedAt), { scroll: false });
        router.refresh();
      });
    } catch {
      setSyncStatus("error");
    } finally {
      setIsRefreshing(false);
    }
  };
  const statusLabel = syncStatus === "ok" ? "Sincronizado" : syncStatus === "error" ? "Falha ao atualizar" : syncStatus === "syncing" ? "Atualizando" : "Aguardando";
  const statusClassName = syncStatus === "ok"
    ? "bg-emerald-100 text-emerald-800"
    : syncStatus === "error"
      ? "bg-rose-100 text-rose-800"
      : syncStatus === "syncing"
        ? "bg-sky-100 text-sky-800"
        : "bg-white/18 text-white";

  return (
    <div className="rounded-[1.15rem] border border-ink/10 bg-[#20352e] px-4 py-4 text-left text-white">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[11px] uppercase tracking-[0.18em] text-white/72">Atualizacao</p>
          <p className="mt-2 text-lg font-semibold">{isBusy ? "Atualizando agora..." : "Auto 60s"}</p>
        </div>
        <span className={`rounded-full px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.16em] ${statusClassName}`}>
          {statusLabel}
        </span>
      </div>

      <p className="mt-3 text-sm text-white/78">
        {lastSyncedAt ? `Ultima sincronizacao em ${formatSyncDateTime(lastSyncedAt)}.` : "Sem sincronizacao concluida ainda."}
      </p>
      <p className="mt-2 text-xs leading-5 text-white/65">
        {displaySnapshot
          ? `${displaySnapshot.currentWindow.usesOperationalDay ? displaySnapshot.currentWindow.windowLabel : displaySnapshot.currentWindow.dayLabel} | ${displaySnapshot.currentWindow.rangeLabel} · ${displaySnapshot.totals.currentWindowPlayedMatches} fechados · ${displaySnapshot.totals.currentWindowUpcomingFixtures} na fila`
          : "Sem snapshot local salvo ainda."}
      </p>

      <button
        type="button"
        onClick={triggerRefresh}
        disabled={isBusy}
        className="mt-4 inline-flex rounded-full border border-white/18 bg-white/10 px-4 py-2 text-sm font-semibold text-white transition hover:bg-white/16 disabled:cursor-wait disabled:opacity-75"
      >
        {isBusy ? "Atualizando..." : "Forcar agora"}
      </button>
    </div>
  );
}

function readCachedSnapshot(leagueType: string) {
  if (typeof window === "undefined") {
    return null;
  }

  try {
    const rawValue = window.localStorage.getItem(`${DASHBOARD_SNAPSHOT_CACHE_PREFIX}${leagueType}`);
    if (!rawValue) {
      return null;
    }

    const parsed = JSON.parse(rawValue) as Partial<CachedDashboardSnapshot>;
    if (!parsed.snapshot || typeof parsed.savedAt !== "string") {
      return null;
    }

    return parsed as CachedDashboardSnapshot;
  } catch {
    return null;
  }
}

function writeCachedSnapshot(leagueType: string, value: CachedDashboardSnapshot) {
  if (typeof window === "undefined") {
    return;
  }

  try {
    window.localStorage.setItem(`${DASHBOARD_SNAPSHOT_CACHE_PREFIX}${leagueType}`, JSON.stringify(value));
  } catch {}
}

function formatSyncDateTime(value: string) {
  return new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "short",
    timeStyle: "short",
  }).format(new Date(value));
}

export { DashboardRefreshButton };