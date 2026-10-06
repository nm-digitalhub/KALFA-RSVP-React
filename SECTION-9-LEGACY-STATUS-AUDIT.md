# §9 — update_guest_status legacy audit

HEAD: c0de7c82f29dc5873cfc932a698ae1fcd8e3ef41

## Normalizer
```text
```

## update_guest_status implementation
```text
src/lib/workflow/inbound.ts-214- * `''` here silently defeated the fallback an owner had written. See the note on
src/lib/workflow/inbound.ts-215- * `WorkflowTriggerPayload`.
src/lib/workflow/inbound.ts-216- *
src/lib/workflow/inbound.ts-217- * `guestName` is empty when the phone backs more than one guest. Same refusal
src/lib/workflow/inbound.ts:218: * `action.update_guest_status` makes: with several guests behind one contact,
src/lib/workflow/inbound.ts-219- * "whose name" has no answer, and greeting the wrong person by name is worse
src/lib/workflow/inbound.ts-220- * than not greeting at all.
src/lib/workflow/inbound.ts-221- */
src/lib/workflow/inbound.ts-222-export async function resolveTriggerContext(
--
src/lib/workflow/engine/node-budgets.ts-62-    'action.webhook': { timeoutMs: 20_000 },
src/lib/workflow/engine/node-budgets.ts-63-    'action.send_whatsapp': { timeoutMs: 30_000 },
src/lib/workflow/engine/node-budgets.ts-64-    'action.send_template': { timeoutMs: 30_000 },
src/lib/workflow/engine/node-budgets.ts-65-    'action.notify_team': { timeoutMs: 20_000 },
src/lib/workflow/engine/node-budgets.ts:66:    'action.update_guest_status': { timeoutMs: 20_000 },
src/lib/workflow/engine/node-budgets.ts-67-    'action.set_guest_field': { timeoutMs: 20_000 },
src/lib/workflow/engine/node-budgets.ts-68-    'action.create_callback_request': { timeoutMs: 30_000 },
src/lib/workflow/engine/node-budgets.ts-69-    'action.start_voice_call': { timeoutMs: 60_000 },
src/lib/workflow/engine/node-budgets.ts-70-    'action.start_rsvp_ai_callback': { timeoutMs: 60_000 },
--
src/lib/workflow/engine/ports.ts-487-   * simply nothing unambiguous to do.
src/lib/workflow/engine/ports.ts-488-   *
src/lib/workflow/engine/ports.ts-489-   * ריבוי-אורחים: a phone may back several guests, and "whose meal preference?"
src/lib/workflow/engine/ports.ts-490-   * has no answer. The implementation refuses rather than guessing — the same
src/lib/workflow/engine/ports.ts:491:   * rule `action.update_guest_status` and the inbound webhook already follow.
src/lib/workflow/engine/ports.ts-492-   */
src/lib/workflow/engine/ports.ts-493-  setGuestField?(input: {
src/lib/workflow/engine/ports.ts-494-    eventId: string;
src/lib/workflow/engine/ports.ts-495-    contactId: string;
--
src/lib/workflow/engine/dry-run.ts-31-/**
src/lib/workflow/engine/dry-run.ts-32- * How many guests sit behind the pretend contact.
src/lib/workflow/engine/dry-run.ts-33- *
src/lib/workflow/engine/dry-run.ts-34- * This is a real branch, not a curiosity: a phone shared by a couple backs two
src/lib/workflow/engine/dry-run.ts:35: * guest rows, and `update_guest_status` refuses to guess which one a message
src/lib/workflow/engine/dry-run.ts-36- * meant. An owner testing only the happy path would never see that, then wonder
src/lib/workflow/engine/dry-run.ts-37- * in production why a workflow "did nothing".
src/lib/workflow/engine/dry-run.ts-38- */
src/lib/workflow/engine/dry-run.ts-39-export const DRY_RUN_GUEST_CASES = ['one', 'none', 'several'] as const;
--
src/lib/workflow/catalogue/types.ts-24-  'trigger.webhook',
src/lib/workflow/catalogue/types.ts-25-  'trigger.schedule',
src/lib/workflow/catalogue/types.ts-26-  'logic.condition',
src/lib/workflow/catalogue/types.ts-27-  'logic.switch',
src/lib/workflow/catalogue/types.ts:28:  'action.update_guest_status',
src/lib/workflow/catalogue/types.ts-29-  'action.send_whatsapp',
src/lib/workflow/catalogue/types.ts-30-  'action.start_rsvp_ai_callback',
src/lib/workflow/catalogue/types.ts-31-  'action.notify_team',
src/lib/workflow/catalogue/types.ts-32-  'action.webhook',
--
src/lib/workflow/catalogue/types.ts-573-  error: 'source:inner:error',
src/lib/workflow/catalogue/types.ts-574-} as const;
src/lib/workflow/catalogue/types.ts-575-
src/lib/workflow/catalogue/types.ts-576-export type UpdateGuestStatusConfig = {
src/lib/workflow/catalogue/types.ts:577:  // `rsvpStatus`, not `status`: the SDK reserves `status` for the node's own
src/lib/workflow/catalogue/types.ts-578-  // Active / Draft / Disabled lifecycle. See the schema for the full note.
src/lib/workflow/catalogue/types.ts:579:  rsvpStatus: RsvpStatus;
src/lib/workflow/catalogue/types.ts-580-};
src/lib/workflow/catalogue/types.ts-581-
src/lib/workflow/catalogue/types.ts-582-// The reply the workflow sends back to the guest who wrote in.
src/lib/workflow/catalogue/types.ts-583-//
--
src/lib/workflow/catalogue/types.ts-739-
src/lib/workflow/catalogue/types.ts-740-/**
src/lib/workflow/catalogue/types.ts-741- * The guest fields a workflow may write, and the three that are deliberately absent.
src/lib/workflow/catalogue/types.ts-742- *
src/lib/workflow/catalogue/types.ts:743: * NOT `status` — `action.update_guest_status` owns it, and it goes through the
src/lib/workflow/catalogue/types.ts-744- * atomic `submit_rsvp` gate rather than a column write, so no RSVP rule is ever
src/lib/workflow/catalogue/types.ts-745- * reimplemented in a step.
src/lib/workflow/catalogue/types.ts-746- *
src/lib/workflow/catalogue/types.ts-747- * NOT the headcount columns (`expected_count`, `confirmed_adults`,
--
src/lib/workflow/catalogue/types.ts-822-  | { type: 'trigger.webhook'; config: WebhookTriggerConfig }
src/lib/workflow/catalogue/types.ts-823-  | { type: 'trigger.schedule'; config: ScheduleTriggerConfig }
src/lib/workflow/catalogue/types.ts-824-  | { type: 'logic.condition'; config: ConditionConfig }
src/lib/workflow/catalogue/types.ts-825-  | { type: 'logic.switch'; config: SwitchConfig }
src/lib/workflow/catalogue/types.ts:826:  | { type: 'action.update_guest_status'; config: UpdateGuestStatusConfig }
src/lib/workflow/catalogue/types.ts-827-  | { type: 'action.send_whatsapp'; config: SendWhatsappConfig }
src/lib/workflow/catalogue/types.ts-828-  | { type: 'action.start_rsvp_ai_callback'; config: StartRsvpAiCallbackConfig }
src/lib/workflow/catalogue/types.ts-829-  | { type: 'action.notify_team'; config: NotifyTeamConfig }
src/lib/workflow/catalogue/types.ts-830-  | { type: 'action.webhook'; config: WebhookConfig }
--
src/lib/workflow/catalogue/types.ts-872-
src/lib/workflow/catalogue/types.ts-873-/**
src/lib/workflow/catalogue/types.ts-874- * Property keys that were RENAMED, and the older key still found in saved diagrams.
src/lib/workflow/catalogue/types.ts-875- *
src/lib/workflow/catalogue/types.ts:876: * ⚠️ WHY THIS EXISTS AS DATA RATHER THAN AN `if` INSIDE ONE HANDLER. `rsvpStatus`
src/lib/workflow/catalogue/types.ts-877- * was called `status` until the SDK claimed `status` for the node's own lifecycle
src/lib/workflow/catalogue/types.ts-878- * (Active / Draft / Disabled) in the same properties object. Every diagram saved
src/lib/workflow/catalogue/types.ts-879- * before that carries the old key and must keep working untouched.
src/lib/workflow/catalogue/types.ts-880- *
--
src/lib/workflow/catalogue/types.ts-884- *
src/lib/workflow/catalogue/types.ts-885- * Both read this map now, so "which old names still count" is answered once.
src/lib/workflow/catalogue/types.ts-886- */
src/lib/workflow/catalogue/types.ts-887-export const LEGACY_PROPERTY_ALIASES: Readonly<Record<string, string>> = {
src/lib/workflow/catalogue/types.ts:888:  rsvpStatus: 'status',
src/lib/workflow/catalogue/types.ts-889-};
src/lib/workflow/catalogue/types.ts-890-
src/lib/workflow/catalogue/types.ts-891-/**
src/lib/workflow/catalogue/types.ts-892- * Which properties each node type cannot run without.
--
src/lib/workflow/catalogue/types.ts-917-  'logic.condition': ['label', 'description', 'field', 'operator'],
src/lib/workflow/catalogue/types.ts-918-  'logic.switch': ['label', 'description'],
src/lib/workflow/catalogue/types.ts-919-  'logic.wait': ['label', 'description', 'amount', 'unit'],
src/lib/workflow/catalogue/types.ts-920-  'logic.set_value': ['label', 'description', 'value'],
src/lib/workflow/catalogue/types.ts:921:  'action.update_guest_status': ['label', 'description', 'rsvpStatus'],
src/lib/workflow/catalogue/types.ts-922-  'action.send_whatsapp': ['label', 'description', 'body'],
src/lib/workflow/catalogue/types.ts-923-  'action.send_template': ['label', 'description', 'messageKey'],
src/lib/workflow/catalogue/types.ts-924-  'action.start_rsvp_ai_callback': ['label', 'description'],
src/lib/workflow/catalogue/types.ts-925-  'action.notify_team': ['label', 'description', 'title'],
--
src/lib/workflow/catalogue/types.ts-950- * sites in `steps/index.ts`, so a node that gains the guard and is not added
src/lib/workflow/catalogue/types.ts-951- * here fails a test rather than shipping an automation that cannot run.
src/lib/workflow/catalogue/types.ts-952- */
src/lib/workflow/catalogue/types.ts-953-export const GUEST_SCOPED_NODE_TYPES: readonly KalfaNodeType[] = [
src/lib/workflow/catalogue/types.ts:954:  'action.update_guest_status',
src/lib/workflow/catalogue/types.ts-955-  'action.send_whatsapp',
src/lib/workflow/catalogue/types.ts-956-  'action.send_template',
src/lib/workflow/catalogue/types.ts-957-  'action.set_guest_field',
src/lib/workflow/catalogue/types.ts-958-  'action.create_callback_request',
--
src/lib/workflow/adapter/to-definition.ts-141-/**
src/lib/workflow/adapter/to-definition.ts-142- * The node's Active / Draft / Disabled switch.
src/lib/workflow/adapter/to-definition.ts-143- *
src/lib/workflow/adapter/to-definition.ts-144- * Anything unrecognised is treated as ABSENT, not as an error. That matters for
src/lib/workflow/adapter/to-definition.ts:145: * one concrete case: `action.update_guest_status` used to spell the guest's RSVP
src/lib/workflow/adapter/to-definition.ts-146- * value under this same key, so a diagram saved before the rename carries
src/lib/workflow/adapter/to-definition.ts-147- * `status: 'attending'` here. Rejecting it would break those diagrams; reading it
src/lib/workflow/adapter/to-definition.ts-148- * as a lifecycle value would silently disable a live node. Falling back to
src/lib/workflow/adapter/to-definition.ts-149- * `active` does neither.
--
src/lib/workflow/catalogue/nodes.ts-13-  { type: 'trigger.webhook', isTrigger: true },
src/lib/workflow/catalogue/nodes.ts-14-  { type: 'trigger.schedule', isTrigger: true },
src/lib/workflow/catalogue/nodes.ts-15-  { type: 'logic.condition', isTrigger: false },
src/lib/workflow/catalogue/nodes.ts-16-  { type: 'logic.switch', isTrigger: false },
src/lib/workflow/catalogue/nodes.ts:17:  { type: 'action.update_guest_status', isTrigger: false },
src/lib/workflow/catalogue/nodes.ts-18-  { type: 'action.send_whatsapp', isTrigger: false },
src/lib/workflow/catalogue/nodes.ts-19-  { type: 'action.start_rsvp_ai_callback', isTrigger: false },
src/lib/workflow/catalogue/nodes.ts-20-  { type: 'action.notify_team', isTrigger: false },
src/lib/workflow/catalogue/nodes.ts-21-  { type: 'action.webhook', isTrigger: false },
--
src/lib/workflow/catalogue/templates.ts-95-        type: 'node',
src/lib/workflow/catalogue/templates.ts-96-        position: { x: 780, y: 40 },
src/lib/workflow/catalogue/templates.ts-97-        data: {
src/lib/workflow/catalogue/templates.ts-98-          segments: [],
src/lib/workflow/catalogue/templates.ts:99:          type: 'action.update_guest_status',
src/lib/workflow/catalogue/templates.ts-100-          icon: 'UserCheck',
src/lib/workflow/catalogue/templates.ts-101-          properties: {
src/lib/workflow/catalogue/templates.ts-102-            label: 'סמן כמגיע/ה',
src/lib/workflow/catalogue/templates.ts-103-            description: 'קובע את אישור ההגעה של האורח ששלח את ההודעה',
src/lib/workflow/catalogue/templates.ts:104:            rsvpStatus: 'attending',
src/lib/workflow/catalogue/templates.ts-105-            errorPolicy: 'fail',
src/lib/workflow/catalogue/templates.ts-106-          },
src/lib/workflow/catalogue/templates.ts-107-        },
src/lib/workflow/catalogue/templates.ts-108-      },
--
src/lib/workflow/catalogue/templates.ts-111-        type: 'node',
src/lib/workflow/catalogue/templates.ts-112-        position: { x: 780, y: 260 },
src/lib/workflow/catalogue/templates.ts-113-        data: {
src/lib/workflow/catalogue/templates.ts-114-          segments: [],
src/lib/workflow/catalogue/templates.ts:115:          type: 'action.update_guest_status',
src/lib/workflow/catalogue/templates.ts-116-          icon: 'UserCheck',
src/lib/workflow/catalogue/templates.ts-117-          properties: {
src/lib/workflow/catalogue/templates.ts-118-            label: 'סמן כלא מגיע/ה',
src/lib/workflow/catalogue/templates.ts-119-            description: 'קובע את אישור ההגעה של האורח ששלח את ההודעה',
src/lib/workflow/catalogue/templates.ts:120:            rsvpStatus: 'declined',
src/lib/workflow/catalogue/templates.ts-121-            errorPolicy: 'fail',
src/lib/workflow/catalogue/templates.ts-122-          },
src/lib/workflow/catalogue/templates.ts-123-        },
src/lib/workflow/catalogue/templates.ts-124-      },
--
src/lib/workflow/catalogue/templates.ts-218-        type: 'node',
src/lib/workflow/catalogue/templates.ts-219-        position: { x: 740, y: 40 },
src/lib/workflow/catalogue/templates.ts-220-        data: {
src/lib/workflow/catalogue/templates.ts-221-          segments: [],
src/lib/workflow/catalogue/templates.ts:222:          type: 'action.update_guest_status',
src/lib/workflow/catalogue/templates.ts-223-          icon: 'UserCheck',
src/lib/workflow/catalogue/templates.ts-224-          properties: {
src/lib/workflow/catalogue/templates.ts-225-            label: 'סמן כמגיע/ה',
src/lib/workflow/catalogue/templates.ts-226-            description: 'קובע את אישור ההגעה של האורח ששלח את ההודעה',
src/lib/workflow/catalogue/templates.ts:227:            rsvpStatus: 'attending',
src/lib/workflow/catalogue/templates.ts-228-            errorPolicy: 'fail',
src/lib/workflow/catalogue/templates.ts-229-          },
src/lib/workflow/catalogue/templates.ts-230-        },
src/lib/workflow/catalogue/templates.ts-231-      },
--
src/lib/workflow/catalogue/templates.ts-234-        type: 'node',
src/lib/workflow/catalogue/templates.ts-235-        position: { x: 740, y: 300 },
src/lib/workflow/catalogue/templates.ts-236-        data: {
src/lib/workflow/catalogue/templates.ts-237-          segments: [],
src/lib/workflow/catalogue/templates.ts:238:          type: 'action.update_guest_status',
src/lib/workflow/catalogue/templates.ts-239-          icon: 'UserCheck',
src/lib/workflow/catalogue/templates.ts-240-          properties: {
src/lib/workflow/catalogue/templates.ts-241-            label: 'סמן כלא מגיע/ה',
src/lib/workflow/catalogue/templates.ts-242-            description: 'קובע את אישור ההגעה של האורח ששלח את ההודעה',
src/lib/workflow/catalogue/templates.ts:243:            rsvpStatus: 'declined',
src/lib/workflow/catalogue/templates.ts-244-            errorPolicy: 'fail',
src/lib/workflow/catalogue/templates.ts-245-          },
src/lib/workflow/catalogue/templates.ts-246-        },
src/lib/workflow/catalogue/templates.ts-247-      },
--
src/lib/workflow/catalogue/templates.ts-525-        type: 'node',
src/lib/workflow/catalogue/templates.ts-526-        position: { x: 760, y: 40 },
src/lib/workflow/catalogue/templates.ts-527-        data: {
src/lib/workflow/catalogue/templates.ts-528-          segments: [],
src/lib/workflow/catalogue/templates.ts:529:          type: 'action.update_guest_status',
src/lib/workflow/catalogue/templates.ts-530-          icon: 'UserCheck',
src/lib/workflow/catalogue/templates.ts-531-          properties: {
src/lib/workflow/catalogue/templates.ts-532-            label: 'סמן כמגיע/ה',
src/lib/workflow/catalogue/templates.ts-533-            description: 'קובע את אישור ההגעה של האורח ששלח את ההודעה',
src/lib/workflow/catalogue/templates.ts:534:            rsvpStatus: 'attending',
src/lib/workflow/catalogue/templates.ts-535-            errorPolicy: 'fail',
src/lib/workflow/catalogue/templates.ts-536-          },
src/lib/workflow/catalogue/templates.ts-537-        },
src/lib/workflow/catalogue/templates.ts-538-      },
--
src/lib/workflow/catalogue/templates.ts-559-        type: 'node',
src/lib/workflow/catalogue/templates.ts-560-        position: { x: 760, y: 200 },
src/lib/workflow/catalogue/templates.ts-561-        data: {
src/lib/workflow/catalogue/templates.ts-562-          segments: [],
src/lib/workflow/catalogue/templates.ts:563:          type: 'action.update_guest_status',
src/lib/workflow/catalogue/templates.ts-564-          icon: 'UserCheck',
src/lib/workflow/catalogue/templates.ts-565-          properties: {
src/lib/workflow/catalogue/templates.ts-566-            label: 'סמן כלא מגיע/ה',
src/lib/workflow/catalogue/templates.ts-567-            description: 'קובע את אישור ההגעה של האורח ששלח את ההודעה',
src/lib/workflow/catalogue/templates.ts:568:            rsvpStatus: 'declined',
src/lib/workflow/catalogue/templates.ts-569-            errorPolicy: 'fail',
src/lib/workflow/catalogue/templates.ts-570-          },
src/lib/workflow/catalogue/templates.ts-571-        },
src/lib/workflow/catalogue/templates.ts-572-      },
--
src/lib/workflow/catalogue/templates.ts-724- * out here rather than left to the default. A template that shipped with the
src/lib/workflow/catalogue/templates.ts-725- * default would load, look right, and never fire once.
src/lib/workflow/catalogue/templates.ts-726- *
src/lib/workflow/catalogue/templates.ts-727- * NO GUEST NODES ANYWHERE IN IT, and none would work: the sender is the owner,
src/lib/workflow/catalogue/templates.ts:728: * so the run carries no contact and `update_guest_status`, `send_whatsapp`,
src/lib/workflow/catalogue/templates.ts-729- * `set_guest_field` and the rest all refuse inside it by design. `notify_team`
src/lib/workflow/catalogue/templates.ts-730- * and `webhook` are the actions available here.
src/lib/workflow/catalogue/templates.ts-731- *
src/lib/workflow/catalogue/templates.ts-732- * IT DOES NOT REPLACE THE HARD-CODED IMPORT — both run, and they share one
--
src/lib/workflow/catalogue/arm-check.ts-324-    }
src/lib/workflow/catalogue/arm-check.ts-325-
src/lib/workflow/catalogue/arm-check.ts-326-    for (const key of required) {
src/lib/workflow/catalogue/arm-check.ts-327-      // The pre-rename key counts. A diagram saved before `status` became
src/lib/workflow/catalogue/arm-check.ts:328:      // `rsvpStatus` still RUNS — the handler reads both — so refusing to arm it
src/lib/workflow/catalogue/arm-check.ts-329-      // would be this check inventing a rule the engine does not have.
src/lib/workflow/catalogue/arm-check.ts-330-      const alias = LEGACY_PROPERTY_ALIASES[key];
src/lib/workflow/catalogue/arm-check.ts-331-      const value = properties[key] ?? (alias ? properties[alias] : undefined);
src/lib/workflow/catalogue/arm-check.ts-332-      const range = ranges[key];
--
src/lib/workflow/catalogue/arm-check.ts-431- *
src/lib/workflow/catalogue/arm-check.ts-432- * ⚠️ AN UNRECOGNISED VALUE IS `active`, NEVER A BLOCK — and this is not
src/lib/workflow/catalogue/arm-check.ts-433- * theoretical. MEASURED in production on 2026-09-14: two stored nodes carry
src/lib/workflow/catalogue/arm-check.ts-434- * `status: 'attending'` / `'declined'`, the RSVP value from before that field was
src/lib/workflow/catalogue/arm-check.ts:435: * renamed to `rsvpStatus`. Treating an unknown string as "not active" would
src/lib/workflow/catalogue/arm-check.ts-436- * refuse to arm a workflow that runs correctly; the adapter's `readNodeStatus`
src/lib/workflow/catalogue/arm-check.ts-437- * makes the same choice for the same reason.
src/lib/workflow/catalogue/arm-check.ts-438- */
src/lib/workflow/catalogue/arm-check.ts-439-function readNodeStatus(value: unknown): string | undefined {
--
src/lib/workflow/steps/index.ts-60- * reads exactly like a manual one, household rows included ("משפחת כהן" yields
src/lib/workflow/steps/index.ts-61- * nothing rather than greeting "שלום משפחת,").
src/lib/workflow/steps/index.ts-62- *
src/lib/workflow/steps/index.ts-63- * It is EMPTY when the phone backs more than one guest. That is the same
src/lib/workflow/steps/index.ts:64: * refusal `action.update_guest_status` makes, for the same reason: with several
src/lib/workflow/steps/index.ts-65- * guests behind one contact there is no answer to "whose name", and greeting
src/lib/workflow/steps/index.ts-66- * the wrong person by name is worse than not greeting at all.
src/lib/workflow/steps/index.ts-67- *
src/lib/workflow/steps/index.ts-68- * ON PII. These land in `workflow_runs.trigger_payload` and in the
--
src/lib/workflow/steps/index.ts-515-  return { output: { matched: false, branch: null }, nextPort: fallback };
src/lib/workflow/steps/index.ts-516-};
src/lib/workflow/steps/index.ts-517-
src/lib/workflow/steps/index.ts-518-// ---------------------------------------------------------------------------
src/lib/workflow/steps/index.ts:519:// action.update_guest_status
src/lib/workflow/steps/index.ts-520-// ---------------------------------------------------------------------------
src/lib/workflow/steps/index.ts-521-
src/lib/workflow/steps/index.ts-522-// The first real side effect, and deliberately one that sends nothing outward:
src/lib/workflow/steps/index.ts-523-// it changes a row we own. `send_whatsapp` is the next node, once this chain is
src/lib/workflow/steps/index.ts-524-// proven end to end.
src/lib/workflow/steps/index.ts-525-const updateGuestStatus: StepHandler = async (config, ctx) => {
src/lib/workflow/steps/index.ts:526:  // `rsvpStatus` first, `status` second. The key was renamed when the SDK's own
src/lib/workflow/steps/index.ts-527-  // node-lifecycle `status` — Active / Draft / Disabled — moved into the same
src/lib/workflow/steps/index.ts-528-  // properties object; every diagram saved before that carries the old name and
src/lib/workflow/steps/index.ts-529-  // has to keep working untouched.
src/lib/workflow/steps/index.ts-530-  const status: RsvpStatus = readEnum(
src/lib/workflow/steps/index.ts:531:    'rsvpStatus' in config
src/lib/workflow/steps/index.ts-532-      ? config
src/lib/workflow/steps/index.ts:533:      : { ...config, rsvpStatus: config[LEGACY_PROPERTY_ALIASES.rsvpStatus!] },
src/lib/workflow/steps/index.ts:534:    'rsvpStatus',
src/lib/workflow/steps/index.ts-535-    RSVP_STATUSES,
src/lib/workflow/steps/index.ts:536:    'action.update_guest_status',
src/lib/workflow/steps/index.ts-537-  );
src/lib/workflow/steps/index.ts-538-
src/lib/workflow/steps/index.ts:539:  const { eventId, contactId } = requireGuestContext(ctx, 'action.update_guest_status');
src/lib/workflow/steps/index.ts-540-  const guests = await ctx.deps.guests.getGuestsForContact(eventId, contactId);
src/lib/workflow/steps/index.ts-541-
src/lib/workflow/steps/index.ts-542-  // ריבוי-אורחים: a phone may back several guests, and "who did this message
src/lib/workflow/steps/index.ts-543-  // mean?" has no answer. The inbound webhook refuses to guess (C9 in
--
src/lib/workflow/steps/index.ts-861-// come back 131047 ("re-engagement required"). When either lands, this handler
src/lib/workflow/steps/index.ts-862-// needs a template fallback — not a comment.
src/lib/workflow/steps/index.ts-863-//
src/lib/workflow/steps/index.ts-864-// A refusal is a COMPLETED step with `skipped: true`, matching
src/lib/workflow/steps/index.ts:865:// `action.update_guest_status`: nothing went wrong in the graph, the message
src/lib/workflow/steps/index.ts-866-// simply had nowhere to go, and the run log says which of the three reasons it
src/lib/workflow/steps/index.ts-867-// was.
src/lib/workflow/steps/index.ts-868-const sendWhatsapp: StepHandler = async (config, ctx) => {
src/lib/workflow/steps/index.ts-869-  const body = readString(config, 'body').trim();
--
src/lib/workflow/steps/index.ts-1045-// each other.
src/lib/workflow/steps/index.ts-1046-//
src/lib/workflow/steps/index.ts-1047-// ריבוי-אורחים: a phone may back several guests, and "whose meal preference?" has
src/lib/workflow/steps/index.ts-1048-// no answer. Reported as a COMPLETED step with `skipped: true`, not a failure —
src/lib/workflow/steps/index.ts:1049:// the same shape `action.update_guest_status` uses, because nothing went wrong
src/lib/workflow/steps/index.ts-1050-// and there was simply nothing unambiguous to do.
src/lib/workflow/steps/index.ts-1051-const setGuestField: StepHandler = async (config, ctx) => {
src/lib/workflow/steps/index.ts-1052-  const field = readEnum(config, 'field', GUEST_FIELDS, 'action.set_guest_field');
src/lib/workflow/steps/index.ts-1053-  // Already resolved: `resolveConfigTemplates` walked the config first, so this
--
src/lib/workflow/steps/index.ts-1581-  'trigger.webhook': webhookTrigger,
src/lib/workflow/steps/index.ts-1582-  'trigger.schedule': scheduleTrigger,
src/lib/workflow/steps/index.ts-1583-  'logic.condition': condition,
src/lib/workflow/steps/index.ts-1584-  'logic.switch': switchNode,
src/lib/workflow/steps/index.ts:1585:  'action.update_guest_status': updateGuestStatus,
src/lib/workflow/steps/index.ts-1586-  'action.send_whatsapp': sendWhatsapp,
src/lib/workflow/steps/index.ts-1587-  'action.start_rsvp_ai_callback': startRsvpAiCallback,
src/lib/workflow/steps/index.ts-1588-  'action.start_voice_call': startVoiceCall,
src/lib/workflow/steps/index.ts-1589-  'action.notify_team': notifyTeam,
--
src/lib/workflow/guest-actions.ts-243-
src/lib/workflow/guest-actions.ts-244-    async setGuestField({ eventId, contactId, field, value }) {
src/lib/workflow/guest-actions.ts-245-      // ONE guest, or none. A phone may back several (guests.contact_id is not
src/lib/workflow/guest-actions.ts-246-      // unique) and "whose meal preference?" has no answer — the same refusal
src/lib/workflow/guest-actions.ts:247:      // the inbound webhook and update_guest_status already make.
src/lib/workflow/guest-actions.ts-248-      const guests = await getGuestsForContact(eventId, contactId);
src/lib/workflow/guest-actions.ts-249-      if (guests.length === 0) return { ok: false, reason: 'no_guest_for_contact' };
src/lib/workflow/guest-actions.ts-250-      if (guests.length > 1) return { ok: false, reason: 'multiple_guests_for_contact' };
src/lib/workflow/guest-actions.ts-251-
--
src/lib/workflow/catalogue/schemas.ts-320-} as const;
src/lib/workflow/catalogue/schemas.ts-321-
src/lib/workflow/catalogue/schemas.ts-322-const callbackTopicOptions = CALLBACK_TOPICS.map((value) => ({ label: value, value }));
src/lib/workflow/catalogue/schemas.ts-323-
src/lib/workflow/catalogue/schemas.ts:324:const rsvpStatusOptions = {
src/lib/workflow/catalogue/schemas.ts-325-  attending: { label: 'מגיע/ה', value: RSVP_STATUSES[0] },
src/lib/workflow/catalogue/schemas.ts-326-  declined: { label: 'לא מגיע/ה', value: RSVP_STATUSES[1] },
src/lib/workflow/catalogue/schemas.ts-327-  maybe: { label: 'אולי', value: RSVP_STATUSES[2] },
src/lib/workflow/catalogue/schemas.ts-328-} as const;
--
src/lib/workflow/catalogue/schemas.ts-898-  ],
src/lib/workflow/catalogue/schemas.ts-899-};
src/lib/workflow/catalogue/schemas.ts-900-
src/lib/workflow/catalogue/schemas.ts-901-// ---------------------------------------------------------------------------
src/lib/workflow/catalogue/schemas.ts:902:// action.update_guest_status
src/lib/workflow/catalogue/schemas.ts-903-// ---------------------------------------------------------------------------
src/lib/workflow/catalogue/schemas.ts-904-
src/lib/workflow/catalogue/schemas.ts-905-const updateGuestStatusSchema = {
src/lib/workflow/catalogue/schemas.ts-906-  type: 'object',
src/lib/workflow/catalogue/schemas.ts:907:  // `rsvpStatus`, not `status`. The SDK reserves `status` for the node's own
src/lib/workflow/catalogue/schemas.ts-908-  // Active/Draft/Disabled lifecycle — it is in `statusOptions` and drives the
src/lib/workflow/catalogue/schemas.ts-909-  // status badge — and this node happened to have picked the same word for the
src/lib/workflow/catalogue/schemas.ts-910-  // guest's RSVP. Two different meanings under one key in one object is a bug
src/lib/workflow/catalogue/schemas.ts-911-  // waiting for whoever reads it next, so ours moved. `readRsvpStatus` in the
src/lib/workflow/catalogue/schemas.ts-912-  // handler still accepts the old key, because diagrams saved before this carry
src/lib/workflow/catalogue/schemas.ts-913-  // it.
src/lib/workflow/catalogue/schemas.ts:914:  required: NODE_REQUIRED_FIELDS['action.update_guest_status'],
src/lib/workflow/catalogue/schemas.ts-915-  properties: {
src/lib/workflow/catalogue/schemas.ts-916-    ...identityProperties,
src/lib/workflow/catalogue/schemas.ts-917-    ...statusProperty,
src/lib/workflow/catalogue/schemas.ts-918-    ...actionBranchesProperty,
src/lib/workflow/catalogue/schemas.ts:919:    rsvpStatus: { ...requiredText, options: Object.values(rsvpStatusOptions) },
src/lib/workflow/catalogue/schemas.ts-920-    // Surfaced on THIS node only. Upstream's guidance is to spread the fragment
src/lib/workflow/catalogue/schemas.ts-921-    // "on node types that should surface the choice; omit it elsewhere — the
src/lib/workflow/catalogue/schemas.ts-922-    // runner defaults to 'fail' when the field is absent."
src/lib/workflow/catalogue/schemas.ts-923-    //
--
src/lib/workflow/catalogue/schemas.ts-937-  elements: [
src/lib/workflow/catalogue/schemas.ts-938-    ...identityControls(updateGuestStatusScope('properties.label'), updateGuestStatusScope('properties.description')),
src/lib/workflow/catalogue/schemas.ts-939-    {
src/lib/workflow/catalogue/schemas.ts-940-      type: 'Select',
src/lib/workflow/catalogue/schemas.ts:941:      scope: updateGuestStatusScope('properties.rsvpStatus'),
src/lib/workflow/catalogue/schemas.ts-942-      label: 'הסטטוס החדש',
src/lib/workflow/catalogue/schemas.ts-943-    },
src/lib/workflow/catalogue/schemas.ts-944-    {
src/lib/workflow/catalogue/schemas.ts-945-      type: 'Select',
--
src/lib/workflow/catalogue/schemas.ts-1453-          type: 'Text',
src/lib/workflow/catalogue/schemas.ts-1454-          scope: forEachGuestScope('properties.statuses'),
src/lib/workflow/catalogue/schemas.ts-1455-          options: {
src/lib/workflow/catalogue/schemas.ts-1456-            format: CHECKBOX_LIST_FORMAT,
src/lib/workflow/catalogue/schemas.ts:1457:            choices: Object.values(rsvpStatusOptions).map((o) => ({ value: o.value, label: o.label })),
src/lib/workflow/catalogue/schemas.ts-1458-            defaultNote: 'ברירת מחדל: כל הסטטוסים.',
src/lib/workflow/catalogue/schemas.ts-1459-          },
src/lib/workflow/catalogue/schemas.ts-1460-        },
src/lib/workflow/catalogue/schemas.ts-1461-        {
--
src/lib/workflow/catalogue/schemas.ts-2203-      ],
src/lib/workflow/catalogue/schemas.ts-2204-    },
src/lib/workflow/catalogue/schemas.ts-2205-  },
src/lib/workflow/catalogue/schemas.ts-2206-  {
src/lib/workflow/catalogue/schemas.ts:2207:    type: 'action.update_guest_status' satisfies KalfaNodeType,
src/lib/workflow/catalogue/schemas.ts-2208-    // Rendered as a decision node so the failure branch has a handle to leave
src/lib/workflow/catalogue/schemas.ts-2209-    // from. Without it `errorPolicy: 'errorRoute'` names a port no edge carries,
src/lib/workflow/catalogue/schemas.ts-2210-    // which is a guaranteed dead end — the reason the option was withheld.
src/lib/workflow/catalogue/schemas.ts-2211-    templateType: NodeType.DecisionNode,
--
src/lib/workflow/catalogue/schemas.ts-2225-      decisionBranches: actionBranches.map((branch) => ({ ...branch })),
src/lib/workflow/catalogue/schemas.ts-2226-      status: nodeStatusOptions.active.value,
src/lib/workflow/catalogue/schemas.ts-2227-      label: 'עדכון סטטוס אורח',
src/lib/workflow/catalogue/schemas.ts-2228-      description: 'קובע את אישור ההגעה של האורח ששלח את ההודעה',
src/lib/workflow/catalogue/schemas.ts:2229:      rsvpStatus: rsvpStatusOptions.attending.value,
src/lib/workflow/catalogue/schemas.ts-2230-      errorPolicy: errorPolicyOptions.fail.value,
src/lib/workflow/catalogue/schemas.ts-2231-    },
src/lib/workflow/catalogue/schemas.ts-2232-  },
src/lib/workflow/catalogue/schemas.ts-2233-  {
```

## Relevant tests
```text
src/app/(admin)/admin/workflows/[id]/arm-blocker-markers.test.ts-10-import { PALETTE_ITEMS } from '@/lib/workflow/catalogue/schemas';
src/app/(admin)/admin/workflows/[id]/arm-blocker-markers.test.ts-11-
src/app/(admin)/admin/workflows/[id]/arm-blocker-markers.test.ts-12-import { stripComputedErrors } from './arm-blocker-markers';
src/app/(admin)/admin/workflows/[id]/arm-blocker-markers.test.ts:13:import { normalizeLegacyProperties } from './normalize-legacy-properties';
src/app/(admin)/admin/workflows/[id]/arm-blocker-markers.test.ts-14-
src/app/(admin)/admin/workflows/[id]/arm-blocker-markers.test.ts-15-const node = (type: string, properties: Record<string, unknown>) => ({
src/app/(admin)/admin/workflows/[id]/arm-blocker-markers.test.ts-16-  id: 'n1',
--
src/app/(admin)/admin/workflows/[id]/arm-blocker-markers.test.ts-76-  });
src/app/(admin)/admin/workflows/[id]/arm-blocker-markers.test.ts-77-});
src/app/(admin)/admin/workflows/[id]/arm-blocker-markers.test.ts-78-
src/app/(admin)/admin/workflows/[id]/arm-blocker-markers.test.ts:79:describe('normalizeLegacyProperties', () => {
src/app/(admin)/admin/workflows/[id]/arm-blocker-markers.test.ts-80-  it('⚠️ repairs the exact shape stored on the live ARMED workflow', () => {
src/app/(admin)/admin/workflows/[id]/arm-blocker-markers.test.ts-81-    // "קליטת רשימת אורחים מוואטסאפ", is_active = true, stored with bare strings.
src/app/(admin)/admin/workflows/[id]/arm-blocker-markers.test.ts-82-    // Its stored `errors` reads: Instance type "string" is invalid. Expected
src/app/(admin)/admin/workflows/[id]/arm-blocker-markers.test.ts-83-    // "object" — an armed workflow marked invalid while running correctly,
src/app/(admin)/admin/workflows/[id]/arm-blocker-markers.test.ts-84-    // because `matchesKind` accepts both shapes and the schema does not.
src/app/(admin)/admin/workflows/[id]/arm-blocker-markers.test.ts:85:    const [repaired] = normalizeLegacyProperties(
src/app/(admin)/admin/workflows/[id]/arm-blocker-markers.test.ts-86-      [node('trigger.whatsapp_inbound', { label: 't', messageKinds: ['text', 'button'] })],
src/app/(admin)/admin/workflows/[id]/arm-blocker-markers.test.ts-87-      PALETTE_ITEMS,
src/app/(admin)/admin/workflows/[id]/arm-blocker-markers.test.ts-88-    );
--
src/app/(admin)/admin/workflows/[id]/arm-blocker-markers.test.ts-100-    const before = { label: 'ט', description: 'ת', messageKinds: ['text'] };
src/app/(admin)/admin/workflows/[id]/arm-blocker-markers.test.ts-101-    expect(new Validator(schema as object).validate(before).valid).toBe(false);
src/app/(admin)/admin/workflows/[id]/arm-blocker-markers.test.ts-102-
src/app/(admin)/admin/workflows/[id]/arm-blocker-markers.test.ts:103:    const [repaired] = normalizeLegacyProperties(
src/app/(admin)/admin/workflows/[id]/arm-blocker-markers.test.ts-104-      [node('trigger.whatsapp_inbound', before)],
src/app/(admin)/admin/workflows/[id]/arm-blocker-markers.test.ts-105-      PALETTE_ITEMS,
src/app/(admin)/admin/workflows/[id]/arm-blocker-markers.test.ts-106-    );
--
src/app/(admin)/admin/workflows/[id]/arm-blocker-markers.test.ts-113-    const current = node('trigger.whatsapp_inbound', {
src/app/(admin)/admin/workflows/[id]/arm-blocker-markers.test.ts-114-      messageKinds: [{ value: 'text' }],
src/app/(admin)/admin/workflows/[id]/arm-blocker-markers.test.ts-115-    });
src/app/(admin)/admin/workflows/[id]/arm-blocker-markers.test.ts:116:    expect(normalizeLegacyProperties([current], PALETTE_ITEMS)[0]).toBe(current);
src/app/(admin)/admin/workflows/[id]/arm-blocker-markers.test.ts-117-  });
src/app/(admin)/admin/workflows/[id]/arm-blocker-markers.test.ts-118-
src/app/(admin)/admin/workflows/[id]/arm-blocker-markers.test.ts-119-  it('repairs a mixed array without disturbing the objects in it', () => {
src/app/(admin)/admin/workflows/[id]/arm-blocker-markers.test.ts:120:    const [repaired] = normalizeLegacyProperties(
src/app/(admin)/admin/workflows/[id]/arm-blocker-markers.test.ts-121-      [node('trigger.whatsapp_inbound', { messageKinds: [{ value: 'text' }, 'button'] })],
src/app/(admin)/admin/workflows/[id]/arm-blocker-markers.test.ts-122-      PALETTE_ITEMS,
src/app/(admin)/admin/workflows/[id]/arm-blocker-markers.test.ts-123-    );
--
src/app/(admin)/admin/workflows/[id]/arm-blocker-markers.test.ts-130-  it('covers every array-of-objects field, not a hardcoded list', () => {
src/app/(admin)/admin/workflows/[id]/arm-blocker-markers.test.ts-131-    // `days` on the schedule trigger is the second one, and it was never named
src/app/(admin)/admin/workflows/[id]/arm-blocker-markers.test.ts-132-    // in this module — the fields come from each node type's own schema.
src/app/(admin)/admin/workflows/[id]/arm-blocker-markers.test.ts:133:    const [repaired] = normalizeLegacyProperties(
src/app/(admin)/admin/workflows/[id]/arm-blocker-markers.test.ts-134-      [node('trigger.schedule', { time: '09:00', days: ['sunday', 'monday'] })],
src/app/(admin)/admin/workflows/[id]/arm-blocker-markers.test.ts-135-      PALETTE_ITEMS,
src/app/(admin)/admin/workflows/[id]/arm-blocker-markers.test.ts-136-    );
--
src/app/(admin)/admin/workflows/[id]/arm-blocker-markers.test.ts-144-    // `maxGuests: '25'` runs correctly: the handler reads `Number(rawMax)` and
src/app/(admin)/admin/workflows/[id]/arm-blocker-markers.test.ts-145-    // `findArmBlockers` coerces the same way. Only the schema objects, because
src/app/(admin)/admin/workflows/[id]/arm-blocker-markers.test.ts-146-    // it declares `type: 'number'`. A working node wearing an error badge.
src/app/(admin)/admin/workflows/[id]/arm-blocker-markers.test.ts:147:    const [repaired] = normalizeLegacyProperties(
src/app/(admin)/admin/workflows/[id]/arm-blocker-markers.test.ts-148-      [node('action.start_for_each_guest', { maxGuests: '25' })],
src/app/(admin)/admin/workflows/[id]/arm-blocker-markers.test.ts-149-      PALETTE_ITEMS,
src/app/(admin)/admin/workflows/[id]/arm-blocker-markers.test.ts-150-    );
--
src/app/(admin)/admin/workflows/[id]/arm-blocker-markers.test.ts-167-
src/app/(admin)/admin/workflows/[id]/arm-blocker-markers.test.ts-168-  it('leaves a blank string alone — the required check is what should speak', () => {
src/app/(admin)/admin/workflows/[id]/arm-blocker-markers.test.ts-169-    const blank = node('action.start_for_each_guest', { maxGuests: '' });
src/app/(admin)/admin/workflows/[id]/arm-blocker-markers.test.ts:170:    expect(normalizeLegacyProperties([blank], PALETTE_ITEMS)[0]).toBe(blank);
src/app/(admin)/admin/workflows/[id]/arm-blocker-markers.test.ts-171-  });
src/app/(admin)/admin/workflows/[id]/arm-blocker-markers.test.ts-172-
src/app/(admin)/admin/workflows/[id]/arm-blocker-markers.test.ts-173-  it('leaves a string that is not entirely a number — reading 25 out of it would invent intent', () => {
src/app/(admin)/admin/workflows/[id]/arm-blocker-markers.test.ts-174-    const messy = node('action.start_for_each_guest', { maxGuests: '25 guests' });
src/app/(admin)/admin/workflows/[id]/arm-blocker-markers.test.ts:175:    expect(normalizeLegacyProperties([messy], PALETTE_ITEMS)[0]).toBe(messy);
src/app/(admin)/admin/workflows/[id]/arm-blocker-markers.test.ts-176-  });
src/app/(admin)/admin/workflows/[id]/arm-blocker-markers.test.ts-177-
src/app/(admin)/admin/workflows/[id]/arm-blocker-markers.test.ts-178-  it('leaves a value that is already a number, by reference', () => {
src/app/(admin)/admin/workflows/[id]/arm-blocker-markers.test.ts-179-    const fine = node('action.start_for_each_guest', { maxGuests: 25 });
src/app/(admin)/admin/workflows/[id]/arm-blocker-markers.test.ts:180:    expect(normalizeLegacyProperties([fine], PALETTE_ITEMS)[0]).toBe(fine);
src/app/(admin)/admin/workflows/[id]/arm-blocker-markers.test.ts-181-  });
src/app/(admin)/admin/workflows/[id]/arm-blocker-markers.test.ts-182-
src/app/(admin)/admin/workflows/[id]/arm-blocker-markers.test.ts-183-  it('leaves a node type the palette does not know', () => {
src/app/(admin)/admin/workflows/[id]/arm-blocker-markers.test.ts-184-    const unknown = node('action.from_the_future', { messageKinds: ['text'] });
src/app/(admin)/admin/workflows/[id]/arm-blocker-markers.test.ts:185:    expect(normalizeLegacyProperties([unknown], PALETTE_ITEMS)[0]).toBe(unknown);
src/app/(admin)/admin/workflows/[id]/arm-blocker-markers.test.ts-186-  });
src/app/(admin)/admin/workflows/[id]/arm-blocker-markers.test.ts-187-
src/app/(admin)/admin/workflows/[id]/arm-blocker-markers.test.ts-188-  it('leaves a non-array value alone rather than guessing at it', () => {
src/app/(admin)/admin/workflows/[id]/arm-blocker-markers.test.ts-189-    const odd = node('trigger.whatsapp_inbound', { messageKinds: 'text' });
src/app/(admin)/admin/workflows/[id]/arm-blocker-markers.test.ts:190:    expect(normalizeLegacyProperties([odd], PALETTE_ITEMS)[0]).toBe(odd);
src/app/(admin)/admin/workflows/[id]/arm-blocker-markers.test.ts-191-  });
src/app/(admin)/admin/workflows/[id]/arm-blocker-markers.test.ts-192-});
--
src/lib/workflow/trigger.test.ts-87-          type: 'node',
src/lib/workflow/trigger.test.ts-88-          position: { x: 0, y: 0 },
src/lib/workflow/trigger.test.ts-89-          data: {
src/lib/workflow/trigger.test.ts:90:            type: 'action.update_guest_status',
src/lib/workflow/trigger.test.ts-91-            icon: 'UserCheck',
src/lib/workflow/trigger.test.ts-92-            properties: { status: 'attending' },
src/lib/workflow/trigger.test.ts-93-            role: 'start',
--
src/lib/workflow/catalogue/unblocked.test.ts-47-            operator: 'ends_with',
src/lib/workflow/catalogue/unblocked.test.ts-48-            value: 'דנה',
src/lib/workflow/catalogue/unblocked.test.ts-49-          }),
src/lib/workflow/catalogue/unblocked.test.ts:50:          node('yes', 'action.update_guest_status', { rsvpStatus: 'attending' }),
src/lib/workflow/catalogue/unblocked.test.ts-51-        ],
src/lib/workflow/catalogue/unblocked.test.ts-52-        [
src/lib/workflow/catalogue/unblocked.test.ts-53-          edge('e1', 't', 'compose'),
--
src/lib/workflow/catalogue/unblocked.test.ts-121-      diagram(
src/lib/workflow/catalogue/unblocked.test.ts-122-        [
src/lib/workflow/catalogue/unblocked.test.ts-123-          node('t', 'trigger.whatsapp_inbound'),
src/lib/workflow/catalogue/unblocked.test.ts:124:          node('a', 'action.update_guest_status', { rsvpStatus: 'attending' }),
src/lib/workflow/catalogue/unblocked.test.ts-125-          node('rescue', 'action.notify_team', { title: 'נכשל', detail: '', level: 'error' }),
src/lib/workflow/catalogue/unblocked.test.ts-126-        ],
src/lib/workflow/catalogue/unblocked.test.ts-127-        [
--
src/lib/workflow/catalogue/unblocked.test.ts-193-    diagram(
src/lib/workflow/catalogue/unblocked.test.ts-194-      [
src/lib/workflow/catalogue/unblocked.test.ts-195-        node('t', 'trigger.whatsapp_inbound'),
src/lib/workflow/catalogue/unblocked.test.ts:196:        node('a', 'action.update_guest_status', { rsvpStatus: 'attending', status }),
src/lib/workflow/catalogue/unblocked.test.ts-197-        node('after', 'action.notify_team', { title: 'אחרי', detail: '', level: 'info' }),
src/lib/workflow/catalogue/unblocked.test.ts-198-      ],
src/lib/workflow/catalogue/unblocked.test.ts-199-      [edge('e1', 't', 'a'), edge('e2', 'a', 'after')],
--
src/lib/workflow/catalogue/unblocked.test.ts-243-      storedDefinition: diagram(
src/lib/workflow/catalogue/unblocked.test.ts-244-        [
src/lib/workflow/catalogue/unblocked.test.ts-245-          node('t', 'trigger.whatsapp_inbound'),
src/lib/workflow/catalogue/unblocked.test.ts:246:          node('a', 'action.update_guest_status', { status: 'attending' }),
src/lib/workflow/catalogue/unblocked.test.ts-247-        ],
src/lib/workflow/catalogue/unblocked.test.ts-248-        [edge('e1', 't', 'a')],
src/lib/workflow/catalogue/unblocked.test.ts-249-      ),
--
src/lib/workflow/catalogue/guest-context.test.ts-51-
src/lib/workflow/catalogue/guest-context.test.ts-52-/** Enough config that the FIELD checks pass, so only the guest rule can fire. */
src/lib/workflow/catalogue/guest-context.test.ts-53-const FILLED: Record<string, Record<string, unknown>> = {
src/lib/workflow/catalogue/guest-context.test.ts:54:  'action.update_guest_status': { rsvpStatus: 'attending' },
src/lib/workflow/catalogue/guest-context.test.ts-55-  'action.send_whatsapp': { body: 'שלום' },
src/lib/workflow/catalogue/guest-context.test.ts-56-  'action.send_template': { messageKey: 'reminder_1' },
src/lib/workflow/catalogue/guest-context.test.ts-57-  'action.set_guest_field': { field: 'meal_pref' },
--
src/lib/workflow/catalogue/arm-check.test.ts-65-  });
src/lib/workflow/catalogue/arm-check.test.ts-66-
src/lib/workflow/catalogue/arm-check.test.ts-67-  it('⚠️ accepts the PRE-RENAME key, because the handler does', () => {
src/lib/workflow/catalogue/arm-check.test.ts:68:    // MEASURED AGAINST THE LIVE DATABASE. `rsvpStatus` was called `status` until
src/lib/workflow/catalogue/arm-check.test.ts-69-    // the SDK claimed `status` for the node's own lifecycle. A diagram saved
src/lib/workflow/catalogue/arm-check.test.ts-70-    // before that still RUNS — `updateGuestStatus` reads both — so refusing to
src/lib/workflow/catalogue/arm-check.test.ts-71-    // arm it would be this check inventing a rule the engine does not have.
src/lib/workflow/catalogue/arm-check.test.ts-72-    // The first version of this file did exactly that, against a real stored row.
src/lib/workflow/catalogue/arm-check.test.ts-73-    expect(
src/lib/workflow/catalogue/arm-check.test.ts-74-      findArmBlockers(
src/lib/workflow/catalogue/arm-check.test.ts:75:        wrap([node('s', 'action.update_guest_status', { label: 'סמן', description: 'd', status: 'attending' })]),
src/lib/workflow/catalogue/arm-check.test.ts-76-      ),
src/lib/workflow/catalogue/arm-check.test.ts-77-    ).toEqual([]);
src/lib/workflow/catalogue/arm-check.test.ts-78-
--
src/lib/workflow/catalogue/arm-check.test.ts-80-    expect(
src/lib/workflow/catalogue/arm-check.test.ts-81-      findArmBlockers(
src/lib/workflow/catalogue/arm-check.test.ts-82-        wrap([
src/lib/workflow/catalogue/arm-check.test.ts:83:          node('s', 'action.update_guest_status', {
src/lib/workflow/catalogue/arm-check.test.ts-84-            label: 'סמן',
src/lib/workflow/catalogue/arm-check.test.ts-85-            description: 'd',
src/lib/workflow/catalogue/arm-check.test.ts:86:            rsvpStatus: 'attending',
src/lib/workflow/catalogue/arm-check.test.ts-87-          }),
src/lib/workflow/catalogue/arm-check.test.ts-88-        ]),
src/lib/workflow/catalogue/arm-check.test.ts-89-      ),
--
src/lib/workflow/catalogue/arm-check.test.ts-162-  it('⚠️ an UNRECOGNISED status is active, never a block', () => {
src/lib/workflow/catalogue/arm-check.test.ts-163-    // MEASURED in production 2026-09-14: two stored nodes carry
src/lib/workflow/catalogue/arm-check.test.ts-164-    // `status: 'attending'` / `'declined'` — the RSVP value from before that
src/lib/workflow/catalogue/arm-check.test.ts:165:    // field was renamed to `rsvpStatus`. Refusing to arm those would break
src/lib/workflow/catalogue/arm-check.test.ts-166-    // workflows that run correctly.
src/lib/workflow/catalogue/arm-check.test.ts-167-    for (const status of ['attending', 'declined', '', 'DRAFT', 'archived']) {
src/lib/workflow/catalogue/arm-check.test.ts-168-      expect(
--
src/lib/workflow/catalogue/templates.test.ts-290-
src/lib/workflow/catalogue/templates.test.ts-291-  it('uses NO guest-touching node — the sender is the owner, not a guest', () => {
src/lib/workflow/catalogue/templates.test.ts-292-    // A run started by an owner sending a list carries no contact, so
src/lib/workflow/catalogue/templates.test.ts:293:    // update_guest_status / send_whatsapp / set_guest_field / the callback node
src/lib/workflow/catalogue/templates.test.ts-294-    // all refuse inside it. One of them in this template would be a step that
src/lib/workflow/catalogue/templates.test.ts-295-    // can only ever fail.
src/lib/workflow/catalogue/templates.test.ts-296-    const guestNodes = new Set([
src/lib/workflow/catalogue/templates.test.ts:297:      'action.update_guest_status',
src/lib/workflow/catalogue/templates.test.ts-298-      'action.send_whatsapp',
src/lib/workflow/catalogue/templates.test.ts-299-      'action.set_guest_field',
src/lib/workflow/catalogue/templates.test.ts-300-      'action.create_callback_request',
--
src/lib/workflow/engine/dry-run.test.ts-42-        operator: 'contains',
src/lib/workflow/engine/dry-run.test.ts-43-        value: keyword,
src/lib/workflow/engine/dry-run.test.ts-44-      }),
src/lib/workflow/engine/dry-run.test.ts:45:      node('a', 'action.update_guest_status', { status: 'attending' }),
src/lib/workflow/engine/dry-run.test.ts-46-    ],
src/lib/workflow/engine/dry-run.test.ts-47-    edges: [
src/lib/workflow/engine/dry-run.test.ts-48-      { id: 'e1', source: 't', target: 'c', sourceHandle: null },
--
src/lib/workflow/engine/dry-run.test.ts-93-  // actually writes, and asserts the chosen half ran while the other did not.
src/lib/workflow/engine/dry-run.test.ts-94-  it('fires only the matching branch when both are wired', async () => {
src/lib/workflow/engine/dry-run.test.ts-95-    const both = slice();
src/lib/workflow/engine/dry-run.test.ts:96:    both.nodes.push(node('b', 'action.update_guest_status', { status: 'declined' }));
src/lib/workflow/engine/dry-run.test.ts-97-    both.edges.push({
src/lib/workflow/engine/dry-run.test.ts-98-      id: 'e3',
src/lib/workflow/engine/dry-run.test.ts-99-      source: 'c',
--
src/lib/workflow/adapter/to-definition.test.ts-50-
src/lib/workflow/adapter/to-definition.test.ts-51-const TRIGGER = 'trigger.whatsapp_inbound';
src/lib/workflow/adapter/to-definition.test.ts-52-const CONDITION = 'logic.condition';
src/lib/workflow/adapter/to-definition.test.ts:53:const ACTION = 'action.update_guest_status';
src/lib/workflow/adapter/to-definition.test.ts-54-
src/lib/workflow/adapter/to-definition.test.ts-55-function diagram(nodes: unknown[], edges: unknown[] = []) {
src/lib/workflow/adapter/to-definition.test.ts-56-  return { name: 'בדיקה', layoutDirection: 'DOWN', nodes, edges };
--
src/lib/workflow/adapter/to-definition.test.ts-324-      diagram(
src/lib/workflow/adapter/to-definition.test.ts-325-        [
src/lib/workflow/adapter/to-definition.test.ts-326-          node('t', TRIGGER),
src/lib/workflow/adapter/to-definition.test.ts:327:          node('a', ACTION, { rsvpStatus: 'attending', errorPolicy: 'errorRoute' }),
src/lib/workflow/adapter/to-definition.test.ts-328-        ],
src/lib/workflow/adapter/to-definition.test.ts-329-        [edge('t', 'a')],
src/lib/workflow/adapter/to-definition.test.ts-330-      ),
--
src/lib/workflow/steps/guest-field-callback.test.ts-58-
src/lib/workflow/steps/guest-field-callback.test.ts-59-  it('a shared phone is a COMPLETED step, not a failure', async () => {
src/lib/workflow/steps/guest-field-callback.test.ts-60-    // A phone may back several guests and "whose meal preference?" has no
src/lib/workflow/steps/guest-field-callback.test.ts:61:    // answer. Nothing went wrong — the same refusal update_guest_status makes.
src/lib/workflow/steps/guest-field-callback.test.ts-62-    const r = await setField(
src/lib/workflow/steps/guest-field-callback.test.ts-63-      { field: 'meal_pref', value: 'x' },
src/lib/workflow/steps/guest-field-callback.test.ts-64-      ctxWith({
--
src/lib/workflow/engine/run-workflow.test.ts-178-        type: 'node',
src/lib/workflow/engine/run-workflow.test.ts-179-        position: { x: 0, y: 240 },
src/lib/workflow/engine/run-workflow.test.ts-180-        data: {
src/lib/workflow/engine/run-workflow.test.ts:181:          type: 'action.update_guest_status',
src/lib/workflow/engine/run-workflow.test.ts-182-          icon: 'UserCheck',
src/lib/workflow/engine/run-workflow.test.ts-183-          properties: { status: 'attending' },
src/lib/workflow/engine/run-workflow.test.ts-184-        },
--
src/lib/workflow/engine/run-workflow.test.ts-350-    //
src/lib/workflow/engine/run-workflow.test.ts-351-    // This test asserts the SECOND call happens. It is not a defect to fix — it
src/lib/workflow/engine/run-workflow.test.ts-352-    // is the property every action node must tolerate, and the reason
src/lib/workflow/engine/run-workflow.test.ts:353:    // update_guest_status was chosen as the first action: submit_rsvp setting
src/lib/workflow/engine/run-workflow.test.ts-354-    // the same status again yields the same row. An action that cannot say that
src/lib/workflow/engine/run-workflow.test.ts-355-    // needs its own deterministic dedup key before it may exist.
src/lib/workflow/engine/run-workflow.test.ts-356-    const d = deps();
--
src/lib/workflow/engine/run-workflow.test.ts-474-          type: 'node',
src/lib/workflow/engine/run-workflow.test.ts-475-          position: { x: 0, y: 0 },
src/lib/workflow/engine/run-workflow.test.ts-476-          data: {
src/lib/workflow/engine/run-workflow.test.ts:477:            type: 'action.update_guest_status',
src/lib/workflow/engine/run-workflow.test.ts-478-            icon: 'Lightning',
src/lib/workflow/engine/run-workflow.test.ts-479-            properties: { label: 'סמן כמגיע/ה', status: 'attending' },
src/lib/workflow/engine/run-workflow.test.ts-480-          },
```
