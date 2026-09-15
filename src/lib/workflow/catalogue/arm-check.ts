import { editorDiagramSchema } from '../adapter/editor-schema';
import { isKnownNodeType, isTriggerType } from './nodes';
import {
  activeConditionalRequirements,
  GUEST_SCOPED_NODE_TYPES,
  LEGACY_PROPERTY_ALIASES,
  NODE_STATUSES,
  NODE_NUMBER_RANGES,
  NODE_REQUIRED_FIELDS,
  SALES_CALLBACK_TOPIC,
  triggerKeywordCanNeverMatch,
  triggerSuppliesGuestContext,
  type KalfaNodeType,
} from './types';

// Is this workflow CONFIGURED, as opposed to merely well-formed?
//
// ⚠️ WHY THIS IS NOT PART OF `toWorkflowDefinition`. The two answer different
// questions, and collapsing them breaks something real:
//
//   CONVERSION asks "can this graph run at all" — one start node, no dead ends,
//     known node types. A starter template must pass it, because a template is a
//     valid DRAFT the owner has not filled in yet.
//
//   THIS asks "is every step actually set up" — and a template deliberately
//     ships with blanks (`targetWorkflowId` is empty because only the owner
//     knows which workflow to fan out to).
//
// So a template still loads, saves and converts; it just cannot be ARMED until
// the blanks are filled. Putting this rule in the converter instead would make
// the templates themselves invalid.
//
// ⚠️ THE FAILURE THIS REPLACES. `action.start_for_each_guest` throws at RUN time
// when it has no target — so a workflow armed on Sunday morning fired at 10:00,
// failed, and the owner found out from a run log. Every field checked here is
// one a handler already refuses; the only thing that changes is WHEN the owner
// is told, and that the message names the field.
//
// The rules come from `NODE_REQUIRED_FIELDS` and `NODE_NUMBER_RANGES`, which are
// the SAME declarations the editor form is built from — so a field required in
// the form is required to arm, by construction rather than by discipline.
//
// ⚠️ AND THEY ARE IMPORTED FROM `./types`, NEVER FROM `./schemas`. This module
// runs on the SERVER. `schemas.ts` pulls runtime values out of
// `@workflowbuilder/sdk` and is reached from a `'use client'` editor, so Next
// compiles it into the CLIENT graph; a server import of it yields a client
// REFERENCE, not the values. The first version of this file imported
// `PALETTE_ITEMS` from there and every arm attempt in production died with
// `PALETTE_ITEMS.find is not a function`. `types.ts` and `nodes.ts` import
// nothing from the SDK and are safe on both sides — the same rule `nodes.ts`
// states for the pg-boss worker.

/**
 * One refusal, and the node it belongs to.
 *
 * ⚠️ THE `nodeId` EXISTS FOR THE EDITOR, NOT FOR ARMING. `setWorkflowActive`
 * only ever renders the sentences, which is why this function returned bare
 * strings for its whole life. But the SDK marks a node invalid from
 * `data.properties.customErrors` — per node, never per diagram — so surfacing
 * any of these in the panel needs the attribution the messages were throwing
 * away.
 */
export type ArmBlocker = {
  readonly nodeId: string;
  readonly message: string;
  /**
   * WHO ELSE ALREADY ENFORCES THIS.
   *
   * ⚠️ THE DISTINCTION EXISTS BECAUSE THE EDITOR SHOWS THESE TWICE OTHERWISE.
   * A blank required field is refused by the node's own JSON Schema — the panel
   * already marks it, with its own message, next to the field. Writing the arm
   * gate's sentence into `customErrors` as well produces two errors for one
   * mistake, differing only in wording.
   *
   *   'schema'    the node's schema refuses this too. Reported at arming
   *               because arming is the boundary nothing bypasses, but NOT
   *               mirrored onto the node — the schema is already doing that.
   *   'arm-only'  nothing but this function refuses it. These are the ones
   *               worth putting on the node, because otherwise the owner meets
   *               them for the first time by pressing "arm".
   */
  readonly source: 'schema' | 'arm-only';
  /**
   * The property this refusal is about, in AJV's `instancePath` form
   * (`/purposeKey`), or `''` when it is about the node as a whole.
   *
   * ⚠️ `''` IS A REAL ANSWER, NOT A MISSING ONE. The guest-context rule is about
   * the trigger at the other end of the graph; the keyword rule is a
   * CONTRADICTION BETWEEN TWO fields, not a fault in either. Attaching either to
   * one field would point the owner at the wrong half.
   */
  readonly instancePath: string;
};

/**
 * Every refusal, attributed to the node that caused it.
 *
 * The real implementation; `findArmBlockers` is this with the ids dropped. Kept
 * as the primary so the two can never disagree about what blocks arming — the
 * failure mode would be an editor that marks a node clean and an arm button
 * that refuses it, which is the exact confusion this module was built to end.
 */
export function findArmBlockersByNode(
  storedDefinition: unknown,
  workflowId?: string,
): ArmBlocker[] {
  return collectArmBlockers(storedDefinition, workflowId);
}

/** A required field that is absent, blank, or outside its declared range. */
export function findArmBlockers(
  storedDefinition: unknown,
  workflowId?: string,
): string[] {
  return collectArmBlockers(storedDefinition, workflowId).map((b) => b.message);
}

function collectArmBlockers(
  storedDefinition: unknown,
  /**
   * The workflow being armed.
   *
   * Optional so every existing caller compiles, but WITHOUT it the self-fan-out
   * check cannot run — a node pointing at its own workflow is only recognisable
   * against that id. `setWorkflowActive` always passes it.
   */
  workflowId?: string,
): ArmBlocker[] {
  const parsed = editorDiagramSchema.safeParse(storedDefinition);
  if (!parsed.success) return [];

  const blockers: ArmBlocker[] = [];

  // ⚠️ THE ONE CROSS-NODE QUESTION, ANSWERED ONCE FOR THE WHOLE GRAPH.
  //
  // Seven action types call `requireGuestContext` and throw without a contact.
  // Whether the run HAS one is decided by the trigger at the other end of the
  // diagram, so no per-node check can see it: a JSON Schema validates one node's
  // properties, and a JsonForms rule reads one node's data. Until now nothing
  // looked, and `לפי שעון → שליחת וואטסאפ` armed cleanly and failed on its first
  // fire — with two sentences of prose in the trigger's panel as the only
  // warning.
  //
  // The conversion contract already guarantees exactly one start node, so this
  // is `some` over a list of one in practice; written as `some` because the
  // guarantee belongs to the converter and not here.
  const triggers = parsed.data.nodes.filter((node) => isTriggerType(node.data.type));
  const suppliesGuest = triggers.some((node) =>
    triggerSuppliesGuestContext(
      node.data.type,
      (node.data.properties ?? {}) as Record<string, unknown>,
    ),
  );

  // ⚠️ AND THE CHECK ONLY APPLIES WHEN THERE IS A TRIGGER TO JUDGE.
  //
  // A diagram with NO trigger fails conversion — rule 1, exactly one start node
  // — and reporting "your trigger does not supply a guest" about a trigger that
  // does not exist says the same problem in a second wording while burying this
  // node's own field errors. Measured: it swallowed four existing assertions,
  // each of which was checking a blank field on a trigger-less fixture.
  //
  // Same reasoning as the unknown-type case above: not ours to report.
  const guestRuleApplies = triggers.length > 0 && !suppliesGuest;

  for (const node of parsed.data.nodes) {
    // An unknown type is the converter's error to report, not ours — saying it
    // twice in two different wordings helps nobody.
    if (!isKnownNodeType(node.data.type)) continue;
    const nodeType = node.data.type as KalfaNodeType;

    const baseRequired = NODE_REQUIRED_FIELDS[nodeType] ?? [];
    const ranges = NODE_NUMBER_RANGES[nodeType] ?? {};

    const properties = (node.data.properties ?? {}) as Record<string, unknown>;
    // What the owner calls this step. The id is a last resort — it is the only
    // thing guaranteed to exist, and a message with no subject is unusable.
    const where = `הצעד "${typeof properties.label === 'string' && properties.label.trim() !== '' ? properties.label : node.id}"`;

    // ⚠️ A STEP LEFT IN DRAFT BLOCKS ARMING — the rule `NODE_STATUSES` states and
    // nothing implemented until now, so a half-written step armed silently and
    // was skipped at run time with no one told.
    //
    // `disabled` deliberately does NOT block. The two skip identically at run
    // time, and the difference is entirely intent: "I have not finished this" is
    // a mistake to catch before a guest is involved, "I switched this off" is the
    // owner's decision and arming must respect it.
    //
    // Reported INSTEAD of this node's field checks, not alongside them: a step
    // nobody finished is expected to have blanks, and listing them too would bury
    // the one line that matters.
    if (readNodeStatus(properties.status) === 'draft') {
      blockers.push({ nodeId: node.id, source: 'arm-only', instancePath: '/status', message: `${where}: הצעד בטיוטה. סיימו אותו, או העבירו אותו ל"מושבת" כדי לדלג עליו במכוון.` });
      continue;
    }

    // ⚠️ A GUEST-SCOPED STEP IN A RUN THAT WILL NEVER CARRY A GUEST.
    //
    // ⚠️ REPORTED ALONGSIDE THIS NODE'S FIELD CHECKS, NOT INSTEAD OF THEM — the
    // opposite of the draft case above, and the difference is what "expected"
    // means. A step left in draft is DECLARED unfinished, so its blanks are
    // noise. A step under the wrong trigger may be configured perfectly and
    // still be unable to run; when it also has a blank, that blank is a second
    // real thing the owner has to fix.
    //
    // Measured on the starter template "שיחת ייעוד — עם בחירת סוכן ומספר",
    // which has both: a `trigger.schedule` and an empty `purposeKey`. Skipping
    // the field checks hid the second one behind the first, and the owner would
    // have fixed the trigger only to press arm again and meet the purpose.
    //
    // ⚠️ AND THE MESSAGE NAMES A THIRD FIX, because there is a legitimate shape
    // this refuses. A FAN-OUT child carries a contact regardless of its own
    // trigger — `startRunsForGuests` creates each child run with
    // `triggerSource: 'fanout'` and a contactId, and its own comment says
    // "arming is not required; existing is". The starter template "תזכורת
    // לאורח אחד (תהליך-בן)" is exactly that: a `trigger.webhook` node labelled
    // "לא להפעיל", meant to be started by another workflow.
    //
    // Blocking it at ARMING is still right, and the distinction is the whole
    // point: arming means "fire on my OWN trigger", and on that route the guest
    // is genuinely absent. Being a fan-out target needs no arming at all. So
    // the refusal is accurate and the third clause tells the owner which of the
    // two they wanted.
    //
    // `disabled` is exempt and `draft` is handled above. A disabled step is
    // skipped at run time, so it cannot throw — refusing to arm because of one
    // would be stricter than the engine, which is the mistake this whole module
    // exists to avoid making twice.
    if (
      guestRuleApplies &&
      (GUEST_SCOPED_NODE_TYPES as readonly string[]).includes(nodeType) &&
      readNodeStatus(properties.status) !== 'disabled'
    ) {
      blockers.push({ nodeId: node.id, source: 'arm-only', instancePath: '', message: `${where}: הצעד פועל על אורח, והטריגר של התהליך אינו מתחיל מאורח. ` +
          'החליפו לטריגר "הודעת וואטסאפ נכנסת" שמסומן בו לפחות סוג הודעה שאורח שולח, הסירו את הצעד, ' +
          'או השאירו את התהליך לא מחומש והפעילו אותו מתהליך אחר עם "הרצה לכל אורח".', });
    }

    // ⚠️ A TRIGGER NARROWED UNTIL NOTHING CAN MATCH IT.
    //
    // A keyword is tested against `readTextBody(payload)`, which reads
    // `payload.text?.body` and nothing else. So a trigger that accepts only
    // kinds with no text body — files, images, button taps — and still carries a
    // keyword has asked for a message that cannot arrive: `planRuns` applies
    // both filters to the same message, and every candidate fails one of them.
    //
    // ⚠️ REPORTED ALONGSIDE THE FIELD CHECKS, like the guest rule and unlike the
    // draft one: the trigger may be perfectly filled in and still be unable to
    // fire, and if it also has a blank that blank is a second real thing to fix.
    //
    // `disabled` is exempt for the same reason it is everywhere else here — a
    // disabled trigger starts nothing, so it cannot disappoint anyone.
    if (
      triggerKeywordCanNeverMatch(nodeType, properties) &&
      readNodeStatus(properties.status) !== 'disabled'
    ) {
      blockers.push({ nodeId: node.id, source: 'arm-only', instancePath: '', message: `${where}: הוגדרה מילת הפעלה, אך לא נבחר סוג הודעה שמכיל טקסט — ולכן שום הודעה לא תתאים. ` +
          'סמנו גם "הודעת טקסט", או מחקו את מילת ההפעלה.', });
    }

    // ⚠️ A FAN-OUT POINTING AT ITS OWN WORKFLOW, refused before it can run once.
    //
    // The handler refuses it too, and deliberately: arming is not required to be
    // a fan-out TARGET, and the id lives in a jsonb row that arming does not
    // re-read afterwards. But a workflow that starts ITSELF per guest is a static
    // property of the diagram, and the cheapest place to catch a static property
    // is before anything runs — the alternative is discovering it from a run log
    // after a chain has already started.
    if (
      nodeType === 'action.start_for_each_guest' &&
      workflowId !== undefined &&
      typeof properties.targetWorkflowId === 'string' &&
      properties.targetWorkflowId.trim() === workflowId
    ) {
      blockers.push({ nodeId: node.id, source: 'arm-only', instancePath: '/targetWorkflowId', message: `${where}: הצעד מצביע על התהליך הזה עצמו. תהליך שמפעיל את עצמו לכל אורח אינו נעצר — בחרו תהליך אחר.`, });
      continue;
    }

    // ⚠️ AND NOT A GUEST CALLBACK ROUTED TO THE SALES AGENT. Static property of
    // the diagram, so it is refused before a single guest is dialled rather than
    // from a run log afterwards. The handler refuses it again at run time,
    // because the value is a jsonb field the form does not re-validate.
    if (
      nodeType === 'action.create_callback_request' &&
      typeof properties.topic === 'string' &&
      properties.topic.trim() === SALES_CALLBACK_TOPIC
    ) {
      blockers.push({ nodeId: node.id, source: 'arm-only', instancePath: '/topic', message: `${where}: הנושא "${SALES_CALLBACK_TOPIC}" מנתב לסוכן המכירות, והצעד הזה פונה לאורח באירוע. בחרו נושא אחר.`, });
      continue;
    }

    // ⚠️ THE CONDITIONAL CONTRACT, APPLIED A SECOND TIME — NOT A MISSING HALF.
    //
    // An earlier version of this comment claimed the schema could not catch an
    // ABSENT body, because `ConditionalSchema` is typed `{ properties: … }` with
    // no root `required`. That was wrong, and `schemas.ts` now shows why: the
    // TYPE is that narrow, but a function return is compared structurally rather
    // than as a fresh literal, so `then` carries `required` alongside
    // `properties` with no cast — and the bundled validator honours it.
    //
    // Workflow Builder's own `data-schema` page endorses the pattern using THIS
    // EXACT CASE: "For conditional shape changes (e.g. if `method === 'POST'`,
    // then `body` is required), use the standard JSON Schema if/then/else
    // keywords inside `allOf`". Their Delay node is NOT the precedent for it —
    // that one nests `required` inside an object-typed property, which the
    // declared type already allows; ours is at the root of `then`, which the
    // type does not declare and the prose does.
    //
    // So why this still runs: THE SCHEMA VALIDATES IN THE EDITOR. A definition
    // that arrives by import, by an API call, or by a direct row edit never
    // meets a JsonForms instance. `setWorkflowActive` is the boundary nothing
    // bypasses, and it is the last place to refuse before a real guest is
    // involved. Both halves read `NODE_CONDITIONAL_REQUIRED_FIELDS`, so the two
    // cannot end up enforcing different contracts.
    const conditional = activeConditionalRequirements(nodeType, properties);
    const required = [...baseRequired];
    for (const rule of conditional) {
      const value = properties[rule.require];
      if (value === undefined || value === null) {
        blockers.push({ nodeId: node.id, source: 'schema', instancePath: `/${rule.require}`, message: `${where}: ${rule.message}` });
        continue;
      }
      if (!required.includes(rule.require)) required.push(rule.require);
    }

    for (const key of required) {
      // The pre-rename key counts. A diagram saved before `status` became
      // `rsvpStatus` still RUNS — the handler reads both — so refusing to arm it
      // would be this check inventing a rule the engine does not have.
      const alias = LEGACY_PROPERTY_ALIASES[key];
      const value = properties[key] ?? (alias ? properties[alias] : undefined);
      const range = ranges[key];

      if (value === undefined || value === null) {
        blockers.push({ nodeId: node.id, source: 'schema', instancePath: `/${key}`, message: `${where}: חסר ערך בשדה "${key}".` });
        continue;
      }

      // A blank string is the case that matters and the one JSON Schema's own
      // `required` does NOT catch: the key is present, so the form is satisfied,
      // and the handler still refuses it.
      //
      // An empty ARRAY is deliberately NOT treated the same way. Emptiness is two
      // different ideas: a blank string is an unfilled field, an empty list is
      // usually a deliberate "no filter" (empty `days` on a schedule means every
      // day). No schema declares a required array today — measured — so this is
      // a decision made in advance for the first one that does.
      if (typeof value === 'string' && value.trim() === '') {
        // A conditionally-required field explains WHY it is required — "the
        // verb you picked sends a body" — which a generic "the field is empty"
        // cannot, because the field is only empty-and-wrong for some verbs.
        const rule = conditional.find((r) => r.require === key);
        blockers.push({ nodeId: node.id, source: 'schema', instancePath: `/${key}`, message: `${where}: ${rule ? rule.message : blankMessage(nodeType, key)}` });
        continue;
      }

      // Only fields that DECLARE a bound are range-checked. Everything else is
      // satisfied by being present and non-blank.
      //
      // ⚠️ `schema`, BECAUSE THE SCHEMA ALREADY CARRIES THESE BOUNDS. An earlier
      // version of this comment said the opposite — that `schemas.ts` declared
      // no `minimum`/`maximum` and `maxGuests: 0` was therefore schema-valid.
      // That was a grep talking: both fields SPREAD the bound rather than
      // writing the literal —
      //
      //     maxGuests: { type: 'number', ...NODE_NUMBER_RANGES[…].maxGuests }
      //
      // so searching for the keyword found nothing while the built schema
      // carried `{ minimum: 1, maximum: 500 }`. Measured against the exported
      // object: 0 and 501 are both refused.
      //
      // ⚠️ THE REAL DIVERGENCE RUNS THE OTHER WAY, and it is why the numeric
      // read below coerces. `type: 'number'` refuses the STRING '25'; the
      // handler accepts it (`steps/index.ts`: `Number(rawMax)`) and so does
      // this gate. A node storing a numeric string therefore runs correctly and
      // the panel marks it invalid — the schema being stricter than the engine,
      // which is the one mistake this module exists to avoid. It is repaired on
      // load by `normalize-legacy-properties.ts`, the same way the pre-object
      // `messageKinds` shape is.
      if (range) {
        const n = typeof value === 'number' ? value : Number(value);
        if (!Number.isFinite(n)) {
          blockers.push({ nodeId: node.id, source: 'schema', instancePath: `/${key}`, message: `${where}: השדה "${key}" אינו מספר.` });
        } else if (range.minimum !== undefined && n < range.minimum) {
          blockers.push({ nodeId: node.id, source: 'schema', instancePath: `/${key}`, message: `${where}: "${key}" חייב להיות ${range.minimum} לפחות.` });
        } else if (range.maximum !== undefined && n > range.maximum) {
          blockers.push({ nodeId: node.id, source: 'schema', instancePath: `/${key}`, message: `${where}: "${key}" חייב להיות ${range.maximum} לכל היותר.` });
        }
      }
    }
  }

  return blockers;
}

/**
 * What to say about a blank field.
 *
 * ⚠️ A FIELD NAME IS NOT ALWAYS AN INSTRUCTION. For most fields "the field is
 * empty" is the whole story — the owner opens the node and types. For the
 * fan-out it is not: `targetWorkflowId` is blank because the workflow it points
 * at DOES NOT EXIST YET, and an owner who loaded the starter template has no way
 * to know that from the field name alone.
 *
 * Only nodes where the fix is not obvious get a sentence of their own.
 */
function blankMessage(nodeType: string, key: string): string {
  if (nodeType === 'action.start_for_each_guest' && key === 'targetWorkflowId') {
    return 'לא נבחר תהליך להרצה. צרו את תהליך-הבן (למשל מהתבנית "תזכורת לאורח אחד") והדביקו את המזהה שלו כאן.';
  }
  // Same reasoning as the fan-out: "purposeKey is empty" is a field name, not an
  // action. The dropdown reads `voice_purposes`, and it can legitimately be
  // EMPTY — the three rows that ship are built-in and the dialler refuses those
  // by design — so an owner can open the node, find nothing to choose, and have
  // no way to learn that a purpose has to be created first.
  if (nodeType === 'action.start_voice_call' && key === 'purposeKey') {
    return 'לא נבחר ייעוד לשיחה. בחרו ייעוד מהרשימה, ואם היא ריקה — צרו ייעוד חדש ב-/admin/integrations/voximplant וקשרו לו rule.';
  }
  // And again: a webhook trigger with no token has no ADDRESS — the route is
  // `/api/workflows/hook/<token>` and `findWorkflowForToken` skips every
  // workflow whose configured token is blank, so arming one produces an endpoint
  // that exists nowhere. "The token field is empty" does not say that.
  if (nodeType === 'trigger.webhook' && key === 'token') {
    return 'לא הוגדר טוקן, ולכן אין כתובת שאפשר לקרוא לה. הדביקו כאן מחרוזת אקראית וארוכה — התייחסו אליה כאל סיסמה.';
  }
  return `השדה "${key}" ריק.`;
}

/**
 * The node's own lifecycle, or undefined when the value is not one of ours.
 *
 * ⚠️ AN UNRECOGNISED VALUE IS `active`, NEVER A BLOCK — and this is not
 * theoretical. MEASURED in production on 2026-09-14: two stored nodes carry
 * `status: 'attending'` / `'declined'`, the RSVP value from before that field was
 * renamed to `rsvpStatus`. Treating an unknown string as "not active" would
 * refuse to arm a workflow that runs correctly; the adapter's `readNodeStatus`
 * makes the same choice for the same reason.
 */
function readNodeStatus(value: unknown): string | undefined {
  return typeof value === 'string' && (NODE_STATUSES as readonly string[]).includes(value)
    ? value
    : undefined;
}
