import { createHash, randomBytes } from "node:crypto";
import { and, count, eq, gt, isNull } from "drizzle-orm";
import type { Db } from "@/db/client";
import { loginTokens, roles, sessions, users } from "@/db/schema";
import type { SendEmail } from "@/lib/mailer";
import type { Actor } from "@/lib/permissions";
import { loginEmail } from "./emails";

/**
 * Passwordless sign-in.
 *
 * Everything here runs with full database rights (see asSystem) because it
 * happens before we know who the person is. Secrets (link tokens and session
 * cookies) are random 256-bit values; only their SHA-256 hash is stored, so a
 * copy of the database cannot be used to sign in.
 */

export const LOGIN_LINK_MINUTES = 15;
export const INVITE_LINK_DAYS = 7;
export const SESSION_DAYS = 30;
/** At most this many sign-in links per person per 15 minutes. */
export const MAX_LINKS_PER_WINDOW = 5;
/** How often "last active" and the session's 30-day clock are refreshed. */
const TOUCH_INTERVAL_MS = 5 * 60 * 1000;

const MINUTE = 60 * 1000;
const DAY = 24 * 60 * MINUTE;

export type TokenKind = "login" | "invite";

export function newSecret(): string {
  return randomBytes(32).toString("base64url");
}

export function hashSecret(secret: string): string {
  return createHash("sha256").update(secret).digest("hex");
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function looksLikeEmail(email: string): boolean {
  return email.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

export async function findActiveUserByEmail(db: Db, email: string) {
  const [user] = await db
    .select({ id: users.id, name: users.name, email: users.email })
    .from(users)
    .where(and(eq(users.email, normalizeEmail(email)), isNull(users.removedAt)));
  return user ?? null;
}

/** Create a single-use link token and return the secret to put in the link. */
export async function issueLoginToken(
  db: Db,
  userId: string,
  kind: TokenKind,
  now: Date = new Date(),
): Promise<string> {
  const secret = newSecret();
  const lifetime = kind === "invite" ? INVITE_LINK_DAYS * DAY : LOGIN_LINK_MINUTES * MINUTE;
  await db.insert(loginTokens).values({
    userId,
    tokenHash: hashSecret(secret),
    kind,
    createdAt: now,
    expiresAt: new Date(now.getTime() + lifetime),
  });
  return secret;
}

/**
 * Use up a link token. Returns the user it belongs to, or null if the link
 * is unknown, expired, already used, or the user has been removed.
 * The update is a single statement, so a link can never be used twice even
 * if it is clicked on two devices at the same moment.
 */
export async function consumeLoginToken(
  db: Db,
  secret: string,
  now: Date = new Date(),
): Promise<{ userId: string; kind: string } | null> {
  if (!secret || secret.length > 200) return null;
  const [token] = await db
    .update(loginTokens)
    .set({ usedAt: now })
    .where(
      and(
        eq(loginTokens.tokenHash, hashSecret(secret)),
        isNull(loginTokens.usedAt),
        gt(loginTokens.expiresAt, now),
      ),
    )
    .returning({ userId: loginTokens.userId, kind: loginTokens.kind });
  if (!token) return null;
  const [user] = await db
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.id, token.userId), isNull(users.removedAt)));
  return user ? token : null;
}

/** Start a signed-in session and return the secret to store in the cookie. */
export async function createSession(
  db: Db,
  userId: string,
  userAgent: string | null,
  now: Date = new Date(),
): Promise<string> {
  const secret = newSecret();
  await db.insert(sessions).values({
    userId,
    tokenHash: hashSecret(secret),
    createdAt: now,
    lastSeenAt: now,
    expiresAt: new Date(now.getTime() + SESSION_DAYS * DAY),
    userAgent: userAgent ? userAgent.slice(0, 300) : null,
  });
  await db.update(users).set({ lastActiveAt: now }).where(eq(users.id, userId));
  return secret;
}

/**
 * Look up the signed-in user for a session cookie, or null.
 * While a device keeps being used, its session keeps renewing: it only ends
 * after 30 days without any use, on sign-out, or when the user is removed.
 */
export async function readSession(
  db: Db,
  secret: string,
  now: Date = new Date(),
): Promise<Actor | null> {
  if (!secret || secret.length > 200) return null;
  const [row] = await db
    .select({
      sessionId: sessions.id,
      lastSeenAt: sessions.lastSeenAt,
      id: users.id,
      name: users.name,
      email: users.email,
      roleKey: users.roleKey,
      roleName: roles.name,
      permissions: roles.permissions,
    })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .innerJoin(roles, eq(roles.key, users.roleKey))
    .where(
      and(
        eq(sessions.tokenHash, hashSecret(secret)),
        isNull(sessions.revokedAt),
        gt(sessions.expiresAt, now),
        isNull(users.removedAt),
      ),
    );
  if (!row) return null;

  if (now.getTime() - row.lastSeenAt.getTime() > TOUCH_INTERVAL_MS) {
    await db
      .update(sessions)
      .set({ lastSeenAt: now, expiresAt: new Date(now.getTime() + SESSION_DAYS * DAY) })
      .where(eq(sessions.id, row.sessionId));
    await db.update(users).set({ lastActiveAt: now }).where(eq(users.id, row.id));
  }

  return {
    id: row.id,
    name: row.name,
    email: row.email,
    roleKey: row.roleKey,
    roleName: row.roleName,
    permissions: row.permissions,
  };
}

export async function revokeSession(db: Db, secret: string, now: Date = new Date()): Promise<void> {
  if (!secret) return;
  await db
    .update(sessions)
    .set({ revokedAt: now })
    .where(and(eq(sessions.tokenHash, hashSecret(secret)), isNull(sessions.revokedAt)));
}

/** Sign a user out everywhere (used when a user is removed). */
export async function revokeUserSessions(
  db: Db,
  userId: string,
  now: Date = new Date(),
): Promise<void> {
  await db
    .update(sessions)
    .set({ revokedAt: now })
    .where(and(eq(sessions.userId, userId), isNull(sessions.revokedAt)));
}

/**
 * Handle "email me a sign-in link". Does nothing for unknown or removed
 * emails. The caller always shows the same message either way, so nobody
 * can use the login page to find out who has an account.
 */
export async function requestLoginLink(
  db: Db,
  rawEmail: string,
  options: { baseUrl: string; send: SendEmail; now?: Date },
): Promise<"sent" | "ignored" | "limited"> {
  const now = options.now ?? new Date();
  const email = normalizeEmail(rawEmail);
  if (!looksLikeEmail(email)) return "ignored";
  const user = await findActiveUserByEmail(db, email);
  if (!user) return "ignored";

  const windowStart = new Date(now.getTime() - LOGIN_LINK_MINUTES * MINUTE);
  const [{ n }] = await db
    .select({ n: count() })
    .from(loginTokens)
    .where(and(eq(loginTokens.userId, user.id), gt(loginTokens.createdAt, windowStart)));
  if (n >= MAX_LINKS_PER_WINDOW) return "limited";

  const secret = await issueLoginToken(db, user.id, "login", now);
  await options.send(
    loginEmail({ to: user.email, name: user.name, url: confirmUrl(options.baseUrl, secret) }),
  );
  return "sent";
}

export function confirmUrl(baseUrl: string, secret: string): string {
  return `${baseUrl.replace(/\/+$/, "")}/auth/confirm?token=${encodeURIComponent(secret)}`;
}
