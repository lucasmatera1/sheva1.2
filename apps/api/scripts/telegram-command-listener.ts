import { startTelegramCommandListener } from "../src/modules/alerts/alerts.telegram-commands";

startTelegramCommandListener();
console.log("Listener dedicado de comandos Telegram ativo.");

setInterval(() => {
  // Mantem o processo vivo para o polling do Telegram.
}, 60_000);
