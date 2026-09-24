import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

// Regression guard, not a unit test of behavior: proves every admin-only
// data-layer function gates on requireAdmin() BEFORE touching data, so a
// future function that forgets the check fails CI loudly instead of shipping
// a silent authorization gap (found one real instance of this: see
// resolveWebhookAssociations in webhook-inbox.ts, fixed alongside this test).
//
// Approach: split each target file on top-level `export async function`
// boundaries and grep each resulting block for `requireAdmin`. This is a
// textual check, not a real call-graph analysis -- it cannot prove
// requireAdmin() runs before the FIRST data access, only that the function
// references it somewhere in its body. That is enough to catch the class of
// bug this guards against (a function that never calls it at all) while
// staying simple enough not to become its own maintenance burden.

const ROOT = join(__dirname, '..', '..', '..');

// Functions intentionally NOT gated, with the reason a reviewer needs to accept
// before adding an entry here. Every other exported async function in these
// files MUST call one of GATES.
//
// ⚠️ This map is NOT the list of files that get checked. It used to be: the
// suite looped over its keys, so a module absent from it was never scanned and
// "green" on a new file meant nothing was looked at. Measured 2026-09-10: 36
// modules under src/lib/data/admin/, 15 in this map. The scan is now driven by
// readdir (see MODULES below) and this map only records EXEMPTIONS.
const EXEMPT: Record<string, string[]> = {
  'src/lib/data/admin/activity.ts': [],
  'src/lib/data/admin/agreements.ts': [],
  'src/lib/data/admin/callbacks.ts': [],
  'src/lib/data/admin/channels.ts': [],
  'src/lib/data/admin/contacts.ts': [],
  'src/lib/data/admin/dashboard.ts': [],
  'src/lib/data/admin/event-view.ts': [],
  'src/lib/data/admin/events.ts': [],
  'src/lib/data/admin/packages.ts': [],
  'src/lib/data/admin/settings.ts': [],
  'src/lib/data/admin/users.ts': [],
  'src/lib/data/admin/webhook-inbox.ts': [],
  'src/lib/data/admin/access-log-view.ts': [],
  // message-templates.ts is now ONLY the admin surface (listMessageTemplates/
  // updateMessageTemplate, the actual /admin/templates entry points) — both
  // gated, so NO exemptions remain here.
  'src/lib/data/message-templates.ts': [],
  // getTemplateByKey and resolveTemplateForEvent (the event-type-aware variant
  // resolver layered on the same active-only query) are the campaign outreach
  // engine's internal template readers (service-role, read-only, active-only),
  // also used by the worker -- not admin-facing entry points. They live in their
  // own request-free module so the worker can import them WITHOUT pulling the
  // admin surface's requireAdmin/request-scoped createClient into its bundle.
  'src/lib/data/message-templates-resolve.ts': ['getTemplateByKey', 'resolveTemplateForEvent'],
};

function splitIntoFunctionBlocks(source: string): { name: string; body: string }[] {
  const marker = /^export async function (\w+)\(/gm;
  const starts: { name: string; index: number }[] = [];
  let m: RegExpExecArray | null;
  while ((m = marker.exec(source))) {
    starts.push({ name: m[1], index: m.index });
  }
  return starts.map((s, i) => ({
    name: s.name,
    body: source.slice(s.index, starts[i + 1]?.index ?? source.length),
  }));
}

// The gates a data-layer function may use. `requirePlatformStaff` is the floor
// ("is this person staff at all"); `requirePlatformPermission` is the
// fine-grained capability from the /admin/roles matrix; `requirePlatformOwner`
// is owner-only. `requireAdmin` is the RETIRED axis — still listed so a module
// that has not been migrated is reported as coarse rather than as ungated, but
// nothing under src/lib/data/admin uses it any more (checked below).
const GATES = [
  'requireAdmin',
  'requirePlatformStaff',
  'requirePlatformOwner',
  'requirePlatformPermission',
] as const;

// The permission each module is expected to enforce. Pinning this (rather than
// only "some gate exists") is what makes a SILENT downgrade fail CI: swapping a
// module from `manage_staff` to `view_activity_log`, or back to a bare
// requireAdmin, now breaks the build instead of quietly widening access.
// A module absent from this map must appear in COARSE_GATE_ALLOWED below, with
// a reason — there is no third state. That is what makes a new module fail
// closed instead of slipping through unexamined.
const EXPECTED_PERMISSION: Record<string, string | string[]> = {
  'src/lib/data/admin/activity.ts': 'view_activity_log',
  'src/lib/data/admin/agreements.ts': 'manage_settings',
  'src/lib/data/admin/callbacks.ts': 'view_customer_data',
  'src/lib/data/admin/channels.ts': 'manage_settings',
  'src/lib/data/admin/contacts.ts': 'view_customer_data',
  // Two SEPARATE modules on purpose, one key each — the split the owner asked
  // for on 2026-09-07. event-view.ts answers 'which event is this' and may
  // never grow a billing field; events.ts moves a live event's date and may
  // never become the way to read one. Pinning both here is what stops either
  // from quietly absorbing the other's authority.
  'src/lib/data/admin/event-view.ts': 'view_events',
  'src/lib/data/admin/events.ts': 'manage_billing',
  'src/lib/data/admin/packages.ts': 'manage_billing',
  'src/lib/data/admin/settings.ts': 'manage_settings',
  'src/lib/data/admin/users.ts': 'manage_staff',
  'src/lib/data/admin/webhook-inbox.ts': 'view_webhooks',
  'src/lib/data/admin/access-log-view.ts': 'manage_staff',
  // The live ElevenLabs agent list, for the call node's picker. Same key as
  // every other voice reader: naming the agents an account owns is the same
  // authority as naming its rules.
  'src/lib/data/admin/elevenlabs-agents.ts': 'manage_voice',
  // Pinned 2026-09-10. All of these already enforced a permission; none was
  // recorded here, so a silent downgrade to bare requireAdmin() would have gone
  // unnoticed — which is exactly what happened to workflows.ts.
  'src/lib/data/admin/alerts.ts': 'manage_settings',
  'src/lib/data/admin/channel-catalog.ts': 'manage_settings',
  'src/lib/data/admin/cookie-consent.ts': 'manage_settings',
  'src/lib/data/admin/faq.ts': 'manage_settings',
  'src/lib/data/admin/fleet.ts': 'manage_settings',
  'src/lib/data/admin/outreach-master.ts': 'manage_settings',
  'src/lib/data/admin/campaigns.ts': 'manage_billing',
  'src/lib/data/admin/call-dnc.ts': 'manage_voice',
  // A row here decides which agent telephones a guest — it belongs with the
  // other dialling controls, not with general configuration.
  'src/lib/data/admin/voice-purposes.ts': 'manage_voice',
  'src/lib/data/admin/voximplant-channel.ts': 'manage_voice',
  'src/lib/data/admin/support.ts': 'view_customer_data',
  // The /admin/sumit-test diagnostic's token picker. manage_billing, the same
  // key the POC route and every other payment surface uses — listing which
  // campaigns hold a chargeable card, and resolving one for a live test charge,
  // is billing authority, not general staff access.
  'src/lib/data/admin/sumit-test.ts': 'manage_billing',
  // Owner-only surfaces: they gate on requirePlatformOwner and name no key.
  'src/lib/data/admin/platform-roles.ts': [],
  'src/lib/data/admin/relocation.ts': [],
  // The owner WhatsApp agent's switch, number, cap and allow-list (plan §3.3). Owner
  // decision 9.4, 2026-09-24: a row on that allow-list IS a grant of business-data
  // access over WhatsApp, so the settings key is deliberately NOT enough. Every export
  // is asserted by name below — the pin alone only proves the file mentions the gate.
  'src/lib/data/admin/owner-agent.ts': [],
  // Two keys each, and the pair is the point — listing call history needs the
  // voice permission, and hearing a recording needs its own on top.
  'src/lib/data/admin/console-history.ts': ['manage_voice', 'view_recordings'],
  'src/lib/data/admin/voice-ops.ts': ['manage_voice', 'view_recordings'],
  // Split by what the function does, not by which page it serves. See the header
  // of workflows.ts for why the manual run additionally needs manage_voice.
  'src/lib/data/admin/workflows.ts': ['manage_settings', 'view_customer_data'],
  // Two keys because the module gates on WHAT A ROLE CONTROLS, not on one floor for
  // the whole file: reads span every provider under manage_settings, while pointing
  // voice_caller_id_* or voice_inbound_did at a different line is voice configuration
  // and takes manage_voice. ROLE_PERMISSION in that file is keyed by the generated
  // enum, so a role added to the database without a decision here is a tsc error.
  'src/lib/data/admin/integrations/provider-numbers.ts': ['manage_settings', 'manage_voice'],
  // ONE KEY, BUT NOT ONE GATE. Adding a number and asking Meta for a verification
  // code are manage_settings. Register and deregister are OWNER-ONLY on top of that,
  // and the pin cannot express the mixture — so the two of them are asserted by name
  // below ('register/deregister stay owner-only'). Without that, downgrading
  // requirePlatformOwner to requirePlatformPermission('manage_settings') would leave
  // this list still correct and the suite still green.
  'src/lib/data/admin/integrations/number-registration.ts': 'manage_settings',
  // Read-only, but NOT exempt from naming a key: it reads the WhatsApp access
  // token and the app secret in order to ask Meta about them. Same permission as
  // the credentials form those values are entered on — anyone who may see the
  // secrets may ask whether they still work, and nobody below that may.
  'src/lib/data/admin/integrations/meta-status.ts': 'manage_settings',
  // The send-timing window every campaign is scheduled against. Same key as the
  // credentials form beside it: whoever configures the channel sets the hours it
  // may send in. It is not a finer key than manage_settings because the DANGEROUS
  // direction is not gated by permission at all — parseSendPolicy refuses to widen
  // past the ceilings no matter who is asking.
  'src/lib/data/admin/integrations/send-policy.ts': 'manage_settings',
  // TWO keys, and the asymmetry is the point: reading answers "is a provider
  // configured, and by whom" and is safe for an auditor; writing replaces the
  // OAuth client secret every future authorization depends on. Pinning both is
  // what stops the save from quietly sliding onto the read key.
  //
  // NOT `manage_settings`, deliberately. Reusing it would permanently couple
  // "may change system settings" to "may manage provider credentials" — see the
  // reasoning in 20260916005200.
  'src/lib/data/admin/integrations/oauth-provider-config.ts': [
    'integrations.read',
    'integrations.manage',
  ],
  // Both projections are read-only and return deliberately narrow DTOs: the
  // editor receives label/value options, while the admin page receives safe
  // status timestamps plus a Mail.Send-ready boolean. Credential material and
  // full connection rows never leave the module.
  'src/lib/data/admin/integrations/workflow-connections.ts': 'integrations.read',
  // ⚠️ `manage`, NOT `read` — and the split from the module above is the point.
  // `workflow-connections.ts` is gated on `read` so a workflow author who may
  // not administer integrations can still PICK an account. This module ends a
  // connection, renames it, or removes it — operations that affect every other
  // workflow using it, and that the person who triggered them cannot undo. The
  // two live apart so the weaker gate is never the one copied.
  'src/lib/data/admin/integrations/connection-lifecycle.ts': 'integrations.manage',
};

// Modules that write but are correctly exempt from naming a permission, with the
// reason. Kept separate from COARSE_GATE_ALLOWED so "it does not write" and "it
// writes, and here is why that is fine" stay distinguishable.
const WRITE_EXEMPT: Record<string, string> = {
  'src/lib/data/admin/access-log.ts':
    'The audit writer itself, called by readers that have already gated. Gating it again would make the audit trail depend on the permission being audited.',
};

// Every module under src/lib/data/admin, read from disk. The suite is driven by
// THIS, not by a hand-maintained list, so module 37 is examined the day it lands.
const ADMIN_DAL_DIR = 'src/lib/data/admin';
// RECURSIVE. It was a flat readdir until 2026-09-10, which was fine while every
// module sat directly in the directory — and stopped being fine the moment the first
// SUBDIRECTORY appeared (data/admin/integrations/). A flat scan returns that entry as
// a directory, the `.endsWith('.ts')` filter drops it, and every module inside is
// silently unscanned: the fail-closed guarantee this suite exists for would have gone
// green over a whole folder. Found while adding that folder, not by it failing.
function walkModules(rel: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(join(ROOT, rel), { withFileTypes: true })) {
    const child = `${rel}/${entry.name}`;
    if (entry.isDirectory()) out.push(...walkModules(child));
    else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts')) out.push(child);
  }
  return out;
}

const MODULES = walkModules(ADMIN_DAL_DIR).sort();

// Modules allowed to gate on the FLOOR alone — requirePlatformStaff(), "is this
// person staff at all" — each with the reason. A module earns a place here only
// if it neither writes nor returns customer data; anything else must name a
// permission in EXPECTED_PERMISSION.
//
// These said requireAdmin() until 2026-09-10, which was not merely untidy:
// nav-counts.ts is loaded by the ADMIN LAYOUT on every page, and requireAdmin()
// redirects when user_roles has no row — so a non-owner staff member was ejected
// from the panel by the module that draws its sidebar. The assertion below keeps
// the retired axis out of this directory for good.
const COARSE_GATE_ALLOWED: Record<string, string> = {
  'src/lib/data/admin/analytics.ts':
    'GA4 traffic aggregates for our own property. Read-only (verified 2026-09-10: no writes, no rpc, no enqueue, no side effect of any kind), no customer data, and the permission catalogue has no analytics key to name.',
  'src/lib/data/admin/search-console.ts':
    'Search Console aggregates for our own domain. Read-only (verified 2026-09-10), no customer data, and no matching key in the catalogue.',
  'src/lib/data/admin/dashboard.ts':
    'Counts for the admin home tiles. Read-only (verified 2026-09-10: no insert/update/upsert/delete, no rpc, no enqueue). It DOES use createAdminClient, so it bypasses RLS and the app gate is the only protection — acceptable while it returns aggregates and no customer row.',
  'src/lib/data/admin/nav-counts.ts':
    'Badge counts for the nav. Read-only (verified 2026-09-10), and already calls hasPlatformPermission internally so a viewer is never counted what they may not see. Uses createAdminClient, so it bypasses RLS — acceptable for counts.',
  'src/lib/data/admin/integrations/index.ts':
    'The /admin/integrations index. Read-only: it composes getIntegrationsStatus (itself credential-free since the flags RPC) with per-card hasPlatformPermission checks and returns booleans plus hrefs. Its floor is requirePlatformStaff because the page is navigation + status; the CARDS carry the permission each destination enforces, and the write surfaces it links to keep their own gates. Naming one key for the whole module would be the mistake the header of that file documents. Its one direct table read is two app_settings columns (owner_agent_enabled, owner_agent_phone_number_id) for the owner-agent card, through the cookie client and the staff policy — a switch and a Meta object id, no phone, no allow-list, no customer data.',
  'src/lib/data/admin/voice-node-arm-check.ts':
    'Arm-time validation of a workflow definition the CALLER ALREADY HOLDS. Read-only (no insert/update/rpc/enqueue), and its single caller is setWorkflowActive, which gates on manage_settings (verified at workflows.ts:236) before reading the row this is handed. Gating again here would answer a question about a definition the caller just proved they may read — and the only table it touches, voice_purposes, is the same list the editor already renders to them.',
  'src/lib/data/admin/nav-visibility.ts':
    'Which sidebar links to show. Read-only and touches no table at all — it returns nine booleans about the CALLER\'s own role. Naming a finer permission would be circular: answering "which permissions do you hold" cannot itself require one of them. Nav visibility is convenience, never authorization; the page keeps the gate.',
  'src/lib/data/admin/labels.ts': 'Pure label maps. No I/O at all.',
  'src/lib/data/admin/shared.ts': 'Shared types and helpers. No I/O at all.',
  'src/lib/data/admin/access-log.ts': 'Write-side audit helper called BY gated readers; gating it again would double-count.',
  'src/lib/data/admin/webhook-identity.ts': 'Pure derivation from a payload already fetched by a gated reader.',
  'src/lib/data/admin/voice-balance-cache.ts':
    'In-process memo of one non-customer number (the Voximplant balance), read by gated voice readers. Verified 2026-09-10: no database access at all — it exports a getter and a test reset, nothing more.',
};

// The permission catalogue as seeded in platform_permission_definitions,
// MEASURED against the live database 2026-09-10, re-measured 2026-09-16 after
// 20260916005200 seeded the two `integrations.*` keys. Pinned rather than queried so
// the suite stays hermetic; a key used in code that is not here is either a typo
// or a permission nobody created, and both mean the gate never matches and the
// user is redirected with no explanation.
const PERMISSION_CATALOGUE = [
  'campaigns.runstate',
  'integrations.manage',
  'integrations.read',
  'manage_billing',
  'manage_settings',
  'manage_staff',
  'manage_voice',
  'roles.manage',
  'view_activity_log',
  'view_billing',
  'view_customer_data',
  'view_events',
  'view_recordings',
  'view_webhooks',
] as const;

// Targeted readers of an identified customer subject that MUST record a
// staff-access audit row (Step-2 audit layer). A new such reader shipping without
// an audit call — the exact gap that let staff data-access go dark — fails here.
// support.ts's own two event-view readers audit via a direct support_access_log
// insert (pre-dating the helper); the rest go through recordStaffAccess.
const AUDIT_REQUIRED: Record<string, string[]> = {
  // All four gate on requirePlatformPermission('manage_billing') — STRICTER than
  // requireAdmin() — and each writes a fail-closed recordStaffAccess row before
  // the cross-tenant read, which requireAdmin() alone would not. The three
  // campaign readers reach it through auditedCampaignAccess (see AUDIT_DELEGATES):
  // one gate+audit, applied per read, so none of them can be called untraced.
  'src/lib/data/admin/campaigns.ts': [
    'getEventForAdminView',
    'getCampaignForAdminView',
    'getCampaignDeliveryForAdminView',
    'getThankyouScheduleForAdminView',
  ],
  'src/lib/data/admin/voice-ops.ts': ['listCallAttemptsForEvent'],
  // Cross-tenant reads of ONE named event: identity under 'view_events'
  // (not break-glass, so no reason) and the date move under 'manage_billing'.
  'src/lib/data/admin/event-view.ts': ['getEventForStaffView'],
  'src/lib/data/admin/events.ts': ['rescheduleEventForAdmin'],
  // Viewing another user's full detail is a break-glass customer-data read. The
  // audit is conditional on it being a cross-user view (self-view is exempt),
  // but the call must be present.
  'src/lib/data/admin/users.ts': ['getUserDetail'],
  // Reading a customer's stored card token to charge it from a diagnostic
  // screen is the most targeted read in the panel — it hands staff a reusable
  // payment instrument. Listing the candidates carries no card data and is
  // deliberately NOT audited.
  'src/lib/data/admin/sumit-test.ts': ['resolveSavedCardForCampaign'],
};

// Module-private wrappers that perform the gate AND the audit, so a reader
// delegating to one is audited exactly as if it called recordStaffAccess itself.
// A name earns a place here only if its own body does the permission check and
// writes the row before returning — verified below, not assumed, so this list
// cannot become a way to wave a reader through.
const AUDIT_DELEGATES: Record<string, string[]> = {
  'src/lib/data/admin/campaigns.ts': ['auditedCampaignAccess'],
};

describe('targeted admin readers record a staff-access audit', () => {
  for (const [relPath, fns] of Object.entries(AUDIT_REQUIRED)) {
    const source = readFileSync(join(ROOT, relPath), 'utf8');
    const blocks = splitIntoFunctionBlocks(source);
    const delegates = AUDIT_DELEGATES[relPath] ?? [];

    for (const delegate of delegates) {
      it(`${relPath}: ${delegate} really gates and audits before returning`, () => {
        const at = source.indexOf(`async function ${delegate}(`);
        expect(at, `${delegate} not found in ${relPath}`).toBeGreaterThan(-1);
        const body = source.slice(at, source.indexOf('\n}\n', at));
        expect(body).toMatch(/require(Admin|PlatformOwner|PlatformPermission)/);
        expect(body).toContain('recordStaffAccess');
      });
    }

    for (const fn of fns) {
      it(`${relPath}: ${fn} calls recordStaffAccess before returning data`, () => {
        const block = blocks.find((b) => b.name === fn);
        expect(block, `${fn} not found in ${relPath}`).toBeDefined();
        expect(
          block!.body.includes('recordStaffAccess') ||
            block!.body.includes('support_access_log') ||
            delegates.some((d) => block!.body.includes(`await ${d}(`)),
        ).toBe(true);
      });
    }
  }
});

describe('every admin data-layer module is accounted for', () => {
  // THE fail-closed assertion. A new file under src/lib/data/admin/ must be
  // classified — a named permission, or an explicit coarse-gate exemption with a
  // reason — before it can ship. Silence is no longer a pass.
  for (const relPath of MODULES) {
    it(`${relPath} is classified (permission or documented exemption)`, () => {
      const pinned = relPath in EXPECTED_PERMISSION;
      const excused = relPath in COARSE_GATE_ALLOWED;
      expect(
        pinned || excused,
        `${relPath} is neither pinned in EXPECTED_PERMISSION nor excused in ` +
          `COARSE_GATE_ALLOWED. Decide which permission it enforces, or record ` +
          `why the coarse requireAdmin() gate is enough for it.`,
      ).toBe(true);
      expect(pinned && excused, `${relPath} is in BOTH maps — pick one`).toBe(false);
    });
  }

  it('no map names a module that no longer exists', () => {
    for (const relPath of [...Object.keys(COARSE_GATE_ALLOWED), ...Object.keys(EXPECTED_PERMISSION)]) {
      if (!relPath.startsWith(ADMIN_DAL_DIR)) continue;
      expect(MODULES, `${relPath} is mapped but not on disk`).toContain(relPath);
    }
  });

  // The retired axis, kept out. requireAdmin() reads user_roles and REDIRECTS on
  // a miss; anything in this directory that calls it can eject a legitimate
  // staff member, and nav-counts.ts proved that is not hypothetical — it runs in
  // the admin layout. The floor is requirePlatformStaff().
  it('no module gates on the retired requireAdmin()', () => {
    for (const relPath of MODULES) {
      const source = readFileSync(join(ROOT, relPath), 'utf8');
      expect(
        /await requireAdmin\(\)/.test(source),
        `${relPath} still calls requireAdmin(), which reads the retired user_roles ` +
          `axis and redirects a staff member who has no row there. Use ` +
          `requirePlatformStaff() for the floor, or name a permission.`,
      ).toBe(false);
    }
  });

  it('every exemption carries a reason', () => {
    for (const [relPath, reason] of Object.entries(COARSE_GATE_ALLOWED)) {
      expect(reason.length, `${relPath} needs a real reason`).toBeGreaterThan(30);
    }
  });

  // A permission key that is not in the catalogue never matches, so the gate
  // silently redirects instead of authorizing. A typo is indistinguishable from
  // a lockout until someone reports it.
  it('every permission key used in the admin data layer exists in the catalogue', () => {
    for (const relPath of MODULES) {
      const used = [
        ...readFileSync(join(ROOT, relPath), 'utf8').matchAll(
          /requirePlatformPermission\('([a-z_.]+)'\)/g,
        ),
      ].map((m) => m[1]);
      for (const key of used) {
        expect(PERMISSION_CATALOGUE, `${relPath} uses unknown permission '${key}'`).toContain(key);
      }
    }
  });

  // The rule the workflows.ts gap broke: a module that WRITES must name what it
  // is allowed to write, not lean on "is this person staff at all".
  it('no module that writes to the database gates on requireAdmin alone', () => {
    for (const relPath of MODULES) {
      const source = readFileSync(join(ROOT, relPath), 'utf8');
      const writes = /\.(insert|update|upsert|delete)\(\s*\{/.test(source);
      if (!writes || relPath in WRITE_EXEMPT) continue;
      const fine =
        /requirePlatformPermission\('/.test(source) || source.includes('requirePlatformOwner(');
      expect(
        fine,
        `${relPath} writes to the database but gates only on requireAdmin(). ` +
          `requireAdmin() is has_role('admin') — support_agent and auditor hold it too.`,
      ).toBe(true);
    }
  });
});

describe('admin data-layer functions are gated', () => {
  for (const [relPath, exempt] of Object.entries(EXEMPT)) {
    const source = readFileSync(join(ROOT, relPath), 'utf8');
    const blocks = splitIntoFunctionBlocks(source);

    it(`${relPath} exports at least one async function to check`, () => {
      expect(blocks.length).toBeGreaterThan(0);
    });

    for (const { name, body } of blocks) {
      if (exempt.includes(name)) {
        it(`${relPath}: ${name} is explicitly exempt (documented above)`, () => {
          expect(exempt).toContain(name);
        });
        continue;
      }
      it(`${relPath}: ${name} calls an authorization gate`, () => {
        expect(GATES.some((g) => body.includes(g))).toBe(true);
      });
    }

    it(`${relPath}: every EXEMPT entry still exists as a real function (no stale allowlist)`, () => {
      const names = blocks.map((b) => b.name);
      for (const name of exempt) {
        expect(names).toContain(name);
      }
    });
  }
});


describe('pinned modules enforce exactly the permission they are pinned to', () => {
  // Driven by EXPECTED_PERMISSION, NOT nested inside the EXEMPT loop.
  //
  // It used to be nested, which meant a module pinned here but absent from EXEMPT
  // was never actually asserted — pinning it did nothing. Caught 2026-09-10 by
  // downgrading workflows.ts back to requireAdmin() and watching the suite stay
  // green; the two other injected faults fired, this one did not.
  for (const [relPath, expectedKey] of Object.entries(EXPECTED_PERMISSION)) {
    const source = readFileSync(join(ROOT, relPath), 'utf8');
    const expected = (Array.isArray(expectedKey) ? expectedKey : [expectedKey]).sort();

    it(`${relPath}: enforces exactly ${expected.length ? expected.join(' + ') : 'owner-only (no key)'}`, () => {
      const used = [
        ...new Set(
          [...source.matchAll(/requirePlatformPermission\('([a-z_.]+)'\)/g)].map((m) => m[1]),
        ),
      ].sort();
      // An empty expectation means owner-only: no key, but a gate all the same.
      if (expected.length === 0) {
        expect(used).toEqual([]);
        expect(source).toContain('requirePlatformOwner(');
      } else {
        expect(used).toEqual(expected);
      }
    });
  }
});

describe('the admin layout applies the staff floor', () => {
  // Defense in depth, NOT the authorization boundary — Next's own guidance says
  // a layout "does not control whether the rest of the route renders". The
  // boundary is the per-module permission gate asserted above. This only pins
  // that the floor is present, runs before children, and asks the RIGHT axis.
  it('awaits requirePlatformStaff() before rendering children', () => {
    const source = readFileSync(join(ROOT, 'src/app/(admin)/admin/layout.tsx'), 'utf8');
    expect(source).toMatch(/await requirePlatformStaff\(\)/);
    const gateIndex = source.indexOf('await requirePlatformStaff()');
    const childrenIndex = source.indexOf('{children}');
    expect(gateIndex).toBeGreaterThan(-1);
    expect(childrenIndex).toBeGreaterThan(gateIndex);
  });

  // THE REGRESSION THAT ACTUALLY BIT. Clearing the floor at the top of the
  // layout is worthless if something the layout then AWAITS re-checks the
  // retired axis and redirects. That is exactly what happened: getAdminNavCounts
  // (nav-counts.ts) called requireAdmin(), so a billing_clerk passed
  // requirePlatformStaff() and was ejected to /app by the module drawing their
  // sidebar. Every admin module the layout imports must clear the same floor it
  // does.
  it('nothing the layout awaits re-checks the retired axis', () => {
    const layout = readFileSync(join(ROOT, 'src/app/(admin)/admin/layout.tsx'), 'utf8');
    const imported = [...layout.matchAll(/from '@\/lib\/data\/admin\/([\w-]+)'/g)].map(
      (m) => `src/lib/data/admin/${m[1]}.ts`,
    );
    expect(imported.length, 'the layout imports no admin module — did the path shape change?')
      .toBeGreaterThan(0);
    for (const relPath of imported) {
      const source = readFileSync(join(ROOT, relPath), 'utf8');
      expect(
        /await requireAdmin\(\)/.test(source),
        `${relPath} is awaited by the admin layout and calls requireAdmin(), which ` +
          `redirects a staff member with no user_roles row — locking them out of ` +
          `every admin page after the layout already let them in.`,
      ).toBe(false);
    }
  });

  // The floor moved from user_roles.admin to platform_staff on 2026-09-10,
  // because the two axes were written by separate flows and a non-owner role
  // added through /admin/roles was bounced from the panel. Asking the old axis
  // here would silently restore that bug.
  it('does not fall back to the retired user_roles axis', () => {
    const source = readFileSync(join(ROOT, 'src/app/(admin)/admin/layout.tsx'), 'utf8');
    expect(source).not.toMatch(/await requireAdmin\(\)/);
  });
});

// ---------------------------------------------------------------------------
// The scan root, widened — because it was too narrow, and that is how the gap
// below got in.
// ---------------------------------------------------------------------------
//
// MODULES above reads src/lib/data/admin/ and NOTHING ELSE. That is why this
// suite could go green while reporting "no coarse-gated writes": a Server Action
// lives under src/app/(admin)/admin/, outside the scanned directory, and was
// never looked at.
//
// It matters because a Server Action IS ITS OWN ENDPOINT. Next dispatches a POST
// straight to it; the page's requirePlatformPermission() never runs for a caller
// who invokes the action directly. Same for a route handler. The layout does not
// save them either — see the note at src/lib/auth/dal.ts and Next's own wording,
// "a layout does not control whether the rest of the route renders".
//
// MEASURED 2026-09-10, before the fix: 16 exported actions across voice/,
// alerts/ and fleet/ gated on the coarse staff floor alone — among them one that
// writes an ElevenLabs API key, one that writes a Slack webhook secret, and one
// that sends a real Slack message. After the two auth axes were merged, every
// role reached those, an auditor included.
//
// WHAT THIS ASSERTION DOES NOT PROVE, stated plainly rather than implied: it
// does not verify that a thin action DELEGATES correctly. Most admin actions
// validate input and hand off to a data-layer function that holds the gate —
// which is the house pattern and is correct — and proving the handoff would need
// real call-graph analysis, not text. So this checks the one thing text can
// settle with no false positives: an admin endpoint that gates HERE must not
// gate COARSELY. A file that names requireAdmin() is a file that decided to
// authorize and picked the widest gate there is.
const ENDPOINT_DIRS = ['src/app/(admin)/admin', 'src/app/api/admin'];

function collectEndpointFiles(dir: string): string[] {
  const out: string[] = [];
  const walk = (rel: string): void => {
    for (const entry of readdirSync(join(ROOT, rel), { withFileTypes: true })) {
      const child = `${rel}/${entry.name}`;
      if (entry.isDirectory()) {
        walk(child);
      } else if (
        !entry.name.endsWith('.test.ts') &&
        (entry.name === 'route.ts' ||
          entry.name === 'actions.ts' ||
          entry.name.endsWith('-actions.ts'))
      ) {
        out.push(child);
      }
    }
  };
  walk(dir);
  return out.sort();
}

const ENDPOINT_FILES = ENDPOINT_DIRS.flatMap(collectEndpointFiles);

describe('no admin endpoint authorizes on the coarse staff floor', () => {
  it('finds endpoint files to check (a silent empty scan is the bug this replaces)', () => {
    expect(ENDPOINT_FILES.length).toBeGreaterThan(20);
  });

  for (const relPath of ENDPOINT_FILES) {
    it(`${relPath} names a permission rather than requireAdmin()`, () => {
      const source = readFileSync(join(ROOT, relPath), 'utf8');
      const coarse = [...source.matchAll(/await requireAdmin\(\)/g)];
      expect(
        coarse.length,
        `${relPath} gates on the coarse requireAdmin() in ${coarse.length} place(s). ` +
          `A Server Action and a route handler are each their own endpoint, so this ` +
          `IS the authorization decision — name the permission the action actually ` +
          `needs (requirePlatformPermission), or requirePlatformOwner if it is ` +
          `owner-only. Delegating the gate to a pinned data-layer function is also ` +
          `fine; calling requireAdmin() here is not.`,
      ).toBe(0);
    });
  }

  it('every permission key used by an admin endpoint exists in the catalogue', () => {
    for (const relPath of ENDPOINT_FILES) {
      const used = [
        ...readFileSync(join(ROOT, relPath), 'utf8').matchAll(
          /requirePlatformPermission\('([a-z_.]+)'\)/g,
        ),
      ].map((m) => m[1]);
      for (const key of used) {
        expect(PERMISSION_CATALOGUE, `${relPath} uses unknown permission '${key}'`).toContain(key);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// A stricter splitter, used ONLY for the owner-agent module below.
//
// splitIntoFunctionBlocks (top of this file) matches `export async function` and
// nothing else, and reads comments as code — so a gate named in a comment counts, and
// an `export const f = async () => …` or a plain `export function` is never looked
// at. Widening that shared splitter would change what the EXEMPT and AUDIT checks see
// in every other module, which is its own review; this one is scoped to the module
// whose every export is owner-only by decision.
// ---------------------------------------------------------------------------

/**
 * Drop // and /* *\/ comments; leave '…', "…" and `…` contents alone, so a URL in a
 * string is not mistaken for a comment. Regex literals are not tokenized — acceptable
 * for the modules this is pointed at, which is asserted by the self-test below.
 */
function stripComments(source: string): string {
  let out = '';
  let quote: string | null = null;
  let i = 0;
  while (i < source.length) {
    const c = source[i];
    const next = source[i + 1];
    if (quote) {
      out += c;
      if (c === '\\') {
        out += next ?? '';
        i += 2;
        continue;
      }
      if (c === quote) quote = null;
      i += 1;
      continue;
    }
    if (c === '/' && next === '/') {
      while (i < source.length && source[i] !== '\n') i += 1;
      continue;
    }
    if (c === '/' && next === '*') {
      const close = source.indexOf('*/', i + 2);
      i = close === -1 ? source.length : close + 2;
      continue;
    }
    if (c === '"' || c === "'" || c === '`') quote = c;
    out += c;
    i += 1;
  }
  return out;
}

// Every top-level declaration starts a block, exported or not — so a non-exported
// helper that happens to call the gate cannot lend it to the export above it.
const TOP_LEVEL_DECLARATION =
  /^(export\s+)?(?:default\s+)?(async\s+function\*?|function\*?|const|let|var|class|interface|type|enum)\s+([\w$]+)/gm;

// What makes an exported binding a FUNCTION: an initializer that is a function
// expression, an arrow, or a wrapper call such as cache(async () => …).
const FUNCTION_INITIALIZER =
  /^\s*(?:async\b|function\b|\(|[A-Za-z_$][\w$]*\s*=>|[A-Za-z_$][\w$]*\s*\()/;

function splitExportedFunctions(source: string): { name: string; body: string }[] {
  const code = stripComments(source);
  const starts = [...code.matchAll(TOP_LEVEL_DECLARATION)].map((m) => ({
    exported: m[1] !== undefined,
    kind: m[2],
    name: m[3],
    index: m.index ?? 0,
  }));
  const out: { name: string; body: string }[] = [];
  starts.forEach((d, i) => {
    if (!d.exported) return;
    const body = code.slice(d.index, starts[i + 1]?.index ?? code.length);
    if (d.kind.includes('function')) {
      out.push({ name: d.name, body });
      return;
    }
    if (d.kind === 'const' || d.kind === 'let' || d.kind === 'var') {
      // The assignment is the first `=` that is not the `=>` of a type annotation.
      const assign = body.search(/=(?!>)/);
      if (assign !== -1 && FUNCTION_INITIALIZER.test(body.slice(assign + 1))) {
        out.push({ name: d.name, body });
      }
    }
  });
  return out;
}

const GATED = (body: string) => body.includes('await requirePlatformOwner()');

describe('splitExportedFunctions (the owner-agent splitter) is not fooled', () => {
  const SYNTHETIC = [
    "// await requirePlatformOwner() — named only in a comment above",
    'export async function commentOnly() {',
    '  /* await requirePlatformOwner() */',
    '  return 1;',
    '}',
    'export function plainExport() {',
    '  return 2;',
    '}',
    'export const arrowExport = async () => {',
    '  await requirePlatformOwner();',
    '};',
    'export const cachedExport = cache(async () => 3);',
    'export const typedArrow: () => Promise<void> = async () => {};',
    "export const COLUMNS = 'id, name';",
    'export const LIMIT = 50;',
    'export async function urlInString() {',
    "  const u = 'https://example.test/x';",
    '  await requirePlatformOwner();',
    '  return u;',
    '}',
    'export async function borrowsFromHelper() {',
    '  return 4;',
    '}',
    'async function helper() {',
    '  await requirePlatformOwner();',
    '}',
  ].join('\n');
  const blocks = splitExportedFunctions(SYNTHETIC);
  const gated = Object.fromEntries(blocks.map((b) => [b.name, GATED(b.body)]));

  it('finds every exported function form, and no constant', () => {
    expect(blocks.map((b) => b.name)).toEqual([
      'commentOnly',
      'plainExport',
      'arrowExport',
      'cachedExport',
      'typedArrow',
      'urlInString',
      'borrowsFromHelper',
    ]);
  });

  it('does not count a gate that appears only in a comment', () => {
    expect(gated.commentOnly).toBe(false);
  });

  it('does not let a following non-exported helper lend its gate', () => {
    expect(gated.borrowsFromHelper).toBe(false);
  });

  it('keeps a string containing // intact', () => {
    expect(gated.urlInString).toBe(true);
    expect(gated.arrowExport).toBe(true);
  });
});

describe('the owner-agent data layer gates every export on requirePlatformOwner', () => {
  // EXPECTED_PERMISSION's `[]` checks the FILE: no permission key, and the owner gate
  // named somewhere. A new export that forgot the gate would still pass that. This
  // checks each exported function — async or not, declared or assigned — with
  // comments stripped, because every one of them either reads the allow-list and
  // audit or changes who may reach business data over WhatsApp.
  const relPath = 'src/lib/data/admin/owner-agent.ts';
  const blocks = splitExportedFunctions(readFileSync(join(ROOT, relPath), 'utf8'));

  it('exports functions to check (a silent empty scan is the failure mode)', () => {
    expect(blocks.length).toBeGreaterThanOrEqual(12);
  });

  for (const { name, body } of blocks) {
    it(`${name} calls requirePlatformOwner()`, () => {
      expect(GATED(body)).toBe(true);
    });
  }
});

describe('the Meta number lifecycle keeps its irreversible half owner-only', () => {
  // Register and deregister are not "one more admin write". Meta allows TEN of them
  // per business number per 72-hour window and blocks the number on the eleventh
  // (133016), and deregistering stops sending on a line that may be carrying an
  // event's invitations. Neither is undone by pressing the button again.
  //
  // EXPECTED_PERMISSION pins this module to manage_settings because that is the only
  // permission KEY it names; these two functions sit above that floor, and that fact
  // lives nowhere else that a test can see.
  const relPath = 'src/lib/data/admin/integrations/number-registration.ts';
  const source = readFileSync(join(ROOT, relPath), 'utf8');
  const blocks = splitIntoFunctionBlocks(source);

  for (const fn of ['registerNumber', 'deregisterNumber']) {
    it(`${fn} gates on requirePlatformOwner`, () => {
      const block = blocks.find((b) => b.name === fn);
      expect(block, `${fn} not found in ${relPath}`).toBeDefined();
      expect(block!.body).toContain('requirePlatformOwner(');
    });

    it(`${fn} claims the 72-hour budget before calling Meta`, () => {
      // The order is the assertion. Reserving AFTER the call means a crash mid-flight
      // leaves a request Meta counted and we did not — and the drift only surfaces as
      // a block that looked impossible.
      const block = blocks.find((b) => b.name === fn);
      const reserve = block!.body.indexOf('reserveRegistrationBudget');
      const call = block!.body.search(/await (register|deregister)PhoneNumber\(/);
      expect(reserve, `${fn} does not reserve budget`).toBeGreaterThan(-1);
      expect(call, `${fn} does not call Meta`).toBeGreaterThan(-1);
      expect(reserve).toBeLessThan(call);
    });
  }

  it('never stores, returns or logs the PIN', () => {
    // The PIN is a credential with a longer life than the registration: Meta requires
    // it to change the PIN and to delete the number. It is a parameter passed straight
    // through to Meta and must appear nowhere else in this module.
    const uses = [...source.matchAll(/\bpin\b/g)].length;
    expect(source).not.toMatch(/logActivity[\s\S]{0,200}\bpin\b/);
    expect(source).not.toMatch(/sendSlackAlert[\s\S]{0,300}\bpin\b/);
    expect(source).not.toMatch(/(insert|update|upsert)\([\s\S]{0,200}\bpin\b/);
    // Signature, the doc block, and the single hand-off to Meta — nothing else.
    expect(uses).toBeLessThanOrEqual(6);
  });
});
