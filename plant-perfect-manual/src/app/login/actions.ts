"use server";

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { after } from "next/server";
import { asSystem } from "@/db/client";
import {
  consumeLoginToken,
  createSession,
  looksLikeEmail,
  normalizeEmail,
  requestLoginLink,
  revokeSession,
} from "@/lib/auth/core";
import { SESSION_COOKIE, clearSessionCookie, getBaseUrl, setSessionCookie } from "@/lib/auth/session";
import { sendEmail } from "@/lib/mailer";

export type RequestLinkState = { status: "idle" | "sent" | "error"; email?: string; error?: string };

/**
 * "Email me a sign-in link". The answer shown is the same whether or not the
 * email belongs to a user, and the email is sent after the page has already
 * responded, so neither the wording nor the timing reveals who has access.
 */
export async function requestLinkAction(
  _previous: RequestLinkState,
  formData: FormData,
): Promise<RequestLinkState> {
  const email = normalizeEmail(String(formData.get("email") ?? ""));
  if (!looksLikeEmail(email)) {
    return { status: "error", email, error: "Enter your email address." };
  }
  const baseUrl = await getBaseUrl();
  after(async () => {
    try {
      await asSystem((db) => requestLoginLink(db, email, { baseUrl, send: sendEmail }));
    } catch (error) {
      console.error("Sign-in email failed:", error);
    }
  });
  return { status: "sent", email };
}

export type ConfirmState = { status: "idle" | "failed" };

/** Second half of sign-in: trade the one-time link for a signed-in session. */
export async function confirmLoginAction(
  _previous: ConfirmState,
  formData: FormData,
): Promise<ConfirmState> {
  const token = String(formData.get("token") ?? "");
  const userAgent = (await headers()).get("user-agent");
  const sessionSecret = await asSystem(async (db) => {
    const used = await consumeLoginToken(db, token);
    return used ? createSession(db, used.userId, userAgent) : null;
  });
  if (!sessionSecret) return { status: "failed" };
  await setSessionCookie(sessionSecret);
  redirect("/");
}

export async function signOutAction(): Promise<void> {
  const secret = (await cookies()).get(SESSION_COOKIE)?.value;
  if (secret) await asSystem((db) => revokeSession(db, secret));
  await clearSessionCookie();
  redirect("/login");
}
