import { NextResponse } from 'next/server';

import {
  claimSalesOutcome,
  getSalesRequestForAttempt,
  recordSalesLinkSent,
} from '@/lib/data/sales-call-attempts';
import { applyCallOutcome } from '@/lib/data/callback-scheduling';
import { getSmsSender } from '@/lib/sms/sender';
import { buildSignupLinkSmsText } from '@/lib/callbacks/signup-link-sms';
import { getTemplateByKey } from '@/lib/data/message-templates-resolve';
import { getWhatsAppConfig } from '@/lib/data/outreach-config';
import { sendWhatsAppMarketingTemplate } from '@/lib/whatsapp/client';
import { getAppOrigin } from '@/lib/url';
import { guardSalesToolRequest } from '@/lib/voximplant/agent-tool-guard';
import { voxSalesSignupLinkSchema } from '@/lib/validation/voximplant';

// POST /api/voximplant/sls/tool/signup-link/{token}
//
// The sales-closing agent's `send_signup_link` tool (script draft §3) —
// tries WhatsApp first (only if whatsapp_consent=true AND an active
// `sales_signup_link` message_templates row exists — Meta template
// submission/approval is out of this build's scope, see below), falling
// back to SMS (src/lib/callbacks/no-contact-sms.ts's precedent: a service
// reply to a self-initiated request, no marketing-consent gate). Returns one
// channel-agnostic `accepted` — the agent never learns which channel
// actually carried it (script §5/Guardrail 5).
//
// SCOPING DECISION (read before changing `completed`'s trigger): the script's
// own prompt text (§1 Goal step 6, §3 tool description, Guardrail 5) defines
// `accepted` as "the system received the message FOR SENDING" — i.e. a
// synchronous provider acceptance (a WhatsApp message id, or an ExtrA SMS
// provider id), explicitly NOT "delivered to the handset". That is exactly
// DeliveryOutcome's `kind:'accepted'` from either channel. A SEPARATE note
// elsewhere in the same script draft (§3's "architectural-fix" addendum,
// itself flagged there as "relayed via team-lead, not independently
// verified") describes a stricter async design gated on a WhatsApp
// delivered/read webhook + a confirmation sweep — neither of which exists
// anywhere in this codebase (verified by grep, 2026-08-22: no
// `processStatus` sales branch, no `runSalesWhatsAppConfirmationSweep`, no
// `sales_signup_link` in MARKETING_MESSAGE_KEYS). Building that unverified,
// second-hand design would also contradict the literal prompt text the
// agent actually speaks. This route therefore implements what the prompt
// says: `completed` is written the moment the provider synchronously
// accepts the send (WhatsApp wamid OR SMS provider id), claim-guarded on
// `outcome_recorded_at` exactly like every other outcome-write path. If the
// stricter delivered/read design is wanted later, it is a new, explicit
// increment — not a silent assumption baked in here.
//
// A cold WhatsApp send with no approved template is EXPECTED to fail today
// (no `sales_signup_link` template has been submitted to Meta) — every call
// currently falls through to SMS. This is a known, flagged limitation, not
// a bug: WhatsApp becomes real the moment an admin creates + Meta approves
// that template row; no code change is needed then.

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MAX_BODY_BYTES = 2 * 1024;
const SALES_SIGNUP_MESSAGE_KEY = 'sales_signup_link';

const NO_STORE = { 'Cache-Control': 'no-store' } as const;

const bad = (status: number) => new NextResponse(null, { status, headers: NO_STORE });

export async function POST(
  req: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;

  const guard = await guardSalesToolRequest(req, token, {
    scope: 'vox-sls-signup-link',
    maxBodyBytes: MAX_BODY_BYTES,
  });
  if (!guard.ok) return bad(guard.status);
  const { attemptId, raw } = guard;

  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return bad(400);
  }

  const parsed = voxSalesSignupLinkSchema.safeParse(json);
  if (!parsed.success) return bad(400);

  const ref = await getSalesRequestForAttempt(attemptId);
  if (!ref) return bad(404);

  // ?ref=<attemptId> — a plain UUID, not a credential (grants no access to
  // anything by itself; only correlates a later signup back to this call).
  // Captured at signup (see profiles.sales_referral_attempt_id) and resolved
  // to a real conversion signal when the resulting user signs a campaign
  // agreement (recordSignedAgreement) — owner decision 2026-08-22: "signup
  // completed" for tracking purposes means agreement signed + package
  // chosen, not bare account creation. Deliberately does NOT feed
  // callback_requests.call_outcome — that stays scoped to the AGENT's own
  // job (a link was sent), a separate concern from downstream conversion.
  const signupUrl = `${await getAppOrigin()}/auth/signup?ref=${attemptId}`;
  const nowIso = new Date().toISOString();

  let waMessageId: string | undefined;

  // 1. WhatsApp attempt — only with consent AND a real, active template.
  if (parsed.data.whatsapp_consent) {
    try {
      const [template, waConfig] = await Promise.all([
        getTemplateByKey(SALES_SIGNUP_MESSAGE_KEY),
        getWhatsAppConfig(),
      ]);
      if (template && waConfig) {
        const outcome = await sendWhatsAppMarketingTemplate(
          {
            phoneNumberId: waConfig.phoneNumberId,
            accessToken: waConfig.accessToken,
            appSecret: waConfig.appSecret,
          },
          {
            to: ref.phone,
            templateName: template.name,
            language: template.language,
            // The template's URL button base is
            // "https://beta.kalfa.me/auth/signup?ref=" with a {{1}} dynamic
            // suffix (submitted to Meta as kalfa_sales_signup_link_v1) —
            // urlButtonParam is that suffix ONLY (the attempt id), matching
            // the gift-link precedent's own convention exactly (client.ts's
            // own comment: "the suffix Meta appends to the template's static
            // button URL").
            urlButtonParam: attemptId,
          },
        );
        if (outcome.kind === 'accepted') {
          waMessageId = outcome.providerId;
        }
      }
    } catch {
      // Falls through to SMS — never let a WhatsApp throw block the fallback.
    }
  }

  let accepted = false;

  if (waMessageId) {
    accepted = true;
  } else {
    // 2. SMS fallback — always attempted when WhatsApp wasn't accepted,
    //    regardless of whatsapp_consent (consent only gates the WhatsApp
    //    attempt itself; SMS needs no separate consent — see file header).
    try {
      const sender = await getSmsSender();
      const text = buildSignupLinkSmsText({ fullName: ref.fullName, signupUrl });
      await sender.send({ to: ref.phone, text });
      accepted = true;
    } catch {
      accepted = false;
    }
  }

  if (!accepted) {
    // Neither channel confirmed — no outcome claim. The agent's own
    // error-handling branch (§1) calls notify_owner + log_outcome next.
    return NextResponse.json({ accepted: false }, { status: 200, headers: NO_STORE });
  }

  await recordSalesLinkSent(attemptId, {
    waConsentConfirmedAt: parsed.data.whatsapp_consent ? nowIso : undefined,
    waMessageId,
  });

  try {
    const claimed = await claimSalesOutcome(attemptId);
    if (claimed) {
      await applyCallOutcome(claimed.callbackRequestId, 'completed');
    }
  } catch {
    // The message was genuinely sent (SMS provider id or WhatsApp wamid
    // exists) — never tell the agent it failed just because the outcome
    // write itself errored. A missed 'completed' write here is visible to
    // an admin via the row's own dispatch/finish state.
  }

  return NextResponse.json({ accepted: true }, { status: 200, headers: NO_STORE });
}
