import { describe, expect, it } from 'vitest';

import {
  classifyInboundChannel,
  importSender,
  waMeUrl,
} from './channel-routing';

const SPLIT = { phoneNumberId: 'rsvp-1', importPhoneNumberId: 'imp-1' };
const LEGACY = { phoneNumberId: 'rsvp-1', importPhoneNumberId: null };

// The QA sentinel used by the live-verification rows (§1.5.4): a phone_number_id
// that belongs to neither number.
const FOREIGN = '123456123';

describe('classifyInboundChannel — the role is UNASSIGNED (how this ships)', () => {
  // This is the guarantee, not an observation: `whatsapp_import_sender` is not
  // assigned on the live WABA, so every row must take exactly today's path.
  // If any of these ever flips, the phase stopped being inert.
  it('routes EVERY input to the RSVP path, including a null id and a foreign number', () => {
    expect(classifyInboundChannel('rsvp-1', LEGACY)).toBe('rsvp');
    expect(classifyInboundChannel('imp-1', LEGACY)).toBe('rsvp');
    expect(classifyInboundChannel(FOREIGN, LEGACY)).toBe('rsvp');
    expect(classifyInboundChannel(null, LEGACY)).toBe('rsvp');
    expect(classifyInboundChannel('', LEGACY)).toBe('rsvp');
  });

  it('no config at all (channel off) → RSVP path, never unknown', () => {
    expect(classifyInboundChannel('imp-1', null)).toBe('rsvp');
    expect(classifyInboundChannel(FOREIGN, null)).toBe('rsvp');
    expect(classifyInboundChannel(null, null)).toBe('rsvp');
  });
});

describe('classifyInboundChannel — the role is assigned', () => {
  it('routes the import number to the import path', () => {
    expect(classifyInboundChannel('imp-1', SPLIT)).toBe('import');
  });

  it('routes the RSVP number to the RSVP path', () => {
    expect(classifyInboundChannel('rsvp-1', SPLIT)).toBe('rsvp');
  });

  it('treats a NULL phone_number_id as the RSVP number (rows without metadata)', () => {
    expect(classifyInboundChannel(null, SPLIT)).toBe('rsvp');
  });

  it('flags a number that is neither as unknown — the only non-billing verdict', () => {
    expect(classifyInboundChannel(FOREIGN, SPLIT)).toBe('unknown');
  });
});

describe('importSender', () => {
  const base = { phoneNumberId: 'rsvp-1', accessToken: 'tok', appSecret: 'sec' };

  it('sends from the import number when configured, with the SAME token/secret', () => {
    expect(importSender({ ...base, importPhoneNumberId: 'imp-1' })).toEqual({
      phoneNumberId: 'imp-1',
      accessToken: 'tok',
      appSecret: 'sec',
    });
  });

  it('falls back to the RSVP number when the split is off (legacy replies unchanged)', () => {
    expect(importSender({ ...base, importPhoneNumberId: null })).toEqual(base);
  });
});

describe('waMeUrl', () => {
  it('builds the deep link from any Israeli spelling of the number', () => {
    // The stored form is provider_numbers.e164 (no spaces); the other two are
    // what an admin or a doc would write.
    expect(waMeUrl('+97233301505')).toBe('https://wa.me/97233301505');
    expect(waMeUrl('+972 3-330-1505')).toBe('https://wa.me/97233301505');
    expect(waMeUrl('03-330-1505')).toBe('https://wa.me/97233301505');
  });

  it('returns null for something that is not a dialable number (no broken link)', () => {
    expect(waMeUrl('')).toBeNull();
    expect(waMeUrl('abc')).toBeNull();
  });
});
