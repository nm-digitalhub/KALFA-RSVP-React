import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import type { RsvpApplyOutcome } from '@/lib/data/call-result-processing';

// RSVPAgent.voxengine.js is a single self-contained file that only runs inside
// Voximplant, so it cannot be imported. Its pure pieces are cut out of the source
// by brace matching and evaluated in isolation: parseToolArgs and TOOL_ROUTES,
// which decide WHAT gets saved from a guest's call, and the three decisions of
// openspec/changes/voice-test-environment — testBranchFrom (D2), ctxDecision (D3)
// and saveRsvpResult (D4). If any is renamed or restructured this test fails
// loudly instead of silently testing nothing.
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

type CtxDecision = { ctx: Record<string, unknown> | null; refusal: string | null };
const guards = new Function(
  `${extractBlock(source, 'function testBranchFrom(customData)')}
   ${extractBlock(source, 'function ctxDecision(code, text)')}
   ${extractBlock(source, 'function saveRsvpResult(status)')}
   return { testBranchFrom: testBranchFrom, ctxDecision: ctxDecision, saveRsvpResult: saveRsvpResult };`,
)() as {
  testBranchFrom: (customData: unknown) => string | null;
  ctxDecision: (code: number, text: string | undefined) => CtxDecision;
  saveRsvpResult: (status: string | null) => string;
};

describe('testBranchFrom — only a branch id routes the conversation off the deployment (D2)', () => {
  const id = 'agtbrch_4101kxj3n5tqf2kae5recbbn2rtj';

  it('passes a branch id through', () => {
    expect(guards.testBranchFrom({ to: '+972', br: id })).toBe(id);
  });

  it('no br — every worker call — is the deployment', () => {
    expect(guards.testBranchFrom({ to: '+972', from: '972', tok: 'x', u: 'https://kalfa.me' })).toBeNull();
    expect(guards.testBranchFrom(null)).toBeNull();
  });

  it.each([['an agent id', 'agent_9701kxj3n54ye518a3s518cexd48'], ['an empty id', 'agtbrch_'], ['a number', 7], ['upper case', 'agtbrch_ABC']])(
    'ignores %s',
    (_label, br) => {
      expect(guards.testBranchFrom({ br })).toBeNull();
    },
  );
});

describe('ctxDecision — no dial without the call context (D3)', () => {
  it('a 200 with the context dials', () => {
    const d = guards.ctxDecision(200, '{"guest_name":"דנה","event_name":"חתונה"}');
    expect(d.refusal).toBeNull();
    expect(d.ctx).toMatchObject({ guest_name: 'דנה' });
  });

  it.each([
    [404, 'ctx_404'],
    [500, 'ctx_500'],
    [429, 'ctx_429'],
  ])('a %s is refused as %s', (code, refusal) => {
    expect(guards.ctxDecision(code, '{"guest_name":"דנה"}')).toEqual({ ctx: null, refusal });
  });

  it.each([
    ['an unparseable body', 'not json'],
    ['an empty body', ''],
    ['no body', undefined],
    ['a JSON array', '[1,2]'],
    ['a JSON string', '"x"'],
  ])('a 200 with %s is refused', (_label, text) => {
    expect(guards.ctxDecision(200, text)).toEqual({ ctx: null, refusal: 'ctx_unparseable' });
  });
});

describe('the ctx step wiring (source guard)', () => {
  const ctxStep = source.slice(source.indexOf('// --- fetch ctx (guest/event) BEFORE dialing'));

  it('refuses a call that has no context URL (no tok/u) instead of dialling', () => {
    const noUrl = ctxStep.indexOf('if (!state.contextUrl)');
    expect(noUrl).toBeGreaterThan(-1);
    expect(ctxStep.indexOf("refuseWithoutContext('ctx_unavailable')", noUrl)).toBeLessThan(ctxStep.indexOf('Net.httpRequestAsync'));
  });

  it('dials in exactly one place, after a usable context', () => {
    expect(ctxStep.split('proceedToDial()').length - 1).toBe(1);
    expect(ctxStep.indexOf('proceedToDial()')).toBeGreaterThan(ctxStep.indexOf('var ctx = decision.ctx'));
  });

  it('closes the attempt as failed with the refusal before terminating', () => {
    const refuse = extractBlock(source, 'function refuseWithoutContext(refusal)');
    expect(refuse).toContain("call_status: 'failed'");
    expect(refuse).toContain('error_reason: refusal');
    expect(refuse).not.toContain('callPSTN');
  });
});

describe('saveRsvpResult — an unknown save answer is a failure (D4)', () => {
  it.each(['saved', 'rejected', 'queued'])('%s passes through', (status) => {
    expect(guards.saveRsvpResult(status)).toBe(status);
  });

  it.each([['an unknown status', 'pending'], ['no status', null], ['a failed status', 'failed']])('%s is error', (_label, status) => {
    expect(guards.saveRsvpResult(status)).toBe('error');
  });

  it('passes every status the save route can answer 200 with', () => {
    // The route (src/app/api/voximplant/agent-tool/rsvp/[token]/route.ts) answers processCallRsvp's status, or
    // 'queued' when the apply threw. A Record over that union fails typecheck if the server gains a status, so the
    // scenario's list cannot silently turn a new success into 'error'.
    const routeStatuses: Record<RsvpApplyOutcome['status'] | 'queued', true> = { saved: true, rejected: true, queued: true };
    for (const status of Object.keys(routeStatuses)) expect(guards.saveRsvpResult(status)).toBe(status);
  });

  it('is what save_rsvp replies with', () => {
    expect(source).toContain('reply(saveRsvpResult(status), false)');
  });
});

describe('createAgentsClient names the branch only when one was chosen (D2)', () => {
  it('sets branchId conditionally on the params it passes', () => {
    expect(source).toContain('if (state.branchId)\n                agentParams.branchId = state.branchId;');
    expect(source).toContain('ElevenLabs.createAgentsClient(agentParams)');
  });
});
