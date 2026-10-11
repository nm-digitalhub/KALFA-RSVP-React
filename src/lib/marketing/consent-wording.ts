// The marketing-email consent wording (openspec change marketing-email-consent, design D9).
//
// The server renders it and the server records it: the browser never supplies the text or the version, so the
// recorded wording is exactly what the customer was shown. The advertiser's name comes from the company legal name in
// app_settings (getCompanyLegal), so the text names whoever is configured as the legal entity.
//
// STATUS: approved by the owner on 11.10.2026 (version 2026-10-11.1); the owner ruled that no lawyer review is
// needed. The feature is switched on separately (app_settings.marketing_consent_enabled).
//
// Changing CONSENT_TEMPLATE requires a new CONSENT_WORDING_VERSION — consent-wording.test.ts pins each version to the
// exact template text.

export const CONSENT_WORDING_VERSION = '2026-10-11.1';

const CONSENT_TEMPLATE =
  'אני מאשר/ת לקבל מ-{company} עדכונים, טיפים והצעות בדוא״ל. אפשר להסיר בכל עת בלחיצה על "הסרה" בכל הודעה או בהגדרות החשבון.';

export function consentTemplate(): string {
  return CONSENT_TEMPLATE;
}

export interface ConsentWording {
  text: string;
  version: string;
}

// The advertiser falls back to "KALFA" only when no legal name is configured, so the text never shows an empty name.
export function renderConsentWording(companyLegalName: string): ConsentWording {
  const company = companyLegalName.trim() || 'KALFA';
  return { text: CONSENT_TEMPLATE.replace('{company}', company), version: CONSENT_WORDING_VERSION };
}
