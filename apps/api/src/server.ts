import { env } from "./core/env";
import { createLogger } from "./core/logger";
import { app } from "./app";

const log = createLogger("server");
import {
  startAlertsLocalBackupRunner,
  startAlertsRunner,
} from "./modules/alerts/alerts.runner";
import { startTelegramCommandListener } from "./modules/alerts/alerts.telegram-commands";
import { AlertsService } from "./modules/alerts/alerts.service";
import { startPortalGTLiveTableRunner } from "./modules/portal/portal-gt-live-table.service";
import { startPortalLiveFeedRunner } from "./modules/portal/portal-live-feed.service";
import { startPortalMethodOccurrencesSyncRunner } from "./modules/portal/portal-method-occurrences.service";
import { startPortalGTPanoramaRunner } from "./modules/portal/portal-panorama.service";
import { startPortalGTDisparityRunner } from "./modules/portal/portal-disparity.service";

// ---------------------------------------------------------------------------
// Global crash handlers – keep the process alive on stray rejections/errors
// ---------------------------------------------------------------------------
process.on("uncaughtException", (error) => {
  log.fatal({ err: error }, "uncaughtException – a API vai encerrar.");
  process.exit(1);
});

process.on("unhandledRejection", (reason) => {
  log.warn({ err: reason }, "unhandledRejection – a API segue ativa.");
});

const server = app.listen(env.PORT);

server.once("error", (error: NodeJS.ErrnoException) => {
  if (error.code === "EADDRINUSE") {
    log.fatal(
      { port: env.PORT },
      "Porta ja esta em uso. Mantenha apenas uma instancia da API rodando.",
    );
    process.exit(1);
  }

  log.fatal({ err: error }, "Falha ao iniciar a API");
  process.exit(1);
});

server.once("listening", async () => {
  log.info({ port: env.PORT }, "API online");

  const alertsService = new AlertsService();
  try {
    const bootstrapResult =
      await alertsService.bootstrapVolatileRulesFromLocalBackup();
    if (bootstrapResult.restored) {
      log.info(
        { rulesCount: bootstrapResult.rulesCount },
        "Regras de alertas restauradas do backup local no startup",
      );
    }
  } catch (error) {
    log.error(
      { err: error },
      "Falha ao inicializar alertas no bootstrap; API seguira ativa sem bloquear rotas nao relacionadas.",
    );
  }

  startAlertsRunner();
  startAlertsLocalBackupRunner();

  // Stagger heavy portal runners to avoid concurrent memory spikes.
  // Each runner does large Prisma queries on startup; running them all at once
  // can push the process past 3GB and block the event loop for minutes.
  const STAGGER_MS = 15_000;
  setTimeout(() => startPortalGTLiveTableRunner(), STAGGER_MS * 0);
  setTimeout(() => startPortalGTPanoramaRunner(), STAGGER_MS * 1);
  setTimeout(() => startPortalGTDisparityRunner(), STAGGER_MS * 2);
  setTimeout(() => startPortalLiveFeedRunner(), STAGGER_MS * 3);
  setTimeout(() => startPortalMethodOccurrencesSyncRunner(), STAGGER_MS * 4);
  const telegramCommandListenerDisabled = ["1", "true", "yes"].includes(
    String(process.env.DISABLE_TELEGRAM_COMMAND_LISTENER ?? "").toLowerCase(),
  );

  if (telegramCommandListenerDisabled) {
    log.info("Listener embutido de comandos Telegram desativado por ambiente.");
  } else {
    startTelegramCommandListener();
  }
});

// ---------------------------------------------------------------------------
// Graceful shutdown – let PM2/systemd stop the process cleanly
// ---------------------------------------------------------------------------
function gracefulShutdown(signal: string) {
  log.info({ signal }, "Sinal recebido – encerrando servidor HTTP...");
  server.close(() => {
    log.info("Servidor HTTP encerrado. Saindo.");
    process.exit(0);
  });

  // Force exit after 10 seconds if connections hang
  setTimeout(() => {
    log.error("Timeout de 10s atingido – forcando saida.");
    process.exit(1);
  }, 10_000).unref();
}

process.once("SIGTERM", () => gracefulShutdown("SIGTERM"));
process.once("SIGINT", () => gracefulShutdown("SIGINT"));
