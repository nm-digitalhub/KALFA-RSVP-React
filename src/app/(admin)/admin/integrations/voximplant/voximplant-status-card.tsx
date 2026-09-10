'use client';

import {
  StatusBadge,
  statusBadgeClass,
  statusBadgeNeutralTone,
} from '../_components/form-fields';

// The Voximplant channel's status line. Lifted out of channels-client.tsx, with ONE
// addition the move forced: `outreachEnabled` may now be null.
//
// WHY NULL EXISTS. The master switch is `manage_settings`; this page is
// `manage_voice`. Those are different keys, and a staff member may hold the second
// without the first — the ops engineer this page is written for. getOutreachMasterState()
// calls requirePlatformPermission('manage_settings'), which REDIRECTS rather than
// returning false, so the page must not call it for such a viewer at all. It then has
// no honest value to pass here.
//
// Null is NOT rendered as `false`. "Switched off" and "you cannot see whether it is
// switched off" are different facts, and a badge reading "מוגדר · כבוי" for the second
// would send an ops engineer to debug a switch that is, in fact, on. So the null branch
// reports only what this page can actually establish — credentials present, live-calls
// gate — and says plainly that the rest is not visible at this permission level.

export function VoximplantStatusCard({
  configured,
  liveEnabled,
  outreachEnabled,
}: {
  configured: boolean;
  liveEnabled: boolean;
  /** null = the viewer may not read the master switch (see above). Never coerce to false. */
  outreachEnabled: boolean | null;
}) {
  if (outreachEnabled === null) {
    return (
      <div className="flex flex-col gap-2 rounded-lg border border-border bg-card p-4 sm:flex-row sm:items-center sm:gap-3">
        <span className={`${statusBadgeClass} ${statusBadgeNeutralTone} w-fit shrink-0`}>
          {!configured
            ? 'לא מוגדר'
            : liveEnabled
              ? 'מוגדר · שיחות חיות דלוקות'
              : 'מוגדר · שיחות חיות כבויות'}
        </span>
        <span className="text-sm text-muted-foreground">
          מצב מתג הפנייה הראשי אינו מוצג בהרשאה זו — הוא דורש הרשאת הגדרות מערכת.
          שיחות יוצאות בפועל רק כאשר גם הוא דלוק.
        </span>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2 rounded-lg border border-border bg-card p-4 sm:flex-row sm:items-center sm:gap-3">
      <StatusBadge
        configured={configured}
        enabled={outreachEnabled && configured}
        liveGateOff={!liveEnabled}
      />
      <span className="text-sm text-muted-foreground">
        {liveEnabled
          ? 'שיחות חיות מופעלות — שיחות בתשלום יוצאות בפועל.'
          : 'שיחות חיות כבויות (מצב dark). הפעילו במתג שיחות חיות.'}
      </span>
    </div>
  );
}
