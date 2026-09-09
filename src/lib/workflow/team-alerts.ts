import 'server-only';

// The live `TeamAlertsPort`, and the reason this file exists at all.
//
// `@/lib/alerts/slack` is server-only: it reads a file from disk, builds a
// Supabase admin client, and holds the bot token. A step handler that imported
// it dragged all three into the module the WORKER bundles and every engine test
// imports — the suite failed at import with "This module cannot be imported from
// a Client Component module" before a single test ran. So the handler names the
// capability and this module supplies it, exactly as `guest-actions.ts` does for
// the guest operations.
import { sendSlackAlert } from '@/lib/alerts/slack';

import type { TeamAlertsPort } from './engine/ports';

export function createTeamAlerts(): TeamAlertsPort {
  return {
    async notifyTeam({ level, title, detail }) {
      // `source: 'workflow'` is what separates these in the channel from the
      // engine's own `workflow run failed` alerts: this one was ASKED for by an
      // owner's diagram, the other is the platform reporting a fault.
      //
      // `category: 'errors'` is the category an operator already keeps on. A
      // workflow alert that landed in a category nobody enabled would be a node
      // that silently does nothing — worse than not having it.
      const ts = await sendSlackAlert({
        level,
        title,
        detail,
        source: 'workflow',
        category: 'errors',
      });
      // `sendSlackAlert` never throws — it is fail-safe by construction — and
      // returns null for every ordinary suppression. Both collapse to the same
      // honest answer: nothing reached the channel.
      return { sent: ts !== null };
    },
  };
}
