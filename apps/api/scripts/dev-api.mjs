import { spawn } from "node:child_process";
import net from "node:net";

const port = Number(process.env.PORT || 4003);

await ensurePortAvailable(port);

const command = process.platform === "win32" ? "npx.cmd" : "npx";
const apiChild = spawn(command, ["tsx", "watch", "src/server.ts"], {
  stdio: "inherit",
  cwd: process.cwd(),
  env: {
    ...process.env,
    DISABLE_TELEGRAM_COMMAND_LISTENER: "1",
  },
  shell: process.platform === "win32",
});
const telegramChild = spawn(
  command,
  ["tsx", "watch", "scripts/telegram-command-listener.ts"],
  {
    stdio: "inherit",
    cwd: process.cwd(),
    env: process.env,
    shell: process.platform === "win32",
  },
);

const terminateChild = (signal) => {
  if (!apiChild.killed) {
    apiChild.kill(signal);
  }

  if (!telegramChild.killed) {
    telegramChild.kill(signal);
  }
};

process.on("SIGINT", () => terminateChild("SIGINT"));
process.on("SIGTERM", () => terminateChild("SIGTERM"));

apiChild.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }

  process.exit(code ?? 0);
});

apiChild.on("error", (error) => {
  console.error(`[api-dev] Falha ao iniciar tsx watch: ${error.message}`);
  process.exit(1);
});

telegramChild.on("exit", (code, signal) => {
  if (signal || apiChild.killed) {
    return;
  }

  console.error(
    `[api-dev] Listener dedicado de Telegram encerrou inesperadamente (${signal ?? code ?? "sem codigo"}).`,
  );
});

telegramChild.on("error", (error) => {
  console.error(
    `[api-dev] Falha ao iniciar listener dedicado de Telegram: ${error.message}`,
  );
});

function ensurePortAvailable(targetPort) {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();

    probe.once("error", (error) => {
      if (error && error.code === "EADDRINUSE") {
        console.error(`[api-dev] Porta ${targetPort} ja esta em uso. Encerre a instancia atual da API antes de iniciar outra.`);
        reject(error);
        return;
      }

      reject(error);
    });

    probe.once("listening", () => {
      probe.close((closeError) => {
        if (closeError) {
          reject(closeError);
          return;
        }

        resolve();
      });
    });

    probe.listen(targetPort, "0.0.0.0");
  });
}
