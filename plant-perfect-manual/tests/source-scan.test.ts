import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The database decides who may do what from the signed-in person's id, which
 * the app states at the start of every request. That only holds while no
 * database command is ever built by gluing text together: every value the
 * app sends goes as a separate, labelled value, never as part of the
 * command. The two functions that would allow gluing (`sql.raw` and
 * `.unsafe`) are therefore not used anywhere in the app, with one exception:
 * the fixed time-zone name in src/lib/sqltime.ts.
 */

const SRC = path.join(process.cwd(), "src");
const ALLOWED = new Set(["src/lib/sqltime.ts"]);
const FORBIDDEN = ["sql.raw(", ".unsafe("];

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
    for (const file of files) {
      const text = await readFile(file, "utf8");
      for (const call of FORBIDDEN) {
        // Written with any spacing: sql.raw(, sql . raw (, client.unsafe (
        const pattern = new RegExp(
          call
            .split(/([.(])/)
            .filter(Boolean)
            .map((piece) => (piece === "." || piece === "(" ? `\\s*\\${piece}\\s*` : piece))
            .join(""),
        );
        if (pattern.test(text)) uses.push(`${path.relative(process.cwd(), file).split(path.sep).join("/")}: ${call}`);
      }
    }
    // The one use that is allowed is found (so the search works), and it is the only one.
    expect(uses).toEqual([...ALLOWED].map((file) => `${file}: sql.raw(`));
  });
});
