import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

// RSVPAgent.voxengine.js is a single self-contained file that only runs inside
// Voximplant, so it cannot be imported. The two pure pieces that decide WHAT gets
// saved from a guest's call — parseToolArgs and TOOL_ROUTES — are cut out of the
// source by brace matching and evaluated in isolation. If either is renamed or
// restructured this test fails loudly instead of silently testing nothing.
const SCENARIO = join(
  __dirname,
  '../../../voxfiles/applications/kalfa-rsvp.kalfarsvp.voximplant.com/scenarios/src/RSVPAgent.voxengine.js',
);

function extractBlock(source: string, header: string): string {
  const start = source.indexOf(header);
  if (start < 0) throw new Error(`RSVPAgent.voxengine.js no longer contains: ${header}`);
  const open = source.indexOf('{', start);
  let depth = 0;
  for (let i = open; i < source.length; i += 1) {
    if (source[i] === '{') depth += 1;
    else if (source[i] === '}') {
      depth -= 1;
      if (depth === 0) return source.slice(start, i + 1);
    }
  }
  throw new Error(`unbalanced block after: ${header}`);
}

type Args = Record<string, unknown>;
type Route = { path: string; invalidMessage?: string; okResult?: string; body: (a: Args) => Record<string, unknown> | null };
const source = readFileSync(SCENARIO, 'utf8');
const { parseToolArgs, TOOL_ROUTES } = new Function(
  `${extractBlock(source, 'function parseToolArgs(raw)')}
   ${extractBlock(source, 'var TOOL_ROUTES = {')};
   return { parseToolArgs: parseToolArgs, TOOL_ROUTES: TOOL_ROUTES };`,
)() as { parseToolArgs: (raw: unknown) => Args | null; TOOL_ROUTES: Record<string, Route> };

describe('parseToolArgs', () => {
  it('passes an object through', () => {
    expect(parseToolArgs({ status: 'attending' })).toEqual({ status: 'attending' });
  });
  it('parses a JSON string into an object', () => {
    expect(parseToolArgs('{"status":"maybe","adults":0}')).toEqual({ status: 'maybe', adults: 0 });
  });
  it('treats absent arguments as {} (mark_dnc has none)', () => {
    expect(parseToolArgs(undefined)).toEqual({});
    expect(parseToolArgs(null)).toEqual({});
    expect(parseToolArgs('')).toEqual({});
  });
  it('rejects anything that is not a JSON object — null, never a guess', () => {
    expect(parseToolArgs('not json')).toBeNull();
    expect(parseToolArgs('"just a string"')).toBeNull();
    expect(parseToolArgs('[1,2]')).toBeNull();
    expect(parseToolArgs([1, 2])).toBeNull();
    expect(parseToolArgs(7)).toBeNull();
    expect(parseToolArgs(true)).toBeNull();
  });
});

describe('save_rsvp argument mapping — a refusal is never invented', () => {
  const body = TOOL_ROUTES.save_rsvp!.body;

  it('a valid status passes through with its counts', () => {
    expect(body({ status: 'attending', adults: 2, children: 1 })).toEqual({
      status: 'attending',
      adults: 2,
      children: 1,
    });
    expect(body({ status: 'declined', adults: 0, children: 0 })).toEqual({
      status: 'declined',
      adults: 0,
      children: 0,
    });
    expect(body({ status: 'maybe' })).toEqual({ status: 'maybe', adults: 0, children: 0 });
  });

  it('numeric strings are coerced to counts', () => {
    expect(body({ status: 'attending', adults: '2', children: '0' })).toMatchObject({ adults: 2, children: 0 });
  });

  it('NO status → null (nothing is posted), NOT "declined"', () => {
    expect(body({})).toBeNull();
    expect(body({ adults: 2, children: 1 })).toBeNull();
    expect(body({ attending: undefined })).toBeNull();
  });

  it('an unknown or malformed status → null', () => {
    expect(body({ status: 'yes' })).toBeNull();
    expect(body({ status: 'Attending' })).toBeNull();
    expect(body({ status: '' })).toBeNull();
    expect(body({ status: null })).toBeNull();
  });

  it('only an EXPLICIT boolean legacy `attending` is understood', () => {
    expect(body({ attending: true, adults: 1 })).toMatchObject({ status: 'attending' });
    expect(body({ attending: false })).toMatchObject({ status: 'declined' });
    expect(body({ attending: 'true' })).toBeNull();
    expect(body({ attending: 1 })).toBeNull();
    expect(body({ attending: null })).toBeNull();
  });

  it('tells the agent what is wrong, so it can ask the guest again', () => {
    expect(TOOL_ROUTES.save_rsvp!.invalidMessage).toMatch(/status must be attending, declined or maybe/);
  });
});

describe('the other tools keep their contract', () => {
  it('mark_dnc takes no arguments', () => {
    expect(TOOL_ROUTES.mark_dnc!.body({})).toEqual({});
  });
  it('notify_owner caps the text at 500 chars and defaults an unknown kind to message', () => {
    const b = TOOL_ROUTES.notify_owner!.body({ kind: 'spam', text: 'א'.repeat(600) });
    expect(b).toMatchObject({ kind: 'message' });
    expect((b as { text: string }).text).toHaveLength(500);
    expect(TOOL_ROUTES.notify_owner!.body({ kind: 'question', text: 'x' })).toMatchObject({ kind: 'question' });
  });
});
