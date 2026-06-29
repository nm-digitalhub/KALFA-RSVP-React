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
  // Public RSVP pages carry a per-guest bearer token in the path. A Server
  // Component can't set response headers, so enforce them here: never cache the
  // guest-specific response, never leak the token via the Referer header, and
  // keep the page out of search indexes (defense-in-depth with the route's
  // `robots` metadata).
  async headers() {
    return [
      {
        source: '/r/:token*',
        headers: [
          { key: 'Cache-Control', value: 'no-store, max-age=0' },
          { key: 'Referrer-Policy', value: 'no-referrer' },
          { key: 'X-Robots-Tag', value: 'noindex, nofollow' },
        ],
      },
    ];
  },
};

export default nextConfig;
