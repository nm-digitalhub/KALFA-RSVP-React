// Policy numbers for the remote-desktop approval flow.
//
// Every value here mirrors a CHECK, default or literal in
// supabase/migrations/20261006164315_rdp_access_approval.sql so a value that passes the Zod schemas
// cannot be refused by the database with a constraint error the form has no field to attach to.
// rdp-access-policy.test.ts parses the migration and fails if either side drifts. Changing a ceiling
// is therefore a migration AND a change here, on purpose.

/** A pending request expires on its own after this long (`expires_at` default). */
export const RDP_REQUEST_TTL_MINUTES = 30;

/** Approved access length: DB CHECK is 5..240, and the grant window CHECK caps it at 240 as well. */
export const RDP_MINUTES_MIN = 5;
export const RDP_MINUTES_MAX = 240;
export const RDP_MINUTES_DEFAULT = 60;
/** What the staff form offers. All of them sit inside the DB range. */
export const RDP_MINUTES_PRESETS = [30, 60, 120, 240] as const;
export type RdpMinutesPreset = (typeof RDP_MINUTES_PRESETS)[number];

/** Free-text reason typed by the requester (`char_length(btrim(reason)) between 10 and 500`). */
export const RDP_REASON_MIN = 10;
export const RDP_REASON_MAX = 500;

/** Owner's optional note on an answer (`answer_note` CHECK). */
export const RDP_NOTE_MAX = 500;

/** Downloads per grant (`max_files` default) and the minimum gap between two downloads. */
export const RDP_MAX_FILES = 20;
export const RDP_FILE_MIN_INTERVAL_SECONDS = 10;

/** Requests one person may create per hour (durable limit inside rdp_request_access). */
export const RDP_REQUESTS_PER_HOUR = 6;

/** `host:port`. Decided by the server at approval time, never by the requester (`target` CHECK). */
export const RDP_TARGET_PATTERN = /^[A-Za-z0-9.-]{1,253}:[0-9]{1,5}$/;
/** The pattern allows five digits; the follow-up migration adds the real TCP range as a CHECK. */
export const RDP_PORT_MIN = 1;
export const RDP_PORT_MAX = 65_535;

/** `host:port` that is well formed AND whose port is a real TCP port (mirrors both CHECKs of the grants table). */
export function isValidRdpTarget(value: string): boolean {
  if (!RDP_TARGET_PATTERN.test(value)) return false;
  const port = Number(value.slice(value.lastIndexOf(':') + 1));
  return port >= RDP_PORT_MIN && port <= RDP_PORT_MAX;
}

/** Hard size caps for the two payloads the application parses from the gateway side. */
export const RDP_GATEWAY_CHECK_BODY_MAX_BYTES = 4096;
export const RDP_FILE_MAX_BYTES = 16_384;

/**
 * Disconnect bookkeeping. A grant counts as cut only after TWO successful gateway disconnects at least
 * this far apart (mirrors the 45 seconds inside rdp_mark_cut: it closes the check-allow -> revoke ->
 * connect window). The sweep stops retrying after CUT_MAX_ATTEMPTS or CUT_WINDOW_HOURS.
 */
export const RDP_CUT_RETRY_AFTER_SECONDS = 45;
export const RDP_CUT_MAX_ATTEMPTS = 40;
export const RDP_CUT_WINDOW_HOURS = 24;

/** The gateway check route must answer inside this budget or the gateway treats it as a refusal. */
export const RDP_GATEWAY_CHECK_TIMEOUT_MS = 2500;
