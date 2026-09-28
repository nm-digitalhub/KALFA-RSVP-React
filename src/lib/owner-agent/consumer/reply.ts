import 'server-only';

import { z } from 'zod';

import type { SlackAlertInput } from '@/lib/alerts/slack';
import { israelMidnightIso } from '@/lib/owner-agent/range';
import {
  MAX_TEXT_ATTACHMENT_CHARS,
  OwnerAgentRunError,
  type OwnerAgentAttachment,
  type OwnerAgentRunInput,
  type OwnerAgentRunResult,
} from '@/lib/owner-agent/runner';
import { OWNER_AGENT_PERMISSIONS, type OwnerAgentPermission } from '@/lib/owner-agent/tools/shared';
import { decodeFollowupId, encodeFollowupId } from '@/lib/owner-agent/whatsapp/send';
import type { DeliveryOutcome } from '@/lib/whatsapp/client';

import {
  OWNER_AGENT_INTERACTIVE_SEND_MS,
  OWNER_AGENT_MAX_MEDIA_PER_TURN,
  OWNER_AGENT_MAX_TURNS,
  OWNER_AGENT_MEDIA_BUDGET_MS,
  OWNER_AGENT_MEDIA_LOOKUP_TIMEOUT_MS,
  OWNER_AGENT_MODEL,
  OWNER_AGENT_RESUME_FAIL_FAST_MS,
  OWNER_AGENT_RUN_TIMEOUT_MS,
  OWNER_AGENT_SEND_RETRY_MS,
  OWNER_AGENT_TYPING_TIMEOUT_MS,
} from './budgets';
import {
  OWNER_AGENT_FAILURE_REPLY,
  OWNER_AGENT_MEDIA_REJECTED_REPLY,
  OWNER_AGENT_UNSUPPORTED_VOICE_REPLY,
  answerBody,
  OWNER_AGENT_SYSTEM_PROMPT,
  buildFollowupMessage,
  buildTurnPrompt,
  splitForWhatsApp,
  type TurnPart,
} from './reply-text';
import type { SessionMemory } from './sessions';
import type { AuditInput, IntakeRow, ReplyStore } from './store';

// One job of QUEUES.ownerAgentReply: answer ONE diverted, gate-passing staff
// turn (plans/owner-whatsapp-agent-plan.md §3.1, §8 stage 6b;
// plans/owner-agent-chat-sdk-capabilities-plan.md §4.1–4.6).
//
//   load the intake row → (burst) defer if a newer queued row exists
//   → claim it (queued|processing → processing) → (burst) fold the older
//     queued rows into it → the §3.1 gate AGAIN, against current state
//   → build the turn: text, location, a follow-up tap resolved against OUR
//     row, a voice note, an image/document (still no Graph call)
//   → "read" + "typing…" → download the turn's media → run the fleet-method
//     runner (resuming a recent session) → stop "typing"
//   → deliver(): the send-time gate → claim the send (processing → sending)
//     → the WhatsApp text(s), from the number the question arrived on
//     → the follow-up buttons/list → answered | failed, and one audit row.
//
// ⚠️ SILENCE IS THE DEFAULT (decision 9.6). Every gate failure — at the start
// or at send time — ends with an audit row and NO message: no reply, no model
// run, no "you are not allowed", and NO Graph call of any kind (no "read", no
// "typing", no media download): the turn is built from the database alone,
// and only a turn that will be answered reaches the first Graph call. The
// messages a staff member can get that are not an answer are fixed texts —
// OWNER_AGENT_FAILURE_REPLY for a run that failed, the voice-note reply, the
// unreadable-file reply — and each goes through the same send-time gate.
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
// BURSTS (§4.6, app_settings.owner_agent_burst_ms > 0). A queued row with a
// NEWER queued row of the same allow-list row is left queued ('deferred'):
// the newest one leads. The leader, right after its own claim, folds every
// older queued row of that allow-list row into itself in ONE statement
// (status 'coalesced', coalesced_into = leader; the status filter is the CAS,
// so a row another job claimed is never taken) and audits each follower.
// The turn is then rebuilt from coalesced_into, never from what this job
// happened to fold, so a retry sees exactly the same turn. A follower's own
// job finds it 'coalesced' and does nothing. With burst_ms 0 nothing is
// deferred or folded — the behaviour before the setting.
//
// PRIVACY. No question, answer, phone, file name, media id or error text is
// logged, alerted or audited — ids and codes only. Downloaded bytes live in
// memory for the one run (runner deviation 12): no temp file, no database
// column, no Storage object, and the run keeps no session file.

// Meta's customer-service window: a free-form reply is refused 24h after the
// staff member's message (131047, plan §2.4).
export const ANSWER_WINDOW_MS = 24 * 60 * 60 * 1000;

// A follow-up tap is honoured for this long after the answer that offered it
// (§4.4), counted from that row's processed_at.
export const FOLLOWUP_TTL_MS = 24 * 60 * 60 * 1000;

// A resumed session can fail because its file is gone (retention) or corrupt.
// These codes are what such a failure looks like; they are retried once as a
// fresh session, and only while the failure was fast (budgets.ts).
const RESUME_RETRY_CODES: ReadonlySet<string> = new Set(['cli_failed', 'unparsable_output']);

// The payload is checked before it is used or logged: a uuid (any version —
// gen_random_uuid() today, and z.uuid() would also check the version nibble),
// nothing else.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const jobSchema = z.object({ intakeId: z.string().regex(UUID) });

// Inbound media (§4.2): what may be downloaded and handed to the model, and
// how big. The mime is Meta's (the scoped lookup's), compared without
// parameters; the wrapper refuses anything else before downloading.
const IMAGE_MIME = ['image/jpeg', 'image/png', 'image/webp'] as const;
// CSV arrives under more than one name; the two aliases are read as text/csv.
const CSV_MIME = ['text/csv', 'text/comma-separated-values', 'application/csv'] as const;
const DOCUMENT_MIME = ['application/pdf', 'text/plain', ...CSV_MIME] as const;
export const OWNER_AGENT_MEDIA_ALLOWED_MIME: readonly string[] = [...IMAGE_MIME, ...DOCUMENT_MIME];
export const OWNER_AGENT_IMAGE_MAX_BYTES = 5 * 1024 * 1024;
export const OWNER_AGENT_DOCUMENT_MAX_BYTES = 16 * 1024 * 1024;

export interface WhatsAppSender {
  phoneNumberId: string;
  accessToken: string;
  appSecret: string | null;
}

export interface MediaDownloadRequest {
  mediaId: string;
  phoneNumberId: string;
  maxBytes: number;
  allowedMime: readonly string[];
  lookupTimeoutMs: number;
  downloadTimeoutMs: number;
}

export type MediaDownloadResult =
  | { kind: 'ok'; bytes: Buffer; mime: string }
  | { kind: 'failed'; code: string };

export interface FollowupButtonsSend {
  to: string;
  body: string;
  buttons: Array<{ id: string; title: string }>;
  timeoutMs: number;
}

export interface FollowupListSend {
  to: string;
  body: string;
  buttonText: string;
  sections: Array<{ title: string; rows: Array<{ id: string; title: string; description?: string }> }>;
  timeoutMs: number;
}

export interface ReplyDeps {
  store: ReplyStore;
  sessions: SessionMemory;
  run: (input: OwnerAgentRunInput) => Promise<OwnerAgentRunResult>;
  /** Send credentials for `phoneNumberId`, or null when WhatsApp is not configured. */
  sender: (phoneNumberId: string) => Promise<WhatsAppSender | null>;
  /** `retryBudgetMs`: what is left of this answer's Meta-retry window (budgets.ts OWNER_AGENT_SEND_RETRY_MS). */
  sendText: (
    sender: WhatsAppSender,
    params: { to: string; body: string; retryBudgetMs?: number },
  ) => Promise<DeliveryOutcome>;
  alert: (input: SlackAlertInput) => Promise<unknown>;
  log: (line: string) => void;
  now: () => number;
  // Capabilities (§4.1–4.4). Optional so a consumer wired before them keeps
  // today's behaviour: no "read"/"typing", files unreadable, no buttons.
  /** "Read" + "typing…" on one inbound wamid. Its result is never relied on. */
  markRead?: (sender: WhatsAppSender, wamid: string, timeoutMs: number) => Promise<unknown>;
  /** Scoped lookup + hardened download (whatsapp/media.ts). Never throws. */
  downloadMedia?: (sender: WhatsAppSender, request: MediaDownloadRequest) => Promise<MediaDownloadResult>;
  sendButtons?: (sender: WhatsAppSender, params: FollowupButtonsSend) => Promise<DeliveryOutcome>;
  sendList?: (sender: WhatsAppSender, params: FollowupListSend) => Promise<DeliveryOutcome>;
  /** Re-send "typing…" this often during a run; 0 or absent = off (budgets.ts typingRefreshMs). */
  typingRefreshMs?: number;
}

export type ReplyOutcome =
  | 'answered'
  | 'fallback_sent'
  | 'unsupported_voice'
  | 'media_rejected'
  | 'gated'
  | 'unknown_action'
  | 'unsupported_type'
  | 'deferred'
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
  | { ok: true; recipient: string; permissions: OwnerAgentPermission[]; entryId: string }
  | { ok: false; reason: string };

type RunResult =
  | { ok: true; result: OwnerAgentRunResult }
  | { ok: false; code: string };

// What deliver() sends: the model's answer, the fixed failure reply for a run
// that failed, or one of the fixed replies no model run is needed for.
type Reply =
  | { kind: 'run'; run: RunResult }
  | { kind: 'fixed'; body: string; outcome: 'unsupported_voice' | 'media_rejected'; reasonCode: string | null };

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

  // Bursts (header). Read once; the gate reads the settings again for itself.
  const burstMs = (await store.readSettings())?.burstMs ?? 0;
  if (burstMs > 0 && intake.status === 'queued' && (await store.hasNewerQueued(intake))) {
    // A newer message of the same person leads the turn and folds this one in.
    return 'deferred';
  }

  // 'processing' is claimable too: a delivery that died before the send claim
  // left it there, and redoing the run is safe — nothing was sent.
  if (!(await store.transition(intake.id, ['queued', 'processing'], 'processing'))) return 'lost_race';

  // Folded right after the claim and before the gate, so a follower is never
  // left queued behind a leader that was gated.
  if (burstMs > 0) {
    for (const follower of await store.coalesceInto(intake)) {
      await audit(
        deps,
        { ...intake, id: follower.id, wamid: follower.wamid, staffUserId: follower.staffUserId },
        { stage: 'agent', outcome: 'coalesced', reasonCode: null, turnIntakeId: intake.id },
      );
    }
  }
  // Always read: a retry after burst_ms was turned off still owes the rows
  // folded before.
  const followers = await store.loadCoalesced(intake.id);
  const turnId = followers.length > 0 ? intake.id : null;

  // The daily cap is judged at the turn's FIRST message: a turn is answered
  // whenever its first message would have been on its own (a burst never
  // loses a message that was within the cap). Open owner decision 5 (plan
  // §7: does the cap count messages or turns) — this is the choice made
  // until the owner rules.
  const firstReceivedAt = followers[0]?.receivedAt ?? intake.receivedAt;
  const gate = await agentGate(intake, deps, firstReceivedAt);
  if (!gate.ok) {
    if (await store.transition(intake.id, ['processing'], 'skipped')) {
      await audit(deps, intake, { stage: 'agent', outcome: 'gated', reasonCode: gate.reason, turnIntakeId: turnId });
    }
    return 'gated';
  }

  // The turn, from the database alone — no Graph call yet (header).
  const turn = await buildTurn([...followers, intake], intake, deps);
  if (turn.parts.length === 0) {
    // Nothing answerable: a lone unknown tap, or unsupported types only.
    if (await store.transition(intake.id, ['processing'], 'skipped')) {
      await audit(deps, intake, {
        stage: 'agent',
        outcome: turn.silence.outcome,
        reasonCode: turn.silence.reasonCode,
        turnIntakeId: turnId,
      });
    }
    return turn.silence.outcome;
  }

  // Read BEFORE any Graph call: a missing configuration must not cost a run.
  const sender = await deps.sender(intake.phoneNumberId);
  if (!sender) throw new OwnerAgentReplyError('whatsapp_not_configured');
  const from: WhatsAppSender = { ...sender, phoneNumberId: intake.phoneNumberId };

  const started = deps.now();
  // ⚠️ M4 (plan §8), a decision: "read" + "typing…" go out now, after the
  // start gate; the send gate runs only after the model. A turn that the send
  // gate then stops (switch turned off, row disabled mid-run) shows the staff
  // member "read" and then nothing — silence stays the rule, and the receipt
  // is the price of showing "typing" while the model works.
  const typing = await startTyping(from, intake.wamid, deps);
  let reply: Reply;
  try {
    reply = await prepareReply(turn.parts, intake, gate.entryId, gate.permissions, from, deps, started);
  } finally {
    // Before the send gate, and awaited: a refresh landing after the answer
    // would show "typing…" again for up to 25s.
    await typing.stop();
  }
  if (reply.kind === 'run' && !reply.run.ok) {
    await audit(deps, intake, {
      stage: 'agent',
      outcome: 'run_failed',
      reasonCode: reply.run.code,
      latencyMs: deps.now() - started,
      turnIntakeId: turnId,
    });
  }
  return deliver(intake, turnId, gate.entryId, gate.recipient, gate.permissions, from, reply, deps, started);
}

// §3.1 #2: the route's gate, re-run against the state NOW. The job may have
// waited; the switch may be off, the number moved, the row disabled or
// removed, the staff member removed or out of today's cap. The identity is the
// allow-list row the question came through (intake.allowlist_entry_id), and
// the check depends on how the owner approved it (approval.ts):
//   verified_staff            — still staff, and the row phone is still their
//                               VERIFIED phone;
//   staff_unverified_override — still staff (phone approved by hand);
//   external_override         — not staff; no platform permissions, so none of
//                               the count tools is offered.
// The recipient is always the row's own phone — the phone the question came
// from (Meta signed it). For verified_staff that equals the verified phone.
// The route's per-process rate limit is not repeated: it counts arrivals, and
// the daily cap is the durable bound.
async function agentGate(
  intake: IntakeRow,
  deps: ReplyDeps,
  capAtIso: string = intake.receivedAt,
): Promise<GateResult> {
  const { store } = deps;
  const settings = await store.readSettings();
  if (!settings) return { ok: false, reason: 'not_configured' };
  if (!settings.enabled) return { ok: false, reason: 'kill_switch_off' };
  if (settings.phoneNumberId !== intake.phoneNumberId) return { ok: false, reason: 'number_changed' };
  if (!intake.allowlistEntryId) return { ok: false, reason: 'not_allowlisted' };
  const entry = await store.loadEntry(intake.allowlistEntryId);
  if (!entry || !entry.enabled) return { ok: false, reason: 'not_allowlisted' };

  let staffUserId: string | null = null;
  if (entry.approvalKind !== 'external_override') {
    if (!entry.staffUserId || !(await store.isStaff(entry.staffUserId))) return { ok: false, reason: 'not_staff' };
    staffUserId = entry.staffUserId;
  }
  if (entry.approvalKind === 'verified_staff' && staffUserId) {
    if ((await store.verifiedPhone(staffUserId)) !== entry.e164) return { ok: false, reason: 'phone_unverified' };
  }

  // The rows BEFORE this one on the Israel day it arrived — exactly what the
  // route counted before inserting it; questions that came after it do not
  // count against it. A cap lowered since then applies now. For a burst,
  // "this one" is the turn's first message (capAtIso).
  const receivedMs = Date.parse(capAtIso);
  const used = await store.countIntakeBefore(
    entry.id,
    israelMidnightIso(receivedMs),
    new Date(receivedMs).toISOString(),
  );
  if (used >= settings.dailyCap) return { ok: false, reason: 'daily_cap' };

  // One RPC per permission key, server-side, from the staff member's role —
  // never from the message. An external person holds none.
  const staffId = staffUserId;
  const granted = staffId
    ? await Promise.all(
        OWNER_AGENT_PERMISSIONS.map(async (key) => ((await store.hasPermission(staffId, key)) ? key : null)),
      )
    : [];
  return {
    ok: true,
    recipient: entry.e164,
    entryId: entry.id,
    permissions: granted.filter((key): key is OwnerAgentPermission => key !== null),
  };
}

// ── The turn ──────────────────────────────────────────────────────────────────

// A part of the turn, before its media is downloaded.
type PendingPart =
  | { kind: 'ready'; part: TurnPart }
  | { kind: 'media'; row: IntakeRow; what: 'image' | 'document' };

interface Turn {
  parts: PendingPart[];
  /** What the turn ends as when no part is left: the silence and its audit. */
  silence: { outcome: 'unknown_action' | 'unsupported_type'; reasonCode: string };
}

// Every row of the turn (followers oldest first, then the leader) becomes at
// most one part. A row that cannot be part of an answer — a tap that does not
// resolve, a type the agent does not handle — is dropped; when the leader
// itself is such a row it is audited as the turn's silence, a follower gets
// its own audit row.
async function buildTurn(rows: readonly IntakeRow[], leader: IntakeRow, deps: ReplyDeps): Promise<Turn> {
  const parts: PendingPart[] = [];
  let silence: Turn['silence'] = { outcome: 'unsupported_type', reasonCode: 'unsupported_type' };
  for (const row of rows) {
    const resolved = await resolveRow(row, deps);
    if (resolved.kind !== 'drop') {
      parts.push(resolved.part);
      continue;
    }
    if (row.id === leader.id) {
      silence = { outcome: resolved.outcome, reasonCode: resolved.reasonCode };
    } else {
      await audit(deps, row, {
        stage: 'agent',
        outcome: resolved.outcome,
        reasonCode: resolved.reasonCode,
        turnIntakeId: leader.id,
      });
    }
  }
  return { parts, silence };
}

type ResolvedRow =
  | { kind: 'part'; part: PendingPart }
  | { kind: 'drop'; outcome: 'unknown_action' | 'unsupported_type'; reasonCode: string };

async function resolveRow(row: IntakeRow, deps: ReplyDeps): Promise<ResolvedRow> {
  const ready = (part: TurnPart): ResolvedRow => ({ kind: 'part', part: { kind: 'ready', part } });
  switch (row.messageType) {
    case 'text':
      return row.messageText && row.messageText.trim()
        ? ready({ kind: 'text', text: row.messageText })
        : { kind: 'drop', outcome: 'unsupported_type', reasonCode: 'empty_text' };
    case 'location':
      return row.location
        ? ready({ kind: 'location', lat: row.location.lat, lng: row.location.lng, label: row.location.label })
        : { kind: 'drop', outcome: 'unsupported_type', reasonCode: 'unsupported_type' };
    case 'image':
    case 'document':
      return row.media
        ? { kind: 'part', part: { kind: 'media', row, what: row.messageType } }
        : { kind: 'drop', outcome: 'unsupported_type', reasonCode: 'unsupported_type' };
    case 'audio':
      // No transcription provider is decided (plan §7.1): a fixed reply, no run.
      return ready({ kind: 'voice' });
    case 'interactive':
    case 'button': {
      const tap = await resolveTap(row, deps);
      return tap.ok
        ? ready({ kind: 'followup', text: tap.text })
        : { kind: 'drop', outcome: 'unknown_action', reasonCode: tap.code };
    }
    default:
      return { kind: 'drop', outcome: 'unsupported_type', reasonCode: 'unsupported_type' };
  }
}

// §4.4: a tap is a question only if it resolves, SERVER-SIDE, to a follow-up
// WE offered: its id decodes to (our intake row, n); that row came through the
// same allow-list row; the message it replies to (context.id) is one of the
// wamids we sent for that row — the interactive message included (M7); it is
// within 24h of that answer; suggestion n exists; and no other row of the same
// id was answered. The question is then OUR stored text, never the tap's
// title — the staff member's client can send any id and any title.
async function resolveTap(row: IntakeRow, deps: ReplyDeps): Promise<{ ok: true; text: string } | { ok: false; code: string }> {
  const id = row.interactiveId;
  const decoded = id ? decodeFollowupId(id) : null;
  // A guest-template button (plan §8 M5) or any foreign id stops here.
  if (!id || !decoded || decoded.intakeId === row.id) return { ok: false, code: 'foreign_id' };
  const source = await deps.store.loadIntake(decoded.intakeId);
  if (!source) return { ok: false, code: 'followup_not_found' };
  if (!row.allowlistEntryId || source.allowlistEntryId !== row.allowlistEntryId) {
    return { ok: false, code: 'foreign_owner' };
  }
  if (!row.replyToWamid || !(source.replyWamids ?? []).includes(row.replyToWamid)) {
    return { ok: false, code: 'context_mismatch' };
  }
  const offeredAt = Date.parse(source.processedAt ?? source.receivedAt);
  if (!(deps.now() - offeredAt < FOLLOWUP_TTL_MS)) return { ok: false, code: 'followup_expired' };
  const text = source.followups?.[decoded.n];
  if (typeof text !== 'string' || !text.trim()) return { ok: false, code: 'followup_not_found' };
  if ((await deps.store.countFollowupUses(id, row.id)) > 0) return { ok: false, code: 'followup_used' };
  return { ok: true, text };
}

// ── Typing (§4.1) ─────────────────────────────────────────────────────────────

async function startTyping(
  sender: WhatsAppSender,
  wamid: string,
  deps: ReplyDeps,
): Promise<{ stop: () => Promise<void> }> {
  const markRead = deps.markRead;
  if (!markRead) return { stop: async () => {} };
  // Never changes the flow: a failure or a timeout is dropped.
  const once = () => quietly(() => markRead(sender, wamid, OWNER_AGENT_TYPING_TIMEOUT_MS));
  await once();
  const every = deps.typingRefreshMs ?? 0;
  if (every <= 0) return { stop: async () => {} };
  let inFlight: Promise<unknown> = Promise.resolve();
  const timer = setInterval(() => {
    inFlight = once();
  }, every);
  timer.unref?.();
  return {
    stop: async () => {
      clearInterval(timer);
      await inFlight;
    },
  };
}

// ── Media (§4.2) and the run ─────────────────────────────────────────────────

async function prepareReply(
  pending: readonly PendingPart[],
  intake: IntakeRow,
  entryId: string,
  permissions: OwnerAgentPermission[],
  sender: WhatsAppSender,
  deps: ReplyDeps,
  started: number,
): Promise<Reply> {
  // Voice notes only: the fixed reply, no download, no run.
  if (pending.every((p) => p.kind === 'ready' && p.part.kind === 'voice')) {
    return { kind: 'fixed', body: OWNER_AGENT_UNSUPPORTED_VOICE_REPLY, outcome: 'unsupported_voice', reasonCode: null };
  }

  const parts: TurnPart[] = [];
  const attachments: OwnerAgentAttachment[] = [];
  let firstFailure: string | null = null;
  const deadline = deps.now() + OWNER_AGENT_MEDIA_BUDGET_MS;
  for (const p of pending) {
    if (p.kind === 'ready') {
      parts.push(p.part);
      continue;
    }
    const caption = p.row.messageText && p.row.messageText.trim() ? p.row.messageText : null;
    const got =
      attachments.length >= OWNER_AGENT_MAX_MEDIA_PER_TURN
        ? ({ ok: false, code: 'media_turn_cap' } as const)
        : await fetchAttachment(p.row, sender, deadline, deps);
    if (got.ok) {
      attachments.push(got.attachment);
      parts.push({ kind: 'attachment', what: p.what, filename: p.row.media?.filename ?? null, caption });
    } else {
      firstFailure ??= got.code;
      parts.push({ kind: 'unreadable', what: p.what });
      if (caption) parts.push({ kind: 'text', text: caption });
    }
  }

  // Only files, and none could be read: the fixed reply, no run.
  const answerable = parts.some((part) => part.kind !== 'unreadable' && part.kind !== 'voice');
  if (!answerable) {
    return { kind: 'fixed', body: OWNER_AGENT_MEDIA_REJECTED_REPLY, outcome: 'media_rejected', reasonCode: firstFailure };
  }
  return { kind: 'run', run: await runAnswer(parts, attachments, entryId, permissions, deps, started) };
}

type AttachmentResult = { ok: true; attachment: OwnerAgentAttachment } | { ok: false; code: string };

function mimeCap(mime: string | null, what: 'image' | 'document'): number {
  const base = (mime ?? '').split(';')[0]?.trim().toLowerCase() ?? '';
  if (base.startsWith('image/') || (!base && what === 'image')) return OWNER_AGENT_IMAGE_MAX_BYTES;
  return OWNER_AGENT_DOCUMENT_MAX_BYTES;
}

async function fetchAttachment(
  row: IntakeRow,
  sender: WhatsAppSender,
  deadline: number,
  deps: ReplyDeps,
): Promise<AttachmentResult> {
  const media = row.media;
  if (!media || !deps.downloadMedia) return { ok: false, code: 'media_not_wired' };
  const remaining = deadline - deps.now();
  if (remaining < 1_000) return { ok: false, code: 'media_budget' };
  const what = row.messageType === 'image' ? 'image' : 'document';
  const lookupTimeoutMs = Math.min(OWNER_AGENT_MEDIA_LOOKUP_TIMEOUT_MS, Math.floor(remaining / 2));
  let result: MediaDownloadResult;
  try {
    result = await deps.downloadMedia(sender, {
      mediaId: media.id,
      phoneNumberId: row.phoneNumberId,
      maxBytes: mimeCap(media.mime, what),
      allowedMime: OWNER_AGENT_MEDIA_ALLOWED_MIME,
      lookupTimeoutMs,
      downloadTimeoutMs: Math.max(1, remaining - lookupTimeoutMs),
    });
  } catch {
    result = { kind: 'failed', code: 'media_download_failed' };
  }
  if (result.kind !== 'ok') return { ok: false, code: codeShaped(result.code, 'media_download_failed') };
  return toAttachment(result.bytes, result.mime);
}

// Meta's mime (checked against the allowlist by the wrapper) decides the
// block; the size cap is applied again on what arrived.
function toAttachment(bytes: Buffer, mime: string): AttachmentResult {
  const base = mime.split(';')[0]?.trim().toLowerCase() ?? '';
  if ((IMAGE_MIME as readonly string[]).includes(base)) {
    if (bytes.byteLength > OWNER_AGENT_IMAGE_MAX_BYTES) return { ok: false, code: 'media_too_large' };
    return {
      ok: true,
      attachment: { kind: 'image', mediaType: base as (typeof IMAGE_MIME)[number], base64: bytes.toString('base64') },
    };
  }
  if (bytes.byteLength > OWNER_AGENT_DOCUMENT_MAX_BYTES) return { ok: false, code: 'media_too_large' };
  if (base === 'application/pdf') return { ok: true, attachment: { kind: 'pdf', base64: bytes.toString('base64') } };
  if (base === 'text/plain' || (CSV_MIME as readonly string[]).includes(base)) {
    // Strict UTF-8: a Windows-1255 CSV (common from Hebrew Excel) is refused
    // rather than handed over as mojibake.
    let text: string;
    try {
      text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    } catch {
      return { ok: false, code: 'media_bad_encoding' };
    }
    if (!text.trim()) return { ok: false, code: 'media_empty' };
    if (text.length > MAX_TEXT_ATTACHMENT_CHARS) return { ok: false, code: 'media_too_large' };
    return { ok: true, attachment: { kind: 'text', text } };
  }
  return { ok: false, code: 'media_unsupported' };
}

const CODE = /^[a-z][a-z0-9_]{0,63}$/;
function codeShaped(code: string, fallback: string): string {
  return CODE.test(code) ? code : fallback;
}

async function runAnswer(
  parts: readonly TurnPart[],
  attachments: readonly OwnerAgentAttachment[],
  entryId: string,
  permissions: OwnerAgentPermission[],
  deps: ReplyDeps,
  started: number,
): Promise<RunResult> {
  // Conversation memory is per allow-list row (the identity), not per staff member.
  const staff = entryId;
  const input: OwnerAgentRunInput = {
    prompt: buildTurnPrompt(parts, started),
    systemPrompt: OWNER_AGENT_SYSTEM_PROMPT,
    permissions,
    model: OWNER_AGENT_MODEL,
    maxTurns: OWNER_AGENT_MAX_TURNS,
    timeoutMs: OWNER_AGENT_RUN_TIMEOUT_MS,
    structured: true,
    ...(attachments.length > 0 ? { attachments } : {}),
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
  // Not remembered here: deliver() remembers the session only once the send
  // gate has passed, so a question that ends in silence is not continued.
  return { ok: true, result };
}

function runErrorCode(error: unknown): string {
  return error instanceof OwnerAgentRunError ? error.code : 'run_exception';
}

// ── Delivery ──────────────────────────────────────────────────────────────────

// The one way a message leaves this module. Answer, fallback or fixed reply
// alike: the send-time gate, the send claim, the text(s), the follow-ups, the
// result.
async function deliver(
  intake: IntakeRow,
  turnId: string | null,
  entryId: string,
  recipient: string,
  permissions: OwnerAgentPermission[],
  from: WhatsAppSender,
  reply: Reply,
  deps: ReplyDeps,
  started: number,
): Promise<ReplyOutcome> {
  const { store } = deps;

  // §3.1 #3, against the state NOW (the run took up to three minutes): the
  // switch still on, the number still the chosen one and still the one the
  // question arrived on, the recipient still an enabled row of this staff
  // member. A database error here still throws — nothing has been sent yet.
  const blocked = await sendGate(intake, recipient, deps);
  if (blocked) {
    if (await store.transition(intake.id, ['processing'], 'skipped')) {
      await audit(deps, intake, { stage: 'send', outcome: 'gated', reasonCode: blocked, turnIntakeId: turnId });
    }
    return 'send_gated';
  }
  if (!(await store.transition(intake.id, ['processing'], 'sending'))) return 'lost_race';

  // ── Past the send claim: nothing below may throw. ──────────────────────────
  const answer = reply.kind === 'run' && reply.run.ok ? reply.run.result : null;
  // The gate passed and the answer is going out: only now is its session worth
  // continuing. A gated answer the staff member never saw is not remembered,
  // and neither is a run that kept no session file (a run with attachments).
  if (answer && answer.sessionPersisted !== false) {
    await quietly(() => deps.sessions.remember(entryId, answer.sessionId, deps.now(), permissions));
  }
  const body =
    reply.kind === 'fixed'
      ? reply.body
      : answer
        ? answerBody(answer.text, answer.sqlUnavailable)
        : OWNER_AGENT_FAILURE_REPLY;
  let failure: string | null = null;
  let sent = 0;
  const wamids: string[] = [];
  // One Meta-retry window for the whole answer, shared by its parts.
  const retryUntil = deps.now() + OWNER_AGENT_SEND_RETRY_MS;
  for (const part of splitForWhatsApp(body)) {
    let outcome: DeliveryOutcome;
    try {
      const retryBudgetMs = Math.max(0, retryUntil - deps.now());
      outcome = await deps.sendText(from, { to: recipient, body: part, retryBudgetMs });
    } catch {
      outcome = { kind: 'unknown', reason: 'send_threw' };
    }
    if (outcome.kind !== 'accepted') {
      failure = sendFailureCode(outcome, sent);
      break;
    }
    sent += 1;
    wamids.push(outcome.providerId);
  }

  // The follow-ups: one interactive message, only after every text part of an
  // answer went out. Its failure after the text is a partial send.
  let offered: string[] | null = null;
  if (!failure && answer && (answer.followups?.length ?? 0) > 0) {
    const followups = answer.followups;
    const outcome = await sendFollowups(from, recipient, intake.id, followups, deps);
    if (outcome) {
      if (outcome.kind === 'accepted') {
        wamids.push(outcome.providerId);
        offered = followups;
      } else {
        failure = sendFailureCode(outcome, sent);
      }
    }
  }
  // What a later tap is checked against (§4.4, M7). Never throws.
  if (wamids.length > 0) {
    const recordedReply = await quietly(() => store.recordReply(intake.id, { followups: offered, replyWamids: wamids }));
    if (recordedReply !== true) deps.log(`[owner-agent] reply_not_recorded intake=${intake.id}`);
  }

  const recorded = await quietly(() => store.transition(intake.id, ['sending'], failure ? 'failed' : 'answered'));
  if (recorded !== true) {
    // The row stays `sending`; no later delivery will send for it (see the
    // header). Visible here, and in the audit row below.
    deps.log(`[owner-agent] status_not_recorded intake=${intake.id}`);
  }
  const latencyMs = deps.now() - started;
  const answerFields = answer ? { toolNames: answer.toolNames, steps: answer.turns } : {};
  const turnIntakeId = turnId;
  if (failure) {
    await audit(deps, intake, { stage: 'send', outcome: 'send_failed', reasonCode: failure, latencyMs, turnIntakeId, ...answerFields });
    return 'send_failed';
  }
  if (reply.kind === 'fixed') {
    await audit(deps, intake, { stage: 'send', outcome: reply.outcome, reasonCode: reply.reasonCode, latencyMs, turnIntakeId });
    return reply.outcome;
  }
  if (answer) {
    // An answer from the count tools alone (the Supabase server did not
    // connect) is still an answer; the code says it was a degraded one.
    const reasonCode = answer.sqlUnavailable ? 'sql_unavailable' : null;
    await audit(deps, intake, { stage: 'send', outcome: 'answered', reasonCode, latencyMs, turnIntakeId, ...answerFields });
    return 'answered';
  }
  const runCode = reply.run.ok ? null : reply.run.code;
  await audit(deps, intake, { stage: 'send', outcome: 'fallback_sent', reasonCode: runCode, latencyMs, turnIntakeId });
  return 'fallback_sent';
}

// null = nothing was attempted (no suggestion survived, or the senders are
// not wired). The ids are nonces of THIS intake row (encodeFollowupId).
async function sendFollowups(
  from: WhatsAppSender,
  to: string,
  intakeId: string,
  followups: readonly string[],
  deps: ReplyDeps,
): Promise<DeliveryOutcome | null> {
  let message: ReturnType<typeof buildFollowupMessage>;
  try {
    message = buildFollowupMessage(followups, (n) => encodeFollowupId(intakeId, n));
  } catch {
    return null;
  }
  if (!message) return null;
  try {
    if (message.kind === 'buttons') {
      if (!deps.sendButtons) return null;
      return await deps.sendButtons(from, {
        to,
        body: message.body,
        buttons: message.buttons,
        timeoutMs: OWNER_AGENT_INTERACTIVE_SEND_MS,
      });
    }
    if (!deps.sendList) return null;
    return await deps.sendList(from, {
      to,
      body: message.body,
      buttonText: message.buttonText,
      sections: message.sections,
      timeoutMs: OWNER_AGENT_INTERACTIVE_SEND_MS,
    });
  } catch {
    return { kind: 'unknown', reason: 'send_threw' };
  }
}

async function sendGate(intake: IntakeRow, recipient: string, deps: ReplyDeps): Promise<string | null> {
  const settings = await deps.store.readSettings();
  if (!settings) return 'not_configured';
  if (!settings.enabled) return 'kill_switch_off';
  if (settings.phoneNumberId !== intake.phoneNumberId) return 'number_changed';
  if (!intake.allowlistEntryId) return 'not_allowlisted';
  const entry = await deps.store.loadEntry(intake.allowlistEntryId);
  if (!entry || !entry.enabled || entry.e164 !== recipient) return 'not_allowlisted';
  return null;
}

// Codes only (they fit the audit CHECK and report_run.error_code). 131047 is
// Meta's closed 24h window (plan §2.4). Whenever Meta sent a code, it is kept —
// on a rejection AND on an unknown outcome — so the log says what Meta answered
// instead of a bare "unknown". Shared with the report sender.
export function sendFailureCode(
  outcome: Exclude<DeliveryOutcome, { kind: 'accepted' }>,
  sentBefore: number,
): string {
  if (sentBefore > 0) return 'partial_send';
  const code = outcome.providerCode && /^[0-9]{1,12}$/.test(outcome.providerCode) ? outcome.providerCode : null;
  if (outcome.kind === 'definitely_not_sent') {
    if (code === '131047') return 'window_closed';
    return code ? `meta_${code}` : 'provider_rejected';
  }
  return code ? `send_unknown_${code}` : 'send_unknown';
}

async function audit(
  deps: ReplyDeps,
  intake: Pick<IntakeRow, 'id' | 'wamid' | 'staffUserId' | 'allowlistEntryId'>,
  row: Omit<AuditInput, 'staffUserId' | 'intakeId' | 'wamid'>,
): Promise<void> {
  const ok = await deps.store.writeAudit({
    ...row,
    staffUserId: intake.staffUserId,
    allowlistEntryId: intake.allowlistEntryId,
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
