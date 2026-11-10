import "server-only";
import { cache } from "react";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { asSystem } from "@/db/client";
import { type Actor, type Permission, can } from "@/lib/permissions";
import { readSession } from "./core";

export const SESSION_COOKIE = "ppf_session";
/** Browsers cap cookie life at about 400 days; the database decides when a session really ends. */
const COOKIE_MAX_AGE_SECONDS = 400 * 24 * 60 * 60;

/** The signed-in user for this request, or null. Looked up once per request. */
export const getCurrentUser = cache(async (): Promise<Actor | null> => {
  const secret = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!secret) return null;
  return asSystem((db) => readSession(db, secret));
});

/** Use at the top of every signed-in page and action. */
export async function requireUser(): Promise<Actor> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  return user;
}

/** Like requireUser, but sends people without the permission back to Today. */
export async function requirePermission(permission: Permission): Promise<Actor> {
  const user = await requireUser();
  if (!can(user, permission)) redirect("/");
  return user;
}

function usesHttps(): boolean {
  const appUrl = process.env.APP_URL ?? "";
  if (appUrl.startsWith("http://")) return false;
  return process.env.NODE_ENV === "production";
}

export async function setSessionCookie(secret: string): Promise<void> {
  (await cookies()).set(SESSION_COOKIE, secret, {
    httpOnly: true,
    secure: usesHttps(),
    sameSite: "lax",
    path: "/",
    maxAge: COOKIE_MAX_AGE_SECONDS,
  });
}

export async function clearSessionCookie(): Promise<void> {
  (await cookies()).delete(SESSION_COOKIE);
}

/**
 * The public address of the app, used to build links in emails.
 * In production this must come from configuration, never from the incoming
 * request, so a forged request cannot make the app email a link to another site.
 */
export async function getBaseUrl(): Promise<string> {
  if (process.env.APP_URL) return process.env.APP_URL.replace(/\/+$/, "");
  if (process.env.VERCEL_PROJECT_PRODUCTION_URL) {
    return `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`;
  }
  if (process.env.NODE_ENV === "production") {
    throw new Error("APP_URL is not set, so sign-in links cannot be built.");
  }
  const h = await headers();
  return `${h.get("x-forwarded-proto") ?? "http"}://${h.get("host") ?? "localhost:3000"}`;
}
