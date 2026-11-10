import { sql } from "drizzle-orm";
import {
  type AnyPgColumn,
  bigserial,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

const ts = (name: string) => timestamp(name, { withTimezone: true, mode: "date" });

/**
 * Roles are stored as rows so more can be added later without code changes.
 * `permissions` is the list of things a role may do; see src/lib/permissions.ts.
 */
export const roles = pgTable("roles", {
  key: text("key").primaryKey(),
  name: text("name").notNull(),
  permissions: text("permissions")
    .array()
    .notNull()
    .default(sql`'{}'::text[]`),
  createdAt: ts("created_at").notNull().defaultNow(),
});

export const users = pgTable(
  "users",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    /** Always stored trimmed and lowercased. */
    email: text("email").notNull(),
    roleKey: text("role_key")
      .notNull()
      .references(() => roles.key),
    createdAt: ts("created_at").notNull().defaultNow(),
    createdBy: uuid("created_by").references((): AnyPgColumn => users.id),
    updatedAt: ts("updated_at").notNull().defaultNow(),
    updatedBy: uuid("updated_by").references((): AnyPgColumn => users.id),
    lastActiveAt: ts("last_active_at"),
    /** Soft delete. A removed user cannot sign in but stays for history. */
    removedAt: ts("removed_at"),
    removedBy: uuid("removed_by").references((): AnyPgColumn => users.id),
  },
  (t) => [uniqueIndex("users_email_unique").on(t.email)],
);

/** One-time sign-in links. Only a hash of the link's secret is stored. */
export const loginTokens = pgTable(
  "login_tokens",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    tokenHash: text("token_hash").notNull(),
    /** "login" (15 minutes) or "invite" (7 days). */
    kind: text("kind").notNull(),
    expiresAt: ts("expires_at").notNull(),
    usedAt: ts("used_at"),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("login_tokens_hash_unique").on(t.tokenHash),
    index("login_tokens_user_idx").on(t.userId, t.createdAt),
  ],
);

/** Signed-in devices. Only a hash of the cookie value is stored. */
export const sessions = pgTable(
  "sessions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    tokenHash: text("token_hash").notNull(),
    createdAt: ts("created_at").notNull().defaultNow(),
    lastSeenAt: ts("last_seen_at").notNull().defaultNow(),
    expiresAt: ts("expires_at").notNull(),
    revokedAt: ts("revoked_at"),
    userAgent: text("user_agent"),
  },
  (t) => [
    uniqueIndex("sessions_hash_unique").on(t.tokenHash),
    index("sessions_user_idx").on(t.userId),
  ],
);

/**
 * The manual's tree. Numbers (1, 1.1, 1.1.1) are never stored: they are
 * worked out from `position` among the non-archived siblings, so reordering
 * renumbers everything automatically.
 */
export const sections = pgTable(
  "sections",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    parentId: uuid("parent_id").references((): AnyPgColumn => sections.id),
    title: text("title").notNull(),
    position: integer("position").notNull(),
    archivedAt: ts("archived_at"),
    archivedBy: uuid("archived_by").references(() => users.id),
    createdAt: ts("created_at").notNull().defaultNow(),
    createdBy: uuid("created_by").references(() => users.id),
    /** Last change to the section's name or content (not to its order). */
    updatedAt: ts("updated_at").notNull().defaultNow(),
    updatedBy: uuid("updated_by").references(() => users.id),
  },
  (t) => [index("sections_parent_idx").on(t.parentId, t.position)],
);

/**
 * Every saved state of a section's Official block. Rows are never changed or
 * deleted; a new edit adds a new row with the next version number.
 */
export const officialVersions = pgTable(
  "official_versions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    sectionId: uuid("section_id")
      .notNull()
      .references(() => sections.id),
    version: integer("version").notNull(),
    /** Rich text document (editor JSON). */
    content: jsonb("content").notNull(),
    /** Plain-text copy of `content`, for search. */
    contentText: text("content_text").notNull(),
    createdAt: ts("created_at").notNull().defaultNow(),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => users.id),
  },
  (t) => [uniqueIndex("official_versions_section_version_unique").on(t.sectionId, t.version)],
);

/** Who approved an official version, and when. Never changed or deleted. */
export const approvals = pgTable(
  "approvals",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    officialVersionId: uuid("official_version_id")
      .notNull()
      .references(() => officialVersions.id),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => [uniqueIndex("approvals_version_user_unique").on(t.officialVersionId, t.userId)],
);

/** Append-only record of every change: who, when, what. */
export const activityLog = pgTable(
  "activity_log",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    at: ts("at").notNull().defaultNow(),
    userId: uuid("user_id").references(() => users.id),
    action: text("action").notNull(),
    entityType: text("entity_type").notNull(),
    entityId: text("entity_id"),
    summary: text("summary").notNull(),
    data: jsonb("data"),
  },
  (t) => [index("activity_log_at_idx").on(t.at)],
);
