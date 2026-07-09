// Cross-domain configuration and constants — the single source of truth.
// Domains import from here; they must NOT redefine these values inline.
// Operationally-tunable values read from env with a safe default.

function intEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  const n = raw ? Number(raw) : NaN;
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

// --- Pagination (server-side) ---
export const getGuestsPageSize = (): number => intEnv('GUESTS_PAGE_SIZE', 25);
export const getAdminPageSize = (): number => intEnv('ADMIN_PAGE_SIZE', 25);

// --- Validation bounds ---
export const PROFILE_NAME_MAX = 100;
export const GUEST_NAME_MAX = 200;
export const NOTE_MAX = 1000;

// Israeli phone numbers. Tolerates spaces/hyphens; phone fields are OPTIONAL.
// VERIFIED against the official IL numbering plan (Wikipedia "Telephone numbers
// in Israel", ITU/MoC E.164 plan, 2026-06): full national numbers are 10 digits
// for mobile (05N + 7 subscriber) and VoIP (07N + 7 subscriber), and 9 digits
// for geographic landlines (single-digit area code 2/3/4/8/9, i.e. 02 Jerusalem,
// 03 Tel Aviv, 04 Haifa, 08 South, 09 Sharon, + 7 subscriber digits). The
// trunk leading 0 is interchangeable with international +972 / 972.
//   (?:\+?972[-\s]?|0) — +972 / 972 / leading 0
//   (?:5\d|7\d|[23489]) — mobile 5N / VoIP 7N / geographic area code
//   [-\s]?\d{3}[-\s]?\d{4} — 7 subscriber digits (3+4), optional separators
// Kept permissive on purpose (phone is optional throughout the product).
export const ISRAELI_PHONE_RE =
  /^(?:\+?972[-\s]?|0)(?:5\d|7\d|[23489])[-\s]?\d{3}[-\s]?\d{4}$/;

// --- CSV import bounds (guests) ---
export const CSV_MAX_ROWS = intEnv('CSV_MAX_ROWS', 2000);
export const CSV_MAX_BYTES = intEnv('CSV_MAX_BYTES', 1_000_000);

// Invitation image upload cap (bytes). Single source — the server action and
// storage module enforce it, and the edit form pre-checks it client-side so an
// oversized pick gets the friendly Hebrew error instead of the framework's
// generic 413 (serverActions.bodySizeLimit, 6mb, rejects before the action).
export const INVITE_IMAGE_MAX_BYTES = 5 * 1024 * 1024;

// --- Public RSVP abuse protection ---
export const RSVP_TOKEN_MIN_LENGTH = 16;
export const RSVP_READ_RATE = { limit: intEnv('RSVP_READ_LIMIT', 30), windowMs: 60_000 };
export const RSVP_SUBMIT_RATE = { limit: intEnv('RSVP_SUBMIT_LIMIT', 5), windowMs: 60_000 };

// The three RSVP states a guest may choose. Single source of truth, kept here
// (zod-free) so both the server Zod schema and the client form import it
// without pulling validation/zod into the browser bundle. Mirrors the
// submit_rsvp `_status` whitelist in the DB.
export const RSVP_STATUSES = ['attending', 'declined', 'maybe'] as const;
export type RsvpStatus = (typeof RSVP_STATUSES)[number];
