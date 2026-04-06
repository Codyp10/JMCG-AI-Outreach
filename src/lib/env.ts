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
  CLAUDE_API_KEY: z.string().min(1).optional(),
  SMARTLEAD_API_KEY: z.string().min(1).optional(),
  SMARTLEAD_DEFAULT_CAMPAIGN_ID: z.string().min(1).optional(),
  SLACK_WEBHOOK_URL: z.string().url().optional(),
  MAX_ENRICHMENT_COST_PER_LEAD: z.coerce.number().positive().default(0.15),
  ENRICHMENT_CLAY_API_KEY: z.string().optional(),
  ENRICHMENT_LEADMAGIC_API_KEY: z.string().optional(),
  ENRICHMENT_HUNTER_API_KEY: z.string().optional(),
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
