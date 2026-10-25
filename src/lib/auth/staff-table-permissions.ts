import { PLATFORM_ACTIONS, type PlatformAction, type PlatformSubject } from '@/lib/casl';
import type { Database } from '@/lib/supabase/types';

import type { PlatformPermissionKey } from './platform-permission-keys.generated';

// The 25 platform-staff tables of `staff-tables-permission-rls` (openspec/changes/staff-tables-permission-rls,
// design D1, D3, D10): which permission key the DATABASE must require for each operation a staff member's own
// session performs, so RLS admits exactly what the data layer admits and no more.
//
// One map, two readers: `admin-data-layer-coverage.test.ts` checks it equals the module pins (the keys the
// application gates on), and the pgTAP suite of each stage checks the policies name the same keys. Keys come from
// the generated catalogue type (`PlatformPermissionKey`, from `platform_permission_definitions`) or, for a table
// whose module decides through CASL, from `PLATFORM_ACTIONS` by action name. No key list is kept here.
//
// - `closed` (Group A): only the server reaches the table, with the service role. No grant to `anon` or
//   `authenticated`, no policy (design D2).
// - `permission` (Group B): per-operation policies `to authenticated`, only for the operations a user-session path
//   uses (design D3). An operation absent from `ops` gets no grant.

export type TableOperation = 'SELECT' | 'INSERT' | 'UPDATE' | 'DELETE';

export type PublicTable = keyof Database['public']['Tables'];

interface ClosedTable {
  group: 'closed';
}

interface KeyedTable {
  group: 'permission';
  // Any one of the listed keys admits the operation (an OR in the policy).
  ops: Partial<Record<TableOperation, readonly PlatformPermissionKey[]>>;
  // The data-layer modules that reach the table with the staff session; their pins must equal `ops`.
  modules: readonly string[];
  // A read the policy keeps for callers outside the staff keys (public pages, customers), recorded apart.
  otherRead?: string;
}

interface CaslTable<S extends PlatformSubject = PlatformSubject> {
  group: 'permission';
  // The module decides through CASL: each operation names the action of `subject`; the key is PLATFORM_ACTIONS'.
  casl: { subject: S; ops: Partial<Record<TableOperation, PlatformAction<S>>> };
  modules: readonly string[];
  otherRead?: string;
}

export type StaffTableRule = ClosedTable | KeyedTable | CaslTable;

const SETTINGS = ['manage_settings'] as const satisfies readonly PlatformPermissionKey[];
const VOICE = ['manage_voice'] as const satisfies readonly PlatformPermissionKey[];
// provider_numbers and provider_number_roles: reads span every provider under manage_settings; pointing a voice
// role at a line is voice configuration (provider-numbers.ts ROLE_PERMISSION). Either key admits the row.
const SETTINGS_OR_VOICE = ['manage_settings', 'manage_voice'] as const satisfies readonly PlatformPermissionKey[];

const FLEET: KeyedTable = {
  group: 'permission',
  ops: { SELECT: SETTINGS },
  modules: ['src/lib/data/admin/fleet.ts'],
};

export const STAFF_TABLE_PERMISSIONS = {
  // Group A: closed.
  otp_challenges: { group: 'closed' },
  agreement_documents: { group: 'closed' },
  webhook_inbox: { group: 'closed' },
  workflows: { group: 'closed' },
  workflow_runs: { group: 'closed' },
  workflow_run_events: { group: 'closed' },
  workflow_run_steps: { group: 'closed' },
  webhook_deliveries: { group: 'closed' },
  outreach_template_failures: { group: 'closed' },
  vox_log_exports: { group: 'closed' },
  voice_purpose_attempts: { group: 'closed' },

  // Group B: per operation.
  packages: {
    group: 'permission',
    casl: { subject: 'Package', ops: { SELECT: 'read', INSERT: 'create', UPDATE: 'update', DELETE: 'delete' } },
    modules: ['src/lib/data/admin/packages.ts'],
    otherRead: 'packages_public_read: SELECT for anon and authenticated where active = true (public pages, customers)',
  },
  call_dnc_list: {
    group: 'permission',
    ops: { SELECT: VOICE, INSERT: VOICE, UPDATE: VOICE },
    modules: ['src/lib/data/admin/call-dnc.ts'],
  },
  call_compliance_settings: {
    group: 'permission',
    ops: { SELECT: VOICE, UPDATE: VOICE },
    modules: ['src/lib/data/admin/call-dnc.ts', 'src/lib/data/admin/voximplant-channel.ts'],
  },
  provider_numbers: {
    group: 'permission',
    ops: { SELECT: SETTINGS_OR_VOICE, INSERT: SETTINGS_OR_VOICE, UPDATE: SETTINGS_OR_VOICE },
    modules: ['src/lib/data/admin/integrations/provider-numbers.ts'],
  },
  provider_number_roles: {
    group: 'permission',
    ops: { SELECT: SETTINGS_OR_VOICE, INSERT: SETTINGS_OR_VOICE, UPDATE: SETTINGS_OR_VOICE, DELETE: SETTINGS_OR_VOICE },
    modules: ['src/lib/data/admin/integrations/provider-numbers.ts'],
  },
  message_templates: {
    group: 'permission',
    ops: { SELECT: SETTINGS, UPDATE: SETTINGS },
    modules: ['src/lib/data/message-templates.ts'],
  },
  channels: {
    group: 'permission',
    ops: { SELECT: SETTINGS, UPDATE: SETTINGS },
    modules: ['src/lib/data/admin/channel-catalog.ts'],
    otherRead: 'channels_auth_read: SELECT for any authenticated user (src/lib/data/channel-catalog.ts)',
  },
  faq_items: {
    group: 'permission',
    ops: { SELECT: SETTINGS, INSERT: SETTINGS, UPDATE: SETTINGS, DELETE: SETTINGS },
    modules: ['src/lib/data/admin/faq.ts'],
    otherRead: 'faq_items_public_read: SELECT for anon and authenticated where published = true',
  },
  callback_schedule_policies: {
    group: 'permission',
    ops: { SELECT: SETTINGS, UPDATE: SETTINGS },
    modules: ['src/lib/callbacks/policy-config-admin.ts', 'src/app/(admin)/admin/callbacks/policy/actions.ts'],
  },
  fleet_requests: FLEET,
  fleet_goals: FLEET,
  fleet_request_slack_threads: FLEET,
  ops_alerts: {
    group: 'permission',
    ops: { SELECT: SETTINGS },
    modules: ['src/lib/data/admin/alerts.ts'],
  },
  voice_purposes: {
    group: 'permission',
    ops: { SELECT: VOICE, INSERT: VOICE, UPDATE: VOICE },
    modules: ['src/lib/data/admin/voice-purposes.ts'],
  },
} as const satisfies Partial<Record<PublicTable, StaffTableRule>>;

export type StaffTable = keyof typeof STAFF_TABLE_PERMISSIONS;

// The keys the database must require for `op` on `table`; empty when no user-session path performs it (no grant).
export function staffTableOperationKeys(table: StaffTable, op: TableOperation): readonly PlatformPermissionKey[] {
  return operationKeys(STAFF_TABLE_PERMISSIONS[table], op);
}

// The same, for any rule (the SQL and test renderers take the rules as a parameter so a test can pass a changed copy).
export function operationKeys(rule: StaffTableRule, op: TableOperation): readonly PlatformPermissionKey[] {
  if (rule.group === 'closed') return [];
  if ('casl' in rule) {
    const action = rule.casl.ops[op];
    if (!action) return [];
    const actions: Record<string, PlatformPermissionKey> = PLATFORM_ACTIONS[rule.casl.subject];
    return [actions[action]];
  }
  return rule.ops[op] ?? [];
}
