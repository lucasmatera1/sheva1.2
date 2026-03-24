import { env } from "./core/env";
import { app } from "./app";
import { startAlertsLocalBackupRunner, startAlertsRunner } from "./modules/alerts/alerts.runner";
import { startTelegramCommandListener } from "./modules/alerts/alerts.telegram-commands";
import { AlertsService } from "./modules/alerts/alerts.service";

const server = app.listen(env.PORT);

server.once("error", (error: NodeJS.ErrnoException) => {
  if (error.code === "EADDRINUSE") {
    console.error(`Porta ${env.PORT} ja esta em uso. Mantenha apenas uma instancia da API rodando.`);
    process.exit(1);
  }

  console.error("Falha ao iniciar a API", error);
  process.exit(1);
});

server.once("listening", async () => {
  console.log(`API online na porta ${env.PORT}`);

  const alertsService = new AlertsService();
  try {
    const bootstrapResult = await alertsService.bootstrapVolatileRulesFromLocalBackup();
    if (bootstrapResult.restored) {
      console.log(`Regras de alertas restauradas do backup local no startup: ${bootstrapResult.rulesCount}`);
    }
  } catch (error) {
    console.error("Falha ao inicializar alertas no bootstrap; API seguira ativa sem bloquear rotas nao relacionadas.", error);
  }

  startAlertsRunner();
  startAlertsLocalBackupRunner();
  startTelegramCommandListener();
});