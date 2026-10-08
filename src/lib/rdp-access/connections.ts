import 'server-only';

import type { createAdminClient } from '@/lib/supabase/admin';

import type { RdpGatewayResult, RdpLiveTunnel } from './gateway-client';
import {
  listGatewayAllows,
  listGrantsByIds,
  listRdpRequestExtras,
  listRequestsByIds,
  listTunnelTraces,
  RdpQueryError,
  type RdpGrantSummary,
  type RdpRequestSummary,
  type RdpTunnelTrace,
} from './queries';

// The open connections of the remote-desktop gateway, each tied to the permission behind it.
//
// Three things are kept apart on purpose: a PERMISSION the owner approved (a grant), a CONNECTION the gateway holds
// open (a tunnel), and a desktop session on the server (not known to the app at all, so not shown). An approval alone
// never means anyone connected, and an open tunnel is not automatically covered by a live permission.
//
// The gateway's list is the only source that a connection is open. What ties a tunnel to a permission is the
// gateway's own allowed check, which the app logs with the tunnel id (`tunnel_ref`). The gateway account is shared and
// the owner may approve another grant any time, so nothing else (not the account, not the time, not the address, not
// "there is only one grant") can tell whose connection it is. An allowed check shows that the permission check passed;
// it does not prove the desktop came up.
//
// Two failures are kept apart from "none": the gateway not answering (the connections are UNKNOWN) and the database
// not answering while the gateway does (the connections are known, their permissions are not).

type AdminClient = ReturnType<typeof createAdminClient>;

/**
 * attributed: exactly one permission is on record for this tunnel.
 * none: the gateway lists it but no allowed check is on record (the record may simply not be there yet).
 * ambiguous: the records do not allow a decision (the tunnel is recorded under more than one permission, or under one
 *   that cannot be found).
 * unavailable: the lookup failed, so nothing is known.
 */
export type ConnectionAttribution = 'attributed' | 'none' | 'ambiguous' | 'unavailable';

/** The state of the permission a connection is attributed to. `unknown` is a status this code was not taught. */
export type PermissionState = 'active' | 'expired' | 'revoked' | 'ended' | 'unknown';

/** Where the disconnect of an ended permission stands. A confirmed cut needs two successful disconnects. */
export type CutState = 'not_needed' | 'not_attempted' | 'pending' | 'failed' | 'confirmed';

export type Connection = {
  tunnelId: string;
  /** The gateway account (shared by every connection). */
  gatewayUser: string;
  /** The address the connection came from, as the gateway reports it (not the address of the website request). */
  clientIp: string;
  target: string;
  connectedOn: string;
  attribution: ConnectionAttribution;
  grantId: string | null;
  requestId: string | null;
  permission: PermissionState | null;
  grantStartsAt: string | null;
  grantExpiresAt: string | null;
  grantEndedAt: string | null;
};

export type ConnectionDetail = Connection & {
  reason: string | null;
  requesterId: string | null;
  approverId: string | null;
  /** The address the access request was made from on the website. */
  requestIp: string | null;
  requestedMinutes: number | null;
  grantedMinutes: number | null;
  /** How many tunnels the gateway has allowed under this permission so far (a reconnect shows as more than one). */
  tunnelsOpened: number;
  /** Set only once a disconnect has really been tried (the grant row says so), never inferred. */
  cut: CutState | null;
  cutError: string | null;
  filesIssued: number | null;
  maxFiles: number | null;
};

export function permissionOf(grant: Pick<RdpGrantSummary, 'status' | 'expires_at'>, now: Date): PermissionState {
  switch (grant.status) {
    case 'active':
      // past its end but not yet marked: the database already refuses it, so it is not active
      return Date.parse(grant.expires_at) > now.getTime() ? 'active' : 'expired';
    case 'expired':
      return 'expired';
    case 'revoked':
      return 'revoked';
    case 'ended':
      return 'ended';
    default:
      return 'unknown';
  }
}

export function cutStateOf(grant: Pick<RdpGrantSummary, 'status' | 'tunnels_cut_at' | 'cut_attempts' | 'last_cut_error'>): CutState {
  if (grant.status === 'active') return 'not_needed';
  if (grant.tunnels_cut_at) return 'confirmed';
  if (grant.cut_attempts === 0) return 'not_attempted';
  return grant.last_cut_error && grant.last_cut_error !== 'ok' ? 'failed' : 'pending';
}

/**
 * Pure: one gateway tunnel and what the records say about it. `traces` is every allowed check recorded for the
 * tunnel (undefined or empty: none); `grant` is the row of the permission they point to.
 */
export function classifyConnection(
  tunnel: RdpLiveTunnel,
  traces: readonly Pick<RdpTunnelTrace, 'grantId' | 'requestId'>[] | undefined,
  grant: Pick<RdpGrantSummary, 'status' | 'expires_at' | 'starts_at' | 'ended_at'> | undefined,
  now: Date,
): Connection {
  const base = {
    tunnelId: tunnel.tunnelId,
    gatewayUser: tunnel.user,
    clientIp: tunnel.clientIp,
    target: tunnel.target,
    connectedOn: tunnel.connectedOn,
  };
  const empty = { grantId: null, requestId: null, permission: null, grantStartsAt: null, grantExpiresAt: null, grantEndedAt: null };

  if (!traces || traces.length === 0) return { ...base, attribution: 'none', ...empty };
  const grantIds = new Set(traces.map((t) => t.grantId));
  // recorded under several permissions, or under one that cannot be found: no decision is possible
  if (grantIds.size > 1 || !grant) return { ...base, attribution: 'ambiguous', ...empty };

  const first = traces[0]!;
  return {
    ...base,
    attribution: 'attributed',
    grantId: first.grantId,
    requestId: first.requestId,
    permission: permissionOf(grant, now),
    grantStartsAt: grant.starts_at,
    grantExpiresAt: grant.expires_at,
    grantEndedAt: grant.ended_at,
  };
}

const NO_DETAILS = {
  reason: null,
  requesterId: null,
  approverId: null,
  requestIp: null,
  requestedMinutes: null,
  grantedMinutes: null,
  tunnelsOpened: 0,
  cut: null,
  cutError: null,
  filesIssued: null,
  maxFiles: null,
} as const;

export type ConnectionsSnapshot =
  | { gateway: 'failed' }
  | {
      gateway: 'ok';
      /** `failed`: the database could not be read, so every connection's permission is unavailable (not "none"). */
      attribution: 'ok' | 'failed';
      connections: ConnectionDetail[];
    };

/**
 * The gateway's open connections with everything the owner needs to judge each one.
 *
 * The gateway failing is `{ gateway: 'failed' }`: the connections are unknown, which is not the same as none. The
 * database failing while the gateway answers still returns the connections, with `attribution: 'failed'`. Only a
 * database error is absorbed this way (RdpQueryError); anything else is a bug and propagates.
 */
export async function loadConnections(
  admin: AdminClient,
  listTunnels: () => Promise<RdpGatewayResult<{ tunnels: RdpLiveTunnel[] }>>,
  now: Date,
): Promise<ConnectionsSnapshot> {
  const live = await listTunnels();
  if (!live.ok) return { gateway: 'failed' };
  const tunnels = [...live.value.tunnels].sort((a, b) => Date.parse(a.connectedOn) - Date.parse(b.connectedOn));
  if (tunnels.length === 0) return { gateway: 'ok', attribution: 'ok', connections: [] };

  try {
    const traces = await listTunnelTraces(admin, tunnels.map((t) => t.tunnelId));
    const allTraces = [...traces.values()].flat();
    const grantIds = [...new Set(allTraces.map((t) => t.grantId))];
    const requestIds = [...new Set(allTraces.flatMap((t) => (t.requestId ? [t.requestId] : [])))];
    const [grants, requests, extras, allows] = await Promise.all([
      listGrantsByIds(admin, grantIds),
      listRequestsByIds(admin, requestIds),
      listRdpRequestExtras(admin, requestIds),
      listGatewayAllows(admin, grantIds),
    ]);

    const connections = tunnels.map((tunnel): ConnectionDetail => {
      const own = traces.get(tunnel.tunnelId);
      const grant = own?.[0] ? grants.get(own[0].grantId) : undefined;
      const connection = classifyConnection(tunnel, own, grant, now);
      if (connection.attribution !== 'attributed' || !grant) return { ...connection, ...NO_DETAILS };

      const request: RdpRequestSummary | undefined = connection.requestId ? requests.get(connection.requestId) : undefined;
      const requestExtras = connection.requestId ? extras.get(connection.requestId) : undefined;
      // the disconnect state is shown only once a disconnect was really tried
      const cut = cutStateOf(grant);
      return {
        ...connection,
        reason: request?.reason ?? null,
        requesterId: request?.requester_id ?? null,
        approverId: requestExtras?.answeredBy ?? null,
        requestIp: requestExtras?.requestIp ?? null,
        requestedMinutes: request?.requested_minutes ?? null,
        grantedMinutes: request?.granted_minutes ?? null,
        tunnelsOpened: allows.get(grant.id)?.length ?? 0,
        cut,
        cutError: grant.last_cut_error && grant.last_cut_error !== 'ok' ? grant.last_cut_error : null,
        filesIssued: grant.files_issued,
        maxFiles: grant.max_files,
      };
    });
    return { gateway: 'ok', attribution: 'ok', connections };
  } catch (error) {
    if (!(error instanceof RdpQueryError)) throw error;
    return {
      gateway: 'ok',
      attribution: 'failed',
      connections: tunnels.map((tunnel) => ({
        tunnelId: tunnel.tunnelId,
        gatewayUser: tunnel.user,
        clientIp: tunnel.clientIp,
        target: tunnel.target,
        connectedOn: tunnel.connectedOn,
        attribution: 'unavailable',
        grantId: null,
        requestId: null,
        permission: null,
        grantStartsAt: null,
        grantExpiresAt: null,
        grantEndedAt: null,
        ...NO_DETAILS,
      })),
    };
  }
}
