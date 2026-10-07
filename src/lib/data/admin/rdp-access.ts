import 'server-only';

import { isIP } from 'node:net';

import { requirePlatformPermission } from '@/lib/auth/dal';
import { getRdpGatewayConfig, getXrdpTicketConfig } from '@/lib/rdp-access/config';
import { connectRdpFile } from '@/lib/rdp-access/gateway-client';
import { getRdpGrantRequestId, listFirstGatewayAllows } from '@/lib/rdp-access/queries';
import { addXrdpLogon, validateRdpFile } from '@/lib/rdp-access/rdp-file';
import { mintXrdpTicket } from '@/lib/rdp-access/xrdp-ticket';
import {
  beginRdpFileIssue,
  cancelRdpRequest,
  endOwnRdpGrant,
  recordRdpFileFailure,
  requestRdpAccess,
} from '@/lib/rdp-access/service';
import { createAdminClient } from '@/lib/supabase/admin';
import { createClient } from '@/lib/supabase/server';
import type { Tables } from '@/lib/supabase/types';
import type { RdpRequestForm } from '@/lib/validation/rdp-access';

// The staff-facing side of the remote-desktop approval flow (/admin/rdp-access).
//
// EVERY export gates on requirePlatformPermission('rdp.request') FIRST, and the user id is the gate's return value,
// never an argument: a caller cannot ask for another person's request, grant or file. The rdp_* write functions are
// executable by service_role only (see rdp-access/service.ts), so the writes here go through the admin client AFTER
// the gate; the database checks the permission again inside each function.
//
// Reads go through the cookie client on purpose. RLS lets a staff member see only their own rows and only the
// granted columns (no request_ip, no approver context, no cut internals), so a mistake in this file cannot widen
// what a staff member can read. The consequence for the queries below: `requester_id` / `user_id` are not
// selectable by that role, so the "mine" filter is the policy itself, not a `.eq()`.

// A finished request stays on screen (with the owner's note, if any) for this long, then the page offers a fresh
// request form directly. The history itself is never deleted; this only decides what the page leads with.
const OUTCOME_VISIBLE_MS = 24 * 3_600_000;

type RequestRow = Pick<
  Tables<'rdp_access_requests'>,
  | 'id'
  | 'status'
  | 'reason'
  | 'requested_minutes'
  | 'created_at'
  | 'expires_at'
  | 'answered_at'
  | 'granted_minutes'
  | 'answer_note'
  | 'cancelled_at'
>;
type GrantRow = Pick<
  Tables<'rdp_access_grants'>,
  'id' | 'request_id' | 'status' | 'target' | 'starts_at' | 'expires_at' | 'ended_at' | 'ended_reason' | 'files_issued' | 'max_files'
>;

const REQUEST_COLUMNS =
  'id, status, reason, requested_minutes, created_at, expires_at, answered_at, granted_minutes, answer_note, cancelled_at' as const;
const GRANT_COLUMNS =
  'id, request_id, status, target, starts_at, expires_at, ended_at, ended_reason, files_issued, max_files' as const;

export type RdpEndedReason = 'revoked_by_owner' | 'expired' | 'ended_by_user' | 'access_removed';
const ENDED_REASONS: readonly RdpEndedReason[] = ['revoked_by_owner', 'expired', 'ended_by_user', 'access_removed'];

/** What /admin/rdp-access shows. Plain data: it crosses into client components, so no Dates and no row types. */
export type RdpAccessView =
  | { kind: 'none' }
  | { kind: 'pending'; requestId: string; reason: string; requestedMinutes: number; createdAt: string; expiresAt: string }
  | {
      kind: 'active';
      requestId: string;
      reason: string;
      grantedMinutes: number;
      startsAt: string;
      expiresAt: string;
      filesIssued: number;
      maxFiles: number;
      /** When the gateway first allowed a tunnel for this grant (measured from the audit trail); null if it never did. */
      connectedAt: string | null;
    }
  | { kind: 'denied'; requestId: string; requestedMinutes: number; answeredAt: string | null; note: string | null }
  | { kind: 'expired'; requestId: string; requestedMinutes: number; expiresAt: string }
  | { kind: 'cancelled'; requestId: string; requestedMinutes: number }
  | {
      kind: 'ended';
      requestId: string;
      grantedMinutes: number;
      endedAt: string | null;
      endedReason: RdpEndedReason | null;
      filesIssued: number;
      connectedAt: string | null;
    };

export type RdpAccessState = {
  view: RdpAccessView;
  /** The server clock at read time, so a countdown in the browser can correct for a skewed device clock. */
  serverNow: string;
};

function narrowEndedReason(value: string | null): RdpEndedReason | null {
  return ENDED_REASONS.find((r) => r === value) ?? null;
}

/**
 * Pure: turns the latest request (and its grant) into what the page shows. A pending request past its expiry and
 * a grant past its end are presented as finished even if the sweep has not marked them yet (the database already
 * refuses both; this only keeps the page from showing a live countdown for something that is over).
 */
export function deriveRdpAccessView(
  request: RequestRow | null,
  grant: GrantRow | null,
  now: Date,
  connectedAt: string | null,
): RdpAccessView {
  if (!request) return { kind: 'none' };
  const nowMs = now.getTime();
  const requestedMinutes = request.requested_minutes;

  if (request.status === 'pending') {
    if (Date.parse(request.expires_at) > nowMs) {
      return {
        kind: 'pending',
        requestId: request.id,
        reason: request.reason,
        requestedMinutes,
        createdAt: request.created_at,
        expiresAt: request.expires_at,
      };
    }
    return { kind: 'expired', requestId: request.id, requestedMinutes, expiresAt: request.expires_at };
  }

  if (request.status === 'approved') {
    const grantedMinutes = request.granted_minutes ?? requestedMinutes;
    if (grant && grant.status === 'active' && Date.parse(grant.expires_at) > nowMs) {
      return {
        kind: 'active',
        requestId: request.id,
        reason: request.reason,
        grantedMinutes,
        startsAt: grant.starts_at,
        expiresAt: grant.expires_at,
        filesIssued: grant.files_issued,
        maxFiles: grant.max_files,
        connectedAt,
      };
    }
    return {
      kind: 'ended',
      requestId: request.id,
      grantedMinutes,
      endedAt: grant ? (grant.ended_at ?? grant.expires_at) : null,
      endedReason: grant ? (narrowEndedReason(grant.ended_reason) ?? (grant.status === 'active' ? 'expired' : null)) : null,
      filesIssued: grant?.files_issued ?? 0,
      connectedAt,
    };
  }

  if (request.status === 'denied') {
    return { kind: 'denied', requestId: request.id, requestedMinutes, answeredAt: request.answered_at, note: request.answer_note };
  }
  if (request.status === 'cancelled') return { kind: 'cancelled', requestId: request.id, requestedMinutes };
  return { kind: 'expired', requestId: request.id, requestedMinutes, expiresAt: request.expires_at };
}

/** True when a finished request is old enough that the page should lead with the request form instead. */
function isStaleOutcome(view: RdpAccessView, request: RequestRow | null, grant: GrantRow | null, now: Date): boolean {
  if (view.kind === 'none' || view.kind === 'pending' || view.kind === 'active' || !request) return false;
  const finishedAt = grant?.ended_at ?? request.answered_at ?? request.cancelled_at ?? request.expires_at;
  return now.getTime() - Date.parse(finishedAt) > OUTCOME_VISIBLE_MS;
}

export async function getMyRdpAccessState(): Promise<RdpAccessState> {
  await requirePlatformPermission('rdp.request');
  const supabase = await createClient();

  const latest = await supabase
    .from('rdp_access_requests')
    .select(REQUEST_COLUMNS)
    .order('created_at', { ascending: false })
    .limit(1);
  if (latest.error) throw new Error('rdp-access: read_my_request failed');
  const request = latest.data[0] ?? null;

  let grant: GrantRow | null = null;
  if (request && request.status === 'approved') {
    const grants = await supabase.from('rdp_access_grants').select(GRANT_COLUMNS).eq('request_id', request.id).limit(1);
    if (grants.error) throw new Error('rdp-access: read_my_grant failed');
    grant = grants.data[0] ?? null;
  }

  // The gateway's own trace of a connection lives in the audit table, which a staff member cannot read. This one
  // timestamp for the caller's own grant is read server-side after the gate; nothing else of that table leaves.
  const connectedAt = grant ? ((await listFirstGatewayAllows(createAdminClient(), [grant.id])).get(grant.id) ?? null) : null;

  const now = new Date();
  const view = deriveRdpAccessView(request, grant, now, connectedAt);
  return {
    view: isStaleOutcome(view, request, grant, now) ? { kind: 'none' } : view,
    serverNow: now.toISOString(),
  };
}

export async function submitRdpAccessRequest(input: RdpRequestForm, clientIp: string | null) {
  const user = await requirePlatformPermission('rdp.request');
  return requestRdpAccess(createAdminClient(), {
    userId: user.id,
    reason: input.reason,
    minutes: input.minutes,
    clientIp,
  });
}

export async function cancelMyRdpRequest(requestId: string) {
  const user = await requirePlatformPermission('rdp.request');
  return cancelRdpRequest(createAdminClient(), { userId: user.id, requestId });
}

export async function endMyRdpGrant() {
  const user = await requirePlatformPermission('rdp.request');
  return endOwnRdpGrant(createAdminClient(), { userId: user.id });
}

export type RdpFileIssueFailure =
  | 'not_allowed'
  | 'no_active_grant'
  | 'file_limit'
  | 'too_soon'
  | 'no_client_ip'
  | 'gateway_unavailable';
export type RdpFileIssueResult = { ok: true; content: string } | { ok: false; reason: RdpFileIssueFailure };

/**
 * Issues one connection file for the caller's live grant: reserves a download in the database (which counts it and
 * enforces the per-grant cap and the minimum gap), asks the gateway for the signed file, validates it and hands the
 * text back. The body is never stored or logged. The target comes from the grant row the owner approved, never from
 * configuration or from the browser.
 *
 * When ticket login is configured the file also carries a 5-minute desktop login ticket for the account the SERVER
 * decided (see xrdp-ticket.ts), added after validation. When it is not configured at all the file is exactly what the
 * gateway returned; when it is half-configured nothing is issued.
 *
 * Nothing is reserved when the gateway or the ticket login is misconfigured or the caller's address is unknown, so
 * those cannot use up a download. A failure AFTER the reservation is recorded in the audit trail; the download stays
 * counted.
 */
export async function issueMyRdpFile(clientIp: string | null): Promise<RdpFileIssueResult> {
  const user = await requirePlatformPermission('rdp.request');
  if (clientIp === null || isIP(clientIp) === 0) return { ok: false, reason: 'no_client_ip' };

  const gateway = getRdpGatewayConfig();
  if (!gateway.ok) {
    console.error('rdp-access: the gateway is not configured, no file was issued');
    return { ok: false, reason: 'gateway_unavailable' };
  }

  const xrdp = getXrdpTicketConfig();
  if (!xrdp.ok && xrdp.reason === 'invalid') {
    // names only: a half-set ticket login must not quietly fall back to a file that cannot log in
    console.error(`rdp-access: ticket login is misconfigured (${xrdp.variables.join(', ')}), no file was issued`);
    return { ok: false, reason: 'gateway_unavailable' };
  }

  const admin = createAdminClient();
  const reserved = await beginRdpFileIssue(admin, { userId: user.id, clientIp });
  if (reserved.outcome === 'unexpected') return { ok: false, reason: 'gateway_unavailable' };
  if (reserved.outcome !== 'ok') return { ok: false, reason: reserved.outcome };
  if (reserved.grantId === null || reserved.target === null) return { ok: false, reason: 'gateway_unavailable' };

  const fetched = await connectRdpFile({ ...gateway.config, target: reserved.target }, clientIp);
  const validated = fetched.ok ? validateRdpFile(fetched.value.text, { target: reserved.target }) : null;
  let failure: string;
  if (fetched.ok && validated?.ok) {
    if (!xrdp.ok) return { ok: true, content: validated.content };
    const ticket = mintXrdpTicket(
      { secret: xrdp.config.ticketSecret, grantId: reserved.grantId, userId: user.id, account: xrdp.config.account },
      new Date(),
    );
    const composed = addXrdpLogon(validated.content, { account: xrdp.config.account, ticket });
    if (composed.ok) return { ok: true, content: composed.content };
    failure = `logon_${composed.reason}`;
  } else {
    failure = fetched.ok ? `file_${validated?.ok === false ? validated.reason : 'invalid'}` : fetched.kind;
  }

  const requestId = await getRdpGrantRequestId(admin, reserved.grantId);
  if (requestId !== null) {
    await recordRdpFileFailure(admin, { grantId: reserved.grantId, requestId, clientIp, outcome: failure.slice(0, 40) });
  }
  return { ok: false, reason: 'gateway_unavailable' };
}
