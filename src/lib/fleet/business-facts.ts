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
  /**
   * What the price is counted PER. Present whenever a price is quoted, because
   * every number above is per REACHED CONTACT and customers ask in GUESTS —
   * three different units that are easy to read as one.
   */
  billing_unit_he?: string;
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
  //
  // PUNCTUATION HERE IS NOT COSMETIC. MEASURED 16.08 across two live drafts: the
  // drafter reproduces these strings almost verbatim into customer replies, so
  // whatever punctuation they carry is the punctuation the customer reads. Two
  // faults shipped that way and are fixed below, per the Academy of the Hebrew
  // Language rules:
  //   - `ללא דמי מנוי; מחיר סופי` used a semicolon between two FRAGMENTS. That
  //     mark joins closely-related full clauses; between noun phrases it is a
  //     comma or a full stop. Now two sentences.
  //   - `מע"מ` used a straight ASCII quote where Hebrew takes gershayim (״).
  //     /terms already renders מע״מ, so the two surfaces disagreed on the same
  //     word.
  // Same rule drove `לא לפי X, ולא לפי Y` → no comma before vav in the
  // billing_unit_he text below.
  const summary_he =
    model === 'base_overage'
      ? `דמי הפעלה ₪${base} — עבור הפעלת השירות והפצת הפניות בערוצים — הכוללים כבר עד ${included} אנשי קשר שנענו בפועל, ללא תוספת. מעבר ל-${included}: ₪${overage} בלבד לכל איש קשר נוסף שנענה בפועל. דמי ההפעלה נגבים עם הפעלת הקמפיין ואינם מותנים בתוצאה — הם חלים על עצם הפעלת השירות, גם אם לא נענה אף איש קשר. ללא דמי מנוי. המחיר סופי, ללא מע״מ (עוסק פטור).`
      : `₪${overage} לכל איש קשר שהושג (נענה בוואטסאפ או השלים שיחת AI). משלמים רק על מי שנענה בפועל — פנייה שלא נענתה אינה מחויבת.`;

  // WHY THIS EXISTS — a measured drafting error, not a hypothetical.
  //
  // A customer asked about "150 אורחים". The draft answered that 150 "נכלל
  // במלואו במכסה הכלולה (200 אנשי קשר)" — reading a guest count as a contact
  // count, and a contact count as a reached count. Both are wrong, and the
  // second one is what actually bills.
  //
  // The three units genuinely differ: one contact can cover several guests in a
  // household (measured on live data: 46 guests across 43 contacts), and only
  // contacts who ANSWER are charged. So a guest number cannot be converted into
  // a price, in either direction — and the failure is not symmetric. Reading
  // guests as contacts OVERSTATES the bill to a large customer, which loses the
  // deal on a number we never would have charged.
  //
  // The drafter had no way to know any of this: nothing in these facts said the
  // units were different. Saying it here fixes every future reply at once,
  // rather than one example at a time.
  // DERIVED, never a second fixed paragraph. Everything below is computed from
  // `base` and `included`, so changing either in the admin package changes what
  // the drafter says — the numbers and the rule can never drift apart.
  //
  // WHY THE RULE IS STATED THIS WAY. A customer asks in GUESTS; the price is
  // counted in CONTACTS WHO ANSWERED. An earlier draft bridged that by treating
  // 150 guests as 150 contacts — right by luck, but the same reasoning on 300
  // guests would have overquoted and lost the deal on money we never charge.
  //
  // The bridge that always holds is simpler: nobody can answer who is not on the
  // list. So a list at or under `included` can never produce more than
  // `included` responders, and the price is exactly `base` no matter what
  // happens. That turns an unanswerable question (how many will reply?) into one
  // the customer can answer alone (how many numbers are on my list?), and it
  // removes the guest/contact confusion instead of explaining it.
  const billing_unit_he =
    `החיוב נספר לפי אנשי קשר שנענו בפועל, כלומר כאלה שהשיבו בהודעת וואטסאפ או השלימו את שיחת ה-AI. ` +
    `לא לפי מספר האורחים ולא לפי מספר ההודעות שנשלחו. ` +
    `איש קשר הוא מספר טלפון אחד, והוא עשוי לייצג יותר מאורח אחד באותו בית, ולכן אי אפשר לגזור מחיר ממספר אורחים. ` +
    `הכלל שתמיד נכון: לא ייתכן שיענו יותר אנשים ממספר הטלפונים שברשימה, ולכן ברשימה של עד ${included} מספרי טלפון ` +
    `המחיר הוא ₪${base} תמיד, בלי קשר לכמה מהם יענו בפועל. ` +
    `רק ברשימה גדולה מ-${included} ורק אם יותר מ-${included} מהם אכן ייענו, מתווספים ₪${overage} לכל נענה מעל ${included}. ` +
    `כשלקוח נוקב במספר אורחים — הצג לו את הכלל הזה כדי שיוכל ליישם אותו על הרשימה שלו, במקום לאמוד עבורו.`;

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
    billing_unit_he,
  };
}
