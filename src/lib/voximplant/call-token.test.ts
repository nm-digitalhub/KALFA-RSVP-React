import { describe, expect, it } from 'vitest';

import { signCallToken, verifyCallToken } from './call-token';

const SECRET = 'test-callback-secret-abc123';
const AID = '11111111-1111-4111-8111-111111111111';
const NOW = 1_800_000_000;

describe('call-token sign/verify', () => {
  it('round-trips a valid token', () => {
    const t = signCallToken(SECRET, { callAttemptId: AID, purpose: 'ctx', expiresAtSec: NOW + 60 });
    const r = verifyCallToken(SECRET, t, 'ctx', NOW);
    expect(r).toEqual({ ok: true, callAttemptId: AID, expiresAtSec: NOW + 60 });
  });

  it('rejects a missing/empty token', () => {
    expect(verifyCallToken(SECRET, undefined, 'ctx', NOW)).toMatchObject({ ok: false, reason: 'malformed' });
    expect(verifyCallToken(SECRET, '', 'ctx', NOW)).toMatchObject({ ok: false });
  });

  it('rejects when no secret is configured (fail-closed)', () => {
    const t = signCallToken(SECRET, { callAttemptId: AID, purpose: 'ctx', expiresAtSec: NOW + 60 });
    expect(verifyCallToken(null, t, 'ctx', NOW)).toEqual({ ok: false, reason: 'no_secret' });
  });

  it('rejects a bad signature (wrong secret / tampered payload)', () => {
    const t = signCallToken(SECRET, { callAttemptId: AID, purpose: 'ctx', expiresAtSec: NOW + 60 });
    expect(verifyCallToken('other-secret', t, 'ctx', NOW)).toEqual({ ok: false, reason: 'bad_signature' });
    const [payload, sig] = t.split('.');
    const tamperedPayload = Buffer.from(JSON.stringify({ aid: 'evil', p: 'ctx', exp: NOW + 60 })).toString('base64url');
    expect(verifyCallToken(SECRET, `${tamperedPayload}.${sig}`, 'ctx', NOW)).toEqual({ ok: false, reason: 'bad_signature' });
    expect(payload).toBeTruthy();
  });

  it('rejects an expired token', () => {
    const t = signCallToken(SECRET, { callAttemptId: AID, purpose: 'ctx', expiresAtSec: NOW - 1 });
    expect(verifyCallToken(SECRET, t, 'ctx', NOW)).toEqual({ ok: false, reason: 'expired' });
  });

  it('rejects a token minted for a DIFFERENT purpose (ctx token used at cb, and vice-versa)', () => {
    const ctxTok = signCallToken(SECRET, { callAttemptId: AID, purpose: 'ctx', expiresAtSec: NOW + 60 });
    const cbTok = signCallToken(SECRET, { callAttemptId: AID, purpose: 'cb', expiresAtSec: NOW + 60 });
    expect(verifyCallToken(SECRET, ctxTok, 'cb', NOW)).toEqual({ ok: false, reason: 'wrong_purpose' });
    expect(verifyCallToken(SECRET, cbTok, 'ctx', NOW)).toEqual({ ok: false, reason: 'wrong_purpose' });
  });

  it('rejects a malformed token (no dot / garbage payload)', () => {
    expect(verifyCallToken(SECRET, 'no-dot-here', 'ctx', NOW)).toMatchObject({ ok: false });
    const goodSig = signCallToken(SECRET, { callAttemptId: AID, purpose: 'ctx', expiresAtSec: NOW + 60 }).split('.')[1];
    // valid signature over a non-JSON payload would fail the JSON parse — but the
    // signature won't match a garbage payload anyway, so this stays a rejection.
    expect(verifyCallToken(SECRET, `%%%.${goodSig}`, 'ctx', NOW)).toMatchObject({ ok: false });
  });
});
