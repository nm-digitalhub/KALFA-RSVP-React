import { describe, expect, it } from 'vitest';

import { describeEventLine, DEVICES, downloadFailureText, EVENT_KIND_TEXT, minutesLabel, REQUEST_REFUSAL_TEXT } from './copy';
import { RDP_EVENT_KINDS } from './events';
import { RDP_MINUTES_PRESETS } from './policy';

describe('the owner timeline wording', () => {
  it('has a sentence for every audit event kind, and no sentence for a kind that does not exist', () => {
    expect(Object.keys(EVENT_KIND_TEXT).sort()).toEqual([...RDP_EVENT_KINDS].sort());
  });
});

describe('minutesLabel', () => {
  it('names every duration the form offers', () => {
    expect(RDP_MINUTES_PRESETS.map(minutesLabel)).toEqual(['30 דקות', 'שעה', 'שעתיים', '4 שעות']);
  });

  it('handles values between the presets', () => {
    expect(minutesLabel(5)).toBe('5 דקות');
    expect(minutesLabel(90)).toBe('שעה ו-30 דקות');
    expect(minutesLabel(180)).toBe('3 שעות');
  });
});

describe('downloadFailureText', () => {
  it('answers every code the file route can send with its own sentence, and falls back for the rest', () => {
    const codes = ['too_soon', 'file_limit', 'no_active_grant', 'gateway_unavailable', 'rate_limited', 'unauthorized', 'forbidden', 'not_allowed', 'no_client_ip'];
    const texts = new Set(codes.map((code) => downloadFailureText(code, 20)));
    // unauthorized / forbidden / not_allowed deliberately share one sentence
    expect(texts.size).toBe(codes.length - 2);
    expect(downloadFailureText('file_limit', 20)).toContain('(20)');
    expect(downloadFailureText('something_new', 20)).toBe(downloadFailureText(null, 20));
  });

  it('never claims what it cannot know about the download count', () => {
    for (const code of ['gateway_unavailable', 'server_error', null]) {
      expect(downloadFailureText(code, 20)).not.toMatch(/לא נספר/);
    }
  });
});

describe('the staff screens\' fixed sentences', () => {
  it('has a refusal sentence for every outcome the request action can meet', () => {
    expect(Object.keys(REQUEST_REFUSAL_TEXT).sort()).toEqual(
      ['already_pending', 'busy', 'has_active_grant', 'invalid_minutes', 'invalid_reason', 'not_allowed', 'rate_limited', 'unexpected'],
    );
  });

  it('gives every device exactly three steps, ending with the desktop opening', () => {
    for (const device of DEVICES) {
      expect(device.steps).toHaveLength(3);
      expect(device.steps.at(-1)).toBe('שולחן העבודה נפתח.');
    }
  });
});

describe('describeEventLine', () => {
  it('leaves out an outcome that only repeats the sentence', () => {
    expect(describeEventLine('requested', 'pending')).toBe('הבקשה נשלחה');
    expect(describeEventLine('approved', 'approved')).toBe('הבעלים אישר');
    expect(describeEventLine('grant_revoked', 'revoked')).toBe('הבעלים ביטל את הגישה');
    expect(describeEventLine('disconnect_ok', 'ok')).toBe('ניתוק חיבורים: הצליח');
  });

  it('keeps the outcome where it explains a failure or a refusal', () => {
    expect(describeEventLine('file_failed', 'timeout')).toBe('הכנת הקובץ נכשלה · timeout');
    expect(describeEventLine('file_refused', 'file_limit')).toBe('הורדת קובץ נדחתה · file_limit');
    expect(describeEventLine('disconnect_failed', 'unreachable')).toBe('ניתוק חיבורים: נכשל · unreachable');
  });

  it('reads a gateway check as allowed or denied with the reason', () => {
    expect(describeEventLine('tunnel_check', 'allow')).toBe('בדיקת חיבור מהשער: הותר');
    expect(describeEventLine('tunnel_check', 'deny:no_active_grant')).toBe('בדיקת חיבור מהשער: נדחה (no_active_grant)');
    expect(describeEventLine('tunnel_check', null)).toBe('בדיקת חיבור מהשער: נדחה');
  });

  it('shows an unknown kind by its own code, with its outcome, rather than hiding it', () => {
    expect(describeEventLine('brand_new_kind', 'x')).toBe('brand_new_kind · x');
  });
});
