'use client';

import {
  JsonFormsDispatch,
  and,
  optionIs,
  rankWith,
  useWorkflowBuilderActions,
  withJsonFormsControlProps,
  type ControlProps,
  type JsonFormsRendererExtension,
} from '@workflowbuilder/sdk';
import { Link2 } from 'lucide-react';
import {
  createContext,
  useContext,
  useState,
  type ReactNode,
} from 'react';

import { Button } from '@/components/ui/button';
import { INTEGRATION_CONNECTION_FORMAT } from '@/lib/workflow/catalogue/ui-formats';

const MICROSOFT_PROVIDER = 'microsoft';
const MICROSOFT_MAIL_CAPABILITY = 'mail.send';

type OAuthConnectionContextValue = {
  workflowId: string;
  canConnectMicrosoft: boolean;
  unavailableReason: string | null;
};

const OAuthConnectionContext = createContext<OAuthConnectionContextValue | null>(
  null,
);

export function OAuthConnectionProvider({
  workflowId,
  canConnectMicrosoft,
  unavailableReason,
  children,
}: OAuthConnectionContextValue & { children: ReactNode }) {
  return (
    <OAuthConnectionContext.Provider
      value={{ workflowId, canConnectMicrosoft, unavailableReason }}
    >
      {children}
    </OAuthConnectionContext.Provider>
  );
}

/**
 * The existing start Route Handler remains the only OAuth entry point.
 * This helper supplies catalogue constants and a same-app return path; the
 * route/flow still owns state, PKCE, scopes, redirect_uri and the provider URL.
 */
export function microsoftOAuthStartHref(workflowId: string): string {
  const redirectTo = `/admin/workflows/${encodeURIComponent(workflowId)}`;
  const params = new URLSearchParams({
    provider: MICROSOFT_PROVIDER,
    capability: MICROSOFT_MAIL_CAPABILITY,
    redirectTo,
  });
  return `/api/integrations/oauth/start?${params.toString()}`;
}

export async function saveWorkflowBeforeOAuth(
  save: () => Promise<'success' | 'error' | 'alreadyStarted'>,
  navigate: (href: string) => void,
  href: string,
): Promise<boolean> {
  const status = await save();
  if (status !== 'success') return false;
  navigate(href);
  return true;
}

type ControlUiSchema = ControlProps['uischema'];

/**
 * Remove the marker that selected this renderer before delegating to the SDK.
 * Leaving `options.format` in place would make JsonForms select this renderer
 * again and recurse forever. Provider/capability are renderer configuration,
 * not props understood by the built-in Select, so they are removed as well.
 */
export function delegatedSelectUiSchema(
  uischema: ControlUiSchema,
): ControlUiSchema {
  const options = uischema.options as
    | Record<string, unknown>
    | undefined;
  if (!options) return uischema;

  const {
    format: _format,
    provider: _provider,
    capability: _capability,
    ...selectOptions
  } = options;

  return {
    ...uischema,
    options:
      Object.keys(selectOptions).length > 0 ? selectOptions : undefined,
  };
}

function IntegrationConnectionControl({
  uischema,
  rootSchema,
  enabled,
  readonly,
}: ControlProps) {
  const context = useContext(OAuthConnectionContext);
  const { save } = useWorkflowBuilderActions();
  const [isConnecting, setIsConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const options = uischema.options as
    | { provider?: unknown; capability?: unknown }
    | undefined;
  const isMicrosoftMail =
    options?.provider === MICROSOFT_PROVIDER &&
    options.capability === MICROSOFT_MAIL_CAPABILITY;
  const canStart =
    Boolean(context?.canConnectMicrosoft) &&
    isMicrosoftMail &&
    enabled !== false &&
    readonly !== true &&
    !isConnecting;

  const connect = async () => {
    if (!context || !canStart) return;

    setIsConnecting(true);
    setError(null);
    try {
      // Redirecting before this resolves would discard unsaved node changes.
      // Only a confirmed SDK save is allowed to leave the editor.
      const started = await saveWorkflowBeforeOAuth(
        save,
        (href) => window.location.assign(href),
        microsoftOAuthStartHref(context.workflowId),
      );
      if (!started) {
        setError('לא ניתן היה לשמור את התהליך. נסו שוב לפני חיבור החשבון.');
        setIsConnecting(false);
        return;
      }
    } catch {
      setError('לא ניתן היה לשמור את התהליך. נסו שוב לפני חיבור החשבון.');
      setIsConnecting(false);
    }
  };

  return (
    <div className="flex flex-col gap-2">
      {/*
        Delegate the field itself to WorkflowBuilder's built-in Select. The
        format marker is stripped first so this custom renderer cannot select
        itself recursively. JsonForms still owns data/path/handleChange, hence
        the selected connection UUID is the only value written to the node.
      */}
      <JsonFormsDispatch
        schema={rootSchema}
        uischema={delegatedSelectUiSchema(uischema)}
        enabled={enabled}
        readonly={readonly}
      />

      <Button
        type="button"
        variant="outline"
        size="sm"
        className="self-start"
        disabled={!canStart}
        onClick={connect}
      >
        <Link2 aria-hidden="true" className="size-4" />
        {isConnecting ? 'שומר ופותח…' : 'חיבור חשבון חדש'}
      </Button>

      {!context?.canConnectMicrosoft && context?.unavailableReason ? (
        <p className="text-xs text-muted-foreground">
          {context.unavailableReason}
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}

export const integrationConnectionRenderer: JsonFormsRendererExtension = {
  tester: rankWith(
    5000,
    and(
      optionIs('format', INTEGRATION_CONNECTION_FORMAT),
      optionIs('provider', MICROSOFT_PROVIDER),
      optionIs('capability', MICROSOFT_MAIL_CAPABILITY),
    ),
  ),
  renderer: withJsonFormsControlProps(IntegrationConnectionControl),
};
