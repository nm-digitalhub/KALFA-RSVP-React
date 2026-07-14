import 'server-only';

import { createClient } from '@/lib/supabase/server';
import { requireAdmin } from '@/lib/auth/dal';
import { getWhatsAppChannelConfig } from '@/lib/data/admin/channels';
import { getVoximplantChannelConfig } from '@/lib/data/admin/voximplant-channel';

// The single GLOBAL outreach master switch (`app_settings.outreach_enabled`)
// gates BOTH channels — WhatsApp AND Voximplant. There is no per-channel enable
// column. This module is the SOLE writer of that column (neither channel form
// writes it), eliminating the two-writer footgun. Enable is fail-closed: it
// requires ≥1 channel configured, using the SAME `configured` predicate the
// runtime send-gates use.

export type OutreachMasterState = {
  enabled: boolean;
  whatsappConfigured: boolean;
  voximplantConfigured: boolean;
  anyChannelReady: boolean;
};

export async function getOutreachMasterState(): Promise<OutreachMasterState> {
  await requireAdmin();
  const [wa, vox] = await Promise.all([
    getWhatsAppChannelConfig(),
    getVoximplantChannelConfig(),
  ]);
  return {
    enabled: wa.outreach_enabled, // the single global column
    whatsappConfigured: wa.configured, // phone-id + token — SAME predicate as getWhatsAppConfig
    voximplantConfigured: vox.configured, // SA-json + rule_id + caller_id
    anyChannelReady: wa.configured || vox.configured,
  };
}

export async function setOutreachEnabled(enabled: boolean): Promise<void> {
  await requireAdmin();
  const supabase = await createClient();
  const { error } = await supabase
    .from('app_settings')
    .update({ outreach_enabled: enabled })
    .eq('id', true);
  if (error) throw new Error('עדכון מתג הפנייה נכשל');
}
