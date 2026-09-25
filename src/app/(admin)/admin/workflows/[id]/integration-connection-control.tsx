'use client';

import {
  and,
  FormControlWithLabel,
  JsonFormsDispatch,
  optionIs,
  rankWith,
  useWorkflowBuilderActions,
  withJsonFormsControlProps,
  type ControlProps,
  type JsonFormsRendererExtension,
} from '@workflowbuilder/sdk';
import { Link2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';

// The editor's own component library (@workflowbuilder/ui, the SDK's successor to
// overflow-ui), not the app's shadcn primitives: it carries the editor's tokens.
import { Button } from '@workflowbuilder/ui';
import {
  OAUTH_POPUP_CHANNEL,
  OAUTH_POPUP_PARAM,
  OAUTH_POPUP_TAG,
  OAUTH_POPUP_VALUE,
} from '@/lib/integrations/oauth-popup-constants';
import { INTEGRATION_CONNECTION_FORMAT } from '@/lib/workflow/catalogue/ui-formats';


const MICROSOFT_PROVIDER = 'microsoft';
const MICROSOFT_MAIL_CAPABILITY = 'mail.send';

type OAuthConnectionContextValue = {
  workflowId: string;
  canConnectMicrosoft: boolean;
  unavailableReason: string | null;
  /**
   * Whether ANY connection exists to choose from.
   *
   * ⚠️ IT DECIDES WHETHER A PICKER IS SHOWN AT ALL. With none, a select is an
   * empty menu standing in front of the only action available — see the branch
   * in the renderer below. Passed down rather than read off the schema because
   * the page already counted them to build the options.
   */
  hasConnections: boolean;
};

const OAuthConnectionContext = createContext<OAuthConnectionContextValue | null>(
  null,
);

export function OAuthConnectionProvider({
  workflowId,
  canConnectMicrosoft,
  unavailableReason,
  hasConnections,
  children,
}: OAuthConnectionContextValue & { children: ReactNode }) {
  return (
    <OAuthConnectionContext.Provider
      value={{
        workflowId,
        canConnectMicrosoft,
        unavailableReason,
        hasConnections,
      }}
    >
      {children}
    </OAuthConnectionContext.Provider>
  );
}

/**
 * The connection ids the picker can currently offer.
 *
 * Read off the node schema because that is where they are: `schemas.ts` builds
 * `connectionId.options` from the rows the page loaded, so the control never
 * fetches anything of its own.
 */
export function connectionOptionValues(rootSchema: unknown): string[] {
  const options = (
    rootSchema as
      | { properties?: { connectionId?: { options?: Array<{ value?: unknown }> } } }
      | undefined
  )?.properties?.connectionId?.options;

  if (!Array.isArray(options)) return [];
  return options
    .map((option) => option?.value)
    .filter((value): value is string => typeof value === 'string');
}

/**
 * Whether the node points at a connection the picker cannot offer.
 *
 * ⚠️ THIS IS A SILENT RUN-TIME FAILURE TODAY. `listActiveMicrosoftWorkflowConnections`
 * filters `status = 'active'`, so the moment a connection turns
 * `requires_reauthorization`, `revoked` or `error` it DROPS OUT OF THE OPTIONS —
 * while `connectionId` still holds its uuid. The select renders blank, the arm
 * gate is satisfied (the field is non-empty), and the workflow arms and then
 * fails when it runs.
 *
 * n8n names the same state rather than hiding it: `getSelectPlaceholder` swaps in
 * `selectedCredentialUnavailable` when a credential is selected and has issues,
 * and `CredentialConfig` calls the equivalent condition `isStale` — "connected,
 * but the last test failed".
 *
 * An empty selection is NOT this case: nothing was chosen, which the arm gate
 * already reports by name.
 */
export function selectedConnectionUnavailable(data: unknown, rootSchema: unknown): boolean {
  if (typeof data !== 'string' || data.trim() === '') return false;
  return !connectionOptionValues(rootSchema).includes(data);
}

/**
 * The existing start Route Handler remains the only OAuth entry point.
 * This helper supplies catalogue constants and a same-app return path; the
 * route/flow still owns state, PKCE, scopes, redirect_uri and the provider URL.
 */
export function microsoftOAuthStartHref(
  workflowId: string,
  mode: 'popup' | 'redirect' = 'popup',
): string {
  // ⚠️ THE FLAG GOES INSIDE `redirectTo` AND NOWHERE ELSE.
  //
  // It briefly also rode on the start URL itself, on the theory that the
  // callback's failure branch could read it when the state row was unreachable.
  // It cannot: the callback is called by the PROVIDER, whose request carries
  // `code` and `state` and nothing of ours. That copy was therefore always
  // absent, the failure branch always took the redirect, and a popup was sent to
  // /admin/integrations instead of reporting to the editor waiting on it —
  // observed live 2026-09-17.
  //
  // Inside `redirectTo` it survives, because `start` sanitises that value and
  // stores it in the state row, which the SUCCESS path reads back. The failure
  // path needs no flag at all now: the bridge document decides what it is by
  // looking at `window.opener`.
  const redirectTo =
    `/admin/workflows/${encodeURIComponent(workflowId)}` +
    (mode === 'popup' ? `?${OAUTH_POPUP_PARAM}=${OAUTH_POPUP_VALUE}` : '');

  return `/api/integrations/oauth/start?${new URLSearchParams({
    provider: MICROSOFT_PROVIDER,
    capability: MICROSOFT_MAIL_CAPABILITY,
    redirectTo,
  }).toString()}`;
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

/**
 * How long to wait for the popup to report back.
 *
 * ⚠️ FIVE MINUTES, AND THE NUMBER IS MEASURED. Two complete OAuth round trips
 * through n8n's live product on 2026-09-17 took 29s and 208s — the second one
 * because the account had to be typed, chosen and consented to. A 60-second
 * timeout, which felt generous when this was a guess, would have failed a flow
 * that was still working. n8n uses the same five minutes
 * (`oauthCallback.ts:11`), which is the only other measurement available.
 */
export const OAUTH_POPUP_TIMEOUT_MS = 5 * 60_000;

export type OAuthPopupMessage =
  | { tag: string; ok: true; connectionId: string }
  | { tag: string; ok: false; reason: string };

/**
 * Whether a `message` event is a report from OUR popup.
 *
 * Three gates, and each one is load-bearing. The origin must be ours, because
 * any page may post to a window it holds a handle on. The tag must match,
 * because the same origin also posts editor-internal messages — n8n's own
 * traffic carries `{"command":"openNDV"}` over exactly this channel, measured
 * live. And the shape must hold, because a match on the first two still says
 * nothing about what the payload contains.
 */
export function parseOAuthPopupMessage(
  data: unknown,
  origin: string,
  expectedOrigin: string,
): OAuthPopupMessage | null {
  if (origin !== expectedOrigin) return null;
  if (typeof data !== 'object' || data === null) return null;
  const m = data as Record<string, unknown>;
  if (m.tag !== OAUTH_POPUP_TAG) return null;
  if (m.ok === true && typeof m.connectionId === 'string' && m.connectionId !== '') {
    return { tag: OAUTH_POPUP_TAG, ok: true, connectionId: m.connectionId };
  }
  if (m.ok === false) {
    return { tag: OAUTH_POPUP_TAG, ok: false, reason: typeof m.reason === 'string' ? m.reason : 'failed' };
  }
  return null;
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
  data,
  handleChange,
  label,
  path,
}: ControlProps) {
  const context = useContext(OAuthConnectionContext);
  const { save } = useWorkflowBuilderActions();
  const router = useRouter();
  const [isConnecting, setIsConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // ⚠️ THE SELECTION IS DEFERRED, NOT APPLIED ON ARRIVAL.
  //
  // The popup reports a `connectionId` that the picker cannot offer yet: the
  // options come from the server render, and `router.refresh()` has only just
  // been asked for. Writing it immediately would set the node to a value absent
  // from `connectionId.options`, which `selectedConnectionUnavailable` reads as
  // a revoked connection and flags in red — the success path rendering itself
  // as a failure.
  //
  // So it is parked here, and the effect below applies it on the first render
  // where the option actually exists.
  const pending = useRef<string | null>(null);

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

    // ⚠️ THE WINDOW OPENS FIRST, BEFORE THE SAVE AND BEFORE ANY NETWORK CALL.
    //
    // `window.open` is only permitted inside the click's transient user
    // activation, and the activation expires — Chrome gives roughly five
    // seconds. Awaiting the save first and opening afterwards works on a fast
    // connection and is silently blocked on a slow one, which is the worst kind
    // of bug: it passes every test and fails for the user whose save took a
    // moment.
    //
    // This is n8n's ordering too, and it was measured rather than read: in a
    // live run on 2026-09-17 their `window.open` fired 476ms BEFORE the POST
    // that creates the credential. So the window opens blank and is navigated
    // once the URL is known.
    const popup = window.open('about:blank', 'kalfa-oauth', 'width=520,height=720');
    if (!popup) {
      setError('הדפדפן חסם את חלון ההתחברות. אפשרו חלונות קופצים לאתר ונסו שוב.');
      return;
    }

    setIsConnecting(true);
    setError(null);

    try {
      // The editor itself never navigates now, but an unsaved canvas would
      // still be lost if the refresh below remounted it. A confirmed save is
      // what makes the refresh safe.
      const started = await saveWorkflowBeforeOAuth(
        save,
        (href) => {
          popup.location.href = href;
        },
        microsoftOAuthStartHref(context.workflowId, 'popup'),
      );
      if (!started) {
        popup.close();
        setError('לא ניתן היה לשמור את התהליך. נסו שוב לפני חיבור החשבון.');
        setIsConnecting(false);
      }
    } catch {
      popup.close();
      setError('לא ניתן היה לשמור את התהליך. נסו שוב לפני חיבור החשבון.');
      setIsConnecting(false);
    }
  };

  // ── listen for the popup's report ────────────────────────────────────────
  //
  // ⚠️ BOTH CHANNELS, AND THAT IS A MEASUREMENT RATHER THAN CAUTION. Two live
  // OAuth round trips through n8n on 2026-09-17: the first delivered on
  // `BroadcastChannel` and `postMessage` 25ms apart; the second delivered ONLY
  // on `postMessage` — the channel never fired at all. Same origin, same code,
  // minutes apart. Listening on one would have hung a successful connection
  // until the timeout.
  useEffect(() => {
    if (!isConnecting) return;

    let settled = false;
    const finish = (outcome: OAuthPopupMessage) => {
      if (settled) return;
      settled = true;
      setIsConnecting(false);
      if (outcome.ok) {
        // Park it, then ask the server for the list that contains it. The
        // effect below selects it once the option exists.
        pending.current = outcome.connectionId;
        router.refresh();
      } else {
        setError('החיבור לא הושלם. נסו שוב.');
      }
    };

    const expected = window.location.origin;
    const onWindowMessage = (event: MessageEvent) => {
      const parsed = parseOAuthPopupMessage(event.data, event.origin, expected);
      if (parsed) finish(parsed);
    };

    let channel: BroadcastChannel | null = null;
    try {
      channel = new BroadcastChannel(OAUTH_POPUP_CHANNEL);
      // A BroadcastChannel message carries no origin of its own — the channel
      // IS origin-scoped by the platform — so the expected origin is passed as
      // both arguments rather than pretending to check something.
      channel.onmessage = (event) => {
        const parsed = parseOAuthPopupMessage(event.data, expected, expected);
        if (parsed) finish(parsed);
      };
    } catch {
      // No BroadcastChannel in this browser. `postMessage` still covers it.
    }

    window.addEventListener('message', onWindowMessage);
    const timer = window.setTimeout(() => {
      if (settled) return;
      settled = true;
      setIsConnecting(false);
      setError('החיבור לא הושלם בזמן. נסו שוב.');
    }, OAUTH_POPUP_TIMEOUT_MS);

    return () => {
      window.clearTimeout(timer);
      window.removeEventListener('message', onWindowMessage);
      channel?.close();
    };
  }, [isConnecting, router]);

  // ── apply the parked selection, once the option exists ───────────────────
  const available = connectionOptionValues(rootSchema);
  useEffect(() => {
    const id = pending.current;
    if (id === null) return;
    if (!available.includes(id)) return;   // the refresh has not landed yet
    pending.current = null;
    handleChange(path, id);
  }, [available, handleChange, path]);

  // ⚠️ AN EMPTY SELECT IS NOT A NEUTRAL STATE. With no connection stored there is
  // nothing to choose, so a menu is a dead control standing in front of the one
  // action that matters. n8n reaches the same conclusion structurally: in
  // `NodeCredentials.vue` the `<N8nSelect>` is the LAST branch — `options.length
  // === 0` is checked first and renders a connect button in its place, with
  // "or setup manually" demoted to a link beside it.
  //
  // The list itself is unchanged; only whether it is drawn.
  const showPicker = context?.hasConnections !== false;
  const isUnavailable = selectedConnectionUnavailable(data, rootSchema);

  // ⚠️ THIS PANEL PICKS AN ACCOUNT. IT DOES NOT CONFIGURE A PROVIDER.
  //
  // For a while it did both: a "set up Microsoft provider" button opened a modal
  // holding the client id, the client secret and the redirect URI. That is a
  // DIFFERENT KIND OF THING — the deployment's OAuth application, one per
  // installation, an operator's concern — wearing the clothes of a node field.
  //
  // n8n never mixes the two, and the reference is unambiguous across every layer
  // read on 2026-09-17: `useCredentialForm.ts:384` calls a credential "managed"
  // when the DEPLOYMENT supplied both OAuth application secrets, and `:242` then
  // FILTERS those properties out of the form; `CredentialConfig.vue:702` shows
  // the redirect URL only `v-if="!isManagedOAuth"`; and `NodeCredentials.test.ts`
  // — 3,328 lines, 120 cases — never names one of them at all.
  //
  // So when no provider is configured this says so in one sentence and stops.
  // Configuring one lives at /admin/integrations/workflow-oauth, which is an
  // operator's screen, and a workflow author who is not an operator could not
  // act on it from here anyway.
  // ⚠️ AND IT KEEPS ITS LABEL. Observed on the live editor 2026-09-17: this
  // branch rendered a bare sentence between "תיאור הצעד" and "נמען", both of
  // which carry a label — so the reader had no way to tell WHICH field was
  // unavailable. The label only ever appeared because `JsonFormsDispatch` draws
  // the SDK Select together with it, and the two branches that replace the
  // Select were silently dropping it.
  //
  // `FormControlWithLabel` is the SDK's own primitive for exactly this; its
  // documentation says it exists "inside custom JsonForms renderers ... to keep
  // label + control spacing consistent with the rest of the editor's form UI".
  // Hand-rolling a <Label> here would drift from every other field the moment
  // the editor restyles one.
  if (!context?.canConnectMicrosoft) {
    return (
      <FormControlWithLabel label={label}>
        <p className="text-sm text-muted-foreground">
          {context?.unavailableReason ?? 'לא ניתן לחבר חשבון Microsoft כרגע.'}
        </p>
      </FormControlWithLabel>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      {/*
        Delegate the field itself to WorkflowBuilder's built-in Select. The
        format marker is stripped first so this custom renderer cannot select
        itself recursively. JsonForms still owns data/path/handleChange, hence
        the selected connection UUID is the only value written to the node.
      */}
      {showPicker ? (
        <JsonFormsDispatch
          schema={rootSchema}
          uischema={delegatedSelectUiSchema(uischema)}
          enabled={enabled}
          readonly={readonly}
        />
      ) : (
        // Same reason as the branch above: the SDK Select carries the label, so
        // anything standing in for it has to carry it too.
        <FormControlWithLabel label={label}>
          <p className="text-sm text-muted-foreground">
            עדיין אין חשבון Microsoft מחובר.
          </p>
        </FormControlWithLabel>
      )}

      <Button
        type="button"
        variant="secondary"
        size="s"
        className="self-start"
        disabled={!canStart}
        onClick={connect}
        prefixIcon={<Link2 aria-hidden="true" className="size-4" />}
      >
        {isConnecting ? 'שומר ופותח…' : 'חיבור חשבון חדש'}
      </Button>

      {isUnavailable ? (
        <p role="alert" className="text-xs text-destructive">
          החיבור שנבחר אינו זמין יותר — ייתכן שההרשאה בוטלה או פגה. חברו חשבון מחדש ובחרו אותו כאן.
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
