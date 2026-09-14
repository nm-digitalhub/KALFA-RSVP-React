import { describe, expect, it } from 'vitest';

import { buildPaletteItems } from './catalogue/schemas';
import { matchesNumber, planRuns, type ArmedWorkflow } from './trigger';

// WHICH OF OUR LINES a message arrived on, as a trigger filter.
//
// The gap this closes is live, not hypothetical: `startWorkflowRuns` is called
// beside `processWebhookEvent` in the drain loop rather than behind it, so the
// inbound router's decision — import-line traffic goes to stageWhatsAppImport
// and returns — never applied to workflows. Since the second number went live
// on 2026-09-10 every armed workflow has fired on both lines.

const RSVP_LINE = '1018741517998430';
const IMPORT_LINE = '1298694319994421';

describe('matchesNumber', () => {
  it('an unset filter matches ANY line — including an unknown one', () => {
    // The owner's ruling (2026-09-13): every diagram saved before this field
    // existed keeps its behaviour rather than silently narrowing to one line.
    for (const arrived of [RSVP_LINE, IMPORT_LINE, null]) {
      expect(matchesNumber('', arrived)).toBe(true);
      expect(matchesNumber(undefined, arrived)).toBe(true);
      expect(matchesNumber('   ', arrived)).toBe(true);
    }
  });

  it('a configured line matches only itself', () => {
    expect(matchesNumber(RSVP_LINE, RSVP_LINE)).toBe(true);
    expect(matchesNumber(RSVP_LINE, IMPORT_LINE)).toBe(false);
  });

  it('a configured line does NOT match an unknown arrival — fail closed', () => {
    // `null` is an inbox row written before the column was populated. "We do not
    // know which line this came in on" is not evidence it came in on the one the
    // owner named, and the cost of the wrong answer is a message to a guest.
    expect(matchesNumber(RSVP_LINE, null)).toBe(false);
  });

  it('tolerates a stored value with surrounding whitespace', () => {
    expect(matchesNumber(`  ${RSVP_LINE}  `, RSVP_LINE)).toBe(true);
  });

  it('a non-string stored value is treated as unset, not as a failed match', () => {
    // The config comes from a jsonb column; the schema constrains the form only.
    expect(matchesNumber(42, RSVP_LINE)).toBe(true);
    expect(matchesNumber(null, RSVP_LINE)).toBe(true);
  });
});

describe('planRuns — the filter actually gates a run', () => {
  const armed = (phoneNumberId?: string): ArmedWorkflow => ({
    id: 'wf-1',
    eventId: null,
    definition: {
      nodes: [
        {
          id: 'n1',
          data: {
            type: 'trigger.whatsapp_inbound',
            properties: { label: 't', description: 'd', ...(phoneNumberId !== undefined ? { phoneNumberId } : {}) },
          },
        },
      ],
      edges: [],
    },
  });

  const message = (phoneNumberId: string | null) => ({
    eventId: 'event-1',
    contactId: 'contact-1',
    inboxRowId: 'inbox-9',
    // A guest's text message — what every case in this file is about.
    kind: 'text',
    phoneNumberId,
    messageText: 'כן',
    buttonPayload: '',
  });

  it('a workflow armed on the RSVP line ignores an import-line message', () => {
    // The defect, stated as a test: before this field, this message produced a
    // run on an RSVP automation.
    expect(planRuns(message(IMPORT_LINE), [armed(RSVP_LINE)])).toEqual([]);
  });

  it('the same workflow runs on its own line', () => {
    expect(planRuns(message(RSVP_LINE), [armed(RSVP_LINE)])).toHaveLength(1);
  });

  it('a workflow with no number set still runs on both — unchanged behaviour', () => {
    expect(planRuns(message(RSVP_LINE), [armed()])).toHaveLength(1);
    expect(planRuns(message(IMPORT_LINE), [armed()])).toHaveLength(1);
  });

  it('no run row is created for a filtered-out message', () => {
    // Not "a run that starts and stops": a run row reads, in the admin UI and in
    // any later audit, as "the automation ran".
    expect(planRuns(message(IMPORT_LINE), [armed(RSVP_LINE)])).toHaveLength(0);
  });
});

describe('buildPaletteItems — the live dropdown', () => {
  const trigger = (items: ReturnType<typeof buildPaletteItems>) =>
    items.find((i) => i.type === 'trigger.whatsapp_inbound');

  const options = (items: ReturnType<typeof buildPaletteItems>) => {
    const schema = trigger(items)?.schema as
      | { properties?: { phoneNumberId?: { options?: Array<{ value: string; label: string }> } } }
      | undefined;
    return schema?.properties?.phoneNumberId?.options ?? [];
  };

  it('offers "any number" FIRST, so the compatible default is the obvious one', () => {
    const opts = options(buildPaletteItems([{ providerRef: RSVP_LINE, label: 'RSVP' }]));
    expect(opts[0]).toEqual({ value: '', label: 'כל המספרים' });
  });

  it('offers every number it was given, keyed by provider_ref', () => {
    // The VALUE must be Meta's phone_number_id — it is what arrives on the
    // webhook and what matchesNumber compares. An E.164 would break on a
    // re-registration; our UUID would need a lookup inside a pure module.
    const opts = options(
      buildPaletteItems([
        { providerRef: RSVP_LINE, label: '+972 3-721-9347 — RSVP' },
        { providerRef: IMPORT_LINE, label: '+972 3-330-1505 — ייבוא' },
      ]),
    );
    expect(opts.map((o) => o.value)).toEqual(['', RSVP_LINE, IMPORT_LINE]);
    expect(opts[1]?.label).toContain('3-721-9347');
  });

  it('with no numbers it still offers "any number" and nothing else', () => {
    expect(options(buildPaletteItems([]))).toEqual([{ value: '', label: 'כל המספרים' }]);
    expect(options(buildPaletteItems())).toHaveLength(1);
  });

  it('returns a NEW array each call, and leaves the module-scope palette alone', () => {
    // The editor memoises this. If it mutated the shared array instead, every
    // workflow on the site would inherit the last one's number list.
    const a = buildPaletteItems([{ providerRef: RSVP_LINE, label: 'x' }]);
    const b = buildPaletteItems([]);
    expect(a).not.toBe(b);
    expect(options(a)).toHaveLength(2);
    expect(options(b)).toHaveLength(1);
  });

  it('changes nothing about any other node type', () => {
    const withNumbers = buildPaletteItems([{ providerRef: RSVP_LINE, label: 'x' }]);
    const without = buildPaletteItems([]);
    const others = (items: ReturnType<typeof buildPaletteItems>) =>
      items.filter((i) => i.type !== 'trigger.whatsapp_inbound').map((i) => i.type);
    expect(others(withNumbers)).toEqual(others(without));
  });
});
