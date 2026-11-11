/**
 * Browser test for Phase 2 (Capture): the Daily Log, notes, sorting notes
 * into sections, the Discussion on section pages, comments, Today, search.
 * Run with scripts/run-e2e.sh (see e2e/helpers.cjs). The earlier day's note
 * comes from e2e/phase2.seed.ts.
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

const SCANNERS = "We need to figure out what scanners to use for line busters";
const ODD = "12 * 4 * 2 shelves, _final_ price   $4,200 -- call *Holly*";
const ESPRESSO = "Espresso machine needs its own card reader";
const SQUARE = "Ask Square about one account for both businesses";
const SQUARE_ADDED = " (Casey says two)";
const UNSAVED = "Half a thought about mulch pricing";
const MULCH = "Mulch delivery moved to Friday";
const PERMIT = "Casey here: the pylon sign permit came through";
const COMMENT = "Ask the vendor which scanners they support before buying any.";
const PHONE_NOTE = "Typed on the phone: order more hose reels";
const EARLIER_NOTE = "Walked the lot with the paving crew, they start after the frost";

const DAY_MS = 24 * 60 * 60 * 1000;
const central = (date, options, locale = "en-US") =>
  new Intl.DateTimeFormat(locale, { timeZone: "America/Chicago", ...options }).format(date);
const longDate = (date) => central(date, { weekday: "long", month: "long", day: "numeric", year: "numeric" });
const shortDate = (date) => central(date, { month: "short", day: "numeric", year: "numeric" });
const dateKey = (date) => central(date, { year: "numeric", month: "2-digit", day: "2-digit" }, "en-CA");

const TIME = String.raw`\d{1,2}:\d{2}\s[AP]M`;
const DATE_TIME = String.raw`[A-Z][a-z]{2} \d{1,2}, \d{4}, ${TIME}`;

/** The note block that holds these words. */
const noteWith = (scope, words) =>
  scope.getByRole("article", { name: /^Note by/ }).filter({ hasText: words });

/** The words of every note on the page, in the order shown. */
const noteTexts = (scope) => scope.locator("article.note > .rich").allInnerTexts();

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

const newNoteBox = (page) => page.getByRole("textbox", { name: "New note" });
const hasCursor = (box) => box.evaluate((el) => el === document.activeElement);
const isEmptyBox = (box) => box.evaluate((el) => el.textContent === "");

/** Open a subsection from the sidebar, unfolding its parent first if needed. */
async function goToSection(page, nav, parent, name) {
  const link = nav.getByRole("link", { name });
  if (!(await link.isVisible())) {
    await nav.getByRole("button", { name: `Show subsections of ${parent}` }).click();
  }
  await link.click();
  await page.getByRole("heading", { level: 1, name }).waitFor();
}

/** Type a note into the open note box and save it. */
async function writeNote(page, words, { keys = false } = {}) {
  const box = newNoteBox(page);
  await box.click();
  await page.keyboard.type(words);
  if (keys) await page.keyboard.press("Control+Enter");
  else await page.getByRole("button", { name: "Save", exact: true }).click();
  await noteWith(page, words).waitFor();
  await eventually(() => isEmptyBox(box));
}

async function main() {
  const browser = await chromium.launch();
  const errors = [];
  const now = new Date();
  const today = { key: dateKey(now), long: longDate(now), short: shortDate(now) };
  const earlierDate = new Date(now.getTime() - 3 * DAY_MS);
  const earlier = { key: dateKey(earlierDate), long: longDate(earlierDate) };
  const yesterday = { long: longDate(new Date(now.getTime() - DAY_MS)) };

  const desktop = await desktopContext(browser);
  const page = await desktop.newPage();
  trackErrors(page, errors);

  section("Writing notes (Kale)");
  await signIn(page, "kale@example.com");
  const nav = page.getByRole("navigation", { name: "Main" });
  await nav.getByRole("link", { name: "New note" }).click();
  await page.getByRole("heading", { level: 1, name: today.long }).waitFor();
  const box = newNoteBox(page);
  await box.waitFor();
  check("New note opens the note box on today's log with the cursor in it", await eventually(() => hasCursor(box)));
  check("today's log keeps the plain address /daily-log/today", await eventually(() => page.url() === `${BASE_URL}/daily-log/today`), page.url());
  check("an empty day says so", await page.getByText("No notes on this day.").isVisible());
  await page.keyboard.type(SCANNERS);
  await shot(page, "p2-desktop-03-add-note");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  const scanners = noteWith(page, SCANNERS);
  await scanners.waitFor();
  const scannersShown = await scanners.locator(".rich").innerText();
  check("the note is shown word for word", scannersShown === SCANNERS, JSON.stringify(scannersShown));
  const scannersBy = await scanners.locator(".byline").innerText();
  check("the note shows the time and Kale's name", new RegExp(`^${TIME} · Kale$`).test(scannersBy), scannersBy);
  check("after Save the note box is empty and still open", (await eventually(() => isEmptyBox(box))) && (await box.isVisible()));
  check("the cursor is back in the note box for the next note", await hasCursor(box));
  check("a new note starts out unsorted", !(await scanners.getByRole("checkbox", { name: /^Sorted/ }).isChecked()));

  await writeNote(page, ODD);
  const odd = noteWith(page, "shelves");
  const oddShown = await odd.locator(".rich p").innerText();
  check("stars, underscores and extra spaces are kept exactly as typed", oddShown === ODD, JSON.stringify(oddShown));
  check("typed symbols are not turned into formatting", (await odd.locator(".rich em, .rich strong, .rich u").count()) === 0);

  await writeNote(page, ESPRESSO, { keys: true });
  check("Ctrl+Enter saves a note", await noteWith(page, ESPRESSO).isVisible());
  await writeNote(page, SQUARE);
  const order = (await noteTexts(page)).join("|");
  check("the day's notes are listed oldest first", order === [SCANNERS, ODD, ESPRESSO, SQUARE].join("|"), order);

  section("Unsaved words are kept on the device");
  await box.click();
  await page.keyboard.type(UNSAVED);
  await page.waitForTimeout(700);
  await page.reload();
  await box.waitFor();
  const restored = await box.innerText();
  check("typing, then reloading, brings the unsaved words back", restored.trim() === UNSAVED, JSON.stringify(restored));
  await page.getByRole("button", { name: "Cancel" }).click();
  await page.getByText("Throw away what you typed?").waitFor();
  await page.getByRole("button", { name: "Throw away" }).click();
  await page.getByRole("button", { name: "Add note" }).waitFor();
  await page.reload();
  await page.getByRole("button", { name: "Add note" }).waitFor();
  check("thrown-away words do not come back", (await box.count()) === 0);
  await nav.getByRole("link", { name: "New note" }).click();
  await box.waitFor();
  check("New note also works while today's log is already showing", await eventually(() => hasCursor(box)));
  await page.keyboard.type(MULCH);
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await noteWith(page, MULCH).waitFor();
  await eventually(() => isEmptyBox(box));
  await nav.getByRole("link", { name: "New note" }).click();
  check("pressing New note again puts the cursor back in the open box", await eventually(() => hasCursor(box)));

  section("Sorting a note");
  await scanners.getByRole("button", { name: /^Sort note/ }).click();
  const form = scanners.getByRole("form", { name: /^Sort note/ });
  await form.waitFor();
  await form.getByLabel("Find a section").pressSequentially("point");
  const pos = form.getByRole("checkbox", { name: "6.1 Point of Sale" });
  await pos.waitFor();
  check("typing in Find a section narrows the list", (await form.getByRole("group", { name: "Matching sections" }).getByRole("checkbox").count()) === 1);
  await pos.check();
  check("Mark as sorted ticks itself when the first section is chosen", await form.getByRole("checkbox", { name: "Mark as sorted" }).isChecked());
  await form.getByRole("radio", { name: "Garden Center" }).check();
  await shot(page, "p2-desktop-04-sorting");
  await form.getByRole("button", { name: "Save" }).click();
  await form.waitFor({ state: "detached" });
  await scanners.getByText("Filed under 6.1 Point of Sale").waitFor();
  check("the sorted note shows where it is filed", true);
  const facts = await scanners.locator(".note-facts").innerText();
  check("the sorted note shows its business", facts.startsWith("Garden Center"), facts);
  check("the sorted note has Sorted ticked", await scanners.getByRole("checkbox", { name: /^Sorted/ }).isChecked());

  // Two sections found by number; "Mark as sorted" unticked by hand.
  const espresso = noteWith(page, ESPRESSO);
  await espresso.getByRole("button", { name: /^Sort note/ }).click();
  const espressoForm = espresso.getByRole("form", { name: /^Sort note/ });
  await espressoForm.getByLabel("Find a section").fill("6.");
  await espressoForm.getByRole("checkbox", { name: "6.1 Point of Sale" }).check();
  await espressoForm.getByRole("checkbox", { name: "6.2 Coffee Equipment" }).check();
  await espressoForm.getByRole("checkbox", { name: "Mark as sorted" }).uncheck();
  await espressoForm.getByRole("radio", { name: "Coffee Shop" }).check();
  await espressoForm.getByRole("button", { name: "Save" }).click();
  await espresso.getByText("Filed under 6.1 Point of Sale, 6.2 Coffee Equipment").waitFor();
  check("a note can be filed under two sections and left unsorted", !(await espresso.getByRole("checkbox", { name: /^Sorted/ }).isChecked()));

  // Picked from the full list of sections.
  const square = noteWith(page, SQUARE);
  await square.getByRole("button", { name: /^Sort note/ }).click();
  const squareForm = square.getByRole("form", { name: /^Sort note/ });
  await squareForm.getByText("Show all sections").click();
  const all = squareForm.getByRole("group", { name: "All sections" });
  check("Show all sections lists every section", (await all.getByRole("checkbox").count()) === 39, String(await all.getByRole("checkbox").count()));
  await all.getByRole("checkbox", { name: "6.1 Point of Sale" }).check();
  await squareForm.getByRole("radio", { name: "Both" }).check();
  await squareForm.getByRole("button", { name: "Save" }).click();
  await square.getByText("Filed under 6.1 Point of Sale").waitFor();
  await page.evaluate(() => window.scrollTo(0, 0));
  await shot(page, "p2-desktop-02-day", { fullPage: true });

  section("Discussion on the section page");
  await scanners.getByRole("link", { name: "6.1 Point of Sale" }).click();
  await page.getByRole("heading", { level: 1, name: "6.1 Point of Sale" }).waitFor();
  const discussion = page.getByRole("region", { name: "Discussion" });
  const controls = page.getByRole("navigation", { name: "Discussion order and filter" });
  const thread = async (expected) => {
    const ok = await eventually(async () => (await noteTexts(discussion)).join("|") === expected.join("|"));
    return [ok, ok ? "" : (await noteTexts(discussion)).join("|")];
  };
  check("Discussion lists the notes filed here, newest first", ...(await thread([SQUARE, ESPRESSO, SCANNERS])));
  check("the page still has Official on top and Discussion below", (await page.getByRole("heading", { level: 2 }).allInnerTexts()).join("|") === "Official|Discussion");
  const filed = noteWith(discussion, SCANNERS);
  const filedShown = await filed.locator(".rich").innerText();
  check("Discussion shows the note word for word", filedShown === SCANNERS, JSON.stringify(filedShown));
  const filedBy = await filed.locator(".byline").innerText();
  check("Discussion shows the note's date, time and author", new RegExp(`^${DATE_TIME} · Kale$`).test(filedBy), filedBy);
  check("Discussion shows the note's business", (await filed.locator(".note-facts").innerText()).startsWith("Garden Center"));
  check("notes in Discussion cannot be sorted, edited or removed there", (await discussion.getByRole("button", { name: /^(Sort|Edit|Remove) note/ }).count()) === 0 && (await discussion.getByRole("checkbox").count()) === 0);
  await shot(page, "p2-desktop-05-discussion", { fullPage: true });

  await controls.getByRole("link", { name: "Oldest first" }).click();
  check("Oldest first turns the order around", ...(await thread([SCANNERS, ESPRESSO, SQUARE])));
  check("the order is kept in the address", page.url().endsWith("?order=oldest"), page.url());
  await controls.getByRole("link", { name: "Garden Center" }).click();
  check("the Garden Center filter shows Garden Center and Both notes", ...(await thread([SCANNERS, SQUARE])));
  check("the filter is kept in the address", page.url().endsWith("?order=oldest&business=garden_center"), page.url());
  await controls.getByRole("link", { name: "Coffee Shop" }).click();
  check("the Coffee Shop filter shows Coffee Shop and Both notes", ...(await thread([ESPRESSO, SQUARE])));
  await controls.getByRole("link", { name: "All", exact: true }).click();
  // Wait for the page to catch up, so the next link carries the new choice.
  await page.waitForURL((url) => url.search === "?order=oldest");
  await controls.getByRole("link", { name: "Newest first" }).click();
  check("All and Newest first bring the full list back", ...(await thread([SQUARE, ESPRESSO, SCANNERS])));

  await goToSection(page, nav, "Equipment and Technology", "6.2 Coffee Equipment");
  check("a note filed under two sections shows in both", ...(await thread([ESPRESSO])));
  await controls.getByRole("link", { name: "Garden Center" }).click();
  await discussion.getByText("No notes here match this filter.").waitFor();
  check("a filter with no matches says so", true);
  await goToSection(page, nav, "Equipment and Technology", "6.1 Point of Sale");
  await filed.getByRole("link", { name: `Daily Log, ${today.short}` }).click();
  await page.getByRole("heading", { level: 1, name: today.long }).waitFor();
  check("the link back goes to the note's day", /\/daily-log\/\d{4}-\d{2}-\d{2}#note-[0-9a-f-]{36}$/.test(page.url()) && page.url().includes(today.key), page.url());
  check("the link back lands on the note", await eventually(() => inView(scanners)));

  section("The other Owner (Casey)");
  const caseyContext = await desktopContext(browser);
  const casey = await caseyContext.newPage();
  trackErrors(casey, errors);
  await signIn(casey, "casey@example.com");
  const caseyNav = casey.getByRole("navigation", { name: "Main" });
  await caseyNav.getByRole("link", { name: "Daily Log", exact: true }).click();
  await casey.getByRole("heading", { level: 1, name: "Daily Log" }).waitFor();
  await casey.getByRole("link", { name: /^Today.s log$/ }).click();
  await casey.getByRole("heading", { level: 1, name: today.long }).waitFor();
  const caseyScanners = noteWith(casey, SCANNERS);
  await caseyScanners.waitFor();
  check("Casey has no Edit on Kale's note", (await caseyScanners.getByRole("button", { name: /^Edit note/ }).count()) === 0);
  const caseySorted = caseyScanners.getByRole("checkbox", { name: /^Sorted/ });
  await caseySorted.uncheck();
  await eventually(() => caseySorted.isEnabled());
  await casey.reload();
  await caseyScanners.waitFor();
  check("Casey can untick Sorted on Kale's note", !(await caseySorted.isChecked()));
  await caseyScanners.getByRole("button", { name: /^Sort note/ }).click();
  const caseyForm = caseyScanners.getByRole("form", { name: /^Sort note/ });
  check("the sorting form lists where the note is already filed, ticked", await caseyForm.getByRole("group", { name: "Filed under" }).getByRole("checkbox", { name: "6.1 Point of Sale" }).isChecked());
  check("the sorting form remembers the business", await caseyForm.getByRole("radio", { name: "Garden Center" }).isChecked());
  await caseyForm.getByLabel("Find a section").fill("registers");
  await caseyForm.getByRole("checkbox", { name: "4.1 Registers and Customer Service" }).check();
  check("Mark as sorted is left alone when a section was already chosen", !(await caseyForm.getByRole("checkbox", { name: "Mark as sorted" }).isChecked()));
  await caseyForm.getByRole("button", { name: "Save" }).click();
  await caseyScanners.getByText("Filed under 4.1 Registers and Customer Service, 6.1 Point of Sale").waitFor();
  check("Casey can sort Kale's note", true);
  await casey.getByRole("button", { name: "Add note" }).click();
  check("Add note at the bottom of today's log opens the note box with the cursor in it", await eventually(() => hasCursor(newNoteBox(casey))));
  await writeNote(casey, PERMIT);
  check("Casey has Edit on her own note", (await noteWith(casey, PERMIT).getByRole("button", { name: /^Edit note/ }).count()) === 1);

  section("Editing your own note (Kale)");
  await page.reload();
  await square.waitFor();
  await square.getByRole("button", { name: /^Edit note/ }).click();
  const editBox = page.getByRole("textbox", { name: /^Edit note/ });
  await editBox.waitFor();
  await eventually(() => hasCursor(editBox));
  check("Edit opens the note's own words in place", (await editBox.innerText()).trim() === SQUARE);
  await page.keyboard.type(SQUARE_ADDED);
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await editBox.waitFor({ state: "detached" });
  await square.getByText(new RegExp(`^Edited ${DATE_TIME}$`)).waitFor();
  check("an edited note says Edited with the date and time", (await square.locator(":scope > .rich").innerText()) === SQUARE + SQUARE_ADDED);
  await square.getByText(/^Edited /).click();
  const earlierWording = await square.locator(".note-revision .rich").innerText();
  check("the earlier wording can still be read", earlierWording === SQUARE, JSON.stringify(earlierWording));
  check("the earlier wording says when it was replaced", await square.getByText(new RegExp(`^Earlier wording, replaced ${DATE_TIME}$`)).isVisible());

  section("Advisor (Karen)");
  await nav.getByRole("link", { name: "Settings" }).click();
  await page.getByRole("heading", { level: 1, name: "Settings" }).waitFor();
  const inviteSince = Date.now();
  await page.getByLabel("Name or nickname").fill("Karen");
  await page.getByLabel("Email", { exact: true }).fill("karen@example.com");
  await page.locator('select[name="role"]').selectOption({ label: "Advisor" });
  await page.getByRole("button", { name: "Create user" }).click();
  await page.getByText("Karen was added.").waitFor();
  const invite = await latestEmail("karen@example.com", inviteSince);
  await page.getByRole("link", { name: "Back" }).click();
  await page.getByRole("heading", { level: 1, name: today.long }).waitFor();

  const karenContext = await desktopContext(browser);
  const karen = await karenContext.newPage();
  trackErrors(karen, errors);
  await karen.goto(linkIn(invite));
  await karen.getByRole("heading", { level: 1, name: "Today" }).waitFor();
  const forbidden = (scope) => scope.getByRole("button", { name: /^(Sort|Edit|Remove) note|^Add note$|^Restore/ }).count();
  const sortedBoxesLocked = (scope) =>
    scope.getByRole("checkbox", { name: /^Sorted/ }).evaluateAll((boxes) => boxes.length > 0 && boxes.every((el) => el.disabled));
  check("an Advisor sees the unsorted notes on Today", await noteWith(karen, SCANNERS).isVisible());
  check("an Advisor has no New note anywhere", (await karen.getByRole("link", { name: "New note" }).count()) === 0);
  check("an Advisor has no Sort, Edit or Remove on Today", (await forbidden(karen)) === 0);
  check("an Advisor cannot change Sorted on Today", await sortedBoxesLocked(karen));
  const karenNav = karen.getByRole("navigation", { name: "Main" });
  await karenNav.getByRole("link", { name: "Daily Log", exact: true }).click();
  await karen.getByRole("link", { name: /^Today.s log$/ }).click();
  await karen.getByRole("heading", { level: 1, name: today.long }).waitFor();
  const karenScanners = noteWith(karen, SCANNERS);
  await karenScanners.waitFor();
  check("an Advisor can read the Daily Log", (await noteTexts(karen)).length === 6, String((await noteTexts(karen)).length));
  check("an Advisor has no Add note, Sort, Edit or Remove in the Daily Log", (await forbidden(karen)) === 0);
  check("an Advisor cannot change Sorted in the Daily Log", await sortedBoxesLocked(karen));
  await karen.goto(`${BASE_URL}/daily-log/today?new=1`);
  await karenScanners.waitFor();
  check("the New note address shows an Advisor no note box", (await newNoteBox(karen).count()) === 0 && (await forbidden(karen)) === 0);
  await karenScanners.getByRole("button", { name: /^Add comment to note by Kale/ }).click();
  const commentBox = karen.getByRole("textbox", { name: /^Comment on note by Kale/ });
  await commentBox.waitFor();
  check("Add comment opens a small box in place with the cursor in it", await eventually(() => hasCursor(commentBox)));
  await karen.keyboard.type(COMMENT);
  await karen.getByRole("button", { name: "Save comment" }).click();
  const karenComments = karenScanners.getByRole("list", { name: /^Comments on/ });
  await karenComments.getByText(COMMENT).waitFor();
  const commentBy = await karenComments.locator(".byline").innerText();
  check("an Advisor's comment shows under the note with her name, date and time", new RegExp(`^${DATE_TIME} · Karen$`).test(commentBy), commentBy);
  check("the comment box closes after saving", (await commentBox.count()) === 0);
  await karen.evaluate(() => window.scrollTo(0, 0));
  await shot(karen, "p2-desktop-07-advisor-day", { fullPage: true });
  await karenScanners.getByRole("link", { name: "6.1 Point of Sale" }).click();
  await karen.getByRole("heading", { level: 1, name: "6.1 Point of Sale" }).waitFor();
  const karenDiscussion = karen.getByRole("region", { name: "Discussion" });
  check("an Advisor can read the Discussion", (await noteTexts(karenDiscussion)).length === 3);
  check("the comment also shows under the note in Discussion", await noteWith(karenDiscussion, SCANNERS).getByText(COMMENT).isVisible());
  check("an Advisor can comment from Discussion too", (await karenDiscussion.getByRole("button", { name: /^Add comment/ }).count()) === 3);
  check("an Advisor has no Sort, Edit, Remove or Sorted in Discussion", (await forbidden(karen)) === 0 && (await karenDiscussion.getByRole("checkbox").count()) === 0);
  check("an Advisor still has no Edit official", (await karen.getByRole("button", { name: "Edit official" }).count()) === 0);

  section("Today page");
  await nav.getByRole("link", { name: "Today", exact: true }).click();
  await page.getByRole("heading", { level: 1, name: "Today" }).waitFor();
  // Unsorted so far: the scanners note (Casey unticked it), the odd one,
  // espresso, mulch, Casey's permit note and the earlier day's note.
  await page.getByRole("heading", { level: 2, name: "Unsorted notes (6)" }).waitFor();
  check("Today counts the unsorted notes", true);
  const unsorted = page.getByRole("region", { name: /^Unsorted notes/ });
  const todayOrder = (await noteTexts(unsorted)).join("|");
  check("Today lists the unsorted notes in full, newest first", todayOrder === [PERMIT, MULCH, ESPRESSO, ODD, SCANNERS, EARLIER_NOTE].join("|"), todayOrder);
  const countdown = await page.locator(".today-opening").innerText();
  check("Today shows the opening countdown on one line", /^\d+ days until opening \(Mar 1, 2027\) Change$/.test(countdown), countdown);
  const todayBy = await noteWith(unsorted, MULCH).locator(".byline").innerText();
  check("notes on Today show their date, time and author", new RegExp(`^${DATE_TIME} · Kale$`).test(todayBy), todayBy);
  check("the comment shows under the note on Today as well", await noteWith(unsorted, SCANNERS).getByText(COMMENT).isVisible());
  await shot(page, "p2-desktop-06-today", { fullPage: true });
  const mulch = noteWith(unsorted, MULCH);
  await mulch.getByRole("button", { name: /^Sort note/ }).click();
  const mulchForm = mulch.getByRole("form", { name: /^Sort note/ });
  await mulchForm.getByLabel("Find a section").fill("order");
  await mulchForm.getByRole("checkbox", { name: "7.2 Order Deadlines" }).check();
  check("Mark as sorted ticks itself on Today too", await mulchForm.getByRole("checkbox", { name: "Mark as sorted" }).isChecked());
  await mulchForm.getByRole("button", { name: "Save" }).click();
  await page.getByRole("heading", { level: 2, name: "Unsorted notes (5)" }).waitFor();
  check("a note sorted on Today leaves the list", (await noteWith(unsorted, MULCH).count()) === 0);
  await noteWith(unsorted, PERMIT).getByRole("checkbox", { name: /^Sorted/ }).check();
  await page.getByRole("heading", { level: 2, name: "Unsorted notes (4)" }).waitFor();
  check("ticking Sorted on Today takes the note off the list", (await noteWith(unsorted, PERMIT).count()) === 0);

  section("Removing and restoring a note");
  await noteWith(unsorted, SCANNERS).getByRole("link", { name: `Daily Log, ${today.short}` }).click();
  await page.getByRole("heading", { level: 1, name: today.long }).waitFor();
  check("a note on Today links to its place in the Daily Log", await eventually(() => inView(scanners)));
  await scanners.getByRole("button", { name: /^Remove note/ }).click();
  await scanners.getByText("Remove this note? It is hidden, not deleted, and can be restored from this day’s log.").waitFor();
  await scanners.getByRole("button", { name: "Keep it" }).click();
  check("Keep it leaves the note alone", (await scanners.getByRole("button", { name: /^Remove note by/ }).count()) === 1);
  await scanners.getByRole("button", { name: /^Remove note/ }).click();
  await scanners.getByRole("button", { name: "Remove note", exact: true }).click();
  const reminder = page.getByText(new RegExp(String.raw`^A note by Kale was removed by Kale on [A-Z][a-z]{2} \d{1,2}, \d{4}\.`));
  await reminder.waitFor();
  check("a removed note disappears from the day", (await scanners.count()) === 0);
  check("the Owner sees a one-line reminder where it was", true);
  await shot(page, "p2-desktop-08-removed", { fullPage: true });
  await goToSection(page, nav, "Equipment and Technology", "6.1 Point of Sale");
  check("a removed note disappears from the Discussion", ...(await thread([SQUARE + SQUARE_ADDED, ESPRESSO])));
  await nav.getByRole("link", { name: "Today", exact: true }).click();
  await page.getByRole("heading", { level: 2, name: "Unsorted notes (3)" }).waitFor();
  check("a removed note disappears from Today's unsorted list", (await noteWith(unsorted, SCANNERS).count()) === 0);
  await karenNav.getByRole("link", { name: "Daily Log", exact: true }).click();
  await karen.getByRole("link", { name: /^Today.s log$/ }).click();
  await noteWith(karen, ODD).waitFor();
  check("an Advisor sees neither the removed note nor the reminder", (await karenScanners.count()) === 0 && (await karen.getByText(/was removed/).count()) === 0);
  await nav.getByRole("link", { name: "Daily Log", exact: true }).click();
  await page.getByRole("link", { name: /^Today.s log$/ }).click();
  await reminder.waitFor();
  await page.getByRole("button", { name: /^Restore the note by Kale/ }).click();
  await scanners.waitFor();
  check("Restore brings the note back in its place", (await noteTexts(page))[0] === SCANNERS);
  check("the restored note kept where it was filed", await scanners.getByText("Filed under 4.1 Registers and Customer Service, 6.1 Point of Sale").isVisible());
  check("the restored note kept its comments", await scanners.getByText(COMMENT).isVisible());

  section("Daily Log list");
  await nav.getByRole("link", { name: "Daily Log", exact: true }).click();
  await page.getByRole("heading", { level: 1, name: "Daily Log" }).waitFor();
  const days = page.getByRole("region", { name: "Days with notes" }).getByRole("listitem");
  const dayLines = (await days.allInnerTexts()).map((line) => line.replace(/\s+/g, " "));
  check("the list shows the days that have notes, newest first, with counts", dayLines.join("|") === `${today.long} 6 notes, 3 unsorted|${earlier.long} 1 note, 1 unsorted`, dayLines.join("|"));
  await page.evaluate(() => window.scrollTo(0, 0));
  await shot(page, "p2-desktop-01-daily-log");
  const dateField = page.getByLabel("Go to a date");
  await dateField.fill(earlier.key);
  check("picking a date does not leave the page by itself", page.url() === `${BASE_URL}/daily-log`);
  await page.getByRole("button", { name: "Go", exact: true }).click();
  await page.getByRole("heading", { level: 1, name: earlier.long }).waitFor();
  check("Go to a date opens that day", page.url() === `${BASE_URL}/daily-log/${earlier.key}` && (await noteWith(page, EARLIER_NOTE).isVisible()));
  const otherDays = page.getByRole("navigation", { name: "Other days" });
  check("the first day with notes has no Earlier link", (await otherDays.getByRole("link", { name: "Earlier day with notes" }).count()) === 0);
  check("an earlier day has no note box, only a link to today's log", (await page.getByRole("button", { name: "Add note" }).count()) === 0 && (await page.getByRole("link", { name: /^Add a note to today.s log$/ }).isVisible()));
  await otherDays.getByRole("link", { name: "Later day with notes" }).click();
  await page.getByRole("heading", { level: 1, name: today.long }).waitFor();
  check("Later day with notes goes to the next day that has notes", page.url() === `${BASE_URL}/daily-log/${today.key}`);
  check("today's log has no Later link", (await otherDays.getByRole("link", { name: "Later day with notes" }).count()) === 0);
  check("today's log reached by its date still has Add note", await page.getByRole("button", { name: "Add note" }).isVisible());
  await otherDays.getByRole("link", { name: "Earlier day with notes" }).click();
  await page.getByRole("heading", { level: 1, name: earlier.long }).waitFor();
  check("Earlier day with notes goes to the day before that has notes", page.url() === `${BASE_URL}/daily-log/${earlier.key}`);
  await page.getByRole("link", { name: /^Add a note to today.s log$/ }).click();
  await page.getByRole("heading", { level: 1, name: today.long }).waitFor();
  check("Add a note to today's log opens today's note box", await eventually(() => hasCursor(newNoteBox(page))));
  await otherDays.getByRole("link", { name: "All days" }).click();
  await page.getByRole("heading", { level: 1, name: "Daily Log" }).waitFor();
  await page.getByRole("link", { name: /^Yesterday.s log$/ }).click();
  await page.getByRole("heading", { level: 1, name: yesterday.long }).waitFor();
  check("a day without notes says so", await page.getByText("No notes on this day.").isVisible());
  await otherDays.getByRole("link", { name: "All days" }).click();
  await page.getByRole("heading", { level: 1, name: "Daily Log" }).waitFor();
  check("looking at an empty day does not add it to the list", (await days.count()) === 2);
  await dateField.fill("2099-01-01");
  await page.getByRole("button", { name: "Go", exact: true }).click();
  await page.getByText("That day has not happened yet. Choose today or an earlier date.").waitFor();
  check("the date field will not go to a future day", page.url() === `${BASE_URL}/daily-log`);
  await page.goto(`${BASE_URL}/daily-log/2099-01-01`);
  check("a future date in the address goes back to the list", page.url() === `${BASE_URL}/daily-log`, page.url());
  await page.goto(`${BASE_URL}/daily-log/not-a-date`);
  check("a bad address goes back to the list", page.url() === `${BASE_URL}/daily-log`, page.url());
  await page.goto(`${BASE_URL}/daily-log/2026-02-30`);
  check("a date that does not exist goes back to the list", page.url() === `${BASE_URL}/daily-log`, page.url());

  section("Search");
  await nav.getByRole("searchbox", { name: "Search" }).fill("scanner buster");
  await page.keyboard.press("Enter");
  await page.getByRole("heading", { level: 1, name: "Search" }).waitFor();
  const hit = page.getByRole("region", { name: "Notes" }).getByRole("link", { name: /^Note by Kale/ });
  check("search finds the note by two of its words", (await hit.count()) === 1 && (await page.getByText("to figure out what").isVisible()));
  await hit.click();
  await page.getByRole("heading", { level: 1, name: today.long }).waitFor();
  check("the search result lands on the note", /#note-[0-9a-f-]{36}$/.test(page.url()) && (await eventually(() => inView(scanners))), page.url());

  section("Phone");
  const phone = await phoneContext(browser);
  const mobile = await phone.newPage();
  trackErrors(mobile, errors);
  await signIn(mobile, "casey@example.com");
  await mobile.getByRole("button", { name: "Open menu" }).click();
  const mobileNav = mobile.getByRole("navigation", { name: "Main" });
  await mobileNav.getByRole("link", { name: "2 People" }).click();
  await mobile.getByRole("heading", { level: 1, name: "2 People" }).waitFor();
  // Three steps from any page: the plus, type, Save.
  await mobile.getByRole("link", { name: "New note" }).tap();
  const mobileBox = newNoteBox(mobile);
  await mobileBox.waitFor();
  check("on a phone the plus opens the note box with the cursor in it", await eventually(() => hasCursor(mobileBox)));
  await mobile.keyboard.type(PHONE_NOTE);
  const mobileSave = mobile.getByRole("button", { name: "Save", exact: true });
  check("on a phone Save is on screen without scrolling", (await inView(mobileSave)) && (await inView(mobileBox)));
  check("on a phone Save is a full-size button", (await height(mobileSave)) >= 44, String(await height(mobileSave)));
  await shot(mobile, "p2-phone-03-add-note");
  await mobileSave.tap();
  const phoneNote = noteWith(mobile, PHONE_NOTE);
  await phoneNote.waitFor();
  check("on a phone a note is added with the plus, typing and Save", true);
  check("on a phone the box is empty again with the cursor in it", (await eventually(() => isEmptyBox(mobileBox))) && (await hasCursor(mobileBox)));
  check("on a phone Save is still on screen for the next note", await eventually(() => inView(mobileSave)));
  await mobile.getByRole("button", { name: "Cancel" }).tap();
  await mobile.evaluate(() => window.scrollTo(0, 0));
  await shot(mobile, "p2-phone-02-day", { fullPage: true });
  let overflow = await sidewaysOverflow(mobile);
  check("a day with notes and comments fits a phone without sideways scrolling", overflow <= 0, `overflow ${overflow}px`);
  const mobileSorted = phoneNote.getByRole("checkbox", { name: /^Sorted/ });
  const sortedTap = await height(mobile.locator("article.note label.note-sorted").last());
  check("on a phone the Sorted checkbox is easy to tap", sortedTap >= 44, String(sortedTap));
  const sortTap = await height(phoneNote.getByRole("button", { name: /^Sort note/ }));
  check("on a phone the note buttons are easy to tap", sortTap >= 44, String(sortTap));
  await phoneNote.getByRole("button", { name: /^Sort note/ }).tap();
  const mobileForm = phoneNote.getByRole("form", { name: /^Sort note/ });
  await mobileForm.getByLabel("Find a section").fill("hard");
  await mobileForm.getByRole("checkbox", { name: "4.6 Hard Goods" }).check();
  await mobileForm.getByRole("radio", { name: "Garden Center" }).check();
  await mobileForm.getByRole("button", { name: "Save" }).scrollIntoViewIfNeeded();
  await shot(mobile, "p2-phone-04-sorting");
  overflow = await sidewaysOverflow(mobile);
  check("the sorting form fits a phone without sideways scrolling", overflow <= 0, `overflow ${overflow}px`);
  await mobileForm.getByText("Show all sections").tap();
  overflow = await sidewaysOverflow(mobile);
  check("the full list of sections fits a phone without sideways scrolling", overflow <= 0, `overflow ${overflow}px`);
  await mobileForm.getByRole("button", { name: "Save" }).tap();
  await phoneNote.getByText("Filed under 4.6 Hard Goods").waitFor();
  check("a note can be sorted on a phone", await mobileSorted.isChecked());
  const mobileScanners = noteWith(mobile, SCANNERS);
  await mobileScanners.getByRole("button", { name: /^Add comment/ }).tap();
  const mobileComment = mobile.getByRole("textbox", { name: /^Comment on note by Kale/ });
  await mobileComment.waitFor();
  await eventually(() => hasCursor(mobileComment));
  await mobile.keyboard.type("Casey: I will call them Monday.");
  check("on a phone Save comment is on screen without scrolling", await eventually(() => inView(mobile.getByRole("button", { name: "Save comment" }))));
  await shot(mobile, "p2-phone-07-comment");
  await mobile.getByRole("button", { name: "Save comment" }).tap();
  await mobileScanners.getByText("Casey: I will call them Monday.").waitFor();
  check("an Owner can comment on a phone", true);

  await mobile.getByRole("button", { name: "Open menu" }).click();
  await mobileNav.getByRole("link", { name: "Daily Log", exact: true }).click();
  await mobile.getByRole("heading", { level: 1, name: "Daily Log" }).waitFor();
  await shot(mobile, "p2-phone-01-daily-log", { fullPage: true });
  overflow = await sidewaysOverflow(mobile);
  check("the Daily Log list fits a phone without sideways scrolling", overflow <= 0, `overflow ${overflow}px`);
  await mobile.getByRole("button", { name: "Open menu" }).click();
  await goToSection(mobile, mobileNav, "Equipment and Technology", "6.1 Point of Sale");
  await mobile.getByRole("region", { name: "Discussion" }).scrollIntoViewIfNeeded();
  await shot(mobile, "p2-phone-05-discussion", { fullPage: true });
  overflow = await sidewaysOverflow(mobile);
  check("a section's Discussion fits a phone without sideways scrolling", overflow <= 0, `overflow ${overflow}px`);
  await mobile.getByRole("button", { name: "Open menu" }).click();
  await mobileNav.getByRole("link", { name: "Today", exact: true }).click();
  await mobile.getByRole("heading", { level: 1, name: "Today" }).waitFor();
  await shot(mobile, "p2-phone-06-today", { fullPage: true });
  overflow = await sidewaysOverflow(mobile);
  check("Today fits a phone without sideways scrolling", overflow <= 0, `overflow ${overflow}px`);
  await phone.close();

  check("no errors were reported by the browser", errors.length === 0, errors.slice(0, 3).join(" | "));
  await browser.close();
}

run(main);
