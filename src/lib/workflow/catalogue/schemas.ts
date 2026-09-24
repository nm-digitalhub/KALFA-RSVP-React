'use client';

// The editor's half of the catalogue: what each node type looks like in the
// palette and in the properties panel.
//
// CLIENT ONLY. `sharedProperties` and `getScope` are runtime values, so this
// module loads @workflowbuilder/sdk — and with it the module-level
// `immer.setAutoFreeze(false)` and `i18next.init`. The worker reads ./nodes.ts,
// which imports nothing.
//
// Written against the SDK's own vocabulary, verified against
// `dist/index.d.ts` and against how the reference app's own nodes are built
// (apps/demo/src/app/data/nodes/delay/{schema,uischema,select-options}.ts):
//
//   * `...sharedProperties` supplies `label` and `description`, which
//     `NodePropertiesSchema` REQUIRES on every node. Hand-rolling them and
//     omitting `description` is a contract violation that only a `satisfies`
//     catches.
//   * A select is `options: [{ label, value, icon? }]` on the FIELD, plus
//     `{ type: 'Select', scope }` in the uischema. There is no `oneOf`, no
//     `enum`, and no `title` in `FieldSchema` — those are generic JSONForms
//     conventions this SDK does not use.
//   * Visible text lives in the UISCHEMA (`label`, `placeholder`, and
//     `{ type: 'Label', text }`), never in the JSON schema.
//   * Scopes come from `getScope<Schema>('properties.x')` — a typed path, not a
//     hand-written `#/properties/x` string.
//
// Every entry ends in `satisfies NodeSchema` / typed as `PaletteItem`, so a
// mistake here is a compile error rather than an empty properties panel.
import { NodeType, getScope } from '@workflowbuilder/sdk';
import type { NodeSchema, PaletteItem, UISchema } from '@workflowbuilder/sdk';

import {
  CHECKBOX_LIST_FORMAT,
  NODE_RUN_FORMAT,
  TRIGGER_SWITCH_FORMAT,
  WEBHOOK_TOKEN_FORMAT,
} from './ui-formats';

import {
  actionBranches,
  actionBranchesProperty,
  errorPolicyOptions,
  identityControls,
  identityProperties,
  nodeStatusOptions,
  requiredText,
  rsvpStatusOptions,
  statusControl,
  statusProperty,
} from './editor-shared';

import { aiAgentPaletteItem } from '../nodes/action-ai-agent/action-ai-agent';
import { callbackRequestPaletteItem } from '../nodes/action-create-callback-request/action-create-callback-request';
import { importGuestListPaletteItem } from '../nodes/action-import-guest-list/action-import-guest-list';
import { microsoftSendEmailPaletteItem } from '../nodes/action-microsoft-send-email/action-microsoft-send-email';
import * as microsoftSendEmailDefinition from '../nodes/action-microsoft-send-email/definition';
import {
  microsoftSendEmailSchemaFor,
  type MicrosoftConnectionOption,
} from '../nodes/action-microsoft-send-email/schema';
import { notifyTeamPaletteItem } from '../nodes/action-notify-team/action-notify-team';
import { sendTemplatePaletteItem } from '../nodes/action-send-template/action-send-template';
import { sendWhatsappPaletteItem } from '../nodes/action-send-whatsapp/action-send-whatsapp';
import { setGuestFieldPaletteItem } from '../nodes/action-set-guest-field/action-set-guest-field';
import { startRsvpAiCallbackPaletteItem } from '../nodes/action-start-rsvp-ai-callback/action-start-rsvp-ai-callback';
import { voiceCallPaletteItem } from '../nodes/action-start-voice-call/action-start-voice-call';
import * as startVoiceCallDefinition from '../nodes/action-start-voice-call/definition';
import {
  voiceCallSchemaFor,
  type VoiceDialOption,
  type VoicePurposeOption,
} from '../nodes/action-start-voice-call/schema';
import { sumitCreateCustomerPaletteItem } from '../nodes/action-sumit-create-customer/action-sumit-create-customer';
import { sumitCreateDocumentPaletteItem } from '../nodes/action-sumit-create-document/action-sumit-create-document';
import { updateGuestStatusPaletteItem } from '../nodes/action-update-guest-status/action-update-guest-status';
import { webhookPaletteItem } from '../nodes/action-webhook/action-webhook';
import { conditionPaletteItem } from '../nodes/logic-condition/logic-condition';
import { setValuePaletteItem } from '../nodes/logic-set-value/logic-set-value';
import { switchPaletteItem } from '../nodes/logic-switch/logic-switch';
import { waitPaletteItem } from '../nodes/logic-wait/logic-wait';

import {
  NODE_NUMBER_RANGES,
  NODE_REQUIRED_FIELDS,
  WHATSAPP_MESSAGE_KINDS,
  type KalfaNodeType,
  webhookMethodOptions,
} from './types';

// ---------------------------------------------------------------------------
// trigger.whatsapp_inbound
// ---------------------------------------------------------------------------

/**
 * One of OUR WhatsApp numbers, as the trigger's dropdown offers it.
 *
 * The VALUE is Meta's `phone_number_id`, because that is what arrives on the
 * webhook and what `matchesNumber` compares. The label is for the human.
 */
export type WhatsAppNumberOption = {
  /** Meta's phone_number_id — the stored value. */
  providerRef: string;
  /** e.g. "+972 3-721-9347 — מספר אישורי הגעה". */
  label: string;
};

// The only entry whose options are not knowable at module scope: the account's
// WhatsApp numbers are rows, and they change without a deploy. `buildPaletteItems`
// below takes them; `PALETTE_ITEMS` is the empty-list case.
const triggerSchema = {
  type: 'object',
  required: NODE_REQUIRED_FIELDS['trigger.whatsapp_inbound'],
  properties: {
    ...identityProperties,
    ...statusProperty,
    keyword: { type: 'string', placeholder: 'השאירו ריק כדי להפעיל על כל הודעה' },
    phoneNumberId: { type: 'string' },
    // WHICH KINDS of message start this workflow. An OPEN array of Meta's own
    // `type` strings — not an enum — so a kind Meta adds later needs a catalogue
    // entry rather than a migration. Absent means the four a guest actually
    // speaks with, which is what every diagram saved before this field did.
    // ⚠️ OBJECTS, NOT BARE STRINGS, and the shape is forced on us.
    //
    // The SDK's `ArrayFieldSchema` is `{ type:'array', items:{ type:'object',
    // properties } }` — it cannot describe an array of strings at all. The first
    // version declared this shape and had the control write plain strings, so
    // every saved trigger carried a validation error on the node
    // ("Instance type \"string\" is invalid. Expected \"object\"") and showed a
    // "!" the owner could not act on.
    //
    // So the control stores `[{ value: 'document' }, …]`. `matchesKind` accepts
    // BOTH shapes, which is what keeps a workflow saved under the string version
    // matching without a migration.
    messageKinds: {
      type: 'array',
      items: { type: 'object', properties: { value: { type: 'string' } } },
    },
  },
} satisfies NodeSchema;

const triggerScope = getScope<typeof triggerSchema>;

function triggerSchemaFor(numbers: readonly WhatsAppNumberOption[]): NodeSchema {
  return {
    ...triggerSchema,
    properties: {
      ...triggerSchema.properties,
      phoneNumberId: {
        type: 'string',
        // '' first, and it is the default: empty means ANY number, which keeps
        // every diagram saved before this field firing exactly as it did.
        options: [
          { value: '', label: 'כל המספרים' },
          ...numbers.map((n) => ({ value: n.providerRef, label: n.label })),
        ],
      },
    },
  } as NodeSchema;
}

// "מה מפעיל את התהליך" — the switcher that lets an owner change a trigger node
// into a different KIND of trigger without rebuilding the diagram.
//
// ⚠️ DECLARED ONCE AND SPREAD INTO ALL THREE TRIGGER UISCHEMAS, so a fourth
// trigger cannot ship without it by omission. The uischema carries NO list of
// the available triggers: the control derives them from the palette itself, so
// this stays a single element with no catalogue data duplicated three times.
//
// ⚠️ A `Label`, WITH `text` THAT IS NEVER DRAWN. The value it edits is
// `data.type`, which is node data rather than a `data.properties.*` field, so
// there is no scope for a control to bind to. The SDK's closed element union
// has no "render something here" member other than `Label`, and the custom
// renderer replaces it wholesale — the same shape `NODE_RUN_FORMAT` uses, for
// the same reason. `text` exists because the type requires one.
const triggerSwitchElement = {
  type: 'Label',
  text: '',
  options: { format: TRIGGER_SWITCH_FORMAT },
} as const;

const triggerUiSchema: UISchema = {
  type: 'VerticalLayout',
  elements: [
    triggerSwitchElement,
    ...identityControls(triggerScope('properties.label'), triggerScope('properties.description')),
    {
      type: 'Select',
      scope: triggerScope('properties.phoneNumberId'),
      label: 'המספר שאליו נשלחה ההודעה',
    },
    {
      // The warning the owner asked for. "כל המספרים" is the compatible default,
      // not the safe one: with two live lines an RSVP automation also fires on
      // messages sent to the import line.
      type: 'Label',
      text: 'כל המספרים: התהליך ירוץ גם על הודעות שנשלחו לקו הייבוא. בחרו מספר כדי לצמצם.',
    },
    {
      type: 'Text',
      scope: triggerScope('properties.keyword'),
      label: 'הפעל רק אם ההודעה מכילה',
    },
    {
      // ⚠️ AN ACCORDION IS COLLAPSIB-LE, NOT COLLAPSED — measured in the 2.3.0
      // bundle, and this comment used to claim the opposite. The renderer
      // (`GH`) passes the layout NOTHING but `label` and `children`; the
      // container (`Ag`) declares `defaultOpen = true` and is the only thing
      // that decides. `AccordionLayoutElement` has no `defaultOpen` field, so
      // the uischema cannot ask for closed — writing one here would be a silent
      // no-op, which `accordion-classification.test.ts` refuses.
      //
      // The container is still right: nine checkboxes are an ADVANCED filter
      // that the default already answers for almost every workflow, and the
      // owner can fold them away after reading them once. What it does not do
      // is spare them the first read.
      type: 'Accordion',
      label: 'סוגי הודעות שמפעילים את התהליך',
      elements: [
        {
          // A CUSTOM RENDERER — the SDK ships no multi-select. Declared as the
          // nearest allowed element type and outranked by ours, matched on
          // `options.format`. See checkbox-list-control.tsx.
          type: 'Text',
          scope: triggerScope('properties.messageKinds'),
          label: 'סוגי הודעות',
          options: {
            format: CHECKBOX_LIST_FORMAT,
            choices: WHATSAPP_MESSAGE_KINDS.map((k) => ({ ...k })),
            defaultNote:
              'ברירת מחדל: רק הודעות שאורח שולח — טקסט, כפתור, תפריט ותגובה. סמנו קובץ או אנשי קשר כדי לבנות תהליך שקולט רשימת אורחים.',
          },
        },
      ],
    },
    statusControl(triggerScope('properties.status')),
  ],
};

// ---------------------------------------------------------------------------
// trigger.webhook
// ---------------------------------------------------------------------------

const webhookTriggerSchema = {
  type: 'object',
  required: NODE_REQUIRED_FIELDS['trigger.webhook'],
  properties: {
    ...identityProperties,
    ...statusProperty,
    // WHERE the caller proves itself. See `WEBHOOK_AUTH_MODES`: `header` is the
    // default and what every diagram saved before this field means, `address`
    // exists for a caller that can be handed a URL and nothing else.
    auth: {
      type: 'string',
      options: [
        { value: 'header', label: 'סוד בכותרת (מומלץ)' },
        { value: 'address', label: 'הכתובת עצמה היא הסוד' },
      ],
    },
    // ⚠️ THE PUBLIC HALF OF THE ADDRESS, AND SAFE TO EXPORT — IN `header` MODE.
    // `/api/workflows/hook/<endpointId>` identifies WHICH webhook and proves
    // nothing, so the panel shows it always and a diagram may carry it anywhere.
    //
    // ⚠️ NOT `requiredText`, AND NOT BECAUSE IT IS OPTIONAL. It is required in
    // `header` mode and forbidden in `address` mode, which is a CONDITIONAL
    // contract — declared once in `NODE_CONDITIONAL_REQUIRED_FIELDS` and applied
    // to this schema by the same `allOf` machinery `action.webhook` uses. A
    // `required` here would fire in both modes and make `address` unarmable.
    endpointId: { type: 'string' },
    // WHICH HTTP METHODS open this address. Objects, not bare strings, for the
    // reason `messageKinds` records at length: the SDK's `ArrayFieldSchema`
    // cannot describe an array of strings at all.
    methods: { type: 'array', items: { type: 'object', properties: { value: { type: 'string' } } } },
    // ⚠️ THE HASH, NOT THE SECRET. The diagram used to hold the credential
    // itself — and the editor's own Export menu puts a diagram in a copyable
    // box. See `webhook-token.ts`: the value is shown once at generation and
    // only its sha256 is ever stored.
    //
    // Named `tokenHash` rather than `secretHash` deliberately: it is accurate
    // either way, and renaming it would migrate a stored field without adding a
    // bit of clarity. What CHANGED is where the secret travels — a header, not
    // the path.
    tokenHash: requiredText,
  },
} satisfies NodeSchema;

const webhookTriggerScope = getScope<typeof webhookTriggerSchema>;

const webhookTriggerUiSchema: UISchema = {
  type: 'VerticalLayout',
  elements: [
    triggerSwitchElement,
    ...identityControls(webhookTriggerScope('properties.label'), webhookTriggerScope('properties.description')),
    {
      // ⚠️ ABOVE THE ADDRESS CONTROL, because it decides what that control is
      // for. Changing it CLEARS whatever was generated — see the control — so an
      // owner who flips it after generating has to press the button again, and
      // arming refuses until they do.
      type: 'Select',
      scope: webhookTriggerScope('properties.auth'),
      label: 'איך הקורא מזדהה',
    },
    {
      // ONE renderer for every shape this takes — the public address and the
      // secret in `header` mode, the single once-shown address in `address`
      // mode. They are created together and must never drift apart, so one
      // control creates, displays and rotates them. It binds to `tokenHash`
      // because that is the field JsonForms writes through and the one field
      // BOTH modes have; it reaches `auth` and `endpointId` on the same node.
      type: 'Text',
      scope: webhookTriggerScope('properties.tokenHash'),
      label: 'כתובת וסוד',
      options: { format: WEBHOOK_TOKEN_FORMAT },
    },
    {
      type: 'Label',
      text: 'אימות בכותרת: הכתובת גלויה וניתנת להעתקה בכל עת, והסוד נשלח ב-x-kalfa-webhook-secret ומוצג פעם אחת בלבד. יצירת סוד חדש אינה משנה את הכתובת.',
    },
    {
      // ⚠️ THE COST OF THE OTHER MODE, SPELLED OUT WHERE IT IS CHOSEN. An owner
      // who picks it is giving up exactly the thing the 2026-09-22 split was
      // built to give them back — a recoverable address — and finding that out
      // later, from a lost integration, is the failure this sentence prevents.
      type: 'Label',
      text: 'אימות לפי כתובת: הכתובת עצמה היא הסוד, מוצגת פעם אחת בלבד ואינה ניתנת לשחזור — נשמר רק גיבוב שלה. בחרו באפשרות הזו רק כשהמערכת הקוראת אינה יודעת לשלוח כותרת (למשל SUMIT). קריאת GET לא תעבוד במצב הזה.',
    },
    {
      type: 'Accordion',
      label: 'באילו שיטות אפשר לקרוא',
      elements: [
        {
          type: 'Text',
          scope: webhookTriggerScope('properties.methods'),
          label: 'שיטות HTTP',
          options: {
            format: CHECKBOX_LIST_FORMAT,
            choices: webhookMethodOptions.map((o) => ({ ...o })),
            defaultNote: 'ברירת מחדל: POST בלבד.',
          },
        },
        {
          type: 'Label',
          text: 'GET ו-DELETE אינם נושאים גוף. בקריאה כזו {{trigger.body}} יהיה ריק, והערכים יגיעו ב-{{trigger.query.<שם>}} מתוך הכתובת.',
        },
      ],
    },
    {
      // The limitation an owner would otherwise discover from a failed run.
      type: 'Label',
      text: 'הרצה שמתחילה כאן אינה קשורה לאורח, ולכן צעדים שפועלים על אורח (עדכון סטטוס, שליחת וואטסאפ, בקשת חזרה) ייכשלו בתוכה.',
    },
    statusControl(webhookTriggerScope('properties.status')),
  ],
};

// ---------------------------------------------------------------------------
// trigger.sumit_card
// ---------------------------------------------------------------------------

// ⚠️ ONE CREDENTIAL FIELD AND NOTHING ELSE TO CONFIGURE. Folder, view and change
// type are chosen in SUMIT's own "יצירת טריגר" screen, which is where the
// filtering happens — see `SumitCardTriggerConfig`. The panel explains what to
// pick THERE rather than offering copies here that would filter nothing.
const sumitCardTriggerSchema = {
  type: 'object',
  required: NODE_REQUIRED_FIELDS['trigger.sumit_card'],
  properties: {
    ...identityProperties,
    ...statusProperty,
    tokenHash: requiredText,
  },
} satisfies NodeSchema;

const sumitCardTriggerScope = getScope<typeof sumitCardTriggerSchema>;

// The output fields live in an SDK-free file so server code can read them —
// see `sumit-card-output.ts` for the measured failure that put them there.
import {
  SUMIT_CARD_BASE_OUTPUT,
  SUMIT_HOLD_FIELDS_OUTPUT,
  type SumitCardOutput,
  type SumitCardOutputField,
} from './sumit-card-output';

export { SUMIT_CARD_BASE_OUTPUT, SUMIT_HOLD_FIELDS_OUTPUT, type SumitCardOutput, type SumitCardOutputField };

const sumitCardTriggerUiSchema: UISchema = {
  type: 'VerticalLayout',
  elements: [
    triggerSwitchElement,
    ...identityControls(
      sumitCardTriggerScope('properties.label'),
      sumitCardTriggerScope('properties.description'),
    ),
    {
      // The same control as the webhook trigger's. It asks `authModeFor`, which
      // answers `address` for this type whatever the row says — so it mints one
      // address, shows it once, and stores only the hash.
      type: 'Text',
      scope: sumitCardTriggerScope('properties.tokenHash'),
      label: 'הכתובת להדבקה ב-SUMIT',
      options: { format: WEBHOOK_TOKEN_FORMAT },
    },

    {
      // SUMIT's own help article, step for step (10442304), because every
      // choice that decides what fires is made there and not here.
      type: 'RichText',
      text:
        '**איך מחברים:** ב-SUMIT, מודול טריגרים ← **יצירת טריגר**.\n\n' +
        '1. **תיקייה ותצוגה** — התיקייה שעליה התהליך יעבוד, ותצוגה שבה הפילטרים בוחרים רק את הכרטיסים הרלוונטיים.\n' +
        '2. **השינוי שיוזם את הטריגר** — יצירה, עדכון, העברה לארכיון או מחיקה.\n' +
        '3. **שלבים לביצוע** — יצירת קריאת HTTP. הדביקו את הכתובת מלמעלה ובחרו סוג קריאה **JSON**.',
    },
    {
      type: 'Label',
      text: 'דורש ב-SUMIT מסלול "צמיחה" ומעלה, ומודולי טריגרים, API וניהול תצוגות מותקנים.',
    },
    {
      // Data minimisation, said where the choice is made: the VIEW's columns are
      // what SUMIT sends, and the whole body is stored with the run.
      type: 'Label',
      text: 'העמודות בתצוגה קובעות אילו שדות נשלחים, והכול נשמר עם ההרצה — השאירו בתצוגה רק את מה שהתהליך צריך. שדות מקושרים מתיקייה אחרת (למשל מייל מכרטיס הלקוח) לא נשלחים.',
    },
    {
      type: 'Label',
      text: 'הקריאה מ-SUMIT אינה חתומה: מי שמחזיק בכתובת יכול לשלוח כל תוכן. השתמשו בה להתראה ולבדיקה — לעולם לא כבסיס לפעולה כספית.',
    },
    {
      // The two ways this node goes quiet that nothing on the canvas shows.
      type: 'Label',
      text: 'אחרי ההדבקה, ודאו במסך "פעולות אוטומציה" ב-SUMIT שהקריאה הראשונה התקבלה. כשהתהליך כבוי הכתובת מחזירה שגיאה, ואחרי חמש שגיאות SUMIT משהה את הטריגר אצלה.',
    },
    {
      type: 'Label',
      text: 'הרצה שמתחילה כאן אינה קשורה לאורח, ולכן צעדים שפועלים על אורח (עדכון סטטוס, שליחת וואטסאפ, בקשת חזרה) ייכשלו בתוכה.',
    },
    statusControl(sumitCardTriggerScope('properties.status')),
  ],
};

// ---------------------------------------------------------------------------
// action.microsoft_send_email
// ---------------------------------------------------------------------------

// Its schema, the connection-aware `microsoftSendEmailSchemaFor` and the option
// shape live in `nodes/action-microsoft-send-email/schema.ts`. The option type is
// re-exported for the editor, which passes the live connections in.
export type { MicrosoftConnectionOption };

// ---------------------------------------------------------------------------
// The palette
// ---------------------------------------------------------------------------


// ---------------------------------------------------------------------------
// trigger.schedule
// ---------------------------------------------------------------------------

// Sunday = 0, matching `Date.getDay()` and Israel's own week.
const scheduleDayOptions = [
  { value: '0', label: 'ראשון' },
  { value: '1', label: 'שני' },
  { value: '2', label: 'שלישי' },
  { value: '3', label: 'רביעי' },
  { value: '4', label: 'חמישי' },
  { value: '5', label: 'שישי' },
  { value: '6', label: 'שבת' },
] as const;

const scheduleSchema = {
  type: 'object',
  required: NODE_REQUIRED_FIELDS['trigger.schedule'],
  properties: {
    ...identityProperties,
    ...statusProperty,
    // `pattern` is the form's half; `matchesSchedule` refuses a bad value again,
    // because the schema constrains what can be TYPED and not what is in the row.
    time: { ...requiredText, pattern: '^([01][0-9]|2[0-3]):[0-5][0-9]$', placeholder: '09:00' },
    days: {
      type: 'array',
      items: { type: 'object', properties: { value: { type: 'string' } } },
    },
  },
} satisfies NodeSchema;

const scheduleScope = getScope<typeof scheduleSchema>;

const scheduleUiSchema: UISchema = {
  type: 'VerticalLayout',
  elements: [
    triggerSwitchElement,
    ...identityControls(scheduleScope('properties.label'), scheduleScope('properties.description')),
    {
      type: 'Text',
      scope: scheduleScope('properties.time'),
      label: 'שעה (24 שעות)',
      placeholder: '09:00',
    },
    {
      type: 'Accordion',
      label: 'באילו ימים',
      elements: [
        {
          type: 'Text',
          scope: scheduleScope('properties.days'),
          label: 'ימים',
          options: {
            format: CHECKBOX_LIST_FORMAT,
            choices: scheduleDayOptions.map((d) => ({ ...d })),
            defaultNote: 'ברירת מחדל: כל יום.',
          },
        },
      ],
    },
    {
      // The two facts an owner cannot see from the canvas.
      type: 'Label',
      text: 'השעה היא לפי שעון ישראל, וממשיכה להיות נכונה גם אחרי מעבר שעון.',
    },
    {
      type: 'Label',
      text: 'הרצה מתוזמנת אינה מתחילה מאורח — צעדים שפועלים על אורח יסרבו בתוכה.',
    },
    statusControl(scheduleScope('properties.status')),
  ],
};


// ---------------------------------------------------------------------------
// action.send_template
// ---------------------------------------------------------------------------

// Its schema, uischema and palette entry live in `nodes/action-send-template/`,
// and the message keys it offers in that folder's `definition.ts`. The bare keys
// are re-exported for the export check (`export-diagram.tsx`), which reads them
// from here.
export { TEMPLATE_KEYS } from '../nodes/action-send-template/definition';

// ---------------------------------------------------------------------------
// action.start_for_each_guest
// ---------------------------------------------------------------------------

const forEachGuestSchema = {
  type: 'object',
  required: NODE_REQUIRED_FIELDS['action.start_for_each_guest'],
  properties: {
    ...identityProperties,
    ...statusProperty,
    errorPolicy: { type: 'string', options: Object.values(errorPolicyOptions) },
    targetWorkflowId: requiredText,
    statuses: {
      type: 'array',
      items: { type: 'object', properties: { value: { type: 'string' } } },
    },
    requirePhone: { type: 'boolean' },
    // `minimum: 1` is the form's half. The handler refuses a missing or
    // non-positive cap again, and the implementation clamps to FAN_OUT_HARD_CAP
    // on top — three ceilings, because this is the node that can reach hundreds
    // of people from one press.
    maxGuests: {
      type: 'number',
      ...NODE_NUMBER_RANGES['action.start_for_each_guest']!.maxGuests,
    },
    ...actionBranchesProperty,
  },
} satisfies NodeSchema;

const forEachGuestScope = getScope<typeof forEachGuestSchema>;

const forEachGuestUiSchema: UISchema = {
  type: 'VerticalLayout',
  elements: [
    ...identityControls(forEachGuestScope('properties.label'), forEachGuestScope('properties.description')),
    {
      // ⚠️ THE WARNING BELONGS WHERE THE DAMAGE IS CONFIGURED. This node starts
      // one run per matching guest — a single press reaches hundreds of real
      // people — and until now the only thing saying so was the node's
      // `description`, which is a subtitle on a card and is read once.
      //
      // `RichText` renders Markdown, so the number an owner is about to choose
      // can be emphasised in the sentence that explains it. It binds to no
      // property and changes no data.
      type: 'RichText',
      text:
        '**כל אורח שתואם יקבל הרצה משלו.** לחיצה אחת יכולה להגיע למאות אנשים אמיתיים. ' +
        'המספר שתגדירו כאן הוא התקרה שלכם — ומעליה יש תקרה נוספת בקוד שאי אפשר לעקוף מהמסך הזה.',
    },
    {
      type: 'Text',
      scope: forEachGuestScope('properties.targetWorkflowId'),
      label: 'מזהה התהליך שירוץ לכל אורח',
      placeholder: 'הדביקו את המזהה מכתובת העורך',
    },
    {
      // Label beside the field rather than above it, with the `*` on the LABEL —
      // the shape the SDK's own Delay node uses for its required numeric field,
      // paired with `errorIndicatorEnabled: false` so one problem draws one
      // marker. The wait node's amount/unit row already reads this way; this
      // field did not, and it is the one with the largest blast radius.
      type: 'HorizontalLayout',
      layoutColumns: '1fr 1fr',
      elements: [
        { type: 'Label', text: 'עד כמה אורחים', required: true },
        {
          type: 'Text',
          scope: forEachGuestScope('properties.maxGuests'),
          inputType: 'number',
          errorIndicatorEnabled: false,
        },
      ],
    },
    {
      // The warning this node exists to carry. One press, hundreds of people.
      type: 'Label',
      text: 'שימו לב: הצעד הזה מתחיל הרצה נפרדת לכל אורח שמתאים. הריצו הרצת ניסיון לפני הפעלה — היא תראה לכמה אורחים זה יגיע.',
    },
    {
      type: 'Accordion',
      label: 'אילו אורחים',
      elements: [
        {
          type: 'Text',
          scope: forEachGuestScope('properties.statuses'),
          label: 'סטטוסים',
          options: {
            format: CHECKBOX_LIST_FORMAT,
            choices: Object.values(rsvpStatusOptions).map((o) => ({ value: o.value, label: o.label })),
            defaultNote: 'ברירת מחדל: כל הסטטוסים.',
          },
        },
        {
          type: 'Switch',
          scope: forEachGuestScope('properties.requirePhone'),
          label: 'רק אורחים עם טלפון',
        },
      ],
    },
    {
      type: 'Select',
      scope: forEachGuestScope('properties.errorPolicy'),
      label: 'אם הפיצול נכשל',
    },
    statusControl(forEachGuestScope('properties.status')),
  ],
};

/**
 * Built at MODULE SCOPE.
 *
 * `<WorkflowBuilder.Root nodeTypes={…} />` wants a stable reference: an array
 * rebuilt each render re-renders the palette on every diagram change, which on a
 * large graph is the difference between a canvas that drags and one that
 * stutters. This is static data, so there is nothing to recompute anyway.
 *
 * EVERY entry carries an `outputSchema`, which is what puts a node into the
 * variable picker's suggestion list. An earlier note here said the opposite —
 * "omitted deliberately, until a template resolver exists". That resolver is
 * `resolve-template.ts`: vendored, wired into `activity-runner.ts`, and proven
 * on the `nodes.` namespace by `references.test.ts`. The note described a state
 * that had already ended.
 */

// ---------------------------------------------------------------------------
// action.start_voice_call
// ---------------------------------------------------------------------------

// Its schema, the live-list factory `voiceCallSchemaFor` and the two option
// shapes live in `nodes/action-start-voice-call/schema.ts`. The option types are
// re-exported for the editor, which passes the live lists in.
export type { VoiceDialOption, VoicePurposeOption };

/**
 * The read-only run report, drawn by `node-run-control.tsx`.
 *
 * ⚠️ A `Label` AND NOT A CONTROL, because it edits nothing. The SDK's UISchema
 * union is CLOSED — `UISchemaControlElement | UISchemaLayoutElement |
 * LabelElement | RichTextElement` — so "render my component here" has to be an
 * existing element carrying `options.format`, which is the same contract the
 * other four custom renderers in this file use. `text` is required by the type
 * and never drawn: the renderer replaces the element outright.
 */
const NODE_RUN_ELEMENT: UISchema = {
  type: 'Label',
  text: 'הרצה',
  options: { format: NODE_RUN_FORMAT },
};

/**
 * Put the run report at the top of a node's properties panel.
 *
 * ⚠️ HERE AND NOT IN THE NINETEEN UISCHEMAS, because it is not a property of any
 * node — it is the editor reporting on a run. One place also means a node type
 * added later gets it without anyone remembering to.
 *
 * ⚠️ AND HERE RATHER THAN ON `PALETTE_ITEMS` ITSELF. That array is also read by
 * `normalizeLegacyProperties` and by the tests that police container choice;
 * neither has any business seeing an element that exists only for the editor's
 * live view. `nodeTypes` is the only consumer that needs it, and this function
 * is what builds it.
 *
 * ⚠️ FIRST, matching where the vendor puts `globalControls` in their own nodes.
 * It is also what an owner opening a node DURING a run came to read; the
 * settings are still one line below, and the control renders nothing at all
 * when no run is on the canvas.
 */
function withNodeRunControl(item: PaletteItem): PaletteItem {
  const { uischema } = item;
  // `uischema` is OPTIONAL on the vendor's `NodeDefinition`, and every entry
  // here is a VerticalLayout. Both checks are cheaper than a crash if one ever
  // is not — a node whose panel simply lacks the report is a far better failure
  // than a panel that does not render.
  if (!uischema || !('elements' in uischema) || !Array.isArray(uischema.elements)) return item;
  return {
    ...item,
    uischema: { ...uischema, elements: [NODE_RUN_ELEMENT, ...uischema.elements] },
  };
}

/**
 * The palette, built for a given set of WhatsApp numbers.
 *
 * A FACTORY and not a const, because one entry's dropdown is a live list: the
 * account's numbers are rows in `provider_numbers` and change without a deploy.
 *
 * ⚠️ THE SDK REQUIRES A STABLE REFERENCE for `nodeTypes` ("declare at module
 * scope or memoize" — README). A fresh array each render would re-register the
 * palette on every keystroke. The editor therefore calls this inside `useMemo`;
 * calling it in a render body would be the bug this note exists to prevent.
 */
export function buildPaletteItems(
  numbers: readonly WhatsAppNumberOption[] = [],
  /**
   * The configured voice agents, for `action.start_voice_call`'s dropdown.
   *
   * Empty means the node offers nothing to pick — which is the honest state
   * when no purpose has been set up, and the handler refuses a blank anyway.
   */
  voicePurposes: readonly VoicePurposeOption[] = [],
  /**
   * The dial parameters the call node may be pointed at, both live lists.
   *
   * Empty is a legitimate state for either: an account with no synced number,
   * or a Voximplant read that failed or was never asked for. The node then
   * offers only its blank default, which is the behaviour that shipped before
   * these fields existed — never a broken control.
   */
  voiceCallerIds: readonly VoiceDialOption[] = [],
  voiceRules: readonly VoiceDialOption[] = [],
  voiceAgents: readonly VoiceDialOption[] = [],
  microsoftConnections: readonly MicrosoftConnectionOption[] = [],
  /**
   * The SUMIT trigger's fields as THIS workflow's latest SUMIT call carried
   * them — see `sumitCardOutputFromSample`. `null` keeps the fixed list, which
   * is the state of any workflow SUMIT has not called yet.
   */
  sumitCardOutput: SumitCardOutput | null = null,
): PaletteItem[] {
  return PALETTE_ITEMS.map((item) => {
    if (item.type === 'trigger.sumit_card' && sumitCardOutput) {
      return withNodeRunControl({ ...item, outputSchema: { type: 'default', properties: sumitCardOutput } });
    }
    if (item.type === 'trigger.whatsapp_inbound') {
      return withNodeRunControl({ ...item, schema: triggerSchemaFor(numbers) });
    }
    if (item.type === startVoiceCallDefinition.type) {
      return withNodeRunControl({
        ...item,
        schema: voiceCallSchemaFor(voicePurposes, voiceCallerIds, voiceRules, voiceAgents),
      });
    }
    if (item.type === microsoftSendEmailDefinition.type) {
      return withNodeRunControl({
        ...item,
        schema: microsoftSendEmailSchemaFor(microsoftConnections),
      });
    }
    return withNodeRunControl(item);
  });
}

/**
 * The palette with NO numbers offered — the dropdown shows only "כל המספרים".
 *
 * Kept as the base the factory rewrites one entry of, so every other node type
 * is declared exactly once. It is also what the tests and the i18n audit read.
 */
export const PALETTE_ITEMS: PaletteItem[] = [
  // Moved to its own folder — see nodes/action-sumit-create-document/.
  sumitCreateDocumentPaletteItem,
  // Moved to its own folder — see nodes/action-sumit-create-customer/.
  sumitCreateCustomerPaletteItem,
  // Moved to its own folder — see nodes/action-ai-agent/.
  aiAgentPaletteItem,
  // Moved to its own folder — see nodes/action-start-voice-call/.
  voiceCallPaletteItem,
  {
    type: 'trigger.whatsapp_inbound' satisfies KalfaNodeType,
    label: 'הודעת וואטסאפ נכנסת',
    description: 'מתחיל את התהליך כשאורח שולח הודעה',
    icon: 'WhatsappLogo',
    // Renders with the SDK's start-node body, which draws ONE handle —
    // `type: 'source'` — where the default body draws a source AND a target.
    // The target dot on a trigger is an affordance for a connection rule 6
    // forbids and `isValidConnection` always rejects: the owner can aim at it,
    // and nothing lands. This removes the dot instead of refusing the drop, so
    // the rule is visible rather than merely enforced.
    //
    // Not `isStartNode: true` — that field does not exist in 2.3.0 (it is
    // queued in an unreleased changeset), and even once it does it is a data
    // marker the editor writes into `data`, which rule 3 forbids us to read.
    // `templateType` is only ever about the visual template, which upstream
    // states explicitly, so the two concerns stay separate.
    templateType: NodeType.StartNode,
    schema: triggerSchema,
    uischema: triggerUiSchema,
    // The trigger's output is the inbound message itself. With this declared,
    // `{{nodes.<trigger-id>.message_text}}` appears in the picker — note that
    // `{{trigger.message_text}}` reaches the SAME value by the other namespace,
    // which upstream's guide warns are not interchangeable in general.
    outputSchema: {
      type: 'default',
      properties: {
        message_text: { type: 'string', label: 'תוכן ההודעה', description: 'מה שהאורח כתב' },
        button_payload: { type: 'string', label: 'כפתור שנלחץ' },
      },
    },
    defaultPropertiesData: {
      status: nodeStatusOptions.active.value,
      label: 'הודעת וואטסאפ נכנסת',
      description: 'מתחיל את התהליך כשאורח שולח הודעה',
      keyword: '',
      // Empty = any number. The owner's ruling 2026-09-13: a diagram saved
      // before this field must not silently narrow to one line.
      phoneNumberId: '',
    },
  } satisfies PaletteItem<typeof triggerSchema>,
  {
    type: 'trigger.webhook' satisfies KalfaNodeType,
    label: 'קריאת Webhook נכנסת',
    description: 'מערכת חיצונית קוראת לכתובת והתהליך מתחיל',
    icon: 'Plugs',
    templateType: NodeType.StartNode,
    schema: webhookTriggerSchema,
    uischema: webhookTriggerUiSchema,
    // The whole JSON the caller sent, under one key. Declared as an object with
    // no properties BECAUSE the shape is the caller's: a fixed field list here
    // would be the hard-coding this node exists to avoid. The picker offers
    // `{{trigger.body}}` and an owner types the path they know they send.
    outputSchema: {
      type: 'default',
      properties: {
        body: {
          type: 'object',
          label: 'גוף הבקשה',
          description: 'כל מה שנשלח — ניתן לפנות אליו כ-{{trigger.body.שם_השדה}}',
        },
        // Published SEPARATELY rather than folded into `body`. A GET carries no
        // body, and merging its query string into one would make
        // `{{trigger.body.x}}` mean two different things depending on the verb —
        // the confusion n8n avoids by exposing `{ body, headers, params, query }`
        // as distinct members.
        query: {
          type: 'object',
          label: 'פרמטרים בכתובת',
          description: 'ה-query string — ניתן לפנות אליו כ-{{trigger.query.שם_השדה}}',
        },
      },
    },
    defaultPropertiesData: {
      status: nodeStatusOptions.active.value,
      label: 'קריאת Webhook נכנסת',
      description: 'מערכת חיצונית קוראת לכתובת והתהליך מתחיל',
      // ⚠️ `header` EXPLICITLY, NOT LEFT ABSENT. `readWebhookAuthMode` reads an
      // absent value as `header` anyway, so this changes no behaviour — it is
      // here because `palette-defaults.test.ts` requires a conditional rule's
      // decider to be a member of its own `whenIn`, and a node born with the
      // field set is a node whose mode is visible in the panel from the first
      // render rather than implied.
      auth: 'header',
      // Both halves start blank and are minted together by the control. A
      // diagram with one and not the other is the state `arm-check` refuses.
      // In `address` mode this one stays blank forever — the path is never
      // stored, only its hash.
      endpointId: '',
      // Empty means POST only. See `webhookAllowsMethod` — an absent value must
      // never widen a live public endpoint.
      methods: [],
      // ⚠️ `tokenHash`, NOT `token` — this key must match `webhookTriggerSchema`
      // and the uischema's `properties.tokenHash` scope, or a node dragged from
      // the palette is born carrying a field the schema does not declare AND
      // missing its only required one. That was live until 2026-09-22 and no
      // gate saw it: the key is a plain string in three files that never get
      // compared. `palette-defaults.test.ts` now compares them.
      //
      // EMPTY, never a value minted here. This module runs in the BROWSER, and a
      // token from `Math.random`/`crypto` on a page is a token whose entropy
      // nobody audited. `webhook-token-control.tsx` generates it and stores only
      // its sha256.
      tokenHash: '',
    },
  } satisfies PaletteItem<typeof webhookTriggerSchema>,
  {
    type: 'trigger.schedule' satisfies KalfaNodeType,
    label: 'לפי שעון',
    description: 'מתחיל את התהליך בשעה קבועה',
    icon: 'Clock',
    // The SDK's start-node body draws one handle, no target dot — the same
    // reason the other triggers use it.
    templateType: NodeType.StartNode,
    schema: scheduleSchema,
    uischema: scheduleUiSchema,
    outputSchema: {
      type: 'default',
      properties: {
        firedAt: { type: 'string', label: 'מתי רץ', description: 'התאריך והשעה בשעון ישראל' },
      },
    },
    defaultPropertiesData: {
      status: nodeStatusOptions.active.value,
      label: 'לפי שעון',
      description: 'מתחיל את התהליך בשעה קבועה',
      time: '09:00',
      days: [],
    },
  } satisfies PaletteItem<typeof scheduleSchema>,
  {
    type: 'trigger.sumit_card' satisfies KalfaNodeType,
    label: 'שינוי בכרטיס SUMIT',
    description: 'SUMIT מודיעה שכרטיס נוצר, עודכן, הועבר לארכיון או נמחק',
    icon: 'IdentificationCard',
    templateType: NodeType.StartNode,
    schema: sumitCardTriggerSchema,
    uischema: sumitCardTriggerUiSchema,
    // Exactly what the handler returns — `sumitCardTrigger` in steps/index.ts.
    //
    // The "תפיסות מסגרת" fields were MEASURED, not guessed: `/crm/schema/getfolder/`
    // on folder 1076735289 (2026-09-23) returned exactly these nine `APIName`s,
    // and the live webhooks carried the same keys with these shapes (every value
    // a list; references as `{ ID, Name, … }`). Keys are paths: the picker inserts
    // `{{nodes.<id>.<key>}}` verbatim and `resolveTemplate` walks dots through
    // arrays, so `.0` is the first value. (The vendor's docs call array indexing
    // unsupported; the vendored resolver does it anyway, unmodified, and
    // `sumit-card-trigger.test.ts` pins that it still does.)
    //
    // ⚠️ FLAT, ALTHOUGH THE FIELDS BELONG TO ONE FOLDER — chosen over the SDK's
    // `variant` form after measuring both. `variant` (fields chosen by a node
    // setting) is typed in `index.d.ts` but absent from the docs, and the editor
    // resolves a reference's TYPE only from `outputSchema.properties` (`eL`) —
    // so under `variant` every field reads as text and the condition editor
    // never offers "greater than" on the amount. None of the four decorable SDK
    // functions touches type lookup, so no plugin can fix it. The price of flat
    // is that another folder's SUMIT node is offered these too; each label says
    // "(תפיסות מסגרת)".
    outputSchema: {
      type: 'default',
      properties: { ...SUMIT_CARD_BASE_OUTPUT, ...SUMIT_HOLD_FIELDS_OUTPUT },
    },
    defaultPropertiesData: {
      status: nodeStatusOptions.active.value,
      label: 'שינוי בכרטיס SUMIT',
      description: 'SUMIT מודיעה שכרטיס נוצר, עודכן, הועבר לארכיון או נמחק',
      // EMPTY: minted in the editor, shown once, stored only as a hash.
      tokenHash: '',
    },
  } satisfies PaletteItem<typeof sumitCardTriggerSchema>,
  // Moved to its own folder — see nodes/logic-condition/.
  conditionPaletteItem,
  // Moved to its own folder — see nodes/logic-switch/.
  switchPaletteItem,
  // Moved to its own folder — see nodes/action-update-guest-status/.
  updateGuestStatusPaletteItem,
  // Moved to its own folder — see nodes/action-send-whatsapp/.
  sendWhatsappPaletteItem,
  // Moved to its own folder — see nodes/action-microsoft-send-email/.
  microsoftSendEmailPaletteItem,
  // Moved to its own folder — see nodes/action-start-rsvp-ai-callback/.
  startRsvpAiCallbackPaletteItem,
  // Moved to its own folder — see nodes/action-notify-team/.
  notifyTeamPaletteItem,
  // Moved to its own folder — see nodes/action-set-guest-field/.
  setGuestFieldPaletteItem,
  // Moved to its own folder — see nodes/action-create-callback-request/.
  callbackRequestPaletteItem,
  // Moved to its own folder — see nodes/action-webhook/.
  webhookPaletteItem,
  // Moved to its own folder — see nodes/action-import-guest-list/.
  importGuestListPaletteItem,
  // Moved to its own folder — see nodes/logic-wait/.
  waitPaletteItem,
  // Moved to its own folder — see nodes/action-send-template/.
  sendTemplatePaletteItem,
  {
    type: 'action.start_for_each_guest' satisfies KalfaNodeType,
    // Decision node so a failure has a handle to leave from — a fan-out that
    // could not read the guest list is exactly the case worth routing.
    templateType: NodeType.DecisionNode,
    label: 'הרצה לכל אורח',
    description: 'מתחיל תהליך נפרד לכל אורח שמתאים',
    icon: 'UsersThree',
    schema: forEachGuestSchema,
    uischema: forEachGuestUiSchema,
    outputSchema: {
      type: 'default',
      properties: {
        started: { type: 'number', label: 'כמה הרצות התחילו' },
        matched: { type: 'number', label: 'כמה אורחים התאימו' },
        capped: { type: 'boolean', label: 'נעצר בתקרה', description: 'היו יותר אורחים מהתקרה' },
        // The same gap as `action.import_guest_list`: the error branch returns
        // `{ started: 0, reason }`, `reason` was never published, and the
        // weekly-sweep starter referenced it as `{{…reason?}}` from the source
        // rather than from the picker.
        reason: { type: 'string', label: 'סיבת הכישלון', description: 'קיים רק במסלול "נכשל"' },
      },
    },
    defaultPropertiesData: {
      decisionBranches: actionBranches.map((branch) => ({ ...branch })),
      status: nodeStatusOptions.active.value,
      label: 'הרצה לכל אורח',
      description: 'מתחיל תהליך נפרד לכל אורח שמתאים',
      targetWorkflowId: '',
      statuses: [],
      requirePhone: true,
      // A deliberately SMALL default. A number an owner has to raise on purpose
      // is a number they have thought about.
      maxGuests: 25,
      errorPolicy: errorPolicyOptions.fail.value,
    },
  } satisfies PaletteItem<typeof forEachGuestSchema>,
  // Moved to its own folder — see nodes/logic-set-value/.
  setValuePaletteItem,
];
