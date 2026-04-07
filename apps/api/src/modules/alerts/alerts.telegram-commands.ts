import net from "node:net";
import { env } from "../../core/env";
import { createLogger } from "../../core/logger";
import { AlertsService } from "./alerts.service";

const log = createLogger("telegram");

let pollingHandle: NodeJS.Timeout | null = null;
let pollingLockServer: net.Server | null = null;
let isPolling = false;
let lastUpdateOffset = 0;
let isStartingListener = false;

const TELEGRAM_LONG_POLL_TIMEOUT_SECONDS = 25;
const POLL_RETRY_DELAY_MS = 1_500;
const TELEGRAM_SEND_TIMEOUT_MS = 12_000;
const NEXT_SIGNAL_LOOKUP_TIMEOUT_MS = 8_000;
const MAX_COMMAND_AGE_MS = 10 * 60 * 1000;
const POLLING_LOCK_PORT = Number(
  process.env.TELEGRAM_COMMAND_LISTENER_LOCK_PORT ?? 40103,
);

type TelegramReplyTarget = {
  chatId: string;
  messageThreadId?: number;
  replyToMessageId?: number;
};

type TelegramApiResponsePayload = {
  ok?: boolean;
  parameters?: {
    migrate_to_chat_id?: number | string;
  };
};

type TelegramCommandUpdate = {
  update_id: number;
  message?: {
    chat: { id: number };
    date: number;
    message_id: number;
    message_thread_id?: number;
    text?: string;
  };
};

export function startTelegramCommandListener() {
  const botToken = env.TELEGRAM_BOT_TOKEN;
  if (!botToken || pollingHandle || isStartingListener) {
    return;
  }

  isStartingListener = true;

  const service = new AlertsService();

  const bootstrap = async () => {
    try {
      const restoreResult =
        await service.bootstrapVolatileRulesFromLocalBackup();
      if (restoreResult.restored) {
        log.info(
          { rulesCount: restoreResult.rulesCount },
          "Listener Telegram restaurou alertas do backup local",
        );
      }
    } catch (error) {
      log.error(
        { err: error },
        "Falha ao restaurar alertas no listener dedicado do Telegram",
      );
    }

    try {
      const pendingUpdates = await loadTelegramUpdates(botToken, 0, 100, 1);
      lastUpdateOffset = pendingUpdates[0]?.update_id ?? 0;
    } catch {
      lastUpdateOffset = 0;
    }
  };

  const scheduleNextPoll = (delayMs = 0) => {
    if (pollingHandle) {
      clearTimeout(pollingHandle);
    }

    pollingHandle = setTimeout(() => {
      void poll();
    }, delayMs);
  };

  const poll = async () => {
    if (isPolling) {
      return;
    }

    isPolling = true;
    const startedAt = Date.now();
    let nextDelayMs = 0;

    try {
      const updates = await loadTelegramUpdates(botToken, lastUpdateOffset);

      for (const update of updates) {
        lastUpdateOffset = update.update_id + 1;

        const text = update.message?.text?.trim();
        const chatId = update.message?.chat?.id;
        const messageDate = update.message?.date ?? 0;
        const messageId = update.message?.message_id;
        const messageThreadId = update.message?.message_thread_id;

        if (!text || !chatId) {
          continue;
        }

        log.debug({ text, chatId }, "Telegram comando recebido");

        if (messageDate > 0) {
          const messageAgeMs = Date.now() - messageDate * 1000;
          if (messageAgeMs > MAX_COMMAND_AGE_MS) {
            log.debug(
              { text, ageSec: Math.round(messageAgeMs / 1000) },
              "Telegram comando ignorado por idade",
            );
            continue;
          }
        }

        if (text === "/next" || text.startsWith("/next@")) {
          await handleNextCommand(service, botToken, {
            chatId: String(chatId),
            ...(typeof messageThreadId === "number" ? { messageThreadId } : {}),
            ...(typeof messageId === "number"
              ? { replyToMessageId: messageId }
              : {}),
          });
        }
      }

      const elapsedMs = Date.now() - startedAt;
      if (elapsedMs > 1_500) {
        log.debug(
          { elapsedMs, updates: updates.length },
          "Polling Telegram finalizado",
        );
      }
    } catch (error) {
      log.error({ err: error }, "Erro no polling de comandos Telegram");
      nextDelayMs = POLL_RETRY_DELAY_MS;
    } finally {
      isPolling = false;
      scheduleNextPoll(nextDelayMs);
    }
  };

  void acquirePollingLock()
    .then((lockServer) => {
      if (!lockServer) {
        return;
      }

      pollingLockServer = lockServer;

      void bootstrap().then(() => {
        log.info(
          { lastUpdateOffset },
          "Listener de comandos Telegram ativo (/next)",
        );
        scheduleNextPoll();
      });
    })
    .finally(() => {
      isStartingListener = false;
    });
}

async function acquirePollingLock() {
  return new Promise<net.Server | null>((resolve) => {
    const server = net.createServer();

    const cleanup = () => {
      if (pollingLockServer === server) {
        pollingLockServer = null;
      }
    };

    server.once("error", (error: NodeJS.ErrnoException) => {
      if (error.code === "EADDRINUSE") {
        log.info(
          { lockPort: POLLING_LOCK_PORT },
          "Listener de comandos Telegram ignorado: outra instancia ja detem a trava.",
        );
        resolve(null);
        return;
      }

      log.error(
        { err: error },
        "Falha ao adquirir trava do listener de comandos Telegram",
      );
      resolve(null);
    });

    server.once("listening", () => {
      const releaseLock = () => {
        server.close(() => {
          cleanup();
        });
      };

      process.once("exit", releaseLock);
      process.once("SIGINT", () => {
        releaseLock();
      });
      process.once("SIGTERM", () => {
        releaseLock();
      });

      resolve(server);
    });

    server.listen(POLLING_LOCK_PORT, "127.0.0.1");
  });
}

async function loadTelegramUpdates(
  botToken: string,
  offset: number,
  limit = 100,
  timeoutSeconds = TELEGRAM_LONG_POLL_TIMEOUT_SECONDS,
) {
  const response = await fetch(
    `https://api.telegram.org/bot${botToken}/getUpdates`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      signal: AbortSignal.timeout((timeoutSeconds + 5) * 1000),
      body: JSON.stringify({
        offset,
        limit,
        timeout: timeoutSeconds,
        allowed_updates: ["message"],
      }),
    },
  );

  if (!response.ok) {
    log.error({ status: response.status }, "Telegram getUpdates falhou");
    return [] as TelegramCommandUpdate[];
  }

  const data = (await response.json()) as {
    ok: boolean;
    result?: TelegramCommandUpdate[];
  };

  if (!data.ok || !Array.isArray(data.result)) {
    return [] as TelegramCommandUpdate[];
  }

  return data.result;
}

async function handleNextCommand(
  service: AlertsService,
  botToken: string,
  target: TelegramReplyTarget,
) {
  try {
    const startedAt = Date.now();
    log.debug({ chatId: target.chatId }, "/next iniciado");
    void postTelegramChatAction(botToken, target, "typing").catch((error) => {
      log.error({ err: error }, "Falha ao enviar typing do /next");
    });

    const signals = await withTimeout(
      service.listOpenFutureSignals({ includeRulePreview: false }),
      NEXT_SIGNAL_LOOKUP_TIMEOUT_MS,
      "/next excedeu o tempo limite ao consultar sinais",
    );
    const lookupElapsedMs = Date.now() - startedAt;
    log.debug(
      { count: signals.length, lookupElapsedMs },
      "/next sinais encontrados",
    );

    if (signals.length === 0) {
      await sendTgMessage(botToken, target, "Nenhum sinal ativo no momento.");
      log.debug(
        { elapsedMs: Date.now() - startedAt },
        "/next respondido (sem sinais)",
      );
      return;
    }

    const header = `<b>Sinais ativos (${signals.length}):</b>\n\n`;
    const lines = signals.map((signal) => {
      const apxLabel =
        typeof signal.apx === "number" ? `${signal.apx.toFixed(2)}%` : "-";
      const dateLabel =
        signal.localPlayedAtLabel ||
        formatIsoToLocal(signal.occurrencePlayedAt);
      return `${escapeHtml(dateLabel)} | ${escapeHtml(signal.confrontationLabel)} | ${escapeHtml(signal.methodCode)} | APX: ${escapeHtml(apxLabel)}`;
    });

    const maxLength = 4_000;
    const chunks: string[] = [];
    let current = header;

    for (const line of lines) {
      if (current.length + line.length + 1 > maxLength) {
        chunks.push(current);
        current = "";
      }
      current += (current.length > 0 && current !== header ? "\n" : "") + line;
    }

    if (current.length > 0) {
      chunks.push(current);
    }

    for (const chunk of chunks) {
      log.debug({ chunkLen: chunk.length }, "/next enviando chunk");
      await sendTgMessage(botToken, target, chunk);
    }

    log.debug({ elapsedMs: Date.now() - startedAt }, "/next respondido");
  } catch (error) {
    log.error({ err: error }, "Erro ao responder /next");
    try {
      await sendTgMessage(
        botToken,
        target,
        "O /next demorou mais que o esperado. Tente novamente em alguns segundos.",
      );
    } catch (replyError) {
      log.error({ err: replyError }, "Falha ao enviar fallback do /next");
    }
  }
}

function extractMigratedTelegramChatId(responseText: string) {
  try {
    const payload = JSON.parse(responseText) as TelegramApiResponsePayload;
    const migratedChatId = payload.parameters?.migrate_to_chat_id;
    if (
      typeof migratedChatId === "number" ||
      typeof migratedChatId === "string"
    ) {
      return String(migratedChatId);
    }
  } catch {
    return null;
  }

  return null;
}

async function postTelegramMessage(
  botToken: string,
  target: TelegramReplyTarget,
  text: string,
) {
  const response = await fetch(
    `https://api.telegram.org/bot${botToken}/sendMessage`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      signal: AbortSignal.timeout(TELEGRAM_SEND_TIMEOUT_MS),
      body: JSON.stringify({
        chat_id: target.chatId,
        text,
        parse_mode: "HTML",
        disable_web_page_preview: true,
        ...(typeof target.messageThreadId === "number"
          ? { message_thread_id: target.messageThreadId }
          : {}),
        ...(typeof target.replyToMessageId === "number"
          ? {
              reply_to_message_id: target.replyToMessageId,
              allow_sending_without_reply: true,
            }
          : {}),
      }),
    },
  );

  const body = await response.text();
  return {
    ok: response.ok,
    status: response.status,
    body,
    migratedChatId: extractMigratedTelegramChatId(body),
  };
}

async function postTelegramChatAction(
  botToken: string,
  target: TelegramReplyTarget,
  action: "typing",
) {
  const response = await fetch(
    `https://api.telegram.org/bot${botToken}/sendChatAction`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      signal: AbortSignal.timeout(TELEGRAM_SEND_TIMEOUT_MS),
      body: JSON.stringify({
        chat_id: target.chatId,
        action,
        ...(typeof target.messageThreadId === "number"
          ? { message_thread_id: target.messageThreadId }
          : {}),
      }),
    },
  );

  if (!response.ok) {
    throw new Error(
      `Telegram sendChatAction falhou (${response.status}): ${await response.text()}`,
    );
  }
}

async function sendTgMessage(
  botToken: string,
  target: TelegramReplyTarget,
  text: string,
) {
  let currentTarget = { ...target };
  let response = await postTelegramMessage(botToken, currentTarget, text);

  if (
    !response.ok &&
    response.migratedChatId &&
    response.migratedChatId !== currentTarget.chatId
  ) {
    log.info(
      { from: currentTarget.chatId, to: response.migratedChatId },
      "/next chat migrado",
    );
    currentTarget = {
      ...currentTarget,
      chatId: response.migratedChatId,
    };
    response = await postTelegramMessage(botToken, currentTarget, text);
  }

  if (!response.ok) {
    log.error({ status: response.status }, "/next sendMessage falhou");
    return;
  }

  log.debug({ chatId: currentTarget.chatId }, "/next resposta enviada");
}

function formatIsoToLocal(iso: string): string {
  try {
    const date = new Date(iso);
    return date.toLocaleString("pt-BR", {
      timeZone: "America/Sao_Paulo",
    });
  } catch {
    return iso;
  }
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  errorMessage: string,
) {
  let timeoutHandle: NodeJS.Timeout | null = null;

  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timeoutHandle = setTimeout(() => {
          reject(new Error(errorMessage));
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timeoutHandle) {
      clearTimeout(timeoutHandle);
    }
  }
}
