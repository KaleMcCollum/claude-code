import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The database decides who may do what from the signed-in person's id, which
 * the app states at the start of every request. That only holds while no
 * database command is ever built by gluing text together: every value the
 * app sends goes as a separate, labelled value, never as part of the
 * command.
 *
 * This scan is a tripwire, not a guarantee. It looks through the app's
 * source for the three ways of running glued-together text that the
 * database library offers, and fails when it finds one:
 *  - `sql.raw(...)` (one use is allowed: the fixed time-zone name in
 *    src/lib/sqltime.ts);
 *  - `.unsafe(...)`;
 *  - `.execute(...)` given anything other than a `sql` template written
 *    right there (it also accepts plain text).
 * It reads the source as text, so code written to get around it (the
 * library imported under another name, say) would slip past. It is there to
 * catch an honest mistake, and to make whoever adds such a line stop and
 * think.
 */

const SRC = path.join(process.cwd(), "src");
const ALLOWED = new Set(["src/lib/sqltime.ts"]);
const FORBIDDEN = ["sql.raw(", ".unsafe("];

/** `sql.raw(` and `.unsafe(`, written with any spacing: sql.raw(, sql . raw (, client.unsafe ( */
const forbiddenPatterns = FORBIDDEN.map((call) => ({
  call,
  pattern: new RegExp(
    call
      .split(/([.(])/)
      .filter(Boolean)
      .map((piece) => (piece === "." || piece === "(" ? `\\s*\\${piece}\\s*` : piece))
      .join(""),
  ),
}));

/**
 * Every `.execute(` in `text` whose first argument is not a `sql` template
 * written in place. Hands back the start of each such call.
 */
function executesWithoutTemplate(text: string): string[] {
  const found: string[] = [];
  for (const match of text.matchAll(/\.\s*execute\s*\(/g)) {
    const after = text.slice(match.index + match[0].length);
    if (!/^\s*sql`/.test(after)) found.push(`${match[0]}${after.slice(0, 30).split("\n")[0]}`);
  }
  return found;
}

async function sourceFiles(folder: string): Promise<string[]> {
  const found: string[] = [];
  for (const entry of await readdir(folder, { withFileTypes: true })) {
    const full = path.join(folder, entry.name);
    if (entry.isDirectory()) found.push(...(await sourceFiles(full)));
    else if (/\.(ts|tsx|js|jsx|mjs|cjs)$/.test(entry.name)) found.push(full);
  }
  return found;
}

describe("the app's source", () => {
  it("never builds a database command from pieces of text", async () => {
    const files = await sourceFiles(SRC);
    expect(files.length).toBeGreaterThan(50);
    const uses: string[] = [];
    let executesWithTemplate = 0;
    for (const file of files) {
      const text = await readFile(file, "utf8");
      const name = path.relative(process.cwd(), file).split(path.sep).join("/");
      for (const { call, pattern } of forbiddenPatterns) {
        if (pattern.test(text)) uses.push(`${name}: ${call}`);
      }
      for (const call of executesWithoutTemplate(text)) uses.push(`${name}: ${call}`);
      executesWithTemplate += [...text.matchAll(/\.\s*execute\s*\(\s*sql`/g)].length;
    }
    // The one use that is allowed is found (so the search works), and it is the only one.
    expect(uses).toEqual([...ALLOWED].map((file) => `${file}: sql.raw(`));
    // The app does run commands with `.execute(sql\`...\`)`, so that search works too.
    expect(executesWithTemplate).toBeGreaterThanOrEqual(2);
  });

  it("the search for commands given as plain text notices each way of writing one", () => {
    const glued = [
      "await tx.execute(`select * from users where name = '${name}'`);",
      'await db.execute("select 1");',
      "await db.execute('select ' + column + ' from users');",
      "await tx . execute ( query );",
      "await tx.execute(\n  command,\n);",
      // Not a template written in place either: the library's own way of gluing.
      "await tx.execute(sql.raw(text));",
      "await tx.execute(sqlText);",
    ];
    for (const line of glued) expect(executesWithoutTemplate(line), line).toHaveLength(1);
    const fine = [
      "await tx.execute(sql`select set_config('app.user_id', ${userId}, true)`);",
      "await tx.execute(\n      sql`set local role ppf_app`,\n    );",
      "await tx . execute ( sql`select 1` );",
      "const executed = true; // nothing is run here",
    ];
    for (const line of fine) expect(executesWithoutTemplate(line), line).toEqual([]);
    expect(executesWithoutTemplate(`${fine[0]}\n${glued[0]}\n${glued[3]}`)).toHaveLength(2);
  });
});

/**
 * The editor hands out the settings of a block or of a link (a link's
 * address, a ticked checkbox, the size of a heading) as objects of a special
 * kind. Sent to the app as they are, those settings are silently left out,
 * and the link is saved as plain words. So the editor's document is read in
 * exactly one place, `docOf` in src/components/RichTextEditor.tsx, which
 * turns it into plain data first. The browser test saves a link, a checkbox
 * and a small heading (e2e/phase3.cjs, part 19); this is the tripwire for a
 * second place that reads the document directly.
 */
describe("the editor's document", () => {
  it("is read in one place only, which turns it into plain data", async () => {
    const reads: string[] = [];
    for (const file of await sourceFiles(SRC)) {
      const text = await readFile(file, "utf8");
      const name = path.relative(process.cwd(), file).split(path.sep).join("/");
      for (const match of text.matchAll(/\.\s*getJSON\s*\(/g)) {
        const line = text.slice(text.lastIndexOf("\n", match.index) + 1, text.indexOf("\n", match.index)).trim();
        reads.push(`${name}: ${line}`);
      }
    }
    expect(reads).toEqual([
      "src/components/RichTextEditor.tsx: return JSON.parse(JSON.stringify(editor.getJSON())) as RichDoc;",
    ]);
  });
});
