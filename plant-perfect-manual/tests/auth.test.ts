import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { asSystem } from "@/db/client";
import { loginTokens, sessions, users } from "@/db/schema";
import {
  MAX_LINKS_PER_WINDOW,
  consumeLoginToken,
  createSession,
  hashSecret,
  issueLoginToken,
  readSession,
  requestLoginLink,
  revokeSession,
  revokeUserSessions,
} from "@/lib/auth/core";
import { actorFor, fakeMailer, insertUser, tokenFrom, withTestDatabase } from "./helpers/db";

withTestDatabase();

const BASE = "https://manual.example.com";
const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;

describe("asking for a sign-in link", () => {
  it("emails a link to a known user", async () => {
    const mail = fakeMailer();
    const result = await asSystem((db) =>
      requestLoginLink(db, "kale@example.com", { baseUrl: BASE, send: mail.send }),
    );
    expect(result).toBe("sent");
    expect(mail.sent).toHaveLength(1);
    expect(mail.sent[0].to).toBe("kale@example.com");
    expect(mail.sent[0].text).toContain(`${BASE}/auth/confirm?token=`);
  });

  it("ignores capitals and spaces around the email", async () => {
    const mail = fakeMailer();
    const result = await asSystem((db) =>
      requestLoginLink(db, "  Casey@Example.COM ", { baseUrl: BASE, send: mail.send }),
    );
    expect(result).toBe("sent");
    expect(mail.sent[0].to).toBe("casey@example.com");
  });

  it("sends nothing for an unknown email", async () => {
    const mail = fakeMailer();
    const result = await asSystem((db) =>
      requestLoginLink(db, "stranger@example.com", { baseUrl: BASE, send: mail.send }),
    );
    expect(result).toBe("ignored");
    expect(mail.sent).toHaveLength(0);
  });

  it("sends nothing for a removed user", async () => {
    const gone = await insertUser("Gone", "gone@example.com", "advisor");
    await asSystem((db) => db.update(users).set({ removedAt: new Date() }).where(eq(users.id, gone.id)));
    const mail = fakeMailer();
    const result = await asSystem((db) =>
      requestLoginLink(db, "gone@example.com", { baseUrl: BASE, send: mail.send }),
    );
    expect(result).toBe("ignored");
    expect(mail.sent).toHaveLength(0);
  });

  it("stops after too many requests in 15 minutes", async () => {
    await insertUser("Busy", "busy@example.com", "advisor");
    const mail = fakeMailer();
    const now = new Date();
    for (let i = 0; i < MAX_LINKS_PER_WINDOW; i += 1) {
      const result = await asSystem((db) =>
        requestLoginLink(db, "busy@example.com", { baseUrl: BASE, send: mail.send, now }),
      );
      expect(result).toBe("sent");
    }
    const blocked = await asSystem((db) =>
      requestLoginLink(db, "busy@example.com", { baseUrl: BASE, send: mail.send, now }),
    );
    expect(blocked).toBe("limited");
    expect(mail.sent).toHaveLength(MAX_LINKS_PER_WINDOW);

    const later = new Date(now.getTime() + 16 * MINUTE);
    const again = await asSystem((db) =>
      requestLoginLink(db, "busy@example.com", { baseUrl: BASE, send: mail.send, now: later }),
    );
    expect(again).toBe("sent");
  });
});

describe("using a sign-in link", () => {
  it("works once, then never again", async () => {
    const kale = await actorFor("kale@example.com");
    const secret = await asSystem((db) => issueLoginToken(db, kale.id, "login"));
    const first = await asSystem((db) => consumeLoginToken(db, secret));
    expect(first?.userId).toBe(kale.id);
    const second = await asSystem((db) => consumeLoginToken(db, secret));
    expect(second).toBeNull();
  });

  it("stores only a hash of the secret", async () => {
    const kale = await actorFor("kale@example.com");
    const secret = await asSystem((db) => issueLoginToken(db, kale.id, "login"));
    const rows = await asSystem((db) => db.select().from(loginTokens));
    expect(rows.some((row) => row.tokenHash === secret)).toBe(false);
    expect(rows.some((row) => row.tokenHash === hashSecret(secret))).toBe(true);
  });

  it("expires after 15 minutes", async () => {
    const kale = await actorFor("kale@example.com");
    const issued = new Date();
    const secret = await asSystem((db) => issueLoginToken(db, kale.id, "login", issued));
    const late = new Date(issued.getTime() + 15 * MINUTE + 1000);
    expect(await asSystem((db) => consumeLoginToken(db, secret, late))).toBeNull();
    // Still unused, so it would have worked in time.
    const inTime = new Date(issued.getTime() + 14 * MINUTE);
    expect(await asSystem((db) => consumeLoginToken(db, secret, inTime))).not.toBeNull();
  });

  it("gives invitations 7 days", async () => {
    const kale = await actorFor("kale@example.com");
    const issued = new Date();
    const secret = await asSystem((db) => issueLoginToken(db, kale.id, "invite", issued));
    const day6 = new Date(issued.getTime() + 6 * DAY);
    expect(await asSystem((db) => consumeLoginToken(db, secret, day6))).not.toBeNull();
    const other = await asSystem((db) => issueLoginToken(db, kale.id, "invite", issued));
    const day8 = new Date(issued.getTime() + 8 * DAY);
    expect(await asSystem((db) => consumeLoginToken(db, other, day8))).toBeNull();
  });

  it("rejects made-up links", async () => {
    expect(await asSystem((db) => consumeLoginToken(db, "not-a-real-token"))).toBeNull();
    expect(await asSystem((db) => consumeLoginToken(db, ""))).toBeNull();
    expect(await asSystem((db) => consumeLoginToken(db, "x".repeat(5000)))).toBeNull();
  });

  it("does not sign in a user removed after the link was sent", async () => {
    const late = await insertUser("Late", "late@example.com", "advisor");
    const mail = fakeMailer();
    await asSystem((db) => requestLoginLink(db, "late@example.com", { baseUrl: BASE, send: mail.send }));
    await asSystem((db) => db.update(users).set({ removedAt: new Date() }).where(eq(users.id, late.id)));
    expect(await asSystem((db) => consumeLoginToken(db, tokenFrom(mail.sent[0])))).toBeNull();
  });
});

describe("sessions", () => {
  it("identifies the user and their permissions", async () => {
    const casey = await actorFor("casey@example.com");
    const secret = await asSystem((db) => createSession(db, casey.id, "test browser"));
    const actor = await asSystem((db) => readSession(db, secret));
    expect(actor).toMatchObject({ id: casey.id, name: "Casey", roleKey: "owner" });
    expect(actor?.permissions).toContain("approve");
    const rows = await asSystem((db) => db.select().from(sessions));
    expect(rows.some((row) => row.tokenHash === secret)).toBe(false);
  });

  it("ends after 30 days without use, but renews while in use", async () => {
    const casey = await actorFor("casey@example.com");
    const start = new Date();
    const secret = await asSystem((db) => createSession(db, casey.id, null, start));
    const day20 = new Date(start.getTime() + 20 * DAY);
    expect(await asSystem((db) => readSession(db, secret, day20))).not.toBeNull();
    // Used on day 20, so it is still good on day 45 (25 days later)...
    const day45 = new Date(start.getTime() + 45 * DAY);
    expect(await asSystem((db) => readSession(db, secret, day45))).not.toBeNull();
    // ...but not after 31 further days of silence.
    const day76 = new Date(day45.getTime() + 31 * DAY);
    expect(await asSystem((db) => readSession(db, secret, day76))).toBeNull();
  });

  it("stops working after sign-out", async () => {
    const casey = await actorFor("casey@example.com");
    const secret = await asSystem((db) => createSession(db, casey.id, null));
    await asSystem((db) => revokeSession(db, secret));
    expect(await asSystem((db) => readSession(db, secret))).toBeNull();
  });

  it("stops working on every device when the user's sessions are revoked", async () => {
    const user = await insertUser("Two Phones", "twophones@example.com", "advisor");
    const one = await asSystem((db) => createSession(db, user.id, null));
    const two = await asSystem((db) => createSession(db, user.id, null));
    await asSystem((db) => revokeUserSessions(db, user.id));
    expect(await asSystem((db) => readSession(db, one))).toBeNull();
    expect(await asSystem((db) => readSession(db, two))).toBeNull();
  });

  it("stops working when the user is removed", async () => {
    const user = await insertUser("Leaving", "leaving@example.com", "advisor");
    const secret = await asSystem((db) => createSession(db, user.id, null));
    await asSystem((db) => db.update(users).set({ removedAt: new Date() }).where(eq(users.id, user.id)));
    expect(await asSystem((db) => readSession(db, secret))).toBeNull();
  });

  it("rejects made-up cookies", async () => {
    expect(await asSystem((db) => readSession(db, "nope"))).toBeNull();
    expect(await asSystem((db) => readSession(db, ""))).toBeNull();
  });
});
