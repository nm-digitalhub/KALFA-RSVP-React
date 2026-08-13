// Rotate a console agent's Voximplant SDK password and store the fresh secret.
//
// WHY: live login diagnostics showed LoginInvalidPasswordError with a
// formula-correct hash — the stored secret and the platform password drifted
// (the platform never reads a password back, so re-minting the pair is the only
// honest repair). All logic lives in rotateConsoleAgentVoxSecret
// (src/lib/data/console-agent-provisioning.ts); this is the committed runner.
//
// SECURITY: the password is never printed — outcome + username only.
//
// Run (owner):  npm run rotate:console-secret            (single enrolled agent)
//               npm run rotate:console-secret -- --user <uuid>
import { createAdminClient } from '@/lib/supabase/admin';
import { rotateConsoleAgentVoxSecret } from '@/lib/data/console-agent-provisioning';

function argValue(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i !== -1 ? process.argv[i + 1] : undefined;
}

async function main(): Promise<void> {
  let userId = argValue('--user');

  if (!userId) {
    const admin = createAdminClient();
    const { data, error } = await admin
      .from('console_agents')
      .select('user_id, display_name');
    if (error) throw new Error(`listing agents failed: ${error.message}`);
    if (!data || data.length === 0) {
      throw new Error('no console agents enrolled — nothing to rotate');
    }
    if (data.length > 1) {
      throw new Error(
        `multiple agents enrolled (${data.length}) — pass --user <uuid> to pick one`,
      );
    }
    userId = data[0].user_id;
    console.log(`[rotate] targeting the single enrolled agent (${data[0].display_name})`);
  }

  const outcome = await rotateConsoleAgentVoxSecret(userId);
  if (!outcome.ok) {
    throw new Error(`rotation failed: ${outcome.reason}`);
  }
  console.log('[rotate] done', {
    voxUsername: outcome.voxUsername, // never the password
    rotated: true,
  });
}

main().catch((e) => {
  console.error('[rotate] failed:', e instanceof Error ? e.message : 'unknown error');
  process.exit(1);
});
