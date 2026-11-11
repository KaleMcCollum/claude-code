import { eq, sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { asSystem, asUser } from "@/db/client";
import { approvals, proposals, sections } from "@/db/schema";
import { AppError } from "@/lib/permissions";
import {
  UNREADABLE_CHANGE_SENTENCE,
  approveAlone,
  approveProposal,
  declineProposal,
  displayTitle,
  loadProposal,
} from "@/lib/proposals";
import { loadTree } from "@/lib/sections";
import { actorFor, withTestDatabase } from "./helpers/db";

withTestDatabase();

/**
 * A structure proposal whose stored change the app cannot read must change
 * nothing when someone approves it. (It used to archive the section.)
 *
 * The database refuses to store such a change in the first place. To show
 * that the app's own rule holds without leaning on that, this file takes the
 * database rule away in its own private test database.
 */
describe("a structure change the app cannot read", () => {
  it("is shown as unreadable, changes nothing when approved, and can be declined", async () => {
    const kale = await actorFor("kale@example.com");
    const casey = await actorFor("casey@example.com");
    const [hiring] = await asSystem((db) => db.select().from(sections).where(eq(sections.title, "Hiring")));
    await asSystem((db) => db.execute(sql`alter table proposals drop constraint proposals_structure_is_known`));

    const ids: string[] = [];
    for (const change of [{ action: "tidy" }, { action: "rename", title: 5 }, { action: "move" }, { action: "Archive" }]) {
      const [odd] = await asUser(kale.id, async (tx) => {
        const made = await tx
          .insert(proposals)
          .values({ type: "structure", title: "Tidy up the Hiring page", sectionId: hiring.id, structureChange: change, proposedBy: kale.id })
          .returning();
        await tx.insert(approvals).values({ proposalId: made[0].id, userId: kale.id, revision: 1 });
        return made;
      });
      ids.push(odd.id);
    }

    for (const id of ids) {
      const view = (await asSystem((db) => loadProposal(db, id)))!;
      // Its stored title is not taken on trust while it is open.
      expect(displayTitle(view, await asSystem((db) => loadTree(db)))).toBe(UNREADABLE_CHANGE_SENTENCE);

      const refused = await approveProposal(casey, id, { revision: 1 }).catch((error: unknown) => error);
      expect(refused).toBeInstanceOf(AppError);
      expect((refused as AppError).message).toBe(
        "This proposal's change could not be read, so nothing was changed. Decline it and make a new one.",
      );
      await expect(approveAlone(kale, id, { revision: 1 })).rejects.toThrow("could not be read, so nothing was changed");

      // Nothing happened: the section is as it was, the proposal is open,
      // and Casey's approval was undone together with the failed change.
      const [section] = await asSystem((db) => db.select().from(sections).where(eq(sections.id, hiring.id)));
      expect(section).toMatchObject({ title: "Hiring", archivedAt: null, parentId: hiring.parentId });
      const after = (await asSystem((db) => loadProposal(db, id)))!;
      expect(after.status).toBe("open");
      expect(after.approvals.map((a) => a.name)).toEqual(["Kale"]);

      await declineProposal(casey, id, "It could not be read.");
      expect((await asSystem((db) => loadProposal(db, id)))?.status).toBe("declined");
    }
  });
});
