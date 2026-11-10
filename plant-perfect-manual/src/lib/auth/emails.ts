import type { Email } from "@/lib/mailer";

const APP_NAME = "Plant Perfect Fargo's manual";

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function layout(lines: string[], buttonLabel: string, url: string, footer: string): string {
  const paragraphs = lines
    .map((line) => `<p style="margin:0 0 16px">${escapeHtml(line)}</p>`)
    .join("");
  return `<!doctype html>
<html><body style="margin:0;padding:24px;background:#ffffff;color:#111111;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:16px;line-height:1.5">
${paragraphs}
<p style="margin:0 0 24px"><a href="${escapeHtml(url)}" style="display:inline-block;padding:12px 20px;background:#0f5c5c;color:#ffffff;text-decoration:none;border-radius:4px">${escapeHtml(buttonLabel)}</a></p>
<p style="margin:0 0 16px;color:#555555;font-size:14px">If the button does not work, copy this address into your browser:<br>${escapeHtml(url)}</p>
<p style="margin:0;color:#555555;font-size:14px">${escapeHtml(footer)}</p>
</body></html>`;
}

export function loginEmail(input: { to: string; name: string; url: string }): Email {
  const footer =
    "This link works once and expires in 15 minutes. If you did not ask for it, you can ignore this email.";
  return {
    to: input.to,
    subject: `Your sign-in link for ${APP_NAME}`,
    text: `Hi ${input.name},\n\nUse this link to sign in to ${APP_NAME}:\n\n${input.url}\n\n${footer}\n`,
    html: layout(
      [`Hi ${input.name},`, `Use the button below to sign in to ${APP_NAME}.`],
      "Sign in",
      input.url,
      footer,
    ),
  };
}

export function inviteEmail(input: {
  to: string;
  name: string;
  invitedBy: string;
  url: string;
}): Email {
  const footer =
    "This link works once and expires in 7 days. After that, go to the sign-in page and enter this email address to get a new link. There is no password.";
  return {
    to: input.to,
    subject: `You've been invited to ${APP_NAME}`,
    text: `Hi ${input.name},\n\n${input.invitedBy} invited you to ${APP_NAME}.\n\nUse this link to sign in:\n\n${input.url}\n\n${footer}\n`,
    html: layout(
      [`Hi ${input.name},`, `${input.invitedBy} invited you to ${APP_NAME}.`],
      "Open the manual",
      input.url,
      footer,
    ),
  };
}
