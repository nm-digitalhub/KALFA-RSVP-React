import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // Puppeteer bundles a Chromium binary and uses dynamic requires; it must run
  // as a real Node module (not be webpack-bundled). Used server-side to render
  // the signed-agreement PDF (Hebrew BiDi). See src/lib/agreements/pdf.ts.
  serverExternalPackages: ['puppeteer'],
};

export default nextConfig;
