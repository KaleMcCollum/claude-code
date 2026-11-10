import { AppError } from "./permissions";

/**
 * The garden center and the coffee shop are partly separate businesses, so
 * notes (and later quotes, payments and more) can be tagged with one of these.
 */
export const BUSINESS_TAGS = ["garden_center", "coffee_shop", "both"] as const;
export type BusinessTag = (typeof BUSINESS_TAGS)[number];

export const BUSINESS_LABELS: Record<BusinessTag, string> = {
  garden_center: "Garden Center",
  coffee_shop: "Coffee Shop",
  both: "Both",
};

export function isBusinessTag(value: unknown): value is BusinessTag {
  return typeof value === "string" && (BUSINESS_TAGS as readonly string[]).includes(value);
}

/** Read a business tag coming from a form. Empty means "no tag". */
export function parseBusinessTag(value: unknown): BusinessTag | null {
  if (value === null || value === undefined || value === "") return null;
  if (isBusinessTag(value)) return value;
  throw new AppError("Choose Garden Center, Coffee Shop or Both.");
}
