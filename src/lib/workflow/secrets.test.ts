import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import {
  hasUnresolvedSecretReference,
  listSecretNames,
  lookupSecret,
  substituteSecrets,
} from './secrets';

// `{{secrets.<NAME>}}` — the only way a credential reaches an outbound call.
//
// The property every test here defends is the same one: THE NAME IS PUBLIC, THE
// VALUE IS NOT. The name is in the diagram, the browser, the dry run and the run
// log; the value exists only inside the worker process.

const env = (vars: Record<string, string>) => vars as unknown as NodeJS.ProcessEnv;

describe('lookupSecret — the prefix is the whole allow-list', () => {
  it('finds a secret that was deliberately named for workflows', () => {
    vi.stubEnv('KALFA_WORKFLOW_SECRET_ACME', 'sk-live-123');
    expect(lookupSecret('ACME')).toBe('sk-live-123');
    vi.unstubAllEnvs();
  });

  it('CANNOT reach a variable that was not named for workflows', () => {
    // ⚠️ THE TEST THIS FILE EXISTS FOR.
    //
    // With a bare `process.env[name]` lookup, a header reading
    // `{{secrets.SUPABASE_SERVICE_ROLE_KEY}}` would post our own database
    // credential to whatever URL an admin typed. The prefix is what makes every
    // other secret this process holds invisible here.
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'service-role-value');
    vi.stubEnv('WHATSAPP_APP_SECRET', 'meta-value');
    expect(lookupSecret('SUPABASE_SERVICE_ROLE_KEY')).toBeUndefined();
    expect(lookupSecret('WHATSAPP_APP_SECRET')).toBeUndefined();
    vi.unstubAllEnvs();
  });

  it('an unset name is undefined, not an empty string', () => {
    // The caller must tell "not configured" from "configured as empty": the
    // first is a refusal, the second would send `Authorization: Bearer ` and
    // look like a bug at the far end.
    expect(lookupSecret('NEVER_SET_ANYWHERE')).toBeUndefined();
  });

  it('an EMPTY value is treated as unset', () => {
    vi.stubEnv('KALFA_WORKFLOW_SECRET_BLANK', '');
    expect(lookupSecret('BLANK')).toBeUndefined();
    vi.unstubAllEnvs();
  });

  it('accepts any case, digits, underscore and dash', () => {
    for (const name of ['acme', 'Acme_Key', 'ACME-2']) {
      vi.stubEnv(`KALFA_WORKFLOW_SECRET_${name}`, 'v');
      expect(lookupSecret(name)).toBe('v');
      vi.unstubAllEnvs();
    }
  });

  it('refuses a name that could break the env-key concatenation', () => {
    // `.` and `/` are the ones that matter: the name is concatenated onto the
    // prefix, so these must never be looked up.
    for (const name of ['has.dot', 'has/slash', '../ESCAPE', 'A'.repeat(65), '']) {
      expect(lookupSecret(name)).toBeUndefined();
    }
  });
});

describe('listSecretNames — names without values', () => {
  it('lists only the prefixed names, stripped and sorted', () => {
    expect(
      listSecretNames(
        env({
          KALFA_WORKFLOW_SECRET_ZEBRA: 'z',
          KALFA_WORKFLOW_SECRET_ACME: 'a',
          SUPABASE_SERVICE_ROLE_KEY: 'nope',
          OTHER: 'nope',
        }),
      ),
    ).toEqual(['ACME', 'ZEBRA']);
  });

  it('never returns a value — only the key names', () => {
    const names = listSecretNames(env({ KALFA_WORKFLOW_SECRET_ACME: 'sk-live-123' }));
    expect(names).toEqual(['ACME']);
    expect(JSON.stringify(names)).not.toContain('sk-live-123');
  });

  it('omits an empty one, so the admin list matches what actually resolves', () => {
    expect(listSecretNames(env({ KALFA_WORKFLOW_SECRET_BLANK: '' }))).toEqual([]);
  });
});

describe('substituteSecrets', () => {
  const lookup = (name: string) => (name === 'ACME' ? 'sk-live-123' : undefined);

  it('replaces a reference with the value', () => {
    expect(substituteSecrets('Bearer {{secrets.ACME}}', lookup)).toEqual({
      ok: true,
      value: 'Bearer sk-live-123',
    });
  });

  it('replaces EVERY occurrence, not just the first', () => {
    // The `g` flag on a shared regex keeps `lastIndex` between calls — the
    // classic bug where every second call silently skips a match. A fresh regex
    // per call is what prevents it; this pins that.
    expect(substituteSecrets('{{secrets.ACME}}:{{secrets.ACME}}', lookup)).toEqual({
      ok: true,
      value: 'sk-live-123:sk-live-123',
    });
  });

  it('is stable across repeated calls', () => {
    for (let i = 0; i < 3; i++) {
      expect(substituteSecrets('{{secrets.ACME}}', lookup)).toEqual({
        ok: true,
        value: 'sk-live-123',
      });
    }
  });

  it('tolerates whitespace inside the braces', () => {
    expect(substituteSecrets('{{ secrets.ACME }}', lookup)).toMatchObject({ ok: true });
  });

  it('FAILS CLOSED on a missing secret, naming it', () => {
    // Substituting '' would put `Authorization: Bearer ` on the wire: a request
    // that looks authenticated, fails at the far end, and costs an afternoon.
    const r = substituteSecrets('Bearer {{secrets.MISSING}}', lookup);
    expect(r).toEqual({ ok: false, missing: ['MISSING'] });
  });

  it('reports every missing name once', () => {
    const r = substituteSecrets('{{secrets.A}} {{secrets.B}} {{secrets.A}}', lookup);
    expect(r).toEqual({ ok: false, missing: ['A', 'B'] });
  });

  it('fails the WHOLE string when one of several is missing', () => {
    // Partial substitution would send the one secret it did resolve to an
    // endpoint the owner believes is fully configured.
    expect(substituteSecrets('{{secrets.ACME}} {{secrets.MISSING}}', lookup)).toMatchObject({
      ok: false,
    });
  });

  it('leaves a string with no reference untouched', () => {
    expect(substituteSecrets('application/json', lookup)).toEqual({
      ok: true,
      value: 'application/json',
    });
  });

  it('does not touch the OTHER template namespaces', () => {
    // They were already resolved upstream; anything still looking like one here
    // is literal text and must survive as such.
    const text = '{{trigger.guest_name}} {{nodes.x.y}}';
    expect(substituteSecrets(text, lookup)).toEqual({ ok: true, value: text });
  });

  it('a lower-case name IS a reference — the case rule was dropped', () => {
    // It was upper-snake-only until 2026-09-13, which refused
    // `{{secrets.acme_key}}` for no defensible reason: the security property is
    // the env prefix, not the shape of what follows it.
    expect(substituteSecrets('{{secrets.acme}}', (n) => (n === 'acme' ? 'v' : undefined))).toEqual({
      ok: true,
      value: 'v',
    });
  });

  it('a name with a character that cannot be in an env key is not a reference', () => {
    // `.` and `/` would break the key concatenation, so they never match the
    // pattern, nothing is looked up, and nothing is reported missing.
    // `hasUnresolvedSecretReference` is the gate that catches it — see below.
    for (const text of ['{{secrets.has.dot}}', '{{secrets.has/slash}}']) {
      expect(substituteSecrets(text, lookup)).toEqual({ ok: true, value: text });
    }
  });
});

describe('hasUnresolvedSecretReference — the last gate before the socket', () => {
  it('catches a malformed name that substitution silently passed through', () => {
    // ⚠️ Without this, `{{secrets.has.dot}}` would go out AS THE HEADER VALUE,
    // telling the receiver that we have a secret store and what someone tried to
    // name in it. This gate is a catch-all on the literal `{{secrets.` — a name
    // that DID resolve leaves nothing for it to find.
    expect(hasUnresolvedSecretReference('{{secrets.has.dot}}')).toBe(true);
    expect(hasUnresolvedSecretReference('{{ secrets.has/slash }}')).toBe(true);
    expect(hasUnresolvedSecretReference('{{SECRETS.X}}')).toBe(true);
  });

  it('passes a fully substituted value', () => {
    expect(hasUnresolvedSecretReference('Bearer sk-live-123')).toBe(false);
  });

  it('does not false-positive on the other namespaces', () => {
    expect(hasUnresolvedSecretReference('{{trigger.message_text}}')).toBe(false);
  });
});
