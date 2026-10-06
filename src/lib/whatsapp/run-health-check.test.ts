import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const { slackMock, configMock, healthMock, subsMock, subscribeMock, appUrlMock } = vi.hoisted(
  () => ({
    slackMock: vi.fn(),
    configMock: vi.fn(),
    healthMock: vi.fn(),
    subsMock: vi.fn(),
    subscribeMock: vi.fn(),
    appUrlMock: vi.fn(),
  }),
);

vi.mock('@/lib/alerts/slack', () => ({ sendSlackAlert: slackMock }));
vi.mock('@/lib/data/outreach-config', () => ({ getWhatsAppConfig: configMock }));
vi.mock('@/lib/url', () => ({ getAppUrl: appUrlMock }));
vi.mock('./health', () => ({ checkWhatsAppHealth: healthMock }));
vi.mock('./subscriptions', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./subscriptions')>();
  return { ...actual, getAppSubscriptions: subsMock, subscribeWhatsAppWebhook: subscribeMock };
});

import { runWhatsAppHealthCheck } from './run-health-check';
import { WHATSAPP_WEBHOOK_FIELDS, WHATSAPP_WEBHOOK_TOPIC } from './subscriptions';

// The subscription half of the hourly check.
//
// It exists because the send-path probe stayed GREEN through a five-day total
// inbound outage: the token and the phone-number node were healthy the whole
// time while Meta delivered nothing. Every test here is about the gap between
// "the credential works" and "a message will arrive".

const HEALTHY_SUBS = [
  { topic: 'catalog', fields: [], active: true },
  { topic: WHATSAPP_WEBHOOK_TOPIC, fields: [...WHATSAPP_WEBHOOK_FIELDS], active: true },
];

/** The listing as it actually was during the outage. */
const OUTAGE_SUBS = [{ topic: 'catalog', fields: [], active: true }];

const alertTitles = () =>
  slackMock.mock.calls.map((c) => (c[0] as { title: string }).title).join(' | ');

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv('META_APP_ID_WA', '1234567890123456');
  configMock.mockResolvedValue({
    phoneNumberId: '1018741517998430',
    wabaId: '990921550130385',
    accessToken: 'EAA-TOKEN',
    appSecret: 'APP-SECRET',
    verifyToken: 'VERIFY-TOKEN',
  });
  healthMock.mockResolvedValue({ ok: true, qualityRating: 'GREEN', displayPhoneNumber: '+972' });
  subsMock.mockResolvedValue(HEALTHY_SUBS);
  subscribeMock.mockResolvedValue(undefined);
  appUrlMock.mockResolvedValue('https://beta.kalfa.me/api/webhooks/whatsapp');
});

describe('the subscription is healthy', () => {
  it('says nothing and repairs nothing', async () => {
    await runWhatsAppHealthCheck();
    expect(subscribeMock).not.toHaveBeenCalled();
    expect(slackMock).not.toHaveBeenCalled();
  });

  it('still runs the send-path probe — the two checks are independent', async () => {
    await runWhatsAppHealthCheck();
    expect(healthMock).toHaveBeenCalled();
  });
});

describe('the subscription is gone — the live failure', () => {
  it('re-subscribes automatically', async () => {
    subsMock.mockResolvedValue(OUTAGE_SUBS);
    await runWhatsAppHealthCheck();
    expect(subscribeMock).toHaveBeenCalledWith(
      expect.objectContaining({
        callbackUrl: 'https://beta.kalfa.me/api/webhooks/whatsapp',
        verifyToken: 'VERIFY-TOKEN',
      }),
    );
  });

  it('ALERTS even though it fixed it — a silent self-heal hides what removed it', async () => {
    subsMock.mockResolvedValue(OUTAGE_SUBS);
    await runWhatsAppHealthCheck();
    expect(alertTitles()).toContain('נרשם מחדש');
  });

  it('says that messages sent meanwhile are lost', async () => {
    // The repair does not replay anything. Meta drops what it could not deliver.
    subsMock.mockResolvedValue(OUTAGE_SUBS);
    await runWhatsAppHealthCheck();
    const detail = (slackMock.mock.calls[0][0] as { detail: string }).detail;
    expect(detail).toContain('אבדו');
  });

  it('tries ONCE per run, never loops', async () => {
    subsMock.mockResolvedValue(OUTAGE_SUBS);
    await runWhatsAppHealthCheck();
    expect(subscribeMock).toHaveBeenCalledTimes(1);
  });

  it('reports a FAILED repair as an error, not as fixed', async () => {
    subsMock.mockResolvedValue(OUTAGE_SUBS);
    subscribeMock.mockRejectedValue(new Error('subscribe failed: HTTP 400 (code 100)'));
    await runWhatsAppHealthCheck();
    const call = slackMock.mock.calls[0][0] as { level: string; title: string };
    expect(call.level).toBe('error');
    expect(call.title).toContain('נכשל');
  });
});

describe('a subscription that exists but cannot deliver', () => {
  it('repairs when `messages` is missing from the field list', async () => {
    subsMock.mockResolvedValue([
      { topic: WHATSAPP_WEBHOOK_TOPIC, fields: ['message_template_status_update'], active: true },
    ]);
    await runWhatsAppHealthCheck();
    expect(subscribeMock).toHaveBeenCalled();
    expect(alertTitles()).toContain('נרשם מחדש');
  });

  it('repairs when Meta has marked it inactive', async () => {
    subsMock.mockResolvedValue([
      { topic: WHATSAPP_WEBHOOK_TOPIC, fields: [...WHATSAPP_WEBHOOK_FIELDS], active: false },
    ]);
    await runWhatsAppHealthCheck();
    expect(subscribeMock).toHaveBeenCalled();
  });
});

describe('when it must NOT act', () => {
  it('never guesses a verify token — it alerts instead', async () => {
    // Subscribing with the wrong token would break the callback verification
    // that is working today.
    subsMock.mockResolvedValue(OUTAGE_SUBS);
    configMock.mockResolvedValue({
      phoneNumberId: 'p',
      wabaId: 'w',
      accessToken: 't',
      appSecret: 'APP-SECRET',
      verifyToken: null,
    });
    await runWhatsAppHealthCheck();
    expect(subscribeMock).not.toHaveBeenCalled();
    expect(alertTitles()).toContain('אי אפשר לתקן אוטומטית');
  });

  it('stays silent with no app secret — it cannot even ask', async () => {
    configMock.mockResolvedValue({
      phoneNumberId: 'p',
      wabaId: 'w',
      accessToken: 't',
      appSecret: null,
      verifyToken: 'V',
    });
    await runWhatsAppHealthCheck();
    expect(subsMock).not.toHaveBeenCalled();
    expect(slackMock).not.toHaveBeenCalled();
  });

  it('stays silent when Meta could not be ASKED — one blip is not evidence', async () => {
    subsMock.mockRejectedValue(new Error('subscriptions fetch failed: HTTP 502'));
    await runWhatsAppHealthCheck();
    expect(subscribeMock).not.toHaveBeenCalled();
    expect(slackMock).not.toHaveBeenCalled();
  });

  it('a subscription failure never takes the health check down', async () => {
    subsMock.mockRejectedValue(new Error('boom'));
    await expect(runWhatsAppHealthCheck()).resolves.toMatchObject({ outcome: 'ok' });
  });

  it('does nothing at all when WhatsApp is not configured', async () => {
    configMock.mockResolvedValue(null);
    await runWhatsAppHealthCheck();
    expect(subsMock).not.toHaveBeenCalled();
  });
});
