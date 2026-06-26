import { describe, expect, it, vi } from 'vitest';

// contacts.ts begins with `import 'server-only'` (and pulls in server-only deps);
// that throws outside Next's RSC context. deriveContacts itself is pure.
vi.mock('server-only', () => ({}));

import { deriveContacts } from '@/lib/data/contacts';

describe('deriveContacts', () => {
  it('de-duplicates guests sharing one phone into a single contact (§13)', () => {
    const r = deriveContacts([
      { id: 'g1', phone: '050-123-4567' },
      { id: 'g2', phone: '+972 50 123 4567' }, // same number, different format
    ]);
    expect(r.uniquePhones).toEqual(['+972501234567']);
    expect(r.guestToPhone.get('g1')).toBe('+972501234567');
    expect(r.guestToPhone.get('g2')).toBe('+972501234567');
    expect(r.withValidPhone).toBe(2);
    expect(r.invalid).toBe(0);
  });

  it('excludes invalid / missing phones (not billable, not a contact)', () => {
    const r = deriveContacts([
      { id: 'g1', phone: '0501234567' },
      { id: 'g2', phone: '123' }, // invalid
      { id: 'g3', phone: null }, // missing
    ]);
    expect(r.uniquePhones).toEqual(['+972501234567']);
    expect(r.guestToPhone.get('g2')).toBeNull();
    expect(r.guestToPhone.get('g3')).toBeNull();
    expect(r.withValidPhone).toBe(1);
    expect(r.invalid).toBe(2);
  });

  it('counts distinct valid numbers', () => {
    const r = deriveContacts([
      { id: 'g1', phone: '0501111111' },
      { id: 'g2', phone: '0502222222' },
      { id: 'g3', phone: '0501111111' },
    ]);
    expect(r.uniquePhones.length).toBe(2);
    expect(r.withValidPhone).toBe(3);
  });

  it('handles an empty guest list', () => {
    const r = deriveContacts([]);
    expect(r.uniquePhones).toEqual([]);
    expect(r.withValidPhone).toBe(0);
    expect(r.invalid).toBe(0);
  });
});
