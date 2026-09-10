// The regression this file exists for is a SILENT DELETION, not a broken render.
//
// This branch has already lost a component in a move once — b09240b, "restore the
// auto-save that replacing the TopBar silently removed" — and the consolidation plan's
// own readiness review found that the WhatsApp consent toggle (added 2026-09-08, after
// the plan was written) fell outside every copy range in this task and would have
// vanished with it. That toggle is a §30א legal exposure surface. A test is the
// difference between a move and a deletion.
import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('@/lib/auth/dal', () => ({ requirePlatformPermission: vi.fn() }));
vi.mock('@/lib/data/admin/channels', () => ({ getWhatsAppChannelConfig: vi.fn() }));
vi.mock('@/lib/data/admin/outreach-master', () => ({ getOutreachMasterState: vi.fn() }));
vi.mock('@/lib/url', () => ({ getAppUrl: vi.fn() }));

import { requirePlatformPermission } from '@/lib/auth/dal';
import { getWhatsAppChannelConfig } from '@/lib/data/admin/channels';
import { getOutreachMasterState } from '@/lib/data/admin/outreach-master';
import { getAppUrl } from '@/lib/url';

import MetaWhatsAppPage from './page';

/** Flattens the element tree into its props, so text/href assertions need no DOM. */
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

const textOf = (tree: unknown) =>
  collect(tree)
    .map((p) => (typeof p.children === 'string' ? p.children : ''))
    .join(' ');

const componentNames = (tree: unknown) =>
  collect(tree)
    .map((p) => {
      const t = p.__type as { name?: string } | undefined;
      return typeof t === 'function' ? (t.name ?? '') : '';
    })
    .filter(Boolean);

async function render() {
  vi.mocked(requirePlatformPermission).mockResolvedValue({ id: 'u1' } as never);
  vi.mocked(getWhatsAppChannelConfig).mockResolvedValue({
    outreach_enabled: true,
    whatsapp_phone_number_id: '1018741517998430',
    whatsapp_waba_id: '990921550130385',
    whatsapp_access_token: 'SECRET',
    whatsapp_app_secret: 'SECRET2',
    whatsapp_verify_token: 'verify-me',
    configured: true,
    consentRequired: true,
  } as never);
  vi.mocked(getOutreachMasterState).mockResolvedValue({ enabled: true, anyChannelReady: true } as never);
  vi.mocked(getAppUrl).mockResolvedValue('https://beta.kalfa.me/api/webhooks/whatsapp' as never);
  return MetaWhatsAppPage();
}

describe('/admin/integrations/meta-whatsapp', () => {
  it('gates on manage_settings', async () => {
    await render();
    expect(requirePlatformPermission).toHaveBeenCalledWith('manage_settings');
  });

  it('renders all THREE moved components — none silently dropped', async () => {
    const names = componentNames(await render());
    expect(names).toContain('WhatsAppCredentialsForm');
    // The one the plan's copy ranges missed. A §30א gate.
    expect(names).toContain('WhatsAppConsentToggle');
    expect(names).toContain('WhatsAppConnectionTest');
  });

  it('keeps the sentence that stops "configured" reading as "ready to send"', async () => {
    expect(textOf(await render())).toContain('שליחות חיות בתשלום');
  });

  it('names the consent section, so it is findable without opening a form', async () => {
    expect(textOf(await render())).toContain('דרישת הסכמה');
  });

  it('distinguishes the on-demand test from the scheduled health check', async () => {
    // Two different questions — "did what I just typed work" vs "is the channel
    // healthy". Conflating them is how someone reads a green tick as proof of a
    // successful send.
    const text = textOf(await render());
    expect(text).toContain('בדיקת חיבור');
    expect(text).toContain('כל שעה');
  });

  it('links back to the index and out to the templates page', async () => {
    const hrefs = collect(await render())
      .map((p) => p.href)
      .filter((h): h is string => typeof h === 'string');
    expect(hrefs).toContain('/admin/integrations');
    expect(hrefs).toContain('/admin/templates');
  });

  it('never puts a credential in the page tree as plain text', async () => {
    // The values reach SecretField as defaultValue, which renders them masked with a
    // reveal toggle (owner ruling 2026-08-24). What must never happen is a token
    // landing in a text node.
    const strings = collect(await render())
      .map((p) => (typeof p.children === 'string' ? p.children : ''))
      .join(' ');
    expect(strings).not.toContain('SECRET');
  });
});
