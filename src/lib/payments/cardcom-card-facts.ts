// What CardCom's GetLpResult says about the card and about the document it issued, reduced to what the ledger keeps
// (docs/superpowers/plans/2026-10-07-cardcom-pilot-plan.md, section 11, measured on the first run, 7.10.2026).
//
// What the payment row keeps about the card (an admin screen can show "Visa · CAL · ••••0008 · 12/2030"), plus the token and
// the holder-ID reference. Nothing here decides money, so none of it may get in the way of recording a payment CardCom has
// confirmed: every field is checked on its own and an unusable one
// becomes null, instead of failing the whole write (the ledger refuses an expiry outside 1–12 / 2024–2100, and a
// refused write on a confirmed payment would park it in review). Pure — no server-only, no database.
//
// The card token CardCom returns even for a plain charge is kept too (owner 8.10.2026: nothing it returns is dropped), in the
// same column SUMIT's token uses; it is never logged. The cardholder's ID goes to Vault (the existing payment_citizen_id_write
// mechanism) and only the id of that secret is kept on the row, like SUMIT's.

import { ISRAEL_TIME_ZONE } from '@/lib/date';
import { wallClockToDate } from '@/lib/data/event-date';

export type CardFacts = {
  last4: string | null;
  expMonth: number | null;
  expYear: number | null;
  brand: string | null;
  issuer: string | null;
  tokenRef: string | null;
  /** The id of the Vault secret holding the cardholder's ID: written by the caller, never the ID itself. */
  citizenSecretId: string | null;
};

export type CardcomCardInfo = {
  Last4CardDigitsString?: unknown;
  CardMonth?: unknown;
  CardYear?: unknown;
  Brand?: unknown;
  Issuer?: unknown;
  Token?: unknown;
};

const MAX_TEXT = 60;
// The ledger's own bounds (payment_operations_card_exp_month_check / _year_check).
const MIN_YEAR = 2024;
const MAX_YEAR = 2100;

function text(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed !== '' && trimmed.length <= MAX_TEXT ? trimmed : null;
}

function whole(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) ? value : null;
}

// CardCom reports the expiry year as two digits in TranzactionInfo ("30") and four in UIValues (2030); both are accepted.
function expiryYear(value: unknown): number | null {
  const year = whole(value);
  if (year === null) return null;
  const full = year >= 0 && year < 100 ? 2000 + year : year;
  return full >= MIN_YEAR && full <= MAX_YEAR ? full : null;
}

const MAX_TOKEN = 200;

function token(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed !== '' && trimmed.length <= MAX_TOKEN ? trimmed : null;
}

// The cardholder's ID as CardCom reports it (UIValues carries it with a trailing space). Text of a sane length; whether it is a
// valid Israeli ID is not this code's business — it is stored as given, in Vault.
export function holderIdFromCardcom(...candidates: unknown[]): string | null {
  for (const candidate of candidates) {
    if (typeof candidate !== 'string') continue;
    const id = candidate.trim();
    if (id !== '' && id.length <= 20) return id;
  }
  return null;
}

// CardCom's CreateDate has no zone ("2026-10-07T23:36:52"): it is Israel wall-clock time, resolved to the real instant.
export function occurredAtFromCardcom(createDate: unknown): string | null {
  if (typeof createDate !== 'string') return null;
  return wallClockToDate(createDate, ISRAEL_TIME_ZONE)?.toISOString() ?? null;
}

export function cardFactsFromCardcom(info: CardcomCardInfo | null | undefined, citizenSecretId: string | null = null): CardFacts | null {
  if (!info && citizenSecretId === null) return null;
  info ??= {};
  const last4 = typeof info.Last4CardDigitsString === 'string' && /^\d{4}$/.test(info.Last4CardDigitsString) ? info.Last4CardDigitsString : null;
  const month = whole(info.CardMonth);
  const facts: CardFacts = {
    last4,
    expMonth: month !== null && month >= 1 && month <= 12 ? month : null,
    expYear: expiryYear(info.CardYear),
    brand: text(info.Brand),
    issuer: text(info.Issuer),
    tokenRef: token(info.Token),
    citizenSecretId,
  };
  return Object.values(facts).every((v) => v === null) ? null : facts;
}

// The link to the document CardCom issued. CardCom's own documentation calls the field "currently not working", but the
// first real run returned a working link in TranzactionInfo.DocumentUrl (DocumentInfo.DocumentUrl came back null), so
// both are read, the first usable one wins. It carries an access code, so it is kept only when it is plainly CardCom's
// own https address — never a link some other body could have put there.
const DOCUMENT_HOST = 'secure.cardcom.solutions';
const MAX_URL = 2048;

export function documentUrlFromCardcom(...candidates: unknown[]): string | null {
  for (const candidate of candidates) {
    if (typeof candidate !== 'string') continue;
    const link = candidate.trim();
    if (link === '' || link.length > MAX_URL) continue;
    try {
      const url = new URL(link);
      if (url.protocol === 'https:' && url.hostname === DOCUMENT_HOST) return link;
    } catch {
      // not a URL: try the next one
    }
  }
  return null;
}
