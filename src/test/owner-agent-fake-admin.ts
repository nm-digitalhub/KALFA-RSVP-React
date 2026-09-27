// A service-role Supabase double for the owner-agent intake path
// (src/lib/owner-agent/intake.ts) and the WhatsApp webhook route tests.
//
// Unlike supabase-mock.ts (one result for every chain), this one answers per
// TABLE and applies the `.eq` / `.gte` filters it is given, so a test that
// relies on a filter — "only ENABLED allow-list rows" — actually exercises it:
// drop the filter from the code and the fake returns the disabled row too.
//
// Every write is recorded in `writes` so a test can assert exactly what reached
// owner_agent_intake, owner_agent_audit and owner_agent_allowlist (and that
// nothing did).
//
// The CHECKs a test relies on are ENFORCED, not assumed: the intake row CHECKs of
// 20260927011338 (media id, type <-> fields, lengths) and the allow-list BSUID
// ones (pattern, binding group, unique). A row that would violate one returns
// 23514 / 23505 like PostgREST, so "gated, never a DB error" is actually tested.

export interface FakeSettingsRow {
  owner_agent_enabled: boolean;
  owner_agent_phone_number_id: string | null;
  owner_agent_daily_cap: number;
  owner_agent_burst_ms?: number;
}

export interface FakeAllowlistRow {
  id: string;
  e164: string;
  staff_user_id: string | null;
  enabled: boolean;
  /** Defaults to 'verified_staff' when omitted (the migration default). */
  approval_kind?: string;
  bsuid?: string | null;
  parent_bsuid?: string | null;
  bsuid_bound_at?: string | null;
  bound_from_e164?: string | null;
}

export interface FakeDbError {
  code: string;
  message: string;
}

export interface FakeAdminState {
  settings: FakeSettingsRow | null;
  settingsError: FakeDbError | null;
  allowlist: FakeAllowlistRow[];
  allowlistError: FakeDbError | null;
  /** user ids for which is_platform_staff_for_user returns true. */
  staff: Set<string>;
  staffError: FakeDbError | null;
  /** user id -> profiles.phone_verified_e164 */
  verifiedPhones: Map<string, string | null>;
  profilesError: FakeDbError | null;
  /** Existing intake rows (wamid, staff_user_id, allowlist_entry_id, received_at). */
  intake: Array<{
    id: string;
    wamid: string;
    staff_user_id: string | null;
    allowlist_entry_id?: string | null;
    received_at: string;
  }>;
  intakeCountError: FakeDbError | null;
  intakeInsertError: FakeDbError | null;
  auditError: FakeDbError | null;
  allowlistUpdateError: FakeDbError | null;
}

export interface FakeWrite {
  table: string;
  op: 'insert' | 'upsert' | 'update';
  row: Record<string, unknown>;
  options?: Record<string, unknown>;
  /** update only: the filters it was given. */
  filters?: Array<[string, string, unknown]>;
}

export interface FakeRead {
  table: string;
  columns: string;
  filters: Array<[string, string, unknown]>;
}

export function unconfiguredState(): FakeAdminState {
  return {
    settings: { owner_agent_enabled: false, owner_agent_phone_number_id: null, owner_agent_daily_cap: 50 },
    settingsError: null,
    allowlist: [],
    allowlistError: null,
    staff: new Set(),
    staffError: null,
    verifiedPhones: new Map(),
    profilesError: null,
    intake: [],
    intakeCountError: null,
    intakeInsertError: null,
    auditError: null,
    allowlistUpdateError: null,
  };
}

type Filter = [string, 'eq' | 'gte' | 'is' | 'in', unknown];

function matches(row: Record<string, unknown>, filters: Filter[]): boolean {
  return filters.every(([col, op, val]) => {
    const v = row[col];
    if (op === 'eq') return v === val;
    if (op === 'is') return (v ?? null) === val;
    if (op === 'in') return Array.isArray(val) && val.includes(v);
    return typeof v === 'string' && typeof val === 'string' && v >= val;
  });
}

const cp = (s: unknown) => (typeof s === 'string' ? [...s].length : -1);
const nul = (v: unknown) => v === null || v === undefined;

/** The owner_agent_intake CHECKs of 20260924034054 + 20260927011338. true = passes. */
export function intakeRowPassesChecks(r: Record<string, unknown>): boolean {
  const type = (r.message_type ?? 'text') as string;
  const text = r.message_text;
  const hasMedia = !nul(r.media_id);
  const hasInteractive = !nul(r.interactive_id);
  const hasLocation = !nul(r.location_lat);
  const checks = [
    /^[a-z][a-z0-9_]{0,31}$/.test(type),
    nul(text) || (cp(text) >= 1 && cp(text) <= 4096),
    nul(r.media_id) || /^[0-9]{1,32}$/.test(String(r.media_id)),
    nul(r.media_mime) || (cp(r.media_mime) >= 3 && cp(r.media_mime) <= 255),
    nul(r.media_sha256_b64) || /^[A-Za-z0-9+/=_-]{1,128}$/.test(String(r.media_sha256_b64)),
    nul(r.media_filename) || (cp(r.media_filename) >= 1 && cp(r.media_filename) <= 255),
    nul(r.interactive_id) || (cp(r.interactive_id) >= 1 && cp(r.interactive_id) <= 1024),
    nul(r.interactive_title) || (cp(r.interactive_title) >= 1 && cp(r.interactive_title) <= 256),
    nul(r.location_lat) || (Number(r.location_lat) >= -90 && Number(r.location_lat) <= 90),
    nul(r.location_lng) || (Number(r.location_lng) >= -180 && Number(r.location_lng) <= 180),
    nul(r.location_label) || (cp(r.location_label) >= 1 && cp(r.location_label) <= 1024),
    nul(r.reply_to_wamid) || (cp(r.reply_to_wamid) >= 1 && cp(r.reply_to_wamid) <= 512),
    hasMedia ||
      [r.media_mime, r.media_sha256_b64, r.media_bytes, r.media_voice, r.media_filename, r.transcript].every(nul),
    nul(r.location_lat) === nul(r.location_lng) && (nul(r.location_label) || hasLocation),
    nul(r.interactive_title) || hasInteractive,
    nul(r.media_voice) || type === 'audio',
  ];
  let typeFields: boolean;
  if (type === 'text') typeFields = !nul(text) && !hasMedia && !hasInteractive && !hasLocation;
  else if (['image', 'document', 'audio', 'video', 'sticker'].includes(type))
    typeFields = hasMedia && !hasInteractive && !hasLocation;
  else if (type === 'location') typeFields = hasLocation && !hasMedia && !hasInteractive;
  else if (type === 'interactive' || type === 'button') typeFields = hasInteractive && !hasMedia && !hasLocation;
  else typeFields = !hasMedia && !hasInteractive && !hasLocation;
  return checks.every(Boolean) && typeFields;
}

const BSUID_CHECK = /^[A-Z]{2}\.(ENT\.)?[A-Za-z0-9]{1,128}$/;

/** The owner_agent_allowlist BSUID CHECKs of 20260927011338. true = passes. */
export function allowlistRowPassesChecks(r: FakeAllowlistRow): boolean {
  const b = r.bsuid ?? null;
  return (
    (b === null || BSUID_CHECK.test(b)) &&
    (nul(r.parent_bsuid) || BSUID_CHECK.test(String(r.parent_bsuid))) &&
    (nul(r.bound_from_e164) || /^\+[1-9][0-9]{6,14}$/.test(String(r.bound_from_e164))) &&
    (b === null) === nul(r.bsuid_bound_at) &&
    (b === null) === nul(r.bound_from_e164) &&
    (nul(r.parent_bsuid) || b !== null)
  );
}

let nextId = 1;
function fakeUuid(): string {
  const n = String(nextId++).padStart(12, '0');
  return `00000000-0000-4000-8000-${n}`;
}

export interface FakeAdmin {
  state: FakeAdminState;
  writes: FakeWrite[];
  reads: FakeRead[];
  rpcCalls: Array<{ fn: string; args: Record<string, unknown> }>;
  client: {
    from: (table: string) => unknown;
    rpc: (fn: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: FakeDbError | null }>;
  };
  reset: (state?: FakeAdminState) => void;
}

export function createFakeAdmin(initial: FakeAdminState = unconfiguredState()): FakeAdmin {
  const fake: FakeAdmin = {
    state: initial,
    writes: [],
    reads: [],
    rpcCalls: [],
    client: {
      from: (table: string) => builder(fake, table),
      rpc: async (fn: string, args: Record<string, unknown>) => {
        fake.rpcCalls.push({ fn, args });
        if (fn !== 'is_platform_staff_for_user') return { data: null, error: { code: '42883', message: 'no such fn' } };
        if (fake.state.staffError) return { data: null, error: fake.state.staffError };
        return { data: fake.state.staff.has(String(args._user_id)), error: null };
      },
    },
    reset: (state = unconfiguredState()) => {
      fake.state = state;
      fake.writes = [];
      fake.reads = [];
      fake.rpcCalls = [];
    },
  };
  return fake;
}

function builder(fake: FakeAdmin, table: string) {
  let columns = '';
  let head = false;
  let write: FakeWrite | null = null;
  let single = false;
  let returning = false;
  const filters: Filter[] = [];

  const resolve = (): { data: unknown; error: FakeDbError | null; count?: number | null } => {
    const s = fake.state;
    if (write) {
      if (table === 'owner_agent_audit') {
        if (s.auditError) return { data: null, error: s.auditError };
        fake.writes.push(write);
        return { data: null, error: null };
      }
      if (table === 'owner_agent_allowlist' && write.op === 'update') {
        if (s.allowlistUpdateError) return { data: null, error: s.allowlistUpdateError };
        write.filters = filters.map((f) => [...f]);
        const targets = s.allowlist.filter((r) => matches(r as unknown as Record<string, unknown>, filters));
        const next = targets.map((r) => ({ ...r, ...(write!.row as Partial<FakeAllowlistRow>) }));
        if (!next.every(allowlistRowPassesChecks)) {
          return { data: null, error: { code: '23514', message: 'owner_agent_allowlist_bsuid_binding_chk' } };
        }
        for (const n of next) {
          if (n.bsuid && s.allowlist.some((o) => o.id !== n.id && o.bsuid === n.bsuid)) {
            return { data: null, error: { code: '23505', message: 'owner_agent_allowlist_bsuid_key' } };
          }
        }
        fake.writes.push(write);
        for (const n of next) s.allowlist[s.allowlist.findIndex((r) => r.id === n.id)] = n;
        return { data: returning ? next.map((n) => ({ id: n.id })) : null, error: null };
      }
      if (table === 'owner_agent_intake') {
        if (s.intakeInsertError) return { data: null, error: s.intakeInsertError };
        if (!intakeRowPassesChecks(write.row)) {
          return { data: null, error: { code: '23514', message: 'owner_agent_intake check violation' } };
        }
        const row = write.row as { wamid: string; staff_user_id: string | null; allowlist_entry_id?: string | null };
        fake.writes.push(write);
        if (s.intake.some((r) => r.wamid === row.wamid)) return { data: null, error: null };
        const id = fakeUuid();
        s.intake.push({
          id,
          wamid: row.wamid,
          staff_user_id: row.staff_user_id,
          allowlist_entry_id: row.allowlist_entry_id ?? null,
          received_at: new Date().toISOString(),
        });
        return { data: single ? { id } : [{ id }], error: null };
      }
      return { data: null, error: { code: '42P01', message: `unexpected write to ${table}` } };
    }

    fake.reads.push({ table, columns, filters: filters.map((f) => [...f]) });
    if (table === 'app_settings') {
      if (s.settingsError) return { data: null, error: s.settingsError };
      return { data: s.settings, error: null };
    }
    if (table === 'owner_agent_allowlist') {
      if (s.allowlistError) return { data: null, error: s.allowlistError };
      const rows = s.allowlist
        .filter((r) => matches(r as unknown as Record<string, unknown>, filters))
        .map(({ id, e164, staff_user_id, approval_kind, bsuid, bound_from_e164 }) => ({
          id,
          e164,
          staff_user_id,
          approval_kind: approval_kind ?? 'verified_staff',
          bsuid: bsuid ?? null,
          bound_from_e164: bound_from_e164 ?? null,
        }));
      return { data: rows, error: null };
    }
    if (table === 'profiles') {
      if (s.profilesError) return { data: null, error: s.profilesError };
      const id = filters.find(([c]) => c === 'id')?.[2];
      if (typeof id !== 'string' || !s.verifiedPhones.has(id)) return { data: null, error: null };
      return { data: { phone_verified_e164: s.verifiedPhones.get(id) ?? null }, error: null };
    }
    if (table === 'owner_agent_intake' && head) {
      if (s.intakeCountError) return { data: null, error: s.intakeCountError, count: null };
      const count = s.intake.filter((r) => matches(r as unknown as Record<string, unknown>, filters)).length;
      return { data: null, error: null, count };
    }
    return { data: null, error: { code: '42P01', message: `unexpected read of ${table}` } };
  };

  const b = {
    select(cols: string, opts?: { head?: boolean }) {
      if (!write) columns = cols;
      else returning = true;
      head = opts?.head === true;
      return b;
    },
    eq(col: string, val: unknown) {
      filters.push([col, 'eq', val]);
      return b;
    },
    gte(col: string, val: unknown) {
      filters.push([col, 'gte', val]);
      return b;
    },
    is(col: string, val: unknown) {
      filters.push([col, 'is', val]);
      return b;
    },
    in(col: string, val: unknown[]) {
      filters.push([col, 'in', val]);
      return b;
    },
    update(row: Record<string, unknown>) {
      write = { table, op: 'update', row };
      return b;
    },
    insert(row: Record<string, unknown>) {
      write = { table, op: 'insert', row };
      return b;
    },
    upsert(row: Record<string, unknown>, options?: Record<string, unknown>) {
      write = { table, op: 'upsert', row, options };
      return b;
    },
    maybeSingle() {
      single = true;
      return b;
    },
    then<T>(onFulfilled: (v: ReturnType<typeof resolve>) => T, onRejected?: (e: unknown) => T) {
      try {
        return Promise.resolve(onFulfilled(resolve()));
      } catch (e) {
        if (onRejected) return Promise.resolve(onRejected(e));
        throw e;
      }
    },
  };
  return b;
}
