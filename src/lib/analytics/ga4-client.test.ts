import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

import { getGa4ConfigStatus } from './ga4-client';

const ORIGINAL = {
  propertyId: process.env.GA4_PROPERTY_ID,
  credentials: process.env.GOOGLE_APPLICATION_CREDENTIALS,
};

let tempDir: string;
let readableFile: string;

beforeAll(() => {
  tempDir = mkdtempSync(join(tmpdir(), 'ga4-client-test-'));
  readableFile = join(tempDir, 'sa.json');
  writeFileSync(readableFile, '{}');
});

afterAll(() => {
  rmSync(tempDir, { recursive: true, force: true });
});

afterEach(() => {
  process.env.GA4_PROPERTY_ID = ORIGINAL.propertyId;
  process.env.GOOGLE_APPLICATION_CREDENTIALS = ORIGINAL.credentials;
});

describe('getGa4ConfigStatus', () => {
  it('missing property id', async () => {
    delete process.env.GA4_PROPERTY_ID;
    expect(await getGa4ConfigStatus()).toEqual({ ok: false, issue: 'missing_property_id' });
  });

  it('non-numeric property id is rejected', async () => {
    process.env.GA4_PROPERTY_ID = '12ab3';
    expect(await getGa4ConfigStatus()).toEqual({ ok: false, issue: 'invalid_property_id' });
  });

  it('missing credentials path', async () => {
    process.env.GA4_PROPERTY_ID = '123456789';
    delete process.env.GOOGLE_APPLICATION_CREDENTIALS;
    expect(await getGa4ConfigStatus()).toEqual({ ok: false, issue: 'missing_credentials_path' });
  });

  it('unreadable/nonexistent credentials file', async () => {
    process.env.GA4_PROPERTY_ID = '123456789';
    process.env.GOOGLE_APPLICATION_CREDENTIALS = join(tempDir, 'does-not-exist.json');
    const result = await getGa4ConfigStatus();
    expect(result).toEqual({ ok: false, issue: 'credentials_unreadable' });
    // The issue code must never leak the path.
    expect(JSON.stringify(result)).not.toContain(tempDir);
  });

  it('fully valid config → ok', async () => {
    process.env.GA4_PROPERTY_ID = '123456789';
    process.env.GOOGLE_APPLICATION_CREDENTIALS = readableFile;
    expect(await getGa4ConfigStatus()).toEqual({ ok: true });
  });
});
