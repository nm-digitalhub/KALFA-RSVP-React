import 'server-only';

import { notFound } from 'next/navigation';
import { z } from 'zod';

import { logActivity } from '@/lib/data/activity';
import {
  buildScheduleOptions,
  hasApprovedDefaultRoute,
  type ScheduleStepOption,
} from '@/lib/data/schedule-options';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { requirePlatformPermission } from '@/lib/auth/dal';
import type { Json, Tables, TablesInsert, TablesUpdate } from '@/lib/supabase/types';
import { outreachTouchpointSchema } from '@/lib/validation/admin';
import type {
  PackageInput,
  OperationalFieldsInput,
  OutreachTouchpointInput,
} from '@/lib/validation/admin';

// Admin: packages CRUD. Authorized by the request-scoped session under the
// `packages_admin_all` RLS policy plus a server-side
// requirePlatformPermission('manage_billing') gate.
// Reads of active packages are public (`packages_public_read`); writes are
// admin-only. Prices are server-validated (see validation/admin.ts) and never
// trusted from the browser.

type PackageRow = Tables<'packages'>;
type PackageInsert = TablesInsert<'packages'>;
type PackageUpdate = TablesUpdate<'packages'>;

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
  | 'base_price'
  | 'included_reached'
  | 'channels'
  | 'outreach_schedule'
  | 'min_hold_floor'
  | 'hold_buffer_pct'
  // How many contacts a campaign created from this package may approach (the fixed-price package model);
  // NULL = a package without a quota.
  | 'contact_quota'
>;

export const PACKAGE_COLUMNS =
  'id, name, tier, category, description, price_with_vat, includes, active, sort_order, created_at, price_per_reached, base_price, included_reached, channels, outreach_schedule, min_hold_floor, hold_buffer_pct, contact_quota';

// List all packages (active and inactive) for the admin table, ordered by the
// curated sort order then name. Not paginated: the catalogue is small and
// admins manage the full set at once.
export async function listPackages(): Promise<AdminPackage[]> {
  await requirePlatformPermission('manage_billing');

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
  await requirePlatformPermission('manage_billing');

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
// (same pattern as src/lib/data/campaigns.ts).
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
  base_price: number | null;
  included_reached: number | null;
  contact_quota: number | null;
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
    base_price: operational.base_price,
    included_reached: operational.included_reached,
    contact_quota: operational.contact_quota,
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
    | 'base_price'
    | 'included_reached'
    | 'channels'
    | 'outreach_schedule'
    | 'min_hold_floor'
    | 'hold_buffer_pct'
    | 'contact_quota'
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
    previous.base_price !== next.base_price ? 'base_price' : null,
    previous.included_reached !== next.included_reached ? 'included_reached' : null,
    previous.contact_quota !== next.contact_quota ? 'contact_quota' : null,
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
// — whatsapp only. NOT because the call channel is unbuilt: it is live
// (channels.call.is_built and app_settings.voximplant_live_calls are both true;
// rule/caller/service-account are set). The real reason is that there is
// nothing to validate a call key against — message_templates holds only
// whatsapp rows, and a `call` touchpoint's message_key travels onward as
// OutreachCallRequest.scriptKey, which is written at six call sites and read at
// none (see outreach-call/route.ts). A typo in a call message_key is therefore
// inert today, not a silent send failure like the whatsapp case below.
// One query for all unique message_keys, not N+1.
export async function validateOutreachScheduleForPackage(
  schedule: OutreachTouchpointInput[],
): Promise<{ index: number; message: string }[]> {
  await requirePlatformPermission('manage_billing');
  const whatsappTouchpoints = schedule
    .map((tp, index) => ({ tp, index }))
    .filter(({ tp }) => tp.channel === 'whatsapp');
  if (whatsappTouchpoints.length === 0) return [];

  const uniqueKeys = [...new Set(whatsappTouchpoints.map(({ tp }) => tp.message_key))];
  // Valid = the step is active AND its default route points at a template
  // Meta has APPROVED — exactly what resolveWhatsAppSend requires to send
  // (whatsapp-template-send.ts). One query for all unique keys, not N+1.
  const admin = createAdminClient();
  const { data } = await admin
    .from('message_templates')
    .select('message_key, channel, message_template_routes(event_type, with_media, whatsapp_message_templates(status))')
    .in('message_key', uniqueKeys)
    .eq('active', true);

  const byKey = new Map((data ?? []).map((t) => [t.message_key, t]));
  // The same rule the schedule picker uses to decide what to offer (schedule-options.ts), so what the form lets an
  // admin pick and what this check accepts cannot drift apart.
  const hasApprovedDefault = (t: NonNullable<typeof data>[number]) => hasApprovedDefaultRoute(t.message_template_routes);

  const errors: { index: number; message: string }[] = [];
  whatsappTouchpoints.forEach(({ tp, index }) => {
    const template = byKey.get(tp.message_key);
    if (!template) {
      errors.push({ index, message: `תבנית "${tp.message_key}" לא נמצאה או אינה פעילה` });
    } else if (template.channel !== tp.channel) {
      errors.push({ index, message: `תבנית "${tp.message_key}" מיועדת לערוץ אחר` });
    } else if (!hasApprovedDefault(template)) {
      errors.push({ index, message: `לשלב "${tp.message_key}" אין תבנית מאושרת ב-Meta` });
    }
  });
  return errors;
}

// The steps an admin may pick for a package's outreach schedule, so the form offers a list instead of a text field to
// type a key into. Reads with the service-role client strictly AFTER the permission gate (message_templates and its
// routes are not readable by the packages page's own session), the same way the save-time validation above does.
export async function getScheduleStepOptions(): Promise<ScheduleStepOption[]> {
  await requirePlatformPermission('manage_billing');
  const admin = createAdminClient();
  const { data, error } = await admin
    .from('message_templates')
    .select('message_key, channel, label, active, message_template_routes(event_type, with_media, whatsapp_message_templates(status))');
  if (error) throw new Error('טעינת תבניות ההודעות נכשלה');
  return buildScheduleOptions(data ?? []);
}

export type SuggestedSchedule = {
  /** The package the schedule was taken from, named to the admin so the copy is never silent. */
  fromName: string;
  channels: string[];
  schedule: OutreachTouchpointInput[];
};

// What a NEW package starts with instead of an empty schedule: the schedule (and the channels it needs) of the first
// active package, in catalogue order, that has a valid one. The stored JSON is parsed with the same schema the form is
// saved with, so a damaged value yields no suggestion rather than a half-filled form. null = nothing to suggest.
export async function getSuggestedSchedule(): Promise<SuggestedSchedule | null> {
  await requirePlatformPermission('manage_billing');
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('packages')
    .select('name, channels, outreach_schedule')
    .eq('active', true)
    .order('sort_order', { ascending: true })
    .order('name', { ascending: true });
  if (error) throw new Error('טעינת החבילות נכשלה');

  for (const pkg of data ?? []) {
    const parsed = z.array(outreachTouchpointSchema).safeParse(pkg.outreach_schedule);
    if (!parsed.success || parsed.data.length === 0) continue;
    // The form refuses a step whose channel the package does not carry, so the suggestion carries every channel its
    // steps use, whatever the stored list says.
    const channels = [...new Set([...(pkg.channels ?? []), ...parsed.data.map((tp) => tp.channel)])];
    return { fromName: pkg.name, channels, schedule: parsed.data };
  }
  return null;
}

// Create a package. Returns the new id, but nothing consumes it today:
// createPackageAction redirects to the list (/admin/packages). Kept on the
// signature so a caller that does want to land on the new package's edit page
// has the id without a second read.
export async function createPackage(
  input: PackageInput,
  operational: OperationalFieldsInput,
): Promise<{ id: string }> {
  await requirePlatformPermission('manage_billing');

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
  await requirePlatformPermission('manage_billing');

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
  await requirePlatformPermission('manage_billing');

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
