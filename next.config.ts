import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import type { NextConfig } from 'next';

// Version-skew protection (docs: next-config-js/deploymentId). The deploy
// script writes a fresh id to .deploy-id BEFORE building, so the id baked into
// client assets and the one the pm2 `next start` process reads at boot are
// always the same file → same value. A tab from an older deploy then triggers
// a hard reload on navigation instead of invoking stale Server Action ids
// ("Failed to find Server Action"). No .deploy-id (dev, verification builds)
// → undefined → skew protection simply off, exactly as before.
function readDeployId(): string | undefined {
  try {
    const id = readFileSync(join(process.cwd(), '.deploy-id'), 'utf8').trim();
    return id || undefined;
  } catch {
    return undefined;
  }
}

// The exact Supabase storage host for the image-optimizer allowlist. Falls
// back to the wildcard only when the env is absent (isolated tooling builds) —
// the running app always has NEXT_PUBLIC_SUPABASE_URL.
function supabaseHostname(): string {
  try {
    return new URL(process.env.NEXT_PUBLIC_SUPABASE_URL ?? '').hostname;
  } catch {
    return '*.supabase.co';
  }
}

const nextConfig: NextConfig = {
  deploymentId: readDeployId(),
  // Build output directory. Defaults to `.next`, but verification and deploy
  // builds set NEXT_DIST_DIR to an ISOLATED directory so a build never
  // overwrites the `.next` that the live `next start` (pm2) process is serving.
  // Overwriting the live `.next` mid-build is what causes "Failed to find
  // Server Action" and webpack chunk (`require is not a function`) errors until
  // a restart. `next start` (pm2) leaves NEXT_DIST_DIR unset → always uses
  // `.next`; the deploy script atomically swaps the freshly built dir in.
  distDir: process.env.NEXT_DIST_DIR || '.next',
  // Server Action uploads: Next's default body limit is 1MB, which rejected
  // the invite-image upload (product limit: INVITE_IMAGE_MAX_BYTES = 5MB) with
  // "Body exceeded 1 MB limit" (413). 6mb = 5MB image + multipart/form
  // overhead. nginx allows 25M (client_max_body_size), so nginx is not the
  // bottleneck; per-upload size/type checks stay enforced in the actions.
  experimental: {
    serverActions: {
      bodySizeLimit: '6mb',
    },
  },
  // next/image optimizer allowlist: the invitation-image preview renders
  // short-lived SIGNED urls from the private event-media bucket. Pinned to
  // OUR project host + sign path only — a wildcard *.supabase.co would let
  // anyone with any Supabase project use our optimizer as a free image proxy
  // (they can sign their own objects). Env is loaded (@next/env) before this
  // config is evaluated, at build and at `next start` alike.
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: supabaseHostname(),
        pathname: '/storage/v1/object/sign/**',
      },
    ],
  },
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
