#!/usr/bin/env node
// Post-deploy IndexNow notification: tells Bing (and every IndexNow engine —
// Yandex, Seznam, Naver) which public URLs may have changed, right after the
// deploy that changed them.
//
// WHY. Bing's Webmaster Guidelines (§2, §4, §9, §19) ask for an IndexNow ping
// on every add / update / delete and prefer streaming over batches. A deploy is
// the only moment the marketing pages can change (they are code, not CMS), so
// the ping belongs here, after the site is live and after the SEO gate proved
// the pages are worth indexing.
//
// It runs LAST in `npm run deploy` and is deliberately NON-FATAL: IndexNow is a
// hint to third parties, not part of our correctness. A failure prints a
// warning and exits 0 so a slow Bing endpoint can never fail a deploy.
//
// What it submits: every <loc> in the live sitemap. That is 12 URLs today — a
// single request, well under IndexNow's 10,000-URL cap — so "only the changed
// ones" would buy nothing yet. The key file lives in public/ (public by
// protocol design: the engine fetches it to prove we own the host) and the key
// itself is read by the `seo` CLI from its own local store, never from here.

import { spawn } from 'node:child_process';

const origin = process.env.APP_ORIGIN?.trim().replace(/\/+$/, '');
if (!origin) {
  console.warn('seo-indexnow: APP_ORIGIN is not set — skipping IndexNow.');
  process.exit(0);
}

let urls = [];
try {
  const res = await fetch(`${origin}/sitemap.xml`, {
    signal: AbortSignal.timeout(10_000),
    headers: { 'user-agent': 'kalfa-seo-indexnow' },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const xml = await res.text();
  urls = [...xml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/g)].map((m) => m[1]);
} catch (err) {
  console.warn(`seo-indexnow: could not read ${origin}/sitemap.xml (${err instanceof Error ? err.message : err}) — skipping.`);
  process.exit(0);
}
if (urls.length === 0) {
  console.warn('seo-indexnow: sitemap listed no URLs — skipping.');
  process.exit(0);
}

const dryRun = process.argv.includes('--dry-run');
const args = ['--no-install', 'seo', 'indexnow', 'submit', '--site', origin, '--urls', urls.join(','), '--json'];
if (dryRun) args.push('--dry-run');

const child = spawn('npx', args, {
  stdio: ['ignore', 'pipe', 'pipe'],
  env: { ...process.env, npm_config_global_ignore_file: undefined },
});
let out = '';
let err = '';
child.stdout.on('data', (d) => (out += d));
child.stderr.on('data', (d) => (err += d));
child.on('error', (e) => {
  console.warn(`seo-indexnow: could not run the seo CLI — ${e.message}`);
  process.exit(0);
});
child.on('exit', (code) => {
  let parsed = null;
  try {
    parsed = JSON.parse(out || err);
  } catch {
    /* non-JSON output: report raw below */
  }
  if (code === 0 && parsed && parsed.ok !== false) {
    const status = parsed.status ?? parsed.result?.status ?? parsed.response?.status ?? '';
    console.log(`seo-indexnow: ${dryRun ? 'validated' : 'submitted'} ${urls.length} URLs for ${origin}${status ? ` (${status})` : ''}.`);
    process.exit(0);
  }
  const detail = parsed?.error?.message ?? (err || out).trim().slice(-400);
  console.warn(`seo-indexnow: IndexNow submission failed (exit ${code}) — ${detail}. The deploy is unaffected.`);
  process.exit(0);
});
