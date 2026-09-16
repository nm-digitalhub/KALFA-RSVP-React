import fs from 'node:fs';
import path from 'node:path';

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const {
  requirePermissionMock,
  hasPermissionMock,
  readConfigMock,
  listConnectionsMock,
  hasSystemOAuthClientMock,
} = vi.hoisted(() => ({
  requirePermissionMock: vi.fn(),
  hasPermissionMock: vi.fn(),
  readConfigMock: vi.fn(),
  listConnectionsMock: vi.fn(),
  hasSystemOAuthClientMock: vi.fn(),
}));

vi.mock('@/lib/auth/dal', () => ({
  requirePlatformPermission: requirePermissionMock,
  hasPlatformPermission: hasPermissionMock,
}));
vi.mock('@/lib/data/admin/integrations/oauth-provider-config', () => ({
  readOAuthProviderConfig: readConfigMock,
}));
vi.mock('@/lib/data/admin/integrations/workflow-connections', () => ({
  listMicrosoftWorkflowConnectionsForAdmin: listConnectionsMock,
}));
vi.mock('@/lib/integrations/system-oauth-client', () => ({
  hasSystemOAuthClient: hasSystemOAuthClientMock,
}));
vi.mock('./provider-configuration-form', () => ({
  ProviderConfigurationForm: function ProviderConfigurationForm() {
    return null;
  },
}));

import { OAuthOutcome } from './oauth-outcome';
import WorkflowOAuthAdminPage from './page';

const WORKFLOW_OAUTH_ADMIN_PATH = '/admin/integrations/workflow-oauth';
const MICROSOFT_OAUTH_START_HREF =
  '/api/integrations/oauth/start?provider=microsoft&capability=mail.send&redirectTo=%2Fadmin%2Fintegrations%2Fworkflow-oauth';

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

function text(node: unknown): string {
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (!node || typeof node !== 'object') return '';
  if (Array.isArray(node)) return node.map(text).join(' ');
  return text((node as ElementLike).props?.children);
}

const configured = {
  exists: true,
  configured: true,
  clientId: 'safe-client-id',
  enabled: true,
  createdBy: 'admin-1',
  updatedAt: '2026-09-16T11:00:00.000Z',
};

const absent = {
  exists: false,
  configured: false,
  clientId: null,
  enabled: false,
  createdBy: null,
  updatedAt: null,
};

async function render(oauth?: string) {
  return WorkflowOAuthAdminPage({ searchParams: Promise.resolve({ oauth }) });
}

beforeEach(() => {
  vi.clearAllMocks();
  requirePermissionMock.mockResolvedValue({ id: 'reader-1' });
  hasPermissionMock.mockResolvedValue(true);
  readConfigMock.mockResolvedValue(configured);
  listConnectionsMock.mockResolvedValue([]);
  hasSystemOAuthClientMock.mockReturnValue(false);
});

describe('Workflow OAuth admin page', () => {
  it('gates reads with integrations.read and reads Microsoft through the existing DALs', async () => {
    await render();

    expect(requirePermissionMock).toHaveBeenCalledWith('integrations.read');
    expect(readConfigMock).toHaveBeenCalledWith('microsoft');
    expect(listConnectionsMock).toHaveBeenCalledTimes(1);
    expect(hasPermissionMock).toHaveBeenCalledWith('integrations.manage');
    expect(hasSystemOAuthClientMock).toHaveBeenCalledWith('microsoft');
  });

  it('targets the existing OAuth start route with the exact provider, capability and return page', async () => {
    const tree = await render();
    const hrefs = collect(tree)
      .map((element) => element.props?.href)
      .filter((href): href is string => typeof href === 'string');
    const target = new URL(MICROSOFT_OAUTH_START_HREF, 'https://example.test');

    expect(hrefs).toContain(MICROSOFT_OAUTH_START_HREF);
    expect(target.pathname).toBe('/api/integrations/oauth/start');
    expect(target.searchParams.get('provider')).toBe('microsoft');
    expect(target.searchParams.get('capability')).toBe('mail.send');
    expect(target.searchParams.get('redirectTo')).toBe(WORKFLOW_OAUTH_ADMIN_PATH);
  });

  it('accepts system configuration when no DB row exists', async () => {
    readConfigMock.mockResolvedValueOnce(absent);
    hasSystemOAuthClientMock.mockReturnValueOnce(true);

    const tree = await render();
    const hrefs = collect(tree).map((element) => element.props?.href);

    expect(hrefs).toContain(MICROSOFT_OAUTH_START_HREF);
    expect(text(tree)).toContain('הגדרת מערכת');
  });

  it.each([
    [{ ...configured, configured: false }, 'Client Secret'],
    [{ ...configured, enabled: false }, 'כבוי'],
  ])('blocks DB-backed connection when the provider row is unavailable', async (config, reason) => {
    readConfigMock.mockResolvedValueOnce(config);
    hasSystemOAuthClientMock.mockReturnValueOnce(true);
    const tree = await render();
    const hrefs = collect(tree).map((element) => element.props?.href);

    expect(hrefs).not.toContain(MICROSOFT_OAUTH_START_HREF);
    expect(text(tree)).toContain(reason);
    expect(text(tree)).toContain('הגדרת מסד נתונים');
  });

  it('blocks connecting when neither DB nor system configuration exists', async () => {
    readConfigMock.mockResolvedValueOnce(absent);
    const tree = await render();

    expect(collect(tree).map((element) => element.props?.href)).not.toContain(
      MICROSOFT_OAUTH_START_HREF,
    );
    expect(text(tree)).toContain('אינו מוגדר ברמת המערכת');
  });

  it('also hides mutations and connection start without integrations.manage', async () => {
    hasPermissionMock.mockResolvedValueOnce(false);
    const tree = await render();
    const components = collect(tree).map((element) =>
      typeof element.type === 'function' ? (element.type as { name?: string }).name : '',
    );

    expect(components).not.toContain('ProviderConfigurationForm');
    expect(collect(tree).map((element) => element.props?.href)).not.toContain(
      MICROSOFT_OAUTH_START_HREF,
    );
    expect(text(tree)).toContain('הרשאת ניהול אינטגרציות');
  });

  it('renders generic success and failure notices without internal details', () => {
    expect(text(OAuthOutcome({ value: 'connected' }))).toContain('חובר בהצלחה');
    const failed = text(OAuthOutcome({ value: 'failed' }));
    expect(failed).toContain('החיבור ל-Microsoft 365 נכשל');
    expect(failed).not.toMatch(/state|PKCE|token|Vault|invalid_grant/i);
  });

  it('renders a clear empty state', async () => {
    expect(text(await render())).toContain('אין חיבורי Microsoft 365 פעילים לתהליכי עבודה');
  });

  it('renders only the approved safe connection metadata', async () => {
    listConnectionsMock.mockResolvedValueOnce([
      {
        label: 'תיבת מכירות',
        status: 'active',
        createdAt: '2026-09-16T10:00:00.000Z',
        updatedAt: '2026-09-16T11:00:00.000Z',
        mailSendReady: true,
        scopes: ['must-not-render'],
        vaultSecretId: 'must-not-render',
        metadata: { tenant: 'must-not-render' },
      },
    ]);

    const rendered = text(await render());
    expect(rendered).toContain('תיבת מכירות');
    expect(rendered).toContain('Mail.Send פעיל');
    expect(rendered).not.toContain('must-not-render');
  });

  it('contains no second OAuth implementation in UI code', () => {
    const source = fs.readFileSync(path.join(__dirname, 'page.tsx'), 'utf8');

    expect(source).toContain('/api/integrations/oauth/start');
    expect(source).not.toMatch(/openid-client|code_verifier|code_challenge|login\.microsoftonline\.com/);
    expect(source).not.toMatch(/MicrosoftOAuthForm|ConnectMicrosoftButton/);
  });
});
