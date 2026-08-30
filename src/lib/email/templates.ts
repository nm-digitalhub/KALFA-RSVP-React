// Pure Hebrew (RTL) HTML email templates. Inline styles for email-client
// compatibility. No I/O — unit-testable.
//
// `lang`/`dir` are set on BOTH <html> and <body> deliberately: some email
// clients strip one tag or the other, and with the attributes on <html> alone a
// stripped wrapper drops the whole message to LTR — which for Hebrew means
// mangled punctuation and reversed line alignment, not a cosmetic difference.
// (react-email's Html/Body component docs give the same instruction, for the
// same reason.)

import { escapeHtml as esc } from '@/lib/html';

// Email notifying the customer their agreement is signed, with a SECURE LINK to
// view/download the PDF (not an attachment — avoids recipient attachment
// scanners flagging it). Satisfies §14ג(ב): the document is provided + saveable.
// Returns a plain-text alternative too (multipart improves inbox placement).
export function agreementEmail(input: {
  signerName: string;
  eventName: string;
  companyName: string;
  downloadUrl: string;
}): { subject: string; html: string; text: string } {
  const company = input.companyName.trim() || 'KALFA';
  const subject = `ההסכם החתום שלך — ${input.eventName}`;
  const text = `שלום ${input.signerName},

ההסכם נחתם בהצלחה עבור האירוע "${input.eventName}".
לצפייה ולהורדת ההסכם החתום:
${input.downloadUrl}
(הקישור מאובטח ודורש התחברות לחשבון.) אנא שמרו עותק לרשומותיכם.

${company}`;
  const html = `<!doctype html>
<html lang="he" dir="rtl">
<body lang="he" dir="rtl" style="font-family:Arial,Helvetica,sans-serif;direction:rtl;color:#1a1a1a;line-height:1.7;margin:0;padding:24px;background:#f5f5f7">
  <div style="max-width:560px;margin:0 auto;background:#ffffff;border-radius:10px;padding:24px;border:1px solid #e3e3e8">
    <h1 style="font-size:20px;margin:0 0 12px">ההסכם נחתם בהצלחה ✓</h1>
    <p style="margin:8px 0">שלום ${esc(input.signerName)},</p>
    <p style="margin:8px 0">ההסכם החתום עבור האירוע <strong>${esc(input.eventName)}</strong> מוכן.</p>
    <p style="margin:20px 0"><a href="${esc(input.downloadUrl)}" style="display:inline-block;background:#4338ca;color:#ffffff;padding:11px 20px;border-radius:8px;text-decoration:none;font-weight:600">צפייה והורדת ההסכם החתום</a></p>
    <p style="margin:8px 0;color:#555;font-size:13px">הקישור מאובטח ודורש התחברות לחשבון. אנא שמרו עותק לרשומותיכם.</p>
    <hr style="border:none;border-top:1px solid #eee;margin:18px 0">
    <p style="margin:0;color:#888;font-size:12px">${esc(company)}</p>
  </div>
</body>
</html>`;
  return { subject, html, text };
}

// A human (admin) reply to a customer inquiry submitted via /contact. The reply
// body is authored by staff; we only wrap it in the branded RTL shell and
// preserve its line breaks (white-space:pre-line + escapeHtml, never raw HTML
// from the textarea). Transactional/responsive — the recipient initiated the
// conversation by submitting the form.

// The drafter writes plain Hebrew with markdown-style emphasis (`**כותרת**`),
// because that is how a person writes a structured reply. Rendering it raw put
// literal asterisks in front of a customer — observed in a delivered message.
//
// Escape FIRST, convert SECOND. `escapeHtml` has already neutralised every `<`
// and `&` by the time this runs, so the only tags that can reach the output are
// the ones added here.
//
// WHY NOT A MARKDOWN LIBRARY. `@react-email/markdown` (by the Resend team whose
// SDK is already our transport) is the obvious flow to reuse here, and it is the
// wrong tool for THIS input. MEASURED against the published 0.0.18 tarball, not
// inferred from its docs: it renders `marked.parse()` through
// `dangerouslySetInnerHTML` with no sanitizer, and rendering
// `<script>alert(1)</script> <img src=x onerror=alert(2)>` through it returned
// both verbatim. Our body is authored by an AI drafter — precisely the input
// class that must not reach an unsanitized path. Escape-first plus the two
// narrow conversions below is STRICTER than the library, not lazier than it.

// A link target is a same-origin PATH, never a full URL. No scheme is accepted
// at all, so `javascript:` and `data:` cannot be expressed — the reason
// path-only beats a scheme allowlist. `(?!\/)` rejects `//host`, which a URL
// parser resolves to an EXTERNAL host; the character class excludes whitespace,
// control characters, backslash, quotes and angle brackets, mirroring the
// policy `resolveInternalTarget` (src/lib/url.ts) enforces for app links. `&`
// and `;` are permitted only so an escaped query separator (`&amp;`) survives —
// a raw `&` cannot exist here, escapeHtml ran first.
const MD_LINK = /\[([^\]\n]+)\]\((\/(?!\/)[A-Za-z0-9\-._~/?#=&;%+,:@!$'*]*)\)/g;

// Links convert BEFORE bold, and the link text excludes `]`: with bold first,
// `[**הרשמה**](/auth/signup)` would already contain a `<strong>` tag by the time
// the link pattern ran, and the pattern would have to tolerate markup.
function inlineMarkdownToHtml(escaped: string, origin: string): string {
  return escaped
    .replace(
      MD_LINK,
      (_m, text: string, path: string) =>
        `<a href="${origin}${path}" style="color:#4338ca;text-decoration:underline;font-weight:600">${text}</a>`,
    )
    .replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>');
}

// The plain-text alternative has to resolve links too. Without this the
// customer receives the literal `[הרשמה](/auth/signup)` — markdown source, in
// their inbox — whenever their client prefers text/plain.
//
// Parenthesised, not `text: url`. Two reasons, both observed while rendering a
// real reply: a colon cuts the Hebrew sentence in half when the link sits
// mid-clause ("פתיחת חשבון: https://… היא בחינם"), and a URL that ends a
// sentence swallows the following full stop into the autolink most clients
// build. Parentheses close before the punctuation, so neither happens.
function inlineMarkdownToText(body: string, origin: string): string {
  return body.replace(
    MD_LINK,
    (_m, text: string, path: string) => `${text} (${origin}${path})`,
  );
}

// The email template owns the sign-off — it is the branded footer under the
// rule. A drafter that signs the body too produces two of them, one directly
// above the other, which is what a delivered reply actually looked like.
// Stripping here fixes it for every author (agent or human) rather than relying
// on everyone remembering.
const TRAILING_SIGNOFF =
  /\s*(?:בברכה|בכבוד רב|תודה)\s*,?\s*\n+\s*(?:צוות\s+)?KALFA\s*$/;

// The symmetric case, and it shipped: the template already renders a heading
// AND `שלום {name},`, so a drafter that opens with its own greeting produces two
// of them. Matching requires a LINE BREAK after the greeting, so a real
// sentence that merely starts with the word ("שלום, אשמח לעזור לך…" on one
// line) is left alone — only a standalone greeting line is removed.
const LEADING_GREETING =
  /^\s*(?:שלום|היי|הי|אהלן)(?:[ \t]+[^\n,]{1,30})?[ \t]*,?[ \t]*\r?\n+/;

function stripDuplicateFraming(body: string): string {
  return body.replace(LEADING_GREETING, '').replace(TRAILING_SIGNOFF, '').trim();
}

// Shared subject builder for every outbound send on an inquiry thread (admin
// reply, reminder, closing warning, rating request). `[KLF-XXXXXXXX]` is the
// contact_messages.ref_code matching token intakeMailAsInquiry parses out of a
// reply's subject (docs/inquiry-email-threading-fix-plan-2026-08-25.md §2.1/§2.3).
const THREAD_SUBJECT = 'תגובה לפנייתך — KALFA';

function threadSubject(refCode: string, isFirst: boolean): string {
  const tag = `[KLF-${refCode}]`;
  // `Re:` at the very front, not after the tag — matches Resend's own documented
  // example, and gives a mail client's own leading-"Re:" detection the best
  // chance of actually firing instead of double-prefixing a genuine customer
  // reply (§2.2).
  return isFirst ? `${tag} ${THREAD_SUBJECT}` : `Re: ${tag} ${THREAD_SUBJECT}`;
}

export function inquiryReplyEmail(input: {
  recipientName: string;
  replyText: string;
  /**
   * Absolute origin the signature image is served from. Passed in rather than
   * read here so this stays a pure function, and so the URL can never drift
   * from the one the rest of the app uses — the caller resolves it with the
   * same getAppOrigin() every other absolute link goes through.
   */
  origin: string;
  refCode: string;
  /**
   * Caller-computed, not derived here (§2.2/§3.1): a hardcoded literal would be
   * wrong for a genuine first admin reply after a reopen, or a second admin
   * reply sent before the customer has replied even once.
   */
  isFirst: boolean;
}): { subject: string; html: string; text: string } {
  const name = input.recipientName.trim() || 'לקוח יקר';
  const subject = threadSubject(input.refCode, input.isFirst);
  const body = stripDuplicateFraming(input.replyText);
  // Plain-text alternative: emphasis markers are left as-is. `**` reads fine as
  // emphasis in a text-only client, and stripping it would lose the structure
  // the drafter meant. Links, however, MUST be resolved — markdown source in a
  // customer's inbox is not a fallback, it is a bug.
  const text = `שלום ${name},

${inlineMarkdownToText(body, input.origin)}

בברכה,
צוות KALFA`;
  const html = `<!doctype html>
<html lang="he" dir="rtl">
<body lang="he" dir="rtl" style="font-family:Arial,Helvetica,sans-serif;direction:rtl;color:#1a1a1a;line-height:1.7;margin:0;padding:24px;background:#f5f5f7">
  <div style="max-width:560px;margin:0 auto;background:#ffffff;border-radius:10px;padding:24px;border:1px solid #e3e3e8">
    <h1 style="font-size:20px;margin:0 0 12px">תודה שפנית אלינו</h1>
    <p style="margin:8px 0">שלום ${esc(name)},</p>
    <div style="margin:12px 0;white-space:pre-line">${inlineMarkdownToHtml(esc(body), esc(input.origin))}</div>
    <hr style="border:none;border-top:1px solid #eee;margin:18px 0 14px">
    <p style="margin:0 0 6px;color:#888;font-size:12px">בברכה,</p>
    <img src="${esc(input.origin)}/brand/kalfa-signature.png" width="200" height="63"
         alt="נתנאל ק׳ — KALFA"
         style="display:block;width:200px;height:63px;border:0;outline:none;max-width:100%">
  </div>
</body>
</html>`;
  return { subject, html, text };
}

const CANCELLATION_RESOLUTION_COPY: Record<
  'full_cancellation' | 'partial_charge' | 'declined',
  (amount?: number) => { subjectSuffix: string; opening: string }
> = {
  full_cancellation: () => ({
    subjectSuffix: 'בקשתך אושרה',
    opening: 'בקשתך לביטול האירוע אושרה — הביטול בוצע במלואו, ללא חיוב.',
  }),
  partial_charge: (amount) => ({
    subjectSuffix: 'בקשתך אושרה עם חיוב חלקי',
    opening: `בקשתך לביטול האירוע אושרה, עם חיוב חלקי של ₪${amount} עבור שירות שכבר סופק.`,
  }),
  declined: () => ({
    subjectSuffix: 'עדכון לגבי בקשתך',
    opening: 'בדקנו את בקשתך לביטול האירוע — לא ניתן לאשר את הביטול בשלב זה.',
  }),
};

export function cancellationRequestResponseEmail(input: {
  recipientName: string;
  requestNumber: number;
  resolution: 'full_cancellation' | 'partial_charge' | 'declined';
  resolutionAmount?: number;
  resolutionNote: string;
  origin: string;
}): { subject: string; html: string; text: string } {
  const name = input.recipientName.trim() || 'לקוח יקר';
  const copy = CANCELLATION_RESOLUTION_COPY[input.resolution](input.resolutionAmount);
  const subject = `בקשת ביטול #${input.requestNumber} — ${copy.subjectSuffix}`;
  const note = stripDuplicateFraming(input.resolutionNote);
  const text = `שלום ${name},

בקשת ביטול #${input.requestNumber}: ${copy.opening}

${inlineMarkdownToText(note, input.origin)}

בברכה,
צוות KALFA`;
  const html = `<!doctype html>
<html lang="he" dir="rtl">
<body lang="he" dir="rtl" style="font-family:Arial,Helvetica,sans-serif;direction:rtl;color:#1a1a1a;line-height:1.7;margin:0;padding:24px;background:#f5f5f7">
  <div style="max-width:560px;margin:0 auto;background:#ffffff;border-radius:10px;padding:24px;border:1px solid #e3e3e8">
    <h1 style="font-size:20px;margin:0 0 12px">בקשת ביטול #${input.requestNumber}</h1>
    <p style="margin:8px 0">שלום ${esc(name)},</p>
    <p style="margin:8px 0">${esc(copy.opening)}</p>
    <div style="margin:12px 0;white-space:pre-line">${inlineMarkdownToHtml(esc(note), esc(input.origin))}</div>
    <hr style="border:none;border-top:1px solid #eee;margin:18px 0 14px">
    <p style="margin:0 0 6px;color:#888;font-size:12px">בברכה,</p>
    <img src="${esc(input.origin)}/brand/kalfa-signature.png" width="200" height="63"
         alt="נתנאל ק׳ — KALFA"
         style="display:block;width:200px;height:63px;border:0;outline:none;max-width:100%">
  </div>
</body>
</html>`;
  return { subject, html, text };
}

// Two-stage silence follow-up on an inquiry the admin already replied to and
// the customer went quiet on (inquiry-followup.ts's sweep). Both are
// transactional/responsive on the SAME reasoning `inquiryReplyEmail` already
// rests on above: the recipient is the one who opened this conversation, this
// is a continuation of it, not new outreach. Neither offers a self-service
// "close this" link on purpose — replying is the only action either asks for,
// and the sweep decides the outcome either way.
export function inquiryReminderEmail(input: {
  recipientName: string;
  origin: string;
  refCode: string;
}): { subject: string; html: string; text: string } {
  const name = input.recipientName.trim() || 'לקוח יקר';
  // Always a reply on an existing thread by definition — never the first
  // message (§2.2).
  const subject = threadSubject(input.refCode, /* isFirst */ false);
  const text = `שלום ${name},

לפני כמה ימים ענינו לפנייה שלך. רצינו לוודא שהכול הסתדר.

אם עדיין צריך עזרה — פשוט השב/י למייל הזה. אם הכול טופל, אין צורך לעשות דבר.

בברכה,
צוות KALFA`;
  const html = `<!doctype html>
<html lang="he" dir="rtl">
<body lang="he" dir="rtl" style="font-family:Arial,Helvetica,sans-serif;direction:rtl;color:#1a1a1a;line-height:1.7;margin:0;padding:24px;background:#f5f5f7">
  <div style="max-width:560px;margin:0 auto;background:#ffffff;border-radius:10px;padding:24px;border:1px solid #e3e3e8">
    <h1 style="font-size:20px;margin:0 0 12px">עדיין צריך עזרה?</h1>
    <p style="margin:8px 0">שלום ${esc(name)},</p>
    <p style="margin:8px 0">לפני כמה ימים ענינו לפנייה שלך. רצינו לוודא שהכול הסתדר.</p>
    <p style="margin:8px 0">אם עדיין צריך עזרה — פשוט השיבו למייל הזה. אם הכול טופל, אין צורך לעשות דבר.</p>
    <hr style="border:none;border-top:1px solid #eee;margin:18px 0 14px">
    <p style="margin:0 0 6px;color:#888;font-size:12px">בברכה,</p>
    <img src="${esc(input.origin)}/brand/kalfa-signature.png" width="200" height="63"
         alt="נתנאל ק׳ — KALFA"
         style="display:block;width:200px;height:63px;border:0;outline:none;max-width:100%">
  </div>
</body>
</html>`;
  return { subject, html, text };
}

export function inquiryClosingWarningEmail(input: {
  recipientName: string;
  origin: string;
  refCode: string;
}): { subject: string; html: string; text: string } {
  const name = input.recipientName.trim() || 'לקוח יקר';
  const subject = threadSubject(input.refCode, /* isFirst */ false);
  const text = `שלום ${name},

לא שמענו ממך זמן רב לגבי הפנייה שענינו לה. פניות שלא נענות זמן רב מסומנות אצלנו כטופלות.

אם עדיין צריך עזרה — פשוט השב/י למייל הזה, ונחזור לטפל בזה.

בברכה,
צוות KALFA`;
  const html = `<!doctype html>
<html lang="he" dir="rtl">
<body lang="he" dir="rtl" style="font-family:Arial,Helvetica,sans-serif;direction:rtl;color:#1a1a1a;line-height:1.7;margin:0;padding:24px;background:#f5f5f7">
  <div style="max-width:560px;margin:0 auto;background:#ffffff;border-radius:10px;padding:24px;border:1px solid #e3e3e8">
    <h1 style="font-size:20px;margin:0 0 12px">הפנייה שלך תיסגר בקרוב</h1>
    <p style="margin:8px 0">שלום ${esc(name)},</p>
    <p style="margin:8px 0">לא שמענו ממך זמן רב לגבי הפנייה שענינו לה. פניות שלא נענות זמן רב מסומנות אצלנו כטופלות.</p>
    <p style="margin:8px 0">אם עדיין צריך עזרה — פשוט השיבו למייל הזה, ונחזור לטפל בזה.</p>
    <hr style="border:none;border-top:1px solid #eee;margin:18px 0 14px">
    <p style="margin:0 0 6px;color:#888;font-size:12px">בברכה,</p>
    <img src="${esc(input.origin)}/brand/kalfa-signature.png" width="200" height="63"
         alt="נתנאל ק׳ — KALFA"
         style="display:block;width:200px;height:63px;border:0;outline:none;max-width:100%">
  </div>
</body>
</html>`;
  return { subject, html, text };
}

// CSAT request sent once the followup sweep auto-closes an inquiry on
// sustained silence (inquiry-followup.ts). Three emoji LINKS, not buttons —
// each takes the customer straight to /rate/{token}?score=N with that score
// pre-selected; the page (a public, unauthenticated surface keyed by the
// opaque token alone) still lets them change it and add a comment before
// submitting. Unicode emoji, not inline SVG/images: email clients render
// emoji far more reliably than embedded graphics (confirmed against the
// design mockup built for this feature) — the public PAGE itself uses real
// lucide icons instead, since a real web page doesn't have email's rendering
// constraints.
export function inquiryRatingRequestEmail(input: {
  recipientName: string;
  ratingToken: string;
  origin: string;
  refCode: string;
}): { subject: string; html: string; text: string } {
  const name = input.recipientName.trim() || 'לקוח יקר';
  const subject = threadSubject(input.refCode, /* isFirst */ false);
  const rateUrl = (score: 1 | 2 | 3) =>
    `${input.origin}/rate/${encodeURIComponent(input.ratingToken)}?score=${score}`;
  const text = `שלום ${name},

הפנייה שלך סומנה כטופלה. נשמח לדעת איך היה — לחיצה אחת מספיקה:

לא היה טוב: ${rateUrl(1)}
בסדר: ${rateUrl(2)}
מצוין: ${rateUrl(3)}

בברכה,
צוות KALFA`;
  const html = `<!doctype html>
<html lang="he" dir="rtl">
<body lang="he" dir="rtl" style="font-family:Arial,Helvetica,sans-serif;direction:rtl;color:#1a1a1a;line-height:1.7;margin:0;padding:24px;background:#f5f5f7">
  <div style="max-width:560px;margin:0 auto;background:#ffffff;border-radius:10px;padding:24px;border:1px solid #e3e3e8">
    <h1 style="font-size:20px;margin:0 0 12px">תודה שפנית אלינו 🙂</h1>
    <p style="margin:8px 0">שלום ${esc(name)},</p>
    <p style="margin:8px 0">הפנייה שלך סומנה כטופלה. נשמח לדעת איך היה — לחיצה אחת מספיקה:</p>
    <table role="presentation" style="margin:20px auto 6px;border-collapse:collapse">
      <tr>
        <td style="padding:0 8px;text-align:center">
          <a href="${esc(rateUrl(1))}" style="display:block;width:52px;height:52px;line-height:52px;border-radius:14px;border:2px solid #e3e3e8;background:#f8f8fb;font-size:26px;text-decoration:none">😕</a>
          <span style="display:block;margin-top:6px;font-size:11px;color:#4b4b55">לא היה טוב</span>
        </td>
        <td style="padding:0 8px;text-align:center">
          <a href="${esc(rateUrl(2))}" style="display:block;width:52px;height:52px;line-height:52px;border-radius:14px;border:2px solid #e3e3e8;background:#f8f8fb;font-size:26px;text-decoration:none">😐</a>
          <span style="display:block;margin-top:6px;font-size:11px;color:#4b4b55">בסדר</span>
        </td>
        <td style="padding:0 8px;text-align:center">
          <a href="${esc(rateUrl(3))}" style="display:block;width:52px;height:52px;line-height:52px;border-radius:14px;border:2px solid #e3e3e8;background:#f8f8fb;font-size:26px;text-decoration:none">😊</a>
          <span style="display:block;margin-top:6px;font-size:11px;color:#4b4b55">מצוין</span>
        </td>
      </tr>
    </table>
    <hr style="border:none;border-top:1px solid #eee;margin:18px 0 14px">
    <p style="margin:0 0 6px;color:#888;font-size:12px">בברכה,</p>
    <img src="${esc(input.origin)}/brand/kalfa-signature.png" width="200" height="63"
         alt="נתנאל ק׳ — KALFA"
         style="display:block;width:200px;height:63px;border:0;outline:none;max-width:100%">
  </div>
</body>
</html>`;
  return { subject, html, text };
}
