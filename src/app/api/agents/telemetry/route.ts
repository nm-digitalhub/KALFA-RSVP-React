import { NextResponse } from 'next/server';

import { requireConsoleAgent } from '@/lib/auth/console-agent';
import {
  appendTelemetryLines,
  isDeviceTelemetryEnabled,
  renderTelemetryLine,
} from '@/lib/ops/device-telemetry';
import { rateLimit } from '@/lib/security/rate-limit';
import { deviceTelemetryBatchSchema } from '@/lib/validation/agent-console';

// POST /api/agents/telemetry   { "events": [ … ] }
//
// The native agent console streams the steps of its own call path here so the
// owner can `tail -f` the resulting log over SSH and watch what the phone
// actually does while it rings. See `src/lib/ops/device-telemetry.ts` for why a
// file rather than a table, and `src/lib/validation/agent-console.ts` for the
// no-PII contract this enforces.
//
// Auth = requireConsoleAgent (Bearer Supabase-JWT + the staff-gated
// is_console_agent), the same gate as /api/agents/status and /api/agents/shift.
// An unauthenticated write endpoint on a production host is not acceptable even
// for a diagnostic, and especially for one whose job is to append to a file.
//
// Rate-limited per AGENT rather than per IP: the caller is authenticated, a
// device on cellular changes IP freely, and the abuse case being defended
// against is one device in a retry loop rather than a stranger. NOTE the limiter
// is per-process (documented at the top of security/rate-limit.ts), so under pm2
// cluster mode the effective cap is multiplied by the worker count — the ceiling
// below is chosen with that already discounted.
//
// Feature-flagged OFF by default. While DEVICE_TELEMETRY_ENABLED is unset this
// answers 503, which the app treats as "stop trying for a while" rather than as
// an error worth retrying.

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MAX_BODY_BYTES = 64 * 1024;
const NO_STORE = { 'Cache-Control': 'no-store' } as const;

// 40 requests/minute × 50 events each is a hard ceiling of 2,000 lines a minute
// from one agent — comfortably above a real call attempt (~30 events) and far
// below anything that could trouble a disk, given the 32 MB rotation.
const RATE = { limit: 40, windowMs: 60_000 } as const;

function json(body: unknown, status: number) {
  return NextResponse.json(body, { status, headers: NO_STORE });
}

export async function POST(request: Request) {
  // Authorize BEFORE checking the feature flag: an anonymous caller must not be
  // able to probe whether a diagnostic channel is open on this host.
  const auth = await requireConsoleAgent(request);
  if (!auth.ok) return json({ error: auth.error }, auth.status);
  const { ctx } = auth;

  if (!isDeviceTelemetryEnabled()) {
    return json({ error: 'ערוץ האבחון כבוי' }, 503);
  }

  const gate = rateLimit(`agent-telemetry:${ctx.userId}`, RATE);
  if (!gate.allowed) {
    return json({ error: 'יותר מדי בקשות — נסו שוב בעוד רגע' }, 429);
  }

  const raw = await request.text();
  if (raw.length > MAX_BODY_BYTES) return json({ error: 'בקשה גדולה מדי' }, 413);

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return json({ error: 'גוף הבקשה אינו תקין' }, 400);
  }

  const result = deviceTelemetryBatchSchema.safeParse(parsed);
  // Generic and silent on purpose. A validation failure here is most likely a
  // value the PII guard rejected, and echoing the offending value back — or
  // logging it — would defeat the guard entirely.
  if (!result.success) return json({ error: 'בקשה לא תקינה' }, 400);

  const receivedAtIso = new Date().toISOString();
  const lines = result.data.events.map((event) =>
    renderTelemetryLine(event, ctx.userId, receivedAtIso),
  );

  const write = await appendTelemetryLines(lines);
  if (!write.ok) {
    // 'disabled' is unreachable (checked above) but is handled rather than
    // asserted away; 'io' is a server-side problem the device can do nothing
    // about, and it still holds every line in its own local file.
    return json({ error: 'רישום האבחון נכשל' }, write.reason === 'disabled' ? 503 : 500);
  }

  return json({ ok: true, written: write.written }, 202);
}
