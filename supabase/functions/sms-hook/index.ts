// Supabase Auth "Send SMS" hook - routes every auth SMS through ExtrA
// (exm.co.il), the provider the rest of the product already uses.
//
// WHY this exists: Supabase Auth's built-in SMS supports only twilio /
// twilio_verify / messagebird / textlocal / vonage. ExtrA is none of them, so
// without this hook going native on phone verification would mean signing up
// with a second SMS vendor. The Send SMS Hook is the documented escape hatch.
//
// WHY an Edge Function and not a Postgres hook: the SQL variant queues the
// message because pg_net is asynchronous. For OTP delivery we want the request
// to complete only after ExtrA accepted the message.
//
// NO apiKey gate - deliberately. Supabase Auth calls this hook without one.
// Authenticity comes from the Standard Webhooks signature verified below.
// The function is therefore deployed with --no-verify-jwt.

import { Webhook } from 'https://esm.sh/standardwebhooks@1.0.0';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const EXTRA_SMS_URL = 'https://www.exm.co.il/api/v1/sms/send/';

// The real payload, read off a live phone_change on 2026-09-02. The published
// schema lists ONLY sms.otp and user.phone, and on a change BOTH of those are
// useless: user.phone is the CURRENT number (empty for someone adding their
// first), and the number being proved arrives in two undocumented places —
//
//   smsKeys : ["otp", "phone"]        <- sms.phone, the number THIS message is for
//   userKeys: [..., "new_phone", ...] <- and user.new_phone alongside it
//
// (not `phone_change`, the auth.users column name — that was a wrong guess.)
// Both are typed here because the docs promise neither, so either could
// disappear; user.phone stays last as the documented floor.
type HookPayload = {
  user?: {
    phone?: string;
    new_phone?: string;
  };
  sms?: {
    otp?: string;
    phone?: string;
  };
};

type ExtraSmsResponse = {
  success?: boolean;
  id?: string;
};

// Every response - success or failure - is JSON.
function json(
  body: unknown,
  status: number,
  extraHeaders?: HeadersInit,
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json',
      ...(extraHeaders ?? {}),
    },
  });
}

// 429/503 style failures are retryable transport/infrastructure failures.
// Keep destination/provider rejection failures non-retryable.
function retryable(message: string): Response {
  return json(
    {
      error: {
        http_code: 429,
        message,
      },
    },
    429,
    {
      'retry-after': 'true',
    },
  );
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') {
    return json(
      {
        error: {
          http_code: 405,
          message: 'method not allowed',
        },
      },
      405,
      {
        Allow: 'POST',
      },
    );
  }

  const payload = await req.text();

  let hookPayload: HookPayload;

  try {
    const secret = Deno.env.get('SEND_SMS_HOOK_SECRETS');

    if (!secret) {
      return json(
        {
          error: {
            http_code: 500,
            message: 'hook secret not configured',
          },
        },
        500,
      );
    }

    // Supabase stores Auth Hook secrets as:
    //
    //   v1,whsec_<base64>
    //
    // standardwebhooks expects:
    //
    //   whsec_<base64>
    //
    // Therefore we validate the Supabase format and remove only the "v1,"
    // prefix before constructing Webhook.
    if (!secret.startsWith('v1,whsec_')) {
      return json(
        {
          error: {
            http_code: 500,
            message: 'invalid hook secret format',
          },
        },
        500,
      );
    }

    const hookSecret = secret.slice('v1,'.length);
    const webhook = new Webhook(hookSecret);

    hookPayload = webhook.verify(
      payload,
      Object.fromEntries(req.headers),
    ) as HookPayload;
  } catch {
    // Do not expose signature-verification details.
    return json(
      {
        error: {
          http_code: 401,
          message: 'invalid signature',
        },
      },
      401,
    );
  }

  // Most specific first: sms.phone is the destination Auth built THIS message
  // for. user.new_phone is the same number seen from the user record, and
  // user.phone — the only one the docs name — is the OLD number and correct
  // only for flows that are not a change.
  const phone =
    hookPayload.sms?.phone ||
    hookPayload.user?.new_phone ||
    hookPayload.user?.phone;
  const otp = hookPayload.sms?.otp;

  if (!phone || !otp) {
    // Shape only, never values: a hook that rejects a payload it cannot read
    // is otherwise undiagnosable — Auth reports only "Invalid payload sent to
    // hook" and rolls the transaction back, leaving nothing in auth.users to
    // inspect (measured 2026-09-02).
    console.error('[sms-hook] unusable payload', {
      topLevelKeys: Object.keys(hookPayload ?? {}),
      userKeys: Object.keys(hookPayload?.user ?? {}),
      smsKeys: Object.keys(hookPayload?.sms ?? {}),
      hasSmsPhone: Boolean(hookPayload.sms?.phone),
      hasNewPhone: Boolean(hookPayload.user?.new_phone),
      hasUserPhone: Boolean(hookPayload.user?.phone),
      hasOtp: Boolean(otp),
    });
  }

  if (!phone || !otp) {
    return json(
      {
        error: {
          http_code: 400,
          message: 'missing phone or otp',
        },
      },
      400,
    );
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

  if (!supabaseUrl || !serviceRoleKey) {
    return json(
      {
        error: {
          http_code: 500,
          message: 'supabase service credentials not configured',
        },
      },
      500,
    );
  }

  const admin = createClient(
    supabaseUrl,
    serviceRoleKey,
    {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
    },
  );

  const { data: settings, error: settingsErr } = await admin
    .from('app_settings')
    .select('sms_enabled, extra_sms_token, extra_sms_sender')
    .eq('id', true)
    .maybeSingle();

  if (settingsErr) {
    return retryable('settings unavailable');
  }

  if (
    !settings?.sms_enabled ||
    !settings.extra_sms_token ||
    !settings.extra_sms_sender
  ) {
    return json(
      {
        error: {
          http_code: 500,
          message: 'SMS provider not configured',
        },
      },
      500,
    );
  }

  let providerResponse: Response;

  try {
    providerResponse = await fetch(EXTRA_SMS_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${settings.extra_sms_token}`,
      },
      body: JSON.stringify({
        message: `קוד האימות שלך: ${otp}`,
        destination: phone,
        sender: settings.extra_sms_sender,
      }),
    });
  } catch {
    return retryable('sms transport failed');
  }

  if (!providerResponse.ok) {
    return retryable(`sms provider http ${providerResponse.status}`);
  }

  let providerBody: ExtraSmsResponse;

  try {
    providerBody = await providerResponse.json() as ExtraSmsResponse;
  } catch {
    return retryable('invalid provider response');
  }

  if (!providerBody.success || !providerBody.id) {
    return json(
      {
        error: {
          http_code: 400,
          message: 'sms rejected by provider',
        },
      },
      400,
    );
  }

  return json({}, 200);
});