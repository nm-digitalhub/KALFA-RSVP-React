import { formatIsraelDate } from '@/lib/date';

import type { AgreementContent, CompanyInfo } from './template';

// The figures the package terms state, built from the campaign SNAPSHOT (never the live package). One builder for the
// approval PDF and the on-screen terms the customer reads first, so the document can never disagree with what the
// customer saw.

export function fmtAgreementDate(iso: string | null): string {
  if (!iso) return 'לא הוגדר';
  return formatIsraelDate(iso) || 'לא הוגדר';
}

export function agreementContent(
  company: CompanyInfo,
  eventName: string,
  t: {
    channels: string[];
    startAt: string | null;
    closeAt: string | null;
    packagePrice: number;
    contactQuota: number;
    // personal-coupons 2.3: present only when a benefit applies — the terms then state all three figures.
    listPrice?: number;
    discountAmount?: number;
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
    channels: t.channels,
    windowText: `${fmtAgreementDate(t.startAt)} – ${fmtAgreementDate(t.closeAt)}`,
    packagePrice: t.packagePrice,
    contactQuota: t.contactQuota,
    ...(t.listPrice !== undefined && t.discountAmount !== undefined
      ? { listPrice: t.listPrice, discountAmount: t.discountAmount }
      : {}),
  };
}
