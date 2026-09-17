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

  // Editor and engine state that is meaningful anywhere.
  status: 'active/disabled, a node-level switch',
  errorPolicy: 'fail / continue — engine behaviour',
  decisionBranches: 'branch ids and labels internal to this diagram',
  errors: 'validation state recomputed on load',

  // Closed vocabularies compiled into the app.
  level: 'alert severity, a fixed enum',
  method: 'HTTP verb',
  operator: 'comparison operator, a fixed enum',
  rsvpStatus: 'an RSVP status from @/lib/constants',
  statuses: 'RSVP statuses, same closed set',
  messageKinds: 'message kinds, a fixed enum',
  unit: 'minutes / hours / days',

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
    expect(NODE_DEPLOYMENT_BINDINGS['trigger.webhook']).toEqual({ tokenHash: 'identifier' });
  });
});
