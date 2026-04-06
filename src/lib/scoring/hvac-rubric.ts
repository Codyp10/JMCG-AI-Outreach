/**
 * HVAC launch ICP rubric (0–100). See docs/jmcg-ai-outreach-plan.md Section 3.
 * Weights are configurable here; tune against live data.
 */

/** Handwritten-mail tier and optional phone scrape (DB only — no auto-dial). */
export const HIGH_TOUCH_MIN_SCORE = 75;

export type LeadScoreInput = {
  companyName: string | null;
  googleReviewCount: number | null;
  hasActiveHvacHiring: boolean | null;
  runsGoogleLsaOrPpc: boolean | null;
  runsMetaAds: boolean | null;
  fsmSoftware: string | null;
  title: string | null;
  geo: string | null;
  /** Target metros/states — comma or newline separated in env */
  geoAllowlist: string[];
};

export type LeadScoreResult = {
  total: number;
  breakdown: Record<string, number>;
  icpDisqualificationReason: string | null;
};

const HVAC_NAME_PATTERNS =
  /heating\s*&?\s*air|heating\s*&?\s*cooling|hvac|air conditioning/i;
const MECH_ONLY =
  /plumbing|mechanical|industrial|sewer|drain/i;

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

function scoreNameAndCategory(companyName: string | null): {
  points: number;
  disqualified: string | null;
} {
  if (!companyName?.trim()) return { points: 2, disqualified: null };
  const name = companyName.trim();
  if (MECH_ONLY.test(name) && !HVAC_NAME_PATTERNS.test(name)) {
    return { points: 0, disqualified: "mechanical_or_plumbing_without_hvac_keywords" };
  }
  if (HVAC_NAME_PATTERNS.test(name)) return { points: 10, disqualified: null };
  return { points: 5, disqualified: null };
}

function scoreReviews(count: number | null): number {
  if (count == null) return 3;
  if (count < 250) return 2;
  if (count > 1500) return 2;
  return 10;
}

function scoreTitle(title: string | null): number {
  if (!title) return 3;
  const t = title.toLowerCase();
  if (/(owner|president|ceo|founder|gm|general manager|operations|marketing)/.test(t)) {
    return 10;
  }
  if (/(manager|director)/.test(t)) return 6;
  return 4;
}

function scoreGeo(geo: string | null, allowlist: string[]): number {
  if (!allowlist.length) return 3;
  if (!geo) return 2;
  const g = geo.toLowerCase();
  const hit = allowlist.some((a) => g.includes(a.toLowerCase().trim()));
  return hit ? 5 : 1;
}

function scoreFsm(fsm: string | null): number {
  if (!fsm) return 1;
  const f = fsm.toLowerCase();
  if (/service\s*titan|housecall|fieldedge/.test(f)) return 5;
  return 2;
}

function scoreHiring(v: boolean | null): number {
  if (v === true) return 8;
  if (v === false) return 2;
  return 4;
}

function scoreAds(
  lsa: boolean | null,
  meta: boolean | null,
): number {
  const signals = [lsa, meta].filter((x) => x === true).length;
  if (signals >= 2) return 10;
  if (signals === 1) return 7;
  if (lsa === false && meta === false) return 2;
  return 4;
}

export function scoreHvacLead(input: LeadScoreInput): LeadScoreResult {
  const a = scoreNameAndCategory(input.companyName);
  if (a.disqualified) {
    return {
      total: 0,
      breakdown: { fit_name: a.points },
      icpDisqualificationReason: a.disqualified,
    };
  }

  const bReview = scoreReviews(input.googleReviewCount);
  const bTitle = scoreTitle(input.title);
  const bGeo = scoreGeo(input.geo, input.geoAllowlist);
  const bFsm = scoreFsm(input.fsmSoftware);

  const cHire = scoreHiring(input.hasActiveHvacHiring);
  const cAds = scoreAds(input.runsGoogleLsaOrPpc, input.runsMetaAds);

  const fitSubtotal = a.points + bReview + bTitle + bGeo + bFsm;
  const fit = clamp(fitSubtotal, 0, 40);

  const contact = 15;
  const intentSubtotal = cHire + cAds;
  const intent = clamp(intentSubtotal, 0, 20);
  const leverage = 8;

  const rawTotal = fit + contact + intent + leverage;
  const total = clamp(rawTotal, 0, 100);

  return {
    total,
    breakdown: {
      fit_name: a.points,
      fit_reviews: bReview,
      fit_title: bTitle,
      fit_geo: bGeo,
      fit_fsm: bFsm,
      fit_clamped: fit,
      contact_quality_placeholder: contact,
      intent_hiring: cHire,
      intent_ads: cAds,
      intent_clamped: intent,
      leverage_placeholder: leverage,
    },
    icpDisqualificationReason: null,
  };
}

export function channelFlagsForScore(total: number): {
  email: boolean;
  handwritten_mail: boolean;
} {
  return {
    email: true,
    handwritten_mail: total >= HIGH_TOUCH_MIN_SCORE,
  };
}
