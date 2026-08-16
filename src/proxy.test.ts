import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const updateSession = vi.fn(async () => new Response('session', { status: 200 }));
vi.mock('@/lib/supabase/proxy', () => ({ updateSession }));

const { proxy } = await import('@/proxy');

// A real Next 16 action id: two-hex info byte + 40-char hash = 42 characters.
const VALID_ACTION_ID = '00' + 'a'.repeat(40);

function post(actionId?: string): NextRequest {
  const headers = new Headers();
  if (actionId !== undefined) headers.set('next-action', actionId);
  return new NextRequest('https://beta.kalfa.me/app', { method: 'POST', headers });
}

describe('proxy — malformed Server Action ids', () => {
  beforeEach(() => updateSession.mockClear());

  // Every value below was observed in the live error log between 31.07 and
  // 16.08. The 40-hex one is the interesting case: it LOOKS like a real id
  // (it is the pre-Next-16 format) but cannot name an action in this build.
  it.each([
    ['the literal "x" (427 occurrences live)', 'x'],
    ['the literal "action"', 'action'],
    ['a single digit', '0'],
    ['a two-character token', 'qz'],
    ['a pre-Next-16 40-hex id', 'f'.repeat(40)],
    ['an over-long id', 'a'.repeat(64)],
    ['an empty header', ''],
  ])('answers %s without invoking the session refresh', async (_label, id) => {
    const res = await proxy(post(id));
    expect(res.status).toBe(404);
    expect(updateSession).not.toHaveBeenCalled();
  });

  // The client router keys its recovery off this exact shape — status, header
  // and content-type together. Loosening any of them turns a recoverable stale
  // tab into a dead button, so assert all three.
  it('reproduces Next\'s own unrecognized-action response exactly', async () => {
    const res = await proxy(post('x'));
    expect(res.status).toBe(404);
    expect(res.headers.get('x-nextjs-action-not-found')).toBe('1');
    expect(res.headers.get('content-type')).toBe('text/plain');
    await expect(res.text()).resolves.toBe('Server action not found.');
  });

  it('passes a well-formed 42-character id straight through', async () => {
    await proxy(post(VALID_ACTION_ID));
    expect(updateSession).toHaveBeenCalledOnce();
  });

  // The overwhelming majority of traffic carries no action header at all;
  // it must never touch this branch.
  it('passes a request with no action header straight through', async () => {
    await proxy(post());
    expect(updateSession).toHaveBeenCalledOnce();
  });
});
