import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

// A stand-in for pg-boss that records how many senders were built and lets a test
// decide how long start() takes and whether it fails.
type FakeBoss = { options: unknown; stopped: boolean };
const h = vi.hoisted(() => ({
  created: [] as Array<{ options: unknown; stopped: boolean }>,
  start: async (): Promise<void> => undefined,
}));

vi.mock('pg-boss', () => ({
  PgBoss: class {
    options: unknown;
    stopped = false;
    constructor(options: unknown) {
      this.options = options;
      h.created.push(this);
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
});
