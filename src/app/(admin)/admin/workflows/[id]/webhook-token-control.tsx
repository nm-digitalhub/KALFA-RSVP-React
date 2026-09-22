'use client';

import { useState } from 'react';

import {
  Icon,
  optionIs,
  rankWith,
  useSingleSelectedElement,
  withJsonFormsControlProps,
  type ControlProps,
  type JsonFormsRendererExtension,
} from '@workflowbuilder/sdk';

import { Button } from '@/components/ui/button';
import { WEBHOOK_TOKEN_FORMAT } from '@/lib/workflow/catalogue/ui-formats';
import {
  WEBHOOK_SECRET_HEADER,
  generateWebhookEndpointId,
  generateWebhookToken,
  hashWebhookToken,
  webhookUrlFor,
} from '@/lib/workflow/webhook-token';

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

  const endpointPath = path.replace(/tokenHash$/, 'endpointId');
  const hasHash = typeof data === 'string' && data.trim() !== '';
  const canGenerate = enabled !== false && readonly !== true && !busy;

  const address =
    endpointId && typeof window !== 'undefined'
      ? webhookUrlFor(window.location.origin, endpointId)
      : null;

  const generate = async () => {
    setBusy(true);
    try {
      const secret = generateWebhookToken();
      handleChange(path, await hashWebhookToken(secret));
      // MINTED ONCE AND KEPT. Rotating a secret must not move the address — that
      // is the whole point of the split — so an existing id is preserved.
      if (!endpointId) handleChange(endpointPath, generateWebhookEndpointId());
      setFreshSecret(secret);
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
            variant="outline"
            size="sm"
            className="self-start"
            onClick={() => copy(address)}
          >
            העתקת הכתובת
          </Button>
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">
          עדיין אין כתובת. צרו סוד — הכתובת תיווצר יחד איתו ותישאר קבועה.
        </p>
      )}

      <div className="flex items-center gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={!canGenerate}
          onClick={() => (hasHash ? setConfirmingReplace(true) : void generate())}
        >
          <Icon name="Key" />
          {hasHash ? 'יצירת סוד חדש' : 'יצירת סוד'}
        </Button>
        {hasHash && !freshSecret && (
          <span className="text-sm text-muted-foreground">סוד קיים — לא ניתן להצגה</span>
        )}
      </div>

      {confirmingReplace && (
        // ⚠️ NARROWER THAN THE OLD WARNING, AND TRUER. Rotating no longer breaks
        // the ADDRESS — only the secret already deployed stops being accepted.
        // Saying "the address will stop working" here would now be false, and a
        // false warning is one people learn to click through.
        <div className="flex flex-col gap-2 rounded-md border p-2">
          <p className="text-sm">
            הכתובת <strong>לא תשתנה</strong>. הסוד הקיים יפסיק להתקבל מיד — עדכנו אותו בכל
            מערכת שקוראת לכתובת הזו.
          </p>
          <div className="flex gap-2">
            <Button type="button" size="sm" disabled={!canGenerate} onClick={() => void generate()}>
              יצירת סוד חדש
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
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
        <div className="flex flex-col gap-1 rounded-md border p-2">
          <p className="text-sm font-medium">העתיקו עכשיו — לא ניתן יהיה להציג שוב:</p>
          <code dir="ltr" className="break-all rounded bg-muted/50 p-1 text-xs">
            {WEBHOOK_SECRET_HEADER}: {freshSecret}
          </code>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="self-start"
            onClick={() => copy(freshSecret)}
          >
            העתקת הסוד
          </Button>
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
