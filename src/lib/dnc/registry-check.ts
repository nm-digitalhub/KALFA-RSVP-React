import 'server-only';

import { z } from 'zod';

import { isDncListed } from '@/lib/data/outreach-engine';
import { normalizePhone } from '@/lib/phone';

import { verifyPhoneList } from './generated/api';
import { DncError, type DncFailureKind } from './mutator';

// The ONE decision about a number against the Do-Not-Call lists, shared by every dial gate and the admin screen
// (openspec/changes/dnc-registry-dial-gate, design D3/D4). It answers "may this number receive a marketing call", and
// never decides whether the call IS marketing — that is the caller's policy (DIAL_GATE_POLICY.nationalRegistry).
//
// Two lists, kept apart on purpose:
//   - the local list (call_dnc_list): people who asked KALFA itself never to be called. Checked first; a hit never
//     reaches the registry.
//   - the national registry ("אל תתקשר אליי"): Consumer Protection Law 16ג. Its answer lists the numbers that are NOT
//     registered (Regulation 3(ה)); a number is "listed" only when it is absent from an answer that passed validation
//     in full. Anything short of that — an HTTP error, a timeout, a body of the wrong shape — is "unavailable", and is
//     never turned into a block, nor written to the local list.

export type RegistryResult =
  | 'local_blocked'
  | 'registry_listed'
  | 'registry_clear'
  /** The service answered, but refused this number (its errorCode). Does not authorize a dial. */
  | 'registry_unchecked'
  /** The check could not be completed. The dial waits; it is never treated as a block. */
  | 'registry_unavailable'
  /** Not an Israeli number: the Israeli registry does not cover it. */
  | 'not_covered';

export type RegistrySource = 'local_list' | 'national_registry' | 'none';

export type RegistryCheck = {
  result: RegistryResult;
  source: RegistrySource;
  /** Server time of the decision, ISO. */
  checkedAt: string;
  /** The service's transaction id, when it returned one — what the authority's support asks for. */
  transactionId: string | null;
  /** The service's errorCode for this number (registry_unchecked), or its HTTP status (registry_unavailable). */
  errorCode: number | null;
  /** Why the check was unavailable. Fixed values, no personal data. */
  failure: DncFailureKind | 'bad_answer' | null;
};

// The 200 answer, as measured 11.10.2026 (openapi/DNC-API/samples/). Validated here because the generated client
// returns the parsed body as an unchecked cast.
const answerSchema = z.object({
  statusCode: z.literal(200),
  message: z.string(),
  transactionId: z.uuid(),
  data: z.array(z.union([z.string(), z.object({ phone: z.string(), errorCode: z.number().int() })])),
});

const ISRAEL_PREFIX = '+972';

/**
 * The registry's request form for an E.164 number: digits only, without the country code and without the leading 0
 * (measured: a leading 0, 972, +972 or a dash all come back with errorCode 1). Null for a non-Israeli number.
 */
export function toRegistryDigits(phoneE164: string): string | null {
  if (!phoneE164.startsWith(ISRAEL_PREFIX)) return null;
  const digits = phoneE164.slice(ISRAEL_PREFIX.length);
  return /^[1-9][0-9]{7,8}$/.test(digits) ? digits : null;
}

function result(
  partial: Pick<RegistryCheck, 'result' | 'source'> & Partial<Omit<RegistryCheck, 'result' | 'source' | 'checkedAt'>>,
): RegistryCheck {
  return {
    transactionId: null,
    errorCode: null,
    failure: null,
    ...partial,
    checkedAt: new Date().toISOString(),
  };
}

/** Checks one number: the local list first, then the national registry. Never throws. */
export async function checkRegistry(rawPhone: string): Promise<RegistryCheck> {
  const phone = normalizePhone(rawPhone);
  if (!phone) return result({ result: 'registry_unavailable', source: 'none', failure: 'invalid_request' });

  if (await isDncListed(phone)) return result({ result: 'local_blocked', source: 'local_list' });

  const digits = toRegistryDigits(phone);
  if (digits === null) return result({ result: 'not_covered', source: 'none' });

  let raw: unknown;
  try {
    raw = await verifyPhoneList({ data: [digits] });
  } catch (e) {
    if (e instanceof DncError) {
      return result({
        result: 'registry_unavailable',
        source: 'national_registry',
        failure: e.kind,
        errorCode: e.httpStatus ?? null,
        transactionId: e.answer?.transactionId ?? null,
      });
    }
    return result({ result: 'registry_unavailable', source: 'national_registry', failure: 'unreachable' });
  }

  const parsed = answerSchema.safeParse(raw);
  if (!parsed.success) {
    return result({ result: 'registry_unavailable', source: 'national_registry', failure: 'bad_answer' });
  }
  const { transactionId, data } = parsed.data;

  const unchecked = data.find((item) => typeof item !== 'string' && item.phone === digits);
  if (unchecked && typeof unchecked !== 'string') {
    return result({
      result: 'registry_unchecked',
      source: 'national_registry',
      transactionId,
      errorCode: unchecked.errorCode,
    });
  }
  const clear = data.includes(`0${digits}`);
  return result({ result: clear ? 'registry_clear' : 'registry_listed', source: 'national_registry', transactionId });
}
