// setupFiles entry of vitest.integration.config.mts: runs in every worker BEFORE the
// test file is imported, so even connections opened at module load are guarded.
// Any blocked attempt fails the test during which it happened.
import { afterEach } from 'vitest';

import { installNetworkGuard, LOCAL_PORTS } from './local-integration';

const guard = installNetworkGuard(LOCAL_PORTS);

afterEach(() => {
  const blocked = guard.drain();
  if (blocked.length > 0) throw new Error(`network guard blocked outbound traffic: ${blocked.join(', ')}`);
});
