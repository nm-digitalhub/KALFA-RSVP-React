import 'server-only';

import { withAppSecretProof } from '../appsecret-proof';
import { GRAPH_API_VERSION } from '../graph-version';

// The server-to-server calls of Meta's Tech Provider onboarding
// (onboarding-customers-as-a-tech-provider.md) plus the Coexistence sync
// (onboarding-business-app-users.md). Meta: "Perform all of the requests
// described below using server-to-server requests."
//
// Errors carry the HTTP status and Meta's numeric code ONLY — never Meta's
// message (it echoes request parameters), never the token, the code or the app
// secret. The same rule subscriptions.ts and debug-token.ts follow.
//
// Every call made WITH the business token is signed with appsecret_proof
// (Meta's Login security checklist: "Sign all server-to-server Graph API calls
// with your App Secret"; formula measured in ../appsecret-proof.ts). The code
// exchange is not: it carries client_secret itself and no access token.

const BASE = `https://graph.facebook.com/${GRAPH_API_VERSION}`;
const TIMEOUT_MS = 15_000;

type GraphError = { error?: { code?: number } };

function failure(what: string, res: Response, body: GraphError): Error {
  const code = body.error?.code ? ` (code ${body.error.code})` : '';
  return new Error(`${what} failed: HTTP ${res.status}${code}`);
}

/**
 * Exchange the popup's code for the customer's business token.
 *
 * UNVERIFIED SHAPE: Meta's page shows the response only as `<BUSINESS_TOKEN>`.
 * This reads the standard Graph OAuth JSON (`access_token`). If the first live
 * run fails here with HTTP 200, the response shape is the first suspect.
 */
export async function exchangeCodeForBusinessToken(input: {
  appId: string;
  appSecret: string;
  code: string;
}): Promise<string> {
  const url = new URL(`${BASE}/oauth/access_token`);
  url.searchParams.set('client_id', input.appId);
  url.searchParams.set('client_secret', input.appSecret);
  url.searchParams.set('code', input.code);

  // The code lives 30 seconds; a slow Meta must not hold the action open.
  const res = await fetch(url.toString(), {
    cache: 'no-store',
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  const body = (await res.json().catch(() => ({}))) as GraphError & { access_token?: unknown };
  if (!res.ok || typeof body.access_token !== 'string' || body.access_token === '') {
    throw failure('token exchange', res, body);
  }
  return body.access_token;
}

/** Subscribe our app to webhooks on the customer's WABA. */
export async function subscribeAppToWaba(input: {
  wabaId: string;
  token: string;
  appSecret: string;
}): Promise<void> {
  const url = withAppSecretProof(
    `${BASE}/${encodeURIComponent(input.wabaId)}/subscribed_apps`,
    input.token,
    input.appSecret,
  );
  const res = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${input.token}` },
    cache: 'no-store',
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  const body = (await res.json().catch(() => ({}))) as GraphError & { success?: boolean };
  if (!res.ok || body.success !== true) throw failure('subscribed_apps', res, body);
}

/**
 * Whether the number serves both the WhatsApp Business app and Cloud API.
 * Meta: `is_on_biz_app: true` with `platform_type: CLOUD_API` means both.
 */
export async function getCoexistenceStatus(input: {
  phoneNumberId: string;
  token: string;
  appSecret: string;
}): Promise<{ isOnBizApp: boolean | null; platformType: string | null }> {
  const res = await fetch(
    withAppSecretProof(
      `${BASE}/${encodeURIComponent(input.phoneNumberId)}?fields=is_on_biz_app,platform_type`,
      input.token,
      input.appSecret,
    ),
    {
      headers: { Authorization: `Bearer ${input.token}` },
      cache: 'no-store',
      signal: AbortSignal.timeout(TIMEOUT_MS),
    },
  );
  const body = (await res.json().catch(() => ({}))) as GraphError & {
    is_on_biz_app?: unknown;
    platform_type?: unknown;
  };
  if (!res.ok) throw failure('phone status', res, body);
  return {
    isOnBizApp: typeof body.is_on_biz_app === 'boolean' ? body.is_on_biz_app : null,
    platformType: typeof body.platform_type === 'string' ? body.platform_type : null,
  };
}

/**
 * Start the contacts or message-history sync of a Coexistence number.
 *
 * ⚠️ ONE-SHOT: Meta allows each sync type exactly once per onboarding, within
 * 24 hours of it; repeating needs the customer to offboard and run the whole
 * flow again. Never retried here. The results arrive as `smb_app_state_sync` /
 * `history` webhooks, which must already be subscribed.
 */
export async function requestSmbSync(input: {
  phoneNumberId: string;
  token: string;
  appSecret: string;
  syncType: 'smb_app_state_sync' | 'history';
}): Promise<{ requestId: string }> {
  const url = withAppSecretProof(
    `${BASE}/${encodeURIComponent(input.phoneNumberId)}/smb_app_data`,
    input.token,
    input.appSecret,
  );
  const res = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${input.token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ messaging_product: 'whatsapp', sync_type: input.syncType }),
    cache: 'no-store',
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  const body = (await res.json().catch(() => ({}))) as GraphError & { request_id?: unknown };
  if (!res.ok || typeof body.request_id !== 'string') {
    throw failure(`smb_app_data ${input.syncType}`, res, body);
  }
  return { requestId: body.request_id };
}
