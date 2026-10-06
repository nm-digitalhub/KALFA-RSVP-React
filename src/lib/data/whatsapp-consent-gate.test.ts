import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { terminalReasonFor } from '@/lib/data/outreach-engine';

// The WhatsApp consent gate (app_settings.whatsapp_consent_required, the twin of
// call_consent_required). These pin the two properties that matter legally:
//
//   1. The DEFAULT is "required". An omitted argument, a read error, or a row
//      that predates the column must never be the thing that lifts a consent
//      requirement — the whole point of the switch is that lifting it is an
//      explicit, audited decision.
//   2. Lifting consent lifts ONLY consent. removal_requested (opt-out) is a
//      different promise to a different person and is never negotiable.

describe('terminalReasonFor — WhatsApp consent gate', () => {
  const noConsent = { removal_requested: false, whatsapp_consent_at: null };
  const withConsent = {
    removal_requested: false,
    whatsapp_consent_at: '2026-07-07T11:19:15.782178+00:00',
  };

  it('defaults to REQUIRED when the flag argument is omitted', () => {
    // Fail-safe by construction: every pre-existing caller keeps the old
    // behaviour, and a new caller that forgets the argument gets the safe one.
    expect(terminalReasonFor(noConsent, 'whatsapp')).toBe('no_whatsapp_consent');
  });

  it('terminates a WhatsApp step without consent while the gate is armed', () => {
    expect(terminalReasonFor(noConsent, 'whatsapp', true)).toBe('no_whatsapp_consent');
  });

  it('allows a WhatsApp step without consent once an admin lifts the gate', () => {
    expect(terminalReasonFor(noConsent, 'whatsapp', false)).toBeNull();
  });

  it('is a no-op for a contact who DID consent, either way', () => {
    expect(terminalReasonFor(withConsent, 'whatsapp', true)).toBeNull();
    expect(terminalReasonFor(withConsent, 'whatsapp', false)).toBeNull();
  });

  it('never lets a lifted gate override an opt-out', () => {
    // The switch is about people who never answered, not people who said no.
    const optedOut = { removal_requested: true, whatsapp_consent_at: null };
    expect(terminalReasonFor(optedOut, 'whatsapp', false)).toBe('removal_requested');
    expect(terminalReasonFor(optedOut, 'whatsapp', true)).toBe('removal_requested');
    const optedOutWithConsent = {
      removal_requested: true,
      whatsapp_consent_at: '2026-07-07T11:19:15.782178+00:00',
    };
    expect(terminalReasonFor(optedOutWithConsent, 'whatsapp', false)).toBe(
      'removal_requested',
    );
  });

  it('does not touch the call channel — that gate is call_consent_required', () => {
    expect(terminalReasonFor(noConsent, 'call', true)).toBeNull();
    expect(terminalReasonFor(noConsent, 'call', false)).toBeNull();
  });
});
