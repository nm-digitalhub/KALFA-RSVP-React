import { NextResponse, type NextRequest } from 'next/server';

import { workflowRunsFingerprint } from '@/lib/data/admin/workflows';

// "Has the runs list changed?" — one query, one short string, nothing else.
//
// ⚠️ THIS EXISTS SO THE PAGE DOES NOT HAVE TO REFRESH TO FIND OUT. A trigger
// creates a run with no browser involved: an inbound WhatsApp message produced
// one at 18:55:53 and finished it at 18:55:57 while the editor sat open and
// visible, and the table went on showing the previous day's runs until someone
// reloaded. `runs-auto-refresh.tsx` now polls this instead of going quiet, and
// calls `router.refresh()` only when the answer differs — so an idle page costs
// ONE query per tick rather than the seven a full refresh re-runs.
//
// ⚠️ IT RETURNS NO RUN DATA, AND THAT IS THE POINT. A hash cannot leak a guest's
// message text or a phone number the way the rows themselves could; everything
// the table displays still arrives through the server render and the gate that
// already guards it. Deliberately NOT a Realtime subscription on
// `workflow_runs` for the same reason: `postgres_changes` would hand the
// browser whole rows — `trigger_payload` included — under the table's own
// `is_platform_staff()` policy, which is wider than the `manage_settings` gate
// the page's loader uses.
//
// A thin handler on purpose, per the project's route rules: validate, delegate,
// return. The permission check lives with the query in
// `workflowRunsFingerprint`, where every other workflow read is gated.

export const dynamic = 'force-dynamic';

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const fingerprint = await workflowRunsFingerprint(id);

  // `no-store` because the whole value of this route is that it is current.
  return NextResponse.json(
    { fingerprint },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
