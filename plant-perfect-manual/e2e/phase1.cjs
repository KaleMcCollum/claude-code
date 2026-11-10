/**
 * Browser test for Phase 1 (Foundation). Drives the real app the way a person
 * would, on a computer-sized and a phone-sized screen, and saves screenshots.
 *
 * Start the app first, with a fresh development database, for example:
 *   SEED_OWNERS="Kale <kale@example.com>, Casey <casey@example.com>" \
 *   PGLITE_DIR=.data/e2e-db EMAIL_OUTBOX_DIR=.data/e2e-outbox npx next dev -p 3111
 * Then:
 *   BASE_URL=http://localhost:3111 OUTBOX=.data/e2e-outbox node e2e/phase1.cjs
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

function check(name, ok, detail = "") {
  if (ok) {
    passed += 1;
    console.log(`  ok   ${name}`);
  } else {
    failures.push(name);
    console.log(`  FAIL ${name}${detail ? ` (${detail})` : ""}`);
  }
}

async function shot(page, name, options = {}) {
  await page.screenshot({ path: path.join(OUT, `${name}.png`), ...options });
}

/** Newest email in the development outbox for one address. */
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

function linkIn(email) {
  const match = email.text.match(/https?:\/\/\S+\/auth\/confirm\?token=\S+/);
  return match ? match[0] : null;
}

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
  await page.getByRole("heading", { name: "Today" }).waitFor();
  return { email, link };
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch();
  const desktop = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    deviceScaleFactor: SCALE,
  });
  const page = await desktop.newPage();
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(String(error)));
  page.on("console", (message) => {
    if (message.type() === "error") pageErrors.push(message.text());
  });

  console.log("Sign-in");
  await page.goto(`${BASE_URL}/`);
  check("a signed-out visitor is sent to the sign-in page", page.url().endsWith("/login"));
  await page.waitForLoadState("networkidle");
  await shot(page, "desktop-01-sign-in");

  const before = Date.now();
  await page.getByLabel("Email").fill("stranger@example.com");
  await page.getByRole("button", { name: "Email me a sign-in link" }).click();
  await page.getByRole("heading", { name: "Check your email" }).waitFor();
  const strangerText = await page.locator("main").innerText();
  await new Promise((resolve) => setTimeout(resolve, 1200));
  check("an unknown email gets no sign-in email", fs.existsSync(OUTBOX) ? !fs.readdirSync(OUTBOX).some((f) => Number(f.split("-")[0]) >= before) : true);

  const { link: kaleLink } = await signIn(page, "kale@example.com");
  check("an Owner can sign in with only an email link", page.url() === `${BASE_URL}/`);
  await shot(page, "desktop-02-today");

  // Same wording for known and unknown addresses.
  const probe = await desktop.newPage();
  await probe.goto(`${BASE_URL}/login`);
  check("a signed-in person visiting sign-in goes straight to Today", probe.url() === `${BASE_URL}/`);
  await probe.close();
  check(
    "the sign-in page gives the same answer for unknown emails",
    strangerText.replace("stranger@example.com", "X").includes("belongs to a user, a sign-in link is on its way"),
  );

  const reuse = await browser.newContext();
  const reusePage = await reuse.newPage();
  await reusePage.goto(kaleLink);
  await reusePage.getByRole("heading", { name: "This link no longer works" }).waitFor();
  check("a sign-in link works only once", true);
  await reuse.close();

  console.log("Phone home screen (installable app)");
  const manifestResponse = await page.request.get(`${BASE_URL}/manifest.webmanifest`);
  const manifest = manifestResponse.ok() ? await manifestResponse.json() : {};
  check("the app can be added to a phone home screen and opens on Today", manifest.start_url === "/" && manifest.display === "standalone" && manifest.short_name === "Plant Perfect");
  const iconResponse = await page.request.get(`${BASE_URL}/icons/icon-192.png`);
  check("the home screen icon loads", iconResponse.ok() && iconResponse.headers()["content-type"] === "image/png");
  check("the page points phones at the app icon and manifest", (await page.locator('link[rel="manifest"]').count()) >= 1 && (await page.locator('link[rel="apple-touch-icon"]').count()) >= 1);

  console.log("Sidebar and sections");
  const nav = page.getByRole("navigation", { name: "Main" });
  for (const label of ["Today", "Daily Log", "Proposals", "To-do", "Documents", "Settings"]) {
    check(`sidebar shows ${label}`, await nav.getByRole("link", { name: label, exact: true }).isVisible());
  }
  check("sidebar lists the 10 starting sections", (await nav.locator(".tree > ul > li").count()) === 10);
  await nav.getByRole("link", { name: "2 People" }).click();
  await page.getByRole("heading", { level: 1, name: "2 People" }).waitFor();
  check("clicking a section opens it and shows its subsections in the sidebar", await nav.getByRole("link", { name: "2.1 Wages" }).isVisible());
  await shot(page, "desktop-03-section");
  await nav.getByRole("link", { name: "2.1 Wages" }).click();
  await page.getByRole("heading", { level: 1, name: "2.1 Wages" }).waitFor();
  check("a subsection page has Official on top and Discussion below", (await page.getByRole("heading", { level: 2 }).allInnerTexts()).join("|") === "Official|Discussion");
  check("an empty section says there is no official text yet", await page.getByText("No official text yet.").isVisible());

  console.log("Official text");
  await page.getByRole("button", { name: "Edit official" }).click();
  const editor = page.getByRole("textbox", { name: "Official text" });
  await editor.waitFor();
  await editor.click();
  const wording = "Starting wage, Coffee Shop: $13.00/hr.  Starting wage, Garden Center Registers: $15.00/hr.";
  await page.keyboard.type(wording);
  await page.keyboard.press("Enter");
  await page.getByRole("button", { name: "Insert a table" }).click();
  await page.keyboard.type("Garden Center");
  await page.keyboard.press("Tab");
  await page.keyboard.type("Coffee Shop");
  await page.keyboard.press("Tab");
  await page.keyboard.type("$15.00/hr");
  await page.keyboard.press("Tab");
  await page.keyboard.type("$13.00/hr");
  await shot(page, "desktop-04-editing-official");

  // Unsaved text survives a reload (autosave on this device).
  await page.waitForTimeout(700);
  await page.reload();
  await page.getByText("You have unsaved changes to this text on this device.").waitFor();
  check("unsaved text is kept if the page closes", true);
  await page.getByRole("button", { name: "Continue editing" }).click();
  await page.getByRole("textbox", { name: "Official text" }).waitFor();
  await page.getByRole("button", { name: "Save as official" }).click();
  await page.locator(".approval").waitFor();
  const approval = await page.locator(".approval").innerText();
  check("saving shows a bold approval line with name and date", /^Approved by Kale, [A-Z][a-z]{2} \d{1,2}, \d{4}$/.test(approval), approval);
  const shown = await page.locator(".official-box .rich p").first().innerText();
  check("official text is shown exactly as typed", shown === wording, JSON.stringify(shown));
  check("the table is shown with both business columns", (await page.locator(".official-box table th").allInnerTexts()).join("|") === "Garden Center|Coffee Shop");
  check("the page shows who last updated the section", /Last updated .* by Kale/.test(await page.locator(".meta").first().innerText()));
  await shot(page, "desktop-05-official-saved");

  console.log("Search");
  await nav.getByRole("searchbox", { name: "Search" }).fill("coffee");
  await page.keyboard.press("Enter");
  await page.getByRole("heading", { level: 1, name: "Search" }).waitFor();
  check("search finds section names", await page.getByRole("link", { name: /4\.7 Coffee Shop/ }).isVisible());
  check("search finds official text", await page.getByRole("link", { name: /2\.1 Wages/ }).isVisible());
  await shot(page, "desktop-06-search");

  console.log("Edit sections");
  await nav.getByRole("link", { name: "Edit", exact: true }).click();
  await page.getByRole("heading", { level: 1, name: "Edit sections" }).waitFor();
  await shot(page, "desktop-07-edit-sections");
  await page.getByRole("button", { name: "Add section", exact: true }).click();
  await page.getByLabel("Name of the new section").fill("Test Area");
  await page.getByRole("button", { name: "Add", exact: true }).click();
  await nav.getByRole("link", { name: "11 Test Area" }).waitFor();
  check("a new section gets the next number", true);
  await page.getByRole("button", { name: "Rename Test Area" }).click();
  await page.getByLabel("New name for Test Area").fill("Seasonal Plans");
  await page.getByRole("button", { name: "Save name" }).click();
  await nav.getByRole("link", { name: "11 Seasonal Plans" }).waitFor();
  check("a section can be renamed", true);
  await page.getByRole("button", { name: "Move Seasonal Plans up" }).click();
  await nav.getByRole("link", { name: "10 Seasonal Plans" }).waitFor();
  check("moving a section up renumbers it and its neighbour", await nav.getByRole("link", { name: "11 Opening Timeline" }).isVisible());

  // Drag "Company Overview" below "People".
  const rows = page.locator(".manage-list > ul > li > .manage-row");
  await rows.nth(0).dragTo(rows.nth(1), { targetPosition: { x: 200, y: 38 } });
  await nav.getByRole("link", { name: "1 People" }).waitFor();
  check("dragging a section changes the order and the numbers", await nav.getByRole("link", { name: "2 Company Overview" }).isVisible());
  await rows.nth(1).dragTo(rows.nth(0), { targetPosition: { x: 200, y: 4 } });
  await nav.getByRole("link", { name: "1 Company Overview" }).waitFor();

  await page.getByRole("button", { name: "Archive Seasonal Plans" }).click();
  await page.getByRole("button", { name: "Archive section" }).click();
  await page.getByRole("heading", { name: "Archived sections" }).waitFor();
  check("archiving hides a section and renumbers the rest", (await nav.getByRole("link", { name: "10 Opening Timeline" }).isVisible()) && (await nav.getByRole("link", { name: /Seasonal Plans/ }).count()) === 0);
  await page.getByRole("button", { name: "Restore Seasonal Plans" }).click();
  await nav.getByRole("link", { name: "11 Seasonal Plans" }).waitFor();
  check("an archived section can be restored", true);
  await page.getByRole("button", { name: "Archive Seasonal Plans" }).click();
  await page.getByRole("button", { name: "Archive section" }).click();
  await page.getByRole("heading", { name: "Archived sections" }).waitFor();

  console.log("Settings and users");
  await nav.getByRole("link", { name: "Settings" }).click();
  await page.getByRole("heading", { level: 1, name: "Settings" }).waitFor();
  check("Settings opens as its own page with a Back button", (await page.getByRole("link", { name: "Back" }).isVisible()) && (await page.getByRole("navigation", { name: "Main" }).count()) === 0);
  const inviteSince = Date.now();
  await page.getByLabel("Name or nickname").fill("Karen");
  await page.getByLabel("Email", { exact: true }).fill("Karen@Example.com");
  await page.locator('select[name="role"]').selectOption({ label: "Advisor" });
  await page.getByRole("button", { name: "Create user" }).click();
  await page.getByText("Karen was added. An invitation was emailed to karen@example.com.").waitFor();
  check("an Owner can add a user", await page.getByRole("cell", { name: "karen@example.com" }).isVisible());
  await shot(page, "desktop-08-settings");
  const invite = await latestEmail("karen@example.com", inviteSince);
  check("the new user gets the invitation email", invite !== null && invite.subject === "You've been invited to Plant Perfect Fargo's manual", invite && invite.subject);

  await page.getByRole("button", { name: "Create user" }).waitFor();
  await page.getByLabel("Name or nickname").fill("Karen Again");
  await page.getByLabel("Email", { exact: true }).fill("karen@example.com");
  await page.getByRole("button", { name: "Create user" }).click();
  await page.getByText("There is already a user with that email address.").waitFor();
  check("the same email cannot be added twice", true);

  await page.getByLabel("Role for Casey").selectOption({ label: "Advisor" });
  await page.waitForFunction(() => document.querySelector('select[aria-label="Role for Casey"]')?.value === "advisor");
  await page.getByLabel("Role for Kale").selectOption({ label: "Advisor" });
  await page.getByText("This is the only Owner.").waitFor();
  check("the last Owner cannot be demoted", true);
  await page.getByLabel("Role for Casey").selectOption({ label: "Owner" });
  await page.waitForFunction(() => document.querySelector('select[aria-label="Role for Casey"]')?.value === "owner");
  check("an Owner can change a user's role", true);

  await page.getByRole("link", { name: "Back" }).click();
  await page.getByRole("heading", { level: 1, name: "Edit sections" }).waitFor();
  check("Back returns to the page you came from", true);

  console.log("Advisor (Karen)");
  const karenContext = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: SCALE });
  const karen = await karenContext.newPage();
  await karen.goto(linkIn(invite));
  await karen.getByRole("heading", { name: "Today" }).waitFor();
  check("an invited Advisor signs in from the invitation link", true);
  const karenNav = karen.getByRole("navigation", { name: "Main" });
  check("an Advisor has no Settings link", (await karenNav.getByRole("link", { name: "Settings" }).count()) === 0);
  check("an Advisor has no Edit sections link", (await karenNav.getByRole("link", { name: "Edit", exact: true }).count()) === 0);
  await karenNav.getByRole("link", { name: "2 People" }).click();
  await karenNav.getByRole("link", { name: "2.1 Wages" }).click();
  await karen.getByRole("heading", { level: 1, name: "2.1 Wages" }).waitFor();
  check("an Advisor can read official text", (await karen.locator(".approval").innerText()).startsWith("Approved by Kale"));
  check("an Advisor has no Edit official button", (await karen.getByRole("button", { name: "Edit official" }).count()) === 0);
  await shot(karen, "desktop-09-advisor-view");
  await karen.goto(`${BASE_URL}/settings`);
  check("an Advisor opening Settings is sent back to Today", karen.url() === `${BASE_URL}/`);
  await karen.goto(`${BASE_URL}/sections/manage`);
  check("an Advisor opening Edit sections is sent back to Today", karen.url() === `${BASE_URL}/`);

  // Removing a user signs them out everywhere.
  await page.goto(`${BASE_URL}/settings`);
  await page.getByRole("button", { name: "Remove Karen" }).click();
  await page.getByRole("button", { name: "Yes, remove" }).click();
  await page.getByRole("cell", { name: "karen@example.com" }).waitFor({ state: "detached" });
  await karen.goto(`${BASE_URL}/`);
  check("a removed user is signed out at once", karen.url().endsWith("/login"));
  await karenContext.close();

  console.log("Phone");
  const phone = await browser.newContext({ ...devices["iPhone 13"], ...(SCALE === 1 ? { deviceScaleFactor: 1 } : {}) });
  const mobile = await phone.newPage();
  await mobile.goto(`${BASE_URL}/login`);
  await shot(mobile, "phone-01-sign-in");
  await signIn(mobile, "casey@example.com");
  check("an Owner can sign in on a phone", true);
  await shot(mobile, "phone-02-today");
  const mobileNav = mobile.getByRole("navigation", { name: "Main" });
  check("on a phone the sidebar is tucked away", !(await mobileNav.isVisible()));
  await mobile.getByRole("button", { name: "Open menu" }).click();
  await mobileNav.getByRole("link", { name: "2 People" }).waitFor();
  await shot(mobile, "phone-03-menu");
  await mobileNav.getByRole("link", { name: "2 People" }).click();
  await mobile.getByRole("heading", { level: 1, name: "2 People" }).waitFor();
  check("choosing a page closes the phone menu", !(await mobileNav.isVisible()));
  await mobile.getByRole("link", { name: "2.1 Wages" }).click();
  await mobile.getByRole("heading", { level: 1, name: "2.1 Wages" }).waitFor();
  await shot(mobile, "phone-04-section", { fullPage: true });
  const overflow = await mobile.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  check("the section page fits a phone screen without sideways scrolling", overflow <= 0, `overflow ${overflow}px`);
  await mobile.getByRole("button", { name: "Edit official" }).click();
  const mobileEditor = mobile.getByRole("textbox", { name: "Official text" });
  await mobileEditor.waitFor();
  await mobileEditor.click();
  await mobile.keyboard.press("Control+End");
  await mobile.keyboard.type("Reviewed by Casey.");
  await shot(mobile, "phone-05-editing");
  await mobile.getByRole("button", { name: "Save as official" }).click();
  await mobile.getByText("Reviewed by Casey.").waitFor();
  await mobile.waitForFunction(() => document.querySelector(".approval")?.textContent?.startsWith("Approved by Casey"));
  check("an Owner can edit official text on a phone", true);
  await mobile.evaluate(() => window.scrollTo(0, 0));
  await shot(mobile, "phone-06-saved", { fullPage: true });
  await mobile.getByRole("button", { name: "Open menu" }).click();
  await mobileNav.getByRole("link", { name: "Settings" }).click();
  await mobile.getByRole("heading", { level: 1, name: "Settings" }).waitFor();
  await shot(mobile, "phone-07-settings", { fullPage: true });
  const settingsOverflow = await mobile.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  check("Settings fits a phone screen without sideways scrolling", settingsOverflow <= 0, `overflow ${settingsOverflow}px`);
  await mobile.getByRole("link", { name: "Back" }).click();
  await mobile.getByRole("button", { name: "Open menu" }).click();
  await mobileNav.getByRole("link", { name: "Edit", exact: true }).click();
  await mobile.getByRole("heading", { level: 1, name: "Edit sections" }).waitFor();
  await shot(mobile, "phone-08-edit-sections");
  await mobile.getByRole("button", { name: "Open menu" }).click();
  await mobileNav.getByRole("button", { name: "Sign out" }).click();
  await mobile.getByRole("button", { name: "Email me a sign-in link" }).waitFor();
  await mobile.goto(`${BASE_URL}/`);
  check("signing out ends the session", mobile.url().endsWith("/login"));
  await phone.close();

  check("no errors were reported by the browser", pageErrors.length === 0, pageErrors.slice(0, 3).join(" | "));

  await browser.close();
  console.log(`\n${passed} passed, ${failures.length} failed. Screenshots: ${OUT}`);
  if (failures.length > 0) process.exit(1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
