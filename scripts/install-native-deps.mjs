#!/usr/bin/env node
// Installs the binary artifacts npm is no longer allowed to fetch on its own.
//
// npm 12 blocks dependency install scripts by default (`allowScripts`), and two
// of this project's dependencies ship their real payload through exactly such a
// script:
//
//   puppeteer  — downloads Chrome from a postinstall. Without it,
//                puppeteer.launch() throws at RUNTIME, which takes down
//                src/lib/agreements/pdf.ts (the SIGNED CUSTOMER AGREEMENT) and
//                src/lib/data/social-image-render.ts. Reached production once,
//                on 2026-09-06, after a 25.7 → 25.10 bump.
//   keytar     — a native module whose install pulls a prebuilt .node binary.
//                Nothing in src/ or worker/ imports it; it is reached only
//                through @microsoft/m365agentstoolkit-cli, and without it that
//                CLI cannot start at all.
//
// This runs as the ROOT package's own postinstall. That is deliberate and is
// NOT a way around the security default: `allowScripts` gates what THIRD-PARTY
// packages may execute. This file is ours, it is in the repo, and it is
// reviewable — unlike `npm install-scripts approve puppeteer`, which would hand
// every future version of that package the right to run arbitrary code here.
//
// Idempotent: both steps check first and exit quietly when the artifact is
// already in place, so a normal `npm install` costs milliseconds.
//
// Never fails the install. A missing browser must not stop a developer from
// installing dependencies — the DEPLOY gate
// (scripts/check-puppeteer-browser.mjs) is what refuses to ship without it.

import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);

function run(label, cmd, args, opts = {}) {
  const res = spawnSync(cmd, args, { stdio: 'inherit', ...opts });
  if (res.error || res.status !== 0) {
    console.warn(
      `install-native-deps: ${label} did not complete. This is not fatal here, ` +
        'but the deploy gate will refuse to ship without it.',
    );
    return false;
  }
  return true;
}

// ---- puppeteer's Chrome -----------------------------------------------------
try {
  const puppeteer = require('puppeteer');
  const executablePath = await puppeteer.executablePath();
  if (typeof executablePath === 'string' && existsSync(executablePath)) {
    console.log('install-native-deps: puppeteer browser present.');
  } else {
    console.log('install-native-deps: puppeteer browser missing — installing Chrome…');
    run('puppeteer browsers install chrome', 'npx', [
      '--no-install',
      'puppeteer',
      'browsers',
      'install',
      'chrome',
    ]);
  }
} catch {
  // puppeteer not installed at all (a slimmed install) — nothing to do.
}

// ---- keytar's prebuilt native binary ---------------------------------------
try {
  const keytarDir = dirname(require.resolve('keytar/package.json'));
  if (existsSync(join(keytarDir, 'build', 'Release', 'keytar.node'))) {
    console.log('install-native-deps: keytar binary present.');
  } else {
    console.log('install-native-deps: keytar binary missing — fetching prebuilt…');
    // --runtime napi: keytar publishes N-API prebuilds, which are the ones that
    // do not have to match the exact Node version.
    run('prebuild-install for keytar', 'npx', ['prebuild-install', '--runtime', 'napi'], {
      cwd: keytarDir,
    });
  }
} catch {
  // keytar not installed — it arrives only via the optional M365 CLI.
}
