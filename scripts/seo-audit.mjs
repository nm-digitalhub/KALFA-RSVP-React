#!/usr/bin/env node
// Post-deploy SEO gate: crawls every page in the live sitemap and fails if any
// of them drops below grade A.
//
// WHY THIS EXISTS AND UNIT TESTS DO NOT REPLACE IT. On 2026-09-06 a metadata
// change passed lint, tsc, 4,133 unit tests and a production build, then
// silently stripped og:image from all 11 child pages — every page-level
// `openGraph` object REPLACES the inherited one, taking the image the
// opengraph-image.png file convention had injected with it. No source file was
// wrong; the defect existed only in the ASSEMBLED HTML. The tests read code,
// this reads the rendered page, which is the only place that class of bug is
// visible.
//
// It runs LAST in `npm run deploy`, after the site is already live — a crawler
// needs something to crawl. That ordering is deliberate and has a consequence:
// a failure here does NOT roll anything back. It makes the deploy command exit
// non-zero so the operator sees the regression immediately instead of learning
// about it from a traffic chart weeks later. An SEO regression is loud, not
// fatal.

import { spawn } from 'node:child_process';

const MIN_GRADE = process.env.SEO_MIN_GRADE ?? 'A';
// The site is warm by the time this runs (the worker and fleet bundles build
// after the pm2 restart), but a restart that is still binding its port would
// otherwise fail the whole deploy over a timing artefact.
const READY_TIMEOUT_MS = 60_000;
const READY_INTERVAL_MS = 2_000;

// APP_ORIGIN is the same value every server-side URL in the app resolves from
// (src/lib/url.ts) — never a hardcoded host, so a relocated deploy audits
// itself rather than the old domain.
const origin = process.env.APP_ORIGIN?.trim().replace(/\/+$/, '');
if (!origin) {
  console.error('seo-audit: APP_ORIGIN is not set — cannot tell which site to audit.');
  process.exit(1);
}

async function waitForSite() {
  const deadline = Date.now() + READY_TIMEOUT_MS;
  let lastError = 'no response';
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${origin}/sitemap.xml`, {
        signal: AbortSignal.timeout(5_000),
        headers: { 'user-agent': 'kalfa-seo-audit' },
      });
      if (res.ok) return;
      lastError = `HTTP ${res.status}`;
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
    }
    await new Promise((r) => setTimeout(r, READY_INTERVAL_MS));
  }
  console.error(`seo-audit: ${origin}/sitemap.xml never became reachable (${lastError}).`);
  process.exit(1);
}

await waitForSite();

// Inherit stdio so the crawler's own per-page table is what the operator sees;
// re-printing it here would only add a layer that can drift from the tool.
const child = spawn(
  'npx',
  ['lacspace-seo', 'crawl', `${origin}/sitemap.xml`, '--min-grade', MIN_GRADE],
  { stdio: 'inherit', env: { ...process.env, npm_config_global_ignore_file: undefined } },
);

child.on('exit', (code, signal) => {
  if (signal) {
    console.error(`seo-audit: crawler terminated by signal ${signal}.`);
    process.exit(1);
  }
  if (code !== 0) {
    console.error(
      `\nseo-audit: at least one page is below grade ${MIN_GRADE}. The deploy is LIVE — ` +
        'this is a report, not a rollback. Fix and redeploy.',
    );
  }
  process.exit(code ?? 1);
});

child.on('error', (err) => {
  console.error(`seo-audit: could not run the crawler — ${err.message}`);
  process.exit(1);
});
