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
const NOTE = "Kale suggests coffee staff at $15/hr, weekends   $16 -- talk to *Casey*";
const WEEKEND_TITLE = "Weekend shifts pay one dollar more";
const WEEKEND_TEXT = "Weekend shifts pay $1.00/hr more than weekday shifts.";
const HOURS_V1 = ["Open 9 AM to 6 PM, Monday to Saturday.", "Closed Sunday."];
const HOURS_V2 = ["Open 9 AM to 7 PM, Monday to Saturday.", "Open 11 AM to 4 PM Sunday."];
const PHONE_NOTE = "Casey on the phone: ask about the awning quote";

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
  /^(New proposal|Propose a change|Propose|Propose from .*|Edit official|Approve|Approve on my own|I approve too.*|Decline|Withdraw|Edit|Restore.*)$/;
async function ownerControls(page) {
  const main = page.getByRole("main");
  return (
    (await main.getByRole("button", { name: OWNER_CONTROLS }).count()) +
    (await main.getByRole("link", { name: OWNER_CONTROLS }).count())
  );
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
  const now = new Date();
  const today = { key: dateKey(now), long: longDate(now), short: shortDate(now) };
  const daysAgo = (days) => new Date(now.getTime() - days * DAY_MS);
  const approvedBoth = `Approved by Kale and Casey, ${today.short}`;
  const approvedKale = `Approved by Kale, ${today.short}`;

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
  check("the form starts as a decision about that section", (await kaleForm.getByRole("radio", { name: "A decision" }).isChecked()) && (await kaleForm.getByText("2.1 Wages").isVisible()));
  const proposedBox = kaleForm.getByRole("textbox", { name: "Proposed official text" });
  await proposedBox.waitFor();
  check("the proposed text starts as the current official text", (await proposedBox.innerText()).includes("Starting wage, Coffee Shop: $13.00/hr."));
  check("the form says whose approval it will need", await kaleForm.getByText("Proposing counts as your approval. It becomes official when Casey approves too.").isVisible());
  await kaleForm.getByLabel("Title", { exact: true }).fill(WAGES_TITLE);
  await typeProposedText(kale, WAGES_NEW);
  await kaleForm.getByRole("radio", { name: "Coffee Shop", exact: true }).check();
  await kaleForm.getByLabel("Why (optional)").fill(WAGES_WHY);
  await shot(kale, "p3-desktop-01-new-proposal", { fullPage: true });
  await kaleForm.getByRole("button", { name: "Propose", exact: true }).click();
  await kale.waitForURL(/\/proposals\/[0-9a-f-]{36}$/);
  await kale.getByRole("heading", { level: 1, name: WAGES_TITLE }).waitFor();
  const wagesUrl = kale.url();
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
  check("Today says who proposed it and that it waits for her", (await caseyAwaiting.getByText(`Proposed by Kale, ${today.short}`).isVisible()) && (await caseyAwaiting.getByText("Waiting for you").isVisible()));
  await shot(casey, "p3-desktop-02-today-awaiting");
  await caseyAwaiting.getByRole("link", { name: WAGES_TITLE }).click();
  await casey.getByRole("heading", { level: 1, name: WAGES_TITLE }).waitFor();
  const diff = casey.locator(".diff");
  const lineOf = (locator) => locator.evaluate((el) => getComputedStyle(el).textDecorationLine);
  check("the old wage is shown struck through", (await diff.locator("del").innerText()) === "$13.00/hr." && (await lineOf(diff.locator("del"))) === "line-through", await diff.locator("del").allInnerTexts().then((t) => t.join("|")));
  check("the new wage is shown underlined", (await diff.locator("ins").innerText()) === "$15.00/hr." && (await lineOf(diff.locator("ins"))) === "underline");
  check("the unchanged words are shown plainly, in reading order", (await diff.innerText()) === "Starting wage, Coffee Shop: $13.00/hr.$15.00/hr.\nStarting wage, Garden Center Registers: $15.00/hr.", JSON.stringify(await diff.innerText()));
  check("the page says what it is compared with", await casey.getByText("Compared with the official text now.").isVisible());
  await casey.getByText("Full proposed text").click();
  check("the full proposed text can be opened", (await casey.locator("details.full-text .rich p").first().innerText()) === WAGES_NEW[0]);
  check("the other Owner has Approve, Decline and Endorse, and no Edit or Withdraw", (await approveButton(casey).isVisible()) && (await casey.getByRole("button", { name: "Decline" }).isVisible()) && (await casey.getByRole("button", { name: "Endorse" }).isVisible()) && (await editLink(casey).count()) === 0 && (await casey.getByRole("button", { name: "Withdraw" }).count()) === 0 && (await casey.getByRole("button", { name: "Approve on my own" }).count()) === 0);
  await shot(casey, "p3-desktop-03-proposal-open", { fullPage: true });
  await approveButton(casey).click();
  await casey.getByText("Approved. It is official now.").waitFor();
  check("after Approve the page says it is official now", true);
  check("the proposal shows Approved by Kale and Casey, in bold", (await eventually(async () => (await statusOf(casey).innerText()) === approvedBoth)) && Number(await statusOf(casey).evaluate((el) => getComputedStyle(el).fontWeight)) >= 700, await statusOf(casey).innerText());
  check("an approved proposal has no Approve, Decline, Edit or Withdraw left", (await approveButton(casey).count()) === 0 && (await casey.getByRole("button", { name: /^(Decline|Withdraw|Approve on my own|I approve too)$/ }).count()) === 0);
  check("the approved proposal says what it was compared with", await casey.getByText("Compared with the text it replaced.").isVisible());
  await shot(casey, "p3-desktop-04-proposal-approved", { fullPage: true });
  check("the count is gone from Casey's sidebar", (await navOf(casey).getByRole("link", { name: "Proposals", exact: true }).count()) === 1 && (await navOf(casey).locator(".nav-count").count()) === 0);

  await goToSection(casey, "People", "2.1 Wages");
  const approvalStyle = await casey.locator(".approval").evaluate((el) => getComputedStyle(el).fontWeight);
  check("Wages shows a bold Approved by Kale and Casey", (await casey.locator(".approval").innerText()) === approvedBoth && Number(approvalStyle) >= 700, await casey.locator(".approval").innerText());
  check("Wages shows the new text", (await casey.locator(".official-box .rich p").allInnerTexts()).join("|") === WAGES_NEW.join("|"));
  check("the waiting notice is gone from the section", (await casey.getByText("Waiting for approval:").count()) === 0);
  await shot(casey, "p3-desktop-05-section-approved", { fullPage: true });
  await casey.getByRole("link", { name: "Version history" }).click();
  await casey.getByRole("heading", { level: 1, name: "Version history" }).waitFor();
  const wagesVersions = casey.locator(".version-list > li");
  check("version history has a new version tied to the proposal", (await wagesVersions.count()) === 2 && (await wagesVersions.nth(0).getByRole("heading", { name: "Version 2 (current)" }).isVisible()) && (await wagesVersions.nth(0).getByRole("link", { name: WAGES_TITLE }).isVisible()) && (await wagesVersions.nth(0).getByText(approvedBoth).isVisible()));
  check("the earlier version says when it was official and how it came about", (await wagesVersions.nth(1).getByText(`Official from ${shortDate(daysAgo(25))} to ${today.short}`).isVisible()) && (await wagesVersions.nth(1).getByText("Edited directly by Kale").isVisible()));
  await wagesVersions.nth(0).getByRole("link", { name: WAGES_TITLE }).click();
  await casey.getByRole("heading", { level: 1, name: WAGES_TITLE }).waitFor();
  check("the version links back to its proposal", casey.url() === wagesUrl);

  await goTo(casey, "Proposals");
  check("an approved proposal is no longer listed as waiting", await casey.getByRole("region", { name: "Awaiting approval (0)" }).getByText("Nothing is waiting for approval.").isVisible());
  await casey.getByRole("link", { name: "Decisions Log" }).click();
  await casey.getByRole("heading", { level: 1, name: "Decisions Log" }).waitFor();
  const decisions = (page) => page.getByRole("list", { name: "Decisions" }).getByRole("listitem");
  const wagesDecision = decisions(casey).filter({ hasText: WAGES_TITLE });
  check("the Decisions Log lists it with both names", (await wagesDecision.getByText(approvedBoth).isVisible()) && (await wagesDecision.getByText(`${today.short} · 2.1 Wages · Decision · Coffee Shop`).isVisible()), await wagesDecision.innerText().catch(() => "missing"));
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
  check("the proposal shows Approved by Kale", await eventually(async () => (await statusOf(kale).innerText()) === approvedKale), await statusOf(kale).innerText());
  await goToSection(kale, "People", "2.2 Benefits");
  check("the section shows Approved by Kale", (await kale.locator(".approval").innerText()) === approvedKale && (await kale.locator(".official-box .rich").innerText()) === DISCOUNT_TEXT);
  check("the one who decided alone has no I approve too", (await kale.getByRole("button", { name: /^I approve too/ }).count()) === 0);

  await goTo(casey, "Today");
  const flagged = casey.getByRole("region", { name: /^Decided by one person/ });
  await casey.getByRole("heading", { level: 2, name: "Decided by one person (1)" }).waitFor();
  const discountFlag = flagged.getByRole("listitem").filter({ hasText: DISCOUNT_TITLE });
  const flagLine = discountFlag.getByText(`Decided by Kale alone, ${today.short}`);
  check("Casey's Today flags it as Decided by Kale alone", await flagLine.isVisible());
  check("the flag stands out in bold", Number(await flagLine.evaluate((el) => getComputedStyle(el).fontWeight)) >= 700);
  check("Today explains the list", await flagged.getByText("Approved by one Owner in the last 14 days.").isVisible());
  await shot(casey, "p3-desktop-06-today-flagged");
  await flagged.getByRole("button", { name: `I approve too: ${DISCOUNT_TITLE}` }).click();
  await casey.getByRole("heading", { level: 2, name: "Decided by one person (0)" }).waitFor();
  check("after I approve too it leaves the flagged list", (await flagged.getByText(DISCOUNT_TITLE).count()) === 0);
  await goToSection(casey, "People", "2.2 Benefits");
  check("the section now says Approved by Kale and Casey", (await casey.locator(".approval").innerText()) === approvedBoth);

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
  check("a direct save shows Approved by Kale", (await kale.locator(".approval").innerText()) === approvedKale);
  await goTo(casey, "Today");
  await casey.getByRole("heading", { level: 2, name: "Decided by one person (1)" }).waitFor();
  const directFlag = flagged.getByRole("listitem").filter({ hasText: "Edited directly: 3.2 Opening Procedures" });
  check("Casey's Today flags the direct edit by its section", (await directFlag.getByRole("link", { name: "Edited directly: 3.2 Opening Procedures" }).isVisible()) && (await directFlag.getByText(`Decided by Kale alone, ${today.short}`).isVisible()));
  await goTo(casey, "Proposals");
  check("a direct edit is not listed on the Proposals page", (await casey.getByText("Edited directly").count()) === 0);
  await casey.getByRole("link", { name: "Decisions Log" }).click();
  await casey.getByRole("heading", { level: 1, name: "Decisions Log" }).waitFor();
  const directDecision = decisions(casey).filter({ hasText: "Edited directly: 3.2 Opening Procedures" });
  check("the Decisions Log lists the direct edit with who approved it", await directDecision.getByText(approvedKale).isVisible());
  await directDecision.getByRole("link", { name: "Edited directly: 3.2 Opening Procedures" }).click();
  await casey.getByRole("heading", { level: 1, name: "Edited directly: 3.2 Opening Procedures" }).waitFor();
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
  check("the edit form shows the kind and section without letting them change", (await editForm.getByText("A decision").isVisible()) && (await editForm.getByText("2.3 Hiring").isVisible()) && (await editForm.getByRole("link", { name: "Change the section" }).count()) === 0 && (await editForm.getByRole("radio", { name: /decision|Wording|Sections/ }).count()) === 0);
  check("the edit form is filled in with the title", (await editForm.getByLabel("Title", { exact: true }).inputValue()) === HIRING_TITLE);
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
  check("after reloading she can approve", await eventually(async () => (await statusOf(casey).innerText()) === approvedBoth), await statusOf(casey).innerText());

  // ------------------------------------------------------------------
  section("9. A proposal made from a note in the Daily Log");
  await navOf(kale).getByRole("link", { name: "New note" }).click();
  await kale.getByRole("heading", { level: 1, name: today.long }).waitFor();
  const noteBox = kale.getByRole("textbox", { name: "New note" });
  await noteBox.waitFor();
  await noteBox.click();
  await kale.keyboard.type(NOTE);
  await kale.getByRole("button", { name: "Save", exact: true }).click();
  const kaleNote = kale.getByRole("article", { name: /^Note by Kale/ }).filter({ hasText: "coffee staff" });
  await kaleNote.waitFor();
  await kale.getByRole("button", { name: "Cancel" }).click();
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
  await fromNotes.getByRole("link", { name: `Daily Log, ${today.short}` }).click();
  await kale.getByRole("heading", { level: 1, name: today.long }).waitFor();
  check("the note's link goes to its day", /\/daily-log\/\d{4}-\d{2}-\d{2}#note-[0-9a-f-]{36}$/.test(kale.url()) && kale.url().includes(today.key), kale.url());
  const noteLine = kaleNote.locator(".note-proposal");
  check("the note says a proposal was made from it and where it stands", (await noteLine.innerText()) === `Proposal: ${WEEKEND_TITLE} (waiting for approval)`, await noteLine.innerText().catch(() => "missing"));
  await noteLine.getByRole("link", { name: WEEKEND_TITLE }).click();
  await kale.getByRole("heading", { level: 1, name: WEEKEND_TITLE }).waitFor();
  check("the note's proposal line opens the proposal", kale.url() === weekendUrl);
  await shot(kale, "p3-desktop-07-proposal-from-note", { fullPage: true });

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
  await karen.getByRole("heading", { level: 1, name: today.long }).waitFor();
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
  check("an Advisor can read the Decisions Log", (await decisions(karen).filter({ hasText: WAGES_TITLE }).getByText(approvedBoth).isVisible()) && (await ownerControls(karen)) === 0);

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
  await openEndorsement.waitFor();
  const faint = (locator) =>
    locator.evaluate((el) => {
      const style = getComputedStyle(el);
      return { italic: style.fontStyle === "italic", size: parseFloat(style.fontSize), body: parseFloat(getComputedStyle(document.body).fontSize) };
    });
  let look = await faint(openEndorsement);
  check("her endorsement of an open proposal shows as Endorsed by Karen with the date", (await openEndorsement.innerText()) === `Endorsed by Karen, ${today.short}`);
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
  check("she can endorse approved official text: Endorsed by Karen shows under the approval line", (await officialEndorsement.innerText()) === `Endorsed by Karen, ${today.short}`);
  check("on the section the endorsement is italic and smaller than the body text", look.italic && look.size < look.body, JSON.stringify(look));
  const under = await karen.evaluate(() => document.querySelector(".official-box .approval").getBoundingClientRect().bottom <= document.querySelector(".official-box .endorsements").getBoundingClientRect().top);
  check("the endorsement sits below the bold approval line", under);
  check("her endorsement does not change the approval", (await karen.locator(".approval").innerText()) === approvedBoth);
  await shot(karen, "p3-desktop-09-advisor-section", { fullPage: true });
  await karen.goto(wagesUrl);
  await karen.getByRole("heading", { level: 1, name: WAGES_TITLE }).waitFor();
  check("an approved proposal shows her endorsement and no Owner controls", (await karen.getByRole("region", { name: "Approvals" }).locator(".endorsements").innerText()) === `Endorsed by Karen, ${today.short}` && (await ownerControls(karen)) === 0 && (await statusOf(karen).innerText()) === approvedBoth);
  check("comments stay possible after a decision", await karen.getByRole("button", { name: "Add comment", exact: true }).isVisible());

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
  check("the proposal shows Declined by Casey", await eventually(async () => (await statusOf(casey).innerText()) === `Declined by Casey, ${today.short}`), await statusOf(casey).innerText());
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
  check("the proposal shows Withdrawn by Kale", await eventually(async () => (await statusOf(kale).innerText()) === `Withdrawn by Kale, ${today.short}`), await statusOf(kale).innerText());
  await goTo(kale, "Proposals");
  const closed = kale.getByRole("region", { name: "Declined or withdrawn" }).getByRole("listitem");
  check("both are listed under Declined or withdrawn, newest first", (await closed.count()) === 2 && (await closed.nth(0).getByText(`Withdrawn by Kale, ${today.short}`).isVisible()) && (await closed.nth(1).getByText(`Declined by Casey, ${today.short}`).isVisible()));
  check("the list shows kind, section and proposer", await closed.nth(1).getByText(`Decision · 2.4 Training · proposed by Kale, ${today.short}`).isVisible());
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
  await kale.reload();
  await kale.getByRole("heading", { level: 1, name: "3.3 Closing Procedures" }).waitFor();
  check("Casey's text is the official one", (await kale.locator(".official-box .rich").innerText()) === CASEY_CLOSING);
  await kale.getByRole("button", { name: "Continue editing" }).click();
  await kaleOfficial.waitFor();
  check("after reloading, Kale's unsaved text can still be picked up", (await kaleOfficial.innerText()).trim() === KALE_CLOSING);
  await kale.getByRole("button", { name: "Cancel" }).click();
  await kale.getByRole("button", { name: "Discard changes" }).click();
  await kale.getByRole("button", { name: "Edit official" }).waitFor();

  // ------------------------------------------------------------------
  section("8. Proposals about sections");
  await goTo(kale, "Proposals");
  await kale.getByRole("link", { name: "New proposal" }).click();
  await kale.getByRole("heading", { level: 1, name: "New proposal" }).waitFor();
  const structureForm = newForm(kale);
  await structureForm.getByRole("radio", { name: "Sections" }).check();
  check("Sections offers add, rename, move and archive", (await structureForm.getByRole("group", { name: "What do you want to change?" }).getByRole("radio").count()) === 4 && (await structureForm.getByRole("radio", { name: "Add a section" }).isChecked()));
  await structureForm.getByLabel("Under").selectOption({ label: "4 Departments" });
  await structureForm.getByLabel("Name", { exact: true }).fill("Greenhouse");
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
  await casey.getByText("Approved. It is official now.").waitFor();
  const newSectionLink = casey.getByRole("main").getByRole("link", { name: "4.8 Greenhouse" });
  await newSectionLink.waitFor();
  check("the approved proposal links to the new section", true);
  await navOf(casey).getByRole("button", { name: "Show subsections of Departments" }).click();
  check("the new section appears in the sidebar with its number", await navOf(casey).getByRole("link", { name: "4.8 Greenhouse" }).isVisible());
  await newSectionLink.click();
  await casey.getByRole("heading", { level: 1, name: "4.8 Greenhouse" }).waitFor();
  check("the link opens the new section", true);

  await goTo(kale, "Proposals");
  await kale.getByRole("link", { name: "New proposal" }).click();
  await kale.getByRole("heading", { level: 1, name: "New proposal" }).waitFor();
  await structureForm.getByRole("radio", { name: "Sections" }).check();
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
  check("a rename approved on Kale's own is approved", await eventually(async () => (await statusOf(kale).innerText()) === approvedKale), await statusOf(kale).innerText());
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
  check("restoring adds a new version that says where it came from", (await hoursVersions.count()) === 3 && (await hoursVersions.nth(0).getByText("Restored from version 1 by Kale").isVisible()) && (await hoursVersions.nth(0).getByText(approvedKale).isVisible()));
  check("the restored version's own text now has no Restore", (await kale.getByRole("button", { name: /^Restore/ }).count()) === 0);
  await kale.getByRole("link", { name: "3.1 Store Hours" }).first().click();
  await kale.getByRole("heading", { level: 1, name: "3.1 Store Hours" }).waitFor();
  check("the section shows the old text again, approved by Kale", (await kale.locator(".official-box .rich p").allInnerTexts()).join("|") === HOURS_V1.join("|") && (await kale.locator(".approval").innerText()) === approvedKale);

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
  // Today: wages, discount, opening, hiring, closing, greenhouse, rename, restore. Seeded: three.
  check("the log lists every approved decision, newest first", allCount === 11 && everything.startsWith("Restored version 1: 3.1 Store Hours|Rename 5.2 Signage to \"Signs\"|"), `${allCount}: ${everything}`);
  await shot(kale, "p3-desktop-13-decisions-log", { fullPage: true });
  await kale.getByText("Filters", { exact: true }).click();
  const filterForm = kale.locator("details.filters-plain");
  await filterForm.getByLabel("Section").selectOption({ label: "2 People" });
  await filterForm.getByRole("button", { name: "Apply" }).click();
  await kale.waitForURL(/section=/);
  check("filtering by a section includes its subsections and leaves out the rest", (await eventually(async () => (await titles()) === [HIRING_TITLE, DISCOUNT_TITLE, WAGES_TITLE, "Edited directly: 2.1 Wages"].join("|"))), await titles());
  check("the filters stay open while in use", (await kale.locator("details.filters-plain[open]").count()) === 1 && (await kale.getByText("Filters (in use)").isVisible()));
  await kale.getByRole("link", { name: "Clear" }).click();
  await kale.waitForURL(`${BASE_URL}/proposals/decisions`);
  check("Clear brings everything back", await eventually(async () => (await titles()) === everything), await titles());
  await kale.getByText("Filters", { exact: true }).click();
  await filterForm.getByLabel("Approved by").selectOption({ label: "Casey" });
  await filterForm.getByRole("button", { name: "Apply" }).click();
  await kale.waitForURL(/approver=/);
  check("filtering by approver shows only what Casey approved", await eventually(async () => (await titles()) === ['Add a section "Greenhouse" under 4 Departments', "Edited directly: 3.3 Closing Procedures", HIRING_TITLE, DISCOUNT_TITLE, WAGES_TITLE, "Edited directly: 3.1 Store Hours"].join("|")), await titles());
  await filterForm.getByLabel("Approved by").selectOption({ label: "Anyone" });
  await filterForm.getByLabel("From").fill(dateKey(daysAgo(61)));
  await filterForm.getByLabel("To", { exact: true }).fill(dateKey(daysAgo(15)));
  await filterForm.getByRole("button", { name: "Apply" }).click();
  await kale.waitForURL(/from=/);
  check("filtering by dates shows only decisions from those days", await eventually(async () => (await titles()) === ["Edited directly: 3.1 Store Hours", "Edited directly: 2.1 Wages", "Edited directly: 3.1 Store Hours"].join("|")), await titles());
  await filterForm.getByLabel("From").fill("2020-01-01");
  await filterForm.getByLabel("To", { exact: true }).fill("2020-01-31");
  await filterForm.getByRole("button", { name: "Apply" }).click();
  await kale.getByText("No decisions match these filters.").waitFor();
  check("filters with no match say so", true);
  await kale.getByRole("link", { name: "Clear" }).click();
  check("Clear brings everything back again", await eventually(async () => (await titles()) === everything), await titles());

  // ------------------------------------------------------------------
  section("12. Search finds proposals");
  await navOf(kale).getByRole("searchbox", { name: "Search" }).fill("starting wage");
  await kale.keyboard.press("Enter");
  await kale.getByRole("heading", { level: 1, name: "Search" }).waitFor();
  const proposalHits = kale.getByRole("region", { name: "Proposals" });
  check("search finds a proposal by words from its title", await proposalHits.getByRole("link", { name: WAGES_TITLE }).isVisible());
  check("the result shows its status, proposer and date", await proposalHits.getByRole("listitem").filter({ hasText: WAGES_TITLE }).getByText(`Approved · proposed by Kale, ${today.short}`).isVisible());
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
  section("14. Phone");
  const phone = await phoneContext(browser);
  const mobile = await phone.newPage();
  trackErrors(mobile, errors);
  await signIn(mobile, "casey@example.com");
  const fits = async (name) => {
    const overflow = await sidewaysOverflow(mobile);
    check(`${name} fits a phone without sideways scrolling`, overflow <= 0, `overflow ${overflow}px`);
  };
  await shot(mobile, "p3-phone-01-today", { fullPage: true });
  await fits("Today");
  // Today is the page the app opens on: from there it is tap the proposal, read, tap Approve.
  let taps = 0;
  const mobileAwaiting = mobile.getByRole("region", { name: /^Awaiting approval/ });
  const waitingLink = mobileAwaiting.getByRole("link", { name: REGISTERS_TITLE });
  check("on a phone the waiting proposal is easy to tap", (await height(waitingLink)) >= 36, String(await height(waitingLink)));
  await waitingLink.tap();
  taps += 1;
  await mobile.getByRole("heading", { level: 1, name: REGISTERS_TITLE }).waitFor();
  check("on a phone the differences are shown", (await mobile.locator(".diff del").innerText()) === "$15.00/hr." && (await mobile.locator(".diff ins").innerText()) === "$16.00/hr.");
  check("on a phone the comment and the endorsement are shown", (await mobile.getByRole("list", { name: "Comments on this proposal" }).getByText("Karen here").isVisible()) && (await mobile.getByText(`Endorsed by Karen, ${today.short}`).isVisible()));
  await shot(mobile, "p3-phone-02-proposal", { fullPage: true });
  await fits("A proposal with differences and comments");
  const mobileApprove = approveButton(mobile);
  check("on a phone Approve is a full-size button", (await height(mobileApprove)) >= 44, String(await height(mobileApprove)));
  await mobileApprove.scrollIntoViewIfNeeded();
  await mobileApprove.tap();
  taps += 1;
  await mobile.getByText("Approved. It is official now.").waitFor();
  check("on a phone, approving from Today takes three taps or fewer", taps <= 3 && (await eventually(async () => (await statusOf(mobile).innerText()) === approvedBoth)), `${taps} taps, ${await statusOf(mobile).innerText()}`);
  await mobile.evaluate(() => window.scrollTo(0, 0));
  await shot(mobile, "p3-phone-03-proposal-approved", { fullPage: true });

  await mobile.getByRole("button", { name: "Open menu" }).click();
  const mobileNav = navOf(mobile);
  await shot(mobile, "p3-phone-04-menu-count");
  check("on a phone the menu shows the number waiting", await mobileNav.getByRole("link", { name: "Proposals, 1 waiting" }).isVisible());
  await mobileNav.getByRole("link", { name: "Proposals, 1 waiting" }).click();
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
  await mobileForm.getByRole("radio", { name: "Sections" }).check();
  await mobileForm.getByRole("radio", { name: "Move a section" }).check();
  await mobileForm.getByLabel("Section", { exact: true }).selectOption({ label: "4.8 Greenhouse" });
  await mobile.evaluate(() => window.scrollTo(0, 0));
  await shot(mobile, "p3-phone-09-new-section-proposal", { fullPage: true });
  await fits("The new proposal form (sections)");
  await mobilePropose.scrollIntoViewIfNeeded();
  check("on a phone the Propose button of the sections form can be reached", await inView(mobilePropose));
  await mobileForm.getByRole("radio", { name: "A decision" }).check();
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

  check("no errors were reported by the browser", errors.length === 0, errors.slice(0, 3).join(" | "));
  await browser.close();
}

run(main);
