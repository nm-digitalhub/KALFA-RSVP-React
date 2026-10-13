import 'server-only';

import { createRequire } from 'node:module';

// Puppeteer loaded via createRequire, NOT a static import — same technique as
// `pg` and @google-analytics/data elsewhere in this codebase. This module is
// bundled into dist/fleet-agent-cli.cjs (scripts/fleet-agent-cli.ts), which is
// spawned ~17 times a minute across 16 fleet roles, nearly all of which never
// render an image — a static import pulled Puppeteer's ~4MB into every one of
// those spawns and tripped the bundle-size gate (scripts/check-fleet-agent-
// bundle.mjs). createRequire is opaque to esbuild's bundler analysis, so
// Puppeteer stays a real runtime require resolved by Node against
// node_modules. This renderer is imported by the fleet CLI, not the Next app.
const puppeteer = createRequire(__filename)('puppeteer') as typeof import('puppeteer');

// Renders an author-supplied HTML file to a PNG screenshot for fleet render-image.
// Puppeteer and its matching Chrome remain required for this CLI functionality.
//
// Why a local render and not an image-generation API: social-manager's image
// posts are a small HTML+CSS mockup rendered to PNG. An ElevenLabs Flows
// (`/v1/flows/image`) call is rejected with "requires a Pro plan or above" (the
// project's ElevenLabs account is Creator tier, confirmed via
// GET /v1/user/subscription). So: no external
// API, no billing tier, no account dependency — just a local headless-browser
// screenshot of HTML the role already wrote, matching the earlier
// (`hyperframes`-scaffolded, Puppeteer-rendered) precedent's actual output
// shape without hyperframes' own heavier authoring/review-gated pipeline,
// which is built for video/rich compositions, not a single static mockup.
export interface RenderHtmlToImageParams {
  html: string;
  width: number;
  height: number;
  // Device scale factor for a sharper capture on a small viewport (matches
  // how a phone-mockup post is typically composed at ~2x). Optional so tests
  // can leave it at 1.
  deviceScaleFactor?: number;
}

export async function renderHtmlToImage(p: RenderHtmlToImageParams): Promise<Buffer> {
  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });
  try {
    const page = await browser.newPage();
    await page.setViewport({
      width: p.width,
      height: p.height,
      deviceScaleFactor: p.deviceScaleFactor ?? 1,
    });
    // The HTML is server/role-authored and trusted. This fleet-only renderer
    // does not accept untrusted input.
    await page.setContent(p.html, { waitUntil: 'load' });
    const png = await page.screenshot({ type: 'png' });
    return Buffer.from(png);
  } finally {
    await browser.close();
  }
}
