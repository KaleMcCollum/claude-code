/**
 * What a role may do. Roles live in the database (roles.permissions) so new
 * roles can be added later; these are the permission names they are built from.
 */
export const PERMISSIONS = [
  "read",
  "comment",
  "endorse",
  "write_notes",
  "edit_official",
  "approve",
  "structure",
  "manage_users",
  "settings",
] as const;

export type Permission = (typeof PERMISSIONS)[number];

/** The signed-in person a request is acting for. */
export type Actor = {
  id: string;
  name: string;
  email: string;
  roleKey: string;
  roleName: string;
  permissions: string[];
};

/** An error whose message is safe and useful to show to the user as-is. */
export class AppError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AppError";
  }
}

export function can(actor: Pick<Actor, "permissions">, permission: Permission): boolean {
  return actor.permissions.includes(permission);
}

export function assertCan(actor: Pick<Actor, "permissions">, permission: Permission): void {
  if (!can(actor, permission)) {
    throw new AppError("You don't have permission to do that.");
  }
}
