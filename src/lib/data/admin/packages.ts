import 'server-only';

import { notFound } from 'next/navigation';

import { logActivity } from '@/lib/data/activity';
import { createClient } from '@/lib/supabase/server';
import { requireAdmin } from '@/lib/auth/dal';
import type { Database } from '@/lib/supabase/types';
import type { PackageInput } from '@/lib/validation/admin';

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
>;

export const PACKAGE_COLUMNS =
  'id, name, tier, category, description, price_with_vat, includes, active, sort_order, created_at';

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

// `includes` is a JSON array of strings; the column is typed `Json`. The two
// are structurally compatible at runtime but not directly assignable in TS, so
// we narrow through unknown — documented per the project's casting rule.
function includesJson(includes: string[]): PackageInsert['includes'] {
  return includes as unknown as PackageInsert['includes'];
}

// Build the writable column payload shared by create and update from validated
// input. `description` is normalised to null when blank.
function toWritable(input: PackageInput): {
  name: string;
  tier: string;
  category: string;
  description: string | null;
  price_with_vat: number;
  includes: PackageInsert['includes'];
  active: boolean;
} {
  return {
    name: input.name,
    tier: input.tier,
    category: input.category,
    description: input.description ? input.description : null,
    price_with_vat: input.price_with_vat,
    includes: includesJson(input.includes),
    active: input.active,
  };
}

function packageChangedFields(
  previous: Pick<
    AdminPackage,
    'name' | 'tier' | 'category' | 'description' | 'price_with_vat' | 'includes' | 'active'
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
  ].filter((value): value is string => value !== null);
}

// Create a package. Returns the new id for redirecting to its edit page.
export async function createPackage(input: PackageInput): Promise<{ id: string }> {
  await requireAdmin();

  const supabase = await createClient();
  const writable = toWritable(input);
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
export async function updatePackage(id: string, input: PackageInput): Promise<void> {
  await requireAdmin();

  const supabase = await createClient();
  const writable = toWritable(input);
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
