// The `keyword` filter's REACH: which message kinds can ever satisfy it.
//
// ⚠️ THE ANSWER IS ONE KIND, AND IT IS NOT A POLICY WE CHOSE — it falls out of
// `readTextBody` in `inbound.ts`, which reads `payload.text?.body` and nothing
// else. Every other kind therefore reaches `planRuns` with `messageText: ''`,
// and `matchesKeyword` compares a non-empty keyword against it and fails.
//
// The two filters are ANDed against the SAME message, so a trigger that accepts
// only kinds with no text body and still carries a keyword has asked for a
// message that cannot exist. It armed cleanly and never fired — no error, no run
// row, nothing in a log to read. `findArmBlockers` now refuses it, and
// `TEXT_BEARING_WHATSAPP_MESSAGE_KINDS` is the list that refusal is derived from.
//
// This file pins that list against the ENGINE rather than against itself: one
// test reads `inbound.ts` and one drives `planRuns`. A kind that gains a text
// body, or a keyword filter that learns to read one, fails here rather than
// quietly making the arm gate wrong.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  DEFAULT_WHATSAPP_MESSAGE_KINDS,
  TEXT_BEARING_WHATSAPP_MESSAGE_KINDS,
  WHATSAPP_MESSAGE_KINDS,
} from './catalogue/types';
import { matchesKeyword, planRuns, type ArmedWorkflow } from './trigger';

describe('TEXT_BEARING_WHATSAPP_MESSAGE_KINDS is what inbound.ts actually reads', () => {
  it('⚠️ `readTextBody` touches exactly one payload key, and it is `text`', () => {
    const source = readFileSync(join(process.cwd(), 'src/lib/workflow/inbound.ts'), 'utf8');

    // The whole function, from its signature to the closing brace of its body.
    const fn = /function readTextBody\([^)]*\)[^{]*\{([\s\S]*?)\n\}/.exec(source);
    expect(fn, 'readTextBody not found in inbound.ts').not.toBeNull();

    const keys = [...fn![1]!.matchAll(/payload\??\.(\w+)/g)].map((m) => m[1]!);
    expect([...new Set(keys)]).toEqual(['text']);
    expect(TEXT_BEARING_WHATSAPP_MESSAGE_KINDS).toEqual(['text']);
  });

  it('every text-bearing kind is a kind the editor actually offers', () => {
    const offered = WHATSAPP_MESSAGE_KINDS.map((k) => k.value as string);
    for (const kind of TEXT_BEARING_WHATSAPP_MESSAGE_KINDS) {
      expect(offered, `${kind} is not in the palette's menu`).toContain(kind);
    }
  });

  it('the default kinds include a text-bearing one — so an unset list is never dead', () => {
    expect(
      DEFAULT_WHATSAPP_MESSAGE_KINDS.some((k) => TEXT_BEARING_WHATSAPP_MESSAGE_KINDS.includes(k)),
    ).toBe(true);
  });
});

describe('matchesKeyword against the body every kind actually arrives with', () => {
  it('a non-empty keyword cannot match an empty body', () => {
    expect(matchesKeyword('שיחה', '')).toBe(false);
  });

  it('…and an empty keyword matches anything, which is why an unset one is safe', () => {
    expect(matchesKeyword('', '')).toBe(true);
    expect(matchesKeyword(undefined, '')).toBe(true);
  });
});

describe('planRuns — the two filters are ANDed, so the pair can be unsatisfiable', () => {
  const armed = (properties: Record<string, unknown>): ArmedWorkflow => ({
    id: 'wf-1',
    eventId: null,
    definition: {
      nodes: [
        {
          id: 'n1',
          data: {
            type: 'trigger.whatsapp_inbound',
            properties: { label: 't', description: 'd', ...properties },
          },
        },
      ],
      edges: [],
    },
  });

  /** What `inbound.ts` hands `planRuns`: a body only for `text`. */
  const message = (kind: string) => ({
    eventId: 'event-1',
    contactId: 'contact-1',
    inboxRowId: 'inbox-9',
    kind,
    phoneNumberId: null,
    messageText: TEXT_BEARING_WHATSAPP_MESSAGE_KINDS.includes(kind) ? 'רוצה שיחה בבקשה' : '',
    buttonPayload: '',
  });

  const dead = armed({ keyword: 'שיחה', messageKinds: [{ value: 'image' }, { value: 'document' }] });

  it('⚠️ NO kind at all produces a run for a keyword with no text kind selected', () => {
    for (const { value } of WHATSAPP_MESSAGE_KINDS) {
      expect(planRuns(message(value), [dead]), `kind ${value} started a run`).toEqual([]);
    }
  });

  it('the same trigger fires the moment `text` is added to its kinds', () => {
    const alive = armed({
      keyword: 'שיחה',
      messageKinds: [{ value: 'image' }, { value: 'document' }, { value: 'text' }],
    });
    expect(planRuns(message('text'), [alive])).toHaveLength(1);
    // And still not for the kinds that carry no body — correctly, not deadly:
    // this trigger has a reachable case.
    expect(planRuns(message('image'), [alive])).toEqual([]);
  });

  it('and fires for a narrowed trigger with no keyword — the normal filtering case', () => {
    const filtered = armed({ messageKinds: [{ value: 'document' }] });
    expect(planRuns(message('document'), [filtered])).toHaveLength(1);
  });
});
