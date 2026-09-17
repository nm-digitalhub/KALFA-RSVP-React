import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { PALETTE_ITEMS } from '@/lib/workflow/catalogue/schemas';
import { WEBHOOK_TOKEN_FORMAT } from '@/lib/workflow/catalogue/ui-formats';
import {
  generateWebhookToken,
  hashWebhookToken,
  webhookHashesMatch,
  webhookUrlFor,
} from '@/lib/workflow/webhook-token';

import { webhookTokenRenderer } from './webhook-token-control';

// The webhook trigger's credential, tested at the seam that actually breaks.
//
// ⚠️ THE DIGEST IS A WIRE CONTRACT, NOT AN IMPLEMENTATION DETAIL. The editor
// hashes in the browser and `/api/workflows/hook/<token>` hashes in Node; if the
// two ever stop agreeing, every existing webhook silently stops answering and
// nothing says why. Pinned below against a published SHA-256 vector rather than
// against itself, because a test that hashes twice agrees with any mistake.

const testerContext = { rootSchema: {}, config: {} };

const tokenControl = {
  type: 'Text',
  scope: '#/properties/tokenHash',
  label: 'טוקן הכתובת',
  options: { format: WEBHOOK_TOKEN_FORMAT },
} as const;

describe('the stored form of a token', () => {
  it('⚠️ is sha256 hex — pinned to a published vector, not to itself', () => {
    // NIST's canonical one-block message. If this line changes, the route and
    // every saved workflow disagree.
    return expect(hashWebhookToken('abc')).resolves.toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
  });

  it('is 64 lowercase hex characters for any input', async () => {
    for (const input of ['', 'a', generateWebhookToken()]) {
      expect(await hashWebhookToken(input)).toMatch(/^[0-9a-f]{64}$/);
    }
  });
});

describe('a generated token', () => {
  it('is URL-safe, because it becomes a path segment', () => {
    // `+` and `/` would have to be escaped, and `=` padding invites a copy that
    // loses it. base64url avoids all three.
    for (let i = 0; i < 20; i += 1) expect(generateWebhookToken()).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it('carries 32 bytes of entropy, so it cannot be guessed', () => {
    // 43 base64 characters is exactly ceil(32 * 4 / 3) without padding.
    expect(generateWebhookToken()).toHaveLength(43);
  });

  it('is different every time', () => {
    const seen = new Set(Array.from({ length: 200 }, generateWebhookToken));
    expect(seen.size).toBe(200);
  });

  it('survives the round trip into an address', () => {
    const token = generateWebhookToken();
    expect(webhookUrlFor('https://kalfa.me', token)).toBe(
      `https://kalfa.me/api/workflows/hook/${token}`,
    );
  });
});

describe('comparing two stored hashes', () => {
  it('accepts identical ones and refuses everything else', () => {
    const a = 'a'.repeat(64);
    expect(webhookHashesMatch(a, a)).toBe(true);
    expect(webhookHashesMatch(a, `${'a'.repeat(63)}b`)).toBe(false);
    // A length mismatch is the one case that cannot be compared in constant
    // time; refusing early leaks only the length, which is fixed anyway.
    expect(webhookHashesMatch(a, 'a')).toBe(false);
    expect(webhookHashesMatch('', '')).toBe(true);
  });
});

describe('the renderer reaches the field', () => {
  it('matches the control the catalogue declares, and nothing else', () => {
    expect(webhookTokenRenderer.tester(tokenControl as never, {}, testerContext)).toBeGreaterThan(0);

    for (const other of [
      { ...tokenControl, options: { format: 'header-rows' } },
      { ...tokenControl, options: {} },
      { type: 'Text', scope: '#/properties/tokenHash' },
    ]) {
      expect(webhookTokenRenderer.tester(other as never, {}, testerContext)).toBe(-1);
    }
  });

  it('⚠️ the webhook trigger’s uischema actually carries that format', () => {
    // Fail-closed on the other half: without this option the field falls back to
    // a plain text box, which would show a sha256 and invite someone to type
    // over it — at which point the endpoint is unreachable and nothing says why.
    const trigger = PALETTE_ITEMS.find((item) => item.type === 'trigger.webhook');
    expect(trigger, 'trigger.webhook left the palette').toBeDefined();

    const controls = JSON.stringify(trigger!.uischema);
    expect(controls).toContain('#/properties/tokenHash');
    expect(controls).toContain(WEBHOOK_TOKEN_FORMAT);
  });

  it('⚠️ is registered in the editor — a renderer nobody lists never runs', () => {
    // This was caught by an unused-import WARNING, which is not a gate. The
    // registration lives in a module-scope array the editor passes as a prop, so
    // the cheapest honest check is that the array names it.
    const editor = readFileSync(
      join(process.cwd(), 'src/app/(admin)/admin/workflows/[id]/workflow-editor.tsx'),
      'utf8',
    );
    const renderers = editor.slice(
      editor.indexOf('const JSON_FORM = {'),
      editor.indexOf('};', editor.indexOf('const JSON_FORM = {')),
    );
    expect(renderers).toContain('webhookTokenRenderer');
  });
});
