import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// The campaign run-state gates take their key from the CASL action map (Campaign.runstate), never a literal — the same
// rule casl-pilot-static.test.ts holds the package pilot to (openspec/changes/casl-console-ability-foundation, tasks
// 4.1 and 5.1). Textual: comments may name the key, code may not.

const ROOT = join(__dirname, '..', '..');
const read = (path: string) => readFileSync(join(ROOT, path), 'utf8');
const code = (source: string) =>
  source
    .split('\n')
    .filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line))
    .join('\n');

const KEY_LITERAL = /(['"`])campaigns\.runstate\1/;
const ROUTE = 'src/app/api/campaigns/[id]/status/route.ts';
const DOMAIN = 'src/lib/data/campaigns.ts';

describe('campaign run-state gates decide through the CASL action map', () => {
  for (const file of [ROUTE, DOMAIN]) {
    it(`${file} names no campaigns.runstate literal in code`, () => {
      expect(code(read(file))).not.toMatch(KEY_LITERAL);
    });
  }

  it('the console route gates with requireConsoleAction, after the agent check and before the body is read', () => {
    const source = code(read(ROUTE));
    const agent = source.indexOf('requireConsoleAgent(request)');
    const action = source.indexOf("requireConsoleAction(auth.ctx, 'runstate', 'Campaign')");
    const body = source.indexOf('request.json()');
    expect(agent).toBeGreaterThan(-1);
    expect(action).toBeGreaterThan(agent);
    expect(body).toBeGreaterThan(action);
    expect(source).not.toMatch(/\bcallerHasPlatformPermission\(/);
  });

  it('the web run-state gates use requirePlatformAction, not the DAL key gate', () => {
    const source = code(read(DOMAIN));
    // The admin wind-down session (pause/close) and cancelCampaign.
    expect(source.match(/requirePlatformAction\('runstate', 'Campaign'\)/g)?.length).toBe(2);
  });
});
