import { prisma } from "./prisma";
import { env, isDatabaseConfigured } from "./env";

export async function getDatabaseHealth() {
  if (!isDatabaseConfigured) {
    return {
      configured: false,
      connected: false,
      mode: "mock" as const,
      provider: "mysql" as const,
      databaseUrl: null,
    };
  }

  try {
    await prisma.$queryRaw`SELECT 1`;

    return {
      configured: true,
      connected: true,
      mode: "live" as const,
      provider: "mysql" as const,
      databaseUrl: env.DATABASE_URL ?? null,
    };
  } catch {
    return {
      configured: true,
      connected: false,
      mode: "live" as const,
      provider: "mysql" as const,
      databaseUrl: env.DATABASE_URL ?? null,
    };
  }
}