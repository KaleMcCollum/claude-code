CREATE TYPE "public"."proposal_status" AS ENUM('open', 'approved', 'declined', 'withdrawn');--> statement-breakpoint
CREATE TYPE "public"."proposal_type" AS ENUM('decision', 'structure', 'official_text');--> statement-breakpoint
CREATE TABLE "endorsements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"proposal_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "proposal_notes" (
	"proposal_id" uuid NOT NULL,
	"note_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid NOT NULL
);
--> statement-breakpoint
CREATE TABLE "proposals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"type" "proposal_type" NOT NULL,
	"title" text NOT NULL,
	"description" jsonb,
	"description_text" text DEFAULT '' NOT NULL,
	"section_id" uuid,
	"business_tag" "business_tag",
	"proposed_official" jsonb,
	"proposed_official_text" text,
	"base_version_id" uuid,
	"structure_change" jsonb,
	"created_section_id" uuid,
	"direct" boolean DEFAULT false NOT NULL,
	"proposed_by" uuid,
	"revision" integer DEFAULT 1 NOT NULL,
	"status" "proposal_status" DEFAULT 'open' NOT NULL,
	"decided_at" timestamp with time zone,
	"decided_by" uuid,
	"decline_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid
);
--> statement-breakpoint
ALTER TABLE "approvals" ALTER COLUMN "official_version_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "comments" ALTER COLUMN "note_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "approvals" ADD COLUMN "proposal_id" uuid;--> statement-breakpoint
ALTER TABLE "comments" ADD COLUMN "proposal_id" uuid;--> statement-breakpoint
ALTER TABLE "official_versions" ADD COLUMN "proposal_id" uuid;--> statement-breakpoint
ALTER TABLE "official_versions" ADD COLUMN "restored_from_version_id" uuid;--> statement-breakpoint

-- Carry over what was saved before proposals existed (hand-written step).
-- Until now an official version carried its own approvals ("Edit official"
-- in Phase 1). From here on every version comes from a proposal, so each
-- existing version gets a proposal of its own, approved on the spot by the
-- Owner who saved it, and its approvals move onto that proposal. The
-- proposal reuses the version's id, which keeps this step simple and exact.
INSERT INTO "proposals" (
  "id", "type", "title", "section_id", "proposed_official", "proposed_official_text",
  "base_version_id", "direct", "proposed_by", "status", "decided_at", "decided_by",
  "created_at", "updated_at", "updated_by"
)
SELECT
  v."id", 'official_text', 'Edited directly', v."section_id", v."content", v."content_text",
  (SELECT earlier."id" FROM "official_versions" earlier
    WHERE earlier."section_id" = v."section_id" AND earlier."version" = v."version" - 1),
  true, v."created_by", 'approved', v."created_at", v."created_by",
  v."created_at", v."created_at", v."created_by"
FROM "official_versions" v;--> statement-breakpoint
UPDATE "official_versions" SET "proposal_id" = "id";--> statement-breakpoint
UPDATE "approvals" SET "proposal_id" = "official_version_id";--> statement-breakpoint
ALTER TABLE "official_versions" ALTER COLUMN "proposal_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "approvals" ALTER COLUMN "proposal_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "endorsements" ADD CONSTRAINT "endorsements_proposal_id_proposals_id_fk" FOREIGN KEY ("proposal_id") REFERENCES "public"."proposals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "endorsements" ADD CONSTRAINT "endorsements_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "proposal_notes" ADD CONSTRAINT "proposal_notes_proposal_id_proposals_id_fk" FOREIGN KEY ("proposal_id") REFERENCES "public"."proposals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "proposal_notes" ADD CONSTRAINT "proposal_notes_note_id_notes_id_fk" FOREIGN KEY ("note_id") REFERENCES "public"."notes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "proposal_notes" ADD CONSTRAINT "proposal_notes_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "proposals" ADD CONSTRAINT "proposals_section_id_sections_id_fk" FOREIGN KEY ("section_id") REFERENCES "public"."sections"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "proposals" ADD CONSTRAINT "proposals_base_version_id_official_versions_id_fk" FOREIGN KEY ("base_version_id") REFERENCES "public"."official_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "proposals" ADD CONSTRAINT "proposals_created_section_id_sections_id_fk" FOREIGN KEY ("created_section_id") REFERENCES "public"."sections"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "proposals" ADD CONSTRAINT "proposals_proposed_by_users_id_fk" FOREIGN KEY ("proposed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "proposals" ADD CONSTRAINT "proposals_decided_by_users_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "proposals" ADD CONSTRAINT "proposals_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "endorsements_proposal_user_unique" ON "endorsements" USING btree ("proposal_id","user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "proposal_notes_unique" ON "proposal_notes" USING btree ("proposal_id","note_id");--> statement-breakpoint
CREATE INDEX "proposal_notes_note_idx" ON "proposal_notes" USING btree ("note_id");--> statement-breakpoint
CREATE INDEX "proposals_status_idx" ON "proposals" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "proposals_section_idx" ON "proposals" USING btree ("section_id");--> statement-breakpoint
ALTER TABLE "approvals" ADD CONSTRAINT "approvals_proposal_id_proposals_id_fk" FOREIGN KEY ("proposal_id") REFERENCES "public"."proposals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comments" ADD CONSTRAINT "comments_proposal_id_proposals_id_fk" FOREIGN KEY ("proposal_id") REFERENCES "public"."proposals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "official_versions" ADD CONSTRAINT "official_versions_proposal_id_proposals_id_fk" FOREIGN KEY ("proposal_id") REFERENCES "public"."proposals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "official_versions" ADD CONSTRAINT "official_versions_restored_from_version_id_official_versions_id_fk" FOREIGN KEY ("restored_from_version_id") REFERENCES "public"."official_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "approvals_proposal_user_unique" ON "approvals" USING btree ("proposal_id","user_id");--> statement-breakpoint
CREATE INDEX "comments_proposal_idx" ON "comments" USING btree ("proposal_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "official_versions_proposal_unique" ON "official_versions" USING btree ("proposal_id");