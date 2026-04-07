/**
 * Merge enrichment results without overwriting upstream data (Apollo, etc.) already on the lead.
 */

function isEmptyScalar(v: unknown): boolean {
  if (v === null || v === undefined) return true;
  if (typeof v === "string") return v.trim() === "";
  return false;
}

type JsonObject = Record<string, unknown>;

/** Keys the waterfall may fill when still empty (never overwrites existing values). */
export const ENRICHABLE_LEAD_SCALAR_KEYS = [
  "work_email",
  "first_name",
  "last_name",
  "title",
  "phone",
  "linkedin_url",
  "industry",
  "location",
  "geo",
  "google_review_count",
  "has_active_hvac_hiring",
  "runs_google_lsa_or_ppc",
  "runs_meta_ads",
  "fsm_software",
] as const;

/** Only non-empty fields from `patch` where `existing` was empty. */
export function computeEnrichmentDelta(
  existing: JsonObject,
  patch: JsonObject,
  keys: readonly string[] = [...ENRICHABLE_LEAD_SCALAR_KEYS],
): Record<string, unknown> {
  const delta: Record<string, unknown> = {};
  for (const key of keys) {
    if (!(key in patch)) continue;
    const next = patch[key];
    if (next === undefined || next === null) continue;
    if (typeof next === "string" && next.trim() === "") continue;
    if (!isEmptyScalar(existing[key])) continue;
    delta[key] = next;
  }
  return delta;
}

/** Merge signals_json: add missing keys from patch (no overwrites). */
export function mergeSignalsJson(
  existing: unknown,
  patch: JsonObject,
): JsonObject {
  const base =
    existing && typeof existing === "object" && !Array.isArray(existing)
      ? { ...(existing as JsonObject) }
      : {};
  for (const [k, v] of Object.entries(patch)) {
    if (v === undefined) continue;
    if (!(k in base)) base[k] = v;
  }
  return base;
}
