import { type SQL, sql } from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import { TIME_ZONE } from "./time";

/**
 * The calendar day of a timestamp column in US Central time, for use inside
 * database queries. Days are always Central days: date ranges include both
 * end days, and "N days ago" counts Central calendar days.
 */
export function centralDay(column: AnyPgColumn): SQL {
  return sql`(${column} at time zone ${sql.raw(`'${TIME_ZONE}'`)})::date`;
}
