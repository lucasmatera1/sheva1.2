import { env } from "../../core/env";
import { createLogger } from "../../core/logger";
import { AlertsService } from "./alerts.service";

const log = createLogger("alerts-runner");

let intervalHandle: NodeJS.Timeout | null = null;
let isRunning = false;
let backupIntervalHandle: NodeJS.Timeout | null = null;
let isBackupRunning = false;

const SLOW_PHASE_WARNING_MS = 3 * 60 * 1000;

async function watchSlowPhase<T>(
  promise: Promise<T>,
  label: string,
  warningMs = SLOW_PHASE_WARNING_MS,
) {
  const startedAt = Date.now();
  const timer = setTimeout(() => {
    log.warn(
      { label, elapsedSec: Math.round(warningMs / 1000) },
      "Fase lenta segue em execucao",
    );
  }, warningMs);

  try {
    return await promise;
  } finally {
    clearTimeout(timer);
    const elapsedMs = Date.now() - startedAt;
    if (elapsedMs > warningMs) {
      log.warn(
        { label, elapsedSec: Math.round(elapsedMs / 1000) },
        "Fase lenta concluida",
      );
    }
  }
}

export function startAlertsRunner() {
  if (!env.ALERTS_ENABLED || !env.ALERTS_POLL_INTERVAL_MS || intervalHandle) {
    return;
  }

  const service = new AlertsService();

  const scheduleNextRun = () => {
    intervalHandle = setTimeout(() => {
      void runCycle();
    }, env.ALERTS_POLL_INTERVAL_MS);
  };

  const runCycle = async () => {
    if (isRunning) {
      return;
    }

    isRunning = true;

    try {
      await watchSlowPhase(
        service.runRules({
          dryRun: false,
          onlyActive: true,
          source: "scheduler",
        }),
        "runRules",
      );
    } catch (error) {
      log.error({ err: error }, "Erro ao executar runner de alertas");
    }

    try {
      await watchSlowPhase(
        service.resolveFutureResults({ source: "scheduler" }),
        "resolveFutureResults",
      );
    } catch (error) {
      log.error(
        { err: error },
        "Erro ao resolver resultados de jogos futuros dos alertas",
      );
    } finally {
      isRunning = false;
      scheduleNextRun();
    }
  };

  void runCycle();

  log.info(
    { intervalMs: env.ALERTS_POLL_INTERVAL_MS },
    "Runner de alertas ativo",
  );
}

export function startAlertsLocalBackupRunner() {
  if (
    !env.ALERTS_LOCAL_BACKUP_ENABLED ||
    !env.ALERTS_LOCAL_BACKUP_INTERVAL_MS ||
    backupIntervalHandle
  ) {
    return;
  }

  const service = new AlertsService();
  const runCycle = async () => {
    if (isBackupRunning) {
      return;
    }

    isBackupRunning = true;

    try {
      await service.saveRulesBackupToLocalFile();
    } catch (error) {
      log.error(
        { err: error },
        "Erro ao executar backup local automatico de alertas",
      );
    } finally {
      isBackupRunning = false;
    }
  };

  void runCycle();
  backupIntervalHandle = setInterval(() => {
    void runCycle();
  }, env.ALERTS_LOCAL_BACKUP_INTERVAL_MS);

  log.info(
    { intervalMs: env.ALERTS_LOCAL_BACKUP_INTERVAL_MS },
    "Backup local automatico de alertas ativo",
  );
}
