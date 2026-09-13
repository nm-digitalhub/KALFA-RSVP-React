import { describe, expect, it } from 'vitest';

import { validateWebhookUrl } from './webhook-url';

// The SSRF boundary for `action.webhook` — the one node that makes a request to
// an address a human typed. Unlike validateRecordingUrl, which only decides
// whether a string is safe to STORE, a pass here becomes a socket.

const reject = (url: string) => {
  const r = validateWebhookUrl(url);
  expect(r.ok, `expected ${url} to be refused`).toBe(false);
  return r.ok ? '' : r.reason;
};

const accept = (url: string) => {
  const r = validateWebhookUrl(url);
  expect(r.ok, `expected ${url} to be allowed`).toBe(true);
  return r.ok ? r.url : '';
};

describe('validateWebhookUrl — the cloud metadata address and its neighbours', () => {
  it('refuses the instance-metadata address', () => {
    // The classic SSRF target: on a cloud host it answers with credentials.
    expect(reject('https://169.254.169.254/latest/meta-data/')).toBe('private_host');
  });

  it('refuses loopback in every spelling', () => {
    for (const host of [
      'https://localhost/hook',
      'https://127.0.0.1/hook',
      'https://[::1]/hook',
    ]) {
      expect(reject(host)).toBe('private_host');
    }
  });

  it('refuses RFC1918 space', () => {
    for (const host of [
      'https://10.0.0.5/hook',
      'https://192.168.1.10/hook',
      'https://172.16.4.4/hook',
      'https://172.31.255.255/hook',
    ]) {
      expect(reject(host)).toBe('private_host');
    }
  });

  it('refuses internal-sounding suffixes', () => {
    for (const host of ['https://db.local/hook', 'https://api.internal/hook']) {
      expect(reject(host)).toBe('private_host');
    }
  });

  it('refuses IPv6 unique-local and link-local', () => {
    for (const host of ['https://[fd00::1]/hook', 'https://[fe80::1]/hook']) {
      expect(reject(host)).toBe('private_host');
    }
  });

  it('refuses a PUBLIC bare IPv4 too — a webhook is addressed by name', () => {
    // Deliberate over-rejection. It costs a legitimate caller nothing and removes
    // the whole "is this particular address internal" question.
    expect(reject('https://8.8.8.8/hook')).toBe('private_host');
  });
});

describe('validateWebhookUrl — transport and credentials', () => {
  it('refuses http — a body carrying guest data must not go out in clear text', () => {
    expect(reject('http://example.com/hook')).toBe('not_https');
  });

  it('refuses other schemes outright', () => {
    expect(reject('file:///etc/passwd')).toBe('not_https');
    expect(reject('ftp://example.com/x')).toBe('not_https');
  });

  it('refuses embedded credentials rather than silently stripping them', () => {
    // Stripping would mean the webhook authenticates as nobody and the owner is
    // never told which half of what they typed was thrown away.
    expect(reject('https://user:pass@example.com/hook')).toBe('has_credentials');
  });

  it('names an empty URL as empty, not as unparseable', () => {
    expect(reject('')).toBe('empty');
    expect(reject('   ')).toBe('empty');
  });

  it('refuses something that is not a URL at all', () => {
    expect(reject('not a url')).toBe('unparseable');
    expect(reject('example.com/hook')).toBe('unparseable');
  });
});

describe('validateWebhookUrl — what it allows', () => {
  it('allows an ordinary https endpoint', () => {
    expect(accept('https://example.com/hooks/kalfa')).toContain('example.com');
  });

  it('keeps the path, query and a non-default port', () => {
    // A secret path segment is one of the two authentication shapes this node
    // supports, so nothing may be trimmed off the URL.
    const url = accept('https://hooks.example.com:8443/t/abc123?src=kalfa');
    expect(url).toContain('/t/abc123');
    expect(url).toContain('src=kalfa');
    expect(url).toContain(':8443');
  });

  it('trims surrounding whitespace from a pasted URL', () => {
    expect(accept('  https://example.com/hook  ')).toBe('https://example.com/hook');
  });
});
