import { describe, expect, it } from 'vitest';

import { normalizeAnalyticsPath, normalizeAnalyticsUrl } from './normalize-path';

const E = '659ae5e7-268b-4f04-abd8-fbb89fc3ebe4';
const C = 'bac77347-91f5-4f4e-9a20-1c7ffcb0f6ab';
const G = '12345678-90ab-4cde-8f01-234567890abc';

describe('normalizeAnalyticsPath — the full measured-route inventory', () => {
  // Every measured route with dynamic segments (plans/ga4-url-normalization.md).
  const cases: [string, string][] = [
    [`/app/events/${E}`, '/app/events/[event-id]'],
    [`/app/events/${E}/stats`, '/app/events/[event-id]/stats'],
    [`/app/events/${E}/guests`, '/app/events/[event-id]/guests'],
    [`/app/events/${E}/guests/${G}`, '/app/events/[event-id]/guests/[guest-id]'],
    [`/app/events/${E}/guests/new`, '/app/events/[event-id]/guests/new'],
    [`/app/events/${E}/guests/import`, '/app/events/[event-id]/guests/import'],
    [
      `/app/events/${E}/guests/import/whatsapp`,
      '/app/events/[event-id]/guests/import/whatsapp',
    ],
    [`/app/events/${E}/campaign/${C}`, '/app/events/[event-id]/campaign/[campaign-id]'],
    [
      `/app/events/${E}/campaign/${C}/approve`,
      '/app/events/[event-id]/campaign/[campaign-id]/approve',
    ],
    [
      `/app/events/${E}/campaign/${C}/payment`,
      '/app/events/[event-id]/campaign/[campaign-id]/payment',
    ],
    [
      `/app/events/${E}/campaign/${C}/agreement`,
      '/app/events/[event-id]/campaign/[campaign-id]/agreement',
    ],
  ];
  it.each(cases)('%s → %s', (input, expected) => {
    expect(normalizeAnalyticsPath(input)).toBe(expected);
  });

  it('UUID after an unknown segment falls back to the generic [id]', () => {
    expect(normalizeAnalyticsPath(`/app/whatever/${E}`)).toBe('/app/whatever/[id]');
  });

  it('paths without UUIDs pass through untouched (marketing site)', () => {
    for (const p of ['/', '/contact', '/privacy', '/app/events', '/app/settings']) {
      expect(normalizeAnalyticsPath(p)).toBe(p);
    }
  });

  it('uppercase UUIDs are normalized too', () => {
    expect(normalizeAnalyticsPath(`/app/events/${E.toUpperCase()}`)).toBe(
      '/app/events/[event-id]',
    );
  });
});

describe('normalizeAnalyticsUrl', () => {
  it('normalizes path, query values and hash of a full URL', () => {
    expect(
      normalizeAnalyticsUrl(`https://beta.kalfa.me/app/events/${E}/stats?from=${C}#${G}`),
    ).toBe(
      'https://beta.kalfa.me/app/events/[event-id]/stats?from=[id]#[id]',
    );
  });

  it('leaves clean URLs untouched', () => {
    expect(normalizeAnalyticsUrl('https://beta.kalfa.me/contact?x=1')).toBe(
      'https://beta.kalfa.me/contact?x=1',
    );
  });

  it('empty/unparseable input never throws and still scrubs UUIDs', () => {
    expect(normalizeAnalyticsUrl('')).toBe('');
    expect(normalizeAnalyticsUrl(`not a url ${E}`)).toBe('not a url [id]');
  });

  it('external referrers pass through unchanged', () => {
    expect(normalizeAnalyticsUrl('https://www.google.com/')).toBe('https://www.google.com/');
  });
});
