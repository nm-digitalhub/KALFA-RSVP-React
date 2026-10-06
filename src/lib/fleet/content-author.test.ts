import { readdirSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { FLEET_AGENT_AVATAR_ROLES, getFleetAgentAvatarSrc } from './agent-avatars';
import { buildCompletionAnswer } from './complete';
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
    expect(splitRequestAnswer('מאושר\n\n[הושלם] פורסם בהצלחה')).toEqual([
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

  it('does not split on [הושלם] in the middle of the owner verdict', () => {
    expect(splitRequestAnswer('כתבת [הושלם] בטעות, תקן')).toEqual([
      { author: 'owner', kind: 'verdict', text: 'כתבת [הושלם] בטעות, תקן' },
    ]);
    // a single newline is not the stamp the `complete` verb writes
    expect(splitRequestAnswer('מאושר\n[הושלם] x')).toEqual([
      { author: 'owner', kind: 'verdict', text: 'מאושר\n[הושלם] x' },
    ]);
  });

  it('matches the exact shape buildCompletionAnswer produces', () => {
    expect(splitRequestAnswer(buildCompletionAnswer('כן', 'פורסם בכל הערוצים'))).toEqual([
      { author: 'owner', kind: 'verdict', text: 'כן' },
      { author: 'agent', kind: 'completion', text: 'פורסם בכל הערוצים' },
    ]);
    expect(splitRequestAnswer(buildCompletionAnswer(null, 'סוכם והועבר'))).toEqual([
      { author: 'agent', kind: 'completion', text: 'סוכם והועבר' },
    ]);
  });

  it('reads [withdraw] as the agent only on an expired row when status is given', () => {
    expect(splitRequestAnswer('[withdraw] לא רלוונטי', 'expired')).toEqual([
      { author: 'agent', kind: 'withdraw', text: 'לא רלוונטי' },
    ]);
    expect(splitRequestAnswer('[withdraw] לא רלוונטי', 'answered')).toEqual([
      { author: 'owner', kind: 'verdict', text: '[withdraw] לא רלוונטי' },
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
    expect(getFleetAgentAvatarSrc('new-role-without-image')).toBeNull();
    expect(getFleetAgentAvatarSrc('../../etc/passwd')).toBeNull();
    expect(getFleetAgentAvatarSrc('constructor')).toBeNull();
    expect(getFleetAgentAvatarSrc('ops-monitor')).toBe('/fleet/avatars/ops-monitor.png');
  });
});
