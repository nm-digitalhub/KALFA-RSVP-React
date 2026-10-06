import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

// WHY THIS TEST EXISTS.
//
// The bridge scenarios send a correlation variable to ElevenLabs as a dynamic
// variable. It is a CORRELATION CARRIER, not a prompt input: the
// post-call webhook hands it back and `elevenlabs-payloads.ts` reads it as
// `correlationToken` to map the conversation onto our attempt row.
//
// It is deliberately NOT prefixed `secret__`. ElevenLabs' prefix keeps a
// variable out of the model's context, and MEASURED 2026-09-15: no agent config
// interpolates this variable anywhere — not in a prompt, not in a first
// message, not in a tool schema — so it never reaches the model in the first
// place. Renaming it would have changed the key the webhook parser reads, for
// no exposure that exists today.
//
// That safety is a property of the CONFIGS, not of the name. The moment someone
// writes {{kalfa_correlation_id}} into a prompt to "let the agent mention the
// reference number", the value starts being sent to the LLM provider on every
// call. This test is the guard: if that happens, either drop the reference or
// switch the variable to `secret__` AND update the webhook parser to match.
//
// ⚠️ ALL THREE SPELLINGS ARE GUARDED, NOT JUST THE CURRENT ONE. The unification
// onto `kalfa_correlation_id` leaves the two old names in flight until every
// scenario is redeployed, and a config written against either of them would
// expose the value just the same. The list shrinks when they are removed from
// the ctx routes — not before.
const CORRELATION_VARIABLES = [
  'kalfa_correlation_id',
  'kalfa_attempt_token',
  'kalfa_attempt_id',
] as const;

function agentConfigFiles(): string[] {
  const dir = join(process.cwd(), 'agent_configs');
  return readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .map((f) => join(dir, f));
}

describe('agent configs — the correlation token stays out of the model', () => {
  it('finds agent configs to check', () => {
    expect(agentConfigFiles().length).toBeGreaterThan(0);
  });

  it.each(agentConfigFiles())('%s never interpolates the correlation token', (file) => {
    const raw = readFileSync(file, 'utf8');
    for (const variable of CORRELATION_VARIABLES) {
      expect(raw, `${file} interpolates ${variable}`).not.toContain(variable);
    }
  });
});
