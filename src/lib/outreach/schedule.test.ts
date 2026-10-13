import { createHash } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import {
  detId,
  deferId,
  stepAuditId,
  planRev,
  canonicalJson,
  SEND_TIMING_ALGORITHM_VERSION,
  type Touchpoint,
} from '@/lib/outreach/schedule';
import { DEFAULT_SEND_POLICY, type SendPolicy } from '@/lib/outreach/send-policy';

describe('detId', () => {
  it('is a stable, valid UUID for the same inputs', () => {
    const a = detId('camp1', 'c1', 0, 'pr1');
    const b = detId('camp1', 'c1', 0, 'pr1');
    expect(a).toBe(b);
    expect(a).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
  });
  it('differs by campaign, contact, step, and planRev', () => {
    const base = detId('camp1', 'c1', 0, 'pr1');
    expect(detId('camp2', 'c1', 0, 'pr1')).not.toBe(base);
    expect(detId('camp1', 'c2', 0, 'pr1')).not.toBe(base);
    expect(detId('camp1', 'c1', 1, 'pr1')).not.toBe(base);
    expect(detId('camp1', 'c1', 0, 'pr2')).not.toBe(base);
  });
});

describe('deferId', () => {
  it('is stable + a valid UUID, and keyed additionally on targetSlotMs', () => {
    const a = deferId('camp1', 'c1', 0, 'pr1', 1_700_000_000_000);
    const b = deferId('camp1', 'c1', 0, 'pr1', 1_700_000_000_000);
    expect(a).toBe(b);
    expect(a).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
    // A different legal slot → a DIFFERENT successor id (two defers to distinct
    // slots do not collide); same slot → the same id (racing defers collapse).
    expect(deferId('camp1', 'c1', 0, 'pr1', 1_700_000_060_000)).not.toBe(a);
  });

  it('is a DIFFERENT identity than the plan detId for the same step (F.1 — two ids)', () => {
    // The resume path routes around a possibly-completed detId via deferId; even
    // with the same (campaign, contact, step, planRev) the ids must not collide.
    expect(deferId('camp1', 'c1', 0, 'pr1', 1_700_000_000_000)).not.toBe(
      detId('camp1', 'c1', 0, 'pr1'),
    );
  });
});

describe('stepAuditId', () => {
  it('is stable per (campaign, contact, step, planRev, reason) and differs by reason', () => {
    const a = stepAuditId('camp1', 'c1', 0, 'pr1', 'sent');
    expect(stepAuditId('camp1', 'c1', 0, 'pr1', 'sent')).toBe(a);
    expect(a).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
    // The audit id is the activity_log PK → a distinct reason is a distinct row.
    expect(stepAuditId('camp1', 'c1', 0, 'pr1', 'provider_failure')).not.toBe(a);
  });
});

describe('canonicalJson — recursive key sort (stable fingerprint material)', () => {
  it('serializes identical content IDENTICALLY regardless of key insertion order', () => {
    const a = canonicalJson({ b: 1, a: { y: 2, x: 3 } });
    const b = canonicalJson({ a: { x: 3, y: 2 }, b: 1 });
    expect(a).toBe(b);
  });
  it('PRESERVES array order (weekday[0..6] is positional, not sorted)', () => {
    expect(canonicalJson([3, 1, 2])).not.toBe(canonicalJson([1, 2, 3]));
  });
});

describe('planRev — the full correctness identity (§11.1)', () => {
  const TP: Touchpoint = { days_before: 7, channel: 'whatsapp', message_key: 'invite' };
  const EVENT_IL = '2026-07-20';

  it('is a full SHA-256 (64 hex) over version + eventDateIL + touchpoint + policy', () => {
    const pr = planRev({ eventDateIL: EVENT_IL, touchpoint: TP, policy: DEFAULT_SEND_POLICY });
    expect(pr).toMatch(/^[0-9a-f]{64}$/);
  });

  it('is EQUAL for the same content with different policy key insertion order', () => {
    // Reconstruct the policy with keys in a different order but identical values.
    const reordered = {
      location: DEFAULT_SEND_POLICY.location,
      spreadSpanMs: DEFAULT_SEND_POLICY.spreadSpanMs,
      defaultPreferred: DEFAULT_SEND_POLICY.defaultPreferred,
      preferredTimeByDaysBefore: DEFAULT_SEND_POLICY.preferredTimeByDaysBefore,
      motzashPlusMin: DEFAULT_SEND_POLICY.motzashPlusMin,
      hardCap: DEFAULT_SEND_POLICY.hardCap,
      weekday: DEFAULT_SEND_POLICY.weekday,
    } as SendPolicy;
    expect(planRev({ eventDateIL: EVENT_IL, touchpoint: TP, policy: reordered })).toBe(
      planRev({ eventDateIL: EVENT_IL, touchpoint: TP, policy: DEFAULT_SEND_POLICY }),
    );
  });

  it('CHANGES when a slot-affecting input changes (event date / touchpoint / policy)', () => {
    const base = planRev({ eventDateIL: EVENT_IL, touchpoint: TP, policy: DEFAULT_SEND_POLICY });
    expect(planRev({ eventDateIL: '2026-07-21', touchpoint: TP, policy: DEFAULT_SEND_POLICY })).not.toBe(base);
    expect(
      planRev({ eventDateIL: EVENT_IL, touchpoint: { ...TP, days_before: 3 }, policy: DEFAULT_SEND_POLICY }),
    ).not.toBe(base);
    const narrowed: SendPolicy = {
      ...DEFAULT_SEND_POLICY,
      weekday: DEFAULT_SEND_POLICY.weekday.map((w, i) =>
        i === 5 && w ? { start: w.start, end: '11:00' } : w,
      ),
    };
    expect(planRev({ eventDateIL: EVENT_IL, touchpoint: TP, policy: narrowed })).not.toBe(base);
  });

  it('FOLDS SEND_TIMING_ALGORITHM_VERSION — a version bump invalidates the fingerprint', () => {
    const pr = planRev({ eventDateIL: EVENT_IL, touchpoint: TP, policy: DEFAULT_SEND_POLICY });
    // Recompute the exact material the helper hashes, but with the NEXT version.
    // A different version ⇒ a different planRev ⇒ every queued job re-plans.
    const nextVersionMaterial = canonicalJson({
      v: SEND_TIMING_ALGORITHM_VERSION + 1,
      eventDateIL: EVENT_IL,
      touchpoint: { days_before: 7, channel: 'whatsapp', message_key: 'invite' },
      policy: DEFAULT_SEND_POLICY,
    });
    expect(createHash('sha256').update(nextVersionMaterial).digest('hex')).not.toBe(pr);
    // And the CURRENT version reproduces the helper's output byte-for-byte.
    const currentMaterial = canonicalJson({
      v: SEND_TIMING_ALGORITHM_VERSION,
      eventDateIL: EVENT_IL,
      touchpoint: { days_before: 7, channel: 'whatsapp', message_key: 'invite' },
      policy: DEFAULT_SEND_POLICY,
    });
    expect(createHash('sha256').update(currentMaterial).digest('hex')).toBe(pr);
  });
});
