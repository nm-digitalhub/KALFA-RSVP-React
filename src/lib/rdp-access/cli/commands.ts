import type { createAdminClient } from '@/lib/supabase/admin';
import type { Json } from '@/lib/supabase/types';

import { getRdpGatewayConfig } from '../config';
import { disconnectRdpTunnels, listRdpTunnels } from '../gateway-client';
import { notifyRdpOwnerAction } from '../notify';
import { RDP_MINUTES_MAX, RDP_MINUTES_MIN } from '../policy';
import {
  countPendingRdpRequests,
  getActiveRdpGrant,
  getRdpRequestDetail,
  listRdpRequests,
  nameMap,
  resolveOwner,
  resolveRdpRequestId,
  type RdpStatusFilter,
} from '../queries';
import { answerRdpRequest, endRdpGrant, markRdpCut } from '../service';
import { clip, formatTime as time, shortId as short } from './format';
import { CLI_TEXT, OUTCOME_TEXT } from './text';

// The owner CLI commands as plain functions over an injected context, so they can be driven by the commander
// program, by the interactive watch screen and by tests alike. Nothing here reads process state or prints
// directly; every line goes through ctx.out / ctx.err.
//
// The CLI runs on the server with the service role, so the approver identity is ATTRIBUTION (see
// resolveOwner): the owner is verified again inside the database functions, and every decision also leaves an
// out-of-band notification (notifyRdpOwnerAction).
//
// Exit codes follow the repo convention: 0 success, 1 error, 2 nothing to do (not pending, no active grant, not
// found, declined).

type AdminClient = ReturnType<typeof createAdminClient>;

export const EXIT = { ok: 0, error: 1, noop: 2 } as const;
export type ExitCode = (typeof EXIT)[keyof typeof EXIT];

export type CliApi = {
  answer: typeof answerRdpRequest;
  endGrant: typeof endRdpGrant;
  markCut: typeof markRdpCut;
  disconnect: typeof disconnectRdpTunnels;
  listTunnels: typeof listRdpTunnels;
  notify: typeof notifyRdpOwnerAction;
  getConfig: typeof getRdpGatewayConfig;
};

export const defaultCliApi: CliApi = {
  answer: answerRdpRequest,
  endGrant: endRdpGrant,
  markCut: markRdpCut,
  disconnect: disconnectRdpTunnels,
  listTunnels: listRdpTunnels,
  notify: notifyRdpOwnerAction,
  getConfig: getRdpGatewayConfig,
};

export type CliContext = {
  admin: AdminClient;
  now: () => Date;
  out: (line: string) => void;
  err: (line: string) => void;
  /** Asks the owner to confirm. Returning false aborts with EXIT.noop. */
  confirm: (message: string) => Promise<boolean>;
  env: Readonly<Record<string, string | undefined>>;
  host: { osUser: string; hostname: string; pid: number; isTTY: boolean };
  api: CliApi;
};

/** Attribution stored with the decision. Hints only: a process running as this OS user controls all of it. */
export function approverContext(ctx: Pick<CliContext, 'env' | 'host'>): Json {
  const sshClient = ctx.env.SSH_CONNECTION?.split(' ')[0] ?? null;
  return {
    os_user: ctx.host.osUser,
    host: ctx.host.hostname,
    ssh_client_ip: sshClient,
    tty: ctx.host.isTTY,
    cli: 'rdp-access-cli/1',
    pid: ctx.host.pid,
  };
}

async function requireOwner(ctx: CliContext, as?: string): Promise<{ ok: true; ownerId: string } | { ok: false }> {
  const owner = await resolveOwner(ctx.admin, as);
  if (owner.ok) return { ok: true, ownerId: owner.ownerId };
  ctx.err(
    owner.reason === 'no_owner'
      ? CLI_TEXT.noOwner
      : owner.reason === 'ambiguous'
        ? CLI_TEXT.ambiguousOwner
        : CLI_TEXT.notOwner,
  );
  return { ok: false };
}

async function pickRequest(ctx: CliContext, typed: string): Promise<{ ok: true; id: string } | { ok: false; code: ExitCode }> {
  const resolved = await resolveRdpRequestId(ctx.admin, typed);
  if (resolved.ok) return { ok: true, id: resolved.id };
  ctx.err(
    resolved.reason === 'invalid'
      ? CLI_TEXT.invalidId
      : resolved.reason === 'ambiguous'
        ? CLI_TEXT.ambiguousId
        : CLI_TEXT.notFound,
  );
  return { ok: false, code: resolved.reason === 'invalid' ? EXIT.error : EXIT.noop };
}

// ── read-only commands ───────────────────────────────────────────────────────

export async function cmdList(ctx: CliContext, opts: { status: RdpStatusFilter; json: boolean }): Promise<ExitCode> {
  const rows = await listRdpRequests(ctx.admin, { status: opts.status });
  const names = await nameMap(ctx.admin, rows.map((r) => r.requester_id));
  if (opts.json) {
    ctx.out(
      JSON.stringify(
        rows.map((r) => ({
          id: r.id,
          status: r.status,
          requester: (r.requester_id && names.get(r.requester_id)) || null,
          minutes: r.requested_minutes,
          grantedMinutes: r.granted_minutes,
          createdAt: r.created_at,
          expiresAt: r.expires_at,
          reason: r.reason,
        })),
        null,
        2,
      ),
    );
    return EXIT.ok;
  }
  if (rows.length === 0) {
    ctx.out(CLI_TEXT.noPending);
    return EXIT.ok;
  }
  for (const r of rows) {
    const who = (r.requester_id && names.get(r.requester_id)) || '?';
    ctx.out(
      `${short(r.id)}  ${r.status.padEnd(9)}  ${who}  ${r.requested_minutes}ד׳  ${time(r.created_at)}  ${clip(r.reason, 50)}`,
    );
  }
  return EXIT.ok;
}

export async function cmdShow(ctx: CliContext, typedId: string): Promise<ExitCode> {
  const picked = await pickRequest(ctx, typedId);
  if (!picked.ok) return picked.code;
  const detail = await getRdpRequestDetail(ctx.admin, picked.id);
  if (!detail) {
    ctx.err(CLI_TEXT.notFound);
    return EXIT.noop;
  }
  const { request, grant, events } = detail;
  const names = await nameMap(ctx.admin, [request.requester_id, grant?.user_id ?? null]);
  ctx.out(`בקשה ${request.id}`);
  ctx.out(`סטטוס: ${request.status}`);
  ctx.out(`מבקש: ${(request.requester_id && names.get(request.requester_id)) || '?'}`);
  ctx.out(`משך מבוקש: ${request.requested_minutes} דקות${request.granted_minutes ? `, אושר: ${request.granted_minutes}` : ''}`);
  ctx.out(`נוצרה: ${time(request.created_at)}  פגה: ${time(request.expires_at)}`);
  ctx.out(`מטרה: ${request.reason}`);
  if (grant) {
    ctx.out(`גישה ${short(grant.id)}: ${grant.status}${grant.ended_reason ? ` (${grant.ended_reason})` : ''}`);
    ctx.out(`  יעד: ${grant.target}  ${time(grant.starts_at)} עד ${time(grant.expires_at)}`);
    ctx.out(`  קבצים: ${grant.files_issued}/${grant.max_files}  ניתוק מאושר: ${grant.tunnels_cut_at ? 'כן' : 'לא'}`);
  }
  for (const e of events) ctx.out(`  ${time(e.at)}  ${e.kind}  ${e.outcome ?? ''}`.trimEnd());
  return EXIT.ok;
}

export async function cmdStatus(ctx: CliContext): Promise<ExitCode> {
  const [grant, pending, owner] = await Promise.all([
    getActiveRdpGrant(ctx.admin, ctx.now()),
    countPendingRdpRequests(ctx.admin),
    resolveOwner(ctx.admin),
  ]);
  if (grant) {
    const names = await nameMap(ctx.admin, [grant.user_id]);
    ctx.out(
      `גישה פעילה: ${(grant.user_id && names.get(grant.user_id)) || '?'}  עד ${time(grant.expires_at)}  קבצים ${grant.files_issued}/${grant.max_files}  (${short(grant.id)})`,
    );
  } else {
    ctx.out(CLI_TEXT.noActiveGrant);
  }
  ctx.out(`בקשות ממתינות: ${pending}`);
  const config = ctx.api.getConfig(ctx.env);
  ctx.out(
    config.ok
      ? 'השער: מוגדר'
      : `${CLI_TEXT.gatewayNotConfigured} ${config.problems.map((p) => `${p.variable} (${p.reason})`).join(', ')}`,
  );
  ctx.out(
    owner.ok
      ? 'בעלים: נמצא אחד'
      : owner.reason === 'ambiguous'
        ? `בעלים: ${owner.ownerIds.length}, יש לציין --as`
        : CLI_TEXT.noOwner,
  );
  return EXIT.ok;
}

// ── decisions ────────────────────────────────────────────────────────────────

export async function cmdApprove(
  ctx: CliContext,
  opts: { id: string; minutes?: number; note: string; as?: string; yes: boolean },
): Promise<ExitCode> {
  // Without --minutes the owner grants what the requester asked for.
  if (opts.minutes !== undefined && (!Number.isInteger(opts.minutes) || opts.minutes < RDP_MINUTES_MIN || opts.minutes > RDP_MINUTES_MAX)) {
    ctx.err(OUTCOME_TEXT.invalid_minutes ?? CLI_TEXT.unexpected);
    return EXIT.error;
  }
  const picked = await pickRequest(ctx, opts.id);
  if (!picked.ok) return picked.code;

  const detail = await getRdpRequestDetail(ctx.admin, picked.id);
  if (!detail) {
    ctx.err(CLI_TEXT.notFound);
    return EXIT.noop;
  }
  if (detail.request.status !== 'pending') {
    ctx.err(CLI_TEXT.notPending);
    return EXIT.noop;
  }
  if (Date.parse(detail.request.expires_at) <= ctx.now().getTime()) {
    ctx.err(CLI_TEXT.expired);
    return EXIT.noop;
  }

  // The grant target is decided HERE, from server configuration, never by the requester.
  const config = ctx.api.getConfig(ctx.env);
  if (!config.ok) {
    ctx.err(`${CLI_TEXT.gatewayNotConfigured} ${config.problems.map((p) => `${p.variable} (${p.reason})`).join(', ')}`);
    return EXIT.error;
  }

  const owner = await requireOwner(ctx, opts.as);
  if (!owner.ok) return EXIT.error;

  const minutes = opts.minutes ?? detail.request.requested_minutes;
  const names = await nameMap(ctx.admin, [detail.request.requester_id]);
  const who = (detail.request.requester_id && names.get(detail.request.requester_id)) || '?';
  ctx.out(`${short(detail.request.id)}  ${who}  ${detail.request.requested_minutes}ד׳ מבוקשות, ${minutes}ד׳ יאושרו`);
  ctx.out(`מטרה: ${detail.request.reason}`);
  if (!opts.yes && !(await ctx.confirm(CLI_TEXT.confirmApprove))) {
    ctx.err(CLI_TEXT.declined);
    return EXIT.noop;
  }

  // No grant can be active here (the one-active-grant lock), so any tunnel still open at the gateway is a stale
  // one from an earlier grant. Clear them BEFORE the new grant exists, otherwise the previous holder could stay
  // connected into the new grant. A gateway that is not running has no tunnels, so 'unreachable' is fine.
  const cleared = await ctx.api.disconnect(config.config, { user: config.config.gatewayUser });
  if (!cleared.ok && cleared.kind !== 'unreachable') {
    ctx.err(`${CLI_TEXT.staleTunnelsNotCleared} ${cleared.kind}`);
    return EXIT.error;
  }

  const result = await ctx.api.answer(ctx.admin, {
    requestId: detail.request.id,
    actorId: owner.ownerId,
    verdict: 'approved',
    minutes,
    target: config.config.target,
    note: opts.note,
    context: approverContext(ctx),
  });

  if (result.outcome === 'approved' && result.grantId && result.expiresAt) {
    ctx.out(`${CLI_TEXT.approved}: עד ${time(result.expiresAt)}  (${short(result.grantId)})`);
    await ctx.api.notify({
      kind: 'approved',
      id: detail.request.id,
      minutes,
      selfApproved: detail.request.requester_id === owner.ownerId,
    });
    return EXIT.ok;
  }
  return reportRefusal(ctx, result.outcome, result.conflictingGrantId);
}

export async function cmdDeny(
  ctx: CliContext,
  opts: { id: string; note: string; as?: string; yes: boolean },
): Promise<ExitCode> {
  const picked = await pickRequest(ctx, opts.id);
  if (!picked.ok) return picked.code;
  const owner = await requireOwner(ctx, opts.as);
  if (!owner.ok) return EXIT.error;
  if (!opts.yes && !(await ctx.confirm(CLI_TEXT.confirmDeny))) {
    ctx.err(CLI_TEXT.declined);
    return EXIT.noop;
  }
  const result = await ctx.api.answer(ctx.admin, {
    requestId: picked.id,
    actorId: owner.ownerId,
    verdict: 'denied',
    note: opts.note,
    context: approverContext(ctx),
  });
  if (result.outcome === 'denied') {
    ctx.out(`${CLI_TEXT.denied}  (${short(picked.id)})`);
    await ctx.api.notify({ kind: 'denied', id: picked.id });
    return EXIT.ok;
  }
  return reportRefusal(ctx, result.outcome, result.conflictingGrantId);
}

export async function cmdRevoke(
  ctx: CliContext,
  opts: { grantId?: string; reason: string; as?: string; yes: boolean },
): Promise<ExitCode> {
  const owner = await requireOwner(ctx, opts.as);
  if (!owner.ok) return EXIT.error;
  const active = await getActiveRdpGrant(ctx.admin, ctx.now());
  if (!active && !opts.grantId) {
    ctx.err(CLI_TEXT.noActiveGrant);
    return EXIT.noop;
  }
  if (!opts.yes && !(await ctx.confirm(CLI_TEXT.confirmRevoke))) {
    ctx.err(CLI_TEXT.declined);
    return EXIT.noop;
  }

  // 1. the database first: from this commit on no new tunnel can open and the check refuses every connection.
  const ended = await ctx.api.endGrant(ctx.admin, {
    actorId: owner.ownerId,
    grantId: opts.grantId ?? active?.id,
    reason: opts.reason,
  });
  if (ended.outcome !== 'revoked' || !ended.grantId) {
    return reportRefusal(ctx, ended.outcome, null);
  }

  // 2. then cut the live tunnels, and say plainly if that could not be confirmed. A partial failure is never hidden.
  const config = ctx.api.getConfig(ctx.env);
  let cut = false;
  if (config.ok) {
    const result = await ctx.api.disconnect(config.config, { user: config.config.gatewayUser });
    await ctx.api.markCut(ctx.admin, {
      grantId: ended.grantId,
      ok: result.ok,
      errorCode: result.ok ? 'ok' : result.kind,
    });
    cut = result.ok;
  } else {
    ctx.err(`${CLI_TEXT.gatewayNotConfigured} ${config.problems.map((p) => p.variable).join(', ')}`);
  }

  ctx.out(`${CLI_TEXT.revoked}  (${short(ended.grantId)})`);
  ctx.out(cut ? CLI_TEXT.tunnelsCut : CLI_TEXT.tunnelsNotCut);
  await ctx.api.notify({ kind: 'revoked', id: ended.grantId, tunnelsCut: cut });
  return cut ? EXIT.ok : EXIT.error;
}

function reportRefusal(ctx: CliContext, outcome: string, conflictingGrantId: string | null): ExitCode {
  switch (outcome) {
    case 'not_found':
      ctx.err(CLI_TEXT.notFound);
      return EXIT.noop;
    case 'not_pending':
      ctx.err(CLI_TEXT.notPending);
      return EXIT.noop;
    case 'expired':
      ctx.err(CLI_TEXT.expired);
      return EXIT.noop;
    case 'no_active_grant':
      ctx.err(CLI_TEXT.noActiveGrant);
      return EXIT.noop;
    case 'grant_conflict':
      ctx.err(`${CLI_TEXT.grantConflict} ${conflictingGrantId ? short(conflictingGrantId) : '?'}`);
      return EXIT.noop;
    default:
      ctx.err(`${CLI_TEXT.notAllowed} ${OUTCOME_TEXT[outcome] ?? CLI_TEXT.unexpected}`);
      return EXIT.error;
  }
}
