import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // Build output directory. Defaults to `.next`, but verification and deploy
  // builds set NEXT_DIST_DIR to an ISOLATED directory so a build never
  // overwrites the `.next` that the live `next start` (pm2) process is serving.
  // Overwriting the live `.next` mid-build is what causes "Failed to find
  // Server Action" and webpack chunk (`require is not a function`) errors until
  // a restart. `next start` (pm2) leaves NEXT_DIST_DIR unset → always uses
  // `.next`; the deploy script atomically swaps the freshly built dir in.
  distDir: process.env.NEXT_DIST_DIR || '.next',
  // Puppeteer bundles a Chromium binary and uses dynamic requires; it must run
  // as a real Node module (not be webpack-bundled). Used server-side to render
  // the signed-agreement PDF (Hebrew BiDi). See src/lib/agreements/pdf.ts.
  serverExternalPackages: ['puppeteer'],
};

export default nextConfig;
