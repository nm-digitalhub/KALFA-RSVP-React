import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

const { keyMock } = vi.hoisted(() => ({ keyMock: vi.fn() }));
vi.mock('@/lib/data/elevenlabs-status', () => ({ getElevenLabsApiKey: keyMock }));

import { allowedOverrides, __clearOverridePolicyCache } from './override-policy';

function respondWith(body: unknown, ok = true) {
  return vi.fn().mockResolvedValue({
    ok,
    json: async () => body,
  });
}

const AGENT = 'agent_abc';
const PROBE = { first_message: 'שלום' };

beforeEach(() => {
  vi.clearAllMocks();
  __clearOverridePolicyCache();
  keyMock.mockResolvedValue('xi-key');
});

describe('allowedOverrides — A-13 as a system rule', () => {
  it('sends the override when the agent has that flag on', async () => {
    vi.stubGlobal(
      'fetch',
      respondWith({
        platform_settings: {
          overrides: { conversation_config_override: { agent: { first_message: true } } },
        },
      }),
    );
    await expect(allowedOverrides(AGENT, PROBE)).resolves.toEqual(PROBE);
  });

  it('OMITS the override when the flag is off — the case the UI cannot catch', async () => {
    // A diagram saved while the flag was on, an imported workflow, a row edited
    // by hand: all of them arrive here with a value the editor would no longer
    // offer. Hiding the field in the panel does nothing for any of them.
    vi.stubGlobal(
      'fetch',
      respondWith({
        platform_settings: {
          overrides: { conversation_config_override: { agent: { first_message: false } } },
        },
      }),
    );
    await expect(allowedOverrides(AGENT, PROBE)).resolves.toEqual({});
  });

  it('treats a missing overrides block as permission denied', async () => {
    vi.stubGlobal('fetch', respondWith({}));
    await expect(allowedOverrides(AGENT, PROBE)).resolves.toEqual({});
  });

  it('refuses a non-boolean true — a string "false" must never read as permission', async () => {
    vi.stubGlobal(
      'fetch',
      respondWith({
        platform_settings: {
          overrides: { conversation_config_override: { agent: { first_message: 'false' } } },
        },
      }),
    );
    await expect(allowedOverrides(AGENT, PROBE)).resolves.toEqual({});
  });

  it('FAILS CLOSED on every way the check itself can fail', async () => {
    // ⚠️ THE LOAD-BEARING TEST. ElevenLabs documents that for most fields "an
    // error will be thrown if an override is provided when that field does not
    // have overrides enabled" — so an unproven override can FAIL a call that has
    // already rung. Omitting can only ever make the agent use its own value.
    for (const failure of [
      () => vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('timeout'))),
      () => vi.stubGlobal('fetch', respondWith({}, false)),
      () => {
        keyMock.mockResolvedValue(null);
        vi.stubGlobal('fetch', vi.fn());
      },
    ]) {
      __clearOverridePolicyCache();
      keyMock.mockResolvedValue('xi-key');
      failure();
      await expect(allowedOverrides(AGENT, PROBE)).resolves.toEqual({});
    }
  });

  it('drops the override when no agent can be named', async () => {
    // The state every deployed scenario is in today: each hardcodes its own
    // AGENT_ID, so this server cannot say which agent will answer — and an
    // override cannot be checked against an agent it cannot name.
    const f = vi.fn();
    vi.stubGlobal('fetch', f);
    await expect(allowedOverrides('', PROBE)).resolves.toEqual({});
    await expect(allowedOverrides(null, PROBE)).resolves.toEqual({});
    expect(f).not.toHaveBeenCalled();
  });

  it('never calls out for an empty candidate set', async () => {
    const f = vi.fn();
    vi.stubGlobal('fetch', f);
    await expect(allowedOverrides(AGENT, {})).resolves.toEqual({});
    await expect(allowedOverrides(AGENT, { first_message: '   ' })).resolves.toEqual({});
    expect(f).not.toHaveBeenCalled();
  });

  it('passes each field independently — one allowed does not carry the others', async () => {
    vi.stubGlobal(
      'fetch',
      respondWith({
        platform_settings: {
          overrides: {
            conversation_config_override: {
              agent: { first_message: true, language: false, prompt: { prompt: false } },
            },
          },
        },
      }),
    );
    await expect(
      allowedOverrides(AGENT, { first_message: 'שלום', language: 'he', prompt: 'p' }),
    ).resolves.toEqual({ first_message: 'שלום' });
  });

  it('accepts the nested prompt spelling the config actually uses', async () => {
    vi.stubGlobal(
      'fetch',
      respondWith({
        platform_settings: {
          overrides: { conversation_config_override: { agent: { prompt: { prompt: true } } } },
        },
      }),
    );
    await expect(allowedOverrides(AGENT, { prompt: 'p' })).resolves.toEqual({ prompt: 'p' });
  });

  it('caches, so a burst of calls to one agent costs one lookup', async () => {
    // This sits on the DIAL PATH — the scenario fetches ctx and only then places
    // the call, so an uncached read is silence before the phone rings.
    const f = respondWith({
      platform_settings: {
        overrides: { conversation_config_override: { agent: { first_message: true } } },
      },
    });
    vi.stubGlobal('fetch', f);
    await allowedOverrides(AGENT, PROBE);
    await allowedOverrides(AGENT, PROBE);
    await allowedOverrides(AGENT, PROBE);
    expect(f).toHaveBeenCalledTimes(1);
  });
});
