/**
 * Shared pieces for the browser tests (e2e/phaseN.cjs).
 *
 * The tests drive the real app the way a person would, on a computer-sized
 * and a phone-sized screen, and save screenshots. Run them with
 * `scripts/run-e2e.sh`, which starts the app on a fresh database first.
 *
 * Needs Playwright with Chromium available to Node.
 */
const fs = require("node:fs");
const path = require("node:path");
const { chromium, devices } = require("playwright");

const BASE_URL = process.env.BASE_URL || "http://localhost:3111";
const OUTBOX = path.resolve(process.env.OUTBOX || ".data/outbox");
const OUT = path.resolve(process.env.SHOTS || "e2e/output");
const SCALE = Number(process.env.SHOT_SCALE || 1);

let passed = 0;
const failures = [];

/** Record one named check. The run fails at the end if any check failed. */
function check(name, ok, detail = "") {
  if (ok) {
    passed += 1;
    console.log(`  ok   ${name}`);
  } else {
    failures.push(name);
    console.log(`  FAIL ${name}${detail ? ` (${detail})` : ""}`);
  }
}

function section(title) {
  console.log(title);
}

async function shot(page, name, options = {}) {
  fs.mkdirSync(OUT, { recursive: true });
  await page.screenshot({ path: path.join(OUT, `${name}.png`), ...options });
}

/** Newest email in the development outbox for one address, sent at or after `afterMs`. */
async function latestEmail(to, afterMs = 0) {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const files = fs.existsSync(OUTBOX) ? fs.readdirSync(OUTBOX).sort().reverse() : [];
    for (const file of files) {
      if (Number(file.split("-")[0]) < afterMs) break;
      const email = JSON.parse(fs.readFileSync(path.join(OUTBOX, file), "utf8"));
      if (email.to === to) return email;
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  return null;
}

function emailsSince(afterMs) {
  if (!fs.existsSync(OUTBOX)) return [];
  return fs.readdirSync(OUTBOX).filter((file) => Number(file.split("-")[0]) >= afterMs);
}

function linkIn(email) {
  const match = email.text.match(/https?:\/\/\S+\/auth\/confirm\?token=\S+/);
  return match ? match[0] : null;
}

/** Sign in through the real email-link flow. Ends on the Today page. */
async function signIn(page, address) {
  const since = Date.now();
  await page.goto(`${BASE_URL}/login`);
  await page.getByLabel("Email").fill(address);
  await page.getByRole("button", { name: "Email me a sign-in link" }).click();
  await page.getByRole("heading", { name: "Check your email" }).waitFor();
  const email = await latestEmail(address, since);
  if (!email) throw new Error(`No sign-in email arrived for ${address}`);
  const link = linkIn(email);
  await page.goto(link);
  await page.getByRole("heading", { level: 1, name: "Today" }).waitFor();
  return { email, link };
}

function desktopContext(browser) {
  return browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: SCALE });
}

function phoneContext(browser) {
  return browser.newContext({
    ...devices["iPhone 13"],
    ...(SCALE === 1 ? { deviceScaleFactor: 1 } : {}),
  });
}

/** Collect errors the browser reports on a page (checked at the end of a run). */
function trackErrors(page, into = []) {
  page.on("pageerror", (error) => into.push(String(error)));
  page.on("console", (message) => {
    if (message.type() === "error") into.push(message.text());
  });
  return into;
}

/** How many pixels the page is wider than the screen (0 = no sideways scrolling). */
function sidewaysOverflow(page) {
  return page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
}

/** Run a test's main function, print the tally, and set the exit code. */
function run(main) {
  main()
    .then(() => {
      console.log(`\n${passed} passed, ${failures.length} failed. Screenshots: ${OUT}`);
      if (failures.length > 0) process.exit(1);
    })
    .catch((error) => {
      console.error(error);
      console.log(`\n${passed} passed before the test stopped on an error.`);
      process.exit(1);
    });
}

module.exports = {
  BASE_URL,
  OUTBOX,
  OUT,
  SCALE,
  chromium,
  devices,
  check,
  section,
  shot,
  latestEmail,
  emailsSince,
  linkIn,
  signIn,
  desktopContext,
  phoneContext,
  trackErrors,
  sidewaysOverflow,
  run,
};
