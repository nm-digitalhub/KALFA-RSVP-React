// Pure Hebrew (RTL) HTML email templates. Inline styles for email-client
// compatibility. No I/O — unit-testable.

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
<body style="font-family:Arial,Helvetica,sans-serif;direction:rtl;color:#1a1a1a;line-height:1.7;margin:0;padding:24px;background:#f5f5f7">
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
export function inquiryReplyEmail(input: {
  recipientName: string;
  replyText: string;
}): { subject: string; html: string; text: string } {
  const name = input.recipientName.trim() || 'לקוח יקר';
  const subject = 'תגובה לפנייתך — KALFA';
  const text = `שלום ${name},

${input.replyText}

בברכה,
צוות KALFA`;
  const html = `<!doctype html>
<html lang="he" dir="rtl">
<body style="font-family:Arial,Helvetica,sans-serif;direction:rtl;color:#1a1a1a;line-height:1.7;margin:0;padding:24px;background:#f5f5f7">
  <div style="max-width:560px;margin:0 auto;background:#ffffff;border-radius:10px;padding:24px;border:1px solid #e3e3e8">
    <h1 style="font-size:20px;margin:0 0 12px">תודה שפנית אלינו</h1>
    <p style="margin:8px 0">שלום ${esc(name)},</p>
    <div style="margin:12px 0;white-space:pre-line">${esc(input.replyText)}</div>
    <hr style="border:none;border-top:1px solid #eee;margin:18px 0">
    <p style="margin:0;color:#888;font-size:12px">בברכה, צוות KALFA</p>
  </div>
</body>
</html>`;
  return { subject, html, text };
}
