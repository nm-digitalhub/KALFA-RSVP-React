import 'server-only';

import { notFound } from 'next/navigation';

import { logActivity } from '@/lib/data/activity';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { requireAdmin } from '@/lib/auth/dal';
import type { Database, Json } from '@/lib/supabase/types';
import type {
  PackageInput,
  OperationalFieldsInput,
  OutreachTouchpointInput,
} from '@/lib/validation/admin';

// Admin: packages CRUD. Authorized by the request-scoped session under the
// `packages_admin_all` RLS policy plus a server-side requireAdmin() gate.
// Reads of active packages are public (`packages_public_read`); writes are
// admin-only. Prices are server-validated (see validation/admin.ts) and never
// trusted from the browser.

type PackageRow = Database['public']['Tables']['packages']['Row'];
type PackageInsert = Database['public']['Tables']['packages']['Insert'];
type PackageUpdate = Database['public']['Tables']['packages']['Update'];

export type AdminPackage = Pick<
  PackageRow,
  | 'id'
  | 'name'
  | 'tier'
  | 'category'
  | 'description'
  | 'price_with_vat'
  | 'includes'
  | 'active'
  | 'sort_order'
  | 'created_at'
  | 'price_per_reached'
  | 'channels'
  | 'outreach_schedule'
  | 'min_hold_floor'
  | 'hold_buffer_pct'
>;

export const PACKAGE_COLUMNS =
  'id, name, tier, category, description, price_with_vat, includes, active, sort_order, created_at, price_per_reached, channels, outreach_schedule, min_hold_floor, hold_buffer_pct';

// List all packages (active and inactive) for the admin table, ordered by the
// curated sort order then name. Not paginated: the catalogue is small and
// admins manage the full set at once.
export async function listPackages(): Promise<AdminPackage[]> {
  await requireAdmin();

  const supabase = await createClient();
  const { data, error } = await supabase
    .from('packages')
    .select(PACKAGE_COLUMNS)
    .order('sort_order', { ascending: true })
    .order('name', { ascending: true });

  if (error) {
    throw new Error('טעינת החבילות נכשלה');
  }

  return data ?? [];
}

// Fetch one package by id; notFound() (404) if it does not exist.
export async function getPackage(id: string): Promise<AdminPackage> {
  await requireAdmin();

  const supabase = await createClient();
  const { data, error } = await supabase
    .from('packages')
    .select(PACKAGE_COLUMNS)
    .eq('id', id)
    .maybeSingle();

  if (error) {
    throw new Error('טעינת החבילה נכשלה');
  }
  if (!data) {
    notFound();
  }
  return data;
}

// `includes`/`outreach_schedule` are JSON columns typed `Json`. Plain arrays
// are structurally compatible at runtime but not directly assignable in TS,
// so we narrow through unknown — documented per the project's casting rule
// (same pattern as src/lib/data/campaigns.ts:173).
function includesJson(includes: string[]): PackageInsert['includes'] {
  return includes as unknown as PackageInsert['includes'];
}
function outreachScheduleJson(
  schedule: OutreachTouchpointInput[],
): PackageInsert['outreach_schedule'] {
  return schedule as unknown as Json;
}

// Build the writable column payload shared by create and update from validated
// input. `description` is normalised to null when blank.
function toWritable(
  input: PackageInput,
  operational: OperationalFieldsInput,
): {
  name: string;
  tier: string;
  category: string;
  description: string | null;
  price_with_vat: number;
  includes: PackageInsert['includes'];
  active: boolean;
  sort_order: number;
  price_per_reached: number | null;
  channels: PackageInsert['channels'];
  outreach_schedule: PackageInsert['outreach_schedule'];
  min_hold_floor: number;
  hold_buffer_pct: number;
} {
  return {
    name: input.name,
    tier: input.tier,
    category: input.category,
    description: input.description ? input.description : null,
    price_with_vat: input.price_with_vat,
    includes: includesJson(input.includes),
    active: input.active,
    sort_order: input.sort_order,
    price_per_reached: operational.price_per_reached,
    channels: operational.channels,
    outreach_schedule: outreachScheduleJson(operational.outreach_schedule),
    min_hold_floor: operational.min_hold_floor,
    hold_buffer_pct: operational.hold_buffer_pct,
  };
}

function packageChangedFields(
  previous: Pick<
    AdminPackage,
    | 'name'
    | 'tier'
    | 'category'
    | 'description'
    | 'price_with_vat'
    | 'includes'
    | 'active'
    | 'sort_order'
    | 'price_per_reached'
    | 'channels'
    | 'outreach_schedule'
    | 'min_hold_floor'
    | 'hold_buffer_pct'
  >,
  next: ReturnType<typeof toWritable>,
): string[] {
  return [
    previous.name !== next.name ? 'name' : null,
    previous.tier !== next.tier ? 'tier' : null,
    previous.category !== next.category ? 'category' : null,
    previous.description !== next.description ? 'description' : null,
    previous.price_with_vat !== next.price_with_vat ? 'price_with_vat' : null,
    JSON.stringify(previous.includes) !== JSON.stringify(next.includes)
      ? 'includes'
      : null,
    previous.active !== next.active ? 'active' : null,
    previous.sort_order !== next.sort_order ? 'sort_order' : null,
    previous.price_per_reached !== next.price_per_reached ? 'price_per_reached' : null,
    // channels/outreach_schedule are arrays/JSON — reference-compare via
    // JSON.stringify, mirroring the existing `includes` precedent above.
    JSON.stringify(previous.channels) !== JSON.stringify(next.channels)
      ? 'channels'
      : null,
    JSON.stringify(previous.outreach_schedule) !== JSON.stringify(next.outreach_schedule)
      ? 'outreach_schedule'
      : null,
    previous.min_hold_floor !== next.min_hold_floor ? 'min_hold_floor' : null,
    previous.hold_buffer_pct !== next.hold_buffer_pct ? 'hold_buffer_pct' : null,
  ].filter((value): value is string => value !== null);
}

// Batched validation of outreach_schedule touchpoints against message_templates
// — whatsapp only (call/AI-voice has no verifiable source of truth yet, the
// Voximplant channel is not built — see channels-client.tsx "Voximplant
// (בקרוב)"). One query for all unique message_keys, not N+1.
export async function validateOutreachScheduleForPackage(
  schedule: OutreachTouchpointInput[],
): Promise<{ index: number; message: string }[]> {
  await requireAdmin();
  const whatsappTouchpoints = schedule
    .map((tp, index) => ({ tp, index }))
    .filter(({ tp }) => tp.channel === 'whatsapp');
  if (whatsappTouchpoints.length === 0) return [];

  const uniqueKeys = [...new Set(whatsappTouchpoints.map(({ tp }) => tp.message_key))];
  const admin = createAdminClient();
  const { data } = await admin
    .from('message_templates')
    .select('message_key, name, language, channel')
    .in('message_key', uniqueKeys)
    .eq('active', true);

  // Mirrors getTemplateByKey's semantics (message-templates.ts): empty
  // name/language/channel counts as "not found", not just active/missing.
  const byKey = new Map(
    (data ?? [])
      .filter((t) => t.name && t.language && t.channel)
      .map((t) => [t.message_key, t]),
  );

  const errors: { index: number; message: string }[] = [];
  whatsappTouchpoints.forEach(({ tp, index }) => {
    const template = byKey.get(tp.message_key);
    if (!template) {
      errors.push({ index, message: `תבנית "${tp.message_key}" לא נמצאה או אינה פעילה` });
    } else if (template.channel !== tp.channel) {
      errors.push({ index, message: `תבנית "${tp.message_key}" מיועדת לערוץ אחר` });
    }
  });
  return errors;
}

// Create a package. Returns the new id for redirecting to its edit page.
export async function createPackage(
  input: PackageInput,
  operational: OperationalFieldsInput,
): Promise<{ id: string }> {
  await requireAdmin();

  const supabase = await createClient();
  const writable = toWritable(input, operational);
  const payload: PackageInsert = writable;
  const { data, error } = await supabase
    .from('packages')
    .insert(payload)
    .select('id')
    .single();

  if (error || !data) {
    throw new Error('יצירת החבילה נכשלה');
  }

  await logActivity({
    action: 'package.created',
    meta: {
      packageId: data.id,
      packageName: input.name,
      fields: Object.keys(payload),
    },
  });

  return { id: data.id };
}

// Update an existing package by id.
export async function updatePackage(
  id: string,
  input: PackageInput,
  operational: OperationalFieldsInput,
): Promise<void> {
  await requireAdmin();

  const supabase = await createClient();
  const writable = toWritable(input, operational);
  const payload: PackageUpdate = writable;
  const previous = await getPackage(id);
  const { error } = await supabase.from('packages').update(payload).eq('id', id);

  if (error) {
    throw new Error('עדכון החבילה נכשל');
  }

  await logActivity({
    action: 'package.updated',
    meta: {
      packageId: id,
      packageName: previous.name,
      changedFields: packageChangedFields(previous, writable),
    },
  });
}

// Delete a package by id.
export async function deletePackage(id: string): Promise<void> {
  await requireAdmin();

  const supabase = await createClient();
  const previous = await getPackage(id);
  const { error } = await supabase.from('packages').delete().eq('id', id);

  if (error) {
    // 23503 = foreign_key_violation (Postgres/PostgREST error code) — a
    // campaign (even an old/closed one) still references this package via
    // template_id (RESTRICT). Distinguish this from a generic failure so the
    // admin sees why, instead of a one-size-fits-all message.
    if (error.code === '23503') {
      throw new Error('לא ניתן למחוק חבילה שמשויכת לקמפיין קיים (גם קמפיין ישן/סגור)');
    }
    throw new Error('מחיקת החבילה נכשלה');
  }

  await logActivity({
    action: 'package.deleted',
    meta: {
      packageId: id,
      packageName: previous.name,
      tier: previous.tier,
      category: previous.category,
    },
  });
}
