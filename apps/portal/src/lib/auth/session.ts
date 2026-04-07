import { cookies } from "next/headers";

export const PORTAL_SESSION_COOKIE = "sheva-portal-session";

type PortalSessionPayload = {
  username: string;
  exp: number;
};

type PortalAuthConfig = {
  username: string;
  password: string;
  secret: string;
  sessionDurationMs: number;
};

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

function toBase64Url(input: string) {
  return bytesToBase64Url(textEncoder.encode(input));
}

function fromBase64Url(input: string) {
  return textDecoder.decode(base64UrlToBytes(input));
}

function bytesToBase64Url(bytes: Uint8Array) {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }

  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function base64UrlToBytes(input: string) {
  const padded = input.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(input.length / 4) * 4, "=");
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }

  return bytes;
}

async function getPortalSigningKey(secret: string) {
  return crypto.subtle.importKey(
    "raw",
    textEncoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
}

async function signPortalValue(value: string, secret: string) {
  const key = await getPortalSigningKey(secret);
  const signature = await crypto.subtle.sign("HMAC", key, textEncoder.encode(value));
  return bytesToBase64Url(new Uint8Array(signature));
}

export function getPortalAuthConfig(): PortalAuthConfig {
  const username =
    process.env.PORTAL_AUTH_USERNAME ?? (process.env.NODE_ENV === "development" ? "admin" : "");
  const password =
    process.env.PORTAL_AUTH_PASSWORD ?? (process.env.NODE_ENV === "development" ? "admin" : "");
  const secret =
    process.env.PORTAL_SESSION_SECRET ??
    (process.env.NODE_ENV === "development" ? "dev-portal-secret-change-me" : "");
  const sessionDurationHours = Number(process.env.PORTAL_SESSION_DURATION_HOURS ?? 12);

  if (!username || !password || !secret) {
    throw new Error(
      "Portal auth nao configurado. Defina PORTAL_AUTH_USERNAME, PORTAL_AUTH_PASSWORD e PORTAL_SESSION_SECRET.",
    );
  }

  return {
    username,
    password,
    secret,
    sessionDurationMs: Math.max(1, sessionDurationHours) * 60 * 60 * 1000,
  };
}

export async function createPortalSessionToken(username: string) {
  const config = getPortalAuthConfig();
  const payload: PortalSessionPayload = {
    username,
    exp: Date.now() + config.sessionDurationMs,
  };
  const encodedPayload = toBase64Url(JSON.stringify(payload));
  const signature = await signPortalValue(encodedPayload, config.secret);
  return `${encodedPayload}.${signature}`;
}

export async function verifyPortalSessionToken(token: string) {
  const config = getPortalAuthConfig();
  const [encodedPayload, providedSignature] = token.split(".");

  if (!encodedPayload || !providedSignature) {
    return null;
  }

  const expectedSignature = await signPortalValue(encodedPayload, config.secret);
  if (expectedSignature !== providedSignature) {
    return null;
  }

  try {
    const payload = JSON.parse(fromBase64Url(encodedPayload)) as PortalSessionPayload;
    if (!payload.username || !payload.exp || payload.exp < Date.now()) {
      return null;
    }

    return payload;
  } catch {
    return null;
  }
}

export function getPortalSessionCookieOptions(expires: Date) {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    path: "/",
    expires,
  };
}

export async function readPortalSession() {
  const cookieStore = await cookies();
  const token = cookieStore.get(PORTAL_SESSION_COOKIE)?.value;
  if (!token) {
    return null;
  }

  return verifyPortalSessionToken(token);
}
