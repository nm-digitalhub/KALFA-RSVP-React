// The business facts the public site and the support-drafter quote: which packages are on sale, at what price, for how
// many contacts, on which channels and on what cadence — so a page or a draft states the REAL catalogue instead of a
// `[מחירים]` placeholder or a number typed into code.
//
// PURE + bundle-safe (imported by scripts/fleet-agent-cli.ts). No DB, no PII, no secrets. The caller reads the packages
// on sale (getPublicBusinessFacts → listPackageOffers, the same definition the purchase flow sells from) and passes
// them here. Every figure below comes from those rows; the code owns only the sentence around them.

/**
 * One outreach touchpoint, reduced to the two fields that describe the CADENCE
 * to a customer. `message_key` is deliberately absent: it names an internal
 * template/script, not anything a customer would recognise.
 */
export interface TouchpointFacts {
  days_before: number;
  channel: string;
}

/** One package on sale, as the purchase flow sells it. */
export interface PackageFacts {
  name: string;
  /** The one price, paid once at purchase (packages.price_with_vat — final, no VAT is added). */
  price: number;
  /** How many contacts the campaign may approach, whether or not they answer. */
  contact_quota: number;
  channels: string[];
  /** The package's own admin-written text; null when it has none. */
  description: string | null;
  includes: string[];
  outreach_schedule: TouchpointFacts[];
}

export interface BusinessFacts {
  available: boolean;
  reason?: string;
  currency?: string;
  /** Every package on sale, in the order the customer is offered them. */
  packages?: PackageFacts[];
  /**
   * The channels EVERY package on sale uses, so a sentence about "the channels" is true whatever the customer buys.
   * Empty when the packages share none.
   */
  channels?: string[];
  /**
   * The live outreach cadence, passed through unphrased — present only when every package on sale runs the same one,
   * so a page never promises a timetable that one of the packages would not run. Rendering it into Hebrew needs
   * channel LABELS, which live in the agreements template; this module is pure and import-free by contract (the fleet
   * CLI bundles it), so the phrasing happens at the consumer (src/lib/faq/tokens.ts).
   */
  outreach_schedule?: TouchpointFacts[];
  /** One sentence per package: its name, price and quota. */
  packages_list_he?: string;
  /** How a package is paid, true of every package on sale. */
  pricing_rule_he?: string;
  summary_he?: string; // a ready phrasing the drafter adapts; a human still reviews the draft
  /**
   * What the quota is counted IN. Customers ask in GUESTS; a quota counts CONTACTS (phone numbers) — two units that are
   * easy to read as one.
   */
  billing_unit_he?: string;
  /**
   * Working instruction for the DRAFTER/AGENT only (how to apply
   * `billing_unit_he` when a customer quotes a guest count). Kept OUT of
   * `billing_unit_he` on purpose: that text is also rendered verbatim on the
   * public /faq page (src/lib/faq/page-model.ts), where an instruction
   * addressed to a bot leaked into the customer-facing answer (owner report
   * 2026-08-24). Never render this field to customers.
   */
  billing_unit_drafter_note_he?: string;
}

function shekels(amount: number): string {
  return `₪${amount.toLocaleString('he-IL', { maximumFractionDigits: 2 })}`;
}

// Hebrew counts one apart from the rest: "איש קשר אחד", "2 אנשי קשר".
function contactsHe(count: number): string {
  return count === 1 ? 'איש קשר אחד' : `${count.toLocaleString('he-IL')} אנשי קשר`;
}

function sameSchedule(a: TouchpointFacts[], b: TouchpointFacts[]): boolean {
  return (
    a.length === b.length && a.every((tp, i) => tp.days_before === b[i].days_before && tp.channel === b[i].channel)
  );
}

// PUNCTUATION HERE IS NOT COSMETIC. MEASURED 16.08 across two live drafts: the
// drafter reproduces these strings almost verbatim into customer replies, so
// whatever punctuation they carry is the punctuation the customer reads. Per the
// Academy of the Hebrew Language rules: no semicolon between fragments (two
// sentences instead), gershayim (״) in מע״מ, and no comma before vav.
export function buildBusinessFacts(packages: readonly PackageFacts[]): BusinessFacts {
  if (packages.length === 0) {
    return { available: false, reason: 'no package on sale' };
  }

  const [first, ...rest] = packages;
  const channels = first.channels.filter((ch) => rest.every((p) => p.channels.includes(ch)));
  const outreach_schedule = rest.every((p) => sameSchedule(p.outreach_schedule, first.outreach_schedule))
    ? first.outreach_schedule
    : [];

  const packages_list_he = packages
    .map((p) => `${p.name} — ${shekels(p.price)}, עד ${contactsHe(p.contact_quota)}.`)
    .join(' ');
  const pricing_rule_he =
    'המחיר קבוע לכל חבילה ומשולם פעם אחת ברכישה, והוא אינו תלוי במספר האורחים שהשיבו. ' +
    'המחיר סופי, ללא מע״מ (עוסק פטור).';

  // WHY THE UNITS ARE SPELLED OUT — a measured drafting error, not a hypothetical. A customer asked about
  // "150 אורחים" and a draft read the guest count as a contact count. One contact can cover several guests in a
  // household (measured on live data: 46 guests across 43 contacts), so a guest number cannot be turned into a quota.
  // Saying it here fixes every future reply at once.
  const billing_unit_he =
    'אורח הוא אדם ברשימת המוזמנים. ' +
    'איש קשר הוא מספר טלפון אחד שהמערכת פונה אליו, והוא עשוי לייצג יותר מאורח אחד באותו בית. ' +
    'נענה הוא איש קשר שהשיב לפנייה. ' +
    'מכסת החבילה נספרת באנשי קשר ולא באורחים, ולכן מספר הטלפונים ברשימה הוא שקובע איזו חבילה מתאימה. ' +
    'מספר הנענים אינו משנה את המחיר. ' +
    'אנשי קשר מעבר למכסה ממתינים ואינם מקבלים פנייה.';
  // Addressed to the drafter/agent, NOT to the customer — see the field's
  // doc comment. Customer-facing text above ends at the quota rule.
  const billing_unit_drafter_note_he =
    'כשלקוח נוקב במספר אורחים — הצג לו את הכלל הזה כדי שיבחר חבילה לפי מספר הטלפונים ברשימה שלו, במקום לאמוד עבורו.';

  return {
    available: true,
    currency: '₪',
    packages: [...packages],
    channels,
    outreach_schedule,
    packages_list_he,
    pricing_rule_he,
    summary_he: `${packages_list_he} ${pricing_rule_he}`,
    billing_unit_he,
    billing_unit_drafter_note_he,
  };
}
