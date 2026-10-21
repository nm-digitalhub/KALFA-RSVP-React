import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

// A stand-in for pg-boss that records how many senders were built and lets a test
// decide how long start() takes and whether it fails.
type FakeBoss = { options: unknown; stopped: boolean; listeners: Record<string, Array<(e: Error) => void>> };
const h = vi.hoisted(() => ({
  created: [] as Array<{ options: unknown; stopped: boolean; listeners: Record<string, Array<(e: Error) => void>> }>,
  start: async (): Promise<void> => undefined,
  report: vi.fn(),
}));

vi.mock('@/lib/alerts/pg-boss-alert', () => ({ reportPgBossError: h.report }));

vi.mock('pg-boss', () => ({
  PgBoss: class {
    options: unknown;
    stopped = false;
    listeners: Record<string, Array<(e: Error) => void>> = {};
    constructor(options: unknown) {
      this.options = options;
      h.created.push(this);
    }
    on(event: string, listener: (e: Error) => void) {
      (this.listeners[event] ??= []).push(listener);
      return this;
    }
    start() {
      return h.start();
    }
    async stop() {
      this.stopped = true;
    }
  },
}));

const load = async () => {
  vi.resetModules();
  return import('./web-sender');
};

const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 5));

beforeEach(() => {
  h.created.length = 0;
  h.start = async () => undefined;
  h.report.mockReset();
});

describe('webSenderOptions', () => {
  it('is one send-only connection with a bounded connect and no migration', async () => {
    const { webSenderOptions } = await load();
    expect(
      webSenderOptions({
        SUPABASE_DB_HOST: 'pooler.example',
        SUPABASE_DB_PORT: '5432',
        SUPABASE_DB_USER: 'u',
        SUPABASE_DB_PASSWORD: 'p',
        SUPABASE_DB_NAME: 'postgres',
      }),
    ).toMatchObject({
      host: 'pooler.example',
      port: 5432,
      database: 'postgres',
      schema: 'pgboss',
      application_name: 'kalfa-web-sender',
      max: 1,
      connectionTimeoutMillis: 20_000,
      supervise: false,
      schedule: false,
      migrate: false,
    });
  });

  it('defaults the port and the database when the environment names none', async () => {
    const { webSenderOptions } = await load();
    expect(webSenderOptions({})).toMatchObject({ port: 5432, database: 'postgres' });
  });
});

describe('getWebJobSender', () => {
  it('builds ONE sender however many requests arrive while it is still starting', async () => {
    let finishStart!: () => void;
    h.start = () => new Promise<void>((resolve) => (finishStart = resolve));
    const { getWebJobSender } = await load();

    const calls = Array.from({ length: 25 }, () => getWebJobSender());
    await tick();
    expect(h.created).toHaveLength(1); // the caching-the-result version built 25
    finishStart();
    const senders = await Promise.all(calls);
    expect(new Set(senders).size).toBe(1);
    expect(await getWebJobSender()).toBe(senders[0]); // and the next request reuses it
    expect(h.created).toHaveLength(1);
  });

  it('a start that fails stops its half-open sender and the next call tries again', async () => {
    h.start = async () => {
      throw new Error('schema mismatch');
    };
    const { getWebJobSender } = await load();

    await expect(getWebJobSender()).rejects.toThrow('schema mismatch');
    expect(h.created).toHaveLength(1);
    expect((h.created[0] as FakeBoss).stopped).toBe(true);

    h.start = async () => undefined;
    await expect(getWebJobSender()).resolves.toBeDefined();
    expect(h.created).toHaveLength(2);
  });

  it('listens for pg-boss errors and reports them as the web sender, instead of letting them go unhandled', async () => {
    const { getWebJobSender } = await load();
    await getWebJobSender();

    const listeners = (h.created[0] as FakeBoss).listeners.error ?? [];
    expect(listeners).toHaveLength(1);

    const err = new Error('Connection terminated due to connection timeout');
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    listeners[0](err);
    expect(h.report).toHaveBeenCalledWith(err, 'kalfa-web-sender');
  });

  it('a production pooler host on port 54322 is a rejection before any PgBoss exists; once fixed, the next call builds the sender', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('SUPABASE_DB_HOST', 'aws-1-ap-south-1.pooler.supabase.com');
    vi.stubEnv('SUPABASE_DB_PORT', '54322');
    try {
      const { getWebJobSender } = await load();
      const { DbConfigError } = await import('@/lib/relocation/env-validation');
      const first = getWebJobSender(); // a promise, not a synchronous throw
      expect(first).toBeInstanceOf(Promise);
      await expect(first).rejects.toBeInstanceOf(DbConfigError);
      await expect(getWebJobSender()).rejects.toThrow(/SUPABASE_DB_PORT=54322/);
      expect(h.created).toHaveLength(0); // nothing was built, so nothing connected

      vi.stubEnv('SUPABASE_DB_PORT', '5432');
      await expect(getWebJobSender()).resolves.toBeDefined();
      expect(h.created).toHaveLength(1);
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it('importing the module validates nothing — the check runs on the first send only', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('SUPABASE_DB_HOST', 'aws-1-ap-south-1.pooler.supabase.com');
    vi.stubEnv('SUPABASE_DB_PORT', '54322');
    try {
      await expect(load()).resolves.toBeDefined();
      expect(h.created).toHaveLength(0);
    } finally {
      vi.unstubAllEnvs();
    }
  });
});
