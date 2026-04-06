import type { SupabaseClient } from "@supabase/supabase-js";

type MailboxRow = {
  id: string;
  mailbox_id: string;
  domain: string;
  status: string;
  is_backup: boolean;
  bounce_rate_30d: number | null;
  complaint_rate_30d: number | null;
};

/**
 * Auto-pause mailboxes over health thresholds; promote a warmed backup (best-effort).
 * Thresholds from plan: bounce > 5%, complaint > 0.1%.
 */
export async function runMailboxHealthSweep(
  supabase: SupabaseClient,
): Promise<{ paused: string[]; activated: string[] }> {
  const { data, error } = await supabase.from("mailbox_health").select("*");
  if (error) throw new Error(error.message);

  const boxes = (data ?? []) as MailboxRow[];
  const paused: string[] = [];
  const activated: string[] = [];

  const backups = boxes.filter(
    (b) => b.is_backup && (b.status === "warmup" || b.status === "backup"),
  );

  for (const mb of boxes) {
    if (mb.is_backup) continue;
    if (mb.status === "paused") continue;

    const bounce = Number(mb.bounce_rate_30d ?? 0);
    const complaint = Number(mb.complaint_rate_30d ?? 0);
    const breach = bounce > 0.05 || complaint > 0.001;
    if (!breach) continue;

    await supabase
      .from("mailbox_health")
      .update({
        status: "paused",
        pause_reason: `auto_pause bounce=${bounce} complaint=${complaint}`,
        last_health_check: new Date().toISOString(),
      })
      .eq("id", mb.id);

    paused.push(mb.mailbox_id);

    const replacement = backups.find(
      (b) => b.domain === mb.domain && !activated.includes(b.mailbox_id),
    ) ?? backups.find((b) => !activated.includes(b.mailbox_id));

    if (replacement) {
      await supabase
        .from("mailbox_health")
        .update({
          status: "active",
          last_health_check: new Date().toISOString(),
        })
        .eq("id", replacement.id);

      activated.push(replacement.mailbox_id);

      await supabase.from("optimization_log").insert({
        cycle_date: new Date().toISOString().slice(0, 10),
        change_type: "mailbox_swap",
        old_value: { mailbox_id: mb.mailbox_id, domain: mb.domain },
        new_value: {
          backup_mailbox_id: replacement.mailbox_id,
          domain: replacement.domain,
        },
        data_basis: { bounce_rate_30d: bounce, complaint_rate_30d: complaint },
      });
    }
  }

  return { paused, activated };
}
