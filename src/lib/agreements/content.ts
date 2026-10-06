import { formatIsraelDate } from '@/lib/date';

import type { AgreementContent, CompanyInfo } from './template';

// The figures an agreement states, built from the campaign SNAPSHOT (never the live package). One builder for every way
// of agreeing — the signed pay-per-result agreement, the package approval PDF, and the on-screen terms the customer
// reads first — so the document can never disagree with what the customer saw.

export function fmtAgreementDate(iso: string | null): string {
  if (!iso) return 'לא הוגדר';
  return formatIsraelDate(iso) || 'לא הוגדר';
}

export function agreementContent(
  company: CompanyInfo,
  eventName: string,
  t: {
    pricePerReached: number;
    maxContacts: number;
    ceiling: number;
    channels: string[];
    startAt: string | null;
    closeAt: string | null;
    baseFee: number;
    includedReached: number;
    packagePrice?: number;
    contactQuota?: number;
  },
): AgreementContent {
  return {
    company: {
      name: company.name,
      id: company.id,
      address: company.address,
      contactPhone: company.contactPhone,
      contactEmail: company.contactEmail,
      privacyUrl: company.privacyUrl,
      termsUrl: company.termsUrl,
      warrantyText: company.warrantyText,
    },
    eventName,
    pricePerReached: t.pricePerReached,
    maxContacts: t.maxContacts,
    ceiling: t.ceiling,
    channels: t.channels,
    windowText: `${fmtAgreementDate(t.startAt)} – ${fmtAgreementDate(t.closeAt)}`,
    baseFee: t.baseFee,
    includedReached: t.includedReached,
    packagePrice: t.packagePrice,
    contactQuota: t.contactQuota,
  };
}
