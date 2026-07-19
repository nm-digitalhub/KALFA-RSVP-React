import { beforeEach, describe, expect, it, vi } from 'vitest';

// call-result-processing.ts begins with `import 'server-only'` (throws outside a
// server context); stub it, and mock the DB-touching modules so the pure control
// flow can be exercised without a database. Convention matches url.test.ts.
vi.mock('server-only', () => ({}));

vi.mock('@/lib/data/call-attempts', () => ({
  getCallAttemptById: vi.fn(),
  getContactNormalizedPhone: vi.fn(),
  getGuestRsvpToken: vi.fn(),
  recordCallOutcome: vi.fn(),
  recordRsvpFromCall: vi.fn(),
  recordRsvpCallRejected: vi.fn(),
}));
// createAdminClient is used by the DNC upsert + owner-note insert. A minimal
// chainable stub: from(table).upsert/insert resolve {error:null} by default.
const adminUpsert = vi.fn(async (..._args: unknown[]) => ({ error: null as { message: string } | null }));
const adminInsert = vi.fn(async (..._args: unknown[]) => ({ error: null as { message: string } | null }));
vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({
    from: (table: string) => ({
      upsert: (...args: unknown[]) => adminUpsert(table, ...args),
      insert: (...args: unknown[]) => adminInsert(table, ...args),
    }),
  }),
}));
vi.mock('@/lib/data/interactions', () => ({
  insertInteraction: vi.fn(),
  setContactOpStatus: vi.fn(),
}));
vi.mock('@/lib/data/outreach-engine', () => ({ writeReach: vi.fn() }));
vi.mock('@/lib/data/rsvp', () => ({ submitRsvp: vi.fn() }));

import {
  processCallDnc,
  processCallResult,
  processCallRsvp,
  processCallRsvpRow,
  processOwnerNote,
} from './call-result-processing';
import {
  getCallAttemptById,
  getContactNormalizedPhone,
  getGuestRsvpToken,
  recordCallOutcome,
  recordRsvpFromCall,
  recordRsvpCallRejected,
} from '@/lib/data/call-attempts';
import { insertInteraction, setContactOpStatus } from '@/lib/data/interactions';
import { writeReach } from '@/lib/data/outreach-engine';
import { submitRsvp } from '@/lib/data/rsvp';

const AID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const ATTEMPT = {
  id: AID,
  event_id: 'ev1',
  campaign_id: 'cmp1',
  contact_id: 'ct1',
  guest_id: 'g1',
  status: 'in_progress',
};

// Minimal webhook_inbox row shape processCallResult reads (message_id + payload).
function row(payload: unknown, messageId: string | null = AID) {
  return { message_id: messageId, payload } as unknown as Parameters<
    typeof processCallResult
  >[0];
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getCallAttemptById).mockResolvedValue({ ...ATTEMPT } as never);
  vi.mocked(getContactNormalizedPhone).mockResolvedValue('+972501234567');
  vi.mocked(recordCallOutcome).mockResolvedValue({ applied: true });
  vi.mocked(insertInteraction).mockResolvedValue(true);
  vi.mocked(getGuestRsvpToken).mockResolvedValue('tok');
  vi.mocked(submitRsvp).mockResolvedValue({ ok: true, status: 'attending', unchanged: false } as never);
});

describe('processCallResult', () => {
  it('completed digit 1 → outcome + bill (writeReach) + RSVP attending', async () => {
    await processCallResult(row({ call_status: 'completed', rsvp_digit: '1', rsvp_method: 'dtmf', call_duration: 30 }));
    expect(recordCallOutcome).toHaveBeenCalledWith(AID, expect.objectContaining({ status: 'completed' }));
    expect(insertInteraction).toHaveBeenCalledWith(
      expect.objectContaining({ channel: 'call', provider_id: AID, kind: 'call_completed', billable: true }),
    );
    expect(writeReach).toHaveBeenCalledWith(
      expect.objectContaining({ channel: 'call', attemptId: AID, evidence: 'voximplant_call_completed' }),
    );
    expect(submitRsvp).toHaveBeenCalledWith('tok', expect.objectContaining({ status: 'attending', adults: 1, kids: 0 }));
    expect(recordRsvpFromCall).toHaveBeenCalledWith('ev1', 'g1', 'attending', AID);
  });

  it('completed digit 2 → RSVP declined (adults 0)', async () => {
    vi.mocked(submitRsvp).mockResolvedValue({ ok: true, status: 'declined', unchanged: false } as never);
    await processCallResult(row({ call_status: 'completed', rsvp_digit: '2' }));
    expect(submitRsvp).toHaveBeenCalledWith('tok', expect.objectContaining({ status: 'declined', adults: 0 }));
  });

  it('partial failure (writeReach throws) then retry re-runs billing + RSVP — NO action lost', async () => {
    vi.mocked(writeReach).mockRejectedValueOnce(new Error('transient db'));
    // Attempt 1: throws AFTER recordCallOutcome + insertInteraction but BEFORE RSVP
    // → propagates so the webhook row is marked failed (not processed) and retried.
    await expect(processCallResult(row({ call_status: 'completed', rsvp_digit: '1' }))).rejects.toThrow();
    expect(submitRsvp).not.toHaveBeenCalled(); // RSVP not reached on the failed attempt
    // Attempt 2 (the webhook retry): re-runs — billing + RSVP now complete. Nothing
    // is skipped by the already-inserted interaction row (no `fresh` gate).
    await processCallResult(row({ call_status: 'completed', rsvp_digit: '1' }));
    expect(writeReach).toHaveBeenCalledTimes(2); // re-run; idempotent in prod (billed_results)
    expect(submitRsvp).toHaveBeenCalledTimes(1);
    expect(recordRsvpFromCall).toHaveBeenCalledTimes(1);
  });

  it('ungated: a non-fresh interaction insert must NOT suppress billing/RSVP on re-processing', async () => {
    vi.mocked(insertInteraction).mockResolvedValue(false);
    await processCallResult(row({ call_status: 'completed', rsvp_digit: '1' }));
    expect(writeReach).toHaveBeenCalled();
    expect(submitRsvp).toHaveBeenCalled();
  });

  it('retry that re-confirms an UNCHANGED rsvp does not append a duplicate marker', async () => {
    vi.mocked(submitRsvp).mockResolvedValue({ ok: true, status: 'attending', unchanged: true } as never);
    await processCallResult(row({ call_status: 'completed', rsvp_digit: '1' }));
    expect(submitRsvp).toHaveBeenCalled();
    expect(recordRsvpFromCall).not.toHaveBeenCalled();
  });

  it('completed with no bound guest → bills but does NOT submit an RSVP', async () => {
    vi.mocked(getCallAttemptById).mockResolvedValue({ ...ATTEMPT, guest_id: null } as never);
    await processCallResult(row({ call_status: 'completed', rsvp_digit: '1' }));
    expect(writeReach).toHaveBeenCalled();
    expect(submitRsvp).not.toHaveBeenCalled();
  });

  it('invitation_id mismatch still processes but flags evidence (never used as identity)', async () => {
    await processCallResult(row({ call_status: 'completed', rsvp_digit: '1', invitation_id: 'someone-else' }));
    expect(writeReach).toHaveBeenCalledWith(
      expect.objectContaining({ evidence: 'voximplant_call_completed_iid_mismatch', attemptId: AID }),
    );
  });

  it('recording_started → in_progress + human_interaction_call; no bill/RSVP', async () => {
    await processCallResult(row({ call_status: 'recording_started', recording_url: 'https://storage-gw-us-01.voximplant.com/x.mp3' }));
    expect(recordCallOutcome).toHaveBeenCalledWith(AID, expect.objectContaining({ status: 'in_progress' }));
    expect(setContactOpStatus).toHaveBeenCalledWith('ct1', 'human_interaction_call');
    expect(insertInteraction).not.toHaveBeenCalled();
    expect(submitRsvp).not.toHaveBeenCalled();
  });

  it('out-of-order recording_started after terminal (applied:false) does NOT downgrade op_status', async () => {
    vi.mocked(recordCallOutcome).mockResolvedValue({ applied: false });
    await processCallResult(row({ call_status: 'recording_started' }));
    expect(setContactOpStatus).not.toHaveBeenCalled();
  });

  it('no_answer → status + op no_answer; no bill', async () => {
    await processCallResult(row({ call_status: 'no_answer' }));
    expect(recordCallOutcome).toHaveBeenCalledWith(AID, expect.objectContaining({ status: 'no_answer' }));
    expect(setContactOpStatus).toHaveBeenCalledWith('ct1', 'no_answer');
    expect(writeReach).not.toHaveBeenCalled();
  });

  it('stale/out-of-order TERMINAL rejected by the CAS (applied:false) is a FULL no-op — op NOT flipped', async () => {
    vi.mocked(recordCallOutcome).mockResolvedValue({ applied: false });
    await processCallResult(row({ call_status: 'no_answer' }));
    expect(setContactOpStatus).not.toHaveBeenCalled(); // not just a status no-op — op untouched too
    expect(writeReach).not.toHaveBeenCalled();
    expect(submitRsvp).not.toHaveBeenCalled();
  });

  it('drops a recording_url from an unverified host (stores null)', async () => {
    await processCallResult(row({ call_status: 'completed', rsvp_digit: '1', recording_url: 'https://evil.example.com/x.mp3' }));
    expect(recordCallOutcome).toHaveBeenCalledWith(AID, expect.objectContaining({ recording_url: null }));
  });

  it('unknown attempt id → no-op (nothing written)', async () => {
    vi.mocked(getCallAttemptById).mockResolvedValue(null);
    await processCallResult(row({ call_status: 'completed', rsvp_digit: '1' }));
    expect(recordCallOutcome).not.toHaveBeenCalled();
    expect(insertInteraction).not.toHaveBeenCalled();
  });

  it('bad stored payload (fails strict schema) → no-op', async () => {
    await processCallResult(row({ call_status: 'bogus_status' }));
    expect(getCallAttemptById).not.toHaveBeenCalled();
  });
});

describe('processCallRsvp (Tier 2 save_rsvp)', () => {
  it('attending → submitRsvp with REAL adult/child counts (kids ← children) + source marker; ok:true', async () => {
    const r = await processCallRsvp(AID, { attending: true, adults: 2, children: 3 });
    expect(submitRsvp).toHaveBeenCalledWith('tok', { status: 'attending', adults: 2, kids: 3 });
    expect(recordRsvpFromCall).toHaveBeenCalledWith('ev1', 'g1', 'attending', AID);
    expect(r).toEqual({ status: 'saved' });
  });

  it('declined → submitRsvp status declined with adults/kids zeroed', async () => {
    vi.mocked(submitRsvp).mockResolvedValue({ ok: true, status: 'declined', unchanged: false } as never);
    await processCallRsvp(AID, { attending: false, adults: 4, children: 2 });
    expect(submitRsvp).toHaveBeenCalledWith('tok', { status: 'declined', adults: 0, kids: 0 });
  });

  it('does NOT bill (writeReach/insertInteraction untouched — billing stays on the completed path)', async () => {
    await processCallRsvp(AID, { attending: true, adults: 1, children: 0 });
    expect(writeReach).not.toHaveBeenCalled();
    expect(insertInteraction).not.toHaveBeenCalled();
  });

  it('re-confirm of the same answer (unchanged) → no duplicate source marker', async () => {
    vi.mocked(submitRsvp).mockResolvedValue({ ok: true, status: 'attending', unchanged: true } as never);
    await processCallRsvp(AID, { attending: true, adults: 1, children: 0 });
    expect(recordRsvpFromCall).not.toHaveBeenCalled();
  });

  it('attempt not bound to exactly one guest (guest_id null) → ok:false, no RSVP write', async () => {
    vi.mocked(getCallAttemptById).mockResolvedValue({ ...ATTEMPT, guest_id: null } as never);
    const r = await processCallRsvp(AID, { attending: true, adults: 1, children: 0 });
    expect(r).toEqual({ status: 'rejected', reason: 'not_found' });
    expect(submitRsvp).not.toHaveBeenCalled();
  });

  it('submitRsvp rejects (closed/revoked token) → ok:false, no source marker', async () => {
    vi.mocked(submitRsvp).mockResolvedValue({ ok: false, reason: 'closed' } as never);
    const r = await processCallRsvp(AID, { attending: true, adults: 1, children: 0 });
    // The RPC's refusal reason must survive to the caller — dropping it is what
    // let a permanently-rejected RSVP be reported to the guest as "queued".
    expect(r).toEqual({ status: 'rejected', reason: 'closed' });
    // The refusal must reach the owner-visible activity feed. Previously it was
    // discarded, the queue row was marked processed, and the guest was told "נרשם".
    expect(recordRsvpCallRejected).toHaveBeenCalledWith(
      'ev1',
      'g1',
      'attending',
      'closed',
      AID,
    );
    expect(recordRsvpFromCall).not.toHaveBeenCalled();
    expect(recordRsvpFromCall).not.toHaveBeenCalled();
  });

  it('processCallRsvpRow: parses the stored payload and delegates by message_id', async () => {
    await processCallRsvpRow(row({ attending: true, adults: 2, children: 0 }));
    expect(submitRsvp).toHaveBeenCalledWith('tok', { status: 'attending', adults: 2, kids: 0 });
  });

  it('processCallRsvpRow: bad stored payload → no-op', async () => {
    await processCallRsvpRow(row({ attending: 'yes' }));
    expect(getCallAttemptById).not.toHaveBeenCalled();
  });

  it('canonical status maybe → submitRsvp maybe with zeroed counts', async () => {
    vi.mocked(submitRsvp).mockResolvedValue({ ok: true, status: 'maybe', unchanged: false } as never);
    const r = await processCallRsvp(AID, { status: 'maybe', adults: 2, children: 1 });
    expect(submitRsvp).toHaveBeenCalledWith('tok', { status: 'maybe', adults: 0, kids: 0 });
    expect(recordRsvpFromCall).toHaveBeenCalledWith('ev1', 'g1', 'maybe', AID);
    expect(r).toEqual({ status: 'saved' });
  });

  it('canonical status attending → counts pass through', async () => {
    await processCallRsvp(AID, { status: 'attending', adults: 3, children: 2 });
    expect(submitRsvp).toHaveBeenCalledWith('tok', { status: 'attending', adults: 3, kids: 2 });
  });
});

describe('processCallDnc (mark_dnc tool)', () => {
  it('resolves attempt → contact phone and upserts call_dnc_list with the canonical key', async () => {
    const r = await processCallDnc(AID);
    expect(getContactNormalizedPhone).toHaveBeenCalledWith('ct1');
    expect(adminUpsert).toHaveBeenCalledWith(
      'call_dnc_list',
      { normalized_phone: '+972501234567', reason: 'בקשת אורח בשיחה קולית' },
      { onConflict: 'normalized_phone' },
    );
    expect(r).toEqual({ ok: true });
  });
  it('unknown attempt → ok:false, nothing written', async () => {
    vi.mocked(getCallAttemptById).mockResolvedValue(null);
    expect(await processCallDnc(AID)).toEqual({ ok: false });
    expect(adminUpsert).not.toHaveBeenCalled();
  });
  it('contact without a normalizable phone → ok:false', async () => {
    vi.mocked(getContactNormalizedPhone).mockResolvedValue(null);
    expect(await processCallDnc(AID)).toEqual({ ok: false });
    expect(adminUpsert).not.toHaveBeenCalled();
  });
  it('DB error → ok:false (agent must not confirm removal)', async () => {
    adminUpsert.mockResolvedValueOnce({ error: { message: 'x' } } as never);
    expect(await processCallDnc(AID)).toEqual({ ok: false });
  });
});

describe('processOwnerNote (notify_owner tool)', () => {
  it('writes an activity_log row with kind+text, no phone/transcript', async () => {
    const r = await processOwnerNote(AID, { kind: 'question', text: 'יש חניה?' });
    expect(adminInsert).toHaveBeenCalledWith(
      'activity_log',
      expect.objectContaining({
        event_id: 'ev1',
        user_id: null,
        action: 'call.owner_note',
        meta: expect.objectContaining({ kind: 'question', text: 'יש חניה?', call_attempt_id: AID }),
      }),
    );
    expect(r).toEqual({ ok: true });
  });
  it('unknown attempt → ok:false', async () => {
    vi.mocked(getCallAttemptById).mockResolvedValue(null);
    expect(await processOwnerNote(AID, { kind: 'flag', text: 'x' })).toEqual({ ok: false });
    expect(adminInsert).not.toHaveBeenCalled();
  });
  it('insert error → ok:false (agent softens "אעביר")', async () => {
    adminInsert.mockResolvedValueOnce({ error: { message: 'x' } } as never);
    expect(await processOwnerNote(AID, { kind: 'message', text: 'x' })).toEqual({ ok: false });
  });
});
