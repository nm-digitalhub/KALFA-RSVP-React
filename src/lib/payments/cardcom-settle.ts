import 'server-only';

import { z } from 'zod';

import { sendSlackAlert } from '@/lib/alerts/slack';
import { lowProfileGetLpResult } from '@/lib/cardcom/generated/low-profile/low-profile';
import { getCardcomServerConfig } from '@/lib/data/cardcom-config';
import { checkOsekPaturCeilingAfterCharge } from '@/lib/data/tax-ceiling';
import { createAdminClient } from '@/lib/supabase/admin';
import type { Json } from '@/lib/supabase/types';

import { saveCitizenId } from './card';
import { cardFactsFromCardcom, documentUrlFromCardcom, holderIdFromCardcom, occurredAtFromCardcom } from './cardcom-card-facts';
import { paymentFactsFromCardcom } from './cardcom-payment-facts';
import { checkTerminalEcho, terminalEchoFromCardcom, type TerminalEchoVerdict } from './cardcom-terminal-echo';
import { completeOperation, OperationStateError, type ProviderDocument } from './ledger';
import { labelTestMoney } from './test-money-label';

// The ONE thing that closes a CardCom payment (docs/superpowers/plans/2026-10-07-cardcom-pilot-plan.md, 4.4). Three
// callers end up here: CardCom's webhook, the buyer's own call after the form says "submitted", and the sweeper. They
// run in any order, at the same time, and must produce ONE outcome.
//
// What makes that true:
//   1. CardCom's GetLpResult is the only authority. The webhook body, the buyer's browser and the iframe's "HandleSubmit"
//      message are all just reasons to ask; none of them is believed. (CardCom's own guide says the same, and says not
//      to add any verification beyond this call.)
//   2. The ledger row leaves `pending` exactly once, by compare-and-set (completeOperation). A caller that loses the race
//      reads what the winner wrote and reports THAT — never an error, never a second effect.
//   3. A row that is already closed is answered from the ledger without asking CardCom again (CardCom's guide: mark that
//      the result was fetched, so a refreshed page or a crawler cannot fetch it twice).
//
// Everything it cannot be sure of ends in `review` (a person decides) or `error` (nothing changed, ask again later) —
// never in "paid" or "failed" by guess. No provider body is logged: ids only.
//
// THE TERMINAL (docs/superpowers/plans/2026-10-08-test-money-terminal-stamp-plan.md, section 2). A row is born stamped with the terminal
// its session was asked to open on (`provider_terminal`) and the database gives it its class (`is_test`: a no-money terminal) from
// that. Here:
//   - a session is only ever asked about on the terminal it was opened on. If the connection now points at another one, CardCom is
//     NOT asked (it would answer "no such payment" about money that may exist) and the row is NOT closed as failed: it goes to a
//     person;
//   - CardCom's own report of the terminal (`TerminalNumber`, top level of its answer) is kept on the row whenever it came, and a
//     payment whose report does not fit the stamp goes to a person instead of being counted (cardcom-terminal-echo.ts);
//   - the class of a row is read from the ROW, never derived from the connection's current terminal: a test payment gets no tax-ceiling
//     check and its alerts say so; a row with no stamp is real money.

// A session the buyer opened and never paid is closed after this long (and only when CardCom confirms there is no payment).
// CardCom does not document how long its page lives; this is a conservative guess to be replaced by a measurement (plan
// U3) — until then a longer wait only means a buyer who walked away waits longer to retry.
export const CARDCOM_ABANDON_AFTER_MINUTES = 60;

const ASK_TIMEOUT_MS = 5_000;
const ATTEMPTS = 2; // one retry, as CardCom's guide asks for a failed call
const CATEGORY = 'campaign_billing' as const;
const SOURCE = 'cardcom-settle';

// The fields this code reads. Anything else CardCom sends is ignored, and a body that does not have the result code is
// not an answer at all.
const lpResultSchema = z.object({
  ResponseCode: z.number(),
  Description: z.string().nullish(),
  Operation: z.string().nullish(),
  TranzactionId: z.number().nullish(),
  // The terminal CardCom says the payment went through, at the TOP level only (the real answer of 7.10.2026 has it there and not in
  // TranzactionInfo). Read as `unknown` on purpose, like the card facts: a shape CardCom changes here must not make a confirmed
  // payment unreadable. terminalEchoFromCardcom keeps it only when it is a positive whole number.
  TerminalNumber: z.unknown().optional(),
  // DocumentUrl and the card facts are display-only and read as `unknown` on purpose (cardcom-card-facts.ts checks each one):
  // a shape CardCom changes there must not make the whole answer unreadable, which would turn a confirmed payment into
  // "could not tell".
  DocumentInfo: z.object({ DocumentNumber: z.number().nullish(), DocumentType: z.union([z.string(), z.number()]).nullish(), DocumentUrl: z.unknown().optional() }).nullish(),
  UIValues: z.object({ CardOwnerIdentityNumber: z.unknown().optional(), CardOwnerName: z.unknown().optional(), CardOwnerEmail: z.unknown().optional(), CardOwnerPhone: z.unknown().optional() }).nullish(),
  TranzactionInfo: z
    .object({
      ApprovalNumber: z.string().nullish(),
      DocumentUrl: z.unknown().optional(),
      Last4CardDigitsString: z.unknown().optional(),
      CardMonth: z.unknown().optional(),
      CardYear: z.unknown().optional(),
      Brand: z.unknown().optional(),
      Issuer: z.unknown().optional(),
      Token: z.unknown().optional(),
      CardOwnerIdentityNumber: z.unknown().optional(),
      CreateDate: z.unknown().optional(),
      CardOwnerName: z.unknown().optional(),
      CardOwnerEmail: z.unknown().optional(),
      CardOwnerPhone: z.unknown().optional(),
      CardName: z.unknown().optional(),
      CardInfo: z.unknown().optional(),
      FirstCardDigits: z.unknown().optional(),
      IsAbroadCard: z.unknown().optional(),
      NumberOfPayments: z.unknown().optional(),
      CouponNumber: z.unknown().optional(),
      Uid: z.unknown().optional(),
      Rrn: z.unknown().optional(),
      Acquire: z.unknown().optional(),
      PaymentType: z.unknown().optional(),
      CardNumberEntryMode: z.unknown().optional(),
      DealType: z.unknown().optional(),
      AccountId: z.unknown().optional(),
      IssuerAuthCodeDescription: z.unknown().optional(),
    })
    .nullish(),
});
type LpResult = z.infer<typeof lpResultSchema>;

export type SettleOutcome =
  | { status: 'not_found' } // no session with this LowProfileId
  | { status: 'settled'; outcome: 'succeeded' | 'failed' | 'review'; alreadyDone: boolean }
  | { status: 'unpaid' } // CardCom has no payment (yet) and the caller asked not to close the row on that
  | { status: 'error' }; // could not ask, or could not read the answer: nothing was changed

export type SettleOptions = {
  /**
   * What a non-zero answer means. true (the webhook, the buyer's own call — both arrive AFTER a submit): the payment
   * failed, close the row. false (the sweeper, a retry — they arrive on a session that may simply not be paid YET):
   * leave the row pending and say "unpaid".
   */
  finalizeUnpaid?: boolean;
};

type AdminClient = ReturnType<typeof createAdminClient>;
type OperationRow = {
  id: string; campaign_id: string; event_id: string; outcome: string; amount: number | string; meta: Json;
  // The terminal the session was opened on (null = a row written before the stamp existed) and the class the database gave the row.
  provider_terminal: number | null;
  is_test: boolean;
};

// The alert of a session that cannot be asked about because the connection moved to another terminal.
const TERMINAL_CHANGED_TITLE = 'תשלום חבילה ב-CardCom נפתח במסוף שונה מזה שבחיבור הנוכחי — לא נשאל ולא נסגר, נדרשת בדיקה ידנית';
const TERMINAL_CHANGED_FAILED_TITLE = 'תשלום חבילה ב-CardCom שנסגר ככישלון נפתח במסוף שונה מזה שבחיבור הנוכחי — אי אפשר לוודא מכאן שלא נגבה כסף, יש לבדוק בלוח של CardCom';
// One title per reason: when CardCom reported NO terminal, "the reported terminal is not the one it was opened on" would say something false.
const ECHO_TITLES: Record<'echo_missing' | 'echo_differs', string> = {
  echo_missing: 'תשלום חבילה ב-CardCom שנפתח במסוף בדיקה לא דיווח על המסוף שלו — נדרשת בדיקה ידנית',
  echo_differs: 'תשלום חבילה ב-CardCom: המסוף שדווח אינו המסוף שבו נפתח התשלום — נדרשת בדיקה ידנית',
};
const ECHO_NOTES: Record<'echo_missing' | 'echo_differs', (opened: number, reported: number | null) => string> = {
  echo_missing: (opened) => `CardCom did not report the terminal of a payment opened on the test terminal (${opened}) — check in CardCom where it went, then resolve`,
  echo_differs: (opened, reported) => `CardCom reported terminal ${reported ?? 'none'} but the payment was opened on terminal ${opened} — check in CardCom where the money went, then resolve`,
};
const terminalChangedNote = (opened: number, now: number) =>
  `the payment session was opened on terminal ${opened} but the connection now uses terminal ${now}; CardCom was not asked and the row was not closed as failed — check the payment in CardCom, then resolve`;

const asMeta = (meta: Json): { [key: string]: Json | undefined } =>
  meta !== null && typeof meta === 'object' && !Array.isArray(meta) ? meta : {};

async function ask(terminalNumber: number, apiName: string, lowProfileId: string): Promise<LpResult | null> {
  for (let attempt = 0; attempt < ATTEMPTS; attempt += 1) {
    try {
      const raw = await lowProfileGetLpResult({ TerminalNumber: terminalNumber, ApiName: apiName, LowProfileId: lowProfileId }, { cardcom: { timeoutMs: ASK_TIMEOUT_MS } });
      const parsed = lpResultSchema.safeParse(raw);
      // An answer we cannot read is not retried: asking again returns the same thing.
      return parsed.success ? parsed.data : null;
    } catch {
      // The call failed (network, timeout, 5xx): this one is a read, so asking again is safe.
    }
  }
  return null;
}

// Asks CardCom once about a session whose row is already failed; if CardCom says it WAS paid, raises an alert. Best-effort:
// it never changes the ledger and never throws.
async function flagPaymentAfterFailure(operation: OperationRow, lowProfileId: string): Promise<void> {
  try {
    const config = await getCardcomServerConfig();
    if (!config) return;
    if (operation.provider_terminal !== null && operation.provider_terminal !== config.terminalNumber) {
      // Another terminal would answer "no payment" about a session it never saw, which proves nothing. The ledger cannot be touched
      // (the row is closed), so a person hears instead.
      void sendSlackAlert({
        level: 'error', category: CATEGORY, source: SOURCE,
        title: labelTestMoney(TERMINAL_CHANGED_FAILED_TITLE, operation.is_test),
        fields: { campaign_id: operation.campaign_id, event_id: operation.event_id, operation_id: operation.id, terminal_opened_on: operation.provider_terminal, terminal_now: config.terminalNumber },
      });
      return;
    }
    const result = await ask(config.terminalNumber, config.apiName, lowProfileId);
    if (!result || result.ResponseCode !== 0 || result.Operation !== 'ChargeOnly' || typeof result.TranzactionId !== 'number') return;
    void sendSlackAlert({
      level: 'error', category: CATEGORY, source: SOURCE,
      title: labelTestMoney('תשלום התקבל ב-CardCom אך הפעולה במערכת סגורה ככישלון — נדרשת התאמה ידנית', operation.is_test),
      fields: { campaign_id: operation.campaign_id, event_id: operation.event_id, operation_id: operation.id },
    });
  } catch {
    console.error('[cardcom-settle] could not check a failed row against CardCom', { operationId: operation.id });
  }
}

// The cardholder's ID goes to Vault (payment_citizen_id_write, the same mechanism SUMIT uses) and only the id of the secret
// is kept on the row. Best-effort: a failed write leaves the payment recorded without it, never failed. A secret written by a
// caller that then loses the race to close the row is an orphan: the same known cost as SUMIT's two-call write (card.ts).
async function keepHolderId(admin: AdminClient, campaignId: string, holderId: string | null): Promise<string | null> {
  if (holderId === null) return null;
  try {
    return await saveCitizenId(admin, campaignId, holderId);
  } catch {
    console.error('[cardcom-settle] could not keep the cardholder ID in Vault; the payment is recorded without it', { campaignId });
    return null;
  }
}

async function currentOutcome(admin: AdminClient, operationId: string): Promise<'succeeded' | 'failed' | 'review' | null> {
  const { data } = await admin.from('payment_operations').select('outcome').eq('id', operationId).maybeSingle();
  return data && (data.outcome === 'succeeded' || data.outcome === 'failed' || data.outcome === 'review') ? data.outcome : null;
}

export async function settleCardcomSession(lowProfileId: string, options: SettleOptions = {}): Promise<SettleOutcome> {
  const finalizeUnpaid = options.finalizeUnpaid ?? true;
  const admin = createAdminClient();

  const { data: session, error: sessionError } = await admin
    .from('cardcom_payment_sessions')
    .select('operation_id')
    .eq('low_profile_id', lowProfileId)
    .maybeSingle();
  if (sessionError) return { status: 'error' };
  if (!session) return { status: 'not_found' };

  const { data: row, error: rowError } = await admin
    .from('payment_operations')
    .select('id, campaign_id, event_id, outcome, amount, meta, provider_terminal, is_test')
    .eq('id', session.operation_id)
    .maybeSingle();
  if (rowError || !row) return { status: 'error' };
  // The stamp and the class are the DATABASE's (frozen when the row was born); nothing below derives either from the connection.
  const operation: OperationRow = {
    ...row,
    provider_terminal: typeof row.provider_terminal === 'number' ? row.provider_terminal : null,
    is_test: row.is_test === true,
  };

  if (operation.outcome !== 'pending') {
    const done = await currentOutcome(admin, operation.id);
    // A row closed as failed is the one case worth a second look: a payment may still land on its session (a bank that
    // answered late, a webhook posted before the buyer paid). The ledger cannot be rewritten, but a person must hear.
    if (done === 'failed') await flagPaymentAfterFailure(operation, lowProfileId);
    return done ? { status: 'settled', outcome: done, alreadyDone: true } : { status: 'error' };
  }

  const config = await getCardcomServerConfig();
  if (!config) {
    console.error('[cardcom-settle] the connection is not configured; nothing was asked', { operationId: operation.id });
    return { status: 'error' };
  }

  // The lock. A session is asked about on the terminal it was opened on and on no other: if the connection has moved, this is not a
  // question CardCom can answer, so it is not asked, and the row is not closed as failed - a person looks. (Even for a caller that
  // would only leave an unpaid row alone: here the row cannot be judged at all.)
  if (operation.provider_terminal !== null && operation.provider_terminal !== config.terminalNumber) {
    console.error('[cardcom-settle] the session was opened on another terminal than the connection uses; CardCom was not asked', { operationId: operation.id });
    return close(
      admin,
      operation,
      { outcome: 'review', note: terminalChangedNote(operation.provider_terminal, config.terminalNumber) },
      { reviewTitle: TERMINAL_CHANGED_TITLE, extraFields: { terminal_opened_on: operation.provider_terminal, terminal_now: config.terminalNumber } },
    );
  }

  const result = await ask(config.terminalNumber, config.apiName, lowProfileId);
  if (!result) {
    console.error('[cardcom-settle] could not get a usable answer from CardCom; the row was left as it is', { operationId: operation.id });
    return { status: 'error' };
  }

  // What CardCom says about the terminal, kept on the row whenever it came (success, failure or review): the proof of where the
  // payment went. Not a number we can use = not reported.
  const echo = terminalEchoFromCardcom(result.TerminalNumber);
  const echoColumn = echo === null ? {} : { providerTerminalEcho: echo };

  if (result.ResponseCode !== 0) {
    if (!finalizeUnpaid) return { status: 'unpaid' };
    return close(admin, operation, {
      outcome: 'failed',
      providerStatus: String(result.ResponseCode),
      // CardCom's own text: for an admin screen and the ledger, never for the buyer.
      providerStatusDescription: result.Description ?? null,
      ...echoColumn,
      note: 'declined or not completed at CardCom; nothing was charged',
    });
  }

  // The link is CardCom's, from TranzactionInfo (DocumentInfo's came back null on the first real run). Kept only when it is
  // plainly CardCom's own https address; it carries an access code, so it is never logged.
  const documentNumber = result.DocumentInfo?.DocumentNumber ?? null;
  const documentUrl = documentUrlFromCardcom(result.TranzactionInfo?.DocumentUrl, result.DocumentInfo?.DocumentUrl);
  const document: ProviderDocument | null = documentNumber === null && documentUrl === null ? null : { id: null, number: documentNumber, url: documentUrl };
  const references = {
    providerPaymentId: result.TranzactionId ?? null,
    providerAuthRef: result.TranzactionInfo?.ApprovalNumber ?? null,
    providerStatus: String(result.ResponseCode),
    providerStatusDescription: result.Description ?? null,
    providerDocument: document,
  };

  // CardCom's guide: success is ResponseCode 0 AND Operation ChargeOnly. A "success" that is anything else, or that
  // carries no transaction id, is not something to call paid and not something to call failed: a person looks.
  if (result.Operation !== 'ChargeOnly' || typeof result.TranzactionId !== 'number' || result.TranzactionId <= 0) {
    return close(admin, operation, { outcome: 'review', ...references, ...echoColumn, note: 'CardCom answered success, but not as a ChargeOnly charge with a transaction id — check in CardCom' });
  }

  const documentType = result.DocumentInfo?.DocumentType;
  const meta = { ...asMeta(operation.meta), ...(documentType == null ? {} : { cardcom_document_type: String(documentType) }) };

  // A confirmed payment whose terminal does not fit the stamp is not counted and not failed: a person finds where the money went.
  // The row keeps CardCom's references (and the document type a later refund needs) and what CardCom reported.
  const verdict: TerminalEchoVerdict = checkTerminalEcho({ stamp: operation.provider_terminal, echo, isTestTerminal: operation.is_test });
  if (verdict.verdict === 'review' && operation.provider_terminal !== null) {
    return close(
      admin,
      operation,
      { outcome: 'review', ...references, ...echoColumn, meta, note: ECHO_NOTES[verdict.reason](operation.provider_terminal, echo) },
      { reviewTitle: ECHO_TITLES[verdict.reason], extraFields: { terminal_opened_on: operation.provider_terminal, terminal_reported: echo ?? 'none' } },
    );
  }
  // What CardCom says about the card, its token, and when it happened. Not in `references`: those are what a parked review row
  // keeps, and none of this may be the reason a confirmed payment cannot be recorded (each field is checked on its own).
  const citizenSecretId = await keepHolderId(admin, operation.campaign_id, holderIdFromCardcom(result.TranzactionInfo?.CardOwnerIdentityNumber, result.UIValues?.CardOwnerIdentityNumber));
  const occurredAt = occurredAtFromCardcom(result.TranzactionInfo?.CreateDate);
  const closed = await close(
    admin,
    operation,
    {
      outcome: 'succeeded',
      ...references,
      cardFacts: cardFactsFromCardcom(result.TranzactionInfo, citizenSecretId),
      paymentFacts: paymentFactsFromCardcom(result.TranzactionInfo, result.UIValues),
      ...(occurredAt === null ? {} : { occurredAt }),
      ...echoColumn,
      meta,
    },
    { rescue: { ...references, ...echoColumn } },
  );
  if (closed.status === 'settled' && closed.outcome === 'succeeded' && !closed.alreadyDone) {
    await afterPaid(admin, operation, result.DocumentInfo?.DocumentNumber ?? null);
  }
  return closed;
}

type CloseDetails = Parameters<typeof completeOperation>[2] extends infer C ? Omit<Extract<C, { from: 'pending' }>, 'from'> : never;

type CloseOptions = {
  // CardCom's references (and what it reported) for the one case where a payment CardCom CONFIRMED could not be written as
  // succeeded: the row is parked in review WITH them, so whoever resolves it has them.
  rescue?: Partial<CloseDetails>;
  // The alert's title when the row goes to review for a reason the generic sentence does not describe, and the facts to put in it.
  reviewTitle?: string;
  extraFields?: Record<string, string | number>;
};

// Moves the row out of pending, once.
async function close(admin: AdminClient, operation: OperationRow, details: CloseDetails, options: CloseOptions = {}): Promise<SettleOutcome> {
  const { rescue, reviewTitle, extraFields = {} } = options;
  try {
    await completeOperation(admin, operation.id, { from: 'pending', ...details });
  } catch (err) {
    if (err instanceof OperationStateError) {
      // Someone else closed it first: report what they wrote.
      const done = await currentOutcome(admin, operation.id);
      return done ? { status: 'settled', outcome: done, alreadyDone: true } : { status: 'error' };
    }
    if (!rescue) {
      console.error('[cardcom-settle] could not close the payment row; the sweeper will ask again', { operationId: operation.id });
      return { status: 'error' };
    }
    console.error('[cardcom-settle] a CONFIRMED CardCom payment could not be recorded as succeeded — parking it in review', { operationId: operation.id });
    try {
      await completeOperation(admin, operation.id, { from: 'pending', outcome: 'review', ...rescue, note: 'CardCom confirmed the payment but it could not be recorded as succeeded — confirm in CardCom, then resolve' });
    } catch {
      console.error('[cardcom-settle] could not even park the row in review; the sweeper will ask again', { operationId: operation.id });
      return { status: 'error' };
    }
    void sendSlackAlert({
      level: 'error', category: CATEGORY, source: SOURCE,
      title: labelTestMoney('תשלום חבילה אושר ב-CardCom אך לא נשמר — נדרשת התאמה ידנית', operation.is_test),
      fields: { campaign_id: operation.campaign_id, event_id: operation.event_id, operation_id: operation.id },
    });
    return { status: 'settled', outcome: 'review', alreadyDone: false };
  }

  if (details.outcome === 'review') {
    void sendSlackAlert({
      level: 'error', category: CATEGORY, source: SOURCE,
      title: labelTestMoney(reviewTitle ?? 'תשלום חבילה ב-CardCom בבדיקה ידנית — התשובה אינה חד-משמעית', operation.is_test),
      fields: { campaign_id: operation.campaign_id, event_id: operation.event_id, operation_id: operation.id, ...extraFields },
    });
  } else if (details.outcome === 'failed') {
    // A decline on the test terminal is part of a test run, not a customer's trouble: information, not a warning.
    void sendSlackAlert({
      level: operation.is_test ? 'info' : 'warn', category: CATEGORY, source: SOURCE,
      title: labelTestMoney('רכישת חבילה נדחתה על ידי חברת האשראי', operation.is_test),
      fields: { campaign_id: operation.campaign_id, event_id: operation.event_id, operation_id: operation.id },
    });
  }
  return { status: 'settled', outcome: details.outcome, alreadyDone: false };
}

// Follow-ups of a payment that is already recorded: each best-effort, none may affect it. There is no signed-in user on
// the webhook path, so the activity row is a direct insert (the same as the orphan sweeper's).
async function afterPaid(admin: AdminClient, operation: OperationRow, documentNumber: number | null): Promise<void> {
  try {
    const { error } = await admin.from('activity_log').insert({
      event_id: operation.event_id,
      user_id: null,
      action: 'campaign.package_purchased',
      meta: { campaignId: operation.campaign_id, operationId: operation.id, amount: Number(operation.amount), documentNumber, provider: 'cardcom', ...(operation.is_test ? { testMoney: true } : {}) },
    });
    if (error) throw error;
  } catch {
    console.error('[cardcom-settle] activity log write failed (non-fatal)', { operationId: operation.id });
  }
  // The revenue just grew: re-check the year against the עוסק פטור ceiling. Never throws or rejects. A TEST payment moved no money
  // and is not in the revenue, so there is nothing to re-check.
  if (!operation.is_test) void checkOsekPaturCeilingAfterCharge();
}
