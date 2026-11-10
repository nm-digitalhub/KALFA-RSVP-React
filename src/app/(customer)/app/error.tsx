'use client';

import { RouteErrorView } from '@/components/route-error-view';

// Error boundary for the customer area. Shows a generic, privacy-safe message —
// never the raw error/stack — and offers a retry. A stale-deployment Server
// Action error triggers a one-time reload instead (see RouteErrorView).
export default function CustomerError({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  return <RouteErrorView error={error} retry={retry} />;
}
