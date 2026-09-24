import type { Metadata } from 'next';
import Link from 'next/link';
import { ChevronRight } from 'lucide-react';

import { requirePlatformOwner } from '@/lib/auth/dal';
import {
  OWNER_AGENT_AUDIT_LIMIT,
  getOwnerAgentSettings,
  listOwnerAgentAllowlist,
  listOwnerAgentAudit,
  listOwnerAgentNumbers,
  listOwnerAgentStaff,
} from '@/lib/data/admin/owner-agent';

import { PageHeading } from '../../_components';
import { AllowlistPanel } from './allowlist-panel';
import { AuditTable } from './audit-table';
import { NumberPicker } from './number-picker';
import { OwnerAgentDailyCapForm, OwnerAgentSwitch } from './owner-agent-settings-forms';

export const metadata: Metadata = { title: 'סוכן WhatsApp לבעלים — אינטגרציות' };

// The owner WhatsApp business-data agent, stage 2 of plans/owner-whatsapp-agent-plan.md:
// the kill switch, the number it answers on, the daily cap, the allow-list, and the
// recent audit. The webhook reads these settings (stage 4, src/lib/owner-agent/
// intake.ts): with a number selected, an allow-listed phone's messages to it are
// diverted and audited here. With no number selected (the default) nothing is.
// The reply process (stage 6, pm2 kalfa-owner-agent) answers them; it went live on
// 2026-09-24, so the page no longer carries a "no answers yet" notice.
//
// OWNER ONLY (decision 9.4, 2026-09-24). Every reader and writer below calls
// requirePlatformOwner itself, and so does every action; this page-level call is
// defence in depth, not the boundary. A non-owner is redirected, and the index card
// tells them so before they click (it is not a link for them).
//
// Loading and failure states are the admin area's own loading.tsx / error.tsx: a
// reader that throws shows the generic, privacy-safe error with a retry, never a
// half-rendered allow-list.

export default async function OwnerAgentPage() {
  await requirePlatformOwner();

  const [settings, numbers, entries, staff, audit] = await Promise.all([
    getOwnerAgentSettings(),
    listOwnerAgentNumbers(),
    listOwnerAgentAllowlist(),
    listOwnerAgentStaff(),
    listOwnerAgentAudit(),
  ]);

  const activeEntries = entries.filter((e) => e.enabled && e.isStaff).length;
  const staffNames = new Map(staff.map((s) => [s.userId, s.name ?? 'ללא שם']));

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
        <PageHeading>סוכן WhatsApp לבעלים</PageHeading>
        <p className="mt-1 text-sm text-muted-foreground">
          שאלות עסקיות בוואטסאפ, בקריאה בלבד, מהטלפונים שברשימת ההיתר בלבד. הודעה מכל
          שולח אחר ממשיכה במסלול של היום, בלי שינוי. העמוד הזה שמור לבעלי הפלטפורמה.
        </p>
      </div>

      <section className="space-y-3" aria-labelledby="owner-agent-switch-heading">
        <h2 id="owner-agent-switch-heading" className="text-lg font-semibold">
          הפעלה
        </h2>
        <OwnerAgentSwitch
          enabled={settings.enabled}
          numberSelected={settings.phoneNumberId !== null}
          activeEntries={activeEntries}
        />
      </section>

      <section
        className="space-y-3 rounded-lg border border-border bg-card p-5"
        aria-labelledby="owner-agent-number-heading"
      >
        <div>
          <h2 id="owner-agent-number-heading" className="text-lg font-semibold">
            מספר
          </h2>
          <p className="text-sm text-muted-foreground">
            כל מספרי ה-WhatsApp הפעילים שלנו, כולל מספרים שמשרתים אורחים. רק הודעות מטלפון שברשימת
            ההיתר, למספר שנבחר כאן, יגיעו לסוכן. התשובה יוצאת מאותו מספר.
          </p>
        </div>
        <NumberPicker numbers={numbers} selected={settings.phoneNumberId} />
        <Link
          href="/admin/integrations/numbers"
          className="inline-flex min-h-11 items-center text-sm text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        >
          ניהול המספרים ותפקידיהם
        </Link>
      </section>

      <section
        className="space-y-3 rounded-lg border border-border bg-card p-5"
        aria-labelledby="owner-agent-allowlist-heading"
      >
        <div>
          <h2 id="owner-agent-allowlist-heading" className="text-lg font-semibold">
            רשימת ההיתר
          </h2>
          <p className="text-sm text-muted-foreground">
            כל טלפון משויך לאיש צוות אחד. הסוכן עונה רק כשהטלפון זהה לטלפון המאומת של
            אותו איש צוות, ורק כל עוד הוא בצוות. איש הצוות מאמת את הטלפון שלו בעצמו,
            בקוד SMS, בהגדרות החשבון שלו.
          </p>
        </div>
        <AllowlistPanel entries={entries} staff={staff} />
      </section>

      <section className="space-y-3" aria-labelledby="owner-agent-cap-heading">
        <h2 id="owner-agent-cap-heading" className="text-lg font-semibold">
          תקרה יומית
        </h2>
        <OwnerAgentDailyCapForm dailyCap={settings.dailyCap} />
      </section>

      <section
        className="space-y-3 rounded-lg border border-border bg-card p-5"
        aria-labelledby="owner-agent-audit-heading"
      >
        <div>
          <h2 id="owner-agent-audit-heading" className="text-lg font-semibold">
            יומן אחרון
          </h2>
          <p className="text-sm text-muted-foreground">
            {OWNER_AGENT_AUDIT_LIMIT} הרשומות האחרונות: מזהים וקודים בלבד. תוכן השאלות והתשובות לא מוצג כאן
            ולא נשמר ביומן.
          </p>
        </div>
        <AuditTable rows={audit} staffNames={staffNames} />
      </section>
    </div>
  );
}
