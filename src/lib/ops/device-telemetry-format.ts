import path from 'node:path';

import type { DeviceTelemetryEvent } from '@/lib/validation/agent-console';

// The pure half of the device-telemetry channel: the feature flag, the log path,
// and the line format. Split from `device-telemetry.ts` for one reason — that
// module carries `import 'server-only'`, which throws under vitest, and the line
// format IS the deliverable here (it is what the owner reads over SSH), so it has
// to be pinned by a test rather than reviewed by eye. Same
// separate-the-pure-part-so-it-can-be-tested shape as `getClientIp` in
// security/rate-limit.ts.
//
// Nothing here touches the filesystem; see `device-telemetry.ts` for that.

/**
 * Off by default. Set `DEVICE_TELEMETRY_ENABLED=1` (or `true`) in the server
 * environment to open the channel; unset it to close it again.
 *
 * An env flag rather than an `app_settings` row on purpose: it needs no
 * migration, no schema change, and no database round trip on a path that may be
 * hit dozens of times during a single call attempt.
 */
export function isDeviceTelemetryEnabled(): boolean {
  const raw = process.env.DEVICE_TELEMETRY_ENABLED;
  return raw === '1' || raw === 'true';
}

/**
 * Where the log lives. Override with `DEVICE_TELEMETRY_LOG_PATH` (absolute) if
 * the deployment wants it somewhere a non-deploy user can read.
 */
export function deviceTelemetryLogPath(): string {
  const override = process.env.DEVICE_TELEMETRY_LOG_PATH;
  if (override && path.isAbsolute(override)) return override;
  return path.join(process.cwd(), '.telemetry', 'device-telemetry.log');
}

/**
 * Render one event as the line that lands in the file.
 *
 * The event portion is byte-identical to what the device writes to its own local
 * file (`telemetry/TelemetryEvent.kt`, `formatTelemetryLine`) — a line read on
 * the phone and the same line read over SSH must not need translating between
 * them. Two server-side facts are appended, not prepended, so the front of every
 * line stays fixed-width and scannable:
 *
 *   `rx=` server receive time, so a device whose clock has drifted is visible
 *         rather than confusing (a dozing phone can resync NTP mid-wake).
 *   `ag=` the first 8 characters of the agent's user id — enough to tell two
 *         devices apart in a shared log, not enough to be an identifier.
 */
export function renderTelemetryLine(
  event: DeviceTelemetryEvent,
  agentId: string,
  receivedAtIso: string,
): string {
  const fields = event.fields ?? {};
  const rendered = Object.entries(fields)
    .map(([k, v]) => `${k}=${v}`)
    .join(' ');
  const head = `${event.at} sid=${event.sid} seq=${event.seq} ${event.name}`;
  const body = rendered ? `${head} ${rendered}` : head;
  return `${body} rx=${receivedAtIso} ag=${agentId.slice(0, 8)}`;
}
