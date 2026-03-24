import "./env";

import { PrismaClient } from "@prisma/client";
import { env } from "./env";

let prismaInstance: PrismaClient | undefined = undefined;

export const prisma = (() => {
  if (prismaInstance) return prismaInstance;
  prismaInstance = new PrismaClient({
    ...(env.DATABASE_URL ? { datasourceUrl: env.DATABASE_URL } : {}),
  });
  return prismaInstance;
})();