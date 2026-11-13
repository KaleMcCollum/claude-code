/**
 * Browser test for Phase 3 (Decisions): proposals, approvals by one or both
 * Owners, endorsements, the Decisions Log, version history, the activity log.
 * Run with scripts/run-e2e.sh (see e2e/helpers.cjs). The official text that
 * is already there when the test starts comes from e2e/phase3.seed.ts.
 */
const {
  BASE_URL,
  chromium,
  check,
  section,
  shot,
  latestEmail,
  linkIn,
  signIn,
  desktopContext,
  phoneContext,
  trackErrors,
  sidewaysOverflow,
  run,
} = require("./helpers.cjs");

const WAGES_TITLE = "Coffee Shop starting wage $15.00/hr";
const WAGES_WHY = "Other coffee shops in Fargo start at fifteen.";
const WAGES_NEW = ["Starting wage, Coffee Shop: $15.00/hr.", "Starting wage, Garden Center Registers: $15.00/hr."];
const DISCOUNT_TITLE = "Staff discount 20%";
const DISCOUNT_TEXT = "All staff get 20% off plants and coffee.";
const OPENING_TEXT = "Unlock the front gate first, then the registers.";
const HIRING_TITLE = "Hire two baristas before opening";
const HIRING_TEXT = "Hire two baristas by February 1.";
const HIRING_ADDED = " Both part time.";
const REGISTERS_TITLE = "Garden Center registers start at $16.00/hr";
const REGISTERS_NEW = ["Starting wage, Coffee Shop: $15.00/hr.", "Starting wage, Garden Center Registers: $16.00/hr."];
const KAREN_COMMENT = "Karen here: sixteen is fair for the registers,  check it against the budget.";
const TRAINING_TITLE = "Barista training lasts two weeks";
const TRAINING_TEXT = "New baristas train for two weeks before working alone.";
const DECLINE_REASON = "Too long -- one week is enough, ask *Sam* at the roaster";
const POLICY_TITLE = "Phones stay in the break room";
const POLICY_TEXT = "Personal phones stay in the break room during a shift.";
const KALE_CLOSING = "Kale typed this: count the till, then lock the back door.";
const CASEY_CLOSING = "Casey saved this first: lock the gate at close.";
const KALE_ADDED = " Then count the till.";
const CASEY_ADDED = " Set the alarm.";
const CHOOSE_FIRST = "Choose first: start over from the current text, or keep what you typed.";
const POS_TITLE = "Line busters use handheld scanners";
const POS_TEXT = "Line busters use two handheld scanners on busy days.";
const POS_DIRECT = "Registers run on the point of sale system. Returns need a receipt.";
const ENDORSE_QUESTION = "Endorse this? It adds your name in support. It does not approve it, and it cannot be taken back.";
const VENDOR_HEADING = "Coffee roaster";
const VENDOR_LINE = "Order coffee beans by Friday noon.";
const VENDOR_TASK = "Call the roaster";
const FORMAT_TITLE = "Vendor contacts in bold";
const TICK_TITLE = "The roaster has been called";
const CLOSING_NOTE = "Closing takes too long on Saturdays -- rename that page?";
const CHECKLIST_TITLE = "Closing checklist on the back door";
const CHECKLIST_TEXT = "The closing checklist hangs on the back door.";
const GONE_NOTICE = "The section this is about no longer exists (it may have been archived). Withdraw or decline this proposal.";
const ARCHIVE_HINT = "Archiving hides the section and everything under it. Nothing is deleted, and it can be restored.";
const GRINDER_TITLE = "Buy a second grinder";
const GRINDER_TEXT = "The coffee shop has two grinders.";
const GRINDER_DIRECT = "The espresso machine is cleaned every night.";
const TRAINING_PHONE = "Casey typed this on her phone.";
const TRAINING_KALE = "Kale saved this in the meantime.";
const NOTE = "Kale suggests coffee staff at $15/hr, weekends   $16 -- talk to *Casey*";
const WEEKEND_TITLE = "Weekend shifts pay one dollar more";
const WEEKEND_TEXT = "Weekend shifts pay $1.00/hr more than weekday shifts.";
const HOURS_V1 = ["Open 9 AM to 6 PM, Monday to Saturday.", "Closed Sunday."];
const HOURS_V2 = ["Open 9 AM to 7 PM, Monday to Saturday.", "Open 11 AM to 4 PM Sunday."];
const PHONE_NOTE = "Casey on the phone: ask about the awning quote";
const BENEFITS_ADDED = [" Seasonal staff get it too.", " It does not cover gift cards."];
const BENEFITS_NOW = DISCOUNT_TEXT + BENEFITS_ADDED.join("");
const SEEDS_TITLE = "Staff discount covers seeds as well";
const SEEDS_ADDED = " Seeds are included.";
const LIGHTS_TITLE = "Lights on before the gate opens";
const LIGHTS_ADDED = " Turn the lights on before that.";
const WARNING_END = "Approving this proposal approves the whole text, not only the differences below. See the version history.";

const DAY_MS = 24 * 60 * 60 * 1000;
// Rows on one page of the activity log. scripts/run-e2e.sh makes it small,
// so the test can turn the page without making 50 changes first.
const ACTIVITY_PAGE = Number(process.env.ACTIVITY_PAGE_SIZE || 50);
const central = (date, options, locale = "en-US") =>
  new Intl.DateTimeFormat(locale, { timeZone: "America/Chicago", ...options }).format(date);
const longDate = (date) => central(date, { weekday: "long", month: "long", day: "numeric", year: "numeric" });
const shortDate = (date) => central(date, { month: "short", day: "numeric", year: "numeric" });
const dateKey = (date) => central(date, { year: "numeric", month: "2-digit", day: "2-digit" }, "en-CA");

const TIME = String.raw`\d{1,2}:\d{2}\s[AP]M`;
const DATE_TIME = String.raw`[A-Z][a-z]{2} \d{1,2}, \d{4}, ${TIME}`;
// "Nov 10, 9:56 PM": when a copy kept on the device was typed.
const DAY_TIME = String.raw`[A-Z][a-z]{2} \d{1,2}, ${TIME}`;
const escapeRe = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Keep trying for a few seconds; true as soon as `test` is. */
async function eventually(test, timeoutMs = 8000) {
  const end = Date.now() + timeoutMs;
  for (;;) {
    try {
      if (await test()) return true;
    } catch {
      // Not there yet (for example the page is still changing).
    }
    if (Date.now() > end) return false;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

/** True when the whole element is on screen right now, without scrolling. */
function inView(locator) {
  return locator.evaluate((el) => {
    const box = el.getBoundingClientRect();
    return box.height > 0 && box.top >= 0 && box.bottom <= window.innerHeight;
  });
}

const height = (locator) => locator.evaluate((el) => el.getBoundingClientRect().height);
const navOf = (page) => page.getByRole("navigation", { name: "Main" });
const statusOf = (page) => page.locator(".proposal-status");
const newForm = (page) => page.getByRole("form", { name: "New proposal" });
const approveButton = (page) => page.getByRole("button", { name: "Approve", exact: true });
// The notice an Owner gets before approving on top of official text they have not approved.
const warningOf = (page) => page.locator(".notice").filter({ hasText: "Approving this proposal approves the whole text" });
// (The sidebar has an "Edit" link of its own, for the sections.)
const editLink = (page) => page.getByRole("main").getByRole("link", { name: "Edit", exact: true });

/** Open a subsection from the sidebar, unfolding its parent first if needed. */
async function goToSection(page, parent, name) {
  const nav = navOf(page);
  const link = nav.getByRole("link", { name });
  if (!(await link.isVisible())) {
    await nav.getByRole("button", { name: `Show subsections of ${parent}` }).click();
  }
  await link.click();
  await page.getByRole("heading", { level: 1, name }).waitFor();
}

/** Sidebar > a page (Today, Proposals...). The Proposals link may carry a count. */
async function goTo(page, label, heading = label) {
  await navOf(page).getByRole("link", { name: new RegExp(`^${label}(, \\d+ waiting)?$`) }).click();
  await page.getByRole("heading", { level: 1, name: heading }).waitFor();
}

/** Controls only an Owner may have. An Advisor must see none of them, anywhere. */
const OWNER_CONTROLS =
  /^(New proposal|Propose a change|Propose|Propose from .*|Edit official|Continue editing|Approve|Approve on my own|I approve too.*|Decline|Withdraw|Edit|Check and save again|Restore.*)$/;
async function ownerControls(page) {
  const main = page.getByRole("main");
  return (
    (await main.getByRole("button", { name: OWNER_CONTROLS }).count()) +
    (await main.getByRole("link", { name: OWNER_CONTROLS }).count())
  );
}

/** What this device holds of text typed but not saved (the keys it is kept under). */
function draftKeys(page, prefix = "ppf:draft:") {
  return page.evaluate((start) => Object.keys(window.localStorage).filter((key) => key.startsWith(start)), prefix);
}

/**
 * How many times the page sends something to the app (a form, a button)
 * while `action` runs and for a moment after. 0 means nothing was sent.
 */
async function sentWhile(page, action) {
  let sent = 0;
  const count = (request) => {
    if (request.method() === "POST") sent += 1;
  };
  page.on("request", count);
  await action();
  await page.waitForTimeout(500);
  page.off("request", count);
  return sent;
}

/** Replace everything in the proposed-text editor with these paragraphs. */
async function typeProposedText(page, paragraphs) {
  const editor = newForm(page).getByRole("textbox", { name: "Proposed official text" });
  await editor.waitFor();
  await editor.click();
  await page.keyboard.press("Control+A");
  for (const [index, line] of paragraphs.entries()) {
    if (index > 0) await page.keyboard.press("Enter");
    await page.keyboard.type(line);
  }
}

/** Fill the text part of the New proposal form and send it. Ends on the proposal's page. */
async function proposeText(page, { title, text, business, why }) {
  const form = newForm(page);
  await form.getByLabel("Title", { exact: true }).fill(title);
  await typeProposedText(page, text);
  if (business) await form.getByRole("radio", { name: business, exact: true }).check();
  if (why) await form.getByLabel("Why (optional)").fill(why);
  await form.getByRole("button", { name: "Propose", exact: true }).click();
  await page.waitForURL(/\/proposals\/[0-9a-f-]{36}$/);
  await page.getByRole("heading", { level: 1, name: title }).waitFor();
  return page.url();
}

/** Proposals > New proposal > find a section by typing. Ends on the form for that section. */
async function startProposalFor(page, find, sectionName) {
  await goTo(page, "Proposals");
  await page.getByRole("link", { name: "New proposal" }).click();
  await page.getByRole("heading", { level: 1, name: "New proposal" }).waitFor();
  const form = newForm(page);
  await form.getByLabel("Find a section").fill(find);
  await form.getByRole("list", { name: "Matching sections" }).getByRole("link", { name: sectionName }).click();
  await form.getByRole("link", { name: "Change the section" }).waitFor();
}

async function main() {
  const browser = await chromium.launch();
  const errors = [];
  // Dates are worked out at the moment they are compared, not once at the
  // start, so a run that passes midnight (US Central) does not go wrong.
  const today = () => {
    const now = new Date();
    return { key: dateKey(now), long: longDate(now), short: shortDate(now), day: central(now, { month: "short", day: "numeric" }) };
  };
  const daysAgo = (days) => new Date(Date.now() - days * DAY_MS);
  const approvedBoth = () => `Approved by Kale and Casey, ${today().short}`;
  const approvedKale = () => `Approved by Kale, ${today().short}`;

  const kaleContext = await desktopContext(browser);
  const kale = await kaleContext.newPage();
  trackErrors(kale, errors);
  await signIn(kale, "kale@example.com");

  // Karen, the Advisor, is added in Settings the way an Owner would.
  await navOf(kale).getByRole("link", { name: "Settings" }).click();
  await kale.getByRole("heading", { level: 1, name: "Settings" }).waitFor();
  const inviteSince = Date.now();
  await kale.getByLabel("Name or nickname").fill("Karen");
  await kale.getByLabel("Email", { exact: true }).fill("karen@example.com");
  await kale.locator('select[name="role"]').selectOption({ label: "Advisor" });
  await kale.getByRole("button", { name: "Create user" }).click();
  await kale.getByText("Karen was added.").waitFor();
  const invite = await latestEmail("karen@example.com", inviteSince);
  await kale.getByRole("link", { name: "Back" }).click();
  await kale.getByRole("heading", { level: 1, name: "Today" }).waitFor();

  const caseyContext = await desktopContext(browser);
  const casey = await caseyContext.newPage();
  trackErrors(casey, errors);
  await signIn(casey, "casey@example.com");

  const karenContext = await desktopContext(browser);
  const karen = await karenContext.newPage();
  trackErrors(karen, errors);
  await karen.goto(linkIn(invite));
  await karen.getByRole("heading", { level: 1, name: "Today" }).waitFor();

  // ------------------------------------------------------------------
  section("1. Kale proposes coffee wages at $15/hr, Casey approves");
  check("with nothing proposed, Today says so", await casey.getByRole("region", { name: "Awaiting approval (0)" }).getByText("Nothing is waiting for approval.").isVisible());
  check("the old one-person change (20 days ago) is not flagged on Today", await casey.getByText("Nothing was decided by one person in the last 14 days.").isVisible());
  check("with nothing waiting, Proposals in the sidebar has no number", (await navOf(casey).getByRole("link", { name: "Proposals", exact: true }).count()) === 1);

  await goToSection(kale, "People", "2.1 Wages");
  check("Wages starts out saying $13.00/hr", (await kale.locator(".official-box .rich p").first().innerText()) === "Starting wage, Coffee Shop: $13.00/hr.");
  check("an Owner has Propose a change and Edit official", (await kale.getByRole("link", { name: "Propose a change" }).isVisible()) && (await kale.getByRole("button", { name: "Edit official" }).isVisible()));
  await kale.getByRole("link", { name: "Propose a change" }).click();
  await kale.getByRole("heading", { level: 1, name: "New proposal" }).waitFor();
  const kaleForm = newForm(kale);
  check("the form starts as a decision about that section", (await kaleForm.getByRole("radio", { name: "Decision" }).isChecked()) && (await kaleForm.getByText("2.1 Wages").isVisible()));
  const kinds = await kaleForm.getByRole("group", { name: "What is this about?" }).locator("label").allInnerTexts();
  check("the three kinds are named as on every other screen, each with its explaining line", kinds.join("|") === "Decision|Official text|Structure" && (await kaleForm.getByText("Rewords the official text without changing what was decided.").isVisible()) && (await kaleForm.getByText("Add, rename, move or archive a section.").isVisible()), kinds.join("|"));
  const proposedBox = kaleForm.getByRole("textbox", { name: "Proposed official text" });
  await proposedBox.waitFor();
  check("the proposed text starts as the current official text", (await proposedBox.innerText()).includes("Starting wage, Coffee Shop: $13.00/hr."));
  check("the form says whose approval it will need", await kaleForm.getByText("Proposing counts as your approval. It becomes official when Casey approves too.").isVisible());
  // Propose before anything is typed: refused in place, and nothing is kept on the device.
  await kaleForm.getByRole("button", { name: "Propose", exact: true }).click();
  await kaleForm.getByRole("alert").waitFor();
  check("Propose without a title is refused in place", (await kaleForm.getByRole("alert").innerText()) === "Say in a few words what is being decided.", await kaleForm.getByRole("alert").innerText());
  check("a refused Propose with untouched text leaves no copy on the device", (await draftKeys(kale)).length === 0, (await draftKeys(kale)).join(" "));
  await kaleForm.getByLabel("Title", { exact: true }).fill(WAGES_TITLE);
  await typeProposedText(kale, WAGES_NEW);
  check("what is typed as proposed text is kept on the device", await eventually(async () => (await draftKeys(kale, "ppf:draft:proposal:new:")).length === 1), (await draftKeys(kale)).join(" "));
  // On a phone, Return in a one-line box puts the keyboard away. It must not send the proposal.
  const sentByReturn = await sentWhile(kale, () => kaleForm.getByLabel("Title", { exact: true }).press("Enter"));
  check("Return in the Title box does not send the proposal", sentByReturn === 0 && kale.url().includes("/proposals/new?") && (await kale.getByRole("heading", { level: 1, name: "New proposal" }).isVisible()), `${sentByReturn} sent, ${kale.url()}`);
  await kale.reload();
  await proposedBox.waitFor();
  check("after a reload the typed text is picked up again, and the form says so", (await proposedBox.innerText()).includes(WAGES_NEW[0]) && (await kaleForm.getByText(/^Picked up your unsaved changes from /).isVisible()), await proposedBox.innerText());
  await kaleForm.getByLabel("Title", { exact: true }).fill(WAGES_TITLE);
  await kaleForm.getByRole("radio", { name: "Coffee Shop", exact: true }).check();
  await kaleForm.getByLabel("Why (optional)").fill(WAGES_WHY);
  await shot(kale, "p3-desktop-01-new-proposal", { fullPage: true });
  await kaleForm.getByRole("button", { name: "Propose", exact: true }).click();
  await kale.waitForURL(/\/proposals\/[0-9a-f-]{36}$/);
  await kale.getByRole("heading", { level: 1, name: WAGES_TITLE }).waitFor();
  const wagesUrl = kale.url();
  check("once it is proposed, the copy on the device is cleared", (await draftKeys(kale)).length === 0, (await draftKeys(kale)).join(" "));
  check("after proposing, Kale lands on the proposal: Waiting for approval", (await statusOf(kale).innerText()) === "Waiting for approval");
  const kaleApprovals = kale.getByRole("region", { name: "Approvals" });
  check("the proposal says it is waiting for Casey", await kaleApprovals.getByText("Waiting for Casey", { exact: true }).isVisible());
  check("proposing counted as Kale's approval", await kaleApprovals.getByText(new RegExp(`^Kale approved ${DATE_TIME} \\(proposed it\\)$`)).isVisible());
  check("the proposal shows its kind, section, business and proposer", new RegExp(`^Decision · 2\\.1 Wages · Coffee Shop · Proposed by Kale, ${DATE_TIME}$`).test(await kale.locator(".proposal .page-head .meta").innerText()), await kale.locator(".proposal .page-head .meta").innerText());
  check("the proposal shows why, word for word", (await kale.getByRole("region", { name: "Why" }).locator(".rich").innerText()) === WAGES_WHY);
  check("the proposer has Approve on my own, Edit and Withdraw, and no Approve or Decline", (await kale.getByRole("button", { name: "Approve on my own" }).isVisible()) && (await editLink(kale).isVisible()) && (await kale.getByRole("button", { name: "Withdraw" }).isVisible()) && (await approveButton(kale).count()) === 0 && (await kale.getByRole("button", { name: "Decline" }).count()) === 0 && (await kale.getByRole("button", { name: "Endorse" }).count()) === 0);
  check("the proposer's own sidebar shows no number (he has approved)", (await navOf(kale).getByRole("link", { name: "Proposals", exact: true }).count()) === 1);
  await goToSection(kale, "People", "2.1 Wages");
  check("the section says a proposal is waiting, with a link to it", await kale.locator(".notice").filter({ hasText: "Waiting for approval:" }).getByRole("link", { name: WAGES_TITLE }).isVisible());
  check("nothing is official yet: Wages still says $13.00/hr", (await kale.locator(".official-box .rich p").first().innerText()) === "Starting wage, Coffee Shop: $13.00/hr.");

  await casey.reload();
  await casey.getByRole("heading", { level: 1, name: "Today" }).waitFor();
  const caseyCount = navOf(casey).getByRole("link", { name: "Proposals, 1 waiting" });
  check("Casey's sidebar shows the count 1 after Proposals", (await caseyCount.isVisible()) && (await caseyCount.locator(".nav-count").innerText()) === "1");
  const caseyAwaiting = casey.getByRole("region", { name: "Awaiting approval (1)" });
  check("Casey's Today lists it under Awaiting approval", await caseyAwaiting.getByRole("link", { name: WAGES_TITLE }).isVisible());
  check("Today says who proposed it and that it waits for her", (await caseyAwaiting.getByText(`Proposed by Kale, ${today().short}`).isVisible()) && (await caseyAwaiting.getByText("Waiting for you").isVisible()));
  await shot(casey, "p3-desktop-02-today-awaiting");
  await caseyAwaiting.getByRole("link", { name: WAGES_TITLE }).click();
  await casey.getByRole("heading", { level: 1, name: WAGES_TITLE }).waitFor();
  const diff = casey.locator(".diff");
  const lineOf = (locator) => locator.evaluate((el) => getComputedStyle(el).textDecorationLine);
  check("the old wage is shown struck through", (await diff.locator("del").innerText()) === "$13.00/hr." && (await lineOf(diff.locator("del"))) === "line-through", await diff.locator("del").allInnerTexts().then((t) => t.join("|")));
  check("the new wage is shown underlined", (await diff.locator("ins").innerText()) === "$15.00/hr." && (await lineOf(diff.locator("ins"))) === "underline");
  check("the unchanged words are shown plainly, in reading order", (await diff.innerText()) === "Starting wage, Coffee Shop: $13.00/hr.$15.00/hr.\nStarting wage, Garden Center Registers: $15.00/hr.", JSON.stringify(await diff.innerText()));
  check("the page says what it is compared with", await casey.getByText("Compared with the official text now.").isVisible());
  // The text it is compared with was saved by Kale alone (the seeded version), so Casey is told.
  check("Casey is told she never approved the text it is compared with", (await warningOf(casey).innerText().catch(() => "missing")) === `You have never approved the official text of this section. It was last changed by Kale on ${shortDate(daysAgo(25))}. ${WARNING_END}`, await warningOf(casey).innerText().catch(() => "missing"));
  await casey.getByText("Full proposed text").click();
  check("the full proposed text can be opened", (await casey.locator("details.full-text .rich p").first().innerText()) === WAGES_NEW[0]);
  check("on the proposal's own page too, the person it waits for reads Waiting for you", await casey.getByRole("region", { name: "Approvals" }).getByText("Waiting for you", { exact: true }).isVisible());
  check("the other Owner has Approve, Decline and Endorse, and no Edit or Withdraw", (await approveButton(casey).isVisible()) && (await casey.getByRole("button", { name: "Decline" }).isVisible()) && (await casey.getByRole("button", { name: "Endorse" }).isVisible()) && (await editLink(casey).count()) === 0 && (await casey.getByRole("button", { name: "Withdraw" }).count()) === 0 && (await casey.getByRole("button", { name: "Approve on my own" }).count()) === 0);
  await shot(casey, "p3-desktop-03-proposal-open", { fullPage: true });
  await approveButton(casey).click();
  check("after Approve the page says it is official now", await eventually(() => casey.getByRole("status").filter({ hasText: "Approved. It is official now." }).isVisible()));
  check("the proposal shows Approved by Kale and Casey, in bold", (await eventually(async () => (await statusOf(casey).innerText()) === approvedBoth())) && Number(await statusOf(casey).evaluate((el) => getComputedStyle(el).fontWeight)) >= 700, await statusOf(casey).innerText());
  check("an approved proposal has no Approve, Decline, Edit or Withdraw left", (await approveButton(casey).count()) === 0 && (await casey.getByRole("button", { name: /^(Decline|Withdraw|Approve on my own|I approve too)$/ }).count()) === 0 && (await editLink(casey).count()) === 0);
  await kale.goto(wagesUrl);
  await kale.getByRole("heading", { level: 1, name: WAGES_TITLE }).waitFor();
  check("its proposer has no Edit, Withdraw or Approve on my own left either", (await editLink(kale).count()) === 0 && (await kale.getByRole("button", { name: /^(Approve|Decline|Withdraw|Approve on my own|I approve too)$/ }).count()) === 0 && (await statusOf(kale).innerText()) === approvedBoth());
  check("the approved proposal says what it was compared with", await casey.getByText("Compared with the text it replaced.").isVisible());
  await shot(casey, "p3-desktop-04-proposal-approved", { fullPage: true });
  check("the count is gone from Casey's sidebar", (await navOf(casey).getByRole("link", { name: "Proposals", exact: true }).count()) === 1 && (await navOf(casey).locator(".nav-count").count()) === 0);

  await goToSection(casey, "People", "2.1 Wages");
  const approvalStyle = await casey.locator(".approval").evaluate((el) => getComputedStyle(el).fontWeight);
  check("Wages shows a bold Approved by Kale and Casey", (await casey.locator(".approval").innerText()) === approvedBoth() && Number(approvalStyle) >= 700, await casey.locator(".approval").innerText());
  check("Wages shows the new text", (await casey.locator(".official-box .rich p").allInnerTexts()).join("|") === WAGES_NEW.join("|"));
  check("the waiting notice is gone from the section", (await casey.getByText("Waiting for approval:").count()) === 0);
  await shot(casey, "p3-desktop-05-section-approved", { fullPage: true });
  await casey.getByRole("link", { name: "Version history" }).click();
  await casey.getByRole("heading", { level: 1, name: "Version history" }).waitFor();
  const wagesVersions = casey.locator(".version-list > li");
  check("version history has a new version tied to the proposal", (await wagesVersions.count()) === 2 && (await wagesVersions.nth(0).getByRole("heading", { name: "Version 2 (current)" }).isVisible()) && (await wagesVersions.nth(0).getByRole("link", { name: WAGES_TITLE }).isVisible()) && (await wagesVersions.nth(0).getByText(approvedBoth()).isVisible()));
  check("the earlier version says when it was official and how it came about", (await wagesVersions.nth(1).getByText(`Official from ${shortDate(daysAgo(25))} to ${today().short}`).isVisible()) && (await wagesVersions.nth(1).getByText("Edited directly by Kale").isVisible()));
  await wagesVersions.nth(0).getByRole("link", { name: WAGES_TITLE }).click();
  await casey.getByRole("heading", { level: 1, name: WAGES_TITLE }).waitFor();
  check("the version links back to its proposal", casey.url() === wagesUrl);

  await goTo(casey, "Proposals");
  check("an approved proposal is no longer listed as waiting", await casey.getByRole("region", { name: "Awaiting approval (0)" }).getByText("Nothing is waiting for approval.").isVisible());
  await casey.getByRole("link", { name: "Decisions Log" }).click();
  await casey.getByRole("heading", { level: 1, name: "Decisions Log" }).waitFor();
  const decisions = (page) => page.getByRole("list", { name: "Decisions" }).getByRole("listitem");
  const wagesDecision = decisions(casey).filter({ hasText: WAGES_TITLE });
  check("the Decisions Log lists it with both names", (await wagesDecision.getByText(approvedBoth()).isVisible()) && (await wagesDecision.getByText(`${today().short} · 2.1 Wages · Decision · Coffee Shop`).isVisible()), await wagesDecision.innerText().catch(() => "missing"));
  check("the Decisions Log links to the section and the proposal", (await wagesDecision.getByRole("link", { name: "2.1 Wages" }).isVisible()) && (await wagesDecision.getByRole("link", { name: WAGES_TITLE }).isVisible()));

  // ------------------------------------------------------------------
  section("2. Kale approves something on his own, Casey sees it flagged");
  await startProposalFor(kale, "benefit", "2.2 Benefits");
  check("New proposal first asks which section, then shows it with Change", await newForm(kale).getByText("2.2 Benefits").isVisible());
  await proposeText(kale, { title: DISCOUNT_TITLE, text: [DISCOUNT_TEXT] });
  check("with no official text before, the whole text shows as added", (await kale.locator(".diff ins").innerText()) === DISCOUNT_TEXT);
  await kale.getByRole("button", { name: "Approve on my own" }).click();
  await kale.getByText("Make this official now with only your approval? Casey will see it flagged on Today.").waitFor();
  check("Approve on my own asks first, in place", (await kale.getByRole("button", { name: "Cancel" }).isVisible()) && (await kale.getByRole("dialog").count()) === 0);
  await kale.getByRole("button", { name: "Cancel" }).click();
  check("Cancel leaves the proposal waiting", (await statusOf(kale).innerText()) === "Waiting for approval" && (await kale.getByRole("button", { name: "Approve on my own" }).isVisible()));
  await kale.getByRole("button", { name: "Approve on my own" }).click();
  await kale.getByText("Make this official now with only your approval?").waitFor();
  await kale.getByRole("button", { name: "Approve on my own" }).click();
  check("the proposal shows Approved by Kale", await eventually(async () => (await statusOf(kale).innerText()) === approvedKale()), await statusOf(kale).innerText());
  await goToSection(kale, "People", "2.2 Benefits");
  check("the section shows Approved by Kale", (await kale.locator(".approval").innerText()) === approvedKale() && (await kale.locator(".official-box .rich").innerText()) === DISCOUNT_TEXT);
  check("the one who decided alone has no I approve too", (await kale.getByRole("button", { name: /^I approve too/ }).count()) === 0);

  await goTo(casey, "Today");
  const flagged = casey.getByRole("region", { name: /^Decided by one person/ });
  await casey.getByRole("heading", { level: 2, name: "Decided by one person (1)" }).waitFor();
  const discountFlag = flagged.getByRole("listitem").filter({ hasText: DISCOUNT_TITLE });
  const flagLine = discountFlag.getByText(`Decided by Kale alone, ${today().short}`);
  check("Casey's Today flags it as Decided by Kale alone", await flagLine.isVisible());
  check("the flag stands out in bold", Number(await flagLine.evaluate((el) => getComputedStyle(el).fontWeight)) >= 700);
  check("Today explains the list", await flagged.getByText("Approved by one Owner in the last 14 days.").isVisible());
  await shot(casey, "p3-desktop-06-today-flagged");
  await flagged.getByRole("button", { name: `I approve too: ${DISCOUNT_TITLE}` }).click();
  await casey.getByRole("heading", { level: 2, name: "Decided by one person (0)" }).waitFor();
  check("after I approve too it leaves the flagged list", (await flagged.getByText(DISCOUNT_TITLE).count()) === 0);
  await goToSection(casey, "People", "2.2 Benefits");
  check("the section now says Approved by Kale and Casey", (await casey.locator(".approval").innerText()) === approvedBoth());

  // ------------------------------------------------------------------
  section("3. A direct Edit official save is flagged too");
  await goToSection(kale, "Hours and Daily Operations", "3.2 Opening Procedures");
  await kale.getByRole("button", { name: "Edit official" }).click();
  const kaleOfficial = kale.getByRole("textbox", { name: "Official text" });
  await kaleOfficial.waitFor();
  check("the direct editor says what saving does", await kale.getByText("Saving makes this official right away, approved by you alone. The other Owner will see it flagged on Today. To ask for approval first, use Propose a change.").isVisible());
  await kaleOfficial.click();
  await kale.keyboard.type(OPENING_TEXT);
  await kale.getByRole("button", { name: "Save as official" }).click();
  await kale.locator(".approval").waitFor();
  check("a direct save shows Approved by Kale", (await kale.locator(".approval").innerText()) === approvedKale());
  await goTo(casey, "Today");
  await casey.getByRole("heading", { level: 2, name: "Decided by one person (1)" }).waitFor();
  const OPENING_EDIT = "Edited directly: 3.2 Opening Procedures (version 1)";
  const directFlag = flagged.getByRole("listitem").filter({ hasText: "Edited directly: 3.2 Opening Procedures" });
  check("Casey's Today flags the direct edit by its section and version", (await directFlag.getByRole("link", { name: OPENING_EDIT, exact: true }).isVisible()) && (await directFlag.getByText(`Decided by Kale alone, ${today().short}`).isVisible()));
  await goTo(casey, "Proposals");
  check("a direct edit is not listed on the Proposals page", (await casey.getByText("Edited directly").count()) === 0);
  await casey.getByRole("link", { name: "Decisions Log" }).click();
  await casey.getByRole("heading", { level: 1, name: "Decisions Log" }).waitFor();
  const directDecision = decisions(casey).filter({ hasText: "Edited directly: 3.2 Opening Procedures" });
  check("the Decisions Log lists the direct edit with who approved it", await directDecision.getByText(approvedKale()).isVisible());
  await directDecision.getByRole("link", { name: OPENING_EDIT, exact: true }).click();
  await casey.getByRole("heading", { level: 1, name: OPENING_EDIT, exact: true }).waitFor();
  check("a direct edit has its own page with what changed", (await casey.locator(".diff ins").innerText()) === OPENING_TEXT && (await casey.getByRole("button", { name: "I approve too" }).isVisible()));

  // ------------------------------------------------------------------
  section("6. A proposal changed while someone has it open");
  await startProposalFor(kale, "hiring", "2.3 Hiring");
  const hiringUrl = await proposeText(kale, { title: HIRING_TITLE, text: [HIRING_TEXT] });
  await casey.goto(hiringUrl);
  await casey.getByRole("heading", { level: 1, name: HIRING_TITLE }).waitFor();
  await approveButton(casey).waitFor();
  await editLink(kale).click();
  await kale.getByRole("heading", { level: 1, name: "Edit proposal" }).waitFor();
  const editForm = kale.getByRole("form", { name: "Edit proposal" });
  check("the edit form shows the kind and section without letting them change", (await editForm.getByText("Decision", { exact: true }).isVisible()) && (await editForm.getByText("2.3 Hiring").isVisible()) && (await editForm.getByRole("link", { name: "Change the section" }).count()) === 0 && (await editForm.getByRole("radio", { name: /^(Decision|Official text|Structure)$/ }).count()) === 0);
  check("the edit form is filled in with the title", (await editForm.getByLabel("Title", { exact: true }).inputValue()) === HIRING_TITLE);
  // Cancel, next to Save changes, leaves without saving.
  await editForm.getByLabel("Title", { exact: true }).fill("A title that is not saved");
  check("Edit proposal has a Cancel link next to Save changes", await eventually(async () => Math.abs((await editForm.getByRole("link", { name: "Cancel" }).boundingBox()).y - (await editForm.getByRole("button", { name: "Save changes" }).boundingBox()).y) < 30));
  await editForm.getByRole("link", { name: "Cancel" }).click();
  await kale.waitForURL(hiringUrl);
  await kale.getByRole("heading", { level: 1, name: HIRING_TITLE }).waitFor();
  check("Cancel goes back to the proposal and saves nothing", (await kale.getByText("changed after it was proposed").count()) === 0 && (await statusOf(kale).innerText()) === "Waiting for approval");
  await editLink(kale).click();
  await kale.getByRole("heading", { level: 1, name: "Edit proposal" }).waitFor();
  const editBox = editForm.getByRole("textbox", { name: "Proposed official text" });
  await editBox.waitFor();
  check("the edit form is filled in with the proposed text", (await editBox.innerText()).trim() === HIRING_TEXT);
  await editBox.click();
  await kale.keyboard.press("Control+End");
  await kale.keyboard.type(HIRING_ADDED);
  await editForm.getByRole("button", { name: "Save changes" }).click();
  await kale.waitForURL(hiringUrl);
  await kale.getByText("changed after it was proposed").waitFor();
  check("after Save changes Kale is back on the proposal, marked as changed", (await kale.locator(".diff ins").innerText()) === HIRING_TEXT + HIRING_ADDED);
  await approveButton(casey).click();
  const refusal = casey.getByRole("alert").filter({ hasText: "Kale changed this proposal after you opened it." });
  await refusal.waitFor();
  check("Casey's Approve on the old page is refused, with the reason", (await refusal.innerText()) === "Kale changed this proposal after you opened it. Reload the page and read it again, then approve.", await refusal.innerText());
  check("the refused proposal is still waiting", (await statusOf(casey).innerText()) === "Waiting for approval");
  await casey.reload();
  await casey.getByRole("heading", { level: 1, name: HIRING_TITLE }).waitFor();
  check("after reloading Casey sees the changed text", (await casey.locator(".diff ins").innerText()) === HIRING_TEXT + HIRING_ADDED);
  await approveButton(casey).click();
  check("after reloading she can approve", await eventually(async () => (await statusOf(casey).innerText()) === approvedBoth()), await statusOf(casey).innerText());

  // ------------------------------------------------------------------
  section("9. A proposal made from a note in the Daily Log");
  await navOf(kale).getByRole("link", { name: "New note" }).click();
  await kale.getByRole("heading", { level: 1, name: today().long }).waitFor();
  const noteBox = kale.getByRole("textbox", { name: "New note" });
  await noteBox.waitFor();
  await noteBox.click();
  await kale.keyboard.type(NOTE);
  await kale.getByRole("button", { name: "Save", exact: true }).click();
  const kaleNote = kale.getByRole("article", { name: /^Note by Kale/ }).filter({ hasText: "coffee staff" });
  await kaleNote.waitFor();
  await kale.getByRole("button", { name: "Cancel" }).click();

  // Not sorted yet, so the note is on Today: with Propose for an Owner, without it for an Advisor.
  await goTo(kale, "Today");
  const todayNote = kale.getByRole("region", { name: "Unsorted notes (1)" }).getByRole("article", { name: /^Note by Kale/ });
  check("on Today an Owner's unsorted note has Propose", await todayNote.getByRole("link", { name: /^Propose from note by Kale/ }).isVisible());
  await karen.reload();
  await karen.getByRole("heading", { level: 1, name: "Today" }).waitFor();
  const karenUnsorted = karen.getByRole("region", { name: "Unsorted notes (1)" }).getByRole("article", { name: /^Note by Kale/ });
  check("an Advisor sees the unsorted note on Today without Propose or any other Owner control", (await karenUnsorted.isVisible()) && (await karenUnsorted.getByRole("button", { name: /^Add comment/ }).isVisible()) && (await karen.getByRole("main").getByRole("link", { name: /^Propose/ }).count()) === 0 && (await ownerControls(karen)) === 0);
  // Propose from a note that is not filed anywhere: the note stays in view while the section is chosen.
  await todayNote.getByRole("link", { name: /^Propose from note by Kale/ }).click();
  await kale.getByRole("heading", { level: 1, name: "New proposal" }).waitFor();
  const pickForm = newForm(kale);
  const noteWhilePicking = await pickForm.locator(".from-note .rich").innerText().catch(() => "missing");
  check("Propose from an unfiled note asks which section, with the note shown word for word", (await pickForm.getByText("Which section?").isVisible()) && (await pickForm.getByText("From this note").isVisible()) && noteWhilePicking === NOTE, JSON.stringify(noteWhilePicking));
  const noteAbove = await kale.evaluate(() => document.querySelector(".from-note").getBoundingClientRect().bottom <= document.querySelector(".section-picker").getBoundingClientRect().top);
  check("the note stands above the list of sections", noteAbove);
  await goTo(kale, "Daily Log");
  await kale.getByRole("link", { name: /^Today.s log$/ }).click();
  await kale.getByRole("heading", { level: 1, name: today().long }).waitFor();
  await kaleNote.getByRole("button", { name: /^Sort note/ }).click();
  const sortForm = kaleNote.getByRole("form", { name: /^Sort note/ });
  await sortForm.getByLabel("Find a section").fill("sched");
  await sortForm.getByRole("checkbox", { name: "3.4 Scheduling" }).check();
  await sortForm.getByRole("button", { name: "Save" }).click();
  await kaleNote.getByText("Filed under 3.4 Scheduling").waitFor();
  check("an Owner's note has Propose next to Sort, Edit and Remove", await kaleNote.getByRole("link", { name: /^Propose from note by Kale/ }).isVisible());
  await kaleNote.getByRole("link", { name: /^Propose from note by Kale/ }).click();
  await kale.getByRole("heading", { level: 1, name: "New proposal" }).waitFor();
  const noteForm = newForm(kale);
  check("a note filed under one section preselects that section", (await noteForm.getByText("3.4 Scheduling").isVisible()) && (await noteForm.getByRole("link", { name: "Change the section" }).isVisible()));
  const fromNote = await noteForm.locator(".from-note .rich").innerText();
  check("the form shows the note word for word", (await noteForm.getByText("From this note").isVisible()) && fromNote === NOTE, JSON.stringify(fromNote));
  await proposeText(kale, { title: WEEKEND_TITLE, text: [WEEKEND_TEXT] });
  const weekendUrl = kale.url();
  const fromNotes = kale.getByRole("region", { name: "From these notes" });
  const shownNote = await fromNotes.locator("article.note > .rich").innerText();
  check("the proposal shows the note under From these notes, word for word", shownNote === NOTE, JSON.stringify(shownNote));
  await fromNotes.getByRole("link", { name: `Daily Log, ${today().short}` }).click();
  await kale.getByRole("heading", { level: 1, name: today().long }).waitFor();
  check("the note's link goes to its day", /\/daily-log\/\d{4}-\d{2}-\d{2}#note-[0-9a-f-]{36}$/.test(kale.url()) && kale.url().includes(today().key), kale.url());
  const noteLine = kaleNote.locator(".note-proposal");
  check("the note says a proposal was made from it and where it stands", (await noteLine.innerText()) === `Proposal: ${WEEKEND_TITLE} (waiting for approval)`, await noteLine.innerText().catch(() => "missing"));
  await noteLine.getByRole("link", { name: WEEKEND_TITLE }).click();
  await kale.getByRole("heading", { level: 1, name: WEEKEND_TITLE }).waitFor();
  check("the note's proposal line opens the proposal", kale.url() === weekendUrl);
  await shot(kale, "p3-desktop-07-proposal-from-note", { fullPage: true });
  // In a section's Discussion the same note has its proposal line, and no Propose.
  await goToSection(kale, "Hours and Daily Operations", "3.4 Scheduling");
  const discussion = kale.getByRole("region", { name: "Discussion" });
  check("in Discussion the note shows its proposal line and has no Propose, not even for an Owner", (await discussion.locator(".note-proposal").innerText().catch(() => "missing")) === `Proposal: ${WEEKEND_TITLE} (waiting for approval)` && (await discussion.getByRole("link", { name: /^Propose/ }).count()) === 0 && (await discussion.getByRole("article", { name: /^Note by Kale/ }).isVisible()));

  // ------------------------------------------------------------------
  section("4. Karen, the Advisor: reads, endorses, comments, and nothing else");
  await goToSection(kale, "People", "2.1 Wages");
  await kale.getByRole("link", { name: "Propose a change" }).click();
  await kale.getByRole("heading", { level: 1, name: "New proposal" }).waitFor();
  const registersUrl = await proposeText(kale, { title: REGISTERS_TITLE, text: REGISTERS_NEW, business: "Garden Center" });

  await karen.reload();
  await karen.getByRole("heading", { level: 1, name: "Today" }).waitFor();
  check("an Advisor's sidebar counts every open proposal", await navOf(karen).getByRole("link", { name: "Proposals, 2 waiting" }).isVisible());
  check("an Advisor sees what is waiting on Today, and who it waits for", await karen.getByRole("region", { name: "Awaiting approval (2)" }).getByRole("listitem").filter({ hasText: REGISTERS_TITLE }).getByText("Waiting for Casey").isVisible());
  check("an Advisor sees the one-person decisions on Today", await karen.getByRole("region", { name: /^Decided by one person/ }).getByText("Edited directly: 3.2 Opening Procedures").isVisible());
  check("an Advisor has no Owner controls on Today", (await ownerControls(karen)) === 0);
  await goTo(karen, "Daily Log");
  await karen.getByRole("link", { name: /^Today.s log$/ }).click();
  await karen.getByRole("heading", { level: 1, name: today().long }).waitFor();
  const karenNote = karen.getByRole("article", { name: /^Note by Kale/ }).filter({ hasText: "coffee staff" });
  check("an Advisor sees the note and its proposal line in the Daily Log", await karenNote.getByRole("link", { name: WEEKEND_TITLE }).isVisible());
  check("an Advisor has no Owner controls (no Propose) on a Daily Log day", (await ownerControls(karen)) === 0);

  await goTo(karen, "Proposals");
  check("an Advisor can open the Proposals page and sees what is waiting", await karen.getByRole("region", { name: "Awaiting approval (2)" }).getByRole("link", { name: REGISTERS_TITLE }).isVisible());
  check("an Advisor has no New proposal or other Owner control on the Proposals page", (await ownerControls(karen)) === 0);
  await karen.goto(`${BASE_URL}/proposals/new`);
  await karen.getByRole("heading", { level: 1, name: "Proposals" }).waitFor();
  check("the New proposal address sends an Advisor back to Proposals", karen.url() === `${BASE_URL}/proposals`);
  await karen.getByRole("link", { name: "Decisions Log" }).click();
  await karen.getByRole("heading", { level: 1, name: "Decisions Log" }).waitFor();
  check("an Advisor can read the Decisions Log", (await decisions(karen).filter({ hasText: WAGES_TITLE }).getByText(approvedBoth()).isVisible()) && (await ownerControls(karen)) === 0);

  await karen.goto(registersUrl);
  await karen.getByRole("heading", { level: 1, name: REGISTERS_TITLE }).waitFor();
  check("an Advisor can open an open proposal and read the change", (await karen.locator(".diff del").innerText()) === "$15.00/hr." && (await karen.locator(".diff ins").innerText()) === "$16.00/hr.");
  check("an Advisor has no Owner controls on an open proposal", (await ownerControls(karen)) === 0);
  check("an Advisor has Endorse and Add comment on an open proposal", (await karen.getByRole("button", { name: "Endorse" }).isVisible()) && (await karen.getByRole("button", { name: "Add comment", exact: true }).isVisible()));
  await karen.goto(`${registersUrl}/edit`);
  await karen.getByRole("heading", { level: 1, name: REGISTERS_TITLE }).waitFor();
  check("the edit address sends an Advisor back to the proposal", karen.url() === registersUrl);
  await karen.getByRole("button", { name: "Endorse" }).click();
  const openEndorsement = karen.getByRole("region", { name: "Approvals" }).locator(".endorsements");
  check("an Advisor's Endorse works on one tap, with no question", (await eventually(() => openEndorsement.isVisible())) && (await karen.getByText(ENDORSE_QUESTION).count()) === 0);
  const faint = (locator) =>
    locator.evaluate((el) => {
      const style = getComputedStyle(el);
      return { italic: style.fontStyle === "italic", size: parseFloat(style.fontSize), body: parseFloat(getComputedStyle(document.body).fontSize) };
    });
  let look = await faint(openEndorsement);
  check("her endorsement of an open proposal shows as Endorsed by Karen with the date", (await openEndorsement.innerText()) === `Endorsed by Karen, ${today().short}`);
  check("the endorsement is in italic and smaller than the body text", look.italic && look.size < look.body, JSON.stringify(look));
  check("endorsing does not change the status", (await statusOf(karen).innerText()) === "Waiting for approval" && (await karen.getByRole("region", { name: "Approvals" }).getByText("Waiting for Casey", { exact: true }).isVisible()));
  check("Endorse is gone once she has endorsed", (await karen.getByRole("button", { name: "Endorse" }).count()) === 0);
  await karen.getByRole("button", { name: "Add comment", exact: true }).click();
  const karenBox = karen.getByRole("textbox", { name: "Comment on this proposal" });
  await karenBox.waitFor();
  await karenBox.click();
  await karen.keyboard.type(KAREN_COMMENT);
  await karen.getByRole("button", { name: "Save comment" }).click();
  const karenComments = karen.getByRole("list", { name: "Comments on this proposal" });
  await karenComments.getByText("Karen here").waitFor();
  check("an Advisor can comment on a proposal, word for word", (await karenComments.locator(".rich").innerText()) === KAREN_COMMENT, JSON.stringify(await karenComments.locator(".rich").innerText()));
  check("the comment shows her name, the date and the time", new RegExp(`^${DATE_TIME} · Karen$`).test(await karenComments.locator(".byline").innerText()));
  await shot(karen, "p3-desktop-08-advisor-proposal", { fullPage: true });

  await kale.goto(registersUrl);
  await kale.getByRole("heading", { level: 1, name: REGISTERS_TITLE }).waitFor();
  check("once Karen has endorsed it, Kale has no Edit on it", (await editLink(kale).count()) === 0 && (await kale.getByRole("button", { name: "Withdraw" }).isVisible()));
  check("and he is told why, next to the buttons", await kale.getByRole("region", { name: "Actions" }).getByText("It can no longer be changed because Karen endorsed it. To change it, withdraw it and make a new one.", { exact: true }).isVisible());
  await kale.goto(`${registersUrl}/edit`);
  await kale.getByRole("heading", { level: 1, name: REGISTERS_TITLE }).waitFor();
  check("the edit address sends Kale back to the proposal as well", kale.url() === registersUrl);

  await goToSection(karen, "People", "2.1 Wages");
  check("an Advisor has no Owner controls on a section page", (await ownerControls(karen)) === 0);
  check("an Advisor sees the waiting notice on the section", await karen.locator(".notice").getByRole("link", { name: REGISTERS_TITLE }).isVisible());
  await karen.getByRole("button", { name: "Endorse" }).click();
  const officialEndorsement = karen.locator(".official-box .endorsements");
  await officialEndorsement.waitFor();
  look = await faint(officialEndorsement);
  check("she can endorse approved official text: Endorsed by Karen shows under the approval line", (await officialEndorsement.innerText()) === `Endorsed by Karen, ${today().short}`);
  check("on the section the endorsement is italic and smaller than the body text", look.italic && look.size < look.body, JSON.stringify(look));
  const under = await karen.evaluate(() => document.querySelector(".official-box .approval").getBoundingClientRect().bottom <= document.querySelector(".official-box .endorsements").getBoundingClientRect().top);
  check("the endorsement sits below the bold approval line", under);
  check("her endorsement does not change the approval", (await karen.locator(".approval").innerText()) === approvedBoth());
  await shot(karen, "p3-desktop-09-advisor-section", { fullPage: true });
  await karen.goto(wagesUrl);
  await karen.getByRole("heading", { level: 1, name: WAGES_TITLE }).waitFor();
  check("an approved proposal shows her endorsement and no Owner controls", (await karen.getByRole("region", { name: "Approvals" }).locator(".endorsements").innerText()) === `Endorsed by Karen, ${today().short}` && (await ownerControls(karen)) === 0 && (await statusOf(karen).innerText()) === approvedBoth());
  check("comments stay possible after a decision", await karen.getByRole("button", { name: "Add comment", exact: true }).isVisible());

  // A one-person decision (Kale's direct edit of Opening Procedures, which Casey has
  // not approved): the other Owner can add her approval there, an Advisor cannot.
  await goToSection(casey, "Hours and Daily Operations", "3.2 Opening Procedures");
  check("the other Owner has I approve too under a one-person change", await casey.getByRole("button", { name: "I approve too" }).isVisible());
  await goToSection(karen, "Hours and Daily Operations", "3.2 Opening Procedures");
  check("an Advisor has no I approve too or other Owner control on that section, only Endorse", (await ownerControls(karen)) === 0 && (await karen.getByRole("button", { name: "Endorse" }).isVisible()) && (await karen.locator(".approval").innerText()) === approvedKale());
  await goTo(karen, "Today");
  await karen.getByRole("region", { name: /^Decided by one person/ }).getByRole("link", { name: OPENING_EDIT, exact: true }).click();
  await karen.getByRole("heading", { level: 1, name: OPENING_EDIT, exact: true }).waitFor();
  check("nor on the one-person decision's own page", (await ownerControls(karen)) === 0 && (await karen.getByRole("button", { name: "Endorse" }).isVisible()) && (await statusOf(karen).innerText()) === approvedKale());

  // ------------------------------------------------------------------
  section("4b. Endorse asks an Owner first");
  await casey.getByRole("button", { name: "Endorse" }).click();
  check("under official text, Endorse asks an Owner first, in place of the row", (await eventually(() => casey.getByText(ENDORSE_QUESTION).isVisible())) && (await casey.getByRole("dialog").count()) === 0 && (await casey.getByRole("button", { name: "I approve too" }).isHidden()));
  await casey.getByRole("button", { name: "Cancel" }).click();
  check("Cancel records nothing and brings the row back", (await casey.getByRole("button", { name: "I approve too" }).isVisible()) && (await casey.locator(".official-box .endorsements").count()) === 0 && (await casey.getByText(ENDORSE_QUESTION).count()) === 0);
  await casey.goto(weekendUrl);
  await casey.getByRole("heading", { level: 1, name: WEEKEND_TITLE }).waitFor();
  await casey.getByRole("button", { name: "Endorse" }).click();
  check("on a proposal, Endorse asks an Owner first too", (await eventually(() => casey.getByText(ENDORSE_QUESTION).isVisible())) && (await approveButton(casey).isHidden()));
  await shot(casey, "p3-desktop-19-endorse-question", { fullPage: true });
  await casey.getByRole("group", { name: "Endorse" }).getByRole("button", { name: "Endorse" }).click();
  const endorsedNote = casey.getByRole("status").filter({ hasText: "Endorsed." });
  check("after an Owner endorses, the page says it still waits for her approval", (await eventually(() => endorsedNote.isVisible())) && (await endorsedNote.innerText()) === "Endorsed. It is still waiting for your approval." && (await approveButton(casey).isVisible()) && (await statusOf(casey).innerText()) === "Waiting for approval", await endorsedNote.innerText().catch(() => "missing"));
  const caseyApprovals = casey.getByRole("region", { name: "Approvals" });
  check("her endorsement is listed, and it still reads Waiting for you", (await eventually(async () => (await caseyApprovals.locator(".endorsements").innerText()) === `Endorsed by Casey, ${today().short}`)) && (await caseyApprovals.getByText("Waiting for you", { exact: true }).isVisible()));
  await kale.goto(weekendUrl);
  await kale.getByRole("heading", { level: 1, name: WEEKEND_TITLE }).waitFor();
  check("its proposer has no Edit any more and is told who endorsed it", (await editLink(kale).count()) === 0 && (await kale.getByText("It can no longer be changed because Casey endorsed it. To change it, withdraw it and make a new one.", { exact: true }).isVisible()));

  // ------------------------------------------------------------------
  section("5. Decline with a reason, and Withdraw");
  await startProposalFor(kale, "training", "2.4 Training");
  const trainingUrl = await proposeText(kale, { title: TRAINING_TITLE, text: [TRAINING_TEXT] });
  await casey.goto(trainingUrl);
  await casey.getByRole("heading", { level: 1, name: TRAINING_TITLE }).waitFor();
  await casey.getByRole("button", { name: "Decline" }).click();
  const declineForm = casey.getByRole("form", { name: "Decline this proposal" });
  await declineForm.getByLabel("Reason (optional)").fill(DECLINE_REASON);
  check("Decline opens a reason field in place", (await declineForm.getByRole("button", { name: "Cancel" }).isVisible()) && (await approveButton(casey).count()) === 0);
  await declineForm.getByRole("button", { name: "Decline proposal" }).click();
  check("the proposal shows Declined by Casey", await eventually(async () => (await statusOf(casey).innerText()) === `Declined by Casey, ${today().short}`), await statusOf(casey).innerText());
  check("the reason is shown word for word", (await casey.locator(".proposal-reason").innerText()) === `Reason: ${DECLINE_REASON}`);
  check("a declined proposal has no buttons left but Add comment", (await casey.getByRole("region", { name: "Actions" }).count()) === 0 && (await casey.getByRole("button", { name: "Add comment", exact: true }).isVisible()));
  check("a declined proposal says what it is compared with", await casey.getByText("Compared with the official text when it was proposed.").isVisible());
  await goToSection(casey, "People", "2.4 Training");
  check("declining leaves the official text unchanged", await casey.getByText("No official text yet.").isVisible());

  await startProposalFor(kale, "policies", "2.5 Policies and Expectations");
  await proposeText(kale, { title: POLICY_TITLE, text: [POLICY_TEXT] });
  await kale.getByRole("button", { name: "Withdraw" }).click();
  await kale.getByText("Withdraw this proposal? Nothing will change.").waitFor();
  await kale.getByRole("button", { name: "Keep it" }).click();
  check("Keep it leaves the proposal waiting", (await statusOf(kale).innerText()) === "Waiting for approval");
  await kale.getByRole("button", { name: "Withdraw" }).click();
  await kale.getByRole("button", { name: "Withdraw proposal" }).click();
  check("the proposal shows Withdrawn by Kale", await eventually(async () => (await statusOf(kale).innerText()) === `Withdrawn by Kale, ${today().short}`), await statusOf(kale).innerText());
  await goTo(kale, "Proposals");
  const closed = kale.getByRole("region", { name: "Declined or withdrawn" }).getByRole("listitem");
  check("both are listed under Declined or withdrawn, newest first", (await closed.count()) === 2 && (await closed.nth(0).getByText(`Withdrawn by Kale, ${today().short}`).isVisible()) && (await closed.nth(1).getByText(`Declined by Casey, ${today().short}`).isVisible()));
  check("the list shows kind, section and proposer", await closed.nth(1).getByText(`Decision · 2.4 Training · proposed by Kale, ${today().short}`).isVisible());
  const waitingRows = kale.getByRole("region", { name: /^Awaiting approval/ }).getByRole("listitem");
  check("the waiting list shows the longest-waiting proposal first, and who it waits for", (await waitingRows.count()) === 2 && (await waitingRows.nth(0).getByRole("link", { name: WEEKEND_TITLE }).isVisible()) && (await waitingRows.nth(0).getByText("Waiting for Casey").isVisible()));
  await shot(kale, "p3-desktop-10-proposals", { fullPage: true });

  // ------------------------------------------------------------------
  section("7. Two Owners edit the same official text");
  await goToSection(kale, "Hours and Daily Operations", "3.3 Closing Procedures");
  await kale.getByRole("button", { name: "Edit official" }).click();
  await kaleOfficial.waitFor();
  await kaleOfficial.click();
  await kale.keyboard.type(KALE_CLOSING);
  await goToSection(casey, "Hours and Daily Operations", "3.3 Closing Procedures");
  await casey.getByRole("button", { name: "Edit official" }).click();
  const caseyOfficial = casey.getByRole("textbox", { name: "Official text" });
  await caseyOfficial.waitFor();
  await caseyOfficial.click();
  await casey.keyboard.type(CASEY_CLOSING);
  await casey.getByRole("button", { name: "Save as official" }).click();
  await casey.locator(".approval").waitFor();
  await kale.getByRole("button", { name: "Save as official" }).click();
  const conflict = kale.locator(".notice.error");
  await conflict.waitFor();
  check("Kale's save is refused with a plain message", (await conflict.innerText()) === "Someone else changed this official text after you opened it. Your text is still here. Copy what you need, reload the page to see the new text, and make your change again.", await conflict.innerText());
  check("what Kale typed is still in the editor", (await kaleOfficial.innerText()).trim() === KALE_CLOSING);
  // He reloads, as the message says. The copy kept on his device was typed
  // before Casey's change, and the app must not let it replace her text unnoticed.
  await kale.reload();
  await kale.getByRole("heading", { level: 1, name: "3.3 Closing Procedures" }).waitFor();
  check("Casey's text is the official one", (await kale.locator(".official-box .rich").innerText()) === CASEY_CLOSING);
  await kale.getByRole("button", { name: "Continue editing" }).click();
  await kaleOfficial.waitFor();
  check("after reloading, Kale's unsaved text can still be picked up", (await kaleOfficial.innerText()).trim() === KALE_CLOSING);
  const outdated = kale.locator(".editor-outdated");
  const outdatedWords = await outdated.locator("p").innerText().catch(() => "missing");
  check("he is told it was typed before the official text was last changed", new RegExp(`^You typed this on ${DAY_TIME}, before the official text was last changed\\. It does not include that change\\.$`).test(outdatedWords) && (await kale.getByText("Picked up your unsaved changes").count()) === 0, outdatedWords);
  const officialNow = kale.locator(".editor-current");
  check("Casey's text is shown to him under The official text now", (await officialNow.getByRole("heading", { name: "The official text now" }).isVisible()) && (await officialNow.locator(".official-box .rich").innerText()) === CASEY_CLOSING && (await officialNow.getByText(`Approved by Casey, ${today().short}`).isVisible()));
  const sentUnchosen = await sentWhile(kale, () => kale.getByRole("button", { name: "Save as official" }).click());
  const chooseFirst = kale.getByRole("alert").filter({ hasText: "Choose first" });
  check("Save is refused in place until he chooses, and nothing is sent", sentUnchosen === 0 && (await chooseFirst.innerText().catch(() => "missing")) === CHOOSE_FIRST && (await kaleOfficial.innerText()).trim() === KALE_CLOSING, `${sentUnchosen} sent`);
  await kale.getByRole("button", { name: "Start over from the current text" }).click();
  check("Start over from the current text puts Casey's text in the editor and drops the copy", (await eventually(async () => (await kaleOfficial.innerText()).trim() === CASEY_CLOSING)) && (await outdated.count()) === 0 && (await chooseFirst.count()) === 0 && (await draftKeys(kale, "ppf:draft:official:")).length === 0, await kaleOfficial.innerText());
  await kale.getByRole("button", { name: "Cancel" }).click();
  await kale.getByRole("button", { name: "Edit official" }).waitFor();
  check("nothing was saved over her text", (await kale.locator(".official-box .rich").innerText()) === CASEY_CLOSING && (await kale.locator(".approval").innerText()) === `Approved by Casey, ${today().short}` && (await kale.getByRole("button", { name: "Continue editing" }).count()) === 0);

  // The same without any refusal: he types, leaves, and comes back after her next change.
  await kale.getByRole("button", { name: "Edit official" }).click();
  await kaleOfficial.waitFor();
  await kaleOfficial.click();
  await kale.keyboard.press("Control+End");
  await kale.keyboard.type(KALE_ADDED);
  await eventually(async () => (await draftKeys(kale, "ppf:draft:official:")).length === 1);
  await goTo(kale, "Today");
  await casey.getByRole("button", { name: "Edit official" }).click();
  await caseyOfficial.waitFor();
  await caseyOfficial.click();
  await casey.keyboard.press("Control+End");
  await casey.keyboard.type(CASEY_ADDED);
  await casey.getByRole("button", { name: "Save as official" }).click();
  await casey.locator(".official-box .rich").filter({ hasText: CASEY_ADDED.trim() }).waitFor();
  await goToSection(kale, "Hours and Daily Operations", "3.3 Closing Procedures");
  check("back on the section he sees her newer text and is offered his unsaved changes", (await kale.locator(".official-box .rich").innerText()) === CASEY_CLOSING + CASEY_ADDED && (await kale.getByText("You have unsaved changes to this text on this device.").isVisible()));
  await kale.getByRole("button", { name: "Continue editing" }).click();
  await kaleOfficial.waitFor();
  check("the copy he left behind is out of date too: he is told, and shown her text", (await outdated.isVisible()) && (await officialNow.locator(".official-box .rich").innerText()) === CASEY_CLOSING + CASEY_ADDED && (await kaleOfficial.innerText()).trim() === CASEY_CLOSING + KALE_ADDED, await kaleOfficial.innerText());
  await shot(kale, "p3-desktop-20-outdated-copy", { fullPage: true });
  const sentAgain = await sentWhile(kale, () => kale.getByRole("button", { name: "Save as official" }).click());
  check("again Save waits for his choice", sentAgain === 0 && (await chooseFirst.isVisible()));
  await kale.getByRole("button", { name: "Keep what I typed" }).click();
  check("Keep what I typed takes the warning away and keeps his text in the editor", (await eventually(async () => (await outdated.count()) === 0)) && (await chooseFirst.count()) === 0 && (await kale.getByText(/^Picked up your unsaved changes from /).isVisible()) && (await kaleOfficial.innerText()).trim() === CASEY_CLOSING + KALE_ADDED);
  await kale.getByRole("button", { name: "Save as official" }).click();
  await kale.getByRole("button", { name: "Edit official" }).waitFor();
  check("once he has chosen, Save goes through", (await eventually(async () => (await kale.locator(".official-box .rich").innerText()) === CASEY_CLOSING + KALE_ADDED)) && (await kale.locator(".approval").innerText()) === approvedKale() && (await draftKeys(kale, "ppf:draft:official:")).length === 0, await kale.locator(".official-box .rich").innerText());
  await goTo(casey, "Today");
  const closingFlag = flagged.getByRole("listitem").filter({ hasText: "Edited directly: 3.3 Closing Procedures (version 3)" });
  check("Casey sees his change flagged on Today", (await eventually(() => closingFlag.isVisible())) && (await closingFlag.getByText(`Decided by Kale alone, ${today().short}`).isVisible()));

  // ------------------------------------------------------------------
  section("17. A proposal goes out of date when the official text changes");
  await startProposalFor(casey, "point of sale", "6.1 Point of Sale");
  const posUrl = await proposeText(casey, { title: POS_TITLE, text: [POS_TEXT] });
  await goToSection(kale, "Equipment and Technology", "6.1 Point of Sale");
  const posNotice = kale.locator(".official-notices .notice");
  check("the section says a proposal is waiting, and for whom", (await posNotice.innerText()) === `Waiting for approval: ${POS_TITLE}. Waiting for you.`, await posNotice.innerText().catch(() => "missing"));
  await kale.getByRole("button", { name: "Edit official" }).click();
  await kaleOfficial.waitFor();
  await kaleOfficial.click();
  await kale.keyboard.type(POS_DIRECT);
  await kale.getByRole("button", { name: "Save as official" }).click();
  await kale.locator(".approval").waitFor();
  check("after a direct save, the section says the waiting proposal has to be checked first", (await posNotice.innerText()) === `Waiting for approval: ${POS_TITLE}. Waiting for Casey to check it against the new official text.`, await posNotice.innerText().catch(() => "missing"));
  await kale.goto(posUrl);
  await kale.getByRole("heading", { level: 1, name: POS_TITLE }).waitFor();
  const staleNotice = (page) => page.locator(".notice").filter({ hasText: "The official text of this section has changed since" });
  check("the other Owner is told the proposal is out of date and who has to act", (await staleNotice(kale).innerText().catch(() => "missing")) === "The official text of this section has changed since Casey proposed this. Casey needs to check the proposal against the new text and save it again before it can be approved.", await staleNotice(kale).innerText().catch(() => "missing"));
  check("an out-of-date proposal has no Approve for the other Owner; Decline and Endorse stay", (await approveButton(kale).count()) === 0 && (await kale.getByRole("button", { name: "Approve on my own" }).count()) === 0 && (await kale.getByRole("button", { name: "Decline" }).isVisible()) && (await kale.getByRole("button", { name: "Endorse" }).isVisible()));
  check("its Approvals list says what it is waiting for", await kale.getByRole("region", { name: "Approvals" }).getByText("Waiting for Casey to check it against the new official text", { exact: true }).isVisible());
  check("the notice stands above the differences", await kale.evaluate(() => [...document.querySelectorAll(".notice")].find((el) => el.textContent.includes("has changed since")).getBoundingClientRect().bottom <= document.querySelector(".diff-box").getBoundingClientRect().top));
  await shot(kale, "p3-desktop-21-outdated-proposal", { fullPage: true });
  await goTo(kale, "Today");
  const awaitingRow = (page, title) => page.getByRole("region", { name: /^Awaiting approval/ }).getByRole("listitem").filter({ hasText: title });
  check("Kale's Today says it is waiting for Casey to check it", await awaitingRow(kale, POS_TITLE).getByText("Waiting for Casey to check it against the new official text", { exact: true }).isVisible());
  await goTo(casey, "Today");
  check("Casey's Today says it is waiting for her to check it", await awaitingRow(casey, POS_TITLE).getByText("Waiting for you to check it against the new official text", { exact: true }).isVisible());
  await awaitingRow(casey, POS_TITLE).getByRole("link", { name: POS_TITLE }).click();
  await casey.getByRole("heading", { level: 1, name: POS_TITLE }).waitFor();
  const ownNotice = casey.locator(".notice-action");
  check("the proposer is told to check it and save it again", (await ownNotice.locator("p").innerText().catch(() => "missing")) === "The official text of this section has changed since you proposed this. Check your proposal against the new text and save it again. Until then it cannot be approved." && (await approveButton(casey).count()) === 0, await ownNotice.locator("p").innerText().catch(() => "missing"));
  await ownNotice.getByRole("link", { name: "Check and save again" }).click();
  await casey.getByRole("heading", { level: 1, name: "Edit proposal" }).waitFor();
  const checkForm = casey.getByRole("form", { name: "Edit proposal" });
  const officialNowBox = checkForm.locator(".official-now");
  check("the edit page says the official text changed, and shows it for reading", (await officialNowBox.locator(".notice").innerText()) === "The official text changed after you wrote this. Read it here, change your proposed text if it should include that change, then press Save changes." && (await officialNowBox.getByText("The official text now", { exact: true }).isVisible()) && (await officialNowBox.locator(".official-box .rich").innerText()) === POS_DIRECT, await officialNowBox.innerText().catch(() => "missing"));
  const checkBox = checkForm.getByRole("textbox", { name: "Proposed official text" });
  await checkBox.waitFor();
  check("the official text now stands above her proposed text, which is unchanged", (await checkBox.innerText()).trim() === POS_TEXT && (await casey.evaluate(() => document.querySelector(".official-now").getBoundingClientRect().bottom <= document.querySelector(".proposal-form .editor").getBoundingClientRect().top)));
  await shot(casey, "p3-desktop-22-check-proposal", { fullPage: true });
  await checkForm.getByRole("button", { name: "Save changes" }).click();
  await casey.getByRole("heading", { level: 1, name: POS_TITLE }).waitFor();
  const checkedNote = casey.getByRole("status").filter({ hasText: "Checked against" });
  check("after saving it again, her page says it was checked and can be approved", (await eventually(() => checkedNote.isVisible())) && (await checkedNote.innerText()) === "Checked against the new official text. It can be approved now." && (await staleNotice(casey).count()) === 0 && (await ownNotice.count()) === 0);
  check("it waits for Kale again", await casey.getByRole("region", { name: "Approvals" }).getByText("Waiting for Kale", { exact: true }).isVisible());
  await kale.goto(posUrl);
  await kale.getByRole("heading", { level: 1, name: POS_TITLE }).waitFor();
  check("Kale now has Approve, and no out-of-date notice", (await approveButton(kale).isVisible()) && (await staleNotice(kale).count()) === 0);
  await approveButton(kale).click();
  check("approved by both, it reads Approved by Casey and Kale", await eventually(async () => (await statusOf(kale).innerText()) === `Approved by Casey and Kale, ${today().short}`), await statusOf(kale).innerText());
  await goToSection(kale, "Equipment and Technology", "6.1 Point of Sale");
  check("the section shows the proposed text, approved by both", (await kale.locator(".official-box .rich").innerText()) === POS_TEXT && (await kale.locator(".approval").innerText()) === `Approved by Casey and Kale, ${today().short}`);

  // ------------------------------------------------------------------
  section("8. Proposals about sections");
  await goTo(kale, "Proposals");
  await kale.getByRole("link", { name: "New proposal" }).click();
  await kale.getByRole("heading", { level: 1, name: "New proposal" }).waitFor();
  const structureForm = newForm(kale);
  await structureForm.getByRole("radio", { name: "Structure" }).check();
  check("Structure offers add, rename, move and archive", (await structureForm.getByRole("group", { name: "What do you want to change?" }).getByRole("radio").count()) === 4 && (await structureForm.getByRole("radio", { name: "Add a section" }).isChecked()));
  await structureForm.getByLabel("Under").selectOption({ label: "4 Departments" });
  await structureForm.getByLabel("Name", { exact: true }).fill("Greenhouse");
  const sentByName = await sentWhile(kale, () => structureForm.getByLabel("Name", { exact: true }).press("Enter"));
  check("Return in the Name box does not send the proposal either", sentByName === 0 && (await kale.getByRole("heading", { level: 1, name: "New proposal" }).isVisible()) && (await structureForm.getByLabel("Name", { exact: true }).inputValue()) === "Greenhouse", `${sentByName} sent`);
  await structureForm.getByLabel("Why (optional)").fill("The greenhouse needs its own page.");
  await shot(kale, "p3-desktop-11-new-section-proposal", { fullPage: true });
  await structureForm.getByRole("button", { name: "Propose", exact: true }).click();
  const greenhouseTitle = 'Add a section "Greenhouse" under 4 Departments';
  await kale.getByRole("heading", { level: 1, name: greenhouseTitle }).waitFor();
  const greenhouseUrl = kale.url();
  check("a section proposal writes its own title and says what will change", (await kale.getByRole("region", { name: "What will change" }).getByText(`${greenhouseTitle}.`).isVisible()) && (await kale.locator(".proposal .page-head .meta").innerText()).startsWith("Structure · 4 Departments · Proposed by Kale"));
  check("nothing is added before approval", (await navOf(kale).getByRole("link", { name: /Greenhouse/ }).count()) === 0);
  await casey.goto(greenhouseUrl);
  await casey.getByRole("heading", { level: 1, name: greenhouseTitle }).waitFor();
  await approveButton(casey).click();
  const newSectionLink = casey.getByRole("main").getByRole("link", { name: "4.8 Greenhouse" });
  check("the approved proposal links to the new section", (await eventually(() => newSectionLink.isVisible())) && (await casey.getByRole("status").filter({ hasText: "Approved. It is official now." }).isVisible()));
  await navOf(casey).getByRole("button", { name: "Show subsections of Departments" }).click();
  check("the new section appears in the sidebar with its number", await navOf(casey).getByRole("link", { name: "4.8 Greenhouse" }).isVisible());
  await newSectionLink.click();
  check("the link opens the new section", (await eventually(() => casey.getByRole("heading", { level: 1, name: "4.8 Greenhouse" }).isVisible())) && /\/sections\/[0-9a-f-]{36}$/.test(casey.url()), casey.url());

  // A move. "Move it under" only ever shows what will be sent.
  await goTo(kale, "Proposals");
  await kale.getByRole("link", { name: "New proposal" }).click();
  await kale.getByRole("heading", { level: 1, name: "New proposal" }).waitFor();
  await structureForm.getByRole("radio", { name: "Structure" }).check();
  await structureForm.getByRole("radio", { name: "Move a section" }).check();
  const moveSection = structureForm.getByLabel("Section", { exact: true });
  const moveUnder = structureForm.getByLabel("Move it under");
  await moveUnder.selectOption({ label: "9 Marketing and Events" });
  await moveSection.selectOption({ label: "9 Marketing and Events" });
  check("a section is not offered as the place to move itself under, and the box goes back to Top level", (await moveUnder.inputValue()) === "" && (await moveUnder.locator("option").filter({ hasText: "9 Marketing and Events" }).count()) === 0 && (await moveUnder.locator("option:checked").innerText()) === "Top level", await moveUnder.locator("option:checked").innerText());
  await moveSection.selectOption({ label: "4.8 Greenhouse" });
  await structureForm.getByRole("button", { name: "Propose", exact: true }).click();
  await kale.getByRole("heading", { level: 1, name: "Move 4.8 Greenhouse to the top level" }).waitFor();
  const moveUrl = kale.url();
  check("what the box showed is what was sent: a move to the top level", (await kale.getByRole("region", { name: "What will change" }).getByText("Move 4.8 Greenhouse to the top level.").isVisible()) && /\/proposals\/[0-9a-f-]{36}$/.test(moveUrl));
  // Its proposer changes where it should go, before anyone has approved it.
  await editLink(kale).click();
  await kale.getByRole("heading", { level: 1, name: "Edit proposal" }).waitFor();
  const moveEdit = kale.getByRole("form", { name: "Edit proposal" });
  check("editing a section proposal shows its kind, what it does and its section as fixed words", (await moveEdit.getByText("Structure", { exact: true }).isVisible()) && (await moveEdit.getByText("Move a section", { exact: true }).isVisible()) && (await moveEdit.getByText("4.8 Greenhouse", { exact: true }).isVisible()) && (await moveEdit.getByRole("radio").count()) === 0 && (await moveEdit.getByLabel("Move it under").inputValue()) === "");
  await moveEdit.getByLabel("Move it under").selectOption({ label: "5 Facility and Buildout" });
  await moveEdit.getByRole("button", { name: "Save changes" }).click();
  await kale.getByRole("heading", { level: 1, name: "Move 4.8 Greenhouse under 5 Facility and Buildout" }).waitFor();
  check("after Save changes the section proposal says the new place and that it was changed", kale.url() === moveUrl && (await kale.getByText("changed after it was proposed").isVisible()) && (await statusOf(kale).innerText()) === "Waiting for approval");
  await casey.goto(moveUrl);
  await casey.getByRole("heading", { level: 1, name: "Move 4.8 Greenhouse under 5 Facility and Buildout" }).waitFor();
  await approveButton(casey).click();
  check("the move is approved by both", await eventually(async () => (await statusOf(casey).innerText()) === approvedBoth()), await statusOf(casey).innerText());
  await navOf(casey).getByRole("button", { name: "Show subsections of Facility and Buildout" }).click();
  check("the section has moved in the sidebar, and the proposal keeps the sentence it was approved under", (await navOf(casey).getByRole("link", { name: "5.4 Greenhouse" }).isVisible()) && (await navOf(casey).getByRole("link", { name: "4.8 Greenhouse" }).count()) === 0 && (await casey.getByRole("heading", { level: 1, name: "Move 4.8 Greenhouse under 5 Facility and Buildout" }).isVisible()));

  await goTo(kale, "Proposals");
  await kale.getByRole("link", { name: "New proposal" }).click();
  await kale.getByRole("heading", { level: 1, name: "New proposal" }).waitFor();
  await structureForm.getByRole("radio", { name: "Structure" }).check();
  await structureForm.getByRole("radio", { name: "Rename a section" }).check();
  await structureForm.getByLabel("Section", { exact: true }).selectOption({ label: "5.2 Signage" });
  await structureForm.getByRole("button", { name: "Propose", exact: true }).click();
  await structureForm.getByRole("alert").waitFor();
  check("a refusal shows in the form and keeps what was chosen", (await structureForm.getByRole("alert").innerText()) === "Enter a name for the section." && (await structureForm.getByLabel("Section", { exact: true }).inputValue()) !== "" && (await structureForm.getByRole("radio", { name: "Rename a section" }).isChecked()));
  await structureForm.getByLabel("New name").fill("Signs");
  await structureForm.getByRole("button", { name: "Propose", exact: true }).click();
  await kale.getByRole("heading", { level: 1, name: 'Rename 5.2 Signage to "Signs"' }).waitFor();
  await kale.getByRole("button", { name: "Approve on my own" }).click();
  await kale.getByRole("button", { name: "Approve on my own" }).click();
  check("a rename approved on Kale's own is approved", await eventually(async () => (await statusOf(kale).innerText()) === approvedKale()), await statusOf(kale).innerText());
  await navOf(kale).getByRole("button", { name: "Show subsections of Facility and Buildout" }).click();
  check("the section is renamed in the sidebar", (await navOf(kale).getByRole("link", { name: "5.2 Signs" }).isVisible()) && (await navOf(kale).getByRole("link", { name: "5.2 Signage" }).count()) === 0);

  // ------------------------------------------------------------------
  section("10. Version history: an earlier version, the differences, restoring");
  await goToSection(kale, "Hours and Daily Operations", "3.1 Store Hours");
  check("Store Hours shows its current text", (await kale.locator(".official-box .rich p").allInnerTexts()).join("|") === HOURS_V2.join("|"));
  await kale.getByRole("link", { name: "Version history" }).click();
  await kale.getByRole("heading", { level: 1, name: "Version history" }).waitFor();
  const hoursVersions = kale.locator(".version-list > li");
  const then = shortDate(daysAgo(60));
  const later = shortDate(daysAgo(20));
  check("version history lists every version, newest first", (await hoursVersions.count()) === 2 && (await hoursVersions.nth(0).getByRole("heading", { name: "Version 2 (current)" }).isVisible()) && (await hoursVersions.nth(1).getByRole("heading", { name: "Version 1", exact: true }).isVisible()));
  check("each version says when it was official", (await hoursVersions.nth(0).getByText(`Official from ${later} to now`).isVisible()) && (await hoursVersions.nth(1).getByText(`Official from ${then} to ${later}`).isVisible()), await hoursVersions.nth(1).innerText());
  check("each version says who approved it and where it came from", (await hoursVersions.nth(0).getByText(`Approved by Casey, ${later}`).isVisible()) && (await hoursVersions.nth(0).getByText("Edited directly by Casey").isVisible()) && (await hoursVersions.nth(1).getByText(`Approved by Kale, ${then}`).isVisible()));
  await kale.getByRole("link", { name: "Show version 1" }).click();
  await hoursVersions.nth(1).locator(".version-open .rich").waitFor();
  check("an earlier version shows what the official text said then", (await hoursVersions.nth(1).locator(".version-open .rich p").allInnerTexts()).join("|") === HOURS_V1.join("|"));
  check("the first version has no difference section", (await hoursVersions.nth(1).getByText(/^What changed from/).count()) === 0);
  await kale.getByRole("link", { name: "Show version 2" }).click();
  await hoursVersions.nth(0).getByRole("heading", { name: "What changed from version 1" }).waitFor();
  const hoursDiff = hoursVersions.nth(0).locator(".diff");
  check("the difference to the version before is shown", (await hoursDiff.locator("del").allInnerTexts()).join("|") === "6|Closed" && (await hoursDiff.locator("ins").first().innerText()) === "7" && (await hoursDiff.innerText()).replace(/\s+/g, " ") === "Open 9 AM to 67 PM, Monday to Saturday. ClosedOpen 11 AM to 4 PM Sunday.", (await hoursDiff.locator("del").allInnerTexts()).join("|") + " / " + (await hoursDiff.locator("ins").allInnerTexts()).join("|"));
  check("the current version has no Restore", (await kale.getByRole("button", { name: /^Restore/ }).count()) === 0);
  await shot(kale, "p3-desktop-12-version-history", { fullPage: true });
  await kale.getByRole("link", { name: "Hide version 2" }).click();
  await kale.getByRole("link", { name: "Show version 2" }).waitFor();
  check("Hide closes the version", (await kale.locator(".version-open").count()) === 0);
  await kale.getByRole("link", { name: "Show version 1" }).click();
  await kale.getByRole("button", { name: "Restore this version (version 1)" }).click();
  await kale.getByText("Make version 1 the official text again? This adds a new version approved by you alone. Nothing is erased.").waitFor();
  await kale.getByRole("button", { name: "Cancel" }).click();
  check("Cancel leaves the versions as they were", (await hoursVersions.count()) === 2);
  await kale.getByRole("button", { name: "Restore this version (version 1)" }).click();
  await kale.getByRole("button", { name: "Restore", exact: true }).click();
  await kale.getByRole("heading", { name: "Version 3 (current)" }).waitFor();
  check("restoring adds a new version that says where it came from", (await hoursVersions.count()) === 3 && (await hoursVersions.nth(0).getByText("Restored from version 1 by Kale").isVisible()) && (await hoursVersions.nth(0).getByText(approvedKale()).isVisible()));
  check("the restored version's own text now has no Restore", (await kale.getByRole("button", { name: /^Restore/ }).count()) === 0);
  check("where the button was, the restored version says its words are the current ones", (await hoursVersions.nth(2).locator(".version-same").innerText().catch(() => "missing")) === "These are the same words as the current version (version 3)." && (await hoursVersions.nth(0).locator(".version-same").count()) === 0, await hoursVersions.nth(2).locator(".version-same").innerText().catch(() => "missing"));
  await kale.getByRole("link", { name: "3.1 Store Hours" }).first().click();
  await kale.getByRole("heading", { level: 1, name: "3.1 Store Hours" }).waitFor();
  check("the section shows the old text again, approved by Kale", (await kale.locator(".official-box .rich p").allInnerTexts()).join("|") === HOURS_V1.join("|") && (await kale.locator(".approval").innerText()) === approvedKale());

  await goToSection(karen, "Hours and Daily Operations", "3.1 Store Hours");
  await karen.getByRole("link", { name: "Version history" }).click();
  await karen.getByRole("heading", { level: 1, name: "Version history" }).waitFor();
  await karen.getByRole("link", { name: "Show version 2" }).click();
  await karen.locator(".version-open .rich").waitFor();
  check("an Advisor can read past versions", (await karen.locator(".version-open .rich p").allInnerTexts()).join("|") === HOURS_V2.join("|"));
  check("an Advisor has no Restore or other Owner control in version history", (await ownerControls(karen)) === 0);

  // ------------------------------------------------------------------
  section("11. Decisions Log filters");
  await goTo(kale, "Proposals");
  await kale.getByRole("link", { name: "Decisions Log" }).click();
  await kale.getByRole("heading", { level: 1, name: "Decisions Log" }).waitFor();
  const titles = async () => (await kale.getByRole("list", { name: "Decisions" }).locator(".title").allInnerTexts()).join("|");
  const everything = await titles();
  const allCount = await decisions(kale).count();
  // Today: wages, discount, opening, hiring, closing (three saves), point of sale (a direct
  // save and a proposal), greenhouse (added, moved), rename, restore. Seeded: three.
  check("the log lists every approved decision, newest first", allCount === 16 && everything.startsWith("Restored version 1: 3.1 Store Hours (as version 3)|Rename 5.2 Signage to \"Signs\"|Move 4.8 Greenhouse under 5 Facility and Buildout|"), `${allCount}: ${everything}`);
  check("three direct saves of one section are told apart by their version", ["Edited directly: 3.3 Closing Procedures (version 3)", "Edited directly: 3.3 Closing Procedures (version 2)", "Edited directly: 3.3 Closing Procedures (version 1)"].every((title) => everything.split("|").filter((item) => item === title).length === 1), everything);
  await shot(kale, "p3-desktop-13-decisions-log", { fullPage: true });
  await kale.getByText("Filters", { exact: true }).click();
  const filterForm = kale.locator("details.filters-plain");
  await filterForm.getByLabel("Section").selectOption({ label: "2 People" });
  await filterForm.getByRole("button", { name: "Apply" }).click();
  await kale.waitForURL(/section=/);
  check("filtering by a section includes its subsections and leaves out the rest", (await eventually(async () => (await titles()) === [HIRING_TITLE, DISCOUNT_TITLE, WAGES_TITLE, "Edited directly: 2.1 Wages (version 1)"].join("|"))), await titles());
  check("the filters stay open while in use", (await kale.locator("details.filters-plain[open]").count()) === 1 && (await kale.getByText("Filters (in use)").isVisible()));
  await kale.getByRole("link", { name: "Clear" }).click();
  await kale.waitForURL(`${BASE_URL}/proposals/decisions`);
  check("Clear brings everything back", await eventually(async () => (await titles()) === everything), await titles());
  await kale.getByText("Filters", { exact: true }).click();
  await filterForm.getByLabel("Approved by").selectOption({ label: "Casey" });
  await filterForm.getByRole("button", { name: "Apply" }).click();
  await kale.waitForURL(/approver=/);
  check("filtering by approver shows only what Casey approved", await eventually(async () => (await titles()) === ["Move 4.8 Greenhouse under 5 Facility and Buildout", 'Add a section "Greenhouse" under 4 Departments', POS_TITLE, "Edited directly: 3.3 Closing Procedures (version 2)", "Edited directly: 3.3 Closing Procedures (version 1)", HIRING_TITLE, DISCOUNT_TITLE, WAGES_TITLE, "Edited directly: 3.1 Store Hours (version 2)"].join("|")), await titles());
  await filterForm.getByLabel("Approved by").selectOption({ label: "Anyone" });
  await filterForm.getByLabel("From").fill(dateKey(daysAgo(61)));
  await filterForm.getByLabel("To", { exact: true }).fill(dateKey(daysAgo(15)));
  await filterForm.getByRole("button", { name: "Apply" }).click();
  await kale.waitForURL(/from=/);
  check("filtering by dates shows only decisions from those days", await eventually(async () => (await titles()) === ["Edited directly: 3.1 Store Hours (version 2)", "Edited directly: 2.1 Wages (version 1)", "Edited directly: 3.1 Store Hours (version 1)"].join("|")), await titles());
  await filterForm.getByLabel("From").fill("2020-01-01");
  await filterForm.getByLabel("To", { exact: true }).fill("2020-01-31");
  await filterForm.getByRole("button", { name: "Apply" }).click();
  check("filters with no match say so", (await eventually(() => kale.getByText("No decisions match these filters.").isVisible())) && (await decisions(kale).count()) === 0);
  await kale.getByRole("link", { name: "Clear" }).click();
  check("Clear brings everything back again", await eventually(async () => (await titles()) === everything), await titles());
  await kale.getByText("Filters", { exact: true }).click();
  await filterForm.getByLabel("Business").selectOption({ label: "Coffee Shop" });
  await filterForm.getByRole("button", { name: "Apply" }).click();
  await kale.waitForURL(/business=coffee_shop/);
  check("filtering by business shows only decisions tagged for it", await eventually(async () => (await titles()) === WAGES_TITLE), await titles());
  await filterForm.getByLabel("Business").selectOption({ label: "Garden Center" });
  await filterForm.getByRole("button", { name: "Apply" }).click();
  await kale.waitForURL(/business=garden_center/);
  check("a business with no decision yet shows none", (await eventually(() => kale.getByText("No decisions match these filters.").isVisible())) && (await decisions(kale).count()) === 0);
  await kale.getByRole("link", { name: "Clear" }).click();
  await kale.waitForURL(`${BASE_URL}/proposals/decisions`);

  // ------------------------------------------------------------------
  section("12. Search finds proposals");
  await navOf(kale).getByRole("searchbox", { name: "Search" }).fill("starting wage");
  await kale.keyboard.press("Enter");
  await kale.getByRole("heading", { level: 1, name: "Search" }).waitFor();
  const proposalHits = kale.getByRole("region", { name: "Proposals" });
  check("search finds a proposal by words from its title", await proposalHits.getByRole("link", { name: WAGES_TITLE }).isVisible());
  check("the result shows its status, proposer and date", await proposalHits.getByRole("listitem").filter({ hasText: WAGES_TITLE }).getByText(`Approved · proposed by Kale, ${today().short}`).isVisible());
  check("the matched words are marked", (await proposalHits.getByRole("listitem").filter({ hasText: WAGES_TITLE }).locator("mark").count()) >= 2);
  await kale.getByRole("searchbox", { name: "Search for" }).fill("fargo fifteen");
  await kale.keyboard.press("Enter");
  await kale.waitForURL(/q=fargo/);
  const whyHit = proposalHits.getByRole("link", { name: WAGES_TITLE });
  await whyHit.waitFor();
  check("search finds a proposal by words from its Why", (await proposalHits.getByRole("listitem").count()) === 1 && (await proposalHits.locator(".excerpt").innerText()).includes("Other coffee shops in Fargo start at fifteen."));
  await shot(kale, "p3-desktop-14-search");
  await whyHit.click();
  await kale.getByRole("heading", { level: 1, name: WAGES_TITLE }).waitFor();
  check("the search result opens the proposal", kale.url() === wagesUrl);
  // A comment on a proposal is found too, and its link goes to the proposal (not to a Daily Log day).
  await navOf(kale).getByRole("searchbox", { name: "Search" }).fill("sixteen fair budget");
  await kale.keyboard.press("Enter");
  await kale.waitForURL(/q=sixteen/);
  const commentHit = kale.getByRole("region", { name: "Comments" }).getByRole("listitem");
  await commentHit.first().waitFor();
  const commentLink = commentHit.getByRole("link", { name: new RegExp(`^Comment by Karen, ${DATE_TIME}$`) });
  check("search finds a comment on a proposal and says it is on a proposal", (await commentHit.count()) === 1 && (await commentLink.isVisible()) && (await commentHit.getByText("(on a proposal)").isVisible()) && (await commentHit.locator(".excerpt").innerText()).includes("sixteen is fair for the registers"), await commentHit.first().innerText());
  check("its link is the proposal's address", `${BASE_URL}${await commentLink.getAttribute("href")}` === registersUrl, await commentLink.getAttribute("href"));
  await commentLink.click();
  await kale.getByRole("heading", { level: 1, name: REGISTERS_TITLE }).waitFor();
  check("the comment result opens the proposal it is on", kale.url() === registersUrl && (await kale.getByRole("list", { name: "Comments on this proposal" }).getByText("Karen here").isVisible()));

  // ------------------------------------------------------------------
  section("13. Settings: the activity log");
  await navOf(kale).getByRole("link", { name: "Settings" }).click();
  await kale.getByRole("heading", { level: 1, name: "Settings" }).waitFor();
  await kale.getByRole("link", { name: "See every change, who made it and when" }).click();
  await kale.getByRole("heading", { level: 1, name: "Activity log" }).waitFor();
  check("the activity log opens as its own page with Back", (await kale.getByRole("link", { name: "Back" }).isVisible()) && (await kale.getByRole("navigation", { name: "Main" }).count()) === 0);
  const activity = kale.getByRole("list", { name: "Activity" }).getByRole("listitem");
  const firstPage = await activity.allInnerTexts();
  const row = (who, sentence) => new RegExp(`^${DATE_TIME} · ${who}\\n+${escapeRe(sentence)}$`);
  const seen = [...firstPage];
  check("the newest change is on top, with who and when", row("Kale", 'Approved by Kale: Rename 5.2 Signage to "Signs"').test(firstPage.find((line) => line.includes("Approved by Kale: Rename")) ?? "") && firstPage.findIndex((line) => line.includes("Restored version 1")) === 0, firstPage[0]);
  check("the first page holds one page of rows", firstPage.length === ACTIVITY_PAGE, `${firstPage.length} of ${ACTIVITY_PAGE}`);
  check("the first page has Older and no Newest", (await kale.getByRole("link", { name: "Older" }).isVisible()) && (await kale.getByRole("link", { name: "Newest" }).count()) === 0);
  await shot(kale, "p3-desktop-15-activity-log");
  await kale.getByRole("link", { name: "Older" }).click();
  await kale.waitForURL(/before=\d+/);
  await kale.getByRole("link", { name: "Newest" }).waitFor();
  const secondPage = await activity.allInnerTexts();
  seen.push(...secondPage);
  check("Older shows the rows before those", secondPage.length > 0 && secondPage[0] !== firstPage[0] && !secondPage.some((line) => line.includes("Restored version 1")));
  // Keep turning pages to the very first change.
  for (let pages = 0; pages < 20 && (await kale.getByRole("link", { name: "Older" }).count()) > 0; pages += 1) {
    const address = kale.url();
    await kale.getByRole("link", { name: "Older" }).click();
    await kale.waitForURL((url) => url.href !== address);
    await activity.first().waitFor();
    seen.push(...(await activity.allInnerTexts()));
  }
  check("the last page has no Older", (await kale.getByRole("link", { name: "Older" }).count()) === 0 && (await kale.getByRole("link", { name: "Newest" }).isVisible()));
  const has = (who, sentence) => seen.some((line) => row(who, sentence).test(line));
  check("the log names Kale for his proposal", has("Kale", `Proposed: ${WAGES_TITLE}`));
  check("the log names Casey for the approval that made it official", has("Casey", `Approved by Kale and Casey: ${WAGES_TITLE}`));
  check("the log names Karen for her endorsement and her comment", has("Karen", `Endorsed: ${REGISTERS_TITLE}`) && has("Karen", `Commented on the proposal: ${REGISTERS_TITLE}`));
  check("the log has the decline, the withdrawal and the change to a proposal", has("Casey", `Declined: ${TRAINING_TITLE}`) && has("Kale", `Withdrew their proposal: ${POLICY_TITLE}`) && has("Kale", `Changed their proposal: ${HIRING_TITLE}`));
  check("the log says when a proposer checked a proposal against new official text", has("Casey", `Checked their proposal against the new official text: ${POS_TITLE}`));
  check("the log has I approve too and the restore", has("Casey", `Added their approval: ${DISCOUNT_TITLE}`) && has("Kale", 'Restored version 1 of the official text for "Store Hours" as version 3, approved by Kale'));
  await kale.getByRole("link", { name: "Newest" }).click();
  await kale.waitForURL(`${BASE_URL}/settings/activity`);
  await kale.getByRole("link", { name: "Back" }).click();
  await kale.getByRole("heading", { level: 1, name: "Settings" }).waitFor();
  check("Back returns to Settings", kale.url().startsWith(`${BASE_URL}/settings`) && !kale.url().includes("activity"));
  await karen.goto(`${BASE_URL}/settings/activity`);
  await karen.getByRole("heading", { level: 1, name: "Today" }).waitFor();
  check("an Advisor opening the activity log is sent back to Today", karen.url() === `${BASE_URL}/`);

  // ------------------------------------------------------------------
  section("16. One-person changes stay flagged, and a warning before approving on top of them");
  await kale.getByRole("link", { name: "Back" }).click();
  await kale.getByRole("heading", { level: 1, name: "Today" }).waitFor();
  await goToSection(kale, "People", "2.2 Benefits");
  // Kale saves "Edit official" on Benefits twice in a row. Casey approved the text before these.
  for (const added of BENEFITS_ADDED) {
    await kale.getByRole("button", { name: "Edit official" }).click();
    await kaleOfficial.waitFor();
    await kaleOfficial.click();
    await kale.keyboard.press("Control+End");
    await kale.keyboard.type(added);
    await kale.getByRole("button", { name: "Save as official" }).click();
    await kale.locator(".official-box .rich").filter({ hasText: added.trim() }).waitFor();
  }
  check("after two direct saves the section shows the newest text, approved by Kale", (await kale.locator(".official-box .rich").innerText()) === BENEFITS_NOW && (await kale.locator(".approval").innerText()) === approvedKale(), await kale.locator(".official-box .rich").innerText());

  await goTo(casey, "Today");
  // Two saves of one section are one row: the newest, with the earlier one in a line under it.
  const BENEFITS_V3 = "Edited directly: 2.2 Benefits (version 3)";
  const BENEFITS_V2 = "Edited directly: 2.2 Benefits (version 2)";
  const benefitRows = flagged.getByRole("listitem").filter({ hasText: "Edited directly: 2.2 Benefits" });
  const earlierLine = benefitRows.locator(".earlier-changes");
  await eventually(async () => (await benefitRows.count()) === 1 && (await earlierLine.count()) === 1);
  check("Casey's Today shows Kale's two direct saves of one section as one row, named by the newest", (await benefitRows.count()) === 1 && (await benefitRows.getByRole("link", { name: BENEFITS_V3, exact: true }).isVisible()) && (await benefitRows.getByText(`Decided by Kale alone, ${today().short}`).isVisible()) && (await benefitRows.getByText("No longer the current text").count()) === 0, `${await benefitRows.count()} rows`);
  check("the earlier save is in one line under it, by its version and day, with a link", (await earlierLine.innerText().catch(() => "missing")) === `Earlier one-person changes to this section: version 2 (${today().day})` && (await earlierLine.getByRole("link", { name: `version 2 (${today().day})`, exact: true }).isVisible()), await earlierLine.innerText().catch(() => "missing"));
  // Nine changes: Opening Procedures, Closing Procedures three times (two of them her own,
  // which Kale has not approved), Point of Sale, the rename, the restore, and Benefits twice.
  // Six rows: the saves of Closing Procedures are one row, and so are those of Benefits.
  const flaggedRows = await flagged.getByRole("listitem").count();
  check("the number in the heading counts every change, not every row", (await casey.getByRole("heading", { level: 2, name: "Decided by one person (9)" }).isVisible()) && flaggedRows === 6, `${flaggedRows} rows under "${await flagged.getByRole("heading", { level: 2 }).innerText()}"`);
  const closingRow = flagged.getByRole("listitem").filter({ hasText: "Edited directly: 3.3 Closing Procedures (version 3)" });
  check("her own earlier saves are listed under Kale's newer one, and she has no I approve too on her own", (await closingRow.locator(".earlier-changes").innerText()) === `Earlier one-person changes to this section: version 2 (${today().day}), version 1 (${today().day})` && (await closingRow.getByRole("button", { name: /^I approve too/ }).count()) === 1, await closingRow.locator(".earlier-changes").innerText().catch(() => "missing"));
  check("she has I approve too for the newest one", await benefitRows.getByRole("button", { name: `I approve too: ${BENEFITS_V3}`, exact: true }).isVisible());
  await shot(casey, "p3-desktop-16-today-two-changes", { fullPage: true });
  await benefitRows.getByRole("link", { name: BENEFITS_V3, exact: true }).click();
  await casey.getByRole("heading", { level: 1, name: BENEFITS_V3, exact: true }).waitFor();
  check("the newer one's page does not say it was replaced", (await casey.locator(".proposal-superseded").count()) === 0 && (await casey.locator(".diff ins").innerText()).trim() === BENEFITS_ADDED[1].trim(), await casey.locator(".diff ins").innerText());
  check("an added sentence is underlined without the space before it", (await casey.locator(".diff ins").innerText()) === BENEFITS_ADDED[1].trim() && (await casey.locator(".diff").innerText()) === BENEFITS_NOW, JSON.stringify(await casey.locator(".diff ins").innerText()));

  await goTo(casey, "Proposals");
  await casey.getByRole("link", { name: "Decisions Log" }).click();
  await casey.getByRole("heading", { level: 1, name: "Decisions Log" }).waitFor();
  const benefitDecisions = decisions(casey).filter({ hasText: "Edited directly: 2.2 Benefits" });
  check("the Decisions Log tells the two saves apart by their version", (await benefitDecisions.count()) === 2 && (await benefitDecisions.nth(0).getByRole("link", { name: BENEFITS_V3, exact: true }).isVisible()) && (await benefitDecisions.nth(1).getByRole("link", { name: BENEFITS_V2, exact: true }).isVisible()));
  const olderLines = await benefitDecisions.nth(1).locator("p").allInnerTexts();
  check("the Decisions Log marks the older one as no longer the current text, on a line of its own", olderLines[0] === `${today().short} · 2.2 Benefits · Official text` && olderLines[1] === "No longer the current text" && olderLines[2] === approvedKale() && (await benefitDecisions.nth(0).getByText("No longer the current text").count()) === 0, olderLines.join(" / "));
  check("the Decisions Log marks the text those two replaced as well", await decisions(casey).filter({ hasText: DISCOUNT_TITLE }).getByText("No longer the current text", { exact: true }).isVisible());
  await benefitDecisions.nth(1).getByRole("link", { name: BENEFITS_V2, exact: true }).click();
  await casey.getByRole("heading", { level: 1, name: BENEFITS_V2, exact: true }).waitFor();
  const replacedLine = casey.locator(".proposal-superseded");
  check("the older one's page says it is no longer the current official text", (await replacedLine.innerText()) === "This is no longer the current official text of 2.2 Benefits." && (await casey.locator(".diff ins").innerText()).trim() === BENEFITS_ADDED[0].trim(), await replacedLine.innerText().catch(() => "missing"));
  const linePlace = await casey.evaluate(() => {
    const status = document.querySelector(".proposal-status").getBoundingClientRect();
    const line = document.querySelector(".proposal-superseded");
    return { under: status.bottom <= line.getBoundingClientRect().top, color: getComputedStyle(line).color, muted: getComputedStyle(document.querySelector(".proposal .page-head .meta")).color };
  });
  check("that line sits under the status, in the muted colour", linePlace.under && linePlace.color === linePlace.muted, JSON.stringify(linePlace));
  await shot(casey, "p3-desktop-17-replaced-decision", { fullPage: true });
  await replacedLine.getByRole("link", { name: "2.2 Benefits" }).click();
  await casey.waitForURL(/\/sections\/[0-9a-f-]{36}$/);
  await casey.getByRole("heading", { level: 1, name: "2.2 Benefits", exact: true }).waitFor();
  check("the line links to the section, which shows the current text", (await casey.locator(".official-box .rich").innerText()) === BENEFITS_NOW);

  // Kale proposes a further small change on top of his two direct saves.
  await kale.getByRole("link", { name: "Propose a change" }).click();
  await kale.getByRole("heading", { level: 1, name: "New proposal" }).waitFor();
  const seedsUrl = await proposeText(kale, { title: SEEDS_TITLE, text: [BENEFITS_NOW + SEEDS_ADDED] });
  check("the proposer, whose proposal is his approval, gets no warning", (await warningOf(kale).count()) === 0 && (await kale.locator(".diff ins").innerText()).trim() === SEEDS_ADDED.trim());
  await casey.goto(seedsUrl);
  await casey.getByRole("heading", { level: 1, name: SEEDS_TITLE }).waitFor();
  const warningText = async (page) => ((await warningOf(page).count()) === 1 ? warningOf(page).innerText() : `${await warningOf(page).count()} warnings`);
  check("Casey is warned that the current text holds two changes she has not approved", (await warningText(casey)) === `You have not approved the current official text of this section. It was last changed by Kale on ${today().short} (2 changes since you last approved it). ${WARNING_END}`, await warningText(casey));
  const above = await casey.evaluate(() => {
    const notice = [...document.querySelectorAll(".notice")].find((el) => el.textContent.includes("approves the whole text"));
    return notice.getBoundingClientRect().bottom <= document.querySelector(".diff-box").getBoundingClientRect().top;
  });
  check("the warning stands above the differences", above && (await casey.locator(".diff ins").innerText()).trim() === SEEDS_ADDED.trim());
  await shot(casey, "p3-desktop-18-proposal-warning", { fullPage: true });
  await warningOf(casey).getByRole("link", { name: "version history" }).click();
  await casey.getByRole("heading", { level: 1, name: "Version history" }).waitFor();
  check("the warning links to the section's version history", /\/sections\/[0-9a-f-]{36}\/history$/.test(casey.url()) && (await casey.getByText("2.2 Benefits: official text").isVisible()) && (await casey.locator(".version-list > li").count()) === 3, casey.url());
  await karen.goto(seedsUrl);
  await karen.getByRole("heading", { level: 1, name: SEEDS_TITLE }).waitFor();
  check("an Advisor, who cannot approve, gets no warning and no Owner controls", (await warningOf(karen).count()) === 0 && (await ownerControls(karen)) === 0 && (await karen.getByRole("button", { name: "Endorse" }).isVisible()));
  await casey.goto(registersUrl);
  await casey.getByRole("heading", { level: 1, name: REGISTERS_TITLE }).waitFor();
  check("there is no warning where she approved the current text herself", (await warningOf(casey).count()) === 0 && (await approveButton(casey).isVisible()));

  // The earlier save has its own page, reached from the line on Today, with its own I approve too.
  await goTo(casey, "Today");
  await earlierLine.getByRole("link", { name: `version 2 (${today().day})`, exact: true }).click();
  await casey.getByRole("heading", { level: 1, name: BENEFITS_V2, exact: true }).waitFor();
  await casey.getByRole("button", { name: "I approve too" }).click();
  check("I approve too on the earlier save's own page adds her approval to it", await eventually(async () => (await statusOf(casey).innerText()) === approvedBoth()), await statusOf(casey).innerText());
  await goTo(casey, "Today");
  check("after that only the newer one is left on Today, with no earlier line", (await eventually(async () => (await earlierLine.count()) === 0)) && (await benefitRows.count()) === 1 && (await benefitRows.getByRole("button", { name: `I approve too: ${BENEFITS_V3}`, exact: true }).isVisible()) && (await casey.getByRole("heading", { level: 2, name: "Decided by one person (8)" }).isVisible()), `${await benefitRows.count()} rows under "${await flagged.getByRole("heading", { level: 2 }).innerText()}"`);
  await casey.goto(seedsUrl);
  await casey.getByRole("heading", { level: 1, name: SEEDS_TITLE }).waitFor();
  check("the warning now counts the one change she has not approved", (await warningText(casey)) === `You have not approved the current official text of this section. It was last changed by Kale on ${today().short} (1 change since you last approved it). ${WARNING_END}`, await warningText(casey));
  await approveButton(casey).click();
  check("she can approve the proposal all the same", await eventually(async () => (await statusOf(casey).innerText()) === approvedBoth()), await statusOf(casey).innerText());
  check("an approved proposal carries no warning", (await warningOf(casey).count()) === 0);

  // The same on a section whose official text Casey never approved (Kale's direct save in part 3).
  await goToSection(kale, "Hours and Daily Operations", "3.2 Opening Procedures");
  await kale.getByRole("link", { name: "Propose a change" }).click();
  await kale.getByRole("heading", { level: 1, name: "New proposal" }).waitFor();
  const lightsUrl = await proposeText(kale, { title: LIGHTS_TITLE, text: [OPENING_TEXT + LIGHTS_ADDED] });
  await casey.goto(lightsUrl);
  await casey.getByRole("heading", { level: 1, name: LIGHTS_TITLE }).waitFor();
  check("where she never approved any of the section's text, the warning says so", (await warningText(casey)) === `You have never approved the official text of this section. It was last changed by Kale on ${today().short}. ${WARNING_END}`, await warningText(casey));
  check("that warning links to version history too", /\/sections\/[0-9a-f-]{36}\/history$/.test((await warningOf(casey).getByRole("link", { name: "version history" }).getAttribute("href")) ?? ""));

  // ------------------------------------------------------------------
  section("19. The words are the same: formatting, a link, a checkbox");
  await goToSection(kale, "Vendors and Purchasing", "7.1 Vendor Contacts");
  await kale.getByRole("button", { name: "Edit official" }).click();
  await kaleOfficial.waitFor();
  await kaleOfficial.click();
  await kale.keyboard.type(VENDOR_HEADING);
  await kale.getByLabel("Text size").selectOption({ label: "Small heading" });
  await kale.keyboard.press("Enter");
  await kale.keyboard.type(VENDOR_LINE);
  await kale.keyboard.press("Enter");
  await kale.getByRole("button", { name: "Add or change a link" }).click();
  await kale.getByLabel("Link address").fill("example.com");
  await kale.getByRole("button", { name: "Apply link" }).click();
  // (The cursor goes back into the text a moment after the link box closes.)
  await eventually(() => kaleOfficial.evaluate((el) => document.activeElement === el));
  await kale.keyboard.press("Enter");
  await kale.getByRole("button", { name: "Checkbox list" }).click();
  await kale.keyboard.type(VENDOR_TASK);
  await kale.getByRole("button", { name: "Save as official" }).click();
  await kale.locator(".approval").waitFor();
  const vendorBox = kale.locator(".official-box .rich");
  // What is saved keeps more than the words: the size of a heading, where a link goes, a checkbox.
  check("saved official text keeps a small heading, a link with its address, and a checkbox", (await vendorBox.locator(".rt-h3").innerText().catch(() => "no small heading")) === VENDOR_HEADING && (await vendorBox.locator("p").first().innerText()) === VENDOR_LINE && (await vendorBox.locator('a[href="https://example.com"]').innerText().catch(() => "no link")) === "example.com" && (await vendorBox.locator('input[type="checkbox"]').count()) === 1 && !(await vendorBox.locator('input[type="checkbox"]').isChecked()), await vendorBox.innerHTML());

  // A proposal of the kind "Official text" that changes only how it looks.
  await kale.getByRole("link", { name: "Propose a change" }).click();
  await kale.getByRole("heading", { level: 1, name: "New proposal" }).waitFor();
  const formatForm = newForm(kale);
  await formatForm.getByRole("radio", { name: "Official text" }).check();
  await formatForm.getByLabel("Title", { exact: true }).fill(FORMAT_TITLE);
  const formatBox = formatForm.getByRole("textbox", { name: "Proposed official text" });
  await formatBox.waitFor();
  await formatBox.click();
  await kale.keyboard.press("Control+A");
  await formatForm.getByRole("button", { name: "Bold", exact: true }).click();
  await formatForm.getByRole("button", { name: "Propose", exact: true }).click();
  await kale.waitForURL(/\/proposals\/[0-9a-f-]{36}$/);
  await kale.getByRole("heading", { level: 1, name: FORMAT_TITLE }).waitFor();
  const diffNote = (page) => page.locator(".diff-note");
  check("a proposal of the kind Official text is labelled so", (await kale.locator(".proposal .page-head .meta").innerText()).startsWith("Official text · 7.1 Vendor Contacts · Proposed by Kale"), await kale.locator(".proposal .page-head .meta").innerText());
  check("when only the formatting changed, the page says so and shows no word differences", (await diffNote(kale).innerText().catch(() => "missing")) === "Only the formatting or layout changed." && (await kale.locator(".diff").count()) === 0, await diffNote(kale).innerText().catch(() => "missing"));
  await kale.getByText("Full proposed text").click();
  check("the full proposed text shows the new formatting", (await kale.locator("details.full-text .rich strong").allInnerTexts()).join("|") === [VENDOR_HEADING, VENDOR_LINE, "example.com", VENDOR_TASK].join("|"), (await kale.locator("details.full-text .rich strong").allInnerTexts()).join("|"));
  await kale.getByRole("button", { name: "Approve on my own" }).click();
  await kale.getByRole("button", { name: "Approve on my own" }).click();
  check("the formatting change is approved by Kale", await eventually(async () => (await statusOf(kale).innerText()) === approvedKale()), await statusOf(kale).innerText());

  // A link that now points somewhere else: the words are the same, and the page says what changed.
  await goToSection(kale, "Vendors and Purchasing", "7.1 Vendor Contacts");
  await kale.getByRole("button", { name: "Edit official" }).click();
  await kaleOfficial.waitFor();
  await kaleOfficial.locator("a").filter({ hasText: "example.com" }).click();
  await kale.getByRole("button", { name: "Add or change a link" }).click();
  check("the link box opens with the address the link has now", (await kale.getByLabel("Link address").inputValue()) === "https://example.com");
  await kale.getByLabel("Link address").fill("example.org");
  await kale.getByRole("button", { name: "Apply link" }).click();
  await kale.getByRole("button", { name: "Save as official" }).click();
  await kale.locator('.official-box .rich a[href="https://example.org"]').waitFor();
  await kale.getByRole("link", { name: "Version history" }).click();
  await kale.getByRole("heading", { level: 1, name: "Version history" }).waitFor();
  await kale.getByRole("link", { name: "Show version 3" }).click();
  await kale.getByRole("heading", { name: "What changed from version 2" }).waitFor();
  check("a changed link address is said in words, with where to read it", (await diffNote(kale).innerText()) === "The words are the same. A link's address was changed. The full text of this version is above.", await diffNote(kale).innerText());
  await kale.getByRole("link", { name: "Show version 2" }).click();
  await kale.getByRole("heading", { name: "What changed from version 1" }).waitFor();
  check("version history says formatting only for the version that changed nothing else", (await diffNote(kale).innerText()) === "Only the formatting or layout changed.", await diffNote(kale).innerText());

  // A checkbox ticked in a proposal.
  await kale.getByRole("link", { name: "7.1 Vendor Contacts" }).first().click();
  await kale.getByRole("heading", { level: 1, name: "7.1 Vendor Contacts" }).waitFor();
  await kale.getByRole("link", { name: "Propose a change" }).click();
  await kale.getByRole("heading", { level: 1, name: "New proposal" }).waitFor();
  await formatForm.getByLabel("Title", { exact: true }).fill(TICK_TITLE);
  await formatBox.waitFor();
  await formatBox.locator('input[type="checkbox"]').check();
  await formatForm.getByRole("button", { name: "Propose", exact: true }).click();
  await kale.waitForURL(/\/proposals\/[0-9a-f-]{36}$/);
  await kale.getByRole("heading", { level: 1, name: TICK_TITLE }).waitFor();
  const tickUrl = kale.url();
  check("a ticked checkbox is said in words", (await diffNote(kale).innerText().catch(() => "missing")) === "The words are the same. A checkbox was ticked or unticked.", await diffNote(kale).innerText().catch(() => "missing"));
  await kale.getByText("Full proposed text").click();
  check("the full proposed text shows the box ticked", await kale.locator('details.full-text .rich input[type="checkbox"]').isChecked());

  // On Today these three changes to one section are one row: the newest, then the earlier
  // ones in one line, a written proposal by its title and a direct save by its version.
  await goTo(casey, "Today");
  const vendorRow = flagged.getByRole("listitem").filter({ hasText: "Edited directly: 7.1 Vendor Contacts (version 3)" });
  check("three one-person changes to one section are one row with the two earlier ones listed", (await eventually(() => vendorRow.isVisible())) && (await vendorRow.locator(".earlier-changes").innerText()) === `Earlier one-person changes to this section: ${FORMAT_TITLE}, version 1 (${today().day})` && (await vendorRow.locator(".earlier-changes").getByRole("link").count()) === 2, await vendorRow.locator(".earlier-changes").innerText().catch(() => "missing"));
  await vendorRow.locator(".earlier-changes").getByRole("link", { name: FORMAT_TITLE }).click();
  await casey.getByRole("heading", { level: 1, name: FORMAT_TITLE }).waitFor();
  check("each earlier change opens its own page, with its own I approve too", (await casey.getByRole("button", { name: "I approve too" }).isVisible()) && (await statusOf(casey).innerText()) === approvedKale());

  // ------------------------------------------------------------------
  section("18. A section is archived while proposals about it wait");
  // A note that leads to a proposal to rename Closing Procedures.
  await navOf(kale).getByRole("link", { name: "New note" }).click();
  await kale.getByRole("heading", { level: 1, name: today().long }).waitFor();
  await noteBox.waitFor();
  await noteBox.click();
  await kale.keyboard.type(CLOSING_NOTE);
  await kale.getByRole("button", { name: "Save", exact: true }).click();
  const closingNote = kale.getByRole("article", { name: /^Note by Kale/ }).filter({ hasText: "Closing takes too long" });
  await closingNote.waitFor();
  await kale.getByRole("button", { name: "Cancel" }).click();
  await closingNote.getByRole("link", { name: /^Propose from note by Kale/ }).click();
  await kale.getByRole("heading", { level: 1, name: "New proposal" }).waitFor();
  const goneForm = newForm(kale);
  await goneForm.getByRole("radio", { name: "Structure" }).check();
  await goneForm.getByRole("radio", { name: "Rename a section" }).check();
  await goneForm.getByLabel("Section", { exact: true }).selectOption({ label: "3.3 Closing Procedures" });
  await goneForm.getByLabel("New name").fill("Closing");
  check("a section proposal made from a note still shows the note", (await goneForm.locator(".from-note .rich").innerText()) === CLOSING_NOTE);
  await goneForm.getByRole("button", { name: "Propose", exact: true }).click();
  await kale.getByRole("heading", { level: 1, name: 'Rename 3.3 Closing Procedures to "Closing"' }).waitFor();
  const renameUrl = kale.url();
  // A text proposal about the same section.
  await startProposalFor(kale, "closing", "3.3 Closing Procedures");
  const checklistUrl = await proposeText(kale, { title: CHECKLIST_TITLE, text: [CHECKLIST_TEXT] });
  // A proposal to move another section under it.
  await goTo(kale, "Proposals");
  await kale.getByRole("link", { name: "New proposal" }).click();
  await kale.getByRole("heading", { level: 1, name: "New proposal" }).waitFor();
  await goneForm.getByRole("radio", { name: "Structure" }).check();
  await goneForm.getByRole("radio", { name: "Move a section" }).check();
  await goneForm.getByLabel("Section", { exact: true }).selectOption({ label: "10 Opening Timeline" });
  await goneForm.getByLabel("Move it under").selectOption({ label: "3.3 Closing Procedures" });
  await goneForm.getByRole("button", { name: "Propose", exact: true }).click();
  await kale.getByRole("heading", { level: 1, name: "Move 10 Opening Timeline under 3.3 Closing Procedures" }).waitFor();
  const timelineUrl = kale.url();
  // And the proposal to archive it, which Casey approves.
  await goTo(kale, "Proposals");
  await kale.getByRole("link", { name: "New proposal" }).click();
  await kale.getByRole("heading", { level: 1, name: "New proposal" }).waitFor();
  await goneForm.getByRole("radio", { name: "Structure" }).check();
  await goneForm.getByRole("radio", { name: "Archive a section" }).check();
  await goneForm.getByLabel("Section", { exact: true }).selectOption({ label: "3.3 Closing Procedures" });
  check("the form says what archiving does", await goneForm.getByText(ARCHIVE_HINT, { exact: true }).isVisible());
  await goneForm.getByRole("button", { name: "Propose", exact: true }).click();
  await kale.getByRole("heading", { level: 1, name: "Archive 3.3 Closing Procedures" }).waitFor();
  const archiveUrl = kale.url();
  await casey.goto(archiveUrl);
  await casey.getByRole("heading", { level: 1, name: "Archive 3.3 Closing Procedures" }).waitFor();
  const willChange = casey.getByRole("region", { name: "What will change" });
  check("the Owner asked to approve it is told what archiving does", (await willChange.getByText("Archive 3.3 Closing Procedures.", { exact: true }).isVisible()) && (await willChange.getByText(ARCHIVE_HINT, { exact: true }).isVisible()));
  await approveButton(casey).click();
  check("the archive proposal is approved by both", await eventually(async () => (await statusOf(casey).innerText()) === approvedBoth()), await statusOf(casey).innerText());
  const hoursToggle = navOf(casey).getByRole("button", { name: "Show subsections of Hours and Daily Operations" });
  if ((await hoursToggle.count()) > 0) await hoursToggle.click();
  check("the section is gone from the sidebar, and the decision keeps the sentence it was approved under", (await eventually(async () => (await navOf(casey).getByRole("link", { name: /Closing Procedures/ }).count()) === 0)) && (await navOf(casey).getByRole("link", { name: "3.3 Scheduling" }).isVisible()) && (await casey.getByRole("heading", { level: 1, name: "Archive 3.3 Closing Procedures" }).isVisible()) && (await casey.getByText(ARCHIVE_HINT).count()) === 0);

  // The text proposal about the archived section: it says so, and offers nothing that cannot work.
  await casey.goto(checklistUrl);
  await casey.getByRole("heading", { level: 1, name: CHECKLIST_TITLE }).waitFor();
  const goneNotice = (page) => page.locator(".notice").filter({ hasText: "no longer exists" });
  check("a text proposal about an archived section says so up front", (await goneNotice(casey).innerText().catch(() => "missing")) === GONE_NOTICE, await goneNotice(casey).innerText().catch(() => "missing"));
  check("the other Owner has no Approve on it, only Decline and Endorse", (await approveButton(casey).count()) === 0 && (await casey.getByRole("button", { name: "Approve on my own" }).count()) === 0 && (await casey.getByRole("button", { name: "Decline" }).isVisible()) && (await casey.getByRole("button", { name: "Endorse" }).isVisible()));
  const goneMeta = casey.locator(".proposal .page-head .meta");
  check("the archived section is named by its stored name, without a link", (await goneMeta.innerText()).startsWith("Decision · Closing Procedures (archived) · Proposed by Kale") && (await goneMeta.getByRole("link").count()) === 0, await goneMeta.innerText());
  await kale.goto(checklistUrl);
  await kale.getByRole("heading", { level: 1, name: CHECKLIST_TITLE }).waitFor();
  check("its proposer has no Approve on my own or Edit on it, only Withdraw", (await goneNotice(kale).isVisible()) && (await kale.getByRole("button", { name: "Approve on my own" }).count()) === 0 && (await editLink(kale).count()) === 0 && (await kale.getByRole("button", { name: "Withdraw" }).isVisible()));
  await kale.goto(`${checklistUrl}/edit`);
  await kale.getByRole("heading", { level: 1, name: CHECKLIST_TITLE }).waitFor();
  check("its edit address sends him back to the proposal", kale.url() === checklistUrl);

  // Everywhere a proposal about that section is listed, the section goes by its stored name.
  const RENAME_NOW = 'Rename Closing Procedures (archived) to "Closing"';
  const TIMELINE_NOW = "Move 10 Opening Timeline under Closing Procedures (archived)";
  await kale.goto(renameUrl);
  await kale.getByRole("heading", { level: 1, name: RENAME_NOW }).waitFor();
  check("the rename proposal names the archived section and says it cannot go ahead", (await goneNotice(kale).innerText()) === GONE_NOTICE && (await kale.getByRole("region", { name: "What will change" }).getByText(`${RENAME_NOW}.`, { exact: true }).isVisible()));
  await goTo(kale, "Proposals");
  const openRows = kale.getByRole("region", { name: /^Awaiting approval/ }).getByRole("listitem");
  check("the Proposals page names the archived section in titles and in the line under them", (await openRows.filter({ hasText: RENAME_NOW }).getByText(`Structure · Closing Procedures (archived) · proposed by Kale, ${today().short}`).isVisible()) && (await openRows.filter({ hasText: CHECKLIST_TITLE }).getByText(`Decision · Closing Procedures (archived) · proposed by Kale, ${today().short}`).isVisible()) && (await openRows.filter({ hasText: TIMELINE_NOW }).getByRole("link", { name: TIMELINE_NOW, exact: true }).isVisible()), (await openRows.allInnerTexts()).join(" / "));
  await shot(kale, "p3-desktop-23-archived-section-proposals", { fullPage: true });
  await goTo(casey, "Today");
  check("Today names it too, for a waiting proposal and for a one-person change", (await casey.getByRole("region", { name: /^Awaiting approval/ }).getByRole("link", { name: RENAME_NOW, exact: true }).isVisible()) && (await flagged.getByRole("link", { name: "Edited directly: Closing Procedures (archived) (version 3)", exact: true }).isVisible()));
  await goTo(casey, "Proposals");
  await casey.getByRole("link", { name: "Decisions Log" }).click();
  await casey.getByRole("heading", { level: 1, name: "Decisions Log" }).waitFor();
  const archiveDecision = decisions(casey).filter({ hasText: "Archive 3.3 Closing Procedures" });
  check("the Decisions Log lists the archive decision under the sentence that was approved", (await decisions(casey).first().getByRole("link", { name: "Archive 3.3 Closing Procedures", exact: true }).isVisible()) && (await archiveDecision.locator("p").first().innerText()) === `${today().short} · Closing Procedures (archived) · Structure`, await archiveDecision.locator("p").first().innerText().catch(() => "missing"));
  check("earlier decisions about the archived section keep its name", (await decisions(casey).getByRole("link", { name: "Edited directly: Closing Procedures (archived) (version 1)", exact: true }).isVisible()) && (await decisions(casey).getByText("a section that has been archived").count()) === 0);
  await casey.getByText("Filters", { exact: true }).click();
  await casey.locator("details.filters-plain").getByLabel("Section").selectOption({ label: "3 Hours and Daily Operations" });
  await casey.locator("details.filters-plain").getByRole("button", { name: "Apply" }).click();
  await casey.waitForURL(/section=/);
  const hoursTitles = async () => casey.getByRole("list", { name: "Decisions" }).locator(".title").allInnerTexts();
  check("they stay in the list of the section above it", await eventually(async () => {
    const listed = await hoursTitles();
    return ["Archive 3.3 Closing Procedures", "Edited directly: Closing Procedures (archived) (version 3)", "Edited directly: Closing Procedures (archived) (version 2)", "Edited directly: Closing Procedures (archived) (version 1)"].every((title) => listed.includes(title)) && !listed.includes(WAGES_TITLE);
  }), (await hoursTitles()).join("|"));
  await goTo(kale, "Daily Log");
  await kale.getByRole("link", { name: /^Today.s log$/ }).click();
  await kale.getByRole("heading", { level: 1, name: today().long }).waitFor();
  check("the proposal line on the note names the section as every other list does", (await closingNote.locator(".note-proposal").innerText().catch(() => "missing")) === `Proposal: ${RENAME_NOW} (waiting for approval)`, await closingNote.locator(".note-proposal").innerText().catch(() => "missing"));
  await navOf(kale).getByRole("searchbox", { name: "Search" }).fill("rename closing");
  await kale.keyboard.press("Enter");
  await kale.waitForURL(/q=rename/);
  await kale.getByRole("heading", { level: 1, name: "Search" }).waitFor();
  check("search lists the proposal under the same title", await proposalHits.getByRole("link", { name: RENAME_NOW, exact: true }).isVisible(), (await proposalHits.innerText().catch(() => "no proposals found")));
  await kale.getByText("Filters", { exact: true }).click();
  await kale.locator("details.filters").getByLabel("Section").selectOption({ label: "3 Hours and Daily Operations" });
  await kale.locator("details.filters").getByRole("button", { name: "Apply filters" }).click();
  await kale.waitForURL(/section=/);
  check("searching within the section above still finds proposals about the archived one", await eventually(() => proposalHits.getByRole("link", { name: RENAME_NOW, exact: true }).isVisible()), (await proposalHits.innerText().catch(() => "no proposals found")));

  // A move whose destination was archived: approving is refused with the reason, and the
  // edit form shows "Top level", which is what it would send.
  await casey.goto(timelineUrl);
  await casey.getByRole("heading", { level: 1, name: TIMELINE_NOW }).waitFor();
  await approveButton(casey).click();
  const cannot = casey.getByRole("alert").filter({ hasText: "This can no longer be done as proposed" });
  await cannot.waitFor();
  check("approving a move to an archived section is refused, with the reason and what to do", (await cannot.innerText()) === "This can no longer be done as proposed: the section it would go under no longer exists (it may have been archived). Decline it, or ask Kale to change or withdraw it." && (await statusOf(casey).innerText()) === "Waiting for approval", await cannot.innerText());
  await kale.goto(`${timelineUrl}/edit`);
  await kale.getByRole("heading", { level: 1, name: "Edit proposal" }).waitFor();
  const timelineEdit = kale.getByRole("form", { name: "Edit proposal" });
  check("on the edit form Move it under shows Top level and says the old place cannot be chosen", (await timelineEdit.getByLabel("Move it under").inputValue()) === "" && (await timelineEdit.getByText("The section it was going to move under can no longer be chosen (it may have been archived). Choose where it should go.").isVisible()));
  await timelineEdit.getByLabel("Move it under").selectOption({ label: "9 Marketing and Events" });
  await timelineEdit.getByRole("button", { name: "Save changes" }).click();
  await kale.getByRole("heading", { level: 1, name: "Move 10 Opening Timeline under 9 Marketing and Events" }).waitFor();
  check("after choosing another place the move proposal can be saved", kale.url() === timelineUrl && (await statusOf(kale).innerText()) === "Waiting for approval");

  // None of the three is wanted any more: Kale withdraws them.
  for (const [address, title] of [[timelineUrl, "Move 10 Opening Timeline under 9 Marketing and Events"], [renameUrl, RENAME_NOW], [checklistUrl, CHECKLIST_TITLE]]) {
    await kale.goto(address);
    await kale.getByRole("heading", { level: 1, name: title }).waitFor();
    await kale.getByRole("button", { name: "Withdraw" }).click();
    await kale.getByRole("button", { name: "Withdraw proposal" }).click();
    await eventually(async () => (await statusOf(kale).innerText()) === `Withdrawn by Kale, ${today().short}`);
  }
  check("a proposal about an archived section can still be withdrawn", (await statusOf(kale).innerText()) === `Withdrawn by Kale, ${today().short}` && (await kale.getByRole("heading", { level: 1, name: CHECKLIST_TITLE }).isVisible()));

  // For the phone: a proposal of Casey's that goes out of date, and one of Kale's.
  await startProposalFor(casey, "coffee equipment", "6.2 Coffee Equipment");
  const grinderUrl = await proposeText(casey, { title: GRINDER_TITLE, text: [GRINDER_TEXT] });
  await goToSection(kale, "Equipment and Technology", "6.2 Coffee Equipment");
  await kale.getByRole("button", { name: "Edit official" }).click();
  await kaleOfficial.waitFor();
  await kaleOfficial.click();
  await kale.keyboard.type(GRINDER_DIRECT);
  await kale.getByRole("button", { name: "Save as official" }).click();
  await kale.locator(".approval").waitFor();

  // ------------------------------------------------------------------
  section("14. Phone");
  const phone = await phoneContext(browser);
  const mobile = await phone.newPage();
  trackErrors(mobile, errors);
  await signIn(mobile, "casey@example.com");
  // No sideways scrolling on the phone's own width (390px), nor on a narrower one (360px).
  const fits = async (name) => {
    const overflow = await sidewaysOverflow(mobile);
    const size = mobile.viewportSize();
    await mobile.setViewportSize({ width: 360, height: size.height });
    const narrow = await sidewaysOverflow(mobile);
    await mobile.setViewportSize(size);
    check(`${name} fits a phone without sideways scrolling`, overflow <= 0 && narrow <= 0, `overflow ${overflow}px at ${size.width}px, ${narrow}px at 360px`);
  };
  await shot(mobile, "p3-phone-01-today", { fullPage: true });
  await fits("Today");
  const mobileFlagged = mobile.getByRole("region", { name: /^Decided by one person/ }).getByRole("listitem");
  // Three one-person changes to Vendor Contacts: one row, the earlier two in a line under it.
  const groupedRow = mobileFlagged.filter({ hasText: "Edited directly: 7.1 Vendor Contacts (version 3)" });
  const groupedLinks = groupedRow.locator(".earlier-changes").getByRole("link");
  check("on a phone the earlier changes to a section are listed under the newest, each easy to tap", (await groupedRow.locator(".earlier-changes").innerText()).startsWith("Earlier one-person changes to this section:") && (await groupedLinks.count()) === 2 && (await height(groupedLinks.first())) >= 36 && (await height(groupedLinks.last())) >= 36, `${await height(groupedLinks.first())} and ${await height(groupedLinks.last())}`);
  await groupedRow.scrollIntoViewIfNeeded();
  await shot(mobile, "p3-phone-17-today-grouped");
  // Kale's second direct save of Benefits: replaced since by the approved proposal, and still flagged.
  const replacedRow = mobileFlagged.filter({ hasText: "Edited directly: 2.2 Benefits" });
  const mobileApproveToo = replacedRow.getByRole("button", { name: "I approve too: Edited directly: 2.2 Benefits (version 3)", exact: true });
  check("on a phone a one-person change that was replaced since is still flagged, and says so", (await replacedRow.count()) === 1 && (await replacedRow.getByText("No longer the current text", { exact: true }).isVisible()), `${await replacedRow.count()} rows`);
  check("on a phone I approve too is a full-size button", (await height(mobileApproveToo)) >= 44, String(await height(mobileApproveToo)));
  await mobileApproveToo.tap();
  check("on a phone I approve too takes it off the list", await eventually(async () => (await replacedRow.count()) === 0));
  // Today is the page the app opens on: from there it is tap the proposal, read, tap Approve.
  let taps = 0;
  const mobileAwaiting = mobile.getByRole("region", { name: /^Awaiting approval/ });
  const waitingLink = mobileAwaiting.getByRole("link", { name: REGISTERS_TITLE });
  check("on a phone the waiting proposal is easy to tap", (await height(waitingLink)) >= 36, String(await height(waitingLink)));
  await waitingLink.tap();
  taps += 1;
  await mobile.getByRole("heading", { level: 1, name: REGISTERS_TITLE }).waitFor();
  check("on a phone the differences are shown", (await mobile.locator(".diff del").innerText()) === "$15.00/hr." && (await mobile.locator(".diff ins").innerText()) === "$16.00/hr.");
  check("on a phone the comment and the endorsement are shown", (await mobile.getByRole("list", { name: "Comments on this proposal" }).getByText("Karen here").isVisible()) && (await mobile.getByText(`Endorsed by Karen, ${today().short}`).isVisible()));
  await shot(mobile, "p3-phone-02-proposal", { fullPage: true });
  await fits("A proposal with differences and comments");
  const mobileApprove = approveButton(mobile);
  check("on a phone Approve is a full-size button", (await height(mobileApprove)) >= 44, String(await height(mobileApprove)));
  await mobileApprove.scrollIntoViewIfNeeded();
  await mobileApprove.tap();
  taps += 1;
  check("on a phone, approving from Today takes three taps or fewer", taps <= 3 && (await eventually(async () => (await statusOf(mobile).innerText()) === approvedBoth())) && (await mobile.getByRole("status").filter({ hasText: "Approved. It is official now." }).isVisible()), `${taps} taps, ${await statusOf(mobile).innerText()}`);
  await mobile.evaluate(() => window.scrollTo(0, 0));
  await shot(mobile, "p3-phone-03-proposal-approved", { fullPage: true });

  await mobile.goto(lightsUrl);
  await mobile.getByRole("heading", { level: 1, name: LIGHTS_TITLE }).waitFor();
  check("on a phone the warning about unapproved text is shown", (await warningOf(mobile).isVisible()) && (await warningOf(mobile).innerText()).startsWith("You have never approved the official text of this section."));
  const historyLink = warningOf(mobile).getByRole("link", { name: "version history" });
  check("on a phone the warning's link to version history is there", await historyLink.isVisible());
  await shot(mobile, "p3-phone-12-proposal-warning", { fullPage: true });
  await fits("A proposal with the warning about unapproved text");
  await approveButton(mobile).scrollIntoViewIfNeeded();
  await approveButton(mobile).tap();
  check("on a phone she can approve after reading the warning", await eventually(async () => (await statusOf(mobile).innerText()) === approvedBoth()), await statusOf(mobile).innerText());

  // A proposal of hers that went out of date (Kale saved the section directly after she proposed).
  await mobile.goto(`${BASE_URL}/`);
  await mobile.getByRole("heading", { level: 1, name: "Today" }).waitFor();
  const grinderRow = mobileAwaiting.getByRole("listitem").filter({ hasText: GRINDER_TITLE });
  check("on a phone Today says her proposal waits for her to check it", await grinderRow.getByText("Waiting for you to check it against the new official text", { exact: true }).isVisible());
  await grinderRow.getByRole("link", { name: GRINDER_TITLE }).tap();
  await mobile.getByRole("heading", { level: 1, name: GRINDER_TITLE }).waitFor();
  const mobileCheckLink = mobile.getByRole("link", { name: "Check and save again" });
  check("on a phone the proposer is told to check it, with a full-size button for it", (await mobile.locator(".notice-action p").innerText()).startsWith("The official text of this section has changed since you proposed this.") && (await height(mobileCheckLink)) >= 44 && (await approveButton(mobile).count()) === 0, String(await height(mobileCheckLink)));
  const crumbLink = mobile.locator(".crumbs a").first();
  check("on a phone the small link back at the top is easy to tap and takes no more room than before", (await height(crumbLink)) >= 43 && (await height(mobile.locator(".crumbs"))) <= 24, `link ${await height(crumbLink)}px, line ${await height(mobile.locator(".crumbs"))}px`);
  await shot(mobile, "p3-phone-14-outdated-proposal-proposer", { fullPage: true });
  await fits("An out-of-date proposal, as its proposer sees it");
  // The same proposal on Kale's phone.
  const kalePhone = await phoneContext(browser);
  const kaleMobile = await kalePhone.newPage();
  trackErrors(kaleMobile, errors);
  await signIn(kaleMobile, "kale@example.com");
  await kaleMobile.goto(grinderUrl);
  await kaleMobile.getByRole("heading", { level: 1, name: GRINDER_TITLE }).waitFor();
  const kaleOverflow = await sidewaysOverflow(kaleMobile);
  check("on a phone the other Owner is told who has to check it, and has no Approve", (await kaleMobile.locator(".notice").filter({ hasText: "has changed since" }).innerText()) === "The official text of this section has changed since Casey proposed this. Casey needs to check the proposal against the new text and save it again before it can be approved." && (await approveButton(kaleMobile).count()) === 0 && kaleOverflow <= 0, `overflow ${kaleOverflow}px`);
  await shot(kaleMobile, "p3-phone-15-outdated-proposal-other", { fullPage: true });
  await kalePhone.close();
  await mobileCheckLink.tap();
  await mobile.getByRole("heading", { level: 1, name: "Edit proposal" }).waitFor();
  const mobileEdit = mobile.getByRole("form", { name: "Edit proposal" });
  await mobileEdit.getByRole("textbox", { name: "Proposed official text" }).waitFor();
  check("on a phone the edit page shows the official text now, for reading, above the proposed text", (await mobileEdit.locator(".official-now").getByText("The official text now", { exact: true }).isVisible()) && (await mobileEdit.locator(".official-now .official-box .rich").innerText()) === GRINDER_DIRECT);
  await shot(mobile, "p3-phone-16-check-proposal", { fullPage: true });
  await fits("Edit proposal with the official text now");
  const mobileSave = mobileEdit.getByRole("button", { name: "Save changes" });
  await mobileSave.scrollIntoViewIfNeeded();
  check("on a phone Save changes and Cancel are both full size", (await height(mobileSave)) >= 44 && (await height(mobileEdit.getByRole("link", { name: "Cancel" }))) >= 44, `${await height(mobileSave)} and ${await height(mobileEdit.getByRole("link", { name: "Cancel" }))}`);
  await mobileSave.tap();
  await mobile.getByRole("heading", { level: 1, name: GRINDER_TITLE }).waitFor();
  check("on a phone, saving it again says it was checked and can be approved", (await eventually(() => mobile.getByRole("status").filter({ hasText: "Checked against the new official text. It can be approved now." }).isVisible())) && (await mobile.locator(".notice-action").count()) === 0);

  // Endorse asks an Owner first.
  await mobile.goto(tickUrl);
  await mobile.getByRole("heading", { level: 1, name: TICK_TITLE }).waitFor();
  const mobileEndorse = mobile.getByRole("button", { name: "Endorse" });
  await mobileEndorse.scrollIntoViewIfNeeded();
  await mobileEndorse.tap();
  const endorseGroup = mobile.getByRole("group", { name: "Endorse" });
  await endorseGroup.getByText(ENDORSE_QUESTION).waitFor();
  check("on a phone the Endorse question opens in place with full-size answers", (await height(endorseGroup.getByRole("button", { name: "Endorse" }))) >= 44 && (await height(endorseGroup.getByRole("button", { name: "Cancel" }))) >= 44 && (await approveButton(mobile).isHidden()));
  await shot(mobile, "p3-phone-18-endorse-question", { fullPage: true });
  await fits("A proposal with the Endorse question open");
  await endorseGroup.getByRole("button", { name: "Cancel" }).tap();
  check("on a phone Cancel brings the buttons back and records nothing", (await approveButton(mobile).isVisible()) && (await mobile.locator(".endorsements").count()) === 0);

  // A copy typed on the phone, then the section is changed from somewhere else.
  await mobile.getByRole("button", { name: "Open menu" }).click();
  await goToSection(mobile, "People", "2.4 Training");
  await mobile.getByRole("button", { name: "Edit official" }).tap();
  const mobileOfficial = mobile.getByRole("textbox", { name: "Official text" });
  await mobileOfficial.waitFor();
  await mobileOfficial.click();
  await mobile.keyboard.type(TRAINING_PHONE);
  await eventually(async () => (await draftKeys(mobile, "ppf:draft:official:")).length === 1);
  await mobile.goto(`${BASE_URL}/`);
  await mobile.getByRole("heading", { level: 1, name: "Today" }).waitFor();
  await goToSection(kale, "People", "2.4 Training");
  await kale.getByRole("button", { name: "Edit official" }).click();
  await kaleOfficial.waitFor();
  await kaleOfficial.click();
  await kale.keyboard.type(TRAINING_KALE);
  await kale.getByRole("button", { name: "Save as official" }).click();
  await kale.locator(".approval").waitFor();
  await mobile.getByRole("button", { name: "Open menu" }).click();
  await goToSection(mobile, "People", "2.4 Training");
  await mobile.getByRole("button", { name: "Continue editing" }).tap();
  await mobileOfficial.waitFor();
  const mobileOutdated = mobile.locator(".editor-outdated");
  check("on a phone the copy typed before the change says so, with the official text now under it", (await mobileOutdated.locator("p").innerText()).endsWith("before the official text was last changed. It does not include that change.") && (await mobile.locator(".editor-current .official-box .rich").innerText()) === TRAINING_KALE && (await mobileOfficial.innerText()).trim() === TRAINING_PHONE);
  const startOver = mobile.getByRole("button", { name: "Start over from the current text" });
  const keepTyped = mobile.getByRole("button", { name: "Keep what I typed" });
  check("on a phone its two choices are full size", (await height(startOver)) >= 44 && (await height(keepTyped)) >= 44, `${await height(startOver)} and ${await height(keepTyped)}`);
  await mobile.evaluate(() => window.scrollTo(0, 0));
  await shot(mobile, "p3-phone-13-outdated-copy", { fullPage: true });
  await fits("Edit official with a copy that is out of date");
  await startOver.tap();
  check("on a phone Start over from the current text loads Kale's text", (await eventually(async () => (await mobileOfficial.innerText()).trim() === TRAINING_KALE)) && (await mobileOutdated.count()) === 0);
  await mobile.getByRole("button", { name: "Cancel" }).tap();
  await mobile.getByRole("button", { name: "Edit official" }).waitFor();

  await mobile.getByRole("button", { name: "Open menu" }).click();
  const mobileNav = navOf(mobile);
  await shot(mobile, "p3-phone-04-menu-count");
  // Still waiting for her: the weekend proposal and the ticked checkbox.
  check("on a phone the menu shows the number waiting", await mobileNav.getByRole("link", { name: "Proposals, 2 waiting" }).isVisible());
  await mobileNav.getByRole("link", { name: "Proposals, 2 waiting" }).click();
  await mobile.getByRole("heading", { level: 1, name: "Proposals" }).waitFor();
  await shot(mobile, "p3-phone-05-proposals", { fullPage: true });
  await fits("The Proposals page");

  await mobile.getByRole("link", { name: "Decisions Log" }).tap();
  await mobile.getByRole("heading", { level: 1, name: "Decisions Log" }).waitFor();
  await mobile.getByText("Filters", { exact: true }).tap();
  await mobile.getByRole("button", { name: "Apply" }).waitFor();
  await shot(mobile, "p3-phone-06-decisions-log", { fullPage: true });
  await fits("The Decisions Log with Filters open");

  await mobile.getByRole("button", { name: "Open menu" }).click();
  await goToSection(mobile, "People", "2.1 Wages");
  await shot(mobile, "p3-phone-07-section", { fullPage: true });
  await fits("A section page with both buttons, the approval and an endorsement");
  const headBox = await mobile.getByRole("heading", { level: 2, name: "Official" }).boundingBox();
  const proposeBox = await mobile.getByRole("link", { name: "Propose a change" }).boundingBox();
  const editBox2 = await mobile.getByRole("button", { name: "Edit official" }).boundingBox();
  const apart = (a, b) => a.x + a.width <= b.x || b.x + b.width <= a.x || a.y + a.height <= b.y || b.y + b.height <= a.y;
  check("on a phone the heading Official and both buttons do not overlap", apart(headBox, proposeBox) && apart(headBox, editBox2) && apart(proposeBox, editBox2) && proposeBox.x + proposeBox.width <= 390 && editBox2.x >= 0);
  await mobile.getByRole("link", { name: "Propose a change" }).tap();
  await mobile.getByRole("heading", { level: 1, name: "New proposal" }).waitFor();
  const mobileForm = newForm(mobile);
  await mobileForm.getByRole("textbox", { name: "Proposed official text" }).waitFor();
  await mobileForm.getByLabel("Title", { exact: true }).fill("Typed on the phone");
  await shot(mobile, "p3-phone-08-new-proposal", { fullPage: true });
  await fits("The new proposal form (a decision)");
  const mobilePropose = mobileForm.getByRole("button", { name: "Propose", exact: true });
  await mobilePropose.scrollIntoViewIfNeeded();
  check("on a phone the Propose button can be reached and is full size", (await inView(mobilePropose)) && (await height(mobilePropose)) >= 44, String(await height(mobilePropose)));
  await mobileForm.getByRole("radio", { name: "Structure" }).check();
  await mobileForm.getByRole("radio", { name: "Move a section" }).check();
  await mobileForm.getByLabel("Section", { exact: true }).selectOption({ label: "5.4 Greenhouse" });
  await mobile.evaluate(() => window.scrollTo(0, 0));
  await shot(mobile, "p3-phone-09-new-section-proposal", { fullPage: true });
  await fits("The new proposal form (sections)");
  await mobilePropose.scrollIntoViewIfNeeded();
  check("on a phone the Propose button of the sections form can be reached", await inView(mobilePropose));
  await mobileForm.getByRole("radio", { name: "Decision" }).check();
  check("switching kinds keeps what was typed", (await mobileForm.getByLabel("Title", { exact: true }).inputValue()) === "Typed on the phone");

  await mobile.getByRole("button", { name: "Open menu" }).click();
  await goToSection(mobile, "Hours and Daily Operations", "3.1 Store Hours");
  await mobile.getByRole("link", { name: "Version history" }).tap();
  await mobile.getByRole("heading", { level: 1, name: "Version history" }).waitFor();
  await mobile.getByRole("link", { name: "Show version 2" }).tap();
  await mobile.getByRole("heading", { name: "What changed from version 1" }).waitFor();
  check("on a phone Show keeps the version in view", await eventually(() => inView(mobile.getByRole("heading", { name: "Version 2", exact: true }))));
  check("an Owner can restore an earlier version from a phone too", await mobile.getByRole("button", { name: "Restore this version (version 2)" }).isVisible());
  await shot(mobile, "p3-phone-10-version-history", { fullPage: true });
  await fits("Version history with a version open");

  // The note actions: Sort, Add comment, Propose, Edit, Remove on one row.
  await mobile.getByRole("link", { name: "New note" }).tap();
  const mobileBox = mobile.getByRole("textbox", { name: "New note" });
  await mobileBox.waitFor();
  await mobileBox.click();
  await mobile.keyboard.type(PHONE_NOTE);
  await mobile.getByRole("button", { name: "Save", exact: true }).tap();
  const phoneNote = mobile.getByRole("article", { name: /^Note by Casey/ }).filter({ hasText: "awning" });
  await phoneNote.waitFor();
  await mobile.getByRole("button", { name: "Cancel" }).tap();
  const actionTops = await phoneNote.locator(".note-actions > *").evaluateAll((items) => items.map((el) => Math.round(el.getBoundingClientRect().top)));
  check("on a phone the five note actions fit on one row", actionTops.length === 5 && new Set(actionTops).size === 1, JSON.stringify(actionTops));
  check("on a phone Propose on a note is easy to tap", (await height(phoneNote.getByRole("link", { name: /^Propose from note/ }))) >= 44);
  await mobile.evaluate(() => window.scrollTo(0, 0));
  await shot(mobile, "p3-phone-11-day", { fullPage: true });
  await fits("A Daily Log day with Propose on the notes");
  await phone.close();

  // ------------------------------------------------------------------
  section("20. Settings: someone who comes back keeps the name they had");
  await navOf(kale).getByRole("link", { name: "Settings" }).click();
  await kale.getByRole("heading", { level: 1, name: "Settings" }).waitFor();
  await kale.getByRole("button", { name: "Remove Karen" }).click();
  await kale.getByRole("button", { name: "Yes, remove" }).click();
  await eventually(async () => (await kale.getByRole("button", { name: "Remove Karen" }).count()) === 0);
  await kale.getByLabel("Name or nickname").fill("Karen from the roastery");
  await kale.getByLabel("Email", { exact: true }).fill("karen@example.com");
  await kale.locator('select[name="role"]').selectOption({ label: "Advisor" });
  await kale.getByRole("button", { name: "Create user" }).click();
  const backNote = kale.getByRole("status").filter({ hasText: "is back" });
  check("adding her back under another name says she keeps the name she had, and why", (await eventually(() => backNote.isVisible())) && (await backNote.innerText()) === "Karen is back as Advisor. They keep the name they had before (Karen), because it is on what they wrote and approved. An invitation was emailed to karen@example.com.", await backNote.innerText().catch(() => "missing"));
  check("she is listed under the name she had", (await kale.getByRole("button", { name: "Remove Karen", exact: true }).isVisible()) && (await kale.getByText("Karen from the roastery").count()) === 0);

  check("no errors were reported by the browser", errors.length === 0, errors.slice(0, 3).join(" | "));
  await browser.close();
}

run(main);
