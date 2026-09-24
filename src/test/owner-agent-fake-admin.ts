// A service-role Supabase double for the owner-agent intake path
// (src/lib/owner-agent/intake.ts) and the WhatsApp webhook route tests.
//
// Unlike supabase-mock.ts (one result for every chain), this one answers per
// TABLE and applies the `.eq` / `.gte` filters it is given, so a test that
// relies on a filter — "only ENABLED allow-list rows" — actually exercises it:
// drop the filter from the code and the fake returns the disabled row too.
//
// Every write is recorded in `writes` so a test can assert exactly what reached
// owner_agent_intake and owner_agent_audit (and that nothing did).

export interface FakeSettingsRow {
  owner_agent_enabled: boolean;
  owner_agent_phone_number_id: string | null;
  owner_agent_daily_cap: number;
}

export interface FakeAllowlistRow {
  id: string;
  e164: string;
  staff_user_id: string;
  enabled: boolean;
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
  /** Existing intake rows (wamid, staff_user_id, received_at). */
  intake: Array<{ id: string; wamid: string; staff_user_id: string; received_at: string }>;
  intakeCountError: FakeDbError | null;
  intakeInsertError: FakeDbError | null;
  auditError: FakeDbError | null;
}

export interface FakeWrite {
  table: string;
  op: 'insert' | 'upsert';
  row: Record<string, unknown>;
  options?: Record<string, unknown>;
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
  };
}

type Filter = [string, 'eq' | 'gte', unknown];

function matches(row: Record<string, unknown>, filters: Filter[]): boolean {
  return filters.every(([col, op, val]) => {
    const v = row[col];
    if (op === 'eq') return v === val;
    return typeof v === 'string' && typeof val === 'string' && v >= val;
  });
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
  const filters: Filter[] = [];

  const resolve = (): { data: unknown; error: FakeDbError | null; count?: number | null } => {
    const s = fake.state;
    if (write) {
      if (table === 'owner_agent_audit') {
        if (s.auditError) return { data: null, error: s.auditError };
        fake.writes.push(write);
        return { data: null, error: null };
      }
      if (table === 'owner_agent_intake') {
        if (s.intakeInsertError) return { data: null, error: s.intakeInsertError };
        const row = write.row as { wamid: string; staff_user_id: string };
        fake.writes.push(write);
        if (s.intake.some((r) => r.wamid === row.wamid)) return { data: null, error: null };
        const id = fakeUuid();
        s.intake.push({ id, wamid: row.wamid, staff_user_id: row.staff_user_id, received_at: new Date().toISOString() });
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
        .map(({ id, e164, staff_user_id }) => ({ id, e164, staff_user_id }));
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
