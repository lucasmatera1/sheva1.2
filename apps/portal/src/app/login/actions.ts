"use server";

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { appendLoginAuditEntry, resolveLoginAuditSnapshot } from "@/lib/auth/login-audit";
import {
  PORTAL_SESSION_COOKIE,
  createPortalSessionToken,
  getPortalAuthConfig,
  getPortalSessionCookieOptions,
} from "@/lib/auth/session";

export type LoginActionState = {
  error: string | null;
};

export async function authenticateAction(
  _previousState: LoginActionState,
  formData: FormData,
): Promise<LoginActionState> {
  const username = String(formData.get("username") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  const nextPath = String(formData.get("next") ?? "/");
  const headerStore = await headers();
  const authConfig = getPortalAuthConfig();

  const snapshot = await resolveLoginAuditSnapshot(headerStore);
  const isValidUser = username.length > 0 && username === authConfig.username;
  const isValidPassword = password.length > 0 && password === authConfig.password;

  if (!isValidUser || !isValidPassword) {
    await appendLoginAuditEntry({
      username,
      success: false,
      ip: snapshot.ip,
      location: snapshot.location,
      userAgent: snapshot.userAgent,
      failureReason: "Credenciais invalidas",
    });

    return { error: "Usuario ou senha invalidos." };
  }

  await appendLoginAuditEntry({
    username,
    success: true,
    ip: snapshot.ip,
    location: snapshot.location,
    userAgent: snapshot.userAgent,
  });

  const token = await createPortalSessionToken(username);
  const cookieStore = await cookies();
  cookieStore.set(
    PORTAL_SESSION_COOKIE,
    token,
    getPortalSessionCookieOptions(new Date(Date.now() + authConfig.sessionDurationMs)),
  );

  redirect(nextPath.startsWith("/") ? nextPath : "/");
}
