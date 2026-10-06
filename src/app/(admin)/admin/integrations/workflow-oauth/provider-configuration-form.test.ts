import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react')>();
  return { ...actual, useActionState: () => [null, vi.fn()] };
});

vi.mock('./actions', () => ({ saveMicrosoftWorkflowOAuthProviderAction: vi.fn() }));

import { ProviderConfigurationForm } from './provider-configuration-form';

type ElementLike = { type?: unknown; props?: Record<string, unknown> & { children?: unknown } };

function collect(node: unknown, out: ElementLike[] = []): ElementLike[] {
  if (!node || typeof node !== 'object') return out;
  if (Array.isArray(node)) {
    node.forEach((child) => collect(child, out));
    return out;
  }
  const element = node as ElementLike;
  out.push(element);
  collect(element.props?.children, out);
  return out;
}

beforeEach(() => vi.clearAllMocks());

describe('ProviderConfigurationForm', () => {
  it('never echoes a stored secret and has no browser-controlled provider field', () => {
    const tree = ProviderConfigurationForm({
      clientId: 'safe-client-id',
      enabled: true,
      hasStoredSecret: true,
    });
    const elements = collect(tree);
    const secret = elements.find((element) => element.props?.name === 'clientSecret');

    expect(secret?.props?.defaultValue).toBe('');
    expect(elements.some((element) => element.props?.name === 'provider')).toBe(false);
    expect(JSON.stringify(tree)).not.toContain('current-secret');
  });
});
