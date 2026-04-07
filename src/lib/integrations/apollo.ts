const BASE = "https://api.apollo.io/api/v1";

export type ApolloSearchBody = Record<string, unknown>;

export type ApolloPerson = {
  id?: string;
  first_name?: string | null;
  last_name?: string | null;
  last_name_obfuscated?: string | null;
  title?: string | null;
  linkedin_url?: string | null;
  organization?: Record<string, unknown> | null;
};

export type ApolloSearchResponse = {
  total_entries?: number;
  people?: ApolloPerson[];
};

/** Default HVAC-oriented US search; override with `APOLLO_SEARCH_JSON` in env (shallow merge). */
export const DEFAULT_APOLLO_PEOPLE_SEARCH: ApolloSearchBody = {
  person_titles: [
    "Owner",
    "CEO",
    "President",
    "Founder",
    "General Manager",
    "Marketing Director",
    "Marketing Manager",
    "Head of Marketing",
    "VP Marketing",
  ],
  person_seniorities: ["owner", "founder", "c_suite", "director", "head", "manager"],
  q_keywords: "HVAC heating air conditioning",
  person_locations: ["United States"],
  organization_locations: ["United States"],
  organization_num_employees_ranges: ["1,10", "11,20", "21,50", "51,200"],
  per_page: 25,
};

function headers(apiKey: string): Record<string, string> {
  return {
    "Content-Type": "application/json",
    "Cache-Control": "no-cache",
    "X-Api-Key": apiKey,
  };
}

export async function apolloMixedPeopleSearch(params: {
  apiKey: string;
  body: ApolloSearchBody;
}): Promise<{ ok: true; data: ApolloSearchResponse } | { ok: false; error: string; status: number }> {
  const body = { ...params.body, page: params.body.page ?? 1 };
  const res = await fetch(`${BASE}/mixed_people/api_search`, {
    method: "POST",
    headers: headers(params.apiKey),
    body: JSON.stringify(body),
  });

  let parsed: unknown;
  try {
    parsed = await res.json();
  } catch {
    parsed = null;
  }

  if (!res.ok) {
    const msg =
      typeof parsed === "object" &&
      parsed !== null &&
      "error" in parsed &&
      typeof (parsed as { error: unknown }).error === "string"
        ? (parsed as { error: string }).error
        : res.statusText;
    return { ok: false, error: `${res.status} ${msg}`, status: res.status };
  }

  return { ok: true, data: parsed as ApolloSearchResponse };
}

export type PeopleMatchResult = {
  email: string | null;
  last_name: string | null;
  phone: string | null;
};

/** Single-person enrichment; may consume Apollo credits when reveal flags are true. */
export async function apolloPeopleMatch(params: {
  apiKey: string;
  personId: string;
  revealPersonalEmails: boolean;
}): Promise<
  { ok: true; person: Record<string, unknown> | null } | { ok: false; error: string; status: number }
> {
  const res = await fetch(`${BASE}/people/match`, {
    method: "POST",
    headers: headers(params.apiKey),
    body: JSON.stringify({
      id: params.personId,
      reveal_personal_emails: params.revealPersonalEmails,
    }),
  });

  let parsed: unknown;
  try {
    parsed = await res.json();
  } catch {
    parsed = null;
  }

  if (!res.ok) {
    const msg =
      typeof parsed === "object" &&
      parsed !== null &&
      "error" in parsed
        ? String((parsed as { error: unknown }).error)
        : res.statusText;
    return { ok: false, error: `${res.status} ${msg}`, status: res.status };
  }

  const root = parsed as Record<string, unknown>;
  const person = (root.person as Record<string, unknown> | undefined) ?? null;
  return { ok: true, person };
}

export function extractMatchContact(person: Record<string, unknown> | null): PeopleMatchResult {
  if (!person) {
    return { email: null, last_name: null, phone: null };
  }
  const email =
    typeof person.email === "string" && person.email.includes("@")
      ? person.email
      : typeof person.corporate_email === "string" && person.corporate_email.includes("@")
        ? person.corporate_email
        : null;
  const last_name = typeof person.last_name === "string" ? person.last_name : null;
  const phone =
    typeof person.sanitized_phone === "string"
      ? person.sanitized_phone
      : typeof person.phone_numbers === "string"
        ? person.phone_numbers
        : null;
  return { email, last_name, phone };
}

export function organizationDomain(org: Record<string, unknown> | null | undefined): string | null {
  if (!org) return null;
  const d = org.primary_domain ?? org.primary_domain_name ?? org.website_url;
  if (typeof d !== "string" || !d.trim()) return null;
  let s = d.trim().toLowerCase().replace(/^www\./, "");
  try {
    if (s.includes("://")) s = new URL(s).hostname.replace(/^www\./, "");
  } catch {
    /* keep */
  }
  return s || null;
}
