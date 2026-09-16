import type { Metadata } from 'next';
import Link from 'next/link';
import { ChevronRight, Link2 } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { buttonVariants } from '@/components/ui/button';
import { hasPlatformPermission, requirePlatformPermission } from '@/lib/auth/dal';
import { readOAuthProviderConfig } from '@/lib/data/admin/integrations/oauth-provider-config';
import { listMicrosoftWorkflowConnectionsForAdmin } from '@/lib/data/admin/integrations/workflow-connections';
import { cn } from '@/lib/utils';

import { EmptyState, PageHeading, firstParam, formatDateTime } from '../../_components';
import { OAuthOutcome } from './oauth-outcome';
import { ProviderConfigurationForm } from './provider-configuration-form';

export const metadata: Metadata = { title: 'Workflow OAuth — אינטגרציות' };

const MICROSOFT_OAUTH_START_HREF =
  '/api/integrations/oauth/start?provider=microsoft&capability=mail.send&redirectTo=%2Fadmin%2Fintegrations%2Fworkflow-oauth';

type SearchParams = Promise<{ oauth?: string | string[] }>;

function statusLabel(status: string): string {
  if (status === 'active') return 'פעיל';
  if (status === 'disabled') return 'כבוי';
  if (status === 'revoked') return 'בוטל';
  if (status === 'error') return 'שגיאה';
  return 'לא פעיל';
}

export default async function WorkflowOAuthAdminPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  await requirePlatformPermission('integrations.read');

  const [params, config, connections, canManage] = await Promise.all([
    searchParams,
    readOAuthProviderConfig('microsoft'),
    listMicrosoftWorkflowConnectionsForAdmin(),
    hasPlatformPermission('integrations.manage'),
  ]);
  const oauthOutcome = firstParam(params.oauth);
  const canConnect = canManage && config.configured && config.enabled;

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
        <PageHeading>OAuth לתהליכי עבודה</PageHeading>
        <p className="mt-1 text-sm text-muted-foreground">
          הגדרת אפליקציית Microsoft וחיבור חשבונות מורשים לשליחת דואר מצומתי Workflow.
          בתהליך נשמר בדיאגרמה רק מזהה החיבור.
        </p>
      </div>

      <OAuthOutcome value={oauthOutcome} />

      <section className="space-y-4 rounded-lg border border-border bg-card p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold">הגדרת ספק Microsoft</h2>
            <p className="text-sm text-muted-foreground">
              פרטי אפליקציית OAuth מסוג delegated ב-Microsoft Entra.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Badge variant={config.configured ? 'success' : 'neutral'}>
              {config.configured ? 'מוגדר' : 'לא מוגדר'}
            </Badge>
            <Badge variant={config.enabled ? 'success' : 'warning'}>
              {config.enabled ? 'פעיל' : 'כבוי'}
            </Badge>
          </div>
        </div>

        {config.updatedAt ? (
          <p className="text-xs text-muted-foreground">
            עודכן לאחרונה: {formatDateTime(config.updatedAt)}
          </p>
        ) : null}

        {canManage ? (
          <ProviderConfigurationForm
            clientId={config.clientId}
            enabled={config.enabled}
            hasStoredSecret={config.configured}
          />
        ) : (
          <p className="rounded-md bg-muted px-3 py-2 text-sm text-muted-foreground">
            ההגדרה מוצגת לקריאה בלבד. נדרשת הרשאת ניהול אינטגרציות כדי לשנות אותה.
          </p>
        )}
      </section>

      <section className="space-y-4 rounded-lg border border-border bg-card p-5">
        <div>
          <h2 className="text-lg font-semibold">חיבור חשבון Microsoft 365</h2>
          <p className="text-sm text-muted-foreground">
            החיבור משתמש בזרימת ה-OAuth הקיימת ומבקש את היכולת לשלוח דואר בלבד.
          </p>
        </div>

        {canConnect ? (
          <Link
            href={MICROSOFT_OAUTH_START_HREF}
            className={cn(buttonVariants({ size: 'lg' }), 'w-fit')}
          >
            <Link2 className="size-4" aria-hidden />
            חיבור חשבון Microsoft 365
          </Link>
        ) : (
          <div className="space-y-2">
            <span
              aria-disabled="true"
              className={cn(buttonVariants({ size: 'lg' }), 'w-fit cursor-not-allowed opacity-50')}
            >
              <Link2 className="size-4" aria-hidden />
              חיבור חשבון Microsoft 365
            </span>
            <p className="text-xs text-muted-foreground">
              {!canManage
                ? 'נדרשת הרשאת ניהול אינטגרציות כדי לחבר חשבון.'
                : !config.configured
                  ? 'יש לשמור Client ID ו-Client Secret לפני חיבור חשבון.'
                  : 'הספק כבוי. הפעילו אותו ושמרו לפני חיבור חשבון.'}
            </p>
          </div>
        )}
      </section>

      <section className="space-y-4">
        <div>
          <h2 className="text-lg font-semibold">חיבורי Microsoft לתהליכי עבודה</h2>
          <p className="text-sm text-muted-foreground">
            מוצגים רק פרטי מצב בטוחים; פרטי ההרשאה והאסימונים נשארים בצד השרת.
          </p>
        </div>

        {connections.length === 0 ? (
          <EmptyState>אין חיבורי Microsoft 365 פעילים לתהליכי עבודה.</EmptyState>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            {connections.map((connection) => (
              <article
                key={`${connection.label}-${connection.createdAt}`}
                className={cn(
                  'space-y-3 rounded-lg border bg-card p-4',
                  connection.mailSendReady ? 'border-success/40' : 'border-border',
                )}
              >
                <div className="flex items-start justify-between gap-3">
                  <h3 className="font-medium">{connection.label}</h3>
                  <Badge variant={connection.mailSendReady ? 'success' : 'neutral'}>
                    {connection.mailSendReady ? 'Mail.Send פעיל' : statusLabel(connection.status)}
                  </Badge>
                </div>
                <dl className="space-y-1 text-xs text-muted-foreground">
                  <div className="flex gap-2">
                    <dt>נוצר:</dt>
                    <dd>{formatDateTime(connection.createdAt)}</dd>
                  </div>
                  <div className="flex gap-2">
                    <dt>עודכן:</dt>
                    <dd>{formatDateTime(connection.updatedAt)}</dd>
                  </div>
                </dl>
              </article>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
