import 'server-only';

import type {
  components,
  paths,
} from '@/lib/whatsapp/generated/phone-number-management';
import { createMetaGraphClient } from '@/lib/whatsapp/graph-client';
import { GRAPH_API_VERSION } from '@/lib/whatsapp/graph-version';

type PhoneNumberCreateRequest =
  components['schemas']['PhoneNumberCreateRequest'];
type PhoneNumberCreateResponse =
  components['schemas']['PhoneNumberCreateResponse'];

type GraphApiErrorBody = {
  error?: {
    message?: string;
    type?: string;
    code?: number;
    error_subcode?: number;
    fbtrace_id?: string;
    is_transient?: boolean;
  };
};

export type AddWabaPhoneNumberInput = Omit<
  PhoneNumberCreateRequest,
  'cc' | 'phone_number' | 'verified_name' | 'migrate_phone_number' | 'preverified_id'
> & {
  cc: string;
  phone_number: string;
  verified_name: string;
  migrate_phone_number?: boolean;
  preverified_id?: string;
};

export type AddWabaPhoneNumberConfig = {
  accessToken: string;
  wabaId: string;
};

export class AddWabaPhoneNumberError extends Error {
  readonly httpStatus: number;
  readonly providerCode?: number;
  readonly providerSubcode?: number;
  readonly providerType?: string;
  readonly fbtraceId?: string;
  readonly isTransient: boolean;

  constructor(params: {
    httpStatus: number;
    providerCode?: number;
    providerSubcode?: number;
    providerType?: string;
    fbtraceId?: string;
    isTransient?: boolean;
  }) {
    super('Meta rejected the WhatsApp phone number creation request');
    this.name = 'AddWabaPhoneNumberError';
    this.httpStatus = params.httpStatus;
    this.providerCode = params.providerCode;
    this.providerSubcode = params.providerSubcode;
    this.providerType = params.providerType;
    this.fbtraceId = params.fbtraceId;
    this.isTransient = params.isTransient === true;
  }
}

function requireNumericId(value: string, fieldName: string): string {
  const normalized = value.trim();
  if (!/^[0-9]+$/.test(normalized)) {
    throw new TypeError(`${fieldName} must contain digits only`);
  }
  return normalized;
}

function normalizeCountryCode(value: string): string {
  const normalized = value.trim().replace(/^\+/, '');
  if (!/^[0-9]{1,3}$/.test(normalized)) {
    throw new TypeError('Country code must contain 1 to 3 digits');
  }
  return normalized;
}

function normalizePhoneNumber(value: string): string {
  const normalized = value.replace(/[\s()+.-]/g, '');
  if (!/^[1-9][0-9]{6,14}$/.test(normalized)) {
    throw new TypeError(
      'Phone number must be in E.164 format without the plus prefix',
    );
  }
  return normalized;
}

function normalizeVerifiedName(value: string): string {
  const normalized = value.trim();
  if (normalized.length < 2 || normalized.length > 75) {
    throw new TypeError(
      'Verified name must contain between 2 and 75 characters',
    );
  }
  return normalized;
}

/**
 * מוסיף מספר טלפון ל-WhatsApp Business Account.
 *
 * הפעולה רק יוצרת את רשומת המספר ב-WABA ומתחילה את תהליך
 * ההצטרפות. אימות הקוד ורישום המספר עם PIN הם שלבים נפרדים.
 */
export async function addWabaPhoneNumber(
  config: AddWabaPhoneNumberConfig,
  input: AddWabaPhoneNumberInput,
): Promise<PhoneNumberCreateResponse> {
  const wabaId = requireNumericId(config.wabaId, 'WABA ID');
  const normalizedAccessToken = config.accessToken.trim();
  const body: PhoneNumberCreateRequest = {
    cc: normalizeCountryCode(input.cc),
    phone_number: normalizePhoneNumber(input.phone_number),
    verified_name: normalizeVerifiedName(input.verified_name),
    migrate_phone_number: input.migrate_phone_number ?? false,
  };

  if (input.preverified_id !== undefined) {
    const preverifiedId = input.preverified_id.trim();
    if (!preverifiedId) {
      throw new TypeError('Preverified ID cannot be empty');
    }
    body.preverified_id = preverifiedId;
  }

  const client = createMetaGraphClient<paths>(normalizedAccessToken);
  const { data, error, response } = await client.POST(
    '/{Version}/{WABA-ID}/phone_numbers',
    {
      params: {
        header: {
          Authorization: `Bearer ${normalizedAccessToken}`,
        },
        path: {
          Version: GRAPH_API_VERSION,
          'WABA-ID': wabaId,
        },
      },
      body,
    },
  );

  if (error || !data) {
    const graphError = error as GraphApiErrorBody | undefined;
    const providerError = graphError?.error;
    throw new AddWabaPhoneNumberError({
      httpStatus: response.status,
      providerCode: providerError?.code,
      providerSubcode: providerError?.error_subcode,
      providerType: providerError?.type,
      fbtraceId: providerError?.fbtrace_id,
      isTransient: providerError?.is_transient,
    });
  }

  return data;
}
