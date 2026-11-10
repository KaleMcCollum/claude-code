import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomBytes } from "node:crypto";

export type Email = { to: string; subject: string; text: string; html: string };
export type SendEmail = (email: Email) => Promise<void>;

/**
 * Send one email.
 *
 * Production: uses the Resend email service (RESEND_API_KEY, EMAIL_FROM).
 * Local development: nothing is sent. The message is printed to the terminal
 * and saved as a file in .data/outbox so sign-in links can be tested with no
 * email account.
 */
export const sendEmail: SendEmail = async (email) => {
  const apiKey = process.env.RESEND_API_KEY;
  if (apiKey) {
    const from = process.env.EMAIL_FROM;
    if (!from) throw new Error("EMAIL_FROM is not set, so email cannot be sent.");
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from,
        to: [email.to],
        subject: email.subject,
        text: email.text,
        html: email.html,
      }),
    });
    if (!response.ok) {
      throw new Error(`The email service refused the message (status ${response.status}).`);
    }
    return;
  }

  const outbox = process.env.EMAIL_OUTBOX_DIR;
  if (process.env.NODE_ENV === "production" && !outbox) {
    throw new Error("Email is not set up: RESEND_API_KEY is missing.");
  }
  const dir = outbox ?? path.join(process.cwd(), ".data", "outbox");
  await mkdir(dir, { recursive: true });
  const file = path.join(dir, `${Date.now()}-${randomBytes(4).toString("hex")}.json`);
  await writeFile(file, JSON.stringify(email, null, 2));
  console.log(`\n[email not sent - saved to ${file}]\nTo: ${email.to}\nSubject: ${email.subject}\n\n${email.text}\n`);
};
