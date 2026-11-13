"use server";

import { asUser } from "@/db/client";
import { type ActionResult, runAction } from "@/lib/actions";
import { getBaseUrl } from "@/lib/auth/session";
import { sendEmail } from "@/lib/mailer";
import { AppError } from "@/lib/permissions";
import { isUuid } from "@/lib/sections";
import { saveSettings } from "@/lib/settings";
import { addUser, changeUserRole, listRoles, removeUser } from "@/lib/users";

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function requireUserId(value: unknown): string {
  if (typeof value !== "string" || !isUuid(value)) {
    throw new AppError("That user could not be found. Reload the page and try again.");
  }
  return value;
}

export async function addUserAction(input: {
  name: string;
  email: string;
  roleKey: string;
}): Promise<ActionResult> {
  return runAction(async (actor) => {
    const name = text(input?.name);
    const email = text(input?.email);
    const baseUrl = await getBaseUrl();
    const result = await addUser(
      actor,
      { name, email, roleKey: text(input?.roleKey) },
      { baseUrl, send: sendEmail },
    );
    const address = email.trim().toLowerCase();
    // Someone who was here before keeps the name they had, whatever was typed now.
    if (result.keptName) {
      const role = (await asUser(actor.id, (tx) => listRoles(tx))).find((item) => item.key === text(input?.roleKey));
      const back = `${result.keptName} is back${role ? ` as ${role.name}` : ""}. They keep the name they had before (${result.keptName}), because it is on what they wrote and approved.`;
      return result.emailSent
        ? `${back} An invitation was emailed to ${address}.`
        : `${back} The invitation email could not be sent. They can still sign in from the sign-in page using ${address}.`;
    }
    return result.emailSent
      ? `${name.trim()} was added. An invitation was emailed to ${address}.`
      : `${name.trim()} was added, but the invitation email could not be sent. They can still sign in from the sign-in page using ${address}.`;
  });
}

export async function changeRoleAction(userId: string, roleKey: string): Promise<ActionResult> {
  return runAction((actor) => changeUserRole(actor, requireUserId(userId), text(roleKey)));
}

export async function removeUserAction(userId: string): Promise<ActionResult> {
  return runAction((actor) => removeUser(actor, requireUserId(userId)));
}

export async function saveSettingsAction(input: {
  openingDate: string;
  staleDays: string;
}): Promise<ActionResult> {
  return runAction(async (actor) => {
    const result = await saveSettings(actor, {
      openingDate: text(input?.openingDate),
      staleDays: text(input?.staleDays),
    });
    return result.changed ? "Saved." : "No changes to save.";
  });
}
