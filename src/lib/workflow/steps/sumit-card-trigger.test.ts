import { describe, expect, it } from 'vitest';

import { PALETTE_ITEMS } from '@/lib/workflow/catalogue/schemas';
import { DIAGRAM_TEMPLATES } from '@/lib/workflow/catalogue/templates';
import { dryRunWorkflow } from '@/lib/workflow/engine/dry-run';
import { resolveTemplate } from '@/lib/workflow/vendor/workflowbuilder/execution-core/templates/resolve-template';

import { STEP_HANDLERS, type StepContext } from './index';

// `trigger.sumit_card` — SUMIT tells us a card changed.
//
// Two properties this file exists to hold:
//
//   1. THE HANDLER NEVER THROWS ON A STRANGE BODY. The payload is unsigned and
//      arrives on a public URL, so anything can be in it. A field that is not
//      the expected shape becomes `null` — never `undefined`, because a plain
//      `{{…}}` reference throws on `undefined` and would fail every step that
//      quotes it.
//   2. THE STARTER TEMPLATE RUNS END TO END on the shape SUMIT's own automation
//      log shows, and on an empty body, through the real pipeline.

const handler = STEP_HANDLERS['trigger.sumit_card'];

function ctx(body: Record<string, unknown> | undefined): StepContext {
  return {
    runId: 'run-1',
    workflowId: 'wf-1',
    nodeId: 'trigger',
    trigger: { message_text: '', button_payload: '', ...(body ? { body } : {}) },
    deps: {} as StepContext['deps'],
  };
}

/**
 * The shape from SUMIT's "פעולות אוטומציה" screenshot (help article 10442304):
 * every property an array, reference/enum properties as objects with a `Name`.
 */
const SCREENSHOT_BODY = {
  Folder: 440486517,
  EntityID: 632049688,
  Type: 'CreateOrUpdate',
  Properties: {
    Billing_Amount: [11.8],
    Billing_ExternalIdentifier: ['2025-01-22T11:12:28+02:00'],
    Billing_PaymentSource: [{ Version: 1, Status: 0, SchemaID: 440485932, ID: 632049680, Name: 'טריגר לדוגמה' }],
    Billing_CurrencyEnum: [{ Version: 5, Status: 0, SchemaID: 470860471, ID: 507860240, Name: 'שירות בעסק' }],
  },
};

describe('the handler publishes what SUMIT sent', () => {
  it('names the four fields SUMIT sends, and keeps the whole body too', async () => {
    const { output } = await handler({}, ctx(SCREENSHOT_BODY));
    expect(output).toEqual({
      folder: 440486517,
      entityId: 632049688,
      changeType: 'CreateOrUpdate',
      properties: SCREENSHOT_BODY.Properties,
      body: SCREENSHOT_BODY,
      // Another company's folder: no NAME is guessed for its codes.
      holdStatus: null,
      holdCurrency: null,
    });
  });

  it('⚠️ an empty body is nulls, never undefined — a plain reference must not throw', async () => {
    const { output } = await handler({}, ctx(undefined));
    expect(output).toEqual({
      folder: null,
      entityId: null,
      changeType: null,
      properties: {},
      body: {},
      holdStatus: null,
      holdCurrency: null,
    });
    for (const value of Object.values(output as Record<string, unknown>)) {
      expect(value).not.toBeUndefined();
    }
  });

  it('⚠️ a hostile body is not trusted for its types', async () => {
    // Anyone holding the address can post anything. Wrong types become null
    // rather than objects a later step would stringify into a message.
    const { output } = await handler(
      {},
      ctx({ Folder: { evil: true }, EntityID: [1, 2], Type: 42, Properties: ['not', 'an', 'object'] }),
    );
    expect(output).toMatchObject({ folder: null, entityId: null, changeType: null, properties: {} });
  });
});

describe('the starter template, end to end through the real pipeline', () => {
  const template = DIAGRAM_TEMPLATES.find((t) => t.value.name === 'תפיסת מסגרת השתנתה ב-SUMIT — התראה לצוות');

  function run(triggerBody?: Record<string, unknown>) {
    const value = template!.value;
    return dryRunWorkflow({
      workflowId: 'wf-sumit',
      storedDefinition: {
        name: value.name,
        layoutDirection: value.layoutDirection,
        nodes: value.diagram.nodes,
        edges: value.diagram.edges,
      },
      scenario: { messageText: '', buttonPayload: '', guestCase: 'none' },
      ...(triggerBody ? { triggerBody } : {}),
    });
  }

  it('exists', () => {
    expect(template).toBeDefined();
  });

  it('on a live-shaped release: completes, the card id in the TITLE, the status by NAME', async () => {
    const result = await run({
      Type: 'CreateOrUpdate',
      Folder: 1076735289,
      EntityID: 2195604142,
      Properties: { Billing_Status: [3], Billing_Amount: [50], Billing_Currency: [1] },
    });

    expect(result.outcome.status).toBe('completed');
    expect(result.effects).toHaveLength(1);
    const alert = result.effects[0]!.description;
    // The title carries the id: the alert layer drops a repeated title inside its
    // dedup window, so a fixed one would report one release and swallow the rest.
    expect(alert).toContain('תפיסת מסגרת 2195604142 השתנתה ב-SUMIT');
    expect(alert).toContain('CreateOrUpdate');
    expect(alert).toContain('סטטוס: שוחררה (3)');
    expect(alert).toContain('סכום: 50 שקל (1)');
  });

  it('⚠️ a status arriving in an unexpected shape still completes — shown as missing, never guessed', async () => {
    const result = await run({
      Folder: 1076735289,
      EntityID: 1,
      Type: 'CreateOrUpdate',
      Properties: { Billing_Status: [{ Version: 1, Status: 0, SchemaID: 1, ID: 3, Name: 'שוחרר' }] },
    });
    expect(result.outcome.status).toBe('completed');
    expect(result.effects[0]!.description).toContain('סטטוס: null');
  });

  it('⚠️ on an EMPTY body: still completes — nothing in the alert throws', async () => {
    // `?` on the status and `null` from the handler for the rest. A run that
    // failed here would mean a malformed call from SUMIT (or anyone) produced no
    // alert at all, which is the one thing this template exists to prevent.
    const result = await run();
    expect(result.outcome.status).toBe('completed');
    expect(result.effects).toHaveLength(1);
    expect(result.effects[0]!.description).toContain('תפיסת מסגרת null השתנתה ב-SUMIT');
  });
});

// ---------------------------------------------------------------------------
// The variable picker — what the next step is OFFERED
// ---------------------------------------------------------------------------

/**
 * The "תפיסות מסגרת" folder's properties, exactly as `/crm/schema/getfolder/`
 * returned them for folder 1076735289 on 2026-09-23 (`APIName`s).
 */
const MEASURED_HOLD_API_NAMES = [
  'Billing_Amount',
  'Billing_CreditGuyTransaction',
  'Billing_Currency',
  'Billing_Customer',
  'Billing_Date',
  'Billing_OrderDocument',
  'Billing_PaymentDocument',
  'Billing_PaymentMethod',
  'Billing_Status',
];

/** A release as the live webhook delivered it, personal values replaced. */
const HOLD_BODY = {
  Type: 'CreateOrUpdate',
  Folder: 1076735289,
  EntityID: 2195604142,
  Properties: {
    Billing_Date: ['2026-07-29T04:07:08+03:00'],
    Billing_Amount: [50],
    Billing_Status: [3],
    Billing_Currency: [1],
    Billing_Customer: [{ ID: 11, Name: 'לקוח לדוגמה', Status: 0, Version: 1, SchemaID: 1076734599 }],
    Billing_PaymentMethod: [{ ID: 22, Name: 'כרטיס אשראי (0000)', Status: 0, Version: 0, SchemaID: 1076735281 }],
    Billing_CreditGuyTransaction: [{ ID: 33, Name: '29/07/2026 04:07', Status: 0, Version: 0, SchemaID: 1076735182 }],
  },
};

const sumitItem = PALETTE_ITEMS.find((i) => i.type === 'trigger.sumit_card')!;
const offered = (): Record<string, { type: string; label: string; description?: string }> => {
  const schema = sumitItem.outputSchema!;
  if (schema.type !== 'default') throw new Error('expected a flat outputSchema');
  return schema.properties as Record<string, { type: string; label: string; description?: string }>;
};

/**
 * The SDK's own type lookup for an inserted reference, copied from `eL` + `_a`
 * in `@workflowbuilder/sdk` 2.3.0's bundle: the path is looked up VERBATIM in
 * `outputSchema.properties`, `object`/`array` count as unknown, and unknown is
 * `'string'`. The condition editor picks its operators from this.
 */
function sdkTypeOf(reference: string): string {
  const inner = reference.trim().slice(2, -2);
  const [, , ...path] = inner.split('.');
  const type = offered()[path.join('.')]?.type;
  return type === 'object' || type === 'array' || type === undefined ? 'string' : type;
}

const ALWAYS_SENT = MEASURED_HOLD_API_NAMES.filter(
  (n) => n !== 'Billing_OrderDocument' && n !== 'Billing_PaymentDocument',
);

describe('the picker offers the hold folder’s fields — with their TYPES', () => {
  it('⚠️ the output schema is FLAT — a `variant` one makes every field read as text', () => {
    expect(sumitItem.outputSchema?.type).toBe('default');
  });

  it('every measured property is offered, nothing invented, and the base fields are kept', () => {
    const keys = Object.keys(offered());
    expect(keys.slice(0, 5)).toEqual(['folder', 'entityId', 'changeType', 'properties', 'body']);
    const named = new Set(keys.filter((k) => k.startsWith('properties.')).map((k) => k.split('.')[1]));
    expect([...named].sort()).toEqual(MEASURED_HOLD_API_NAMES);
  });

  it('each hold field says which folder it belongs to — another folder’s node is offered them too', () => {
    for (const [key, field] of Object.entries(offered())) {
      if (key.startsWith('properties.')) expect(field.label, key).toMatch(/\(תפיסות מסגרת\)$/);
    }
  });

  it('⚠️ the editor sees the amount as a NUMBER — so the condition editor offers "greater than"', () => {
    expect(sdkTypeOf('{{nodes.t.properties.Billing_Amount.0}}')).toBe('number');
    expect(sdkTypeOf('{{nodes.t.properties.Billing_Status.0}}')).toBe('number');
    expect(sdkTypeOf('{{nodes.t.properties.Billing_Date.0}}')).toBe('datetime');
    // …and the measured trade-off the descriptions are written around: a `?`
    // makes the path miss, and the same field reads as text.
    expect(sdkTypeOf('{{nodes.t.properties.Billing_Amount.0?}}')).toBe('string');
  });

  it('`?` is advised ONLY on the two fields that can be absent', () => {
    for (const [key, field] of Object.entries(offered())) {
      if (!key.startsWith('properties.')) continue;
      const optional = key.includes('Billing_OrderDocument') || key.includes('Billing_PaymentDocument');
      expect(field.description?.includes('הוסיפו ?'), key).toBe(optional);
    }
  });

  it('⚠️ the always-sent fields RESOLVE WITHOUT `?` on the real shape; the optional ones need it', async () => {
    const { output } = await handler({}, ctx(HOLD_BODY));
    const context = { workflowId: 'w', executionId: 'e', triggerPayload: {}, nodeOutputs: { t: output }, variables: {}, global: {} };
    const resolved: Record<string, string> = {};
    for (const key of Object.keys(offered()).filter((k) => ALWAYS_SENT.some((n) => k.includes(`.${n}.`)))) {
      resolved[key] = resolveTemplate(`{{nodes.t.${key}}}`, context);
    }
    expect(resolved).toEqual({
      'properties.Billing_Date.0': '2026-07-29T04:07:08+03:00',
      'properties.Billing_Amount.0': '50',
      'properties.Billing_Currency.0': '1',
      'properties.Billing_Status.0': '3',
      'properties.Billing_Customer.0.Name': 'לקוח לדוגמה',
      'properties.Billing_Customer.0.ID': '11',
      'properties.Billing_PaymentMethod.0.Name': 'כרטיס אשראי (0000)',
      'properties.Billing_PaymentMethod.0.ID': '22',
      'properties.Billing_CreditGuyTransaction.0.Name': '29/07/2026 04:07',
      'properties.Billing_CreditGuyTransaction.0.ID': '33',
    });
    expect(resolveTemplate('{{nodes.t.properties.Billing_PaymentDocument.0.Name?}}', context)).toBe('');
    expect(() => resolveTemplate('{{nodes.t.properties.Billing_PaymentDocument.0.Name}}', context)).toThrow(/Unresolved/);
  });
});

// ---------------------------------------------------------------------------
// The status NAME — SUMIT sends only the code
// ---------------------------------------------------------------------------

describe('holdStatus: the code, named — only where the codes are known', () => {
  const holdsCall = (status: unknown, folder: unknown = 1076735289) => ({
    Folder: folder,
    EntityID: 1,
    Type: 'CreateOrUpdate',
    Properties: { Billing_Status: [status] },
  });
  const statusOf = async (body: Record<string, unknown>) =>
    ((await handler({}, ctx(body))).output as { holdStatus: unknown }).holdStatus;

  it('the codes our reconciler verified are named, the code kept beside the name', async () => {
    expect(await statusOf(holdsCall(1))).toBe('פתוחה (1)');
    expect(await statusOf(holdsCall(3))).toBe('שוחררה (3)');
    expect(await statusOf(holdsCall(2))).toBe('חויבה (2)');
  });

  it('an unknown code is SAID to be unknown — never mapped to the nearest name', async () => {
    expect(await statusOf(holdsCall(7))).toBe('קוד לא מוכר (7)');
  });

  it('⚠️ another folder gets no name — the same code may mean something else there', async () => {
    expect(await statusOf(holdsCall(3, 440486517))).toBeNull();
  });

  it('the folder may arrive as text (a form-encoded call) and still match', async () => {
    expect(await statusOf(holdsCall(3, '1076735289'))).toBe('שוחררה (3)');
  });

  it('no code, or not a number: null — a plain `{{…holdStatus}}` still resolves', async () => {
    expect(await statusOf({ Folder: 1076735289, Properties: {} })).toBeNull();
    expect(await statusOf(holdsCall('3'))).toBeNull();
  });

  it('is offered in the picker as TEXT, labelled for the holds folder', () => {
    expect(offered().holdStatus).toMatchObject({ type: 'string' });
    expect(offered().holdStatus?.label).toMatch(/\(תפיסות מסגרת\)$/);
  });
});

describe('holdCurrency: the currency code, named — only the one verified', () => {
  const currencyOf = async (code: unknown, folder: unknown = 1076735289) =>
    (
      (await handler({}, ctx({ Folder: folder, EntityID: 1, Properties: { Billing_Currency: [code] } })))
        .output as { holdCurrency: unknown }
    ).holdCurrency;

  it('1 is the shekel — verified on a real hold card (2195604142 shows ₪)', async () => {
    expect(await currencyOf(1)).toBe('שקל (1)');
  });

  it('⚠️ 0 is NOT assumed to be the shekel, although it is in the charge API', async () => {
    expect(await currencyOf(0)).toBe('קוד לא מוכר (0)');
  });

  it('another folder gets no name', async () => {
    expect(await currencyOf(1, 440486517)).toBeNull();
  });

  it('is offered in the picker as TEXT, labelled for the holds folder', () => {
    expect(offered().holdCurrency).toMatchObject({ type: 'string' });
    expect(offered().holdCurrency?.label).toMatch(/\(תפיסות מסגרת\)$/);
  });
});
