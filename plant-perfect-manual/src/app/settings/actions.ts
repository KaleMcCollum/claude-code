"use server";

import { type ActionResult, runAction } from "@/lib/actions";
import { getBaseUrl } from "@/lib/auth/session";
import { sendEmail } from "@/lib/mailer";
import { AppError } from "@/lib/permissions";
import { isUuid } from "@/lib/sections";
import { saveSettings } from "@/lib/settings";
import { addUser, changeUserRole, removeUser } from "@/lib/users";

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
    return result.emailSent
      ? `${name.trim()} was added. An invitation was emailed to ${email.trim().toLowerCase()}.`
      : `${name.trim()} was added, but the invitation email could not be sent. They can still sign in from the sign-in page using ${email.trim().toLowerCase()}.`;
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
