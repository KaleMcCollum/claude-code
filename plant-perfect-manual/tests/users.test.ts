import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { asSystem } from "@/db/client";
import { activityLog, users } from "@/db/schema";
import { parseSeedOwners } from "@/db/seed";
import { consumeLoginToken, createSession, readSession } from "@/lib/auth/core";
import { AppError } from "@/lib/permissions";
import { addUser, changeUserRole, listUsers, removeUser } from "@/lib/users";
import { actorFor, fakeMailer, tokenFrom, withTestDatabase } from "./helpers/db";

withTestDatabase();

const BASE = "https://manual.example.com";

describe("first-time owners", () => {
  it("are read from SEED_OWNERS", () => {
    expect(parseSeedOwners("Kale <Kale@Example.com>, casey@example.com")).toEqual([
      { name: "Kale", email: "kale@example.com" },
      { name: "casey", email: "casey@example.com" },
    ]);
    expect(parseSeedOwners(undefined)).toEqual([]);
    expect(() => parseSeedOwners("not an email")).toThrow();
  });

  it("start as Owners", async () => {
    const kale = await actorFor("kale@example.com");
    const list = await listUsers(kale);
    expect(list.map((u) => `${u.name}:${u.roleName}`).sort()).toEqual(["Casey:Owner", "Kale:Owner"]);
  });
});

describe("adding a user", () => {
  it("creates the user and emails an invitation that signs them in", async () => {
    const kale = await actorFor("kale@example.com");
    const mail = fakeMailer();
    const result = await addUser(
      kale,
      { name: " Karen ", email: " Karen@Example.com", roleKey: "advisor" },
      { baseUrl: BASE, send: mail.send },
    );
    expect(result.emailSent).toBe(true);
    expect(mail.sent).toHaveLength(1);
    expect(mail.sent[0].to).toBe("karen@example.com");
    expect(mail.sent[0].subject).toBe("You've been invited to Plant Perfect Fargo's manual");
    expect(mail.sent[0].text).toContain("Kale invited you");

    const karen = await actorFor("karen@example.com");
    expect(karen).toMatchObject({ name: "Karen", roleKey: "advisor" });
    expect(karen.permissions.sort()).toEqual(["comment", "endorse", "read"]);

    const used = await asSystem((db) => consumeLoginToken(db, tokenFrom(mail.sent[0])));
    expect(used).toMatchObject({ userId: karen.id, kind: "invite" });

    const log = await asSystem((db) => db.select().from(activityLog).where(eq(activityLog.entityId, karen.id)));
    expect(log.map((entry) => entry.summary)).toEqual(["Added Karen as Advisor"]);
  });

  it("still adds the user if the email cannot be sent, and says so", async () => {
    const kale = await actorFor("kale@example.com");
    const result = await addUser(
      kale,
      { name: "Sam", email: "sam@example.com", roleKey: "advisor" },
      {
        baseUrl: BASE,
        send: async () => {
          throw new Error("email service is down");
        },
      },
    );
    expect(result.emailSent).toBe(false);
    expect((await actorFor("sam@example.com")).name).toBe("Sam");
  });

  it("rejects a duplicate email, a bad email, a missing name and an unknown role", async () => {
    const kale = await actorFor("kale@example.com");
    const mail = fakeMailer();
    const options = { baseUrl: BASE, send: mail.send };
    await expect(addUser(kale, { name: "K2", email: "KAREN@example.com", roleKey: "advisor" }, options)).rejects.toThrow(
      "already a user",
    );
    await expect(addUser(kale, { name: "X", email: "not-an-email", roleKey: "advisor" }, options)).rejects.toThrow(AppError);
    await expect(addUser(kale, { name: "  ", email: "x@example.com", roleKey: "advisor" }, options)).rejects.toThrow(AppError);
    await expect(addUser(kale, { name: "X", email: "x@example.com", roleKey: "boss" }, options)).rejects.toThrow(AppError);
    expect(mail.sent).toHaveLength(0);
  });

  it("refuses a name someone else already has, so two people can always be told apart", async () => {
    const kale = await actorFor("kale@example.com");
    const mail = fakeMailer();
    const options = { baseUrl: BASE, send: mail.send };
    // A second "Casey", under another email address.
    await expect(addUser(kale, { name: "Casey", email: "kale.other@example.com", roleKey: "owner" }, options)).rejects.toThrow(
      "Someone here is already called Casey. Add a last initial so the two can be told apart.",
    );
    // Capitals and extra spaces make no difference.
    await expect(addUser(kale, { name: "  cAsEy ", email: "kale.other@example.com", roleKey: "owner" }, options)).rejects.toThrow(AppError);
    await expect(addUser(kale, { name: "KALE", email: "kale.other@example.com", roleKey: "advisor" }, options)).rejects.toThrow(
      "already called Kale",
    );
    expect(mail.sent).toHaveLength(0);
    expect(await asSystem((db) => db.select().from(users).where(eq(users.email, "kale.other@example.com")))).toEqual([]);
    // A different name is fine.
    await addUser(kale, { name: "Casey B", email: "casey.b@example.com", roleKey: "advisor" }, options);
    expect((await actorFor("casey.b@example.com")).name).toBe("Casey B");
  });

  it("is not allowed for Advisors", async () => {
    const karen = await actorFor("karen@example.com");
    const mail = fakeMailer();
    await expect(
      addUser(karen, { name: "Friend", email: "friend@example.com", roleKey: "owner" }, { baseUrl: BASE, send: mail.send }),
    ).rejects.toThrow(AppError);
    await expect(listUsers(karen)).rejects.toThrow(AppError);
    await expect(changeUserRole(karen, karen.id, "owner")).rejects.toThrow(AppError);
    const kale = await actorFor("kale@example.com");
    await expect(removeUser(karen, kale.id)).rejects.toThrow(AppError);
  });
});

describe("changing roles and removing users", () => {
  it("changes a role", async () => {
    const kale = await actorFor("kale@example.com");
    const karen = await actorFor("karen@example.com");
    await changeUserRole(kale, karen.id, "owner");
    expect((await actorFor("karen@example.com")).roleKey).toBe("owner");
    await changeUserRole(kale, karen.id, "advisor");
    expect((await actorFor("karen@example.com")).roleKey).toBe("advisor");
  });

  it("never leaves the app without an Owner", async () => {
    const kale = await actorFor("kale@example.com");
    const casey = await actorFor("casey@example.com");
    await changeUserRole(kale, casey.id, "advisor");
    await expect(changeUserRole(kale, kale.id, "advisor")).rejects.toThrow("only Owner");
    await changeUserRole(kale, casey.id, "owner");
    expect((await actorFor("kale@example.com")).roleKey).toBe("owner");
  });

  it("does not let you remove yourself", async () => {
    const kale = await actorFor("kale@example.com");
    await expect(removeUser(kale, kale.id)).rejects.toThrow(AppError);
  });

  it("removes access at once but keeps the person on record", async () => {
    const kale = await actorFor("kale@example.com");
    const karen = await actorFor("karen@example.com");
    const session = await asSystem((db) => createSession(db, karen.id, null));
    expect(await asSystem((db) => readSession(db, session))).not.toBeNull();

    await removeUser(kale, karen.id);

    expect(await asSystem((db) => readSession(db, session))).toBeNull();
    expect((await listUsers(kale)).map((u) => u.email)).not.toContain("karen@example.com");
    const [row] = await asSystem((db) => db.select().from(users).where(eq(users.id, karen.id)));
    expect(row.removedAt).not.toBeNull();
    expect(row.removedBy).toBe(kale.id);
  });

  it("brings the same person back when their email is added again", async () => {
    const kale = await actorFor("kale@example.com");
    const before = await actorFor("karen@example.com");
    const mail = fakeMailer();
    const result = await addUser(
      kale,
      { name: "Karen M", email: "karen@example.com", roleKey: "advisor" },
      { baseUrl: BASE, send: mail.send },
    );
    expect(result.userId).toBe(before.id);
    const list = await listUsers(kale);
    expect(list.find((u) => u.email === "karen@example.com")?.name).toBe("Karen M");
  });

  it("does not let a removed person come back under someone else's name, or anyone take a removed person's name", async () => {
    const kale = await actorFor("kale@example.com");
    const karen = await actorFor("karen@example.com");
    const mail = fakeMailer();
    const options = { baseUrl: BASE, send: mail.send };
    await removeUser(kale, karen.id);

    // Karen's name is still on everything she endorsed: nobody else gets it.
    await expect(addUser(kale, { name: "karen m", email: "someone.else@example.com", roleKey: "advisor" }, options)).rejects.toThrow(
      "Someone who was removed earlier was also called Karen M",
    );
    // Added back as "Casey", her past endorsements would read "Endorsed by Casey".
    await expect(addUser(kale, { name: "Casey", email: "karen@example.com", roleKey: "advisor" }, options)).rejects.toThrow(
      "Someone here is already called Casey",
    );
    await expect(addUser(kale, { name: "Sam", email: "karen@example.com", roleKey: "advisor" }, options)).rejects.toThrow(
      "already called Sam",
    );
    const [still] = await asSystem((db) => db.select().from(users).where(eq(users.id, karen.id)));
    expect(still.name).toBe("Karen M");
    expect(still.removedAt).not.toBeNull();
    expect(mail.sent).toHaveLength(0);

    // Back under her own name (however it is typed), or under a new name nobody has.
    await addUser(kale, { name: "karen  M", email: "karen@example.com", roleKey: "advisor" }, options);
    expect((await actorFor("karen@example.com")).name).toBe("karen M");
    await removeUser(kale, karen.id);
    await addUser(kale, { name: "Karen Miller", email: "karen@example.com", roleKey: "advisor" }, options);
    expect((await actorFor("karen@example.com")).name).toBe("Karen Miller");
    expect(mail.sent).toHaveLength(2);
  });
});
