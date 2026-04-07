import { NextResponse } from "next/server";
import {
  apolloMixedPeopleSearch,
  apolloPeopleMatch,
  DEFAULT_APOLLO_PEOPLE_SEARCH,
  extractMatchContact,
  organizationDomain,
  type ApolloPerson,
} from "@/lib/integrations/apollo";
import { getFullEnv } from "@/lib/env";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { verifyCronSecret } from "@/lib/workers/cron-auth";
import { finishWorkerRun, startWorkerRun } from "@/lib/workers/run-log";

export const maxDuration = 300;

function shallowMergeSearch(
  base: Record<string, unknown>,
  override: Record<string, unknown>,
): Record<string, unknown> {
  return { ...base, ...override };
}

function parseSearchOverride(raw: string | undefined): Record<string, unknown> {
  if (!raw?.trim()) return {};
  try {
    const o = JSON.parse(raw) as unknown;
    return o && typeof o === "object" && !Array.isArray(o) ? (o as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function mapPersonToLeadRow(params: {
  person: ApolloPerson;
  workEmail: string | null;
  lastName: string | null;
  orgDomain: string | null;
}): Record<string, unknown> | null {
  const { person, workEmail, lastName, orgDomain } = params;
  const org = (person.organization ?? null) as Record<string, unknown> | null;
  const companyName = org && typeof org.name === "string" ? org.name.trim() : "";
  if (!companyName) return null;

  const signals: Record<string, unknown> = {
    apollo_person_id: person.id,
    source: "apollo",
  };
  if (orgDomain) signals.organization_domain = orgDomain;

  return {
    work_email: workEmail,
    first_name: typeof person.first_name === "string" ? person.first_name : null,
    last_name: lastName,
    title: typeof person.title === "string" ? person.title : null,
    company_name: companyName,
    industry: null,
    location: null,
    geo: null,
    phone: null,
    linkedin_url: typeof person.linkedin_url === "string" ? person.linkedin_url : null,
    signals_json: signals,
    verified_facts_json: {},
    icp_vertical: "hvac",
    enrichment_status: "pending",
    scoring_status: "pending",
  };
}

export async function POST(request: Request) {
  if (!verifyCronSecret(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const env = getFullEnv();
  if (!env.APOLLO_API_KEY) {
    return NextResponse.json(
      { ok: false, error: "APOLLO_API_KEY not set in environment." },
      { status: 503 },
    );
  }

  const supabase = getSupabaseAdmin();
  const runId = await startWorkerRun(supabase, "apollo-ingest");

  try {
    const { data: stateRow, error: stateErr } = await supabase
      .from("apollo_sync_state")
      .select("people_search_page")
      .eq("id", 1)
      .maybeSingle();

    if (stateErr) throw new Error(stateErr.message);

    const currentPage = stateRow?.people_search_page ?? 1;
    const override = parseSearchOverride(env.APOLLO_SEARCH_JSON);
    const searchBody = shallowMergeSearch(
      { ...DEFAULT_APOLLO_PEOPLE_SEARCH } as Record<string, unknown>,
      override,
    );
    searchBody.page = currentPage;

    const search = await apolloMixedPeopleSearch({
      apiKey: env.APOLLO_API_KEY,
      body: searchBody,
    });

    if (!search.ok) {
      await finishWorkerRun(supabase, runId, {
        batchSize: 0,
        successCount: 0,
        errorCount: 1,
        errorDetails: { apollo_search: search.error },
      });
      return NextResponse.json({ ok: false, error: search.error }, { status: 502 });
    }

    const people = search.data.people ?? [];
    const totalEntries = search.data.total_entries ?? 0;
    const perPage = Number(searchBody.per_page ?? 25) || 25;
    const maxPage = Math.max(1, Math.ceil(totalEntries / perPage));
    const nextPage = currentPage >= maxPage ? 1 : currentPage + 1;

    let inserted = 0;
    let skipped = 0;
    const errors: string[] = [];

    for (const person of people) {
      const pid = person.id;
      if (!pid) {
        skipped++;
        continue;
      }

      const { data: dup } = await supabase
        .from("leads")
        .select("id")
        .contains("signals_json", { apollo_person_id: pid })
        .maybeSingle();

      if (dup?.id) {
        skipped++;
        continue;
      }

      let workEmail: string | null = null;
      let lastName: string | null = null;

      if (env.APOLLO_MATCH_REVEAL_EMAIL) {
        const match = await apolloPeopleMatch({
          apiKey: env.APOLLO_API_KEY,
          personId: pid,
          revealPersonalEmails: true,
        });
        if (match.ok && match.person) {
          const c = extractMatchContact(match.person);
          workEmail = c.email;
          lastName = c.last_name;
        } else if (!match.ok) {
          errors.push(`${pid}: ${match.error}`);
        }
      }

      const org = (person.organization ?? null) as Record<string, unknown> | null;
      const orgDomain = organizationDomain(org);

      const row = mapPersonToLeadRow({
        person,
        workEmail,
        lastName,
        orgDomain,
      });
      if (!row) {
        skipped++;
        continue;
      }

      const { error: insErr } = await supabase.from("leads").insert(row);
      if (insErr) {
        errors.push(`${pid}: ${insErr.message}`);
        continue;
      }
      inserted++;
    }

    const { error: upStateErr } = await supabase
      .from("apollo_sync_state")
      .update({
        people_search_page: nextPage,
        updated_at: new Date().toISOString(),
      })
      .eq("id", 1);

    if (upStateErr) throw new Error(upStateErr.message);

    await finishWorkerRun(supabase, runId, {
      batchSize: people.length,
      successCount: inserted,
      errorCount: errors.length,
      errorDetails: errors.length ? { sample: errors.slice(0, 5) } : undefined,
    });

    return NextResponse.json({
      ok: true,
      page: currentPage,
      next_page: nextPage,
      total_entries: totalEntries,
      fetched: people.length,
      inserted,
      skipped,
      errors: errors.slice(0, 10),
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await finishWorkerRun(supabase, runId, {
      batchSize: 0,
      successCount: 0,
      errorCount: 1,
      errorDetails: { fatal: msg },
    });
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
