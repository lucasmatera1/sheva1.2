import {
  getGtPanoramaLive,
  getDisparityOperationalWindow,
} from "../../core/live-analytics";
import { createLogger } from "../../core/logger";

const log = createLogger("panorama");

const GT_PANORAMA_REFRESH_INTERVAL_MS = 30_000;
const GT_PANORAMA_HISTORY_DAYS = 5;

let gtPanoramaRefreshTimer: NodeJS.Timeout | null = null;
let gtPanoramaSyncInProgress = false;
let gtPanoramaHistoryGenerated = false;

function getRecentDayKeys(count: number) {
  const todayKey = getDisparityOperationalWindow(
    new Date(),
    "GT LEAGUE",
  ).dayKey;
  const [y, m, d] = todayKey.split("-").map(Number);
  const keys: string[] = [];

  for (let i = 1; i <= count; i++) {
    const date = new Date(y, m - 1, d - i, 12, 0, 0);
    keys.push(
      `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`,
    );
  }

  return keys;
}

async function runPortalGTPanoramaRefreshSafely() {
  if (gtPanoramaSyncInProgress) {
    return;
  }

  gtPanoramaSyncInProgress = true;

  try {
    await getGtPanoramaLive();
  } catch (error) {
    log.error(
      { err: error },
      "Falha ao atualizar panorama da GT League do portal",
    );
  } finally {
    gtPanoramaSyncInProgress = false;
  }
}

async function generateHistoricalSnapshots() {
  const dayKeys = getRecentDayKeys(GT_PANORAMA_HISTORY_DAYS);
  log.info(
    { days: dayKeys.length },
    "Gerando snapshots historicos do panorama (batch)...",
  );

  let generated = 0;

  for (const dayKey of dayKeys) {
    try {
      await getGtPanoramaLive(dayKey);
      generated++;

      // Yield to event loop between each heavy computation so the API stays
      // responsive and Node can GC intermediate data.
      await new Promise((resolve) => setTimeout(resolve, 500));
    } catch (error) {
      log.error(
        { dayKey, reason: (error as Error).message },
        "Falha ao gerar snapshot do dia",
      );
    }
  }

  log.info(
    { generated, total: dayKeys.length },
    "Snapshots historicos gerados.",
  );
}

export function triggerPortalGTPanoramaRefresh() {
  if (gtPanoramaSyncInProgress) {
    return;
  }

  void runPortalGTPanoramaRefreshSafely();
}

export function startPortalGTPanoramaRunner() {
  if (gtPanoramaRefreshTimer) {
    return;
  }

  void runPortalGTPanoramaRefreshSafely();

  // Gerar snapshots históricos uma vez no startup (em background, sem bloquear).
  if (!gtPanoramaHistoryGenerated) {
    gtPanoramaHistoryGenerated = true;
    setTimeout(() => {
      void generateHistoricalSnapshots();
    }, 30_000);
  }

  gtPanoramaRefreshTimer = setInterval(() => {
    void runPortalGTPanoramaRefreshSafely();
  }, GT_PANORAMA_REFRESH_INTERVAL_MS);

  log.info(
    { intervalMs: GT_PANORAMA_REFRESH_INTERVAL_MS },
    "Panorama da GT League do portal ativo",
  );
}
