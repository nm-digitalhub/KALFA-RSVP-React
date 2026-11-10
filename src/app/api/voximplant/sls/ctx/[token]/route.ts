import { getSalesVoiceContextByAccessToken } from '@/lib/data/sales-call-attempts';
import { getCompanyLegal } from '@/lib/data/company';
import { guardCallContextRequest } from '@/lib/voximplant/call-context-guard';
import { emptyNoStore, jsonNoStore } from '@/lib/voximplant/no-store-response';

// ⚠️ STAGE-0 PROBE — see the block at the bottom of this file for the full
// rationale. '' is the production value: the key is then omitted entirely.
const STAGE0_FIRST_MESSAGE_PROBE = '';

// GET /api/voximplant/sls/ctx/{token}
//
// The sales-closing agent's Voximplant scenario fetches this once at call
// start. Same shape/discipline as mtg/ctx/[token] (which this deliberately
// mirrors) — opaque per-attempt access token in the path is the ONLY
// authorization. READ-ONLY. Every failure path returns the IDENTICAL generic
// 404, same public-rsvp-sentinel discipline as the meeting-booking surface.

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const notFound = () => emptyNoStore(404);

export async function GET(
  req: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;

  const guard = await guardCallContextRequest(req, token, {
    scope: 'vox-sls-ctx',
    tokenShape: 'hex32',
    lookup: getSalesVoiceContextByAccessToken,
  });
  if (!guard.ok) return emptyNoStore(guard.status);
  const { ctx } = guard;

  // Freshness re-verification — same reasoning as mtg/ctx's own comment: a
  // reschedule between dispatch and connect must degrade to the identical
  // generic 404, not a distinguishing status.
  if (
    ctx.request.status !== 'scheduled' ||
    !ctx.request.scheduled_at ||
    ctx.request.scheduled_at !== ctx.attempt.scheduled_at_snapshot
  ) {
    return notFound();
  }

  // First name only — same privacy discipline as mtg/ctx.
  const prospectName = ctx.request.full_name.trim().split(/\s+/)[0] || '';

  let companyName = '';
  let companyId = '';
  let companyAddress = '';
  try {
    const company = await getCompanyLegal();
    companyName = company.name ?? '';
    companyId = company.id ?? '';
    companyAddress = company.address ?? '';
  } catch {
    // Non-fatal: the agent's step-5 legal disclosure degrades to empty
    // values rather than blocking the whole call.
  }

  return jsonNoStore(
    {
      prospect_name: prospectName,
      note_text: ctx.request.note ?? '',
      company_name: companyName,
      company_id: companyId,
      company_address: companyAddress,
      // Non-authorizing correlation id. The scenario injects this into
      // ElevenLabs dynamic variables so post-call analysis can still resolve
      // the sales attempt even if the terminal cb carrying conversation_id is
      // missed.
      // The unified correlation key — see the note on /ctx. Sent beside the
      // old one until every deployed scenario reads the new name.
      kalfa_correlation_id: ctx.attempt.id,
      kalfa_attempt_token: ctx.attempt.id,
      // ⚠️ STAGE-0 PROBE — TEMPORARY. Delete once the question below is answered.
      //
      // WHAT IT PROVES. The generic-voice-primitive plan rests on one unproven
      // premise: that a per-conversation override actually CHANGES BEHAVIOUR.
      // A-8/A-9 established only that ElevenLabs accepts the object and knows
      // the field. No override has ever been observed taking effect here —
      // RSVPAgent's asr.keywords is inaudible, so nobody would have noticed
      // either way.
      //
      // WHY IT NEEDS A REAL CALL. There is no cheaper path, checked:
      // `simulate_conversation` configures the SIMULATED USER, not an override
      // of the agent under test, and `agents_run_tests` uses
      // `agent_config_override` — an ad-hoc full config that bypasses the
      // per-field permission flags entirely, so it proves nothing about them.
      //
      // WHY PLAIN TEXT, NO {{variables}}. Verified 2026-09-15 against the live
      // docs: dynamic variables are documented for the first message CONFIGURED
      // on the agent, and nothing states whether they interpolate inside a
      // first_message sent as an OVERRIDE. A probe containing {{prospect_name}}
      // that came out literal would be ambiguous — override rejected, or
      // interpolation absent? Plain text answers exactly one question.
      //
      // HOW TO RUN IT. Put a sentence here that cannot be confused with the
      // agent's configured opener ("היי {{prospect_name}}, מדבר עומר מִקָלְפָה…"),
      // deploy with `npm run vox:upload:salesclose`, place one call, and LISTEN.
      // The gate is what is heard — per A-13 a disabled flag would fail the
      // call outright, and the flag is enabled on this agent as of 03:30.
      // Then set it back to '' and remove this block.
      //
      // '' MEANS THE KEY IS NOT SENT AT ALL, so production is untouched while
      // it is empty: the scenario omits the whole conversation_config_override
      // when the value is falsy.
      ...(STAGE0_FIRST_MESSAGE_PROBE
        ? { first_message_override: STAGE0_FIRST_MESSAGE_PROBE }
        : {}),
    },
  );
}
