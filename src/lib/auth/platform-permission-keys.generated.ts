// AUTO-GENERATED FILE. DO NOT EDIT.
// Source: public.platform_permission_definitions
// Generate: npm run gen:permissions
// Verify: npm run check:permissions:generated

export const PLATFORM_PERMISSION_KEYS = [
  "campaigns.runstate",
  "events.mark_test",
  "events.purge_test",
  "integrations.manage",
  "integrations.read",
  "manage_billing",
  "manage_settings",
  "manage_staff",
  "manage_voice",
  "rdp.request",
  "roles.manage",
  "view_activity_log",
  "view_billing",
  "view_customer_data",
  "view_events",
  "view_recordings",
  "view_webhooks",
] as const;

export type PlatformPermissionKey =
  (typeof PLATFORM_PERMISSION_KEYS)[number];

const permissionKeySet: ReadonlySet<string> =
  new Set(PLATFORM_PERMISSION_KEYS);

export function isPlatformPermissionKey(
  value: string,
): value is PlatformPermissionKey {
  return permissionKeySet.has(value);
}
