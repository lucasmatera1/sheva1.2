import { env } from "../../core/env";
import { AlertsService } from "./alerts.service";

let pollingHandle: NodeJS.Timeout | null = null;
let isPolling = false;
let lastUpdateOffset = -1; // -1 = skip all old updates on startup

const POLL_INTERVAL_MS = 3_000;

export function startTelegramCommandListener() {
  const botToken = env.TELEGRAM_BOT_TOKEN;
  if (!botToken || pollingHandle) {
    return;
  }

  const service = new AlertsService();

  // On first run, discard all pending old updates so we only react to new ones
  const bootstrap = async () => {
    try {
      const response = await fetch(`https://api.telegram.org/bot${botToken}/getUpdates`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ offset: -1, timeout: 0, allowed_updates: ["message"] }),
      });

      if (response.ok) {
        const data = (await response.json()) as { ok: boolean; result: Array<{ update_id: number }> };
        if (data.ok && data.result.length > 0) {
          lastUpdateOffset = data.result[data.result.length - 1].update_id + 1;
        } else {
          lastUpdateOffset = 0;
        }
      } else {
        lastUpdateOffset = 0;
      }
    } catch {
      lastUpdateOffset = 0;
    }
  };

  const poll = async () => {
    if (isPolling) return;
    isPolling = true;

    try {
      const response = await fetch(`https://api.telegram.org/bot${botToken}/getUpdates`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          offset: lastUpdateOffset,
          timeout: 1,
          allowed_updates: ["message"],
        }),
      });

      if (!response.ok) {
        console.error("Telegram getUpdates falhou:", response.status, await response.text());
        return;
      }

      const data = (await response.json()) as {
        ok: boolean;
        result: Array<{
          update_id: number;
          message?: {
            chat: { id: number };
            text?: string;
          };
        }>;
      };

      if (!data.ok || !Array.isArray(data.result)) return;

      for (const update of data.result) {
        lastUpdateOffset = update.update_id + 1;

        const text = update.message?.text?.trim();
        const chatId = update.message?.chat?.id;
        if (!text || !chatId) continue;

        console.log(`Telegram comando recebido: "${text}" de chat ${chatId}`);

        if (text === "/next" || text.startsWith("/next@")) {
          await handleNextCommand(service, botToken, String(chatId));
        }
      }
    } catch (error) {
      console.error("Erro no polling de comandos Telegram:", error);
    } finally {
      isPolling = false;
    }
  };

  pollingHandle = setInterval(() => {
    void poll();
  }, POLL_INTERVAL_MS);

  void bootstrap().then(() => {
    console.log(`Listener de comandos Telegram ativo (/next) — offset inicial: ${lastUpdateOffset}`);
    void poll();
  });
}

async function handleNextCommand(service: AlertsService, botToken: string, chatId: string) {
  try {
    const signals = await service.listOpenFutureSignals();
    console.log(`/next: ${signals.length} sinais abertos encontrados`);

    if (signals.length === 0) {
      await sendTgMessage(botToken, chatId, "Nenhum sinal aberto no momento.");
      return;
    }

    const header = `<b>Sinais abertos (${signals.length}):</b>\n\n`;
    const lines = signals.map((s) => {
      const apxLabel = typeof s.apx === "number" ? `${s.apx.toFixed(2)}%` : "-";
      const dateLabel = s.localPlayedAtLabel || formatIsoToLocal(s.occurrencePlayedAt);
      return `${escapeHtml(dateLabel)} | ${escapeHtml(s.confrontationLabel)} | ${escapeHtml(s.methodCode)} | APX: ${escapeHtml(apxLabel)}`;
    });

    // Telegram limit is 4096 chars — split into chunks
    const MAX_LEN = 4000;
    const chunks: string[] = [];
    let current = header;

    for (const line of lines) {
      if (current.length + line.length + 1 > MAX_LEN) {
        chunks.push(current);
        current = "";
      }
      current += (current.length > 0 && current !== header ? "\n" : "") + line;
    }
    if (current.length > 0) chunks.push(current);

    for (const chunk of chunks) {
      await sendTgMessage(botToken, chatId, chunk);
    }
  } catch (error) {
    console.error("Erro ao responder /next:", error);
  }
}

async function sendTgMessage(botToken: string, chatId: string, text: string) {
  const resp = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      text,
      parse_mode: "HTML",
      disable_web_page_preview: true,
    }),
  });

  if (!resp.ok) {
    const body = await resp.text();
    console.error(`/next sendMessage falhou (${resp.status}):`, body);
  }
}

function formatIsoToLocal(iso: string): string {
  try {
    const date = new Date(iso);
    return date.toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" });
  } catch {
    return iso;
  }
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
