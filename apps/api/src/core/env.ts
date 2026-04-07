import { config } from "dotenv";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { z } from "zod";

// Load .env from monorepo root (../../.env relative to apps/api).
// In production the env vars may already be set by PM2/systemd, so missing
// file is fine – dotenv silently ignores it.
const dotenvPath = resolve(process.cwd(), "../../.env");
if (existsSync(dotenvPath)) {
  config({ path: dotenvPath });
}

const optionalString = z.preprocess(
  (value) =>
    typeof value === "string" && value.trim() === "" ? undefined : value,
  z.string().min(1).optional(),
);

const optionalUrl = z.preprocess(
  (value) =>
    typeof value === "string" && value.trim() === "" ? undefined : value,
  z.string().url().optional(),
);

const booleanEnv = z
  .preprocess((value) => {
    if (typeof value !== "string") {
      return value;
    }

    const normalized = value.trim().toLowerCase();
    if (["1", "true", "yes", "on"].includes(normalized)) {
      return true;
    }

    if (["0", "false", "no", "off"].includes(normalized)) {
      return false;
    }

    return value;
  }, z.boolean().optional())
  .transform((value) => value ?? false);

const optionalPositiveInteger = z.preprocess(
  (value) =>
    typeof value === "string" && value.trim() === "" ? undefined : value,
  z.coerce.number().int().positive().optional(),
);

const envSchema = z.object({
  DATABASE_URL: optionalString,
  MYSQL_ODBC_CONNECTION_STRING: optionalString,
  MYSQL_ODBC_SCHEMA: optionalString,
  PORT: z.coerce.number().default(4003),
  LOG_LEVEL: z
    .enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"])
    .default("info"),
  NEXT_PUBLIC_API_URL: optionalUrl,
  ALERTS_ENABLED: booleanEnv,
  ALERTS_POLL_INTERVAL_MS: optionalPositiveInteger,
  ALERTS_LOCAL_BACKUP_ENABLED: booleanEnv,
  ALERTS_LOCAL_BACKUP_INTERVAL_MS: optionalPositiveInteger,
  ALERTS_WEBHOOK_URL: optionalUrl,
  ALERTS_WEBHOOK_TOKEN: optionalString,
  TELEGRAM_BOT_TOKEN: optionalString,
  TELEGRAM_DEFAULT_CHAT_IDS: optionalString,
  ALERTS_GOOGLE_SHEETS_WEBHOOK_URL: optionalUrl,
});

export const env = envSchema.parse(process.env);
export const isDatabaseConfigured = Boolean(env.DATABASE_URL);
export const isOdbcConfigured = Boolean(env.MYSQL_ODBC_CONNECTION_STRING);
