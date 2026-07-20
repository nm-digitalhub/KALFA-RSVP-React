import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// elevenlabs-drift.ts begins with `import 'server-only'` — stub it. The functions
// under test are pure (no IO), so nothing else needs mocking.
vi.mock('server-only', () => ({}));

import { canonicalizeAgent, compareAgentCanonical } from './elevenlabs-drift';

// The on-disk IaC shape: `end_call` lives under built_in_tools; tool_ids in the
// file's own order.
const fileConfig = {
  name: 'KALFA RSVP Preview',
  conversation_config: {
    agent: {
      language: 'he',
      first_message: 'שלום',
      prompt: {
        prompt: 'PROMPT TEXT',
        llm: 'gemini-2.5-flash',
        temperature: 0.5,
        tool_ids: ['tool_c', 'tool_a', 'tool_b'],
        built_in_tools: { end_call: { name: 'end_call' } },
      },
    },
    tts: { voice_id: 'voice_x', model_id: 'model_y' },
  },
};

// The SAME agent as the live API returns it: end_call flattened into tools[],
// tool_ids reordered, and extra live-only top-level keys present.
const liveConfig = {
  agent_id: 'agent_123',
  version_id: 'agtvrsn_x',
  metadata: { created_at_unix: 1 },
  phone_numbers: [],
  whatsapp_accounts: [],
  access_info: {},
  name: 'KALFA RSVP Preview',
  conversation_config: {
    agent: {
      language: 'he',
      first_message: 'שלום',
      prompt: {
        prompt: 'PROMPT TEXT',
        llm: 'gemini-2.5-flash',
        temperature: 0.5,
        tool_ids: ['tool_a', 'tool_b', 'tool_c'],
        tools: [{ name: 'tool_a' }, { name: 'tool_b' }, { name: 'tool_c' }, { name: 'end_call' }],
      },
    },
    tts: { voice_id: 'voice_x', model_id: 'model_y' },
  },
};

describe('drift: canonicalizeAgent + compareAgentCanonical (false-positive-proof)', () => {
  it('reports IN SYNC despite server normalization (end_call flattening, tool_ids order, live-only keys)', () => {
    const drift = compareAgentCanonical(canonicalizeAgent(liveConfig), canonicalizeAgent(fileConfig));
    expect(drift).toEqual({ inSync: true, changedFields: [] });
  });

  it('detects a REAL drift and names the field, never the value', () => {
    const drifted = {
      ...liveConfig,
      conversation_config: {
        ...liveConfig.conversation_config,
        tts: { voice_id: 'voice_CHANGED', model_id: 'model_y' },
      },
    };
    const drift = compareAgentCanonical(canonicalizeAgent(drifted), canonicalizeAgent(fileConfig));
    expect(drift.inSync).toBe(false);
    expect(drift.changedFields).toEqual(['voiceId']);
    expect(JSON.stringify(drift)).not.toContain('voice_CHANGED');
  });

  it('flags a prompt change by name only (content never surfaced)', () => {
    const a = canonicalizeAgent({ conversation_config: { agent: { prompt: { prompt: 'SECRET NEW PROMPT' } } } });
    const b = canonicalizeAgent({ conversation_config: { agent: { prompt: { prompt: 'old' } } } });
    const drift = compareAgentCanonical(a, b);
    expect(drift.changedFields).toContain('prompt');
    expect(JSON.stringify(drift)).not.toContain('SECRET NEW PROMPT');
  });

  it('canonicalizes the real shipped agent_configs file (end_call excluded from tool_ids)', () => {
    const cfg = JSON.parse(
      readFileSync(join(process.cwd(), 'agent_configs/KALFA-RSVP.json'), 'utf8'),
    );
    const c = canonicalizeAgent(cfg);
    expect(c.name).toBeTruthy();
    expect(c.prompt).toBeTruthy();
    expect(c.language).toBe('he');
    // 3 client tools; the built-in end_call carries no tool_id, so it is excluded.
    expect(c.toolIds).toHaveLength(4);
  });

  it('degrades garbage to nulls / empty (total, IO-free)', () => {
    expect(canonicalizeAgent(null)).toEqual({
      name: null,
      language: null,
      firstMessage: null,
      prompt: null,
      llm: null,
      temperature: null,
      voiceId: null,
      modelId: null,
      toolIds: [],
    });
    expect(canonicalizeAgent('garbage').toolIds).toEqual([]);
  });
});
