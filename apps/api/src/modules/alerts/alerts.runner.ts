import { env } from "../../core/env";
import { AlertsService } from "./alerts.service";

let intervalHandle: NodeJS.Timeout | null = null;
let isRunning = false;
let backupIntervalHandle: NodeJS.Timeout | null = null;
let isBackupRunning = false;

const CYCLE_TIMEOUT_MS = 3 * 60 * 1000; // 3 min — abort cycle if it hangs

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Timeout: ${label} excedeu ${ms / 1000}s`)), ms);
    promise.then(
      (value) => { clearTimeout(timer); resolve(value); },
      (error) => { clearTimeout(timer); reject(error); },
    );
  });
}

export function startAlertsRunner() {
  if (!env.ALERTS_ENABLED || !env.ALERTS_POLL_INTERVAL_MS || intervalHandle) {
    return;
  }

  const service = new AlertsService();
  const runCycle = async () => {
    if (isRunning) {
      return;
    }

    isRunning = true;

    try {
      await withTimeout(
        service.runRules({ dryRun: false, onlyActive: true, source: "scheduler" }),
        CYCLE_TIMEOUT_MS,
        "runRules",
      );
    } catch (error) {
      console.error("Erro ao executar runner de alertas", error);
    }

    try {
      await withTimeout(
        service.resolveFutureResults({ source: "scheduler" }),
        CYCLE_TIMEOUT_MS,
        "resolveFutureResults",
      );
    } catch (error) {
      console.error("Erro ao resolver resultados de jogos futuros dos alertas", error);
    } finally {
      isRunning = false;
    }
  };

  void runCycle();
  intervalHandle = setInterval(() => {
    void runCycle();
  }, env.ALERTS_POLL_INTERVAL_MS);

  console.log(`Runner de alertas ativo a cada ${env.ALERTS_POLL_INTERVAL_MS}ms`);
}

export function startAlertsLocalBackupRunner() {
  if (!env.ALERTS_LOCAL_BACKUP_ENABLED || !env.ALERTS_LOCAL_BACKUP_INTERVAL_MS || backupIntervalHandle) {
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
      console.error("Erro ao executar backup local automatico de alertas", error);
    } finally {
      isBackupRunning = false;
    }
  };

  void runCycle();
  backupIntervalHandle = setInterval(() => {
    void runCycle();
  }, env.ALERTS_LOCAL_BACKUP_INTERVAL_MS);

  console.log(`Backup local automatico de alertas ativo a cada ${env.ALERTS_LOCAL_BACKUP_INTERVAL_MS}ms`);
}