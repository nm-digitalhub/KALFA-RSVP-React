import { describe, expect, it, vi, beforeEach } from 'vitest';

// The module under test is server-only and reaches the admin client at module
// scope through its imports; the two pure helpers exercised here do not.
vi.mock('server-only', () => ({}));
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: vi.fn() }));
vi.mock('@/lib/data/voximplant-config', () => ({ getVoximplantConfig: vi.fn() }));
vi.mock('@/lib/voximplant/mutations', async (orig) => {
  const actual = await orig<typeof import('@/lib/voximplant/mutations')>();
  return {
    ...actual,
    delVoximplantUser: vi.fn(),
    addVoximplantUser: vi.fn(),
    setVoximplantUserActive: vi.fn(),
  };
});

import {
  generateVoxPassword,
  voxUserNameFor,
  deprovisionConsoleAgentVoxUser,
  provisionConsoleAgentVoxUser,
  setConsoleAgentVoxActive,
} from '@/lib/data/console-agent-provisioning';
import {
  VOX_USER_NAME_PATTERN,
  delVoximplantUser,
  addVoximplantUser,
  setVoximplantUserActive,
} from '@/lib/voximplant/mutations';
import { createAdminClient } from '@/lib/supabase/admin';
import { getVoximplantConfig } from '@/lib/data/voximplant-config';

// These two pure functions decide whether provisioning can succeed AT ALL: a
// username or password Voximplant rejects fails the AddUser call, and a failed
// AddUser mid-provisioning is the case that leaves an agent half-created. Both
// rules are the API's own, quoted in the source they guard.

const UUID = '1bbe74dc-5721-48e9-9092-fd9e3c6e6b21';

describe('voxUserNameFor', () => {
  it('produces a name Voximplant accepts', () => {
    const name = voxUserNameFor(UUID);
    expect(name).toBe(`agent_${UUID}`);
    // [a-z0-9][a-z0-9_-]{2,49} — hyphens ARE legal, which is why the uuid can be
    // used verbatim rather than stripped.
    expect(VOX_USER_NAME_PATTERN.test(name)).toBe(true);
    expect(name.length).toBeLessThanOrEqual(50);
  });

  it('lowercases, since the pattern has no uppercase class', () => {
    const name = voxUserNameFor(UUID.toUpperCase());
    expect(name).toBe(name.toLowerCase());
    expect(VOX_USER_NAME_PATTERN.test(name)).toBe(true);
  });
});

describe('generateVoxPassword', () => {
  // "at least 8 characters long and contain at least one uppercase and lowercase
  // letter, one number, and one special character" — verbatim from the method
  // tree. Built by construction, so this asserts the construction holds.
  const RULES: Array<[string, RegExp]> = [
    ['lowercase', /[a-z]/],
    ['uppercase', /[A-Z]/],
    ['digit', /[0-9]/],
    ['special', /[^A-Za-z0-9]/],
  ];

  it('satisfies every class on every draw', () => {
    for (let i = 0; i < 200; i++) {
      const pw = generateVoxPassword();
      expect(pw).toHaveLength(24);
      for (const [label, re] of RULES) {
        expect(re.test(pw), `draw ${i} has no ${label}: ${pw}`).toBe(true);
      }
    }
  });

  it('is not deterministic', () => {
    const seen = new Set(Array.from({ length: 50 }, () => generateVoxPassword()));
    expect(seen.size).toBe(50);
  });

  it('does not park the required classes in fixed positions', () => {
    // The shuffle matters: without it the first four characters would always be
    // lower/upper/digit/special, which is a pattern an attacker can exploit.
    const firsts = new Set(
      Array.from({ length: 100 }, () => generateVoxPassword()[0]),
    );
    expect(firsts.size).toBeGreaterThan(4);
  });
});

// The 157 code (live-verified: voximplant.com/api/v2/getDoc?fqdn=references.
// httpapi.errors, "The 'user_display_name' parameter is invalid") must reach
// the caller so it can attribute the failure to the displayName field
// specifically — a bare 'api_failed' can't say WHICH field was wrong.
describe('provisionConsoleAgentVoxUser — AddUser error code surfacing', () => {
  let consoleAgentsUpdate: ReturnType<typeof vi.fn>;
  let consoleAgentsUpsert: ReturnType<typeof vi.fn>;
  let secretsUpsert: ReturnType<typeof vi.fn>;

  function adminClientMock() {
    consoleAgentsUpdate = vi.fn((patch: Record<string, unknown>) => ({
      eq: async () => ({ error: null }),
      __patch: patch,
    }));
    consoleAgentsUpsert = vi.fn(() => ({ error: null }));
    secretsUpsert = vi.fn(() => ({ error: null }));
    return {
      from: (table: string) => {
        if (table === 'app_settings') {
          return {
            select: () => ({
              eq: () => ({
                maybeSingle: async () => ({
                  data: { voximplant_application_id: '11107202' },
                  error: null,
                }),
              }),
            }),
          };
        }
        if (table === 'console_agent_secrets') {
          return {
            select: () => ({
              eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }),
            }),
            upsert: secretsUpsert,
          };
        }
        // console_agents: no existing row (fresh provisioning), and the
        // write calls just succeed.
        return {
          select: () => ({
            eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }),
          }),
          upsert: consoleAgentsUpsert,
          update: consoleAgentsUpdate,
        };
      },
    };
  }

  beforeEach(() => {
    vi.clearAllMocks();
    (createAdminClient as unknown as ReturnType<typeof vi.fn>).mockReturnValue(
      adminClientMock(),
    );
    (getVoximplantConfig as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      auth: { accountId: 1, keyId: 'k', privateKey: 'p' },
    });
  });

  // OWNER DIRECTIVE: Voximplant must succeed BEFORE any local grant exists —
  // an AddUser failure must leave console_agents and console_agent_secrets
  // completely untouched, not a partial row.
  it('surfaces voxErrorCode 157 on a structured display-name rejection, and grants nothing locally', async () => {
    (addVoximplantUser as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      error: { code: 157, msg: 'invalid' },
    });
    const r = await provisionConsoleAgentVoxUser(UUID, 'שם תצוגה');
    expect(r).toEqual({ ok: false, reason: 'api_failed', voxErrorCode: 157 });
    expect(consoleAgentsUpsert).not.toHaveBeenCalled();
    expect(secretsUpsert).not.toHaveBeenCalled();
    expect(consoleAgentsUpdate).not.toHaveBeenCalled();
  });

  it('omits voxErrorCode when AddUser throws (no structured code available), and grants nothing locally', async () => {
    (addVoximplantUser as unknown as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error('network blip'),
    );
    const r = await provisionConsoleAgentVoxUser(UUID, 'שם תצוגה');
    expect(r).toEqual({ ok: false, reason: 'api_failed' });
    expect(consoleAgentsUpsert).not.toHaveBeenCalled();
    expect(secretsUpsert).not.toHaveBeenCalled();
  });

  it('stores the vox_user_id AddUser returns, alongside vox_username — row, then secret, then username', async () => {
    (addVoximplantUser as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      result: 1,
      user_id: 11184450,
    });
    const r = await provisionConsoleAgentVoxUser(UUID, 'שם תצוגה');
    expect(r.ok).toBe(true);
    // Voximplant succeeded — ONLY now is the local grant row created.
    expect(consoleAgentsUpsert).toHaveBeenCalledWith(
      { user_id: UUID, display_name: 'שם תצוגה' },
      { onConflict: 'user_id' },
    );
    expect(secretsUpsert).toHaveBeenCalled();
    expect(consoleAgentsUpdate).toHaveBeenCalledWith({
      vox_username: voxUserNameFor(UUID),
      vox_user_id: 11184450,
    });
  });

  it('stores null vox_user_id when AddUser response carries none', async () => {
    (addVoximplantUser as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({ result: 1 });
    await provisionConsoleAgentVoxUser(UUID, 'שם תצוגה');
    expect(consoleAgentsUpdate).toHaveBeenCalledWith({
      vox_username: voxUserNameFor(UUID),
      vox_user_id: null,
    });
  });

  it('threads the (לא חובה) parentAccounting/userCustomData opts into AddUser', async () => {
    (addVoximplantUser as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      result: 1,
      user_id: 1,
    });
    await provisionConsoleAgentVoxUser(UUID, 'שם תצוגה', {
      parentAccounting: true,
      userCustomData: 'note',
    });
    expect(addVoximplantUser).toHaveBeenCalledWith(
      { accountId: 1, keyId: 'k', privateKey: 'p' },
      11107202,
      voxUserNameFor(UUID),
      expect.any(String),
      'שם תצוגה',
      { parentAccounting: true, userCustomData: 'note' },
    );
  });
});

// The cleanup removeConsoleAgent needs: without it, the DETERMINISTIC
// vox_username (agent_<user_id>) survives orphaned on Voximplant after a
// local removal, and every future re-enrollment of the same person fails —
// the exact incident this function was written to close.
describe('deprovisionConsoleAgentVoxUser', () => {
  const adminClientMock = {
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({
            data: { voximplant_application_id: '11107202' },
            error: null,
          }),
        }),
      }),
    }),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    (createAdminClient as unknown as ReturnType<typeof vi.fn>).mockReturnValue(adminClientMock);
    (getVoximplantConfig as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      auth: { accountId: 1, keyId: 'k', privateKey: 'p' },
    });
  });

  it('deletes the Voximplant user by NAME (no opts) when no voxUserId is known', async () => {
    (delVoximplantUser as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({ result: 1 });
    const r = await deprovisionConsoleAgentVoxUser('agent_abc');
    expect(r).toEqual({ ok: true });
    expect(delVoximplantUser).toHaveBeenCalledWith(
      { accountId: 1, keyId: 'k', privateKey: 'p' },
      11107202,
      'agent_abc',
      undefined,
    );
  });

  it('prefers the numeric voxUserId over the name when it is known', async () => {
    (delVoximplantUser as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({ result: 1 });
    const r = await deprovisionConsoleAgentVoxUser('agent_abc', 11184450);
    expect(r).toEqual({ ok: true });
    expect(delVoximplantUser).toHaveBeenCalledWith(
      { accountId: 1, keyId: 'k', privateKey: 'p' },
      11107202,
      'agent_abc',
      { userId: 11184450 },
    );
  });

  it('reports not_configured when there is no application id', async () => {
    (getVoximplantConfig as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    const r = await deprovisionConsoleAgentVoxUser('agent_abc');
    expect(r).toEqual({ ok: false, reason: 'not_configured' });
    expect(delVoximplantUser).not.toHaveBeenCalled();
  });

  it('reports api_failed on a structured DelUser error', async () => {
    (delVoximplantUser as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      error: { code: 401, msg: 'not found' },
    });
    const r = await deprovisionConsoleAgentVoxUser('agent_abc');
    expect(r).toEqual({ ok: false, reason: 'api_failed' });
  });

  it('reports api_failed (never throws) when DelUser itself throws', async () => {
    (delVoximplantUser as unknown as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error('network blip'),
    );
    const r = await deprovisionConsoleAgentVoxUser('agent_abc');
    expect(r).toEqual({ ok: false, reason: 'api_failed' });
  });
});

// OWNER DIRECTIVE (repeated, emphatic): a block/unblock must genuinely depend
// on Voximplant — SetUserInfo(user_active) is load-bearing, not a mirror of a
// decision already made locally. The local vox_active flag (what
// is_console_agent() actually checks) may be written ONLY after Voximplant
// confirms the change; a provider failure must leave local state untouched.
describe('setConsoleAgentVoxActive — block/unblock', () => {
  let consoleAgentsUpdate: ReturnType<typeof vi.fn>;

  function adminClientMock(voxUsername: string | null) {
    consoleAgentsUpdate = vi.fn(() => ({ eq: async () => ({ error: null }) }));
    return {
      from: (table: string) => {
        if (table === 'app_settings') {
          return {
            select: () => ({
              eq: () => ({
                maybeSingle: async () => ({
                  data: { voximplant_application_id: '11107202' },
                  error: null,
                }),
              }),
            }),
          };
        }
        return {
          select: () => ({
            eq: () => ({ maybeSingle: async () => ({ data: { vox_username: voxUsername }, error: null }) }),
          }),
          update: consoleAgentsUpdate,
        };
      },
    };
  }

  beforeEach(() => {
    vi.clearAllMocks();
    (getVoximplantConfig as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      auth: { accountId: 1, keyId: 'k', privateKey: 'p' },
    });
  });

  it('reports not_provisioned — and never calls Voximplant — when the agent has no vox_username', async () => {
    (createAdminClient as unknown as ReturnType<typeof vi.fn>).mockReturnValue(
      adminClientMock(null),
    );
    const r = await setConsoleAgentVoxActive('u-2', false);
    expect(r).toEqual({ ok: false, reason: 'not_provisioned' });
    expect(setVoximplantUserActive).not.toHaveBeenCalled();
  });

  it('calls Voximplant FIRST, and writes the local flag only on success', async () => {
    (createAdminClient as unknown as ReturnType<typeof vi.fn>).mockReturnValue(
      adminClientMock('agent_u-2'),
    );
    (setVoximplantUserActive as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      result: 1,
    });
    const r = await setConsoleAgentVoxActive('u-2', false);
    expect(r).toEqual({ ok: true });
    expect(setVoximplantUserActive).toHaveBeenCalledWith(
      { accountId: 1, keyId: 'k', privateKey: 'p' },
      11107202,
      'agent_u-2',
      false,
    );
    expect(consoleAgentsUpdate).toHaveBeenCalledWith({ vox_active: false });
  });

  it('a structured Voximplant failure leaves the local flag untouched', async () => {
    (createAdminClient as unknown as ReturnType<typeof vi.fn>).mockReturnValue(
      adminClientMock('agent_u-2'),
    );
    (setVoximplantUserActive as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      error: { code: 401, msg: 'not found' },
    });
    const r = await setConsoleAgentVoxActive('u-2', true);
    expect(r).toEqual({ ok: false, reason: 'api_failed' });
    expect(consoleAgentsUpdate).not.toHaveBeenCalled();
  });

  it('a thrown Voximplant call (never a throw out of this function) leaves the local flag untouched', async () => {
    (createAdminClient as unknown as ReturnType<typeof vi.fn>).mockReturnValue(
      adminClientMock('agent_u-2'),
    );
    (setVoximplantUserActive as unknown as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error('network blip'),
    );
    const r = await setConsoleAgentVoxActive('u-2', true);
    expect(r).toEqual({ ok: false, reason: 'api_failed' });
    expect(consoleAgentsUpdate).not.toHaveBeenCalled();
  });
});
