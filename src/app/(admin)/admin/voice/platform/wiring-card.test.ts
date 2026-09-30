import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

// The client components below rely on their Server Action's revalidatePath to
// re-render the page in the same response (next/cache revalidatePath: "Server
// Functions: Updates the UI immediately (if viewing the affected path)"). They
// no longer call router.refresh(), so the revalidatePath on the page's own path
// is what keeps the UI current — dropping it would leave a stale screen.
function read(path: string): string {
  return readFileSync(join(process.cwd(), path), 'utf8');
}

function actionBody(source: string, name: string): string {
  const start = source.indexOf(`export async function ${name}(`);
  expect(start, `expected to find ${name}`).toBeGreaterThanOrEqual(0);
  const next = source.indexOf('\nexport ', start + 1);
  return source.slice(start, next === -1 ? undefined : next);
}

describe('server-action revalidation replaces client router.refresh()', () => {
  it('voice wiring: both actions revalidate /admin/voice/platform, the client does not refresh', () => {
    const actions = read('src/app/(admin)/admin/voice/actions.ts');
    for (const name of ['wireAccountCallbackAction', 'rollbackAccountCallbackAction']) {
      expect(actionBody(actions, name)).toContain("revalidatePath('/admin/voice/platform')");
    }

    const client = read('src/app/(admin)/admin/voice/platform/wiring-card.tsx');
    expect(client).not.toMatch(/^\s*router\.refresh\(\);/m);
    expect(client).not.toContain('useRouter');
  });

  it('org roles reset: the action revalidates the roles page, the client does not refresh', () => {
    const actions = read('src/app/(customer)/app/team/roles/actions.ts');
    expect(actions).toContain("const ROLES_PATH = '/app/team/roles';");
    expect(actionBody(actions, 'resetOrgRolePermissionsAction')).toContain(
      'revalidatePath(ROLES_PATH)',
    );

    const client = read('src/app/(customer)/app/team/roles/org-roles-client.tsx');
    expect(client).not.toMatch(/^\s*router\.refresh\(\);/m);
    expect(client).not.toContain('useRouter');
  });
});
