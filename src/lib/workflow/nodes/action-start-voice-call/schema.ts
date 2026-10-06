'use client';

// `action.start_voice_call` — the JSON schema of its properties panel, and the
// factory that offers the installation's live purposes and dial lists. Editor
// side.
import type { NodeSchema } from '@workflowbuilder/sdk';

import {
  actionBranchesProperty,
  errorPolicyOptions,
  identityProperties,
  requiredText,
  statusProperty,
} from '../../catalogue/editor-shared';

import { requiredFields } from './definition';

/**
 * The purpose dropdown is a LIVE LIST, the same way the WhatsApp number picker
 * is: `voice_purposes` rows change without a deploy. `buildPaletteItems` rewrites
 * this one entry, which is why the schema is a factory and the module-scope
 * constant below offers nothing.
 */
export type VoicePurposeOption = { key: string; displayName: string };

/**
 * One dial parameter that is read from the platform rather than typed.
 *
 * The lists behind this shape are LIVE: `provider_numbers` rows for the caller
 * id, Voximplant's own `GetRules` for the rule, and the ElevenLabs agent list for
 * the agent. None is a constant here, for the same reason the purpose dropdown
 * is not — a number bought today or a rule rebound this morning has to appear
 * without a deploy.
 */
export type VoiceDialOption = { value: string; label: string };

/**
 * ⚠️ EVERY DIAL PARAMETER BELOW IS AN OVERRIDE, AND BLANK IS THE DEFAULT.
 *
 * The precedence is fixed here and enforced in `voice-purpose-dispatch.ts`:
 * a non-empty node value wins; blank falls back to what dialled before this
 * node carried the field at all — `voice_purposes.rule_id` for the rule, the
 * account's configured caller id for the number, the guest's own phone for the
 * destination.
 *
 * That direction is chosen, not incidental. The other one (node authoritative,
 * no fallback) would change how every diagram already saved behaves the moment
 * this ships, because none of them carries these fields. An override that
 * defaults to blank changes nothing until someone sets it.
 *
 * ⚠️ AND THESE THREE REACH THE CALL TODAY — verified, not assumed:
 *   • `ruleId`  → `StartScenarios`' own `rule_id` parameter (the live API
 *     reference lists exactly eight parameters: user_id, user_name,
 *     application_id, application_name, rule_id, script_custom_data,
 *     reference_ip, server_location).
 *   • `callerId` → `script_custom_data.from`, which every deployed agent
 *     scenario reads as `state.from = customData.from` and hands straight to
 *     `VoxEngine.callPSTN(state.to, state.from)`.
 *   • `toOverride` → `script_custom_data.to`, the first argument of that same
 *     call.
 * No scenario deploy is needed for any of them.
 *
 * The agent id reaches the call a different way: `agentId` → the ctx response's
 * `agent_id`, which `PurposeAgent.voxengine.js` opens its ElevenLabs client on.
 * The persona scenarios (RSVPAgent, MeetingConfirmAgent, SalesCloseAgent)
 * hardcode `var AGENT_ID = 'agent_…'`, so there the field changes nothing.
 */
export const voiceCallSchemaFor = (
  purposes: readonly VoicePurposeOption[],
  callerIds: readonly VoiceDialOption[] = [],
  rules: readonly VoiceDialOption[] = [],
  agents: readonly VoiceDialOption[] = [],
) =>
  ({
    type: 'object',
    // The definition's own array, not a copy: `NODE_REQUIRED_FIELDS` points at the
    // same object, and `arm-check.test.ts` asserts that identity with `toBe`.
    required: requiredFields,
    properties: {
      ...identityProperties,
      ...statusProperty,
      ...actionBranchesProperty,
      errorPolicy: { type: 'string', options: Object.values(errorPolicyOptions) },
      purposeKey: {
        ...requiredText,
        options: purposes.map((p) => ({ label: p.displayName, value: p.key })),
      },
      // ⚠️ THE EMPTY OPTION IS FIRST AND IT IS NOT A PLACEHOLDER — it is the
      // value that means "leave it to the purpose / the account". A dropdown
      // with no way back to the default would make the first pick permanent.
      callerId: {
        type: 'string',
        options: [{ label: 'ברירת המחדל של החשבון', value: '' }, ...callerIds],
      },
      ruleId: {
        type: 'string',
        options: [{ label: 'הכלל המוגדר לייעוד', value: '' }, ...rules],
      },
      // A `VariableText` control, not a `Text` one: the number to dial is the
      // one dial parameter that legitimately comes from an earlier step
      // (`{{nodes.<id>.phone}}`), and only that control offers the picker.
      toOverride: { type: 'string' },
      // ⚠️ ONLY A RULE THAT RUNS `PurposeAgent` HONOURS THIS. The value is carried
      // end-to-end on the server — node → attempt row → ctx response — and
      // `PurposeAgent.voxengine.js` opens `ElevenLabs.createAgentsClient` on
      // `ctx.agent_id`. The persona scenarios still open it against a hardcoded
      // `AGENT_ID`, so on a rule that runs one of them setting this changes
      // nothing about which agent answers. Arming does not look at it:
      // `voice-node-arm-check.ts` checks the purpose and its rule, never the agent.
      agentId: {
        type: 'string',
        options: [{ label: 'הסוכן המוגדר בתרחיש', value: '' }, ...agents],
      },
      // Off by default, and the default is the point: this node has dialled and
      // carried straight on since it shipped. Making the wait automatic would
      // change how live automations behave without anyone editing them.
      waitForOutcome: { type: 'boolean' },
    },
  }) satisfies NodeSchema;

export const voiceCallSchema = voiceCallSchemaFor([], [], [], []);

export type VoiceCallSchema = typeof voiceCallSchema;
