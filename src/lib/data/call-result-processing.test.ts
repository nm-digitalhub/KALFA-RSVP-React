import { beforeEach, describe, expect, it, vi } from 'vitest';

// call-result-processing.ts begins with `import 'server-only'` (throws outside a
// server context); stub it, and mock the DB-touching modules so the pure control
// flow can be exercised without a database. Convention matches url.test.ts.
vi.mock('server-only', () => ({}));

vi.mock('@/lib/data/call-attempts', () => ({
  getCallAttemptById: vi.fn(),
  getGuestRsvpToken: vi.fn(),
  recordCallOutcome: vi.fn(),
  recordRsvpFromCall: vi.fn(),
}));
vi.mock('@/lib/data/interactions', () => ({
  insertInteraction: vi.fn(),
  setContactOpStatus: vi.fn(),
}));
vi.mock('@/lib/data/outreach-engine', () => ({ writeReach: vi.fn() }));
vi.mock('@/lib/data/rsvp', () => ({ submitRsvp: vi.fn() }));

import { processCallResult } from './call-result-processing';
import {
  getCallAttemptById,
  getGuestRsvpToken,
  recordCallOutcome,
  recordRsvpFromCall,
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
