import { describe, expect, it } from 'vitest';

import { DEFAULT_SEND_POLICY } from '@/lib/outreach/send-policy';
import { sendPolicyFromFormData } from './send-policy-form';

// The form ⇄ policy boundary. Every test here is about a value an admin could
// actually type; the ceilings themselves are proven in send-policy.test.ts.

/** The default policy rendered back as the form would post it. */
function formFor(overrides: Record<string, string> = {}): FormData {
  const f = new FormData();
  for (let d = 0; d <= 5; d++) {
    const w = DEFAULT_SEND_POLICY.weekday[d]!;
    f.set(`weekday.${d}.start`, w.start);
    f.set(`weekday.${d}.end`, w.end);
  }
  f.set('hardCap', DEFAULT_SEND_POLICY.hardCap);
  f.set('motzashPlusMin', String(DEFAULT_SEND_POLICY.motzashPlusMin));
  f.set('spreadSpanMinutes', String(DEFAULT_SEND_POLICY.spreadSpanMs / 60_000));
  f.set('defaultPreferred', DEFAULT_SEND_POLICY.defaultPreferred);
  const keys = Object.keys(DEFAULT_SEND_POLICY.preferredTimeByDaysBefore).sort(
    (a, b) => Number(b) - Number(a),
  );
  keys.forEach((k, i) => {
    f.set(`preferred.${i}.days`, k);
    f.set(`preferred.${i}.time`, DEFAULT_SEND_POLICY.preferredTimeByDaysBefore[k]);
  });
  // The blank "add another" row the form always renders last.
  f.set(`preferred.${keys.length}.days`, '');
  f.set(`preferred.${keys.length}.time`, '');
  for (const [k, v] of Object.entries(overrides)) f.set(k, v);
  return f;
}

describe('sendPolicyFromFormData — a clean round trip', () => {
  it('the default policy survives being rendered and posted back unchanged', () => {
    const r = sendPolicyFromFormData(formFor());
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.policy).toEqual(DEFAULT_SEND_POLICY);
  });

  it('spread is entered in MINUTES and stored in milliseconds', () => {
    const r = sendPolicyFromFormData(formFor({ spreadSpanMinutes: '30' }));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.policy.spreadSpanMs).toBe(30 * 60_000);
  });

  it('a narrower window is accepted', () => {
    const r = sendPolicyFromFormData(
      formFor({ 'weekday.0.start': '10:00', 'weekday.0.end': '18:00' }),
    );
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.policy.weekday[0]).toEqual({ start: '10:00', end: '18:00' });
  });
});

describe('sendPolicyFromFormData — the ceilings hold', () => {
  it('rejects a weekday end past 20:30 and names the ceiling', () => {
    const r = sendPolicyFromFormData(formFor({ 'weekday.1.end': '22:00' }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(JSON.stringify(r.fieldErrors)).toContain('20:30');
  });

  it('rejects a start before 09:00', () => {
    const r = sendPolicyFromFormData(formFor({ 'weekday.2.start': '07:00' }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(JSON.stringify(r.fieldErrors)).toContain('09:00');
  });

  it('rejects a Friday end past 12:00 even though 20:30 is fine on other days', () => {
    const r = sendPolicyFromFormData(formFor({ 'weekday.5.end': '16:00' }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(JSON.stringify(r.fieldErrors)).toContain('12:00');
  });

  it('rejects a hard cap past 21:00', () => {
    const r = sendPolicyFromFormData(formFor({ hardCap: '21:30' }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.fieldErrors._root?.join(' ')).toContain('21:00');
  });

  it('rejects a motzash delay under 60 minutes', () => {
    const r = sendPolicyFromFormData(formFor({ motzashPlusMin: '15' }));
    expect(r.ok).toBe(false);
  });
});

describe('sendPolicyFromFormData — Shabbat is not a field', () => {
  it('Saturday is null even when the POST supplies a window for it', () => {
    // Not a hypothetical: the inputs are absent from the page, so anything
    // arriving under these names came from a crafted request. The policy must
    // come out identical to one posted without them.
    const f = formFor();
    f.set('weekday.6.start', '09:00');
    f.set('weekday.6.end', '20:30');
    const r = sendPolicyFromFormData(f);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.policy.weekday[6]).toBeNull();
  });

  it('a weekday cannot be emptied — only Saturday may have no window', () => {
    const r = sendPolicyFromFormData(
      formFor({ 'weekday.3.start': '', 'weekday.3.end': '' }),
    );
    expect(r.ok).toBe(false);
  });
});

describe('sendPolicyFromFormData — preferred times', () => {
  it('keeps every stored key, not only the three the form was sketched with', () => {
    // The defect this prevents: rendering a fixed 7/3/1 and silently dropping a
    // fourth touchpoint's time on the next save.
    const f = formFor();
    f.set('preferred.3.days', '14');
    f.set('preferred.3.time', '10:00');
    const r = sendPolicyFromFormData(f);
    expect(r.ok).toBe(true);
    if (r.ok)
      expect(r.policy.preferredTimeByDaysBefore).toEqual({
        ...DEFAULT_SEND_POLICY.preferredTimeByDaysBefore,
        '14': '10:00',
      });
  });

  it('clearing the time removes that row', () => {
    const r = sendPolicyFromFormData(formFor({ 'preferred.0.time': '' }));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.policy.preferredTimeByDaysBefore).not.toHaveProperty('7');
  });

  it('the trailing blank row is not an error and not a key', () => {
    const r = sendPolicyFromFormData(formFor());
    expect(r.ok).toBe(true);
    if (r.ok)
      expect(Object.keys(r.policy.preferredTimeByDaysBefore).sort()).toEqual(
        Object.keys(DEFAULT_SEND_POLICY.preferredTimeByDaysBefore).sort(),
      );
  });

  it('a time with no days number is an error on that row, not a silent drop', () => {
    const r = sendPolicyFromFormData(formFor({ 'preferred.3.time': '10:00' }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.fieldErrors['preferred.3.days']).toBeTruthy();
  });

  it('the same days number twice is refused rather than last-write-wins', () => {
    const f = formFor();
    f.set('preferred.3.days', '7');
    f.set('preferred.3.time', '19:00');
    const r = sendPolicyFromFormData(f);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.fieldErrors['preferred.3.days']).toBeTruthy();
  });

  it('a rejected preferred TIME is reported on its own row, not at the top', () => {
    const r = sendPolicyFromFormData(formFor({ 'preferred.1.time': '25:00' }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.fieldErrors['preferred.1.time']).toBeTruthy();
  });
});

describe('sendPolicyFromFormData — errors land on the control that caused them', () => {
  it('a bad weekday time is keyed by its own input name', () => {
    const r = sendPolicyFromFormData(formFor({ 'weekday.4.start': 'nonsense' }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.fieldErrors['weekday.4.start']).toBeTruthy();
  });

  it('a non-numeric spread is keyed as spreadSpanMinutes, the name on the page', () => {
    const r = sendPolicyFromFormData(formFor({ spreadSpanMinutes: 'abc' }));
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.fieldErrors.spreadSpanMinutes).toBeTruthy();
      expect(r.fieldErrors.spreadSpanMs).toBeUndefined();
    }
  });

  it('a spread past the schema ceiling is remapped from spreadSpanMs to the input', () => {
    // 7 hours — over the 6h maximum, so the rejection comes from Zod with path
    // `spreadSpanMs`, a name that appears nowhere on the page.
    const r = sendPolicyFromFormData(formFor({ spreadSpanMinutes: '420' }));
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.fieldErrors.spreadSpanMinutes).toBeTruthy();
      expect(r.fieldErrors.spreadSpanMs).toBeUndefined();
    }
  });
});
