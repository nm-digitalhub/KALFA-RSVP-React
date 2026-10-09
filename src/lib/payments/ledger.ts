import 'server-only';

import type { createAdminClient } from '@/lib/supabase/admin';
import type { Json, TablesInsert, TablesUpdate } from '@/lib/supabase/types';

import type { CardDetails } from './card';
import type { CardFacts } from './cardcom-card-facts';
import type { PaymentFacts } from './cardcom-payment-facts';
import type { OperationEffect, OperationOutcome, OperationRow } from './status';

// The payment ledger's only writer and reader (docs/superpowers/plans/2026-09-24-campaign-payment-domain-split.md,
// Task 5; the table is supabase/migrations/20261004105957_payment_operations_expand.sql). Every money movement is one
// row, the status is DERIVED from the rows (status.ts), and it is the DATABASE — not this code — that makes "pay once"
// true:
//   - beginOperation inserts a PENDING row BEFORE the provider is called. payment_operations_one_pending_uq (one in
//     flight per campaign + kind) and payment_operations_once_uq (a once-per-campaign kind that already has a pending,
//     review or succeeded row) turn a double click or a second tab into a 23505, reported as { alreadyInProgress }.
//   - completeOperation is a compare-and-set: the caller names the outcome it expects to move FROM, so a payment flow
//     (from 'pending') can never close a row a person is reconciling (from 'review'), and the other way round.
//   - an operation may carry the composition of its money as signed lines (payment_operation_lines, written by
//     beginOperation, read by loadOperations): the price as positive lines and what was settled another way — credit,
//     a coupon, a gift card — as negative ones. The database refuses to close an operation whose lines do not add up
//     to its amount and credit_applied. An operation with no lines keeps those two columns as its only record.
// Server-only, through the admin client and only AFTER the caller has verified ownership: the browser has no grant on
// the table. Not built here, on purpose: filling the card brand/issuer after the charge (best effort, display only).
// The old card-hold and final-charge paths do not write here (owner 4.10: the hold leaves the model); their state stays
// in the campaigns columns until they are retired.

type AdminClient = ReturnType<typeof createAdminClient>;

// `id` is the provider's internal document id; `number` is the one printed on the receipt. An admin who resolves a
// stuck operation by hand can read only the NUMBER off the provider's screen, so `id` may be null.
export type ProviderDocument = { id: number | null; number: number | null; url: string | null };

// What an operation records about the provider's answer. Every field is optional: a write sets only what it knows.
export type OperationDetails = {
  // What reached the card. For an operation with lines it is the sum of the lines.
  amount?: number;
  // What was settled from credit instead of the card. For an operation with lines it is the sum of the negative lines.
  creditApplied?: number;
  card?: CardDetails | null;
  // What a provider that is not SUMIT says about the card (last four, expiry, brand, issuer, its token, the Vault id of the
  // holder's ID). The payment-method type and the mask are not set: the provider does not give them. A call passes `card` OR `cardFacts`.
  cardFacts?: CardFacts | null;
  // The provider's own record of the payment beyond the card: the cardholder, the card's class, the payment type and the
  // provider's references (voucher number, unique id, RRN...). Written to their own columns; every one is nullable.
  paymentFacts?: PaymentFacts | null;
  providerPaymentId?: number | null;
  providerAuthRef?: string | null;
  // The terminal CardCom itself reports in its answer (terminalEchoFromCardcom). Written once, when the row is completed and the
  // answer carried one; the database refuses to change it afterwards. Not the terminal the row was opened on - that one is
  // `providerTerminal` of NewOperation, set at birth and frozen.
  providerTerminalEcho?: number | null;
  providerStatus?: string | null;
  providerStatusDescription?: string | null;
  providerDocument?: ProviderDocument | null;
  // The provider's time when it is known; otherwise the time the row was begun stays.
  occurredAt?: string;
  note?: string | null;
  // Non-sensitive provider extras the row must keep (a document type a later refund needs). It REPLACES the column:
  // the caller read the current meta and passes it back merged. Never card data, a citizen id or a raw provider body.
  meta?: { [key: string]: Json | undefined };
};

export type NewOperation = OperationDetails & {
  campaignId: string;
  // The database derives event_id from the (locked) campaign and ignores this; the column is NOT NULL, so it is sent.
  eventId: string;
  kind: string;
  amount: number;
  outcome: OperationOutcome;
  parentOperationId?: string | null;
  // Which clearing company the row belongs to, and the terminal its payment session was ASKED to open on (the same configuration
  // object that builds the request). Written when the row is born and never changed: the database freezes both and derives
  // `is_test` from the terminal, once. Only a NEW row carries them - a completion cannot, by type and by detailColumns - and a
  // refund or a release takes them from its parent whatever is sent here. Absent = the database default (sumit, no terminal).
  provider?: 'sumit' | 'cardcom';
  providerTerminal?: number | null;
  source?: 'app' | 'provider_sync' | 'manual_backfill';
  // Non-sensitive extras only — never card data, a citizen id or a raw provider body.
  meta?: { [key: string]: Json | undefined };
};

// One line of the money of an operation. Signed: a negative price is a deduction (credit, coupon, gift card). The
// database stores line_total = round(quantity * unit_price, 2) and, when an operation succeeds, refuses it unless its
// lines add up to its `amount` and its negative lines to its `credit_applied` (payment_operation_lines, migration
// 20261006031606). An operation written without lines keeps both numbers as the only record, as before.
export type OperationLine = { description: string; quantity?: number; unitPrice: number };

// An operation that is begun (pending) may carry its lines; one that is recorded already finished may not — the
// database accepts lines only while the operation is still open.
export type BeginOperation = Omit<NewOperation, 'outcome'> & { lines?: readonly OperationLine[] };

// pending → succeeded | failed | review is the payment flow; review → succeeded | failed is the human reconciliation.
export type Completion = OperationDetails &
  (
    | { from: 'pending'; outcome: 'succeeded' | 'failed' | 'review' }
    | { from: 'review'; outcome: 'succeeded' | 'failed' }
  );

// The row was not in the state the caller expected (someone else completed it first, or it is in review). Its own
// class so a sweeper can treat a lost race as "skip" without ever swallowing a real database error.
export class OperationStateError extends Error {
  constructor() {
    super('payment operation is not in the expected state');
    this.name = 'OperationStateError';
  }
}

const WRITE_FAILED = 'רישום פעולת התשלום נכשל';
const UPDATE_FAILED = 'עדכון פעולת התשלום נכשל';
const READ_FAILED = 'טעינת פעולות התשלום נכשלה';
const UNIQUE_VIOLATION = '23505';
const LINES_NOT_WRITTEN_NOTE = 'the lines of the operation could not be written; nothing was sent to the provider';

// Money is summed in whole cents, the way the database sums its numeric columns: 3 x 0.10 must be exactly 0.30.
const toCents = (n: number) => Math.round(n * 100);
const hasMoreDecimals = (n: number, places: number) => Math.abs(n * 10 ** places - Math.round(n * 10 ** places)) > 1e-6;

// The total of one line in cents, rounded half away from zero like numeric round(). Throws on a line the database
// would refuse or silently round (a blank description, a price in fractions of a cent, a non-positive quantity).
function lineCents(line: OperationLine): number {
  const quantity = line.quantity ?? 1;
  if (
    line.description.trim() === '' ||
    !Number.isFinite(line.unitPrice) || hasMoreDecimals(line.unitPrice, 2) ||
    !Number.isFinite(quantity) || quantity <= 0 || hasMoreDecimals(quantity, 3)
  ) {
    throw new Error(WRITE_FAILED);
  }
  const total = quantity * line.unitPrice * 100;
  return Math.sign(total) * Math.round(Math.abs(total));
}

// The deduction in a set of stored line totals: the negative ones, as a positive amount (never -0).
function creditOfTotals(lineTotals: readonly (number | string | null)[]): number {
  let cents = 0;
  for (const total of lineTotals) {
    const c = toCents(Number(total ?? 0));
    if (c < 0) cents -= c;
  }
  return cents / 100;
}

// What the lines add up to, and how much of it is deduction (the negative lines).
function summarizeLines(lines: readonly OperationLine[]): { total: number; credit: number } {
  let total = 0;
  let credit = 0;
  for (const line of lines) {
    const c = lineCents(line);
    total += c;
    if (c < 0) credit -= c;
  }
  return { total: total / 100, credit: credit / 100 };
}

// Only the columns the caller actually set: an unset field must not overwrite what the row already holds.
function detailColumns(d: OperationDetails): TablesUpdate<'payment_operations'> {
  const out: TablesUpdate<'payment_operations'> = {};
  if (d.amount !== undefined) out.amount = d.amount;
  if (d.creditApplied !== undefined) out.credit_applied = d.creditApplied;
  if (d.providerPaymentId !== undefined) out.provider_payment_id = d.providerPaymentId;
  if (d.providerAuthRef !== undefined) out.provider_auth_ref = d.providerAuthRef;
  if (d.providerTerminalEcho !== undefined) out.provider_terminal_echo = d.providerTerminalEcho;
  if (d.providerStatus !== undefined) out.provider_status = d.providerStatus;
  if (d.providerStatusDescription !== undefined) out.provider_status_description = d.providerStatusDescription;
  if (d.providerDocument !== undefined) {
    out.provider_document_id = d.providerDocument?.id ?? null;
    out.provider_document_number = d.providerDocument?.number ?? null;
    out.provider_document_url = d.providerDocument?.url ?? null;
  }
  if (d.card) {
    out.payment_method_type = d.card.methodType;
    out.card_token_ref = d.card.tokenRef;
    out.card_exp_month = d.card.expMonth;
    out.card_exp_year = d.card.expYear;
    out.card_last4 = d.card.last4;
    out.card_mask = d.card.mask;
    // The citizen id itself never reaches this table: only the id of the Vault secret that holds it.
    out.citizen_id_secret = d.card.citizenSecretId;
  }
  if (d.cardFacts) {
    out.card_last4 = d.cardFacts.last4;
    out.card_exp_month = d.cardFacts.expMonth;
    out.card_exp_year = d.cardFacts.expYear;
    out.card_brand = d.cardFacts.brand;
    out.card_issuer = d.cardFacts.issuer;
    out.card_token_ref = d.cardFacts.tokenRef;
    out.citizen_id_secret = d.cardFacts.citizenSecretId;
  }
  if (d.paymentFacts) {
    const f = d.paymentFacts;
    out.card_owner_name = f.cardOwnerName;
    out.card_owner_email = f.cardOwnerEmail;
    out.card_owner_phone = f.cardOwnerPhone;
    out.card_name = f.cardName;
    out.card_info = f.cardInfo;
    out.card_first_digits = f.cardFirstDigits;
    out.card_is_abroad = f.cardIsAbroad;
    out.number_of_payments = f.numberOfPayments;
    out.provider_coupon_number = f.couponNumber;
    out.provider_unique_id = f.uniqueId;
    out.provider_rrn = f.rrn;
    out.provider_acquirer = f.acquirer;
    out.provider_payment_type = f.paymentType;
    out.provider_entry_mode = f.entryMode;
    out.provider_deal_type = f.dealType;
    out.provider_account_id = f.accountId;
    out.provider_auth_description = f.authDescription;
  }
  if (d.occurredAt !== undefined) out.occurred_at = d.occurredAt;
  if (d.note !== undefined) out.note = d.note;
  if (d.meta !== undefined) out.meta = d.meta;
  return out;
}

function insertRow(op: NewOperation): TablesInsert<'payment_operations'> {
  return {
    campaign_id: op.campaignId,
    event_id: op.eventId,
    kind: op.kind,
    outcome: op.outcome,
    parent_operation_id: op.parentOperationId ?? null,
    source: op.source ?? 'app',
    meta: op.meta ?? {},
    // The column default, written out: a row always says how much of it came from credit, even when that is nothing.
    credit_applied: 0,
    // The stamp is written here and ONLY here (detailColumns is shared with completions, which must never touch it). `is_test` is
    // not written by anyone: the database sets it from the terminal when the row is inserted.
    ...(op.provider === undefined ? {} : { provider: op.provider }),
    ...(op.providerTerminal === undefined ? {} : { provider_terminal: op.providerTerminal }),
    ...detailColumns(op),
  };
}

async function insert(admin: AdminClient, op: NewOperation): Promise<{ id: string } | { duplicate: true }> {
  const { data, error } = await admin.from('payment_operations').insert(insertRow(op)).select('id').single();
  if (error) {
    if (error.code === UNIQUE_VIOLATION) return { duplicate: true };
    throw new Error(WRITE_FAILED);
  }
  return { id: data.id };
}

// One-shot: the outcome is already known (a sync from the provider, an admin-entered correction).
export async function recordOperation(admin: AdminClient, op: NewOperation): Promise<string> {
  const written = await insert(admin, op);
  // A row the database refused as a duplicate was NOT recorded; returning an id for it would be a lie.
  if ('duplicate' in written) throw new Error(WRITE_FAILED);
  return written.id;
}

// Two-phase, step 1: take the lock by inserting the PENDING row, before the provider is called. With `lines`, the
// operation's amount and credit are DERIVED from them (and must agree with what the caller states, or nothing is
// written), the operation row is written first — that is the lock — and its lines follow. If the lines cannot be
// written the operation is closed as failed here, so the provider is never called for an operation whose composition
// is not on record.
export async function beginOperation(
  admin: AdminClient,
  op: BeginOperation,
): Promise<{ id: string } | { alreadyInProgress: true }> {
  const { lines, ...rest } = op;
  if (!lines || lines.length === 0) {
    const written = await insert(admin, { ...rest, outcome: 'pending' });
    return 'duplicate' in written ? { alreadyInProgress: true } : written;
  }
  const sum = summarizeLines(lines);
  if (toCents(rest.amount) !== toCents(sum.total)) throw new Error(WRITE_FAILED);
  if (rest.creditApplied !== undefined && toCents(rest.creditApplied) !== toCents(sum.credit)) throw new Error(WRITE_FAILED);
  const written = await insert(admin, { ...rest, creditApplied: sum.credit, outcome: 'pending' });
  if ('duplicate' in written) return { alreadyInProgress: true };
  const { error } = await admin.from('payment_operation_lines').insert(
    lines.map((line, i) => ({
      operation_id: written.id,
      line_no: i + 1,
      description: line.description,
      quantity: line.quantity ?? 1,
      unit_price: line.unitPrice,
    })),
  );
  if (error) {
    await abandonUnwritten(admin, written.id);
    throw new Error(WRITE_FAILED);
  }
  return written;
}

// The operation row exists but its lines do not: close it as failed. If even that fails the row stays pending, which
// the orphan sweeper moves to review — loud in the log, never silent.
async function abandonUnwritten(admin: AdminClient, operationId: string): Promise<void> {
  try {
    await completeOperation(admin, operationId, { from: 'pending', outcome: 'failed', note: LINES_NOT_WRITTEN_NOTE });
  } catch (err) {
    console.error('[ledger] an operation whose lines were not written could not be closed; the orphan sweeper will review it', {
      operationId,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

// Two-phase, step 2: compare-and-set. Zero rows means the row was not in the state the caller expected (someone else
// completed it, or it is in review) — that is an error, never a silent success.
export async function completeOperation(admin: AdminClient, id: string, result: Completion): Promise<void> {
  const { data, error } = await admin
    .from('payment_operations')
    .update({ outcome: result.outcome, ...detailColumns(result) })
    .eq('id', id)
    .eq('outcome', result.from)
    .select('id');
  if (error) throw new Error(UPDATE_FAILED);
  if (!data || data.length !== 1) throw new OperationStateError();
}

export async function latestOperation(
  admin: AdminClient,
  campaignId: string,
  kind: string,
  outcome?: OperationOutcome,
): Promise<{ id: string } | null> {
  const base = admin.from('payment_operations').select('id').eq('campaign_id', campaignId).eq('kind', kind);
  const { data, error } = await (outcome ? base.eq('outcome', outcome) : base)
    .order('occurred_at', { ascending: false })
    .order('recorded_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(READ_FAILED);
  return data ? { id: data.id } : null;
}

// One operation as a caller that must act ON it needs it: the id, what it is, how it ended, the non-sensitive extras
// (payerUserId, cancellation_request_id …), the provider's document, and what the provider answered (its status code and
// text — for staff; a refused refund says why) and when it was recorded. Never card data.
export type StoredOperation = {
  id: string;
  kind: string;
  outcome: OperationOutcome;
  amount: number;
  meta: { [key: string]: Json | undefined };
  document: ProviderDocument | null;
  providerStatus: string | null;
  providerStatusDescription: string | null;
  recordedAt: string;
};

const OPERATION_COLUMNS =
  'id, kind, outcome, amount, meta, provider_document_id, provider_document_number, provider_document_url, provider_status, provider_status_description, recorded_at';
type OperationDbRow = {
  id: string;
  kind: string;
  outcome: OperationOutcome;
  amount: number | string;
  meta: Json;
  provider_document_id: number | null;
  provider_document_number: number | null;
  provider_document_url: string | null;
  provider_status: string | null;
  provider_status_description: string | null;
  recorded_at: string;
};

function toStored(row: OperationDbRow): StoredOperation {
  const meta = row.meta !== null && typeof row.meta === 'object' && !Array.isArray(row.meta) ? row.meta : {};
  const hasDocument = row.provider_document_id != null || row.provider_document_number != null || row.provider_document_url != null;
  return {
    id: row.id,
    kind: row.kind,
    outcome: row.outcome,
    amount: Number(row.amount),
    meta,
    document: hasDocument
      ? { id: row.provider_document_id, number: row.provider_document_number, url: row.provider_document_url }
      : null,
    providerStatus: row.provider_status ?? null,
    providerStatusDescription: row.provider_status_description ?? null,
    recordedAt: row.recorded_at,
  };
}

export async function getOperation(admin: AdminClient, id: string): Promise<StoredOperation | null> {
  const { data, error } = await admin.from('payment_operations').select(OPERATION_COLUMNS).eq('id', id).maybeSingle();
  if (error) throw new Error(READ_FAILED);
  return data ? toStored(data) : null;
}

// Every refund that carries this cancellation request's id (meta.cancellation_request_id), failed ones included: the
// caller decides what each outcome means — a succeeded one means the money already went back, so a retry must NOT
// refund again, and an unresolved one (pending / review) must not be started over.
export async function refundsOfRequest(admin: AdminClient, campaignId: string, requestId: string): Promise<StoredOperation[]> {
  const { data, error } = await admin
    .from('payment_operations')
    .select(OPERATION_COLUMNS)
    .eq('campaign_id', campaignId)
    .eq('kind', 'refund')
    .order('occurred_at', { ascending: true })
    .order('recorded_at', { ascending: true });
  if (error) throw new Error(READ_FAILED);
  return (data ?? []).map(toStored).filter((op) => op.meta.cancellation_request_id === requestId);
}

const EFFECTS: readonly OperationEffect[] = ['commit', 'collect', 'void', 'return', 'none'];
function isEffect(v: unknown): v is OperationEffect {
  return typeof v === 'string' && (EFFECTS as readonly string[]).includes(v);
}

// Every row of a campaign with the registry's `effect` joined in — exactly what deriveStatus needs. An effect the code
// does not know is an error: guessing "no money effect" for an unknown kind would show a charged campaign as unpaid.
export async function loadOperations(admin: AdminClient, campaignId: string): Promise<OperationRow[]> {
  const { data, error } = await admin
    .from('payment_operations')
    .select('kind, outcome, amount, credit_applied, is_test, occurred_at, recorded_at, payment_operation_kinds!inner(effect), payment_operation_lines(line_total)')
    .eq('campaign_id', campaignId)
    .order('occurred_at', { ascending: true })
    .order('recorded_at', { ascending: true });
  if (error) throw new Error(READ_FAILED);
  return (data ?? []).map((row) => {
    const effect = row.payment_operation_kinds?.effect;
    if (!isEffect(effect)) throw new Error(READ_FAILED);
    // An operation with lines says what part was deduction through its negative lines; one without (everything written
    // before the lines existed) keeps the credit_applied column as its only record.
    const lines = row.payment_operation_lines ?? [];
    return {
      kind: row.kind,
      effect,
      outcome: row.outcome,
      // numeric may arrive as a string
      amount: Number(row.amount),
      credit: lines.length > 0 ? creditOfTotals(lines.map((l) => l.line_total)) : Number(row.credit_applied),
      // The class the database gave the row when it was born (a no-money terminal). Never derived here. Only present when true,
      // so a row of real money keeps the shape it always had.
      ...(row.is_test === true ? { isTest: true } : {}),
      occurredAt: row.occurred_at,
      recordedAt: row.recorded_at,
    };
  });
}

// The card to charge again: the latest SUCCEEDED operation that holds a reusable token, whatever its kind (a package
// purchase saves a card exactly as a hold does). The citizen id stays in Vault: read it with readCitizenId(operationId).
export async function currentCard(
  admin: AdminClient,
  campaignId: string,
): Promise<(CardDetails & { operationId: string }) | null> {
  const { data, error } = await admin
    .from('payment_operations')
    .select('id, payment_method_type, card_token_ref, card_exp_month, card_exp_year, card_last4, card_mask, citizen_id_secret')
    .eq('campaign_id', campaignId)
    .eq('outcome', 'succeeded')
    .not('card_token_ref', 'is', null)
    .order('occurred_at', { ascending: false })
    .order('recorded_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(READ_FAILED);
  if (!data?.card_token_ref) return null;
  return {
    operationId: data.id,
    methodType: data.payment_method_type,
    tokenRef: data.card_token_ref,
    expMonth: data.card_exp_month,
    expYear: data.card_exp_year,
    last4: data.card_last4,
    mask: data.card_mask,
    citizenSecretId: data.citizen_id_secret,
  };
}
