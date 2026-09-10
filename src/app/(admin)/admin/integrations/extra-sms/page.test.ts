// Same regression this branch has been guarding since Task 0.3: a silent deletion, not
// a broken render. This page additionally carries the one control in the integrations
// tree that spends money, so its presence is pinned rather than assumed.
import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const { permMock, configMock, authMock } = vi.hoisted(() => ({
  permMock: vi.fn(),
  configMock: vi.fn(),
  authMock: vi.fn(),
}));

vi.mock('@/lib/auth/dal', () => ({ requirePlatformPermission: permMock }));
vi.mock('@/lib/data/admin/settings', () => ({ getExtraSmsConfig: configMock }));
vi.mock('@/lib/sms/extra-client', () => ({ getAuthKey: authMock }));

import ExtraSmsPage from './page';

function collect(node: unknown, out: Array<Record<string, unknown>> = []) {
  if (!node || typeof node !== 'object') return out;
  if (Array.isArray(node)) {
    node.forEach((n) => collect(n, out));
    return out;
  }
  const el = node as { type?: unknown; props?: Record<string, unknown> & { children?: unknown } };
  if (el.props) out.push({ ...el.props, __type: el.type });
  collect(el.props?.children, out);
  return out;
}

/**
 * Every string in the tree's text positions.
 *
 * Deliberately walks ARRAY children too. The first version read only
 * `typeof children === 'string'`, which silently missed every sentence JSX splits
 * across an expression — a <p> holding text plus {' '} plus an <a> has an array for
 * children, so four assertions passed over prose that was there and one failed over
 * prose that was also there. A text helper that cannot see half the text is worse
 * than none.
 */
const textOf = (tree: unknown) => {
  const parts: string[] = [];
  const visit = (node: unknown): void => {
    if (typeof node === 'string') {
      parts.push(node);
      return;
    }
    if (Array.isArray(node)) {
      node.forEach(visit);
      return;
    }
    if (node && typeof node === 'object') {
      visit((node as { props?: { children?: unknown } }).props?.children);
    }
  };
  visit(tree);
  return parts.join(' ');
};

const componentNames = (tree: unknown) =>
  collect(tree)
    .map((p) => {
      const t = p.__type as { name?: string } | undefined;
      return typeof t === 'function' ? (t.name ?? '') : '';
    })
    .filter(Boolean);

const TOKEN = 'EXTRA-TOKEN-SECRET';

async function render({
  token = TOKEN,
  health = {
    ok: true as const,
    scopes: null,
    createdAt: '2025-10-27',
    expireAt: '2027-10-27',
    daysToExpiry: 412,
    accountEmail: 'account@example.com',
  },
}: { token?: string; health?: unknown } = {}) {
  permMock.mockResolvedValue({ id: 'u1' });
  configMock.mockResolvedValue({
    sms_enabled: true,
    extra_sms_sender: '03-3301505',
    extra_sms_token: token,
    configured: Boolean(token),
  });
  authMock.mockResolvedValue(health);
  return ExtraSmsPage();
}

describe('/admin/integrations/extra-sms', () => {
  it('gates on manage_settings', async () => {
    await render();
    expect(permMock).toHaveBeenCalledWith('manage_settings');
  });

  it('renders both controls — neither silently dropped', async () => {
    const names = componentNames(await render());
    expect(names).toContain('ExtraSmsForm');
    // The one control here that bills and reaches a real handset.
    expect(names).toContain('ExtraTestSms');
  });

  it('does not probe ExtrA when no key is stored', async () => {
    // A fresh install would otherwise read "cannot reach ExtrA" when the truth is
    // "you have not entered a key yet" — two different problems, one of which sends
    // someone to check their network.
    authMock.mockClear();
    const tree = await render({ token: '' });
    expect(authMock).not.toHaveBeenCalled();
    expect(textOf(tree)).toContain('לא הוזן מפתח');
  });

  // These assert what the page HANDS to ExtraKeyStatus, not what that component draws.
  // The render walk does not invoke function components, so its output is invisible
  // here by construction — its own rendering, including the 60-day threshold, is
  // covered in extra-key-status.test.ts. Asserting a component's text through its
  // parent's tree is how a test quietly stops checking anything.
  const keyStatusProps = (tree: unknown) =>
    collect(tree).find(
      (p) => (p.__type as { name?: string } | undefined)?.name === 'ExtraKeyStatus',
    );

  it('hands the probe result to the status card', async () => {
    const props = keyStatusProps(await render());
    expect(props?.health).toMatchObject({ ok: true, expireAt: '2027-10-27', daysToExpiry: 412 });
  });

  it('renders the rest of the page even when the probe failed', async () => {
    // A dead provider must not take the credentials form down with it — that form is
    // how someone FIXES a dead provider.
    const tree = await render({ health: { ok: false, kind: 'unreachable', message: 'לא ניתן להגיע' } });
    expect(componentNames(tree)).toContain('ExtraSmsForm');
    expect(keyStatusProps(tree)?.health).toMatchObject({ ok: false, kind: 'unreachable' });
  });

  it('says verified IDs are portal-only and links there', async () => {
    // There is no API for them. Saying so is what stops someone hunting for a button.
    const tree = await render();
    expect(textOf(tree)).toContain('אין להם API');
    const hrefs = collect(tree).map((p) => p.href).filter((h): h is string => typeof h === 'string');
    expect(hrefs).toContain('https://www.exm.co.il/my/verified-ids/');
    expect(hrefs).toContain('/admin/integrations');
  });

  it('names all four things the SMS channel is used for', async () => {
    const text = textOf(await render());
    for (const use of ['OTP', 'ביטול אירוע', 'שיחה חוזרת', 'הרשמה']) {
      expect(text).toContain(use);
    }
  });

  it('never renders the api key as page text', async () => {
    // It reaches EditableField as a masked defaultValue (owner ruling 2026-08-24);
    // what must never happen is it landing in a text node.
    expect(textOf(await render())).not.toContain(TOKEN);
  });
});
