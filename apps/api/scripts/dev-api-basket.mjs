import { spawn } from "node:child_process";
import net from "node:net";

const port = Number(process.env.BASKET_API_PORT || 4013);

await ensurePortAvailable(port);

const command = process.platform === "win32" ? "npx.cmd" : "npx";
const child = spawn(command, ["tsx", "watch", "src/server-basket.ts"], {
  stdio: "inherit",
  cwd: process.cwd(),
  env: {
    ...process.env,
    BASKET_API_PORT: String(port),
  },
  shell: process.platform === "win32",
});

const terminateChild = (signal) => {
  if (!child.killed) {
    child.kill(signal);
  }
};

process.on("SIGINT", () => terminateChild("SIGINT"));
process.on("SIGTERM", () => terminateChild("SIGTERM"));

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }

  process.exit(code ?? 0);
});

child.on("error", (error) => {
  console.error(`[basket-api-dev] Falha ao iniciar tsx watch: ${error.message}`);
  process.exit(1);
});

function ensurePortAvailable(targetPort) {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();

    probe.once("error", (error) => {
      if (error && error.code === "EADDRINUSE") {
        console.error(`[basket-api-dev] Porta ${targetPort} ja esta em uso. Encerre a instancia atual da Basket API antes de iniciar outra.`);
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