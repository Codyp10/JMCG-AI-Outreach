/**
 * Hunter.io domain search — fills work_email when domain exists but email is missing.
 * https://hunter.io/api-documentation/v2#domain-search
 */

export type HunterPerson = {
  email: string | null;
  first_name: string | null;
  last_name: string | null;
  position: string | null;
};

function normalizeDomain(raw: string): string {
  let d = raw.trim().toLowerCase().replace(/^www\./, "");
  try {
    if (d.includes("://")) d = new URL(d).hostname.replace(/^www\./, "");
  } catch {
    /* keep as-is */
  }
  return d;
}

export async function hunterDomainSearchBestEmail(params: {
  apiKey: string;
  domain: string;
}): Promise<{ person: HunterPerson | null; rawMeta: { status: number } }> {
  const domain = normalizeDomain(params.domain);
  if (!domain || !params.apiKey) {
    return { person: null, rawMeta: { status: 0 } };
  }

  const url = new URL("https://api.hunter.io/v2/domain-search");
  url.searchParams.set("domain", domain);
  url.searchParams.set("api_key", params.apiKey);
  url.searchParams.set("limit", "10");

  const res = await fetch(url.toString(), { method: "GET" });
  if (!res.ok) {
    return { person: null, rawMeta: { status: res.status } };
  }

  let parsed: unknown;
  try {
    parsed = await res.json();
  } catch {
    return { person: null, rawMeta: { status: res.status } };
  }

  const data = parsed as { data?: { emails?: unknown[] } };
  const emails = data?.data?.emails;
  if (!Array.isArray(emails) || emails.length === 0) {
    return { person: null, rawMeta: { status: res.status } };
  }

  const ranked = [...emails].sort((a, b) => {
    const sa = typeof a === "object" && a && "confidence" in a ? Number((a as { confidence?: number }).confidence ?? 0) : 0;
    const sb = typeof b === "object" && b && "confidence" in b ? Number((b as { confidence?: number }).confidence ?? 0) : 0;
    return sb - sa;
  });

  const top = ranked[0];
  if (!top || typeof top !== "object") {
    return { person: null, rawMeta: { status: res.status } };
  }

  const row = top as {
    value?: string;
    first_name?: string;
    last_name?: string;
    position?: string;
  };

  const email = typeof row.value === "string" && row.value.includes("@") ? row.value : null;

  return {
    person: {
      email,
      first_name: typeof row.first_name === "string" ? row.first_name : null,
      last_name: typeof row.last_name === "string" ? row.last_name : null,
      position: typeof row.position === "string" ? row.position : null,
    },
    rawMeta: { status: res.status },
  };
}
