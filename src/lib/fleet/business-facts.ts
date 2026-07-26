// Stage-2 grounding for the support-drafter (plan S5): the pure shaping of the
// business facts the drafter is allowed to quote when answering a pricing
// inquiry — so it writes the REAL price instead of a `[מחירים]` placeholder.
//
// PURE + bundle-safe (imported by scripts/fleet-agent-cli.ts). No DB, no PII, no
// secrets. The CLI reads the live gate + the canonical package and passes them
// here; the drafter never touches app_settings (secrets) or the raw package.
//
// GATE-AWARE, so the drafter always tells the truth about what is ACTUALLY
// billed: while the base+overage gate is OFF the effective model is pure
// per-reached (base/included are 0 on new campaigns regardless of the package
// row), so we surface per-reached; only when the gate is ON do we surface the
// flat-base + included + overage model.

export interface PackageFacts {
  name: string;
  price_per_reached: number; // the per-reached rate (= overage rate above included)
  base_price: number; // package base (may be pre-set while the gate is still off)
  included_reached: number;
  channels: string[];
}

export interface BusinessFacts {
  available: boolean;
  reason?: string;
  currency?: string;
  model?: 'base_overage' | 'per_reached';
  package_name?: string;
  channels?: string[];
  per_reached_price?: number;
  base_price?: number;
  included_reached?: number;
  summary_he?: string; // a ready phrasing the drafter adapts; a human still reviews the draft
}

export function buildBusinessFacts(
  gateOn: boolean,
  pkg: PackageFacts | null,
): BusinessFacts {
  if (!pkg) {
    return { available: false, reason: 'no active campaign package configured' };
  }
  const overage = pkg.price_per_reached;
  // While the gate is off the base does NOT apply (new campaigns snapshot 0/0),
  // so zero it out here too — quoting a base that isn't billed would mislead.
  const base = gateOn ? pkg.base_price : 0;
  const included = gateOn ? pkg.included_reached : 0;
  const model: 'base_overage' | 'per_reached' =
    gateOn && base > 0 ? 'base_overage' : 'per_reached';

  // §2 (הגנת הצרכן) — the base fee must be presented as UNCONDITIONAL (charged
  // regardless of outcome); the "pay only for responders" claim is TRUE ONLY of the
  // overage above the included, never of the base. Framing the base as
  // outcome-conditional is a price misrepresentation (compliance review 2026-07-26;
  // attorney item 18). Balanced tone: the required disclosure is framed as the VALUE
  // the fee buys (activation + included responses, no subscription) rather than a
  // penalty — accurate AND not deal-deterring.
  const summary_he =
    model === 'base_overage'
      ? `דמי הפעלה ₪${base} — עבור הפעלת השירות והפצת הפניות בערוצים — הכוללים כבר עד ${included} אנשי קשר שנענו בפועל, ללא תוספת. מעבר ל-${included}: ₪${overage} בלבד לכל איש קשר נוסף שנענה בפועל. דמי ההפעלה נגבים עם הפעלת הקמפיין ואינם מותנים בתוצאה — הם חלים על עצם הפעלת השירות, גם אם לא נענה אף איש קשר. ללא דמי מנוי; מחיר סופי, ללא מע"מ (עוסק פטור).`
      : `₪${overage} לכל איש קשר שהושג (נענה בוואטסאפ או השלים שיחת AI). משלמים רק על מי שנענה בפועל — פנייה שלא נענתה אינה מחויבת.`;

  return {
    available: true,
    currency: '₪',
    model,
    package_name: pkg.name,
    channels: pkg.channels,
    per_reached_price: overage,
    base_price: base,
    included_reached: included,
    summary_he,
  };
}
