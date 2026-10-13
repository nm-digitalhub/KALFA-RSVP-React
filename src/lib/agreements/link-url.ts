import { z } from 'zod';

// The link addresses the agreement embeds from the company settings (privacy_url, terms_url -> the {{privacyLink}} and
// {{termsLink}} tokens, template.ts). The same rule runs when the admin SAVES the settings (companySettingsSchema), so a
// bad address is refused at the source, and the PDF compiler (pdf-html.ts assertHref) and approveAgreement keep checking
// what the document is actually made of.
//
// Empty is valid: the tokens then fall back to /privacy and /terms. A value is either
//   - an absolute http(s) address (Zod's own httpUrl, no credentials in it), or
//   - a path on this site that starts with a single "/" ("//host" is a protocol-relative address to ANOTHER host).
// Whitespace, control characters and backslashes are refused in both forms: browsers and URL parsers read "/\host" and
// "/ /host" as "//host".
export const AGREEMENT_LINK_URL_ERROR =
  'כתובת הקישור חייבת להיות כתובת http/https מלאה או נתיב באתר שמתחיל ב-/ (למשל /privacy)';

const absoluteHttpUrl = z.httpUrl();

function hasUnsafeCharacter(value: string): boolean {
  if (/[\s\\]/.test(value)) return true;
  for (const char of value) {
    const code = char.codePointAt(0) ?? 0;
    if (code < 32 || code === 127) return true;
  }
  return false;
}

export function isValidAgreementLinkUrl(value: string): boolean {
  const url = value.trim();
  if (url === '') return true;
  if (hasUnsafeCharacter(url)) return false;
  if (url.startsWith('/')) return !url.startsWith('//');
  if (!absoluteHttpUrl.safeParse(url).success) return false;
  const parsed = new URL(url);
  return parsed.username === '' && parsed.password === '';
}

export const agreementLinkUrlSchema = z
  .string()
  .trim()
  .refine(isValidAgreementLinkUrl, { error: AGREEMENT_LINK_URL_ERROR });
