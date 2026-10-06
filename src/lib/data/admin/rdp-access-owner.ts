import 'server-only';

import { requirePlatformOwner } from '@/lib/auth/dal';
import {
  countPendingRdpRequests,
  getActiveRdpGrant,
  getRdpRequestDetail,
  getRdpRequestOwnerExtras,
  listRdpRequestsPage,
  nameMap,
  type RdpOwnerListFilter,
} from '@/lib/rdp-access/queries';
import { deriveRdpDisplayStatus, type RdpDisplayStatus } from '@/lib/rdp-access/status';
import { createAdminClient } from '@/lib/supabase/admin';

// The owner's READ-ONLY screens for the remote-desktop approval flow (/admin/rdp-access/requests). There is no
// write here by construction: approving, denying and revoking happen in the server terminal (npm run rdp:access),
// where the approver identity is the person at the keyboard of the server.
//
// OWNER-ONLY, with no permission key: every export gates on requirePlatformOwner() first. It is a separate module
// from the staff one (rdp-access.ts) so the coverage test can pin each file to exactly one authority.
//
// The service role bypasses RLS, so what leaves this file is decided here: field-by-field views, display names
// resolved here and nowhere else, no gateway secret, no approver context, no raw event detail.

export type { RdpOwnerListFilter };

export const RDP_OWNER_PAGE_SIZE = 25;

export type RdpOwnerListItem = {
  id: string;
  createdAt: string;
  requesterName: string | null;
  reason: string;
  requestedMinutes: number;
  grantedMinutes: number | null;
  status: RdpDisplayStatus;
  filesIssued: number;
  maxFiles: number | null;
};

export type RdpOwnerOverview = {
  pendingCount: number;
  active: { requesterName: string | null; expiresAt: string; filesIssued: number; maxFiles: number } | null;
  serverNow: string;
};

export type RdpOwnerEvent = { at: string; kind: string; actorKind: string; outcome: string | null };

export type RdpOwnerDetail = {
  id: string;
  status: RdpDisplayStatus;
  requesterName: string | null;
  reason: string;
  requestIp: string | null;
  requestedMinutes: number;
  grantedMinutes: number | null;
  createdAt: string;
  expiresAt: string;
  answeredAt: string | null;
  answerNote: string | null;
  grant: {
    target: string;
    startsAt: string;
    expiresAt: string;
    endedAt: string | null;
    endedReason: string | null;
    filesIssued: number;
    maxFiles: number;
    /** The live tunnels were confirmed cut (two successful disconnects). Null while that is unconfirmed. */
    tunnelsCutAt: string | null;
    cutAttempts: number;
  } | null;
  events: RdpOwnerEvent[];
};

export async function getRdpAccessOverview(): Promise<RdpOwnerOverview> {
  await requirePlatformOwner();
  const admin = createAdminClient();
  const now = new Date();

  const [pendingCount, grant] = await Promise.all([countPendingRdpRequests(admin), getActiveRdpGrant(admin, now)]);

  let active: RdpOwnerOverview['active'] = null;
  if (grant) {
    const request = await listRdpRequestsPage(admin, { filter: 'active', page: 1, pageSize: 1, now });
    const names = await nameMap(admin, request.rows.map((r) => r.requester_id));
    const requesterId = request.rows[0]?.requester_id ?? null;
    active = {
      requesterName: requesterId ? (names.get(requesterId) ?? null) : null,
      expiresAt: grant.expires_at,
      filesIssued: grant.files_issued,
      maxFiles: grant.max_files,
    };
  }
  return { pendingCount, active, serverNow: now.toISOString() };
}

export async function listRdpAccessRequests(input: {
  filter: RdpOwnerListFilter;
  page: number;
}): Promise<{ items: RdpOwnerListItem[]; total: number; pageSize: number }> {
  await requirePlatformOwner();
  const admin = createAdminClient();
  const now = new Date();

  const { rows, total } = await listRdpRequestsPage(admin, {
    filter: input.filter,
    page: input.page,
    pageSize: RDP_OWNER_PAGE_SIZE,
    now,
  });
  const names = await nameMap(admin, rows.map((r) => r.requester_id));

  const items = rows.map((r): RdpOwnerListItem => ({
    id: r.id,
    createdAt: r.created_at,
    requesterName: r.requester_id ? (names.get(r.requester_id) ?? null) : null,
    reason: r.reason,
    requestedMinutes: r.requested_minutes,
    grantedMinutes: r.granted_minutes,
    status: deriveRdpDisplayStatus(r.status, r.grant, now),
    filesIssued: r.grant?.files_issued ?? 0,
    maxFiles: r.grant?.max_files ?? null,
  }));
  return { items, total, pageSize: RDP_OWNER_PAGE_SIZE };
}

export async function getRdpAccessRequestDetail(requestId: string): Promise<RdpOwnerDetail | null> {
  await requirePlatformOwner();
  const admin = createAdminClient();
  const now = new Date();

  const detail = await getRdpRequestDetail(admin, requestId);
  if (!detail) return null;
  const { request, grant, events } = detail;

  const [extras, names] = await Promise.all([
    getRdpRequestOwnerExtras(admin, request.id),
    nameMap(admin, [request.requester_id]),
  ]);

  return {
    id: request.id,
    status: deriveRdpDisplayStatus(request.status, grant, now),
    requesterName: request.requester_id ? (names.get(request.requester_id) ?? null) : null,
    reason: request.reason,
    requestIp: extras.requestIp,
    requestedMinutes: request.requested_minutes,
    grantedMinutes: request.granted_minutes,
    createdAt: request.created_at,
    expiresAt: request.expires_at,
    answeredAt: request.answered_at,
    answerNote: extras.answerNote,
    grant: grant
      ? {
          target: grant.target,
          startsAt: grant.starts_at,
          expiresAt: grant.expires_at,
          endedAt: grant.ended_at,
          endedReason: grant.ended_reason,
          filesIssued: grant.files_issued,
          maxFiles: grant.max_files,
          tunnelsCutAt: grant.tunnels_cut_at,
          cutAttempts: grant.cut_attempts,
        }
      : null,
    events: events.map((e) => ({ at: e.at, kind: e.kind, actorKind: e.actor_kind, outcome: e.outcome })),
  };
}
