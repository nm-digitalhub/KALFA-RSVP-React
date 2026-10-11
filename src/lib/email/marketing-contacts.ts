import 'server-only';

import { Resend } from 'resend';

// The marketing contact list at Resend (openspec change marketing-email-consent, design D4).
//
// One consent maps to the contact-level `unsubscribed` flag — the field Resend's contact.updated webhook reports. No
// Topics, no segments, no name: a contact is the email address and that flag, the minimum the list needs.
//
// Separate from EmailSender (sender.ts), which is the transactional path and has no notion of a contact list.

export interface MarketingContact {
  email: string;
  unsubscribed: boolean;
}

export interface MarketingContactsClient {
  /** null when Resend has no contact for the address. */
  get(email: string): Promise<MarketingContact | null>;
  create(email: string, unsubscribed: boolean): Promise<void>;
  setUnsubscribed(email: string, unsubscribed: boolean): Promise<void>;
}

export class MarketingContactsError extends Error {
  constructor(readonly op: string, readonly status: number | null) {
    super(`resend_contacts_${op}_failed`);
  }
}

export function resendMarketingContacts(apiKey: string | undefined = process.env.RESEND_API_KEY): MarketingContactsClient {
  if (!apiKey) throw new MarketingContactsError('config', null);
  const resend = new Resend(apiKey);
  return {
    async get(email) {
      const { data, error } = await resend.contacts.get({ email });
      if (error) {
        if (error.statusCode === 404 || error.name === 'not_found') return null;
        throw new MarketingContactsError('get', error.statusCode);
      }
      return { email: data.email, unsubscribed: data.unsubscribed };
    },
    async create(email, unsubscribed) {
      const { error } = await resend.contacts.create({ email, unsubscribed });
      if (error) throw new MarketingContactsError('create', error.statusCode);
    },
    async setUnsubscribed(email, unsubscribed) {
      const { error } = await resend.contacts.update({ email, unsubscribed });
      if (error) throw new MarketingContactsError('update', error.statusCode);
    },
  };
}
