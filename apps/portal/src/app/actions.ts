"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { PORTAL_SESSION_COOKIE, getPortalSessionCookieOptions } from "@/lib/auth/session";

export async function logoutAction() {
  const cookieStore = await cookies();
  cookieStore.set(PORTAL_SESSION_COOKIE, "", {
    ...getPortalSessionCookieOptions(new Date(0)),
    expires: new Date(0),
    maxAge: 0,
  });

  redirect("/login");
}
