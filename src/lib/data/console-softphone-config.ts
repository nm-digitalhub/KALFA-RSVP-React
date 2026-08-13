import 'server-only';

import { createAdminClient } from '@/lib/supabase/admin';

// Feature-flag reader for the browser softphone panel (call-center stage 3).
// Mirrors monitorEnabled() in console-monitor.ts: app_settings is admin-only
// RLS, so this is a service-role, single-column read. Fails CLOSED — any
// error keeps the panel dark rather than mounting it on an unreadable flag.
export async function consoleSoftphoneEnabled(): Promise<boolean> {
  const admin = createAdminClient();
  const { data } = await admin
    .from('app_settings')
    .select('console_softphone_enabled')
    .eq('id', true)
    .maybeSingle();
  return data?.console_softphone_enabled === true;
}

// Gates the panel's "שיחות AI חיות" (AI-handoff) section (plan stage 6-UI).
// The flag is not client-readable (app_settings RLS is admin-only), so it is
// read here, server-side, and threaded through the same layout -> AdminShell
// -> SoftphonePanel prop chain as consoleSoftphoneEnabled above — never
// fetched from the browser. Fails CLOSED like its sibling.
export async function consoleHandoffEnabled(): Promise<boolean> {
  const admin = createAdminClient();
  const { data } = await admin
    .from('app_settings')
    .select('handoff_enabled')
    .eq('id', true)
    .maybeSingle();
  return data?.handoff_enabled === true;
}

// Gates CallBar's consult/conference controls (stage 2). Same rationale and
// fail-closed discipline as consoleHandoffEnabled — an explicit ops knob so
// a live test never requires a scenario redeploy (ops-knobs precedent: "a
// toggle must be a flag, not a scenario constant"). Column added by
// supabase/migrations/20260812180200_callcenter_stage2_consult_conference.sql
// (applied; types.ts regenerated).
export async function consoleConsultConferenceEnabled(): Promise<boolean> {
  const admin = createAdminClient();
  const { data } = await admin
    .from('app_settings')
    .select('console_consult_conference_enabled')
    .eq('id', true)
    .maybeSingle();
  return data?.console_consult_conference_enabled === true;
}
