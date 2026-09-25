import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { PALETTE_ITEMS } from '@/lib/workflow/catalogue/schemas';
import {
  NODE_DEPLOYMENT_BINDINGS,
  type KalfaNodeType,
} from '@/lib/workflow/catalogue/types';

// ⚠️ THE NET THAT CATCHES THE NEXT `token`.
//
// The first draft of NODE_DEPLOYMENT_BINDINGS was built from the properties
// present in this installation's saved workflows — 21 nodes — and missed
// `trigger.webhook.token` and `action.start_for_each_guest.targetWorkflowId`
// outright, because neither node type had ever been used here. One of those two
// is the webhook trigger's entire credential.
//
// So classification cannot be a list somebody remembers to update. Every
// property of every node type must be either bound (and therefore scrubbed on
// export) or named below with the reason it travels. A new node with a new
// identifier fails HERE rather than leaking quietly on the first export.
//
// Read from PALETTE_ITEMS at runtime, not by parsing the source: the catalogue
// is the thing that ships, and a regex over it would have its own blind spots —
// which is exactly the failure this test exists to prevent.

/**
 * Properties reviewed and found to mean the same thing in any installation.
 * The value is the reason, so a future reader can disagree with a specific
 * judgement rather than with an undifferentiated list.
 */
const REVIEWED_PORTABLE: Record<string, string> = {
  // Identity and presentation — an author's own words.
  label: 'the author’s text',
  description: 'the author’s text',
  title: 'the author’s text',
  detail: 'the author’s text',
  note: 'the author’s text',
  subject: 'the author’s text',
  body: 'the author’s text, possibly with {{…}} references that rebind on import',
  to: 'a recipient the author typed; not an installation identifier',
  cc: 'more recipients the author typed; addresses, not installation identifiers',
  bcc: 'more recipients the author typed; addresses, not installation identifiers',
  replyTo: 'a reply address the author typed; not an installation identifier',

  // An HTTP verb means the same thing on every host. Unlike `endpointId` and
  // `tokenHash` — which name an address ON THIS INSTALLATION and are bound —
  // "this webhook accepts PUT" is a statement about the CALLER's integration and
  // travels with the diagram unchanged. An import that dropped it would silently
  // narrow the endpoint back to POST.
  methods: 'HTTP verbs; a fact about the caller, not about this installation',
  // SUMIT's own TriggerType (CreateOrUpdate, Update, …): the same words on every
  // SUMIT account. The folder and view it applies to are bound; the verb travels.
  changeType: 'a SUMIT trigger type; the same on every account',

  // ⚠️ THE MODE TRAVELS; WHAT IT AUTHENTICATES DOES NOT. `auth` records a fact
  // about the CALLER — "this system cannot send a header" is true of SUMIT on
  // any installation — while the value it governs (`endpointId`, `tokenHash`)
  // is bound and stripped on export either way. Dropping it on import would be
  // the dangerous direction and not the safe one: the node would land in
  // `header` mode, and the importer would rebuild a header integration for a
  // caller that cannot speak one.
  auth: 'header / address — a fact about the caller’s abilities, not about this installation',

  // The author's instruction to a model, and a model ALIAS rather than an id —
  // `haiku` / `sonnet` mean the same thing wherever the CLI runs, which is also
  // why the catalogue stores aliases (a pinned id would freeze a diagram on a
  // model that is eventually retired).
  systemPrompt: 'the author’s instruction, with {{…}} references that rebind on import',
  model: 'a model alias the CLI resolves; the same everywhere',
  maxTurns: 'a ceiling the author chose; not an installation fact',

  // Editor and engine state that is meaningful anywhere.
  //
  // ⚠️ `armNotice` HAS NO VALUE TO CARRY — it is a SCOPE, declared so the
  // vendor's `MessageOnError` control has something to aim at. Nothing writes
  // it, no `defaultPropertiesData` seeds it, and no diagram will ever contain
  // it; it exists only so a node-level arm refusal reaches the properties panel
  // instead of leaving an unexplained exclamation mark. Binding it would be
  // stripping a key that is never there.
  armNotice: 'a display anchor for node-level arm refusals; never holds a value',
  status: 'active/disabled, a node-level switch',
  errorPolicy: 'fail / continue — engine behaviour',
  decisionBranches: 'branch ids and labels internal to this diagram',
  errors: 'validation state recomputed on load',

  // SUMIT accounting nodes. The judgement that puts these here rather than in
  // NODE_DEPLOYMENT_BINDINGS: none of them names anything in THIS installation.
  // A customer's name, phone or address describes a person in the outside world
  // and means the same at any installation that imports the diagram; the
  // document type is a value from SUMIT's own enum; the rest are booleans,
  // quantities and prices. Note what is NOT here: SUMIT's own credentials never
  // appear on a node at all — the port reads them from app_settings, so there is
  // nothing on the diagram for an export to scrub.
  customerName: 'a customer the author typed or referenced; a person, not an installation id',
  customerEmail: 'a customer address; not an installation identifier',
  customerPhone: 'a customer phone; not an installation identifier',
  customerNoVat: 'a VAT-exemption flag about the CUSTOMER, true anywhere',
  documentType: 'a value from SUMIT’s own document-type enum',
  documentDescription: 'the author’s text, printed on the document',
  itemName: 'the author’s text — a line on the document',
  itemQuantity: 'a quantity',
  itemUnitPrice: 'a price',
  isDraft: 'draft/final — SUMIT document behaviour',
  sendByEmail: 'whether SUMIT emails the document',
  city: 'a customer’s city',
  address: 'a customer’s address',
  companyNumber: 'a customer’s registered company number; theirs, not ours',
  noVat: 'a VAT-exemption flag about the CUSTOMER',

  // Closed vocabularies compiled into the app.
  level: 'alert severity, a fixed enum',
  method: 'HTTP verb',
  operator: 'comparison operator, a fixed enum',
  rsvpStatus: 'an RSVP status from @/lib/constants',
  statuses: 'RSVP statuses, same closed set',
  messageKinds: 'message kinds, a fixed enum',
  unit: 'minutes / hours / days',
  contentType: 'Text / HTML — Graph’s own body content type',
  importance: 'low / normal / high — Graph’s own message importance',

  // Values and references that describe intent, not infrastructure.
  amount: 'a number the author chose',
  days: 'weekday selection',
  time: 'a time of day',
  value: 'a literal the author typed',
  left: 'the left-hand side of a comparison — a template reference',
  field: 'a guest field name from our own schema',
  keyword: 'matching text the author typed',
  maxGuests: 'a numeric cap',
  requirePhone: 'a boolean',
  captureResponse: 'a boolean',
  saveToSentItems: 'a boolean',
  waitForOutcome: 'a boolean',
};

type SchemaLike = { properties?: Record<string, unknown> };

describe('every node property is classified for export', () => {
  for (const item of PALETTE_ITEMS) {
    const properties = Object.keys((item.schema as SchemaLike).properties ?? {});
    const bound = NODE_DEPLOYMENT_BINDINGS[item.type as KalfaNodeType] ?? {};

    for (const property of properties) {
      it(`${item.type}.${property}`, () => {
        const isBound = property in bound;
        const isReviewed = property in REVIEWED_PORTABLE;

        expect(
          isBound || isReviewed,
          `${item.type}.${property} is neither bound in NODE_DEPLOYMENT_BINDINGS nor ` +
            `listed in REVIEWED_PORTABLE. Decide whether its value points into this ` +
            `installation ('identifier'), may hold operator-typed credential material ` +
            `('secret'), names a catalogue entry ('catalogue'), or genuinely travels — ` +
            `and record which, with the reason.`,
        ).toBe(true);

        expect(
          isBound && isReviewed,
          `${item.type}.${property} is in BOTH maps — pick one`,
        ).toBe(false);
      });
    }
  }

  it('no binding names a property the node does not have', () => {
    for (const [nodeType, bindings] of Object.entries(NODE_DEPLOYMENT_BINDINGS)) {
      const item = PALETTE_ITEMS.find((p) => p.type === nodeType);
      expect(item, `${nodeType} is bound but not in the palette`).toBeDefined();

      const properties = Object.keys((item!.schema as SchemaLike).properties ?? {});
      for (const property of Object.keys(bindings ?? {})) {
        expect(
          properties,
          `${nodeType}.${property} is bound but the node has no such property`,
        ).toContain(property);
      }
    }
  });

  it('⚠️ the webhook trigger stores a HASH, and the hash is still installation-bound', () => {
    // The token itself no longer lives in the diagram (webhook-token.ts), so this
    // is no longer a secret that must not travel — but it authenticates to THIS
    // installation and resolves to nothing anywhere else.
    expect(NODE_DEPLOYMENT_BINDINGS['trigger.webhook']).toEqual({
      // BOTH halves are installation-bound. The endpoint id is public — it is
      // shown in the panel and copied into other systems — but it names an
      // address on THIS host, so importing a diagram elsewhere must not carry it
      // over any more than the hash.
      endpointId: 'identifier',
      tokenHash: 'identifier',
    });
  });
});
