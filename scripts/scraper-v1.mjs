#!/usr/bin/env node

// Compatibility entry point for the original scraper CLI.
//
// v1 used a separate crawler with a fixed first-match content root, an
// origin-wide default boundary, no robots/rate-limit policy, shared Crawlee
// storage and success exit codes for partial output. Keeping a second crawler
// would make every correctness fix diverge again. The maintained pipeline now
// owns parsing, analysis, validation, crawling, auditing and export; this file
// preserves the old command path while delegating to that pipeline.
//
// Supported invocations remain:
//   node scripts/scraper-v1.mjs <start-url> <out.json>
//   node scripts/scraper-v1.mjs <start-url> <out.json> --glob '<pattern>'
//   node scripts/scraper-v1.mjs --only <out.json> <url> <url> ...

import { main } from './docs-scraper/scraper.mjs';

console.warn(
    '[deprecated] scripts/scraper-v1.mjs now uses the maintained docs-scraper pipeline. ' +
    'Prefer scripts/docs-scraper/scraper.mjs.',
);

await main(process.argv.slice(2));
