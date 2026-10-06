import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  RDP_CUT_RETRY_AFTER_SECONDS,
  RDP_FILE_MIN_INTERVAL_SECONDS,
  RDP_MAX_FILES,
  RDP_MINUTES_DEFAULT,
  RDP_MINUTES_MAX,
  RDP_MINUTES_MIN,
  RDP_MINUTES_PRESETS,
  RDP_NOTE_MAX,
  RDP_PORT_MAX,
  RDP_PORT_MIN,
  RDP_REASON_MAX,
  RDP_REASON_MIN,
  RDP_REQUEST_TTL_MINUTES,
  RDP_REQUESTS_PER_HOUR,
  RDP_TARGET_PATTERN,
  isValidRdpTarget,
} from './policy';

// policy.ts mirrors numbers that also live in the migration. Each assertion reads the number OUT of the
// SQL, so changing a ceiling in only one place fails here instead of surfacing as a constraint error a
// user sees at 2am. (Textual check over the migration file, like rdp-access-migration.test.ts.)

const MIGRATIONS = join(__dirname, '..', '..', '..', 'supabase', 'migrations');
const FILE = readdirSync(MIGRATIONS).find((f) => f.endsWith('_rdp_access_approval.sql'));

function sql(): string {
  if (!FILE) throw new Error('rdp_access_approval migration not found');
  return readFileSync(join(MIGRATIONS, FILE), 'utf8');
}

// First capture group of a pattern that MUST match; a pattern that stops matching fails loudly.
function capture(re: RegExp): string[] {
  const m = sql().match(re);
  if (!m) throw new Error(`pattern not found in the migration: ${re}`);
  return m.slice(1);
}

describe('policy.ts mirrors the rdp_access_approval migration', () => {
  it('reason length', () => {
    const [min, max] = capture(/char_length\(btrim\(reason\)\) between (\d+) and (\d+)/);
    expect([Number(min), Number(max)]).toEqual([RDP_REASON_MIN, RDP_REASON_MAX]);
  });

  it('requested minutes range', () => {
    const [min, max] = capture(/requested_minutes\s+smallint not null check \(requested_minutes between (\d+) and (\d+)\)/);
    expect([Number(min), Number(max)]).toEqual([RDP_MINUTES_MIN, RDP_MINUTES_MAX]);
  });

  it('granted minutes range', () => {
    const [min, max] = capture(/granted_minutes\s+smallint check \(granted_minutes between (\d+) and (\d+)\)/);
    expect([Number(min), Number(max)]).toEqual([RDP_MINUTES_MIN, RDP_MINUTES_MAX]);
  });

  it('grant window ceiling equals the maximum minutes', () => {
    const [minutes] = capture(/expires_at <= starts_at \+ interval '(\d+) minutes'/);
    expect(Number(minutes)).toBe(RDP_MINUTES_MAX);
  });

  it('request lifetime', () => {
    const [minutes] = capture(/expires_at\s+timestamptz not null default now\(\) \+ interval '(\d+) minutes'/);
    expect(Number(minutes)).toBe(RDP_REQUEST_TTL_MINUTES);
  });

  it('answer note length', () => {
    const [max] = capture(/char_length\(answer_note\) <= (\d+)/);
    expect(Number(max)).toBe(RDP_NOTE_MAX);
  });

  it('downloads per grant', () => {
    const [max] = capture(/max_files\s+smallint not null default (\d+)/);
    expect(Number(max)).toBe(RDP_MAX_FILES);
  });

  it('minimum gap between downloads', () => {
    const [seconds] = capture(/last_file_at > now\(\) - interval '(\d+) seconds'/);
    expect(Number(seconds)).toBe(RDP_FILE_MIN_INTERVAL_SECONDS);
  });

  it('gap between the two confirming disconnects', () => {
    const [seconds] = capture(/last_cut_at <= now\(\) - interval '(\d+) seconds'/);
    expect(Number(seconds)).toBe(RDP_CUT_RETRY_AFTER_SECONDS);
  });

  it('requests per hour', () => {
    const [limit] = capture(/r\.created_at > now\(\) - interval '1 hour'\) >= (\d+)/);
    expect(Number(limit)).toBe(RDP_REQUESTS_PER_HOUR);
  });

  it('target pattern is character-for-character the same regex', () => {
    const [pattern] = capture(/target ~ '([^']+)'/);
    expect(pattern).toBe(RDP_TARGET_PATTERN.source);
  });
});

describe('policy.ts internal consistency', () => {
  it('every preset sits inside the database range', () => {
    for (const minutes of RDP_MINUTES_PRESETS) {
      expect(minutes).toBeGreaterThanOrEqual(RDP_MINUTES_MIN);
      expect(minutes).toBeLessThanOrEqual(RDP_MINUTES_MAX);
    }
  });

  it('the default is one of the presets and the largest preset is the ceiling', () => {
    expect((RDP_MINUTES_PRESETS as readonly number[]).includes(RDP_MINUTES_DEFAULT)).toBe(true);
    expect(Math.max(...RDP_MINUTES_PRESETS)).toBe(RDP_MINUTES_MAX);
  });
});

describe('policy.ts mirrors the rdp_access_approval_fixes migration', () => {
  const FIXES = readdirSync(MIGRATIONS).find((f) => f.endsWith('_rdp_access_approval_fixes.sql'));

  function fixesSql(): string {
    if (!FIXES) throw new Error('rdp_access_approval_fixes migration not found');
    return readFileSync(join(MIGRATIONS, FIXES), 'utf8');
  }

  it('TCP port range of the grant target', () => {
    const m = fixesSql().match(/::integer between (\d+) and (\d+)/);
    expect(m && [Number(m[1]), Number(m[2])]).toEqual([RDP_PORT_MIN, RDP_PORT_MAX]);
  });

  it('isValidRdpTarget enforces the pattern and the port range', () => {
    expect(isValidRdpTarget('desktop.example.test:3389')).toBe(true);
    expect(isValidRdpTarget('desktop.example.test:65535')).toBe(true);
    expect(isValidRdpTarget('desktop.example.test:1')).toBe(true);
    expect(isValidRdpTarget('desktop.example.test:65536')).toBe(false);
    expect(isValidRdpTarget('desktop.example.test:0')).toBe(false);
    expect(isValidRdpTarget('desktop.example.test:99999')).toBe(false);
    expect(isValidRdpTarget('desktop.example.test')).toBe(false);
    expect(isValidRdpTarget('bad host:3389')).toBe(false);
  });
});
