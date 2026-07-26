// Stage-1 learning loop for support-drafter: distil the human-review feedback
// that ALREADY exists in contact_messages — draft_reply (what the drafter
// wrote) vs sent_reply (what a human actually sent) — into a redacted few-shot
// corpus the role reads each run, plus a "sent nearly as-is" metric that
// baselines any future autonomy decision.
//
// This module is PURE (no DB, no fs, no PII source) and bundle-safe (imported
// by scripts/fleet-agent-cli.ts through esbuild — no 'server-only', no next/*).
// The CLI holds the PII and calls redactPii BEFORE anything reaches disk or
// stdout, so the corpus — read straight into the drafter's context — never
// carries a customer's real name, email, or phone.

export interface RawCorrection {
  topic: string | null;
  message: string; // the inquiry (may contain PII)
  draft: string; // draft_reply — PII-free by construction, swept anyway
  sent: string; // sent_reply — human final (may contain PII, e.g. the name they added)
  pii: { name?: string | null; email?: string | null; phone?: string | null };
}

export interface RedactedExample {
  topic: string;
  inquiry: string; // redacted + capped
  draft: string; // redacted + capped
  sent: string; // redacted + capped
  similarity: number; // trigram Dice(redacted draft, redacted sent) in [0,1]
}

// Mask the submitter's own identifiers (exact tokens, case-insensitive) plus a
// generic email/phone sweep for any other contact mentioned in free text.
// Over-redaction is the safe direction: a masked common word costs a little
// few-shot fidelity; a leaked name is a privacy breach.
export function redactPii(
  text: string,
  pii: { name?: string | null; email?: string | null; phone?: string | null },
): string {
  let out = text;
  const maskToken = (needle: string | null | undefined, token: string) => {
    const n = needle?.trim();
    if (!n || n.length < 2) return;
    const esc = n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    out = out.replace(new RegExp(esc, 'gi'), token);
  };
  maskToken(pii.name, '[שם]');
  maskToken(pii.email, '[מייל]');
  maskToken(pii.phone, '[טלפון]');
  // Generic sweeps (defense in depth): any email, and Israeli phone shapes
  // (05x-xxxxxxx / +972…), catching other people the free text might name.
  out = out.replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, '[מייל]');
  out = out.replace(/(?:\+972[-\s]?|0)\d(?:[-\s]?\d){7,9}/g, '[טלפון]');
  return out;
}

// Trigram Dice coefficient — an O(n) content-similarity in [0,1]. Chosen over
// edit distance so a long draft/sent pair scores in linear time, and so small
// human edits (adding an opener) don't tank the score the way raw Levenshtein
// would.
export function trigramDice(a: string, b: string): number {
  const grams = (s: string): Set<string> => {
    const t = s.toLowerCase().replace(/\s+/g, ' ').trim();
    const set = new Set<string>();
    for (let i = 0; i + 3 <= t.length; i += 1) set.add(t.slice(i, i + 3));
    return set;
  };
  const a3 = grams(a);
  const b3 = grams(b);
  if (a3.size === 0 && b3.size === 0) return 1;
  if (a3.size === 0 || b3.size === 0) return 0;
  let inter = 0;
  for (const g of a3) if (b3.has(g)) inter += 1;
  return (2 * inter) / (a3.size + b3.size);
}

function cap(text: string, max: number): string {
  const t = text.trim();
  return t.length > max ? `${t.slice(0, max)}…` : t;
}

export function toRedactedExample(raw: RawCorrection, fieldMax: number): RedactedExample {
  const inquiry = cap(redactPii(raw.message, raw.pii), fieldMax);
  const draft = cap(redactPii(raw.draft, raw.pii), fieldMax);
  const sent = cap(redactPii(raw.sent, raw.pii), fieldMax);
  return {
    topic: (raw.topic ?? '').trim() || 'אחר',
    inquiry,
    draft,
    sent,
    similarity: trigramDice(draft, sent),
  };
}

export interface CorrectionMetric {
  corrected: number; // pairs considered
  avgSimilarity: number; // mean draft↔sent similarity, 2dp
  nearVerbatim: number; // count with similarity >= threshold
  nearPct: number; // % of corrected, 0dp — the stage-3 gate baseline
}

export function summarizeMetric(
  examples: RedactedExample[],
  nearThreshold: number,
): CorrectionMetric {
  const corrected = examples.length;
  if (corrected === 0) {
    return { corrected: 0, avgSimilarity: 0, nearVerbatim: 0, nearPct: 0 };
  }
  const sum = examples.reduce((acc, e) => acc + e.similarity, 0);
  const nearVerbatim = examples.filter((e) => e.similarity >= nearThreshold).length;
  return {
    corrected,
    avgSimilarity: Math.round((sum / corrected) * 100) / 100,
    nearVerbatim,
    nearPct: Math.round((nearVerbatim / corrected) * 100),
  };
}

// Render the redacted examples as the markdown corpus the drafter reads. The
// header tells the model how to use it (learn tone/structure, never copy
// specifics), and each example is labelled by how close the human's sent reply
// was to the draft, so the model can weight "keep doing this" vs "fix this".
export function renderExamplesMarkdown(
  examples: RedactedExample[],
  nearThreshold: number,
): string {
  const lines: string[] = [
    '# דוגמאות מתוקנות — support-drafter (מוסתר-PII, נוצר אוטומטית)',
    '',
    '> קובץ זה נוצר אוטומטית ע"י `npm run fleet:agent -- distill-corrections`. כל ' +
      'דוגמה = פנייה אמיתית, הטיוטה שנכתבה, ומה שאדם **שלח בפועל** — כל ה-PII הוסתר. ' +
      '**למד מהן טון, מבנה, ורמת-פירוט; אל תעתיק פרטים ספציפיים ואל תסיק מהן עובדות ' +
      'עסקיות.** תווית "נשלח כמעט-כמו-שהוא" = הטיוטה הייתה טובה; "תוקן" = שים לב למה ' +
      'שהאדם שינה.',
    '',
  ];
  if (examples.length === 0) {
    lines.push(
      '_(אין עדיין זוגות טיוטה+נשלח לזיקוק — הקובץ יתמלא כשאדם ישלח מענה לפניות מטוייטות.)_',
      '',
    );
    return lines.join('\n');
  }
  examples.forEach((e, i) => {
    const label = e.similarity >= nearThreshold ? 'נשלח כמעט-כמו-שהוא' : 'תוקן';
    lines.push(
      `## דוגמה ${i + 1} — נושא: ${e.topic} — ${label}`,
      '',
      `**הפנייה:** ${e.inquiry}`,
      '',
      `**הטיוטה (AI):** ${e.draft}`,
      '',
      `**מה שנשלח (אדם):** ${e.sent}`,
      '',
    );
  });
  return lines.join('\n');
}
