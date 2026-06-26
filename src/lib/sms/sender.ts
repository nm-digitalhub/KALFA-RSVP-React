import 'server-only';

import { createAdminClient } from '@/lib/supabase/admin';

// SMS transport abstraction. The OTP logic is provider-agnostic; only this
// adapter knows about ExtrA (exm.co.il). Swapping providers = a new adapter.
const EXTRA_SMS_URL = 'https://www.exm.co.il/api/v1/sms/send/';

export interface SmsSender {
  send(params: { to: string; text: string }): Promise<{ id: string }>;
}

export class SmsConfigError extends Error {
  constructor(msg: string) {
    super(msg);
    this.name = 'SmsConfigError';
  }
}
export class SmsSendError extends Error {
  constructor(msg: string) {
    super(msg);
    this.name = 'SmsSendError';
  }
}

// ExtrA: POST /api/v1/sms/send/ with Bearer token; body { message, destination,
// sender }; response { success, id, messages_count, errors[] }.
export function createExtraSmsSender(config: {
  token: string;
  sender: string;
}): SmsSender {
  return {
    async send({ to, text }) {
      let res: Response;
      try {
        res = await fetch(EXTRA_SMS_URL, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${config.token}`,
          },
          body: JSON.stringify({
            message: text,
            destination: to,
            sender: config.sender,
          }),
        });
      } catch {
        throw new SmsSendError('שליחת ההודעה נכשלה (תקשורת)');
      }
      // Carry the provider's HTTP status / error detail in the thrown message so
      // the server can LOG why a send failed (the message is for server logs, not
      // shown to the user — callers map it to a generic notice). No token (it is
      // request-only) or PII destination is included here.
      if (!res.ok) {
        throw new SmsSendError(`שליחת ההודעה נכשלה (HTTP ${res.status})`);
      }

      let json: { success?: boolean; id?: string; errors?: unknown };
      try {
        json = (await res.json()) as {
          success?: boolean;
          id?: string;
          errors?: unknown;
        };
      } catch {
        throw new SmsSendError('תגובה לא תקינה מספק ה-SMS');
      }
      if (!json.success || !json.id) {
        const detail = json.errors ? ` (${JSON.stringify(json.errors)})` : '';
        throw new SmsSendError(`שליחת ההודעה נדחתה${detail}`);
      }
      return { id: json.id };
    },
  };
}

// Build a configured sender from the admin-managed app_settings (server-only).
// Throws SmsConfigError when SMS is disabled or not configured.
export async function getSmsSender(): Promise<SmsSender> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from('app_settings')
    .select('sms_enabled, extra_sms_token, extra_sms_sender')
    .eq('id', true)
    .maybeSingle();
  if (error) throw new SmsConfigError('טעינת הגדרות ה-SMS נכשלה');
  if (!data?.sms_enabled || !data.extra_sms_token || !data.extra_sms_sender) {
    throw new SmsConfigError('שירות ה-SMS אינו מוגדר');
  }
  return createExtraSmsSender({
    token: data.extra_sms_token,
    sender: data.extra_sms_sender,
  });
}
