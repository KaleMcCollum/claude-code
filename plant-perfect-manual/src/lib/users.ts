import { and, asc, eq, isNotNull, isNull, ne, or, sql } from "drizzle-orm";
import { type Queryable, type Tx, asSystem, asUser, sqlErrorText, sqlState } from "@/db/client";
import { roles, users } from "@/db/schema";
import { logActivity } from "./activity";
import { confirmUrl, issueLoginToken, looksLikeEmail, normalizeEmail, revokeUserSessions } from "./auth/core";
import { inviteEmail } from "./auth/emails";
import type { SendEmail } from "./mailer";
import { UNSEEN_CHARACTER_MESSAGE, hasUnseenCharacter, tidyPersonName } from "./names";
import { type Actor, AppError, assertCan } from "./permissions";

export type UserRow = {
  id: string;
  name: string;
  email: string;
  roleKey: string;
  roleName: string;
  createdAt: Date;
  lastActiveAt: Date | null;
};

export type RoleOption = { key: string; name: string };

const MAX_NAME_LENGTH = 80;

/** Active users, for the Settings page. */
export async function listUsers(actor: Actor): Promise<UserRow[]> {
  assertCan(actor, "manage_users");
  return asUser(actor.id, (tx) =>
    tx
      .select({
        id: users.id,
        name: users.name,
        email: users.email,
        roleKey: users.roleKey,
        roleName: roles.name,
        createdAt: users.createdAt,
        lastActiveAt: users.lastActiveAt,
      })
      .from(users)
      .innerJoin(roles, eq(roles.key, users.roleKey))
      .where(isNull(users.removedAt))
      .orderBy(asc(users.createdAt), asc(users.name)),
  );
}

export async function listRoles(q: Queryable): Promise<RoleOption[]> {
  const rows = await q
    .select({ key: roles.key, name: roles.name, createdAt: roles.createdAt })
    .from(roles)
    .orderBy(asc(roles.createdAt), asc(roles.name));
  // Owner first, then the rest in the order they were added.
  return rows
    .sort((a, b) => Number(b.key === "owner") - Number(a.key === "owner"))
    .map(({ key, name }) => ({ key, name }));
}

/** Names for showing "by Kale" next to things. Includes removed users. */
export async function loadUserNames(q: Queryable): Promise<Map<string, string>> {
  const rows = await q.select({ id: users.id, name: users.name }).from(users);
  return new Map(rows.map((row) => [row.id, row.name]));
}

async function requireRole(tx: Tx, roleKey: string) {
  const [role] = await tx.select().from(roles).where(eq(roles.key, roleKey));
  if (!role) throw new AppError("Choose a role from the list.");
  return role;
}

/** The app must always keep at least one person who can manage users. */
async function countUserManagers(tx: Tx, exceptUserId: string): Promise<number> {
  const rows = await tx
    .select({ id: users.id, permissions: roles.permissions })
    .from(users)
    .innerJoin(roles, eq(roles.key, users.roleKey))
    .where(isNull(users.removedAt));
  return rows.filter((r) => r.id !== exceptUserId && r.permissions.includes("manage_users")).length;
}

/**
 * No two people may have the same name: names are what everyone reads next
 * to "Approved by", so two people called Casey could not be told apart.
 * Someone who was removed still counts, because their name stays on what
 * they wrote and approved. The one exception is a removed person who never
 * signed in: nothing was ever done under that entry, so its name is free
 * again (a mistyped email address can be removed and the person added again
 * under the same name).
 *
 * Names are compared the way `user_name_key` in the database does it:
 * capitals and extra spaces do not count, and neither do characters that
 * cannot be seen. The database has the same rule (a unique index).
 */
async function requireFreeName(tx: Tx, name: string, exceptUserId: string | null): Promise<void> {
  const [taken] = await tx
    .select({ name: users.name, removedAt: users.removedAt })
    .from(users)
    .where(
      and(
        sql`public.user_name_key(${users.name}) = public.user_name_key(${name})`,
        or(isNull(users.removedAt), isNotNull(users.lastActiveAt)),
        exceptUserId ? ne(users.id, exceptUserId) : undefined,
      ),
    )
    .limit(1);
  if (taken) throw new AppError(nameTaken(taken.name, taken.removedAt !== null));
}

function nameTaken(name: string, removed: boolean): string {
  return removed
    ? `Someone who was removed earlier was also called ${name}, and that name stays on what they wrote, approved or endorsed. Add a last initial so the two can be told apart.`
    : `Someone here is already called ${name}. Add a last initial so the two can be told apart.`;
}

export type AddUserResult = {
  userId: string;
  emailSent: boolean;
  /**
   * Set when a removed person was brought back and keeps the name they had,
   * which is not the name that was typed. The screen can then say so.
   */
  keptName?: string;
};

/**
 * Add a user and email them an invitation with a sign-in link.
 *
 * Adding the email of someone who was removed earlier brings that same
 * person back, so their past entries stay attached to them.
 *  - If they ever signed in, they keep the name they had: it is on what
 *    they wrote, approved and endorsed, and must not change under it. The
 *    name typed now is not used (`keptName` says which name was kept).
 *  - If they never signed in (a mistyped address, say), they take the name
 *    typed now, which must be free like any new name.
 */
export async function addUser(
  actor: Actor,
  input: { name: string; email: string; roleKey: string },
  options: { baseUrl: string; send: SendEmail },
): Promise<AddUserResult> {
  assertCan(actor, "manage_users");
  const typedName = tidyPersonName(input.name);
  const email = normalizeEmail(input.email);
  if (!typedName) throw new AppError("Enter a name or nickname.");
  if (typedName.length > MAX_NAME_LENGTH) throw new AppError("That name is too long.");
  if (hasUnseenCharacter(typedName)) throw new AppError(UNSEEN_CHARACTER_MESSAGE);
  if (!looksLikeEmail(email)) throw new AppError("Enter a valid email address.");

  const added = await asUser(actor.id, async (tx) => {
    const role = await requireRole(tx, input.roleKey);
    const [existing] = await tx.select().from(users).where(eq(users.email, email));
    if (existing && !existing.removedAt) {
      throw new AppError("There is already a user with that email address.");
    }
    // Someone who has signed in keeps their name (the database refuses to
    // change it, too).
    const keepsName = existing !== undefined && existing.lastActiveAt !== null;
    const name = keepsName ? existing.name : typedName;
    if (!keepsName) await requireFreeName(tx, name, existing?.id ?? null);
    const now = new Date();
    // If someone else takes the same name or email at this very moment, the
    // database refuses the second one; say why in plain words.
    const refused = (error: unknown): never => {
      const text = sqlErrorText(error);
      if (sqlState(error) === "23505") {
        throw new AppError(
          text.includes("users_name_unique")
            ? nameTaken(name, false)
            : "There is already a user with that email address.",
        );
      }
      if (sqlState(error) === "23514" && text.includes("users_name_can_be_seen")) {
        throw new AppError(UNSEEN_CHARACTER_MESSAGE);
      }
      throw error;
    };
    let id: string;
    if (existing) {
      id = existing.id;
      await tx
        .update(users)
        .set({
          ...(keepsName ? {} : { name }),
          roleKey: role.key,
          removedAt: null,
          removedBy: null,
          updatedAt: now,
          updatedBy: actor.id,
        })
        .where(eq(users.id, id))
        .catch(refused);
    } else {
      const [created] = await tx
        .insert(users)
        .values({ name, email, roleKey: role.key, createdBy: actor.id, updatedBy: actor.id })
        .returning({ id: users.id })
        .catch(refused);
      id = created.id;
    }
    await logActivity(tx, actor.id, {
      action: existing ? "user.restored" : "user.added",
      entityType: "user",
      entityId: id,
      summary: `${existing ? "Added back" : "Added"} ${name} as ${role.name}`,
      data: { roleKey: role.key },
    });
    return { userId: id, name };
  });

  let emailSent = true;
  try {
    const secret = await asSystem((db) => issueLoginToken(db, added.userId, "invite"));
    await options.send(
      inviteEmail({
        to: email,
        name: added.name,
        invitedBy: actor.name,
        url: confirmUrl(options.baseUrl, secret),
      }),
    );
  } catch (error) {
    console.error("Invitation email failed:", error);
    emailSent = false;
  }
  return added.name === typedName
    ? { userId: added.userId, emailSent }
    : { userId: added.userId, emailSent, keptName: added.name };
}

export async function changeUserRole(actor: Actor, userId: string, roleKey: string): Promise<void> {
  assertCan(actor, "manage_users");
  await asUser(actor.id, async (tx) => {
    const role = await requireRole(tx, roleKey);
    const [user] = await tx
      .select()
      .from(users)
      .where(and(eq(users.id, userId), isNull(users.removedAt)));
    if (!user) throw new AppError("That user no longer exists. Reload the page.");
    if (user.roleKey === role.key) return;
    if (!role.permissions.includes("manage_users") && (await countUserManagers(tx, userId)) === 0) {
      throw new AppError(
        "This is the only Owner. Make someone else an Owner first, so the app is never left without one.",
      );
    }
    await tx
      .update(users)
      .set({ roleKey: role.key, updatedAt: new Date(), updatedBy: actor.id })
      .where(eq(users.id, userId));
    await logActivity(tx, actor.id, {
      action: "user.role_changed",
      entityType: "user",
      entityId: userId,
      summary: `Changed ${user.name}'s role to ${role.name}`,
      data: { from: user.roleKey, to: role.key },
    });
  });
}

/** Remove a user's access. Their name stays on everything they wrote or approved. */
export async function removeUser(actor: Actor, userId: string): Promise<void> {
  assertCan(actor, "manage_users");
  if (userId === actor.id) {
    throw new AppError("You can't remove yourself. Ask the other Owner to do it.");
  }
  await asUser(actor.id, async (tx) => {
    const [user] = await tx
      .select()
      .from(users)
      .where(and(eq(users.id, userId), isNull(users.removedAt)));
    if (!user) return;
    if ((await countUserManagers(tx, userId)) === 0) {
      throw new AppError("This is the only Owner, so they can't be removed.");
    }
    const now = new Date();
    await tx
      .update(users)
      .set({ removedAt: now, removedBy: actor.id, updatedAt: now, updatedBy: actor.id })
      .where(eq(users.id, userId));
    await logActivity(tx, actor.id, {
      action: "user.removed",
      entityType: "user",
      entityId: userId,
      summary: `Removed ${user.name}`,
    });
  });
  // Sign them out on every device right away.
  await asSystem((db) => revokeUserSessions(db, userId));
}
