import { readdirSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { FLEET_AGENT_AVATAR_ROLES, getFleetAgentAvatarSrc } from './agent-avatars';
import { requestBodyAuthor, splitRequestAnswer } from './content-author';

describe('requestBodyAuthor', () => {
  it('is the owner only when payload.origin is owner', () => {
    expect(requestBodyAuthor({ origin: 'owner' })).toBe('owner');
    expect(requestBodyAuthor({ origin: 'agent' })).toBe('agent');
    expect(requestBodyAuthor({ thread_root: 'x' })).toBe('agent');
    expect(requestBodyAuthor(null)).toBe('agent');
    expect(requestBodyAuthor(['owner'])).toBe('agent');
  });
});

describe('splitRequestAnswer', () => {
  it('treats a plain answer as the owner verdict', () => {
    expect(splitRequestAnswer('כן, לאשר')).toEqual([
      { author: 'owner', kind: 'verdict', text: 'כן, לאשר' },
    ]);
  });

  it('splits an owner verdict from the agent completion summary', () => {
    expect(splitRequestAnswer('מאושר\n[הושלם] פורסם בהצלחה')).toEqual([
      { author: 'owner', kind: 'verdict', text: 'מאושר' },
      { author: 'agent', kind: 'completion', text: 'פורסם בהצלחה' },
    ]);
  });

  it('attributes a completion with no verdict to the agent only', () => {
    expect(splitRequestAnswer('[הושלם] עוצב ב-Claude Design')).toEqual([
      { author: 'agent', kind: 'completion', text: 'עוצב ב-Claude Design' },
    ]);
  });

  it('attributes a withdraw note to the agent', () => {
    expect(splitRequestAnswer('[withdraw] כבר לא רלוונטי')).toEqual([
      { author: 'agent', kind: 'withdraw', text: 'כבר לא רלוונטי' },
    ]);
  });

  it('returns nothing for an empty answer', () => {
    expect(splitRequestAnswer(null)).toEqual([]);
    expect(splitRequestAnswer('  ')).toEqual([]);
  });
});

describe('fleet agent avatars', () => {
  it('maps every image in public/fleet/avatars and nothing else', () => {
    const dir = join(import.meta.dirname, '../../../public/fleet/avatars');
    const files = readdirSync(dir).filter((f) => f.endsWith('.png')).map((f) => f.slice(0, -4));
    expect([...FLEET_AGENT_AVATAR_ROLES].sort()).toEqual(files.sort());
  });

  it('returns null for a role without an image or an unsafe value', () => {
    expect(getFleetAgentAvatarSrc('smoke-test')).toBeNull();
    expect(getFleetAgentAvatarSrc('../../etc/passwd')).toBeNull();
    expect(getFleetAgentAvatarSrc('constructor')).toBeNull();
    expect(getFleetAgentAvatarSrc('ops-monitor')).toBe('/fleet/avatars/ops-monitor.png');
  });
});
