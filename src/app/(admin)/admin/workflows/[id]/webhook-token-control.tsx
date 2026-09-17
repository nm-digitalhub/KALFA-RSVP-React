'use client';

import { useState } from 'react';

import {
  Icon,
  optionIs,
  rankWith,
  withJsonFormsControlProps,
  type ControlProps,
  type JsonFormsRendererExtension,
} from '@workflowbuilder/sdk';

import { Button } from '@/components/ui/button';
import { WEBHOOK_TOKEN_FORMAT } from '@/lib/workflow/catalogue/ui-formats';
import {
  generateWebhookToken,
  hashWebhookToken,
  webhookUrlFor,
} from '@/lib/workflow/webhook-token';

// The webhook trigger's address, and the one place a token is ever visible.
//
// ⚠️ THIS FIELD NO LONGER HOLDS A VALUE ANYONE CAN TYPE. It holds a sha256, and
// the token that produced it exists only in this component's state until the
// page is left. That is the whole point: a diagram is exportable — the editor's
// own menu puts one in a copyable box — and a diagram that carries a live
// credential is a credential that travels.
//
// So the control does what a password field does: generate, show once, store the
// digest. `webhook-token.ts` owns both halves so the value the editor hashes and
// the value the route hashes cannot drift apart.
//
// WHY NOT A PLAIN TEXT BOX WITH THE HASH IN IT. Because a hash is not something
// an operator has any use for, and showing one invites pasting one — at which
// point the address would be unreachable and nothing would say why.

function WebhookTokenControl({ data, handleChange, path, enabled, readonly }: ControlProps) {
  // Held only in memory, and only until this panel unmounts. Deliberately not
  // written into the diagram, which is the entire reason the field changed.
  const [freshToken, setFreshToken] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const hasHash = typeof data === 'string' && data.trim() !== '';
  const canGenerate = enabled !== false && readonly !== true && !busy;

  const generate = async () => {
    setBusy(true);
    try {
      const token = generateWebhookToken();
      handleChange(path, await hashWebhookToken(token));
      setFreshToken(token);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <Button type="button" variant="outline" size="sm" disabled={!canGenerate} onClick={() => void generate()}>
          <Icon name="Key" />
          {hasHash ? 'יצירת טוקן חדש' : 'יצירת טוקן'}
        </Button>
        {hasHash && !freshToken && (
          <span className="text-sm text-muted-foreground">טוקן קיים — לא ניתן להצגה</span>
        )}
      </div>

      {freshToken && (
        // Shown ONCE. Re-rendering the panel, reloading, or coming back later all
        // lose it — which is what "only the hash is stored" means in practice.
        <div className="flex flex-col gap-1 rounded-md border p-2">
          <p className="text-sm font-medium">העתיקו עכשיו — לא ניתן יהיה להציג שוב:</p>
          <code dir="ltr" className="break-all rounded bg-muted/50 p-1 text-xs">
            {webhookUrlFor(window.location.origin, freshToken)}
          </code>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="self-start"
            onClick={() =>
              void navigator.clipboard?.writeText(
                webhookUrlFor(window.location.origin, freshToken),
              )
            }
          >
            העתקת הכתובת
          </Button>
        </div>
      )}

      {/* ⚠️ Replaced the field, so nothing renders the value — by design. */}
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
