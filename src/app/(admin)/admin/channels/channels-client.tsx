'use client';

import {
  Tabs,
  TabsList,
  TabsTab,
  TabsPanel,
} from '@/components/ui/tabs';
import { OutreachMasterSwitch } from '@/app/(admin)/admin/integrations/_components/outreach-master-switch';
import { WhatsAppCredentialsForm } from '@/app/(admin)/admin/integrations/meta-whatsapp/whatsapp-credentials-form';
import { WhatsAppConsentToggle } from '@/app/(admin)/admin/integrations/meta-whatsapp/whatsapp-consent-toggle';
import { WhatsAppConnectionTest } from '@/app/(admin)/admin/integrations/meta-whatsapp/whatsapp-connection-test';
import { VoximplantStatusCard } from '@/app/(admin)/admin/integrations/voximplant/voximplant-status-card';
import {
  VoximplantLiveCallsToggle,
  VoximplantMeetingConfirmToggle,
  VoximplantSalesCallToggle,
} from '@/app/(admin)/admin/integrations/voximplant/voximplant-personas';
import { VoximplantConsentToggle } from '@/app/(admin)/admin/integrations/voximplant/voximplant-consent-toggle';
import { VoximplantCredentialsForm } from '@/app/(admin)/admin/integrations/voximplant/voximplant-credentials-form';
import { VoximplantConnectionTest } from '@/app/(admin)/admin/integrations/voximplant/voximplant-connection-test';

// WHAT IS LEFT OF THIS FILE, AND WHY.
//
// Every control that used to be defined here now lives under
// src/app/(admin)/admin/integrations/ and is IMPORTED BACK. Lifted, not copied: one
// definition, two surfaces, so this page and the new provider pages cannot drift while
// both exist. The page itself is retired in Task 0.6 — as its own commit, after a clean
// deploy, which is what keeps Phase 0 reversible by removing three redirect lines
// instead of reverting a phase.
//
// The imports point INTO integrations/ rather than out into src/components/, and the
// direction is deliberate: these components belong to the surface that survives. Moving
// them to a neutral shared home would mean a third location to maintain and a second
// move once this page is gone. src/components/ is for primitives used across domains;
// these are one provider's controls.
//
// Nothing here owns state or markup any more: it is the tab shell and the composition.
// The field primitives (Field/SecretField/CopyRow/StatusBadge) that used to be declared
// in this file were deleted with the last extraction — they are in
// integrations/_components/form-fields.tsx, and keeping local twins was the drift this
// whole task exists to remove.

type WhatsAppConfig = {
  outreach_enabled: boolean;
  whatsapp_phone_number_id: string;
  whatsapp_waba_id: string;
  whatsapp_access_token: string;
  whatsapp_app_secret: string;
  whatsapp_verify_token: string;
  configured: boolean;
  // app_settings.whatsapp_consent_required — false = sends skip the
  // contacts.whatsapp_consent_at check (legal exposure, warned at the toggle).
  consentRequired: boolean;
};

type VoximplantConfig = {
  serviceAccountConfigured: boolean;
  voximplant_rule_id: string;
  voximplant_caller_id: string;
  voximplant_callback_secret: string;
  voximplant_low_balance_threshold: string;
  voximplant_min_call_reserve: string;
  voximplant_max_concurrent_calls: string;
  voximplant_max_calls_per_campaign_hour: string;
  configured: boolean;
  fullyConfigured: boolean; // full dial config — gates the live-calls toggle
  liveCalls: boolean; // raw admin toggle value (app_settings.voximplant_live_calls)
  liveEnabled: boolean; // effective gate (toggle AND env not force-off)
  callConsentRequired: boolean; // app_settings.call_consent_required — off = dial without prior consent
  meetingConfirmRuleId: string;
  meetingConfirmEnabled: boolean;
  meetingConfirmFullyConfigured: boolean;
  salesCallRuleId: string;
  salesCallsEnabled: boolean;
  salesCallFullyConfigured: boolean;
};

export function ChannelsClient({
  whatsapp,
  callbackUrl,
  voximplant,
  voxCtxBase,
  voxCbBase,
  outreachEnabled,
  anyChannelReady,
}: {
  whatsapp: WhatsAppConfig;
  callbackUrl: string;
  voximplant: VoximplantConfig;
  voxCtxBase: string;
  voxCbBase: string;
  outreachEnabled: boolean;
  anyChannelReady: boolean;
}) {
  return (
    <div className="space-y-6">
      {/* single global master switch — ABOVE the tabs (§1.0) */}
      <OutreachMasterSwitch
        enabled={outreachEnabled}
        anyChannelReady={anyChannelReady}
      />

      <Tabs defaultValue="whatsapp">
        <TabsList>
          <TabsTab value="whatsapp">
            WhatsApp {whatsapp.configured ? '✓' : '⚠'}
          </TabsTab>
          <TabsTab value="voximplant">
            שיחות AI {voximplant.configured ? '✓' : '⚠'}
          </TabsTab>
        </TabsList>

        <TabsPanel value="whatsapp">
          <WhatsAppCredentialsForm
            whatsapp={whatsapp}
            callbackUrl={callbackUrl}
            outreachEnabled={outreachEnabled}
          />
          <WhatsAppConsentToggle consentRequired={whatsapp.consentRequired} />
          <WhatsAppConnectionTest />
        </TabsPanel>

        <TabsPanel value="voximplant">
          {/* This page always has the master switch above, so the state is never
              unknown here — the null branch exists for the Voximplant provider page,
              whose gate is manage_voice rather than manage_settings. */}
          <VoximplantStatusCard
            configured={voximplant.configured}
            liveEnabled={voximplant.liveEnabled}
            outreachEnabled={outreachEnabled}
          />
          <VoximplantLiveCallsToggle
            liveCalls={voximplant.liveCalls}
            fullyConfigured={voximplant.fullyConfigured}
          />
          <VoximplantMeetingConfirmToggle
            ruleId={voximplant.meetingConfirmRuleId}
            enabled={voximplant.meetingConfirmEnabled}
            fullyConfigured={voximplant.meetingConfirmFullyConfigured}
          />
          <VoximplantSalesCallToggle
            ruleId={voximplant.salesCallRuleId}
            enabled={voximplant.salesCallsEnabled}
            fullyConfigured={voximplant.salesCallFullyConfigured}
          />
          <VoximplantConsentToggle consentRequired={voximplant.callConsentRequired} />
          <VoximplantCredentialsForm
            voximplant={voximplant}
            voxCtxBase={voxCtxBase}
            voxCbBase={voxCbBase}
          />
          <VoximplantConnectionTest />
        </TabsPanel>
      </Tabs>
    </div>
  );
}
