// Which container each grouping uses, and the renderer fact behind the choice.
//
// ⚠️ MEASURED IN THE 2.3.0 BUNDLE, because the answer decides the whole
// classification and two comments in `schemas.ts` had it backwards:
//
//   • The JsonForms Accordion renderer passes the container `label` and
//     `children` and NOTHING else — no `defaultOpen`, no `isOpen`.
//   • The container declares `defaultOpen = true` and keeps real state
//     (`useState(defaultOpen)`), a real toggle, and `aria-expanded`.
//   • `AccordionLayoutElement` has no `defaultOpen` field at all.
//
// So an Accordion IS genuinely collapsible and merely STARTS OPEN, and the
// uischema has no way to ask for closed. That settles two things at once:
//
//   1. No sweep of Accordion → Group. A container that folds on click is still
//      an Accordion; the limitation is its initial state, not its nature.
//   2. Writing `defaultOpen` in a uischema is a SILENT NO-OP — the renderer
//      never reads it — so a contributor who adds one would believe a promise
//      the editor does not keep. This file refuses that.
//
// The classification the three buckets produce:
//
//   סוגי הודעות שמפעילים…  Accordion  advanced filter, default answers it
//   כותרות ואימות          Accordion  advanced, most calls never touch it
//   באילו ימים             Accordion  optional filter
//   אילו אורחים            Accordion  optional filter
//   פרמטרי החיוג           Accordion  advanced, and already SHOW-gated
//   מתקדם                  Accordion  one control, but "rarely changed" is
//                                     real information the label carries
//   פרטי הצעד              GROUP      the node's identity — always visible
import { describe, expect, it } from 'vitest';

import { PALETTE_ITEMS } from './schemas';

type Element = { type?: string; label?: string; elements?: Element[] } & Record<string, unknown>;

function walk(element: unknown, found: Element[] = []): Element[] {
  if (!element || typeof element !== 'object') return found;
  const node = element as Element;
  if (typeof node.type === 'string') found.push(node);
  if (Array.isArray(node.elements)) for (const child of node.elements) walk(child, found);
  return found;
}

const allElements = () => PALETTE_ITEMS.flatMap((item) => walk(item.uischema));

describe('container choice', () => {
  it('⚠️ no element sets `defaultOpen` — the renderer would ignore it', () => {
    const offenders = allElements()
      .filter((e) => 'defaultOpen' in e)
      .map((e) => `${e.type} "${e.label ?? ''}"`);

    expect(
      offenders,
      `these ask for an initial state the renderer never reads: ${offenders.join(', ')}`,
    ).toEqual([]);
  });

  it('every Accordion carries a label — it is a heading, not a bare box', () => {
    for (const e of allElements().filter((e) => e.type === 'Accordion')) {
      expect(typeof e.label === 'string' && e.label.trim() !== '').toBe(true);
    }
  });

  it('⚠️ the identity block is a Group, and it is the only container of its kind', () => {
    // An Accordion here would invite an owner to fold away `description` (required
    // on all eighteen types) and `status` (decides whether the step runs at all).
    const groups = allElements().filter((e) => e.type === 'Group');
    expect(groups.map((g) => g.label)).toEqual(['פרטי הצעד']);

    const identity = groups[0]!;
    const scopes = walk(identity)
      .map((e) => String((e as { scope?: unknown }).scope ?? ''))
      .filter(Boolean);
    for (const field of ['label', 'description', 'status']) {
      expect(scopes.some((s) => s.endsWith(`/properties/${field}`)), field).toBe(true);
    }
  });

  it('no Accordion wraps a required identity field', () => {
    // The rule the Group above exists to state, applied to every node: if a
    // future panel folds `label`/`description`/`status` into an always-open
    // Accordion, the same mistake is back under a different label.
    for (const item of PALETTE_ITEMS) {
      for (const accordion of walk(item.uischema).filter((e) => e.type === 'Accordion')) {
        const inside = walk(accordion)
          .map((e) => String((e as { scope?: unknown }).scope ?? ''))
          .filter(Boolean);
        for (const field of ['label', 'description', 'status']) {
          expect(
            inside.some((s) => s.endsWith(`/properties/${field}`)),
            `${item.type}: "${accordion.label}" folds away ${field}`,
          ).toBe(false);
        }
      }
    }
  });
});
