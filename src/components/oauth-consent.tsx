'use client';

import type { ComponentPropsWithoutRef, ReactNode } from 'react';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useOAuthConsent, type OAuthConsentDecision } from '@/hooks/use-oauth-consent';
import { cn } from '@/lib/utils';

// From the Supabase UI Library `oauth-consent-nextjs` block, adapted to KALFA:
// Hebrew copy, logical (RTL-safe) alignment, and our shadcn primitives.

const getInitial = (value: string) => value.trim().charAt(0).toUpperCase() || '?';

interface ConsentCardShellProps extends ComponentPropsWithoutRef<'div'> {
  clientName: string;
  productName: string;
}

function ConsentCardShell({ clientName, productName, className, children, ...props }: ConsentCardShellProps) {
  return (
    <div className={cn('flex flex-col gap-6', className)} {...props}>
      <Card>
        <CardHeader className="items-center space-y-4 text-center">
          <div className="flex items-center justify-center" role="img" aria-label={`${clientName} מתחבר אל ${productName}`}>
            <div className="flex size-12 items-center justify-center rounded-full border bg-muted font-medium">
              {getInitial(clientName)}
            </div>
            <div className="h-px w-8 bg-border" aria-hidden="true" />
            <div className="flex size-12 items-center justify-center rounded-full border bg-muted font-medium">
              {getInitial(productName)}
            </div>
          </div>
          <div className="space-y-1.5">
            <CardTitle className="text-2xl">
              אישור גישה ל־<bdi>{clientName}</bdi>
            </CardTitle>
            <CardDescription>בדקו לאיזה מידע האפליקציה מבקשת גישה.</CardDescription>
          </div>
        </CardHeader>
        <CardContent className="space-y-6">{children}</CardContent>
      </Card>
    </div>
  );
}

function DetailRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-6 p-4">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="min-w-0 break-all text-end font-medium">{children}</dd>
    </div>
  );
}

export interface OAuthConsentCardProps extends ComponentPropsWithoutRef<'div'> {
  clientName: string;
  productName?: string;
  redirectUri: string;
  email: string | null;
  scopes?: string[];
  error?: string | null;
  decision?: OAuthConsentDecision | null;
  onApprove?: () => void;
  onDeny?: () => void;
}

export function OAuthConsentCard({
  clientName,
  productName = 'KALFA',
  redirectUri,
  email,
  scopes = [],
  error = null,
  decision = null,
  onApprove,
  onDeny,
  ...props
}: OAuthConsentCardProps) {
  return (
    <ConsentCardShell clientName={clientName} productName={productName} {...props}>
      <dl className="divide-y rounded-lg border text-sm">
        <DetailRow label="אפליקציה">
          <bdi>{clientName}</bdi>
        </DetailRow>
        {redirectUri && (
          <DetailRow label="תועברו אל">
            <span dir="ltr">{redirectUri}</span>
          </DetailRow>
        )}
        {email && (
          <DetailRow label="מחוברים בתור">
            <span dir="ltr">{email}</span>
          </DetailRow>
        )}
        {scopes.length > 0 && (
          <DetailRow label="הרשאות">
            <span dir="ltr">{scopes.join(', ')}</span>
          </DetailRow>
        )}
      </dl>
      <p className="text-sm text-muted-foreground">
        אשרו רק אם אתם מזהים את האפליקציה. היא תוכל לפעול בשמכם רק בגבולות ההרשאות המבוקשות והגישה שכבר יש לכם.
      </p>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button type="button" variant="outline" disabled={decision !== null} onClick={onDeny}>
          {decision === 'deny' ? 'דוחה…' : 'דחייה'}
        </Button>
        <Button type="button" disabled={decision !== null} onClick={onApprove}>
          {decision === 'approve' ? 'מאשר…' : 'אישור גישה'}
        </Button>
      </div>
    </ConsentCardShell>
  );
}

interface OAuthConsentProps extends ComponentPropsWithoutRef<'div'> {
  authorizationId?: string | null;
  signInPath?: string;
  productName?: string;
}

export function OAuthConsent({
  authorizationId,
  signInPath = '/auth/login',
  productName = 'KALFA',
  ...props
}: OAuthConsentProps) {
  const { view, error, isLoading, decision, approve, deny } = useOAuthConsent({
    authorizationId,
    signInPath,
  });

  if (isLoading || !view) {
    return (
      <ConsentCardShell clientName="אפליקציה" productName={productName} {...props}>
        {isLoading ? (
          <p role="status" className="text-sm text-muted-foreground">
            טוען את בקשת ההרשאה…
          </p>
        ) : (
          <p role="alert" className="text-sm text-destructive">
            {error ?? 'לא הצלחנו לטעון את בקשת ההרשאה. התחילו שוב מהאפליקציה שביקשה גישה.'}
          </p>
        )}
      </ConsentCardShell>
    );
  }

  return (
    <OAuthConsentCard
      clientName={view.clientName}
      productName={productName}
      redirectUri={view.redirectUri}
      email={view.email}
      scopes={view.scopes}
      error={error}
      decision={decision}
      onApprove={() => void approve()}
      onDeny={() => void deny()}
      {...props}
    />
  );
}
