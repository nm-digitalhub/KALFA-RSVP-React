import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it, vi } from 'vitest';

// The control's import graph reaches catalogue modules that are server-only.
vi.mock('server-only', () => ({}));

import { INTEGRATION_CONNECTION_FORMAT } from '@/lib/workflow/catalogue/ui-formats';

import {
  connectionOptionValues,
  OAUTH_POPUP_TIMEOUT_MS,
  parseOAuthPopupMessage,
  delegatedSelectUiSchema,
  integrationConnectionRenderer,
  microsoftOAuthStartHref,
  selectedConnectionUnavailable,
  saveWorkflowBeforeOAuth,
} from './integration-connection-control';

const connectionControl = {
  type: 'Select',
  scope: '#/properties/connectionId',
  label: 'חיבור Microsoft 365',
  options: {
    format: INTEGRATION_CONNECTION_FORMAT,
    provider: 'microsoft',
    capability: 'mail.send',
  },
} as const;
const testerContext = { rootSchema: {}, config: {} };
const controlSource = readFileSync(
  join(
    process.cwd(),
    'src/app/(admin)/admin/workflows/[id]/integration-connection-control.tsx',
  ),
  'utf8',
);
/**
 * The control with every comment removed.
 *
 * Block comments first (they may contain `//`), then line comments. Neither
 * string literals nor regexes in this file's subject contain `/*` or `//`, so a
 * lexer would buy nothing here — and if one ever appears, the assertions get
 * STRICTER, never looser.
 */
const stripComments = (source: string): string =>
  source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const controlCode = stripComments(controlSource);

const workflowPageSource = readFileSync(
  join(process.cwd(), 'src/app/(admin)/admin/workflows/[id]/page.tsx'),
  'utf8',
);
// The editor component, not the page: the provider that feeds this control is
// mounted there, so that is where the connection count is passed in.
const workflowEditorSource = readFileSync(
  join(process.cwd(), 'src/app/(admin)/admin/workflows/[id]/workflow-editor.tsx'),
  'utf8',
);

describe('integration connection JsonForms renderer', () => {
  it('matches only the explicitly configured Microsoft mail connection field', () => {
    expect(
      integrationConnectionRenderer.tester(
        connectionControl as never,
        {},
        testerContext,
      ),
    ).toBe(5000);
    expect(
      integrationConnectionRenderer.tester(
        {
          ...connectionControl,
          options: { ...connectionControl.options, capability: 'calendar.read' },
        } as never,
        {},
        testerContext,
      ),
    ).toBe(-1);
  });

  it('removes its marker before dispatching to the SDK Select, preventing recursion', () => {
    const delegated = delegatedSelectUiSchema(connectionControl as never);

    expect(delegated).toMatchObject({
      type: 'Select',
      scope: '#/properties/connectionId',
      label: 'חיבור Microsoft 365',
    });
    expect(delegated.options).toBeUndefined();
    expect(
      integrationConnectionRenderer.tester(delegated, {}, testerContext),
    ).toBe(-1);
  });

  it('targets the existing OAuth start route and returns to the same workflow', () => {
    const href = microsoftOAuthStartHref('workflow id/with slash');
    const url = new URL(href, 'https://example.test');

    expect(url.pathname).toBe('/api/integrations/oauth/start');
    expect(url.searchParams.get('provider')).toBe('microsoft');
    expect(url.searchParams.get('capability')).toBe('mail.send');
    expect(url.searchParams.get('redirectTo')).toBe(
      '/admin/workflows/workflow%20id%2Fwith%20slash?oauthMode=popup',
    );
  });

  it('⚠️ carries the popup flag ONLY inside redirectTo — a top-level copy is a lie', () => {
    // It briefly rode on the start URL too, on the theory that the callback's
    // failure branch could read it when the state row was unreachable. It
    // cannot: the callback is called by the PROVIDER, and that request carries
    // `code` and `state` and nothing of ours. The copy was therefore always
    // absent at the moment it was needed, the failure branch always redirected,
    // and a popup was sent to /admin/integrations while the editor waiting on it
    // learned nothing. Observed live 2026-09-17.
    //
    // Inside `redirectTo` it survives, because `start` sanitises that value and
    // stores it in the state row that the SUCCESS path reads back.
    const url = new URL(microsoftOAuthStartHref('w1'), 'https://example.test');
    expect(url.searchParams.get('oauthMode')).toBeNull();
    expect(url.searchParams.get('redirectTo')).toContain('oauthMode=popup');
  });

  it('can still be asked for the full-page flow, which carries no flag at all', () => {
    // The popup is the default, not the only mode. A caller that genuinely owns
    // the whole tab must not get a bridge page that talks to an opener it does
    // not have.
    const url = new URL(microsoftOAuthStartHref('w1', 'redirect'), 'https://example.test');
    expect(url.searchParams.get('oauthMode')).toBeNull();
    expect(url.searchParams.get('redirectTo')).toBe('/admin/workflows/w1');
  });

  it('navigates only after the SDK confirms a successful save', async () => {
    const navigate = vi.fn();

    await expect(
      saveWorkflowBeforeOAuth(
        vi.fn().mockResolvedValue('success'),
        navigate,
        '/oauth-start',
      ),
    ).resolves.toBe(true);
    expect(navigate).toHaveBeenCalledWith('/oauth-start');

    navigate.mockClear();
    await expect(
      saveWorkflowBeforeOAuth(
        vi.fn().mockResolvedValue('alreadyStarted'),
        navigate,
        '/oauth-start',
      ),
    ).resolves.toBe(false);
    expect(navigate).not.toHaveBeenCalled();
  });

  it('does not navigate when saving throws', async () => {
    const navigate = vi.fn();

    await expect(
      saveWorkflowBeforeOAuth(
        vi.fn().mockRejectedValue(new Error('save failed')),
        navigate,
        '/oauth-start',
      ),
    ).rejects.toThrow('save failed');
    expect(navigate).not.toHaveBeenCalled();
  });

  it('keeps credentials and OAuth protocol code out of the client renderer', () => {
    expect(controlSource).not.toMatch(
      /server-only|supabase|openid-client|code_verifier|code_challenge|vault_secret|refresh_token|access_token/i,
    );
    expect(controlSource).toContain('/api/integrations/oauth/start');
  });

  it('⚠️ writes the connection id and NOTHING ELSE into the node', () => {
    // WHAT CHANGED AND WHY. This control used to be forbidden from calling
    // `handleChange` at all: it delegated the field to the SDK's own Select and
    // never wrote a value itself, so the ban was a cheap way to pin that.
    //
    // Selecting the freshly connected account requires writing it, and
    // `handleChange(path, value)` is the documented way — the WorkflowBuilder
    // guide for custom JsonForms controls uses exactly that call, and going
    // around it would write into a model JsonForms owns.
    //
    // So the invariant is no longer "never writes" but "writes only this". The
    // control has exactly ONE call, its value is the parked connection id, and
    // the id came from the popup's message — never from anything on the page.
    const calls = [...controlCode.matchAll(/handleChange\(([^)]*)\)/g)].map((m) => m[1]);
    expect(calls).toEqual(['path, id']);

    // And `id` is the parked value, not something reconstructed locally.
    expect(controlCode).toMatch(/pending\.current = outcome\.connectionId/);
    expect(controlCode).toMatch(/const id = pending\.current/);
  });

  it('reloads safe connection options on the returned workflow page', () => {
    expect(workflowPageSource).toContain(
      'listActiveMicrosoftWorkflowConnections()',
    );
    expect(workflowPageSource).toContain(
      'microsoftConnections={microsoftConnections}',
    );
    expect(workflowPageSource).toContain(
      '<OAuthOutcome value={firstParam(query.oauth)} />',
    );
    expect(workflowPageSource).not.toMatch(
      /vault_secret|refresh_token|access_token/i,
    );
  });

  it('⚠️ names a selected connection the picker can no longer offer', async () => {
    // A REAL SILENT FAILURE, not a hypothetical: the picker's query filters
    // `status = 'active'`, so a connection that turns `requires_reauthorization`
    // or `revoked` vanishes from the options while `connectionId` still holds its
    // uuid. The select then renders blank, the arm gate passes (the field is not
    // empty), and the workflow arms and fails at run time with nothing on screen.
    const schema = {
      properties: {
        connectionId: {
          options: [{ label: 'תיבת מכירות', value: 'still-there' }],
        },
      },
    };

    expect(selectedConnectionUnavailable('gone-stale', schema)).toBe(true);
    expect(selectedConnectionUnavailable('still-there', schema)).toBe(false);
  });

  it('⚠️ and actually renders that warning', () => {
    // The predicate above passed while the branch was dead — caught by fault
    // injection. Without a render harness for an SDK control, the reachable
    // assertion is that the alert hangs off `isUnavailable` and carries
    // `role="alert"`, so a screen reader announces it rather than an author
    // discovering it at run time.
    expect(controlSource).toContain('const isUnavailable = selectedConnectionUnavailable(');
    expect(controlSource).toMatch(/\{isUnavailable \? \(\s*<p\s+role="alert"/);
  });

  it('an EMPTY selection is not "unavailable" — the arm gate already names it', () => {
    // Conflating the two would put a red line on every freshly dropped node.
    const schema = { properties: { connectionId: { options: [{ value: 'a' }] } } };

    for (const empty of ['', '   ', undefined, null, 42]) {
      expect(selectedConnectionUnavailable(empty, schema)).toBe(false);
    }
  });

  it('survives a schema that carries no options at all', () => {
    // Before the page's connections resolve, and for any node whose schema was
    // built without them: an absent list must not turn every selection red.
    expect(connectionOptionValues(undefined)).toEqual([]);
    expect(connectionOptionValues({ properties: {} })).toEqual([]);
    expect(connectionOptionValues({ properties: { connectionId: { options: 'nope' } } })).toEqual(
      [],
    );
    expect(
      connectionOptionValues({ properties: { connectionId: { options: [{ value: 7 }, {}] } } }),
    ).toEqual([]);
  });

  it('⚠️ a node picks an ACCOUNT — provider configuration may not appear here at all', () => {
    // THE DEFECT THIS PINS. The panel used to carry a "set up Microsoft
    // provider" button that opened a modal holding the deployment's client id,
    // its client secret and the redirect URI. Two different things wore one
    // control: the OAuth APPLICATION (one per installation, an operator's) and
    // the CONNECTED ACCOUNT (many per installation, an author's).
    //
    // None of this type-errors when it comes back — it reads as a helpful
    // shortcut — so the vocabulary itself is asserted absent.
    // ⚠️ ASSERTED AGAINST CODE, NOT PROSE. The comment above the remaining branch
    // NAMES what was removed — that is the point of it. An assertion over raw
    // source would be satisfied by deleting the explanation, which is the
    // opposite of the invariant. So comments are stripped first.
    for (const forbidden of [
      /clientId/,
      /clientSecret/,
      /hasStoredSecret/,
      /callbackUrl/,
      /providerSetup/,
      /ProviderSetupModal/,
      /redirect.?uri/i,
    ]) {
      expect(controlCode).not.toMatch(forbidden);
    }

    // Nor may it be smuggled in as a prop: neither the page nor the editor
    // hands provider configuration down to the canvas.
    expect(workflowPageSource).not.toMatch(/microsoftProviderSetup/);
    expect(workflowEditorSource).not.toMatch(/providerSetup/);

    // n8n draws the same line and never crosses it: `useCredentialForm.ts:384`
    // calls a credential "managed" when the deployment overwrote `clientId` AND
    // `clientSecret`, and `:242` then FILTERS those properties out of the form.
    // `CredentialConfig.vue:702` shows the redirect URL only when NOT managed.
  });

  it('⚠️ an unconfigured provider is ONE sentence — not a dead picker and a dead button', () => {
    // The branch must come FIRST, before the picker and the connect button, so
    // neither renders in a state where it cannot do anything. Observed live
    // 2026-09-17: three stacked negatives, none of them actionable.
    const branch = controlSource.match(
      /if \(!context\?\.canConnectMicrosoft\) \{[\s\S]*?\n  \}/,
    );
    expect(branch).not.toBeNull();
    const body = branch![0];
    expect(body).toMatch(/<p className="text-sm text-muted-foreground">/);
    expect(body).not.toMatch(/<Button/);
    expect(body).not.toMatch(/JsonFormsDispatch/);

    // And it stays put: no navigation out of the editor from this control.
    expect(controlSource).not.toMatch(/<Link\b/);
  });

  it('⚠️ does not draw an empty picker — the select is conditional', () => {
    // WHAT THIS CAN AND CANNOT PROVE. There is no render harness for an SDK
    // control in this repo (the tests here exercise testers and wiring), so this
    // asserts the SHAPE of the decision, not pixels: that the select sits behind
    // a condition derived from `hasConnections`, rather than being drawn
    // unconditionally with nothing in it.
    //
    // n8n reaches the same structure in `NodeCredentials.vue`, where
    // `<N8nSelect>` is the final `v-else` and `options.length === 0` is tested
    // first. Ours cannot count options — the list is built into the schema
    // upstream — so the count is carried on the context instead.
    expect(controlSource).toContain('context?.hasConnections !== false');
    expect(controlSource).toMatch(/showPicker \? \(\s*<JsonFormsDispatch/);
  });

  it('⚠️ the editor tells it how many connections exist', () => {
    // Fail-closed on the other half: a provider that never passes the flag would
    // leave `hasConnections` undefined, the branch would default to showing the
    // picker, and the empty state would silently never appear.
    expect(workflowEditorSource).toContain('hasConnections={microsoftConnections.length > 0}');
  });

  it('⚠️ decides availability through the shared resolver, not its own expression', () => {
    // WHAT THIS REPLACED, AND WHY. Three assertions used to grep this page for
    // literal source text — `readSystemOAuthClient("microsoft") !== null` and
    // `canManageIntegrations && microsoftProviderAvailable`. Both were satisfied
    // by code that COMPUTED a value and never used it, which is exactly the
    // shape of the bug they were meant to guard; and both broke on a rename that
    // changed no behaviour at all. A third forbade a Hebrew sentence, which
    // pinned a regression rather than a rule.
    //
    // The rule itself — DB-over-env precedence — is pinned behaviourally in
    // `provider-availability.test.ts`. All this page owes is that it ASKS.
    expect(workflowPageSource).toContain('resolveOAuthProviderAvailability');
    expect(workflowPageSource).toContain('hasSystemOAuthClient');

    // ⚠️ AND THAT IT DOES NOT DECIDE ANYTHING ITSELF. A second, local rule here
    // is how the UI and the runtime drifted apart the first time: the page said
    // a disabled provider was still connectable because an env client existed.
    expect(workflowPageSource).not.toMatch(/systemConfigured\s*\|\|/);
    expect(workflowPageSource).not.toMatch(/\|\|\s*(has|read)SystemOAuthClient/);
  });

  it('⚠️ the page never materialises the deployment secret', () => {
    // `hasSystemOAuthClient` answers a boolean; `readSystemOAuthClient` returns
    // the client secret itself. A React Server Component has no business holding
    // the second, even transiently — the value would sit in a module that also
    // builds an RSC payload.
    expect(workflowPageSource).not.toContain('readSystemOAuthClient');
  });
});

describe('what the editor accepts from the popup', () => {
  const OURS = 'https://beta.example.test';
  const good = { tag: 'kalfa-oauth', ok: true, connectionId: 'c-1' };

  it('accepts our own report', () => {
    expect(parseOAuthPopupMessage(good, OURS, OURS)).toEqual({
      tag: 'kalfa-oauth', ok: true, connectionId: 'c-1',
    });
  });

  it('⚠️ refuses a correctly-shaped message from another origin', () => {
    // ANY page holding a handle on this window may post to it. Without this
    // gate a hostile page could name a connection the node then selects — a
    // connection it does not own but our server would happily use.
    expect(parseOAuthPopupMessage(good, 'https://evil.test', OURS)).toBeNull();
  });

  it('⚠️ refuses same-origin traffic that is not ours', () => {
    // Not hypothetical: instrumenting n8n live on 2026-09-17 caught its own
    // editor posting {"command":"openNDV"} over this exact channel, from this
    // exact origin. Without the tag, an unrelated internal message would be
    // read as an OAuth result.
    expect(parseOAuthPopupMessage({ command: 'openNDV' }, OURS, OURS)).toBeNull();
    expect(parseOAuthPopupMessage({ tag: 'other', ok: true, connectionId: 'c' }, OURS, OURS))
      .toBeNull();
  });

  it('⚠️ refuses a success with no usable id', () => {
    // `ok` without an id would park `undefined` and select nothing, leaving the
    // spinner to time out on a flow that actually succeeded.
    for (const bad of [
      { tag: 'kalfa-oauth', ok: true },
      { tag: 'kalfa-oauth', ok: true, connectionId: '' },
      { tag: 'kalfa-oauth', ok: true, connectionId: 42 },
    ]) {
      expect(parseOAuthPopupMessage(bad, OURS, OURS)).toBeNull();
    }
  });

  it('accepts a failure, and defaults its reason rather than dropping it', () => {
    expect(parseOAuthPopupMessage({ tag: 'kalfa-oauth', ok: false }, OURS, OURS))
      .toEqual({ tag: 'kalfa-oauth', ok: false, reason: 'failed' });
  });

  it('survives anything that is not an object', () => {
    for (const junk of [null, undefined, 'kalfa-oauth', 7, []]) {
      expect(parseOAuthPopupMessage(junk, OURS, OURS)).toBeNull();
    }
  });

  it('⚠️ waits five minutes, because 29s and 208s were both measured', () => {
    // Two complete OAuth round trips through n8n's live product on 2026-09-17.
    // The slow one spent its time on the account chooser and the consent
    // screen. A one-minute timeout would have reported failure on a flow that
    // was still working.
    expect(OAUTH_POPUP_TIMEOUT_MS).toBe(300_000);
  });
});
