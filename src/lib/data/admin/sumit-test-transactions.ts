import 'server-only';

import { z } from 'zod';

import { createAdminClient } from '@/lib/supabase/admin';
import { requirePlatformPermission } from '@/lib/auth/dal';
import type { Json, TablesInsert } from '@/lib/supabase/types';
import { mapSumitChargeResponse } from '@/lib/sumit/charge-response';

// /admin/sumit-test PERSISTENCE: every field SUMIT returns for a diagnostic
// charge, one column each (migration 20260929172136_sumit_test_transactions).
//
// The response → columns mapping (and the PAN / CVV / Track2 rule) lives in
// src/lib/sumit/charge-response.ts.
//
// Staff-only (manage_billing), service-role client; the table has no grants
// for anon/authenticated. Tokens / CitizenID / AuthNumber are stored here but
// never returned to the browser: the capture flow resolves them server-side.

export interface RecordTestTransactionInput {
  operation: 'charge' | 'hold' | 'capture';
  parentId?: string | null;
  request: Record<string, unknown>; // the SAFE summary (safe-preview) — never the raw body
  requestAmount?: number | null;
  requestAuthorizeAmount?: number | null;
  requestAutoCapture?: boolean | null;
  requestCreditCardAuthNumber?: string | null;
  requestCustomerId?: number | null;
  requestExternalIdentifier?: string | null;
  httpStatus: number | null;
  raw: unknown;
}

// Persist one diagnostic call. Returns the new row id.
export async function recordSumitTestTransaction(input: RecordTestTransactionInput): Promise<string> {
  const staff = await requirePlatformPermission('manage_billing');
  const row: TablesInsert<'sumit_test_transactions'> = {
    created_by: staff.id,
    operation: input.operation,
    parent_id: input.parentId ?? null,
    request: input.request as Json,
    request_amount: input.requestAmount ?? null,
    request_authorize_amount: input.requestAuthorizeAmount ?? null,
    request_auto_capture: input.requestAutoCapture ?? null,
    request_credit_card_auth_number: input.requestCreditCardAuthNumber ?? null,
    request_customer_id: input.requestCustomerId ?? null,
    request_external_identifier: input.requestExternalIdentifier ?? null,
    http_status: input.httpStatus,
    ...mapSumitChargeResponse(input.raw),
  };
  const { data, error } = await createAdminClient()
    .from('sumit_test_transactions')
    .insert(row)
    .select('id')
    .single();
  if (error || !data) throw new Error('שמירת תוצאת הבדיקה נכשלה');
  return data.id;
}

export interface TestHoldOption {
  id: string;
  createdAt: string;
  holdAmount: number | null;
  capturedAmount: number; // sum of SUCCESSFUL captures on this hold
  lastDigits: string | null;
}

// Successful J5 holds made on this screen that carry what a capture needs.
// Labels only — no token / CitizenID / AuthNumber leaves the server.
export async function listTestHolds(): Promise<TestHoldOption[]> {
  await requirePlatformPermission('manage_billing');
  const admin = createAdminClient();
  const { data: holds, error } = await admin
    .from('sumit_test_transactions')
    .select('id, created_at, payment_amount, request_authorize_amount, payment_method_last_digits')
    .eq('operation', 'hold')
    .eq('payment_valid_payment', true)
    .not('payment_auth_number', 'is', null)
    .not('payment_method_token', 'is', null)
    .order('created_at', { ascending: false })
    .limit(50);
  if (error) throw new Error('טעינת תפיסות הבדיקה נכשלה');
  if (!holds || holds.length === 0) return [];

  const { data: captures, error: capError } = await admin
    .from('sumit_test_transactions')
    .select('parent_id, payment_amount')
    .eq('operation', 'capture')
    .eq('payment_valid_payment', true)
    .in('parent_id', holds.map((h) => h.id));
  if (capError) throw new Error('טעינת תפיסות הבדיקה נכשלה');

  const captured = new Map<string, number>();
  for (const c of captures ?? []) {
    if (!c.parent_id) continue;
    captured.set(c.parent_id, (captured.get(c.parent_id) ?? 0) + Number(c.payment_amount ?? 0));
  }
  return holds.map((h) => ({
    id: h.id,
    createdAt: h.created_at,
    holdAmount: h.request_authorize_amount ?? h.payment_amount ?? null,
    capturedAmount: captured.get(h.id) ?? 0,
    lastDigits: h.payment_method_last_digits,
  }));
}

export interface TestHoldForCapture {
  id: string;
  authNumber: string;
  cardToken: string;
  expMonth: number | null;
  expYear: number | null;
  citizenId: string | null;
  customerId: number | null;
  // The hold's own Customer.ExternalIdentifier — the capture must send the SAME
  // customer as the hold (SUMIT support, 2026-09-29).
  externalIdentifier: string | null;
  // "The amount cannot exceed what was held" (SUMIT support) — so the route
  // refuses a capture above holdAmount − capturedAmount before calling SUMIT.
  holdAmount: number | null;
  capturedAmount: number;
}

// Server-side only: what a capture of one hold must send. Never rendered.
export async function getTestHoldForCapture(holdId: string): Promise<TestHoldForCapture | null> {
  await requirePlatformPermission('manage_billing');
  const id = z.uuid().parse(holdId);
  const { data, error } = await createAdminClient()
    .from('sumit_test_transactions')
    .select(
      'id, operation, payment_valid_payment, payment_auth_number, payment_method_token, payment_method_expiration_month, payment_method_expiration_year, payment_method_citizen_id, data_customer_id, payment_customer_id, request_external_identifier, request_authorize_amount, payment_amount',
    )
    .eq('id', id)
    .maybeSingle();
  if (error) throw new Error('טעינת תפיסת הבדיקה נכשלה');
  if (
    !data ||
    data.operation !== 'hold' ||
    data.payment_valid_payment !== true ||
    !data.payment_auth_number ||
    !data.payment_method_token
  ) {
    return null;
  }
  const { data: captures, error: capError } = await createAdminClient()
    .from('sumit_test_transactions')
    .select('payment_amount')
    .eq('parent_id', data.id)
    .eq('operation', 'capture')
    .eq('payment_valid_payment', true);
  if (capError) throw new Error('טעינת תפיסת הבדיקה נכשלה');
  const capturedAmount = (captures ?? []).reduce((sum, c) => sum + Number(c.payment_amount ?? 0), 0);

  return {
    id: data.id,
    authNumber: data.payment_auth_number,
    cardToken: data.payment_method_token,
    expMonth: data.payment_method_expiration_month,
    expYear: data.payment_method_expiration_year,
    citizenId: data.payment_method_citizen_id,
    customerId: data.data_customer_id ?? data.payment_customer_id ?? null,
    externalIdentifier: data.request_external_identifier,
    holdAmount: data.request_authorize_amount ?? data.payment_amount ?? null,
    capturedAmount,
  };
}
