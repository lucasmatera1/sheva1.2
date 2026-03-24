import { env } from "../src/core/env";
import { AlertsService } from "../src/modules/alerts/alerts.service";

const service = new AlertsService();
const token = env.TELEGRAM_BOT_TOKEN;
const chatId = "-5196233799";

console.log("Token:", token ? "OK" : "MISSING");

try {
  const signals = await service.listOpenFutureSignals();
  console.log("Sinais encontrados:", signals.length);

  const message =
    signals.length === 0
      ? "Nenhum sinal aberto no momento."
      : signals.map((s) => `${s.confrontationLabel} | ${s.methodCode} | APX: ${s.apx}`).join("\n");

  console.log("Mensagem:", message);

  const resp = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text: message }),
  });

  const text = await resp.text();
  console.log("Status:", resp.status);
  console.log("Response:", text.substring(0, 300));
} catch (e) {
  console.error("ERRO:", e);
}

process.exit(0);
