import { eq, sql } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { asSystem } from "@/db/client";
import { activityLog, sections, users } from "@/db/schema";
import { UNSEEN_CHARACTER_MESSAGE } from "@/lib/names";
import { type Actor, AppError } from "@/lib/permissions";
import {
  type ProposalView,
  approveAlone,
  approveProposal,
  createProposal,
  editProposal,
  endorseProposal,
  loadProposal,
  withdrawProposal,
} from "@/lib/proposals";
import type { RichDoc } from "@/lib/richtext";
import { addUser } from "@/lib/users";
import { actorFor, fakeMailer, insertUser, withTestDatabase } from "./helpers/db";

withTestDatabase();

/**
 * Some things the database refuses with a code of its own, so that the app
 * can tell the person what happened in plain words instead of "Something
 * went wrong". In normal use the app's own checks come first and say the
 * same thing; the database's refusal only shows when two people press a
 * button at the very same moment.
 *
 * To test the wording without needing that moment, this file adds a rule to
 * its own private test database that refuses with a chosen code, and then
 * presses the button.
 */

const doc = (text: string): RichDoc => ({
  type: "doc",
  content: [{ type: "paragraph", content: [{ type: "text", text }] }],
});
async function section(title: string): Promise<string> {
  const [row] = await asSystem((db) => db.select().from(sections).where(eq(sections.title, title)));
  return row.id;
}
const view = async (id: string) => (await asSystem((db) => loadProposal(db, id))) as ProposalView;

/** What the person was shown: a plain message, or "GENERAL" for anything else. */
async function told(work: Promise<unknown>): Promise<string> {
  try {
    await work;
    return "(it went through)";
  } catch (error) {
    return error instanceof AppError ? error.message : "GENERAL";
  }
}

let kale: Actor;
let casey: Actor;
let karen: Actor;

beforeAll(async () => {
  kale = await actorFor("kale@example.com");
  casey = await actorFor("casey@example.com");
  karen = await insertUser("Karen", "karen@example.com", "advisor");
  await asSystem((db) =>
    db.execute(sql`
      create function public.test_refuse() returns trigger language plpgsql as $$
      begin
        raise exception 'Refused for a test' using errcode = TG_ARGV[0];
      end $$`),
  );
});

describe("an endorsement or approval the database refuses", () => {
  it("as given on a proposal that was just declined or withdrawn: says so", async () => {
    const id = await createProposal(kale, { kind: "decision", sectionId: await section("Wages"), title: "Coffee wages", proposedOfficial: doc("$15.00/hr") });
    const ENDORSE = "This proposal was declined or withdrawn, so it can no longer be endorsed.";
    const APPROVE = "This proposal has already been declined or withdrawn. Reload the page to see it.";
    const seen = { revision: 1, currentVersionId: null };

    // The database's own code for it.
    await asSystem((db) => db.execute(sql`create trigger a_test_refuse before insert on endorsements for each row execute function public.test_refuse('PPF04')`));
    expect(await told(endorseProposal(karen, id, { revision: 1 }))).toBe(ENDORSE);
    await asSystem((db) => db.execute(sql`drop trigger a_test_refuse on endorsements`));
    await asSystem((db) => db.execute(sql`create trigger a_test_refuse before insert on approvals for each row execute function public.test_refuse('PPF04')`));
    expect(await told(approveProposal(casey, id, seen))).toBe(APPROVE);
    expect(await told(approveAlone(casey, id, seen))).toBe(APPROVE);
    await asSystem((db) => db.execute(sql`drop trigger a_test_refuse on approvals`));

    // The code of the older rule on the same two tables.
    await asSystem((db) => db.execute(sql`create trigger a_test_refuse before insert on endorsements for each row execute function public.test_refuse('42501')`));
    expect(await told(endorseProposal(karen, id, { revision: 1 }))).toBe(ENDORSE);
    await asSystem((db) => db.execute(sql`drop trigger a_test_refuse on endorsements`));
    await asSystem((db) => db.execute(sql`create trigger a_test_refuse before insert on approvals for each row execute function public.test_refuse('42501')`));
    expect(await told(approveProposal(casey, id, seen))).toBe(APPROVE);
    await asSystem((db) => db.execute(sql`drop trigger a_test_refuse on approvals`));

    // As given on wording that was changed at that moment.
    await asSystem((db) => db.execute(sql`create trigger a_test_refuse before insert on endorsements for each row execute function public.test_refuse('PPF01')`));
    expect(await told(endorseProposal(karen, id, { revision: 1 }))).toBe(
      "Kale changed this proposal after you opened it. Reload the page and read it again, then endorse.",
    );
    await asSystem((db) => db.execute(sql`drop trigger a_test_refuse on endorsements`));

    // Anything else is not dressed up as one of these.
    await asSystem((db) => db.execute(sql`create trigger a_test_refuse before insert on endorsements for each row execute function public.test_refuse('P0001')`));
    expect(await told(endorseProposal(karen, id, { revision: 1 }))).toBe("GENERAL");
    await asSystem((db) => db.execute(sql`drop trigger a_test_refuse on endorsements`));

    // Nothing was recorded by any of it, and without the test rule both work.
    expect(await view(id)).toMatchObject({ status: "open", endorsements: [] });
    expect((await view(id)).approvals.map((a) => a.name)).toEqual(["Kale"]);
    expect(await told(endorseProposal(karen, id, { revision: 1 }))).toBe("(it went through)");
    expect(await told(approveProposal(casey, id, seen))).toBe("(it went through)");
  });

  it("as two people's approval of a proposal that is out of date: says who has to check it, or that nobody can", async () => {
    const benefits = await section("Benefits");
    const hiring = await section("Hiring");
    const id = await createProposal(kale, { kind: "decision", sectionId: benefits, title: "Staff discount", proposedOfficial: doc("Staff discount: 20%.") });
    const endorsed = await createProposal(kale, { kind: "decision", sectionId: hiring, title: "Hire in March", proposedOfficial: doc("We hire in March.") });
    await endorseProposal(karen, endorsed, { revision: 1 });
    const seen = { revision: 1, currentVersionId: null };
    // Both proposals are up to date, so the app's own check lets the approval
    // through; then the database refuses it with its code for "out of date".
    await asSystem((db) =>
      db.execute(sql`
        create trigger a_test_refuse before update on proposals for each row
        when (NEW.status = 'approved' and NEW.type <> 'structure')
        execute function public.test_refuse('PPF03')`),
    );
    const KALE_CHECKS =
      "The official text of this section has changed since Kale proposed this. Kale needs to check the proposal against the new text and save it again before it can be approved. You can comment on it or decline it.";
    expect(await told(approveProposal(casey, id, seen))).toBe(KALE_CHECKS);
    expect(await told(approveAlone(kale, id, seen))).toBe(KALE_CHECKS);
    // Karen endorsed the other one, so Kale could not change it any more.
    expect(await told(approveProposal(casey, endorsed, seen))).toBe(
      "The official text of this section has changed since this was proposed, and the person who proposed it can no longer change it. Decline it and make a new proposal.",
    );
    // The refused approval was undone with it.
    expect((await view(id)).approvals.map((a) => a.name)).toEqual(["Kale"]);
    expect((await view(endorsed)).approvals.map((a) => a.name)).toEqual(["Kale"]);
    expect(await view(id)).toMatchObject({ status: "open" });

    await asSystem((db) => db.execute(sql`drop trigger a_test_refuse on proposals`));
    expect(await told(approveProposal(casey, id, seen))).toBe("(it went through)");
    await withdrawProposal(kale, endorsed);
  });
});

describe("a change to a proposal that the database does not make", () => {
  it("is not written to the activity log as a change", async () => {
    const training = await section("Training");
    const id = await createProposal(kale, { kind: "decision", sectionId: training, title: "Shadow shifts", proposedOfficial: doc("New staff shadow for two shifts.") });
    // A rule that keeps every open proposal exactly as it was, whatever is sent.
    await asSystem((db) =>
      db.execute(sql`
        create function public.test_keep_as_it_was() returns trigger language plpgsql as $$
        begin
          return OLD;
        end $$`),
    );
    await asSystem((db) =>
      db.execute(sql`
        create trigger a_test_keep before update on proposals for each row
        when (OLD.status = 'open' and NEW.status = 'open')
        execute function public.test_keep_as_it_was()`),
    );
    await editProposal(kale, id, { kind: "decision", sectionId: training, title: "Shadow for three shifts", proposedOfficial: doc("New staff shadow for three shifts.") });
    // Nothing changed, so the revision is the same and the log does not claim otherwise.
    expect(await view(id)).toMatchObject({ title: "Shadow shifts", revision: 1 });
    const logged = async () =>
      (await asSystem((db) => db.select().from(activityLog).where(eq(activityLog.entityId, id)).orderBy(activityLog.id))).map((e) => e.summary);
    expect(await logged()).toEqual(["Proposed: Shadow shifts"]);

    await asSystem((db) => db.execute(sql`drop trigger a_test_keep on proposals`));
    await editProposal(kale, id, { kind: "decision", sectionId: training, title: "Shadow for three shifts", proposedOfficial: doc("New staff shadow for three shifts.") });
    expect(await view(id)).toMatchObject({ title: "Shadow for three shifts", revision: 2 });
    expect(await logged()).toEqual(["Proposed: Shadow shifts", "Changed their proposal: Shadow for three shifts"]);
    await withdrawProposal(kale, id);
  });
});

describe("a name the database refuses to store", () => {
  it("because it has a character in it that cannot be seen: says so, even if the app's own list did not know that character", async () => {
    // The app checks names against its own list first, and the two lists are
    // the same (tests/names.test.ts). To see what a person would be told if
    // the database's list ever knew a character the app's did not, this
    // private test database is given a stricter rule under the same name.
    await asSystem((db) => db.execute(sql`alter table users drop constraint users_name_can_be_seen`));
    await asSystem((db) => db.execute(sql`alter table users add constraint users_name_can_be_seen check (name !~ '[Qq]')`));
    const mail = fakeMailer();
    const options = { baseUrl: "https://manual.example.com", send: mail.send };
    expect(await told(addUser(kale, { name: "Quinn", email: "quinn@example.com", roleKey: "advisor" }, options))).toBe(UNSEEN_CHARACTER_MESSAGE);
    expect(await asSystem((db) => db.select().from(users).where(eq(users.email, "quinn@example.com")))).toEqual([]);
    expect(mail.sent).toHaveLength(0);
    expect(await told(addUser(kale, { name: "Robin", email: "robin@example.com", roleKey: "advisor" }, options))).toBe("(it went through)");
  });
});

