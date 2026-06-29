// Versioned Hebrew agreement for campaign approval. Pure HTML builders (no I/O)
// so the exact bytes rendered to PDF (and hashed) are deterministic, and the
// SAME body is shown to the customer before signing (no drift).
//
// The contract is now DB-managed (table agreement_documents, /admin/agreement):
// version + status (draft/approved) + an OPTIONAL custom body. This module stays
// PURE — the active document is passed in as `doc`. When `doc.bodyHtml` is null
// the vetted in-code default below is used; when set, the custom HTML is rendered
// with safe {{token}} substitution. The draft marker is appended here based on
// `doc.status`, so approving the contract removes it regardless of the body.
//
// Legal basis (Israeli Consumer Protection Law §14ג distance-selling
// disclosures, Privacy Protection Law §11 + Amendment 13, Communications Law
// §30א, Electronic Signature Law). ⚠️ The default wording is a DRAFT — a
// licensed Israeli consumer-protection lawyer must approve it before go-live.

// Fallback version when no active DB document is available (e.g. pre-migration).
export const AGREEMENT_VERSION = 'draft-2026-06-v2';

// VAT is 18% in Israel (since 2025-01-01). Consumer-facing prices MUST be shown
// VAT-inclusive (§ price-display). The admin-set price is treated as the
// consumer (VAT-inclusive) price; SUMIT charges with VATIncluded=true to match.
export const VAT_RATE_PERCENT = 18;

export type AgreementStatus = 'draft' | 'approved';

// The active agreement document (from the DB) injected into the renderers.
export type AgreementDoc = {
  version: string;
  status: AgreementStatus;
  /** null → use the vetted in-code default body; set → custom HTML w/ {{tokens}}. */
  bodyHtml: string | null;
};

// Convenience default (in-code template, draft) for callers without a DB row.
export const DEFAULT_AGREEMENT_DOC: AgreementDoc = {
  version: AGREEMENT_VERSION,
  status: 'draft',
  bodyHtml: null,
};

export type CompanyInfo = {
  name: string;
  id: string;
  address: string;
  contactPhone: string;
  contactEmail: string;
  privacyUrl: string;
  termsUrl: string;
  warrantyText: string;
};

export type AgreementContent = {
  company: CompanyInfo;
  eventName: string;
  pricePerReached: number; // ₪, VAT-inclusive
  maxContacts: number;
  ceiling: number; // ₪, VAT-inclusive (price × maxContacts)
  channels: string[];
  windowText: string;
};

export type AgreementSignature = {
  signerName: string;
  verifiedPhone: string;
  signedDateText: string;
  ip: string | null;
  signatureDataUrl: string;
};

const CHANNEL_LABELS: Record<string, string> = {
  whatsapp: 'וואטסאפ',
  call: 'שיחה טלפונית (AI)',
};

function ils(n: number): string {
  return `₪${n.toLocaleString('he-IL', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// Either the configured value or a clearly-marked placeholder, so a missing
// §14ג disclosure is visible (not silently blank).
function orTodo(v: string): string {
  return v.trim() ? esc(v.trim()) : '<span class="todo">[יושלם]</span>';
}

// The draft marker. Appended by the renderer ONLY for a draft document, so the
// Approve action (status → approved) removes it without touching the body.
const DRAFT_MARKER =
  '\n\n  <div class="draft">טיוטה — נוסח משפטי לאישור עו"ד (דיני הגנת הצרכן) טרם הפעלה מסחרית.</div>';

// Shared CSS — injected into the PDF document AND the on-page preview so the
// customer sees exactly what is signed.
export const AGREEMENT_CSS = `
  .agreement-doc { font-family: "Noto Sans Hebrew", "DejaVu Sans", sans-serif; direction: rtl; color: #1a1a1a; line-height: 1.7; }
  .agreement-doc h1 { font-size: 22px; margin: 0 0 4px; }
  .agreement-doc .sub { color: #666; font-size: 13px; margin-bottom: 20px; }
  .agreement-doc h2 { font-size: 16px; margin: 20px 0 6px; border-bottom: 1px solid #e3e3e8; padding-bottom: 4px; }
  .agreement-doc p { margin: 6px 0; }
  .agreement-doc ul { padding-inline-start: 22px; margin: 6px 0; }
  .agreement-doc dl.terms { background: #f7f7f9; border: 1px solid #e3e3e8; border-radius: 8px; padding: 14px; display: grid; grid-template-columns: auto 1fr; gap: 4px 14px; margin: 6px 0; }
  .agreement-doc dl.terms dt { font-weight: 700; }
  .agreement-doc dl.terms dd { margin: 0; }
  .agreement-doc .intent { background: #fff7ed; border: 1px solid #fed7aa; border-radius: 8px; padding: 12px; font-weight: 600; }
  .agreement-doc .todo { color: #b45309; font-weight: 700; }
  .agreement-doc .sig img { border: 1px solid #ccc; border-radius: 6px; max-width: 320px; height: auto; background: #fff; }
  .agreement-doc .meta { color: #555; font-size: 12px; margin-top: 8px; }
  .agreement-doc .draft { color: #b45309; font-size: 11px; margin-top: 22px; }
`;

// The fixed, safe placeholder set available to a custom (admin-edited) body.
// Values are pre-escaped/formatted; substitution is a literal token replace
// (no eval). Unknown tokens are left as-is.
function tokenMap(c: AgreementContent, version: string): Record<string, string> {
  const channelList = c.channels.map((ch) => CHANNEL_LABELS[ch] ?? ch).join(', ');
  const privacyLink = `<a href="${esc(c.company.privacyUrl.trim() || '/privacy')}">מדיניות הפרטיות</a>`;
  const termsLink = `<a href="${esc(c.company.termsUrl.trim() || '/terms')}">תנאי השירות</a>`;
  return {
    version: esc(version),
    eventName: esc(c.eventName),
    pricePerReached: ils(c.pricePerReached),
    maxContacts: c.maxContacts.toLocaleString('he-IL'),
    ceiling: ils(c.ceiling),
    channels: esc(channelList),
    windowText: esc(c.windowText),
    vatRate: String(VAT_RATE_PERCENT),
    'company.name': orTodo(c.company.name),
    'company.id': orTodo(c.company.id),
    'company.address': orTodo(c.company.address),
    'company.contactPhone': orTodo(c.company.contactPhone),
    'company.contactEmail': orTodo(c.company.contactEmail),
    'company.warrantyText': orTodo(c.company.warrantyText),
    privacyLink,
    termsLink,
  };
}

// `extraTokens` lets render callers inject ADDITIONAL placeholders (e.g. the
// admin-config tokens serviceActivationWindow / offerValidityDays / chargeWindowDays
// / holdReleaseDays / liabilityCap / retentionDays / recordRetentionMonths) so a
// custom body may reference them. They are treated as plain text and run through
// esc() here — therefore the caller (and the data layer it reads from) MUST pass
// RAW, un-escaped strings; escaping is owned by this module to avoid double-escape.
//
// Precedence: built-in tokens WIN on key collision (extraTokens are spread first,
// the built-in map last), so config can never shadow a vetted built-in value. The
// 7 config tokens above don't collide with any built-in name, so this is purely a
// defensive guarantee. Unknown tokens (in neither map) are left literal, as before.
function substituteTokens(
  html: string,
  c: AgreementContent,
  version: string,
  extraTokens: Record<string, string> = {},
): string {
  const escapedExtra: Record<string, string> = {};
  for (const [key, value] of Object.entries(extraTokens)) {
    escapedExtra[key] = esc(value);
  }
  const tokens = { ...escapedExtra, ...tokenMap(c, version) };
  return html.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (whole, key: string) =>
    Object.prototype.hasOwnProperty.call(tokens, key) ? tokens[key] : whole,
  );
}

// The vetted in-code default body (used when the active document has no custom
// body). NO draft marker here — the renderer appends it based on status.
function defaultBody(c: AgreementContent, version: string): string {
  const channelList = c.channels
    .map((ch) => CHANNEL_LABELS[ch] ?? ch)
    .join(', ');

  // Default to the internal public pages when the admin hasn't set external URLs.
  const privacyLink = `<a href="${esc(c.company.privacyUrl.trim() || '/privacy')}">מדיניות הפרטיות</a>`;
  const termsLink = `<a href="${esc(c.company.termsUrl.trim() || '/terms')}">תנאי השירות</a>`;

  return `
  <h1>הסכם אישור קמפיין ושירות — KALFA</h1>
  <div class="sub">חיוב לפי תוצאה — איש קשר ייחודי שהושג · גרסה ${esc(version)}</div>

  <h2>1. הצדדים</h2>
  <p>הסכם זה בין <strong>${orTodo(c.company.name)}</strong> (ח.פ./ע.מ. ${orTodo(c.company.id)}), מרחוב ${orTodo(c.company.address)} ("נותנת השירות" / "KALFA"), לבין הלקוח החתום מטה ("הלקוח"), עבור האירוע <strong>${esc(c.eventName)}</strong>.</p>
  <p>פרטי קשר לפניות, תמיכה וביטול: טלפון ${orTodo(c.company.contactPhone)} · דוא"ל ${orTodo(c.company.contactEmail)}.</p>

  <h2>2. תיאור השירות</h2>
  <p>KALFA מפעילה עבור הלקוח קמפיין אישורי הגעה (RSVP) לאורחי האירוע, בשני ערוצי תקשורת: ${esc(channelList)}. השירות פונה לאנשי הקשר ברשימת המוזמנים ואוסף את תגובותיהם.</p>

  <h2>3. המחיר והחיוב</h2>
  <dl class="terms">
    <dt>מחיר לאיש קשר שהושג</dt><dd>${ils(c.pricePerReached)} (כולל מע"מ ${VAT_RATE_PERCENT}%)</dd>
    <dt>מספר אנשי קשר מרבי</dt><dd>${c.maxContacts.toLocaleString('he-IL')}</dd>
    <dt>תקרת חיוב מרבית</dt><dd>${ils(c.ceiling)} (כולל מע"מ) — מחיר ליחידה × מספר אנשי הקשר</dd>
    <dt>חלון פעילות</dt><dd>${esc(c.windowText)}</dd>
  </dl>
  <p>הלקוח מתחייב לשלם עבור כל <strong>איש קשר ייחודי שהושג</strong> — אדם שיצר אינטראקציה אנושית מאומתת (תגובת וואטסאפ נכנסת אמיתית, או מענה אנושי בשיחה) — פעם אחת לכל איש קשר, ועד לתקרה. <strong>החיוב הסופי הוא לפי מספר אנשי הקשר שהושגו בפועל</strong>, ומחושב בסגירת הקמפיין.</p>
  <p><strong>לא יחויבו:</strong></p>
  <ul>
    <li>הודעה שנשלחה / נמסרה / נקראה ללא תגובה</li>
    <li>צלצול ללא מענה אנושי, תא קולי או משיבון</li>
    <li>מספר שגוי או לא זמין</li>
    <li>אותו איש קשר יותר מפעם אחת באותו אירוע</li>
  </ul>

  <h2>4. אמצעי תשלום והרשאת חיוב</h2>
  <p>הלקוח מאשר שמירת אמצעי תשלום ו/או תפיסת מסגרת אשראי עד גובה התקרה, ומורה לחייב בסגירת הקמפיין את הסכום בפועל (לכל היותר התקרה). חיוב 0 אנשי קשר → אין חיוב. נתוני הכרטיס מנוהלים באמצעות ספק סליקה מאובטח (טוקניזציה); KALFA אינה שומרת את פרטי הכרטיס.</p>

  <h2>5. זכות ביטול (חוק הגנת הצרכן §14ג)</h2>
  <p>הלקוח רשאי לבטל את העסקה בכתב (לפרטי הקשר בסעיף 1) בתוך <strong>14 ימים</strong> ממועד ההתקשרות או מקבלת מסמך זה, לפי המאוחר; ובכל מקרה עד <strong>שני ימים (שאינם ימי מנוחה) לפני מועד הפעלת הקמפיין</strong> — שכן הפעלת הקמפיין מהווה תחילת מתן השירות.</p>
  <p><strong>הארכה:</strong> אדם עם מוגבלות, אזרח ותיק (גיל 65+) או עולה חדש (פחות מ‑5 שנים בישראל) רשאי לבטל בתוך <strong>4 חודשים</strong>, בכפוף לתנאי החוק.</p>
  <p>דמי ביטול: עד 5% מערך העסקה או ${ils(100)}, לפי הנמוך. החזר כספי יבוצע בתוך 14 ימים מקבלת הודעת הביטול, באמצעי התשלום המקורי. לאחר תחילת מתן השירות, ניתן לחייב על שירות שכבר ניתן.</p>

  <h2>6. אחריות</h2>
  <p>${orTodo(c.company.warrantyText)}</p>

  <h2>7. פרטיות ומידע אישי</h2>
  <p>נתוני האורחים (טלפונים ותגובות) הם בבעלות הלקוח, שהוא <strong>בעל המאגר</strong> לגביהם; KALFA פועלת כ<strong>מחזיק/מעבד</strong> בשמו. לגבי נתוני האימות של החותם (טלפון מאומת, חתימה) KALFA היא בעלת השליטה. עיבוד המידע נעשה למטרת מתן השירות בלבד, ובהתאם ל${privacyLink} ול${termsLink}.</p>
  <p>בהתאם לחוק הגנת הפרטיות (כולל תיקון 13), <strong>כתובת IP ומזהי מכשיר נחשבים מידע אישי</strong>; הלקוח מאשר את איסופם ושמירתם כמפורט בסעיף 9 (ראיה). KALFA מיישמת אבטחת מידע לפי תקנות הגנת הפרטיות (אבטחת מידע), התשע"ז‑2017.</p>

  <h2>8. הצהרת הלקוח לגבי פנייה לאורחים</h2>
  <p>הלקוח מצהיר ומתחייב כי קיים לו בסיס חוקי לפנות לאורחים אלה, וכי מספרי הטלפון הושגו כדין. ההודעות הן הזמנת RSVP אישית ואינן כוללות פרסום או מיתוג של KALFA. כל בקשת הסרה תכובד בכל ערוץ. הלקוח <strong>משפה</strong> את KALFA בגין כל תביעה הנובעת מהפרת הצהרה זו (לרבות לפי §30א לחוק התקשורת).</p>

  <h2>9. עוגן ראייתי לחתימה</h2>
  <p>הצדדים מסכימים כי לצורך הוכחת ההסכמה והזיהוי, KALFA רושמת ושומרת את הראיות הבאות, והלקוח מסכים כי הן מהוות ראיה קבילה להסכמתו ולזהותו: <strong>החתימה האלקטרונית</strong>; <strong>אימות הטלפון בקוד חד‑פעמי (OTP)</strong>; <strong>כתובת ה‑IP</strong>; <strong>מזהה הדפדפן/מכשיר</strong> (User‑Agent); <strong>חותמת‑זמן השרת</strong>; וכן גרסת ההסכם וטביעת ה‑hash (SHA‑256) של המסמך החתום.</p>

  <div class="intent">
    10. הצהרת כוונה: הלקוח מצהיר כי קרא והבין הסכם זה, מסכים לתנאיו, ומתחייב באופן מחייב לתשלום כמפורט. החתימה האלקטרונית להלן, יחד עם אימות הטלפון, מהוות הסכמה מחייבת.
  </div>`;
}

// The agreement body (all clauses) — shown to the customer before signing AND
// embedded in the PDF. No signature here. `doc` selects custom vs default body,
// its version, and whether the draft marker is appended (status='draft').
//
// `extraTokens` are injected only into a CUSTOM body (the in-code default body
// does not use {{tokens}}); see substituteTokens for escaping + precedence. Pass
// RAW (un-escaped) admin-config values — this module escapes them.
export function renderAgreementBody(
  c: AgreementContent,
  doc: AgreementDoc = DEFAULT_AGREEMENT_DOC,
  extraTokens: Record<string, string> = {},
): string {
  const inner =
    doc.bodyHtml != null && doc.bodyHtml.trim() !== ''
      ? substituteTokens(doc.bodyHtml, c, doc.version, extraTokens)
      : defaultBody(c, doc.version);
  return doc.status === 'draft' ? inner + DRAFT_MARKER : inner;
}

// Full self-contained HTML document for the PDF: CSS + body + signature block.
// `extraTokens` are forwarded to the body (custom bodies only); pass RAW values.
export function renderAgreementDocument(
  c: AgreementContent,
  sig: AgreementSignature,
  doc: AgreementDoc = DEFAULT_AGREEMENT_DOC,
  extraTokens: Record<string, string> = {},
): string {
  const signatureBlock = `
  <div class="sig">
    <h2>חתימה וזיהוי</h2>
    <img src="${sig.signatureDataUrl}" alt="חתימה">
    <div class="meta">חתם/ה: ${esc(sig.signerName)} · טלפון מאומת: ${esc(sig.verifiedPhone)} · תאריך: ${esc(sig.signedDateText)}${sig.ip ? ` · IP: ${esc(sig.ip)}` : ''} · גרסה: ${esc(doc.version)}</div>
  </div>`;

  return `<!doctype html>
<html lang="he" dir="rtl">
<head><meta charset="utf-8"><style>* { box-sizing: border-box; } body { margin: 40px; }${AGREEMENT_CSS}</style></head>
<body><div class="agreement-doc">${renderAgreementBody(c, doc, extraTokens)}${signatureBlock}</div></body>
</html>`;
}
