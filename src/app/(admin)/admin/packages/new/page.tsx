import type { Metadata } from 'next';
import { requirePlatformPermission } from '@/lib/auth/dal';
import Link from 'next/link';

import { getVoximplantConfig } from '@/lib/data/voximplant-config';
import { getChannelCatalog } from '@/lib/data/channel-catalog';
import { getBaseOveragePricingEnabled } from '@/lib/data/payments';
import { PageHeading } from '../../_components';
import {
  PackageForm,
  type CallChannelStatus,
  type PricingModelStatus,
} from '../package-form';
import { createPackageAction } from '../actions';

export const metadata: Metadata = { title: 'חבילה חדשה' };

// Admin: create a new package. The form posts to createPackageAction, which
// validates server-side and redirects back to the list on success.
export default async function NewPackagePage() {
  // Optimistic gate: redirect early instead of rendering an empty page. The
  // real enforcement is per-function in the DAL.
  await requirePlatformPermission('manage_billing');
  // Real 3-state dial status of the AI-voice channel, so a `call` touchpoint shows
  // an accurate note (not_configured / configured_off / live) instead of a stale
  // "built but off" warning. getVoximplantConfig() reads app_settings via the
  // service-role client (no manage_voice needed on this manage_billing page).
  const voxCfg = await getVoximplantConfig();
  const callChannelStatus: CallChannelStatus =
    voxCfg == null ? 'not_configured' : voxCfg.liveCallsEnabled ? 'live' : 'configured_off';
  const channelOptions = await getChannelCatalog();
  // No saved package yet on the create page — surface only the gate state (the
  // per-package effective price appears once the package is saved and edited).
  const pricingModelStatus: PricingModelStatus = {
    gateActive: await getBaseOveragePricingEnabled(),
    effectiveSummaryHe: null,
  };
  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div className="space-y-1">
        <PageHeading>חבילה חדשה</PageHeading>
        <Link
          href="/admin/packages"
          className="text-sm text-muted-foreground hover:text-foreground"
        >
          חזרה לרשימת החבילות
        </Link>
      </div>

      <PackageForm
        action={createPackageAction}
        submitLabel="יצירת חבילה"
        callChannelStatus={callChannelStatus}
        channelOptions={channelOptions}
        pricingModelStatus={pricingModelStatus}
      />
    </div>
  );
}
