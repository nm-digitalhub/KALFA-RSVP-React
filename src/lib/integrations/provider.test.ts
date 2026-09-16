// The provider registry, and the two properties that make it generic.
//
// ⚠️ THIS FILE DEFINES NO REAL PROVIDER. Its fixtures are deliberately
// nonsense ids — naming a real one here would start the drift this layer exists
// to prevent, where "just this once" fixtures become the shape everything else
// is written against.
import { beforeEach, describe, expect, it, vi } from 'vitest';

// `provider.ts` is `import 'server-only'`, which throws outside a Server
// Component. Stubbed the way every other server-only module is tested here.
vi.mock('server-only', () => ({}));

import {
  __resetProviderRegistryForTests,
  getProvider,
  listProviders,
  registerProvider,
  type ProviderDefinition,
} from './provider';

const fixture = (id: string): ProviderDefinition => ({
  id,
  displayName: `Fixture ${id}`,
  credentialKind: 'oauth2',
  oauth: {
    server: new URL('https://example.invalid/.well-known/openid-configuration'),
    capabilities: { 'thing.write': ['scope.a'] },
  },
  endpoint: (capability, input) => ({
    url: `https://example.invalid/${capability}`,
    init: { method: 'POST', body: JSON.stringify(input) },
  }),
});

beforeEach(() => {
  __resetProviderRegistryForTests();
});

describe('the provider registry', () => {
  it('resolves a registered provider', () => {
    registerProvider(fixture('alpha'));

    expect(getProvider('alpha')?.displayName).toBe('Fixture alpha');
  });

  it('⚠️ does not resolve a provider id off Object.prototype', () => {
    // A provider id arrives from the database as arbitrary text. Object
    // indexing would hand back the Object constructor for 'constructor' —
    // truthy, and callable, so the caller would treat it as a definition. The
    // same hazard `isKnownNodeType` closes for node types in activity-runner.
    registerProvider(fixture('alpha'));

    for (const id of ['constructor', 'toString', 'valueOf', '__proto__', 'hasOwnProperty']) {
      expect(getProvider(id)).toBeUndefined();
    }
  });

  it('returns undefined for an unknown id instead of throwing', () => {
    // A stored connection may name a provider that has since left the build.
    // That is a configuration problem to report, not a crash inside a resolve.
    expect(getProvider('never-registered')).toBeUndefined();
  });

  it('⚠️ a second registration REPLACES rather than stacks', () => {
    registerProvider(fixture('alpha'));
    registerProvider({ ...fixture('alpha'), displayName: 'Replaced' });

    expect(listProviders()).toHaveLength(1);
    expect(getProvider('alpha')?.displayName).toBe('Replaced');
  });

  it('a capability maps to scopes without the registry knowing what either means', () => {
    registerProvider(fixture('alpha'));

    expect(getProvider('alpha')?.oauth?.capabilities['thing.write']).toEqual(['scope.a']);
  });

  it('the adapter owns the URL, so a caller never spells one', () => {
    registerProvider(fixture('alpha'));

    const request = getProvider('alpha')?.endpoint('thing.write', { a: 1 });

    expect(request?.url).toBe('https://example.invalid/thing.write');
    expect(request?.init?.method).toBe('POST');
  });
});

describe('the contract stays provider-agnostic', () => {
  it('⚠️ names no real provider in this directory', async () => {
    // The guard against the drift this layer exists to prevent: the moment one
    // vendor is special-cased in the infrastructure, the second provider costs
    // a migration instead of a registry entry.
    const { readFileSync } = await import('node:fs');
    const source = readFileSync(new URL('./provider.ts', import.meta.url), 'utf8');

    // Whole words, not substrings — the first draft matched `meta` inside
    // `metadata` and failed on its own file. The identifier is what matters,
    // not a letter sequence.
    for (const vendor of ['google', 'microsoft', 'slack', 'notion', 'hubspot', 'meta', 'azure']) {
      expect(source).not.toMatch(new RegExp(`\\b${vendor}\\b`, 'i'));
    }
  });
});
