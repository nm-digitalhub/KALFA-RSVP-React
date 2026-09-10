import type { Metadata } from 'next';
import Link from 'next/link';
import { ChevronRight } from 'lucide-react';

import { hasPlatformPermission, requirePlatformPermission } from '@/lib/auth/dal';
import { getVoximplantChannelConfig } from '@/lib/data/admin/voximplant-channel';
import { getOutreachMasterState } from '@/lib/data/admin/outreach-master';
import { getVoiceBalanceTile, getVoximplantWiringTile } from '@/lib/data/admin/voice-ops';
import { formatIsraelDateTime } from '@/lib/date';
import { getAppUrl } from '@/lib/url';

import { Badge, PageHeading } from '../../_components';
import {
  balanceVariant,
  formatBalance,
  WIRING_STATE_LABELS,
  WIRING_STATE_VARIANTS,
} from '../../voice/_helpers';
import { OutreachMasterSwitch } from '../_components/outreach-master-switch';
import { VoximplantStatusCard } from './voximplant-status-card';
import {
  VoximplantLiveCallsToggle,
  VoximplantMeetingConfirmToggle,
  VoximplantSalesCallToggle,
} from './voximplant-personas';
import { VoximplantConsentToggle } from './voximplant-consent-toggle';
import { VoximplantCredentialsForm } from './voximplant-credentials-form';
import { VoximplantConnectionTest } from './voximplant-connection-test';

export const metadata: Metadata = { title: 'Voximplant — אינטגרציות' };

// Everything about the Voximplant connection in one place: the three call kill
// switches, the §30א consent gate, account and dial credentials, budget limits, the
// scenario base URLs, a live balance/wiring tile and an on-demand connection test.
//
// ⚠️ THE GATE IS manage_voice, AND THE MASTER SWITCH IS manage_settings.
// Those are two different keys, and this page is written for the person who holds the
// first without the second. requirePlatformPermission REDIRECTS — to /app, out of the
// admin area entirely — so calling getOutreachMasterState() unconditionally would eject
// exactly that viewer the moment they opened the page. This branch has already shipped
// that bug once (getAdminNavCounts() calling requireAdmin() from the admin layout), so
// the switch is read ONLY behind hasPlatformPermission, and its absence is passed down
// as null rather than false — see voximplant-status-card.tsx for why the distinction
// is load-bearing.
//
// The plan (§Task 0.4, line 523) puts the same OutreachMasterSwitch at the head of both
// provider pages. That still holds for whoever may operate it; the null branch is the
// part the plan did not anticipate, and follows from its own §583 reasoning.
//
// It also deviates on the status tile: the plan says getVoicePlatformView().balance/
// wiring, but that function makes three LIVE Voximplant round-trips (call lists, audit
// log, media resources) and this page renders on every visit. Its own comment calls an
// uncached live call here "an unbounded-latency external dependency in a very hot render
// path". So it uses the cached balance tile plus the wiring row directly — one DB read,
// same data, and /admin/voice/platform still owns the full view.
//
// The old /admin/channels Voximplant tab renders THE SAME components: they were lifted
// into files, not copied, so there is one definition and the two surfaces cannot drift.
// The old page is retired in Task 0.6, as its own commit after a clean deploy.

const sectionClass = 'space-y-3';

export default async function VoximplantIntegrationPage() {
  await requirePlatformPermission('manage_voice');

  const canManageSettings = await hasPlatformPermission('manage_settings');
  const [voximplant, master, balance, wiring, voxCtxBase, voxCbBase] = await Promise.all([
    getVoximplantChannelConfig(),
    canManageSettings ? getOutreachMasterState() : Promise.resolve(null),
    getVoiceBalanceTile(),
    getVoximplantWiringTile(),
    getAppUrl('/api/voximplant/ctx'),
    getAppUrl('/api/voximplant/cb'),
  ]);

  return (
    <div className="space-y-6">
      <div>
        <Link
          href="/admin/integrations"
          className="inline-flex min-h-11 items-center gap-1 text-sm text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        >
          <ChevronRight className="size-4" aria-hidden />
          חזרה לאינטגרציות
        </Link>
        <PageHeading>Voximplant — שיחות AI</PageHeading>
        <p className="mt-1 text-sm text-muted-foreground">
          הפעלת שיחות חיות מתחילה חיוג אמיתי בתשלום. שיחה יוצאת דורשת גם את מתג
          הפנייה הראשי, גם את מתג השיחות החיות, וגם ש-VOXIMPLANT_LIVE_CALLS בשרת
          לא יכבה אותן.
        </p>
      </div>

      {master ? (
        <OutreachMasterSwitch enabled={master.enabled} anyChannelReady={master.anyChannelReady} />
      ) : null}

      <section className={sectionClass}>
        <h2 className="text-lg font-semibold">סטטוס</h2>
        <VoximplantStatusCard
          configured={voximplant.configured}
          liveEnabled={voximplant.liveEnabled}
          outreachEnabled={master ? master.enabled : null}
        />
        <dl className="grid gap-3 rounded-lg border border-border bg-card p-4 text-sm sm:grid-cols-3">
          <div>
            <dt className="text-muted-foreground">יתרה חיה</dt>
            <dd className="mt-1">
              {balance.status === 'ok' ? (
                <Badge
                  variant={balanceVariant(
                    balance.balance,
                    balance.minCallReserve,
                    balance.lowBalanceThreshold,
                  )}
                >
                  {formatBalance(balance.balance, balance.currency)}
                </Badge>
              ) : balance.status === 'unconfigured' ? (
                'הערוץ אינו מוגדר'
              ) : (
                'לא זמין'
              )}
            </dd>
          </div>
          <div>
            <dt className="text-muted-foreground">חיווט התראות יתרה</dt>
            <dd className="mt-1">
              <Badge variant={WIRING_STATE_VARIANTS[wiring.state] ?? 'neutral'}>
                {WIRING_STATE_LABELS[wiring.state] ?? wiring.state}
              </Badge>
            </dd>
          </div>
          <div>
            <dt className="text-muted-foreground">callback אחרון התקבל</dt>
            <dd className="mt-1" dir="ltr">
              {wiring.lastCallbackAt ? formatIsraelDateTime(wiring.lastCallbackAt) : '—'}
            </dd>
          </div>
        </dl>
        <p className="text-xs text-muted-foreground">
          חיווט ההתראות, יומן הביקורת, רשימות החיוג ורשימת ה-IP של הפלטפורמה מנוהלים
          בעמוד הפלטפורמה.{' '}
          <Link
            href="/admin/voice/platform"
            className="text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          >
            מעבר לפלטפורמה וניהול
          </Link>
        </p>
      </section>

      <section className={sectionClass}>
        <h2 className="text-lg font-semibold">מתגי חיוג</h2>
        <p className="text-sm text-muted-foreground">
          כל פרסונה מחייגת ל-Rule ID משלה. הפעלה נכשלת-סגור אם חסר חלק מהקונפיג —
          הבדיקה נעשית בשרת, לא כאן.
        </p>
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
      </section>

      <section className={sectionClass}>
        <h2 className="text-lg font-semibold">דרישת הסכמה</h2>
        <VoximplantConsentToggle consentRequired={voximplant.callConsentRequired} />
      </section>

      <section className={sectionClass}>
        <h2 className="text-lg font-semibold">פרטי חשבון, מגבלות וכתובות</h2>
        <VoximplantCredentialsForm
          voximplant={voximplant}
          voxCtxBase={voxCtxBase}
          voxCbBase={voxCbBase}
        />
      </section>

      <section className={sectionClass}>
        <h2 className="text-lg font-semibold">בדיקת חיבור</h2>
        <p className="text-sm text-muted-foreground">
          קריאה חיה אחת ל-Voximplant שמאמתת את חשבון השירות ומחזירה את היתרה. לא
          מתבצעת שיחה. בדיקת היתרה המתוזמנת רצה בנפרד ומופיעה בכרטיס באינטגרציות.
        </p>
        <VoximplantConnectionTest />
      </section>

      <section className={sectionClass}>
        <h2 className="text-lg font-semibold">מדיניות מוקד</h2>
        <p className="text-sm text-muted-foreground">
          מתגי המוקד (מענה נכנס, הקלטות, העברות) הם מדיניות ולא חיבור, ולכן נשארים
          בהגדרות המערכת.
        </p>
        <Link
          href="/admin/settings"
          className="inline-flex min-h-11 items-center text-sm text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        >
          מעבר להגדרות › שיחות
        </Link>
      </section>
    </div>
  );
}
