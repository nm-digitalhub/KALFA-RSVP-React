import { describe, expect, it } from 'vitest';

import { validateRecordingUrl } from './recording-url';

describe('validateRecordingUrl', () => {
  it('accepts the verified Voximplant cloud gateway host', () => {
    const url = 'https://storage-gw-us-01.voximplant.com/voxdata-us-rec-secure/2026/04/07/x.mp3';
    expect(validateRecordingUrl(url)).toEqual({ url });
  });

  it('accepts a sibling gateway (pattern-tolerant, still strict)', () => {
    const url = 'https://storage-gw-eu-02.voximplant.com/rec/x.mp3';
    expect(validateRecordingUrl(url)).toEqual({ url });
  });

  it('treats null/empty as "no recording" (not an error)', () => {
    expect(validateRecordingUrl(null)).toEqual({ url: null });
    expect(validateRecordingUrl('')).toEqual({ url: null });
  });

  it('rejects non-HTTPS', () => {
    expect(validateRecordingUrl('http://storage-gw-us-01.voximplant.com/x.mp3')).toEqual({
      url: null,
      reason: 'not_https',
    });
  });

  it('rejects an unparseable URL', () => {
    expect(validateRecordingUrl('not a url')).toMatchObject({ url: null, reason: 'unparseable' });
  });

  it('rejects embedded credentials', () => {
    expect(
      validateRecordingUrl('https://user:pass@storage-gw-us-01.voximplant.com/x.mp3'),
    ).toMatchObject({ url: null, reason: 'has_credentials' });
  });

  it('rejects private / loopback / metadata hosts', () => {
    for (const h of ['127.0.0.1', '10.0.0.5', '192.168.1.1', '172.16.0.1', '169.254.169.254', 'localhost']) {
      expect(validateRecordingUrl(`https://${h}/x.mp3`)).toMatchObject({ url: null, reason: 'private_host' });
    }
  });

  it('rejects a bare IP literal', () => {
    expect(validateRecordingUrl('https://8.8.8.8/x.mp3')).toMatchObject({ url: null, reason: 'private_host' });
  });

  it('rejects a non-allowlisted host (incl. bare *.voximplant.com and arbitrary domains)', () => {
    expect(validateRecordingUrl('https://api.voximplant.com/x.mp3')).toMatchObject({
      url: null,
      reason: 'host_not_allowlisted',
    });
    expect(validateRecordingUrl('https://evil.example.com/x.mp3')).toMatchObject({
      url: null,
      reason: 'host_not_allowlisted',
    });
    // no subdomain-suffix bypass
    expect(validateRecordingUrl('https://storage-gw-us-01.voximplant.com.evil.com/x.mp3')).toMatchObject({
      url: null,
      reason: 'host_not_allowlisted',
    });
  });
});
