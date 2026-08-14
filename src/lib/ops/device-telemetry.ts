import 'server-only';

import { appendFile, mkdir, rename, stat } from 'node:fs/promises';
import path from 'node:path';

import { deviceTelemetryLogPath, isDeviceTelemetryEnabled } from './device-telemetry-format';

// Server half of the live device-telemetry channel.
//
// WHY THIS EXISTS: the native agent console (KALFA-ELEVENLABS) runs on a phone
// nobody can attach a debugger to — no ADB, no USB, no Wi-Fi, cellular only. So
// every diagnosis of "the call was routed and the phone never rang" has had to be
// argued from source. This appends one line per observed step to a plain file the
// owner can `tail -f` over SSH while the phone rings, which turns that argument
// into a reading.
//
// It is a DIAGNOSTIC, not a product surface: off unless DEVICE_TELEMETRY_ENABLED
// is set, and the route answers 503 while it is off so the app backs off instead
// of retrying into a wall.
//
// PII: none, ever. The app scrubs before sending and
// `deviceTelemetryEventSchema` rejects rather than trusting it — this module is
// the third link and simply never receives a field that got past both. Assume
// the file is read by someone who should not see customer data, because that is
// precisely how it is meant to be read.
//
// The flag, the path and the line format live in `device-telemetry-format.ts`
// so they can be unit-tested; `server-only` throws under vitest.

export {
  deviceTelemetryLogPath,
  isDeviceTelemetryEnabled,
  renderTelemetryLine,
} from './device-telemetry-format';

/** One appended batch, and what the caller should be told about it. */
export type TelemetryWriteResult =
  | { ok: true; written: number }
  | { ok: false; reason: 'disabled' | 'io' };

const MAX_BYTES = 32 * 1024 * 1024;

/**
 * Append a whole batch in ONE write.
 *
 * One `appendFile` per batch rather than one per line, and that is a correctness
 * requirement rather than an optimisation: under pm2 several workers append to
 * the same file, and a single `O_APPEND` write stays interleave-safe where a
 * per-line loop can have another worker's line land in the middle of ours.
 *
 * Never throws. A telemetry write failing must not become a 500 the app then
 * retries against — the device holds the same lines in its own local file, so a
 * lost server-side line costs nothing that cannot be recovered by tapping "send
 * now" in the app.
 */
export async function appendTelemetryLines(lines: string[]): Promise<TelemetryWriteResult> {
  if (!isDeviceTelemetryEnabled()) return { ok: false, reason: 'disabled' };
  if (lines.length === 0) return { ok: true, written: 0 };

  const target = deviceTelemetryLogPath();
  try {
    await mkdir(path.dirname(target), { recursive: true });
    await rotateIfNeeded(target);
    await appendFile(target, `${lines.join('\n')}\n`, 'utf8');
    return { ok: true, written: lines.length };
  } catch {
    // Deliberately opaque: the caller returns a generic message and never
    // surfaces a filesystem path or errno to a client.
    return { ok: false, reason: 'io' };
  }
}

/**
 * Keep at most ~64 MB on disk (one live file plus one rotation). The route is
 * rate-limited per agent, so this is the second line of defence rather than the
 * first — but a device stuck in a retry loop must not be able to fill a
 * production disk even if the first line fails.
 */
async function rotateIfNeeded(target: string): Promise<void> {
  try {
    const info = await stat(target);
    if (info.size < MAX_BYTES) return;
    await rename(target, `${target}.1`);
  } catch {
    // No file yet, or a rename lost to another worker doing the same thing.
    // Either way the append below still succeeds.
  }
}
