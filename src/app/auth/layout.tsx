import type { Metadata } from 'next';
import type { ReactNode } from 'react';

// Every /auth/* page is reachable by crawlers on purpose (it is NOT in
// robots.txt's disallow list — see src/app/robots.ts for Google's rule) and
// carries noindex so it is dropped from Search rather than indexed as a bare
// URL. `follow` stays on: the pages link back to the public site.
export const metadata: Metadata = {
  robots: { index: false, follow: true },
};

export default function AuthLayout({ children }: { children: ReactNode }) {
  return children;
}
