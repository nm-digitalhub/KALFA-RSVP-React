#!/usr/bin/env node
// Fails the deploy when puppeteer has no matching Chrome on disk.
//
// WHY: npm 12 blocks package install scripts by default (`allowScripts`), and
// puppeteer downloads its browser from exactly such a postinstall. So every
// puppeteer version bump silently leaves the previous Chrome in the cache and
// the new expected build missing — `launch()` then throws at RUNTIME, in
// production, with nothing failing earlier.
//
// It happened on 2026-09-06: puppeteer 25.7.0 → 25.10.0 moved the expected
// build to 152.0.7977.75 while the cache held .42, and the break reached the
// deployed site. lint, tsc, a production build and 4,134 unit tests all passed
// — the puppeteer tests mock `launch`, so nothing in the suite ever touches a
// real browser.
//
// What breaks when this is wrong is not cosmetic: src/lib/agreements/pdf.ts
// renders the SIGNED CUSTOMER AGREEMENT, and src/lib/data/social-image-render.ts
// renders social images. Both call `puppeteer.launch()` with no explicit
// executablePath, so both depend on this resolution succeeding.
//
// Deliberately checks the PATH rather than launching: resolving is milliseconds
// and answers the only question that has ever gone wrong here. It never
// installs anything — a deploy must not start a silent 150MB download; it
// stops and prints the one command that fixes it.

import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

let puppeteer;
try {
  puppeteer = require('puppeteer');
} catch (err) {
  console.error(`check-puppeteer-browser: cannot load puppeteer — ${err.message}`);
  process.exit(1);
}

// executablePath() is async in puppeteer >= 24 and sync in older majors;
// awaiting a plain string is harmless, so this holds across both.
const executablePath = await puppeteer.executablePath();

if (typeof executablePath !== 'string' || executablePath === '') {
  console.error('check-puppeteer-browser: puppeteer returned no executable path.');
  process.exit(1);
}

if (!existsSync(executablePath)) {
  const version = require('puppeteer/package.json').version;
  console.error(
    `check-puppeteer-browser: puppeteer ${version} expects a browser that is NOT installed.\n` +
      `  missing: ${executablePath}\n\n` +
      '  Agreement PDFs and social images call puppeteer.launch() and will throw at\n' +
      '  runtime until this exists. npm cannot fetch it on its own here: npm 12 blocks\n' +
      "  puppeteer's postinstall script by default.\n\n" +
      '  Fix:  npx puppeteer browsers install chrome\n',
  );
  process.exit(1);
}

console.log(`check-puppeteer-browser: ok (${executablePath})`);
