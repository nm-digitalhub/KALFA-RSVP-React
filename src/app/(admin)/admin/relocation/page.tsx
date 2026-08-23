import { requirePlatformOwner } from '@/lib/auth/dal';
import { getRelocationState } from '@/lib/data/admin/relocation';
import { PageHeading } from '../_components';
import {
  NoRunEmptyState,
  OpenGatesPanel,
  OpenItemsCard,
  ProgressPanel,
  RollbacksCard,
  RunHeaderCard,
  StageTimeline,
  UnreadableAlert,
  UnsupportedVersionAlert,
} from './_panels';
import { AutoRefreshToggle } from './_auto-refresh-toggle';

export const metadata = { title: 'העברת דומיין' };

// Force-dynamic: renders the live `.relocation-state.json` written by the CLI
// wizard (npm run relocate) on every request — never statically optimized.
// Valid while cacheComponents is off (see the design doc's installed-docs
// citations); same shape as /admin/debug.
export const dynamic = 'force-dynamic';

// Read-only progress window for the relocation wizard
// (docs/relocation-wizard-design-2026-08-23.md §4). Gated to the PLATFORM
// OWNER — the run reveals operational internals (stage structure, gate
// decisions, failure summaries). The page renders state and NOTHING else:
// every decision and action happens in the CLI on the server; there is no
// mutation path here by construction (no actions, no route handlers).
export default async function RelocationPage() {
  await requirePlatformOwner();

  const view = await getRelocationState();

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4">
        <PageHeading>העברת דומיין</PageHeading>
        <AutoRefreshToggle />
      </div>

      {view.kind === 'no-run' ? <NoRunEmptyState /> : null}
      {view.kind === 'unreadable' ? <UnreadableAlert /> : null}
      {view.kind === 'unsupported-version' ? <UnsupportedVersionAlert /> : null}

      {view.kind === 'ok' ? (
        <>
          <RunHeaderCard run={view.run} />
          <OpenGatesPanel gates={view.run.gates} />
          <ProgressPanel run={view.run} />
          <StageTimeline run={view.run} />
          <OpenItemsCard run={view.run} />
          <RollbacksCard run={view.run} />
        </>
      ) : null}
    </div>
  );
}
