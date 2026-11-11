ALTER TABLE "approvals" DROP CONSTRAINT "approvals_official_version_id_official_versions_id_fk";
--> statement-breakpoint
DROP INDEX "approvals_version_user_unique";--> statement-breakpoint
ALTER TABLE "approvals" DROP COLUMN "official_version_id";