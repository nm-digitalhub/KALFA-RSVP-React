'use client';

import { useState, useTransition } from 'react';
import { useParams } from 'next/navigation';

import {
  Icon,
  optionIs,
  rankWith,
  useSingleSelectedElement,
  withJsonFormsControlProps,
  type ControlProps,
  type JsonFormsRendererExtension,
} from '@workflowbuilder/sdk';

// The editor's own component library (the SDK's successor to overflow-ui), not the app's
// shadcn Button: it carries the editor's tokens, so this panel matches the fields beside it.
import { Button } from '@workflowbuilder/ui';
import { authModeFor } from '@/lib/workflow/catalogue/types';
import * as sumitCardTriggerDefinition from '@/lib/workflow/nodes/trigger-sumit-card/definition';
import { WEBHOOK_TOKEN_FORMAT } from '@/lib/workflow/catalogue/ui-formats';
import {
  WEBHOOK_SECRET_HEADER,
  generateWebhookEndpointId,
  generateWebhookToken,
  hashWebhookToken,
  webhookUrlFor,
} from '@/lib/workflow/webhook-token';

import { registerSumitTriggerAction } from '../actions';

// The webhook trigger's ADDRESS and its SECRET — two values, deliberately not
// one.
//
// ⚠️ WHY THEY WERE SPLIT, and it was not a preference. The token used to be the
// path segment (`/api/workflows/hook/<token>`), so the address WAS the
// credential. Two things followed, and the owner hit both on 2026-09-22:
//
//   1. "אין לי אפשרות לדעת מה כתובת ה-webhook?" — correct, and unfixable in that
//      shape: showing the address a second time would be showing the secret a
//      second time. Worse, "יצירת טוקן חדש" looked like a way to RECOVER a lost
//      address and was actually a way to BREAK it, silently, on someone else's
//      machine.
//   2. A secret in a URL is written to every access log, proxy record, browser
//      history entry and Referer header that stores a path. Hashing it in the
//      diagram protected the export and left that wide open.
//
// So the address is a PUBLIC id the panel shows forever, and the secret travels
// in `x-kalfa-webhook-secret`. Rotating the secret no longer touches the
// address. See plans/webhook-address-vs-secret.md.
//
// ⚠️ ONE CONTROL FOR BOTH, because they are minted together and a node carrying
// one without the other cannot be armed. It binds to `tokenHash` (that is the
// field JsonForms hands it) and writes its sibling `endpointId` through the same
// `handleChange`.

function WebhookTokenControl({ data, handleChange, path, enabled, readonly }: ControlProps) {
  // Held only in memory, and only until this panel unmounts. Deliberately not
  // written into the diagram, which is the entire reason the field is a hash.
  const [freshSecret, setFreshSecret] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // Replacing a secret invalidates the one already deployed, so the second
  // generation asks and the first does not.
  const [confirmingReplace, setConfirmingReplace] = useState(false);

  // The sibling field. Read from the node rather than from JsonForms, which
  // hands a control its own value and not its neighbours'.
  const selection = useSingleSelectedElement();
  const properties = ((selection?.node?.data as { properties?: Record<string, unknown> } | undefined)
    ?.properties ?? {}) as Record<string, unknown>;
  const endpointId = typeof properties.endpointId === 'string' ? properties.endpointId : '';
  // The NODE TYPE decides first: a SUMIT trigger is address-only whatever its
  // row says, and this control must mint the same kind of credential the lookup
  // will check. `authModeFor` is the one place that answers it.
  const nodeType = (selection?.node?.data as { type?: string } | undefined)?.type ?? '';
  const mode = authModeFor(nodeType, properties);
  const addressIsSecret = mode === 'address';

  const endpointPath = path.replace(/tokenHash$/, 'endpointId');

  // SUMIT trigger only: register the fresh address in SUMIT for the owner. The
  // server re-checks the address against the SAVED diagram, so a click before
  // the auto-save lands is answered with "wait and retry", never a wrong URL.
  const params = useParams<{ id: string }>();
  const isSumit = nodeType === sumitCardTriggerDefinition.type;
  const hasSumitChoice =
    typeof properties.folderId === 'string' && properties.folderId !== '' &&
    typeof properties.viewId === 'string' && properties.viewId !== '';
  const [registering, startRegister] = useTransition();
  const [registerResult, setRegisterResult] = useState<{ ok: boolean; message: string } | null>(null);
  const register = (url: string) =>
    startRegister(async () => {
      setRegisterResult(null);
      try {
        setRegisterResult(
          await registerSumitTriggerAction({ workflowId: params.id, nodeId: selection?.node?.id ?? '', url }),
        );
      } catch {
        setRegisterResult({ ok: false, message: 'הרישום ב-SUMIT נכשל' });
      }
    });
  const hasHash = typeof data === 'string' && data.trim() !== '';
  const canGenerate = enabled !== false && readonly !== true && !busy;

  // ⚠️ IN `address` MODE THERE IS NOTHING TO REBUILD AN ADDRESS FROM, and that
  // is the mode working. `endpointId` is deliberately never written there, so
  // the panel can show the address only in the render that minted it —
  // `freshSecret` below — and afterwards has only the hash, like any password
  // field. In `header` mode the id is public and the address is shown forever.
  const address =
    !addressIsSecret && endpointId && typeof window !== 'undefined'
      ? webhookUrlFor(window.location.origin, endpointId)
      : null;
  const freshAddress =
    addressIsSecret && freshSecret && typeof window !== 'undefined'
      ? webhookUrlFor(window.location.origin, freshSecret)
      : null;

  const generate = async () => {
    setBusy(true);
    try {
      // ⚠️ THE SAME 32 CSPRNG BYTES IN BOTH MODES. What changes is where the
      // value travels — a header or the path — never how much entropy it has.
      // `generateWebhookEndpointId` is 16 bytes and stays exactly what its own
      // doc calls it: a public id that proves nothing, minted only for `header`.
      const secret = generateWebhookToken();
      handleChange(path, await hashWebhookToken(secret));
      if (addressIsSecret) {
        // ⚠️ CLEARED, NOT LEFT BEHIND. A node switched from `header` may still
        // carry the public id it had there; leaving it would put a second,
        // stale, plaintext path in the diagram that no longer opens anything.
        if (endpointId) handleChange(endpointPath, '');
      } else if (!endpointId) {
        // MINTED ONCE AND KEPT. Rotating a secret must not move the address —
        // that is the whole point of the split — so an existing id is preserved.
        handleChange(endpointPath, generateWebhookEndpointId());
      }
      setFreshSecret(secret);
      setRegisterResult(null);
      setConfirmingReplace(false);
    } finally {
      setBusy(false);
    }
  };

  const copy = (value: string) => void navigator.clipboard?.writeText(value);

  return (
    <div className="flex flex-col gap-3">
      {address ? (
        <div className="flex flex-col gap-1">
          <p className="text-sm font-medium">הכתובת</p>
          <code dir="ltr" className="break-all rounded bg-muted/50 p-1 text-xs">
            {address}
          </code>
          <Button
            type="button"
            variant="secondary"
            size="s"
            className="self-start"
            onClick={() => copy(address)}
          >
            העתקת הכתובת
          </Button>
        </div>
      ) : (
        !addressIsSecret && (
          <p className="text-sm text-muted-foreground">
            עדיין אין כתובת. צרו סוד — הכתובת תיווצר יחד איתו ותישאר קבועה.
          </p>
        )
      )}

      {addressIsSecret && !freshAddress && !endpointId && (
        <p className="text-sm text-muted-foreground">
          {hasHash
            ? 'הכתובת נוצרה ואינה ניתנת להצגה שוב. אם אבדה — צרו כתובת חדשה ועדכנו את המערכת הקוראת.'
            : 'עדיין אין כתובת. היא תוצג פעם אחת בלבד, מיד עם היצירה.'}
        </p>
      )}

      {/* ⚠️ THE MODE WAS CHANGED AFTER A CREDENTIAL WAS MINTED, and nothing else
          on this panel would say so. A leftover `endpointId` means this node was
          generated in header mode: its stored hash is of the HEADER secret, so
          no caller can now reach it — the path hashes to something else and the
          header is not read. Inert rather than unsafe, but indistinguishable on
          screen from a working node, which is why `arm-check` refuses it too. */}
      {addressIsSecret && endpointId && (
        <p className="rounded-md border p-2 text-sm">
          המצב שונה אחרי שנוצר סוד, והכתובת הישנה כבר לא תפעיל את התהליך. לחצו על יצירת כתובת כדי
          לקבל כתובת חדשה.
        </p>
      )}

      <div className="flex items-center gap-2">
        <Button
          type="button"
          variant="secondary"
          size="s"
          disabled={!canGenerate}
          onClick={() => (hasHash ? setConfirmingReplace(true) : void generate())}
          prefixIcon={<Icon name="Key" />}
        >
          {addressIsSecret
            ? hasHash
              ? 'יצירת כתובת חדשה'
              : 'יצירת כתובת'
            : hasHash
              ? 'יצירת סוד חדש'
              : 'יצירת סוד'}
        </Button>
        {hasHash && !freshSecret && (
          <span className="text-sm text-muted-foreground">
            {addressIsSecret ? 'כתובת קיימת — לא ניתנת להצגה' : 'סוד קיים — לא ניתן להצגה'}
          </span>
        )}
      </div>

      {confirmingReplace && (
        // ⚠️ NARROWER THAN THE OLD WARNING, AND TRUER. Rotating no longer breaks
        // the ADDRESS — only the secret already deployed stops being accepted.
        // Saying "the address will stop working" here would now be false, and a
        // false warning is one people learn to click through.
        <div className="flex flex-col gap-2 rounded-md border p-2">
          <p className="text-sm">
            {addressIsSecret ? (
              <>
                הכתובת הקיימת <strong>תפסיק לעבוד מיד</strong>, ולא ניתן לשחזר אותה. כל מערכת
                שקוראת לה תיעצר עד שתעדכנו אצלה את הכתובת החדשה.
              </>
            ) : (
              <>
                הכתובת <strong>לא תשתנה</strong>. הסוד הקיים יפסיק להתקבל מיד — עדכנו אותו בכל
                מערכת שקוראת לכתובת הזו.
              </>
            )}
          </p>
          <div className="flex gap-2">
            <Button type="button" size="s" disabled={!canGenerate} onClick={() => void generate()}>
              {addressIsSecret ? 'יצירת כתובת חדשה' : 'יצירת סוד חדש'}
            </Button>
            <Button
              type="button"
              size="s"
              variant="secondary"
              onClick={() => setConfirmingReplace(false)}
            >
              ביטול
            </Button>
          </div>
        </div>
      )}

      {freshSecret && (
        // Shown ONCE. Re-rendering the panel, reloading, or coming back later all
        // lose it — which is what "only the hash is stored" means in practice.
        //
        // ⚠️ IN `address` MODE THIS IS THE ONLY TIME THE ADDRESS EXISTS ON
        // SCREEN. `freshSecret` holds the path segment, and the full URL is
        // built from it here rather than stored, so navigating away is the same
        // as losing a password.
        <div className="flex flex-col gap-1 rounded-md border p-2">
          <p className="text-sm font-medium">
            {freshAddress
              ? 'זו הכתובת המלאה. העתיקו עכשיו — לא ניתן יהיה להציג שוב:'
              : 'העתיקו עכשיו — לא ניתן יהיה להציג שוב:'}
          </p>
          <code dir="ltr" className="break-all rounded bg-muted/50 p-1 text-xs">
            {freshAddress ?? `${WEBHOOK_SECRET_HEADER}: ${freshSecret}`}
          </code>
          <Button
            type="button"
            variant="secondary"
            size="s"
            className="self-start"
            onClick={() => copy(freshAddress ?? freshSecret)}
          >
            {freshAddress ? 'העתקת הכתובת' : 'העתקת הסוד'}
          </Button>
          {isSumit && freshAddress && (
            <div className="mt-2 flex flex-col gap-1 border-t pt-2">
              {hasSumitChoice ? (
                <Button
                  type="button"
                  size="s"
                  className="self-start"
                  isLoading={registering}
                  disabled={registering || !params?.id}
                  onClick={() => register(freshAddress)}
                >
                  רישום ב-SUMIT
                </Button>
              ) : (
                <p className="text-sm text-muted-foreground">
                  לרישום אוטומטי בחרו למעלה תיקייה ותצוגה. בלי זה — הדביקו את הכתובת ידנית במסך הטריגרים של SUMIT.
                </p>
              )}
              {registerResult && (
                <p role="status" className={registerResult.ok ? 'text-sm' : 'text-sm text-destructive'}>
                  {registerResult.message}
                </p>
              )}
            </div>
          )}
        </div>
      )}

      {/* ⚠️ The hash is never rendered as a value anyone could paste back. */}
      {hasHash && (
        <p className="text-xs text-muted-foreground" dir="ltr">
          sha256 …{String(data).slice(-8)}
        </p>
      )}
    </div>
  );
}

export const webhookTokenRenderer: JsonFormsRendererExtension = {
  tester: rankWith(5000, optionIs('format', WEBHOOK_TOKEN_FORMAT)),
  renderer: withJsonFormsControlProps(WebhookTokenControl),
};
