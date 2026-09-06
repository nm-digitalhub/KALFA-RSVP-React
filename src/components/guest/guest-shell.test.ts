import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

// Source-level guards for the guest-facing brand line (2026-09-06). Vitest runs
// in a Node environment, so these pin structure through the files rather than a
// DOM render — same approach as site-footer.test.ts.

const repoRoot = join(__dirname, '..', '..', '..');
const publicDir = join(repoRoot, 'src', 'app', '(public)');
const shellSrc = readFileSync(join(__dirname, 'guest-shell.tsx'), 'utf8');

// The guest token surfaces. /join is deliberately absent: it is a team
// invitation, so its recipient is becoming a KALFA user — telling them the page
// is "managed by KALFA" says nothing.
const GUEST_SURFACES = ['r', 'g', 'ty', 'rate'];

function pageSrc(surface: string): string {
  const dir = join(publicDir, surface);
  const tokenDir = readdirSync(dir).find((e) => e.startsWith('[') && statSync(join(dir, e)).isDirectory());
  if (!tokenDir) throw new Error(`no token segment under ${surface}`);
  return readFileSync(join(dir, tokenDir, 'page.tsx'), 'utf8');
}

describe('guest brand line', () => {
  it('every guest token surface renders through the shared shell', () => {
    for (const surface of GUEST_SURFACES) {
      const src = pageSrc(surface);
      expect(src, surface).toContain('GuestShell');
      expect(src, surface).toContain("@/components/guest/guest-shell");
    }
  });

  it('no page keeps a private copy of the shell', () => {
    // Four near-identical local `Shell` functions existed before this; a
    // reintroduced copy would silently miss the brand line and any future
    // change to guest chrome.
    for (const surface of GUEST_SURFACES) {
      expect(pageSrc(surface), surface).not.toMatch(/function Shell\s*\(/);
    }
  });

  it('the line is VISIBLE — never hidden text, which is a spam-policy violation', () => {
    // Google's spam policies name hidden text explicitly: content placed on a
    // page "solely to manipulate search engines and not to be easily viewable
    // by human visitors", with offending sites ranking lower "or not appear in
    // results at all". These are the CSS shapes that policy lists.
    const forbidden = [
      /display\s*:\s*none/,
      /visibility\s*:\s*hidden/,
      /opacity-0\b/,
      /\btext-\[0(px|rem)?\]/,
      /sr-only/,
      /-left-\[9999/,
      /aria-hidden/,
    ];
    for (const pattern of forbidden) {
      expect(shellSrc, `hidden-text pattern ${pattern}`).not.toMatch(pattern);
    }
    // and it must actually say the brand out loud
    expect(shellSrc).toContain('KALFA');
  });

  it('the link is nofollow and points at our own origin through the trusted helper', () => {
    expect(shellSrc).toContain('rel="nofollow"');
    // Never a hardcoded host: getAppUrl resolves APP_ORIGIN and refuses
    // anything off-origin, so a relocated deploy links to itself.
    expect(shellSrc).toContain('getAppUrl(');
    expect(shellSrc).not.toMatch(/https?:\/\/[a-z]/);
  });

  it('carries UTM so the traffic is measurable rather than indistinguishable from direct', () => {
    expect(shellSrc).toContain('utm_source=guest_page');
    expect(shellSrc).toContain('utm_medium=referral');
  });

  it('is pinned below the content instead of being centred with it', () => {
    // The old shells centred everything in a min-h-svh column; appending the
    // line there would have made it read as more content, not a signature.
    expect(shellSrc).toContain('flex-1');
    expect(shellSrc).toMatch(/\{children\}[\s\S]*<BrandLine/);
  });

  it('keeps RTL logical — no physical-direction utilities', () => {
    expect(shellSrc).not.toMatch(/\b(ml|mr|pl|pr|text-left|text-right)-/);
  });
});
