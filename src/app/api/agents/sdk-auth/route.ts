import { requireConsoleAgent } from '@/lib/auth/console-agent';
import { signOneTimeKeyForAgent } from '@/lib/data/console-sdk-auth';
import { noStoreJson as json } from '@/lib/http/no-store-json';
import { readJsonBody } from '@/lib/http/read-json-body';
import { rateLimit } from '@/lib/security/rate-limit';
import { sdkOneTimeKeyBodySchema } from '@/lib/validation/sdk-one-time-key';

// POST /api/agents/sdk-auth   body: { one_time_key }  →  { hash }
//
// The server half of the Voximplant SDK one-time-key login. The app asks
// Voximplant for a key, posts it here, and logs in with the hash this returns.
// The agent's password is an input to that hash and never leaves the server —
// which is the entire reason this endpoint exists rather than the app signing
// for itself.
//
// NO platform permission beyond console-agent membership. Being able to log in
// as yourself IS the membership; gating it behind manage_voice would mean an
// agent could be enrolled and unable to connect at all.
//
// The username is NOT read from the body. It is resolved from the Bearer
// session, so an agent can only ever sign for their own identity.

const MAX_BODY_CHARS = 2_048;

// A signing request IS a login attempt. Bounded per agent so a stolen JWT
// cannot be used to grind keys, and low enough to be meaningless for a real
// client: an app that reconnects sanely signs a handful of times an hour.
const RATE = { limit: 10, windowMs: 60_000 } as const;

export async function POST(request: Request) {
  const auth = await requireConsoleAgent(request);
  if (!auth.ok) return json({ error: auth.error }, auth.status);

  const gate = await rateLimit(`sdk-auth:${auth.ctx.userId}`, RATE);
  if (!gate.allowed) {
    return json({ error: 'יותר מדי בקשות — נסו שוב בעוד רגע' }, 429);
  }

  const read = await readJsonBody(request, { maxSize: MAX_BODY_CHARS, measure: 'string-length' });
  if (!read.ok) return read.response;

  const result = sdkOneTimeKeyBodySchema.safeParse(read.value);
  // The message is deliberately generic — echoing why a key was rejected tells a
  // prober about the format.
  if (!result.success) return json({ error: 'מפתח חד-פעמי אינו תקין' }, 400);

  const signed = await signOneTimeKeyForAgent(
    auth.ctx.userId,
    result.data.one_time_key,
  );
  if (!signed.ok) {
    // 409, not 403: the agent is authorised, their SDK identity simply does not
    // exist yet. The app should stop retrying and show that state rather than
    // treat it as an auth failure.
    return json(
      { error: 'לא הוקצתה זהות למוקד עבור נציג זה' },
      409,
    );
  }

  // The hash and nothing else. Never the username, never the key, never the
  // password. The body is not logged anywhere on this path.
  return json({ hash: signed.hash }, 200);
}
