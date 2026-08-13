'use client';

import dynamic from 'next/dynamic';

// Client wrapper whose sole job is the ssr:false dynamic import of the panel —
// same shape as cookie-consent-lazy.tsx (the repo's only other next/dynamic
// use), for the same reason: `ssr: false` is an error in a Server Component,
// and a dynamic import made FROM a Server Component does not code-split at
// all, so this wrapper is what actually keeps the Voximplant Web SDK chunk
// out of every admin page's initial bundle. The panel itself decides whether
// to render anything (SoftphoneGateInfo.enabled / voxUsername), so this
// wrapper is mounted unconditionally by AdminShell.
export const SoftphonePanelLazy = dynamic(
  () => import('./softphone-panel').then((m) => m.SoftphonePanel),
  { ssr: false },
);
