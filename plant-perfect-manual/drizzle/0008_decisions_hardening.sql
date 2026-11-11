CREATE TABLE "system_flags" (
	"key" text PRIMARY KEY NOT NULL,
	"value" jsonb,
	"updated_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint

-- An approval or endorsement records the proposal revision it was given on
-- (hand-written step: add the column empty, fill it in, then require it).
-- Rows that already exist were given on wording that could not change any
-- more once someone else had approved or endorsed, so they carry their
-- proposal's revision.
ALTER TABLE "approvals" ADD COLUMN "revision" integer;--> statement-breakpoint
UPDATE "approvals" a SET "revision" = p."revision" FROM "proposals" p WHERE p."id" = a."proposal_id";--> statement-breakpoint
ALTER TABLE "approvals" ALTER COLUMN "revision" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "endorsements" ADD COLUMN "revision" integer;--> statement-breakpoint
UPDATE "endorsements" e SET "revision" = p."revision" FROM "proposals" p WHERE p."id" = e."proposal_id";--> statement-breakpoint
ALTER TABLE "endorsements" ALTER COLUMN "revision" SET NOT NULL;--> statement-breakpoint

ALTER TABLE "proposals" ADD COLUMN "decided_alone" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "proposals" ADD COLUMN "decided_txid" bigint;--> statement-breakpoint

-- What was approved before this step (hand-written): a decision with fewer
-- than two approvals was made by one person. A decided proposal can never be
-- changed, not even by a database step, so the rule that guards that is
-- switched off for this one statement and straight back on.
ALTER TABLE "proposals" DISABLE TRIGGER proposals_guard;--> statement-breakpoint
UPDATE "proposals" p
SET "decided_alone" = true
WHERE p."status" = 'approved'
  AND (SELECT count(*) FROM "approvals" a WHERE a."proposal_id" = p."id") < 2;--> statement-breakpoint
ALTER TABLE "proposals" ENABLE TRIGGER proposals_guard;
