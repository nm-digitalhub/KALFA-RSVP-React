import { TriangleAlert } from 'lucide-react';

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import type { AdminCardcomConfig } from '@/lib/data/admin/integrations/cardcom-config';

import { Badge } from '../../_components';

// Its own file and its own test, like the other status cards: nested inside a page it would be invisible to the render
// walk, which does not invoke function components.
//
// What it shows is only what is KNOWN. There is no read-only connection check for CardCom in this system (SUMIT has
// one, `website/companies/getdetails`; none was built for CardCom), so the card never says "connected" — only whether
// a connection is saved, whether the pilot switch is on, and whether the saved terminal is CardCom's test terminal.

export function CardcomStatusCard({ config }: { config: AdminCardcomConfig }) {
  if (!config.exists) {
    return (
      <div className="rounded-lg border border-dashed border-border bg-muted/30 p-4 text-sm text-muted-foreground">
        לא הוזנו פרטי CardCom — אין מה להפעיל עדיין.
      </div>
    );
  }

  return (
    <div className="space-y-3 rounded-lg border border-border bg-card p-4">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant={config.enabled ? 'success' : 'neutral'}>
          {config.enabled ? 'מופעל — רכישות חבילה עוברות ל-CardCom' : 'כבוי — הרכישות נשארות אצל SUMIT'}
        </Badge>
        <Badge variant={config.hasPassword ? 'neutral' : 'warning'}>
          {config.hasPassword ? 'סיסמת API שמורה' : 'אין סיסמת API שמורה'}
        </Badge>
      </div>
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
        <dt className="text-muted-foreground">מספר מסוף</dt>
        <dd dir="ltr" className="text-start">{config.terminalNumber}</dd>
        <dt className="text-muted-foreground">שם API</dt>
        <dd dir="ltr" className="text-start">{config.apiName}</dd>
      </dl>
      {config.isTestTerminal ? (
        <Alert>
          <TriangleAlert aria-hidden />
          <AlertTitle>מסוף בדיקות של CardCom</AlertTitle>
          <AlertDescription>
            לא מחויב עליו כסף אמיתי. רכישת חבילה דרכו פתוחה למנהל פלטפורמה בלבד, ולא ללקוחות, גם כשהמתג מופעל.
          </AlertDescription>
        </Alert>
      ) : null}
    </div>
  );
}
