import type { Metadata } from 'next';
import Link from 'next/link';
import { ChevronRight } from 'lucide-react';

import { isPlatformOwner, requirePlatformPermission } from '@/lib/auth/dal';
import { listProviderNumbers } from '@/lib/data/admin/integrations/provider-numbers';
import { getIntegrationsConfiguredFlags } from '@/lib/ops/integrations';

import { PageHeading } from '../../_components';
import { AddNumberWizard } from './add-number-wizard';
import { MetaNumberManagement } from './meta-number-management';
import { NumbersTable } from './numbers-table';
import { RolesPanel } from './roles-panel';
import { SyncButtons } from './sync-buttons';
import {
  addNumberAction,
  assignRoleAction,
  deregisterNumberAction,
  registerNumberAction,
  requestCodeAction,
  syncMetaNumbersAction,
  syncVoximplantNumbersAction,
  verifyCodeAction,
} from './actions';

export const metadata: Metadata = { title: 'מספרים — אינטגרציות' };

// Every phone number this system is connected to, in one place, with what each one
// is FOR rather than which settings field it happens to live in.
//
// ⚠️ THE TABLE IS THE TRUTH, THE PROVIDER IS THE SOURCE. Nothing here calls Meta or
// Voximplant on render — the rows come from provider_numbers, and a live read
// happens only when someone presses sync. The plan's own note about
// getVoicePlatformView applies here too: an unbounded third-party latency in a hot
// render path is how an admin page becomes unopenable during a provider incident.
//
// The configured flags come from the credential-free RPC (booleans only, no secret
// crosses the process boundary), and they are what disables a sync button. An empty
// table cannot tell "no numbers yet" from "this provider was never connected", and
// only the second one is unfixable by pressing the button.

export default async function NumbersPage() {
  await requirePlatformPermission('manage_settings');

  const [numbers, flags, owner] = await Promise.all([
    listProviderNumbers(),
    getIntegrationsConfiguredFlags(),
    // Decides whether the LAST step of the wizard is drawn. It is not the gate —
    // registerNumberAction calls requirePlatformOwner itself, because a Server Action
    // is reachable without ever rendering the component that submits to it.
    isPlatformOwner(),
  ]);

  const withRoles = numbers.filter((n) => n.roles.length > 0).length;
  const unassigned = numbers.length - withRoles;

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
        <PageHeading>מספרים</PageHeading>
        <p className="mt-1 text-sm text-muted-foreground">
          כל מספר טלפון שהמערכת מחוברת אליו, ומה כל אחד מהם עושה. הרשימה נקראת
          מהמסד — פנייה חיה לספק קורית רק בלחיצה על סנכרון.
        </p>
      </div>

      <section className="space-y-4 rounded-lg border border-border bg-card p-5">
        <div className="flex flex-wrap items-baseline gap-x-6 gap-y-1">
          <p className="text-sm">
            <span className="text-2xl font-semibold">{numbers.length}</span>{' '}
            <span className="text-muted-foreground">מספרים רשומים</span>
          </p>
          {unassigned > 0 ? (
            <p className="text-sm text-amber-600">
              {unassigned} ללא תפקיד — לא ישמשו לשליחה או לחיוג עד שישויכו
            </p>
          ) : null}
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <SyncButtons
            syncMeta={syncMetaNumbersAction}
            syncVoximplant={syncVoximplantNumbersAction}
            metaConfigured={flags?.whatsapp_configured === true}
            voximplantConfigured={flags?.voximplant_configured === true}
          />
          {flags?.whatsapp_configured === true ? (
            <AddNumberWizard
              isOwner={owner}
              candidates={numbers.filter(
                (n) => n.provider === 'meta_whatsapp' && n.providerRef !== null,
              )}
              addAction={addNumberAction}
              requestCodeAction={requestCodeAction}
              verifyCodeAction={verifyCodeAction}
              registerAction={registerNumberAction}
            />
          ) : null}
        </div>
      </section>

      <section className="space-y-3 rounded-lg border border-border bg-card p-5">
        <h2 className="text-lg font-semibold">הרשימה</h2>
        <NumbersTable numbers={numbers} />
      </section>

      <section className="space-y-3 rounded-lg border border-border bg-card p-5">
        <div>
          <h2 className="text-lg font-semibold">תפקידים</h2>
          <p className="text-sm text-muted-foreground">
            מי עושה מה. כל תפקיד מוחזק ע&quot;י מספר אחד בדיוק — שינוי הבחירה מעביר
            אותו, ואין מצב ביניים שבו שני מספרים טוענים לאותו תפקיד.
          </p>
        </div>
        <RolesPanel numbers={numbers} onAssign={assignRoleAction} />
      </section>

      {owner ? (
        <section className="space-y-3 rounded-lg border border-destructive/30 bg-card p-5">
          <div>
            <h2 className="text-lg font-semibold">הסרת מספר מ-Cloud API</h2>
            <p className="text-sm text-muted-foreground">
              עוצר שליחה דרך המספר מיידית. Meta מתירה 10 פעולות רישום או הסרה למספר
              בכל 72 שעות וחוסמת אותו בפעם ה-11 — לכן הפעולה שמורה לבעלים.
            </p>
          </div>
          <MetaNumberManagement numbers={numbers} deregisterAction={deregisterNumberAction} />
        </section>
      ) : null}

      <section className="space-y-2 rounded-lg border border-border bg-card p-5">
        <h2 className="text-lg font-semibold">מה שאינו כאן</h2>
        <p className="text-sm text-muted-foreground">
          הוספת מספר ל-WhatsApp ואימותו נעשים כאן, בכפתור &quot;הוספת מספר&quot;.
          רכישת מספר חדש מספק — פעולה שעולה כסף — נשארת בעמוד הספק עצמו, וכך גם
          הגדרות החיבור והטוקנים.
        </p>
        <div className="flex flex-wrap gap-4">
          <Link
            href="/admin/integrations/meta-whatsapp"
            className="inline-flex min-h-11 items-center text-sm text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          >
            WhatsApp (Meta)
          </Link>
          <Link
            href="/admin/integrations/voximplant"
            className="inline-flex min-h-11 items-center text-sm text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          >
            Voximplant
          </Link>
          <Link
            href="/admin/integrations/extra-sms"
            className="inline-flex min-h-11 items-center text-sm text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          >
            ExtrA SMS
          </Link>
        </div>
      </section>
    </div>
  );
}
