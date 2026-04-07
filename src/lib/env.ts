import { z } from "zod";

const dbSchema = z.object({
  SUPABASE_URL: z.string().url(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
});

export type DbEnv = z.infer<typeof dbSchema>;

export function getDbEnv(): DbEnv {
  const parsed = dbSchema.safeParse(process.env);
  if (!parsed.success) {
    throw new Error(
      `Invalid database env: ${JSON.stringify(parsed.error.flatten().fieldErrors)}`,
    );
  }
  return parsed.data;
}

const fullSchema = dbSchema.extend({
  CRON_SECRET: z.string().min(8),
  /** Google AI Studio / Gemini API — copy-generate + reply-agent classification */
  GEMINI_API_KEY: z.string().min(1).optional(),
  /** e.g. gemini-2.5-flash — empty uses built-in default in workers */
  GEMINI_MODEL: z.string().optional(),
  INSTANTLY_API_KEY: z.string().min(1).optional(),
  INSTANTLY_DEFAULT_CAMPAIGN_ID: z.string().min(1).optional(),
  SLACK_WEBHOOK_URL: z.string().url().optional(),
  MAX_ENRICHMENT_COST_PER_LEAD: z.coerce.number().positive().default(0.15),
  ENRICHMENT_LEADMAGIC_API_KEY: z.string().optional(),
  ENRICHMENT_HUNTER_API_KEY: z.string().optional(),
  /** Apollo.io master API key — People Search + optional people/match. */
  APOLLO_API_KEY: z.string().min(1).optional(),
  /** Optional JSON object merged over default HVAC US search (see apollo.ts). */
  APOLLO_SEARCH_JSON: z.string().optional(),
  /** If true, calls people/match with reveal_personal_emails (consumes Apollo credits). */
  APOLLO_MATCH_REVEAL_EMAIL: z
    .preprocess((v) => {
      if (v === undefined || v === null || v === "") return false;
      const s = String(v).toLowerCase();
      if (s === "false" || s === "0" || s === "no") return false;
      return s === "true" || s === "1" || s === "yes";
    }, z.boolean())
    .default(false),
});

export type FullEnv = z.infer<typeof fullSchema>;

/** Cron + outbound workers (requires CRON_SECRET). */
export function getFullEnv(): FullEnv {
  const parsed = fullSchema.safeParse(process.env);
  if (!parsed.success) {
    throw new Error(
      `Invalid worker env: ${JSON.stringify(parsed.error.flatten().fieldErrors)}`,
    );
  }
  return parsed.data;
}
