import crypto from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";

export type LoginAuditLocation = {
  label: string;
  country?: string | null;
  region?: string | null;
  city?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  source: "local" | "header" | "lookup" | "unknown";
};

export type LoginAuditEntry = {
  id: string;
  attemptedAt: string;
  username: string;
  success: boolean;
  ip: string | null;
  location: LoginAuditLocation;
  userAgent: string | null;
  failureReason?: string;
};

type AppendLoginAuditEntryInput = {
  username: string;
  success: boolean;
  ip: string | null;
  location: LoginAuditLocation;
  userAgent: string | null;
  failureReason?: string;
};

const AUDIT_DIR = process.env.PORTAL_AUDIT_LOG_DIR
  ? path.resolve(process.env.PORTAL_AUDIT_LOG_DIR)
  : path.resolve(process.cwd(), "../../tmp/portal");
const AUDIT_FILE = path.join(AUDIT_DIR, "login-audit.jsonl");

function parseForwardedHeader(value: string | null) {
  if (!value) {
    return null;
  }

  const match = value.match(/for=\"?([^;,\"]+)/i);
  return match?.[1] ?? null;
}

function normaliseIp(ip: string | null): string | null {
  if (!ip) {
    return null;
  }

  const cleaned = ip.trim().replace(/^\[|\]$/g, "");
  if (!cleaned) {
    return null;
  }

  if (cleaned.includes(",") || cleaned.includes(" ")) {
    return (
      cleaned
        .split(/[,\s]+/)
        .map((item): string | null => normaliseIp(item))
        .find((item): item is string => Boolean(item)) ?? null
    );
  }

  if (/^\d+\.\d+\.\d+\.\d+:\d+$/.test(cleaned)) {
    return cleaned.split(":")[0] ?? null;
  }

  return cleaned;
}

function isPrivateOrLocalIp(ip: string | null) {
  if (!ip) {
    return true;
  }

  if (ip === "::1" || ip === "localhost") {
    return true;
  }

  if (ip.startsWith("127.") || ip.startsWith("10.") || ip.startsWith("192.168.")) {
    return true;
  }

  if (/^172\.(1[6-9]|2\d|3[01])\./.test(ip)) {
    return true;
  }

  return ip.startsWith("fc") || ip.startsWith("fd");
}

function buildLocationLabel(parts: Array<string | null | undefined>) {
  const filtered = parts.filter(Boolean) as string[];
  return filtered.length > 0 ? filtered.join(", ") : "Localizacao indisponivel";
}

async function fetchLookupLocation(ip: string): Promise<LoginAuditLocation | null> {
  if (process.env.PORTAL_GEO_LOOKUP_ENABLED === "0") {
    return null;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 1800);

  try {
    const response = await fetch(`https://ipwho.is/${encodeURIComponent(ip)}`, {
      cache: "no-store",
      signal: controller.signal,
    });

    if (!response.ok) {
      return null;
    }

    const payload = (await response.json()) as {
      success?: boolean;
      country?: string;
      region?: string;
      city?: string;
      latitude?: number;
      longitude?: number;
    };

    if (!payload.success) {
      return null;
    }

    return {
      label: buildLocationLabel([payload.city, payload.region, payload.country]),
      country: payload.country ?? null,
      region: payload.region ?? null,
      city: payload.city ?? null,
      latitude: payload.latitude ?? null,
      longitude: payload.longitude ?? null,
      source: "lookup",
    };
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

export async function resolveLoginAuditSnapshot(headerStore: Headers) {
  const ip = normaliseIp(
    headerStore.get("cf-connecting-ip") ??
      headerStore.get("x-forwarded-for") ??
      headerStore.get("x-real-ip") ??
      headerStore.get("fly-client-ip") ??
      parseForwardedHeader(headerStore.get("forwarded")),
  );

  const providerLocation = {
    country: headerStore.get("x-vercel-ip-country") ?? headerStore.get("cf-ipcountry"),
    region: headerStore.get("x-vercel-ip-country-region") ?? headerStore.get("cf-region"),
    city: headerStore.get("x-vercel-ip-city") ?? headerStore.get("cf-ipcity"),
    latitude: headerStore.get("x-vercel-ip-latitude"),
    longitude: headerStore.get("x-vercel-ip-longitude"),
  };

  let location: LoginAuditLocation;

  if (isPrivateOrLocalIp(ip)) {
    location = {
      label: "Ambiente local",
      source: "local",
    };
  } else if (providerLocation.country || providerLocation.region || providerLocation.city) {
    location = {
      label: buildLocationLabel([providerLocation.city, providerLocation.region, providerLocation.country]),
      country: providerLocation.country,
      region: providerLocation.region,
      city: providerLocation.city,
      latitude: providerLocation.latitude ? Number(providerLocation.latitude) : null,
      longitude: providerLocation.longitude ? Number(providerLocation.longitude) : null,
      source: "header",
    };
  } else {
    location =
      (await fetchLookupLocation(ip!)) ?? {
        label: "Localizacao indisponivel",
        source: "unknown",
      };
  }

  return {
    ip,
    userAgent: headerStore.get("user-agent"),
    location,
  };
}

export async function appendLoginAuditEntry(entry: AppendLoginAuditEntryInput) {
  await fs.mkdir(AUDIT_DIR, { recursive: true });

  const payload: LoginAuditEntry = {
    id: crypto.randomUUID(),
    attemptedAt: new Date().toISOString(),
    username: entry.username,
    success: entry.success,
    ip: entry.ip,
    location: entry.location,
    userAgent: entry.userAgent,
    failureReason: entry.failureReason,
  };

  await fs.appendFile(AUDIT_FILE, `${JSON.stringify(payload)}\n`, "utf8");
  return payload;
}

export async function getLoginAuditEntries(limit = 40) {
  try {
    const content = await fs.readFile(AUDIT_FILE, "utf8");
    return content
      .split(/\r?\n/)
      .filter(Boolean)
      .map((line) => JSON.parse(line) as LoginAuditEntry)
      .reverse()
      .slice(0, limit);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return [];
    }

    throw error;
  }
}

export function getLoginAuditSummary(entries: LoginAuditEntry[]) {
  const successfulLogins = entries.filter((entry) => entry.success).length;
  const failedLogins = entries.length - successfulLogins;
  const uniqueIps = new Set(entries.map((entry) => entry.ip).filter(Boolean)).size;

  return {
    totalAttempts: entries.length,
    successfulLogins,
    failedLogins,
    uniqueIps,
  };
}
