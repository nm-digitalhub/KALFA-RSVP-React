import 'server-only';

import { z } from 'zod';

import type { SlackAlertInput } from '@/lib/alerts/slack';
import { israelMidnightIso } from '@/lib/owner-agent/range';
import {
  OwnerAgentRunError,
  type OwnerAgentRunInput,
  type OwnerAgentRunResult,
} from '@/lib/owner-agent/runner';
import { OWNER_AGENT_PERMISSIONS, type OwnerAgentPermission } from '@/lib/owner-agent/tools/shared';
import type { DeliveryOutcome } from '@/lib/whatsapp/client';

import { OWNER_AGENT_RESUME_FAIL_FAST_MS, OWNER_AGENT_RUN_TIMEOUT_MS } from './budgets';
import {
  OWNER_AGENT_FAILURE_REPLY,
  OWNER_AGENT_SYSTEM_PROMPT,
  buildOwnerPrompt,
  splitForWhatsApp,
} from './reply-text';
import type { SessionMemory } from './sessions';
import type { AuditInput, IntakeRow, ReplyStore } from './store';

// One job of QUEUES.ownerAgentReply: answer ONE diverted, gate-passing staff
// question (plans/owner-whatsapp-agent-plan.md §3.1, §8 stage 6b).
//
//   load the intake row → claim it (queued|processing → processing)
//   → the §3.1 gate AGAIN, against current state → resolve permissions
//   → run the fleet-method runner (resuming a recent session)
//   → deliver(): the send-time gate → claim the send (processing → sending)
//     → the WhatsApp text(s), from the number the question arrived on
//     → answered | failed, and one audit row.
//
// ⚠️ SILENCE IS THE DEFAULT (decision 9.6). Every gate failure — at the start
// or at send time — ends with an audit row and NO message: no reply, no model
// run, no "you are not allowed". The one message a staff member can get that
// is not an answer is the fixed OWNER_AGENT_FAILURE_REPLY for a run that
// failed, and it goes through the same send-time gate as an answer.
//
// ⚠️ NEVER TWICE. A message is sent only after this delivery moved the row
// processing → sending (a CAS in store.ts). A delivery that finds the row in
// `sending` cannot know whether the earlier one got its message out, so it
// marks the row failed and sends nothing — at-most-once, like the outreach
// engine's reserve → send → resolve. Nothing after the CAS throws, so pg-boss
// never retries a job whose message may already be out.
//
// RETRIES. A database error BEFORE the send claim throws (OwnerAgentStoreError)
// and pg-boss re-delivers the job — the plan's rule: never proceed as if a
// gate had passed. A runner failure is not retried: the staff member gets the
// fixed reply and asks again (a retry would pay for the model twice and still
// answer late). A send outcome is never retried.
//
// PRIVACY. No question, answer, phone or error text is logged, alerted or
// audited — ids and codes only.

export const OWNER_AGENT_MODEL = 'sonnet';
export const OWNER_AGENT_MAX_TURNS = 6;

// Meta's customer-service window: a free-form reply is refused 24h after the
// staff member's message (131047, plan §2.4).
export const ANSWER_WINDOW_MS = 24 * 60 * 60 * 1000;

// A resumed session can fail because its file is gone (retention) or corrupt.
// These codes are what such a failure looks like; they are retried once as a
// fresh session, and only while the failure was fast (budgets.ts).
const RESUME_RETRY_CODES: ReadonlySet<string> = new Set(['cli_failed', 'unparsable_output']);

const jobSchema = z.object({ intakeId: z.string().min(1).max(64) });

export interface WhatsAppSender {
  phoneNumberId: string;
  accessToken: string;
  appSecret: string | null;
}

export interface ReplyDeps {
  store: ReplyStore;
  sessions: SessionMemory;
  run: (input: OwnerAgentRunInput) => Promise<OwnerAgentRunResult>;
  /** Send credentials for `phoneNumberId`, or null when WhatsApp is not configured. */
  sender: (phoneNumberId: string) => Promise<WhatsAppSender | null>;
  sendText: (sender: WhatsAppSender, params: { to: string; body: string }) => Promise<DeliveryOutcome>;
  alert: (input: SlackAlertInput) => Promise<unknown>;
  log: (line: string) => void;
  now: () => number;
}

export type ReplyOutcome =
  | 'answered'
  | 'fallback_sent'
  | 'gated'
  | 'send_gated'
  | 'send_failed'
  | 'send_unconfirmed'
  | 'expired'
  | 'not_found'
  | 'already_done'
  | 'lost_race'
  | 'invalid_job';

/** Thrown before any send; pg-boss retries the job. The message is a code. */
export class OwnerAgentReplyError extends Error {
  constructor(readonly code: string) {
    super(`owner_agent_reply_${code}`);
    this.name = 'OwnerAgentReplyError';
  }
}

type GateResult =
  | { ok: true; recipient: string; permissions: OwnerAgentPermission[] }
  | { ok: false; reason: string };

type RunResult =
  | { ok: true; result: OwnerAgentRunResult }
  | { ok: false; code: string };

export async function handleOwnerAgentReply(
  job: { data: unknown },
  deps: ReplyDeps,
): Promise<ReplyOutcome> {
  const parsedJob = jobSchema.safeParse(job.data);
  if (!parsedJob.success) {
    deps.log('[owner-agent] reply invalid_job');
    return 'invalid_job';
  }
  const intake = await deps.store.loadIntake(parsedJob.data.intakeId);
  if (!intake) {
    // Retention removed it, or the id was never ours. Nothing to answer.
    deps.log(`[owner-agent] reply intake=${parsedJob.data.intakeId} not_found`);
    return 'not_found';
  }
  const outcome = await handleIntake(intake, deps);
  deps.log(`[owner-agent] reply intake=${intake.id} ${outcome}`);
  return outcome;
}

async function handleIntake(intake: IntakeRow, deps: ReplyDeps): Promise<ReplyOutcome> {
  const { store } = deps;

  if (intake.status === 'sending') {
    // An earlier delivery claimed the send and died before recording the
    // result. Whether its message went out is unknown — so nothing is sent.
    if (await store.transition(intake.id, ['sending'], 'failed')) {
      await audit(deps, intake, { stage: 'send', outcome: 'send_failed', reasonCode: 'send_unconfirmed' });
    }
    return 'send_unconfirmed';
  }
  if (intake.status !== 'queued' && intake.status !== 'processing') return 'already_done';

  const nowMs = deps.now();
  if (nowMs - Date.parse(intake.receivedAt) >= ANSWER_WINDOW_MS) {
    if (await store.transition(intake.id, ['queued', 'processing'], 'expired')) {
      await audit(deps, intake, { stage: 'agent', outcome: 'expired', reasonCode: 'window_closed' });
    }
    return 'expired';
  }

  // 'processing' is claimable too: a delivery that died before the send claim
  // left it there, and redoing the run is safe — nothing was sent.
  if (!(await store.transition(intake.id, ['queued', 'processing'], 'processing'))) return 'lost_race';

  const gate = await agentGate(intake, deps, nowMs);
  if (!gate.ok) {
    if (await store.transition(intake.id, ['processing'], 'skipped')) {
      await audit(deps, intake, { stage: 'agent', outcome: 'gated', reasonCode: gate.reason });
    }
    return 'gated';
  }

  // Read BEFORE the model runs: a missing configuration must not cost a run.
  const sender = await deps.sender(intake.phoneNumberId);
  if (!sender) throw new OwnerAgentReplyError('whatsapp_not_configured');

  const started = deps.now();
  const run = await runAnswer(intake, gate.permissions, deps, started);
  if (!run.ok) {
    await audit(deps, intake, {
      stage: 'agent',
      outcome: 'run_failed',
      reasonCode: run.code,
      latencyMs: deps.now() - started,
    });
  }
  return deliver(intake, gate.recipient, sender, run, deps, started);
}

// §3.1 #2: the route's gate, re-run against the state NOW. The job may have
// waited; the switch may be off, the number moved, the row disabled, the staff
// member removed or out of today's cap. The recipient is the staff member's
// VERIFIED phone, and it must be an enabled allow-list row of theirs — the
// same identity the route's gate matched (the intake row stores no phone).
// Known edge: a staff member who re-verifies a different phone between the
// question and the answer gets the answer on the new phone, provided that phone
// is also an enabled row of theirs. The route's per-process rate limit is not
// repeated: it counts arrivals, and the daily cap is the durable bound.
async function agentGate(intake: IntakeRow, deps: ReplyDeps, nowMs: number): Promise<GateResult> {
  const { store } = deps;
  const settings = await store.readSettings();
  if (!settings) return { ok: false, reason: 'not_configured' };
  if (!settings.enabled) return { ok: false, reason: 'kill_switch_off' };
  if (settings.phoneNumberId !== intake.phoneNumberId) return { ok: false, reason: 'number_changed' };
  if (!(await store.isStaff(intake.staffUserId))) return { ok: false, reason: 'not_staff' };
  const recipient = await store.verifiedPhone(intake.staffUserId);
  if (!recipient) return { ok: false, reason: 'phone_unverified' };
  if (!(await store.isAllowlisted(intake.staffUserId, recipient))) return { ok: false, reason: 'not_allowlisted' };
  // Today's rows BEFORE this one, as at the route (which counted before it
  // inserted). A cap lowered since then applies now.
  const used = await store.countIntakeSince(intake.staffUserId, israelMidnightIso(nowMs), intake.id);
  if (used >= settings.dailyCap) return { ok: false, reason: 'daily_cap' };

  // One RPC per permission key, server-side, from the staff member's role —
  // never from the message.
  const granted = await Promise.all(
    OWNER_AGENT_PERMISSIONS.map(async (key) => ((await store.hasPermission(intake.staffUserId, key)) ? key : null)),
  );
  return {
    ok: true,
    recipient,
    permissions: granted.filter((key): key is OwnerAgentPermission => key !== null),
  };
}

async function runAnswer(
  intake: IntakeRow,
  permissions: OwnerAgentPermission[],
  deps: ReplyDeps,
  started: number,
): Promise<RunResult> {
  const staff = intake.staffUserId;
  const input: OwnerAgentRunInput = {
    prompt: buildOwnerPrompt(intake.messageText, started),
    systemPrompt: OWNER_AGENT_SYSTEM_PROMPT,
    permissions,
    model: OWNER_AGENT_MODEL,
    maxTurns: OWNER_AGENT_MAX_TURNS,
    timeoutMs: OWNER_AGENT_RUN_TIMEOUT_MS,
  };
  const resumeSessionId = await quietly(() => deps.sessions.resumable(staff, started, permissions));

  let result: OwnerAgentRunResult;
  try {
    result = await deps.run(resumeSessionId ? { ...input, resumeSessionId } : input);
  } catch (error) {
    const code = runErrorCode(error);
    const fast = deps.now() - started < OWNER_AGENT_RESUME_FAIL_FAST_MS;
    if (!resumeSessionId || !fast || !RESUME_RETRY_CODES.has(code)) return { ok: false, code };
    // The session could not be continued. Forget it and start fresh, once.
    await quietly(() => deps.sessions.forget(staff));
    try {
      result = await deps.run(input);
    } catch (retryError) {
      return { ok: false, code: runErrorCode(retryError) };
    }
  }
  if (result.text.trim().length === 0) return { ok: false, code: 'empty_answer' };
  await quietly(() => deps.sessions.remember(staff, result.sessionId, deps.now(), permissions));
  return { ok: true, result };
}

function runErrorCode(error: unknown): string {
  return error instanceof OwnerAgentRunError ? error.code : 'run_exception';
}

// The one way a message leaves this module. Answer or fallback alike: the
// send-time gate, the send claim, the text(s), the result.
async function deliver(
  intake: IntakeRow,
  recipient: string,
  sender: WhatsAppSender,
  run: RunResult,
  deps: ReplyDeps,
  started: number,
): Promise<ReplyOutcome> {
  const { store } = deps;

  // §3.1 #3, against the state NOW (the run took up to two minutes): the
  // switch still on, the number still the chosen one and still the one the
  // question arrived on, the recipient still an enabled row of this staff
  // member. A database error here still throws — nothing has been sent yet.
  const blocked = await sendGate(intake, recipient, deps);
  if (blocked) {
    if (await store.transition(intake.id, ['processing'], 'skipped')) {
      await audit(deps, intake, { stage: 'send', outcome: 'gated', reasonCode: blocked });
    }
    return 'send_gated';
  }
  if (!(await store.transition(intake.id, ['processing'], 'sending'))) return 'lost_race';

  // ── Past the send claim: nothing below may throw. ──────────────────────────
  const body = run.ok ? run.result.text : OWNER_AGENT_FAILURE_REPLY;
  const from: WhatsAppSender = { ...sender, phoneNumberId: intake.phoneNumberId };
  let failure: string | null = null;
  let sent = 0;
  for (const part of splitForWhatsApp(body)) {
    let outcome: DeliveryOutcome;
    try {
      outcome = await deps.sendText(from, { to: recipient, body: part });
    } catch {
      outcome = { kind: 'unknown', reason: 'send_threw' };
    }
    if (outcome.kind !== 'accepted') {
      failure = sendFailureCode(outcome, sent);
      break;
    }
    sent += 1;
  }

  const recorded = await quietly(() => store.transition(intake.id, ['sending'], failure ? 'failed' : 'answered'));
  if (recorded !== true) {
    // The row stays `sending`; no later delivery will send for it (see the
    // header). Visible here, and in the audit row below.
    deps.log(`[owner-agent] status_not_recorded intake=${intake.id}`);
  }
  const latencyMs = deps.now() - started;
  const answerFields = run.ok ? { toolNames: run.result.toolNames, steps: run.result.turns } : {};
  if (failure) {
    await audit(deps, intake, { stage: 'send', outcome: 'send_failed', reasonCode: failure, latencyMs, ...answerFields });
    return 'send_failed';
  }
  if (run.ok) {
    await audit(deps, intake, { stage: 'send', outcome: 'answered', reasonCode: null, latencyMs, ...answerFields });
    return 'answered';
  }
  await audit(deps, intake, { stage: 'send', outcome: 'fallback_sent', reasonCode: run.code, latencyMs });
  return 'fallback_sent';
}

async function sendGate(intake: IntakeRow, recipient: string, deps: ReplyDeps): Promise<string | null> {
  const settings = await deps.store.readSettings();
  if (!settings) return 'not_configured';
  if (!settings.enabled) return 'kill_switch_off';
  if (settings.phoneNumberId !== intake.phoneNumberId) return 'number_changed';
  if (!(await deps.store.isAllowlisted(intake.staffUserId, recipient))) return 'not_allowlisted';
  return null;
}

// Codes only (they fit the audit CHECK). 131047 is Meta's closed 24h window
// (plan §2.4); anything else definite is a rejection; the rest is unknown.
function sendFailureCode(outcome: Exclude<DeliveryOutcome, { kind: 'accepted' }>, sentBefore: number): string {
  if (sentBefore > 0) return 'partial_send';
  if (outcome.kind === 'definitely_not_sent') {
    return outcome.providerCode === '131047' ? 'window_closed' : 'provider_rejected';
  }
  return 'send_unknown';
}

async function audit(
  deps: ReplyDeps,
  intake: IntakeRow,
  row: Omit<AuditInput, 'staffUserId' | 'intakeId' | 'wamid'>,
): Promise<void> {
  const ok = await deps.store.writeAudit({
    ...row,
    staffUserId: intake.staffUserId,
    intakeId: intake.id,
    wamid: intake.wamid,
  });
  if (ok) return;
  deps.log(`[owner-agent] audit_failed intake=${intake.id} outcome=${row.outcome}`);
  await quietly(() =>
    deps.alert({
      level: 'error',
      category: 'errors',
      source: 'owner-agent',
      title: 'סוכן הבעלים — שורת audit לא נכתבה',
      detail: 'הטיפול בהודעה הסתיים, אבל שורת ה-audit שלו לא נשמרה.',
      fields: { intake: intake.id, outcome: row.outcome },
    }),
  );
}

// For the steps whose failure must not change what already happened (a
// message sent, a session remembered): the error is dropped, the flow goes on.
async function quietly<T>(fn: () => Promise<T>): Promise<T | undefined> {
  try {
    return await fn();
  } catch {
    return undefined;
  }
}
