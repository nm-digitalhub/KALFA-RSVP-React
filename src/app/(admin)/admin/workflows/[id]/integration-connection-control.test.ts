import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import { INTEGRATION_CONNECTION_FORMAT } from '@/lib/workflow/catalogue/ui-formats';

import {
  delegatedSelectUiSchema,
  integrationConnectionRenderer,
  microsoftOAuthStartHref,
  saveWorkflowBeforeOAuth,
} from './integration-connection-control';

const connectionControl = {
  type: 'Select',
  scope: '#/properties/connectionId',
  label: 'חיבור Microsoft 365',
  options: {
    format: INTEGRATION_CONNECTION_FORMAT,
    provider: 'microsoft',
    capability: 'mail.send',
  },
} as const;
const testerContext = { rootSchema: {}, config: {} };
const controlSource = readFileSync(
  join(
    process.cwd(),
    'src/app/(admin)/admin/workflows/[id]/integration-connection-control.tsx',
  ),
  'utf8',
);
const workflowPageSource = readFileSync(
  join(process.cwd(), 'src/app/(admin)/admin/workflows/[id]/page.tsx'),
  'utf8',
);

describe('integration connection JsonForms renderer', () => {
  it('matches only the explicitly configured Microsoft mail connection field', () => {
    expect(
      integrationConnectionRenderer.tester(
        connectionControl as never,
        {},
        testerContext,
      ),
    ).toBe(5000);
    expect(
      integrationConnectionRenderer.tester(
        {
          ...connectionControl,
          options: { ...connectionControl.options, capability: 'calendar.read' },
        } as never,
        {},
        testerContext,
      ),
    ).toBe(-1);
  });

  it('removes its marker before dispatching to the SDK Select, preventing recursion', () => {
    const delegated = delegatedSelectUiSchema(connectionControl as never);

    expect(delegated).toMatchObject({
      type: 'Select',
      scope: '#/properties/connectionId',
      label: 'חיבור Microsoft 365',
    });
    expect(delegated.options).toBeUndefined();
    expect(
      integrationConnectionRenderer.tester(delegated, {}, testerContext),
    ).toBe(-1);
  });

  it('targets the existing OAuth start route and returns to the same workflow', () => {
    const href = microsoftOAuthStartHref('workflow id/with slash');
    const url = new URL(href, 'https://example.test');

    expect(url.pathname).toBe('/api/integrations/oauth/start');
    expect(url.searchParams.get('provider')).toBe('microsoft');
    expect(url.searchParams.get('capability')).toBe('mail.send');
    expect(url.searchParams.get('redirectTo')).toBe(
      '/admin/workflows/workflow%20id%2Fwith%20slash',
    );
  });

  it('navigates only after the SDK confirms a successful save', async () => {
    const navigate = vi.fn();

    await expect(
      saveWorkflowBeforeOAuth(
        vi.fn().mockResolvedValue('success'),
        navigate,
        '/oauth-start',
      ),
    ).resolves.toBe(true);
    expect(navigate).toHaveBeenCalledWith('/oauth-start');

    navigate.mockClear();
    await expect(
      saveWorkflowBeforeOAuth(
        vi.fn().mockResolvedValue('alreadyStarted'),
        navigate,
        '/oauth-start',
      ),
    ).resolves.toBe(false);
    expect(navigate).not.toHaveBeenCalled();
  });

  it('does not navigate when saving throws', async () => {
    const navigate = vi.fn();

    await expect(
      saveWorkflowBeforeOAuth(
        vi.fn().mockRejectedValue(new Error('save failed')),
        navigate,
        '/oauth-start',
      ),
    ).rejects.toThrow('save failed');
    expect(navigate).not.toHaveBeenCalled();
  });

  it('keeps credentials and OAuth protocol code out of the client renderer', () => {
    expect(controlSource).not.toMatch(
      /server-only|supabase|openid-client|code_verifier|code_challenge|vault_secret|refresh_token|access_token/i,
    );
    expect(controlSource).not.toContain('handleChange(');
    expect(controlSource).toContain('/api/integrations/oauth/start');
  });

  it('reloads safe connection options on the returned workflow page', () => {
    expect(workflowPageSource).toContain(
      'listActiveMicrosoftWorkflowConnections()',
    );
    expect(workflowPageSource).toContain(
      'microsoftConnections={microsoftConnections}',
    );
    expect(workflowPageSource).toContain(
      '<OAuthOutcome value={firstParam(query.oauth)} />',
    );
    expect(workflowPageSource).not.toMatch(
      /vault_secret|refresh_token|access_token/i,
    );
  });

  it('accepts deployment-level Microsoft OAuth configuration without routing the user through setup UI', () => {
    expect(workflowPageSource).toContain(
      'readSystemOAuthClient("microsoft") !== null',
    );
    expect(workflowPageSource).toContain(
      'canManageIntegrations && microsoftProviderAvailable',
    );
    expect(workflowPageSource).not.toContain(
      'יש להגדיר תחילה את ספק Microsoft בעמוד האינטגרציות.',
    );
  });
});
