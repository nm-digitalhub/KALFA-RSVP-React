import { getUser, hasPlatformPermission } from '@/lib/auth/dal';
import { issueMyRdpFile, type RdpFileIssueFailure } from '@/lib/data/admin/rdp-access';
import { rdpClientIp } from '@/lib/rdp-access/client-ip';
import { rateLimit } from '@/lib/security/rate-limit';
import { getAppOrigin } from '@/lib/url';

// Issues ONE short-lived connection (.rdp) file for the caller's live remote-desktop grant.
//
// POST only, and no request body: the grant is derived on the server from the signed-in user, so no identifier ever
// comes from the browser. POST (not GET) because a call reserves a download and mints a token; a top-level GET
// navigation carries the session cookie on a cross-site link and must not be able to spend a staff member's quota.
//
// Route Handlers do not get the automatic Origin/Host check that Server Actions get (docs/01-app/02-guides/data-security),
// so it is done here: the request must come from our own origin, and a missing Origin is refused.
//
// Every failure is a fixed code with no detail: no database message, no gateway answer, no token. The success body
// is the file itself and is never stored or logged.

const NO_STORE = { 'Cache-Control': 'private, no-store' } as const;

// Per-process first line of defence only (the durable limits are in the database: the per-grant cap and the minimum
// gap between two downloads). It keeps a stuck client loop from reaching the database at all.
const PER_USER_LIMIT = { limit: 3, windowMs: 60_000 } as const;

type ErrorCode =
  | 'forbidden'
  | 'unauthorized'
  | 'rate_limited'
  | 'server_error'
  | RdpFileIssueFailure;

const STATUS_BY_CODE: Record<ErrorCode, number> = {
  unauthorized: 401,
  forbidden: 403,
  not_allowed: 403,
  no_active_grant: 409,
  file_limit: 429,
  too_soon: 429,
  rate_limited: 429,
  no_client_ip: 400,
  gateway_unavailable: 502,
  server_error: 500,
};

function failure(code: ErrorCode): Response {
  return Response.json({ error: code }, { status: STATUS_BY_CODE[code], headers: NO_STORE });
}

export async function POST(request: Request): Promise<Response> {
  let appOrigin: string;
  try {
    appOrigin = await getAppOrigin();
  } catch {
    console.error('rdp-access: the file route could not resolve the app origin');
    return failure('server_error');
  }
  if (request.headers.get('origin') !== appOrigin) return failure('forbidden');

  const user = await getUser();
  if (!user) return failure('unauthorized');
  if (!(await hasPlatformPermission('rdp.request'))) return failure('forbidden');

  if (!rateLimit(`rdp-file:${user.id}`, PER_USER_LIMIT).allowed) return failure('rate_limited');

  let issued: Awaited<ReturnType<typeof issueMyRdpFile>>;
  try {
    issued = await issueMyRdpFile(rdpClientIp((name) => request.headers.get(name)));
  } catch {
    console.error('rdp-access: issuing the connection file failed');
    return failure('server_error');
  }
  if (!issued.ok) return failure(issued.reason);

  return new Response(issued.content, {
    status: 200,
    headers: {
      ...NO_STORE,
      'Content-Type': 'application/x-rdp',
      'Content-Disposition': 'attachment; filename="kalfa-desktop.rdp"',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}
