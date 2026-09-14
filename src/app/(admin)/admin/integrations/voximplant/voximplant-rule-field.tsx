'use client';

import { useId, useState, useTransition } from 'react';

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { HelpTip } from '@/components/help-tip';
import { loadVoximplantRulesAction } from '@/app/(admin)/admin/integrations/actions';
import type { VoximplantRuleOption } from '@/lib/data/admin/voximplant-channel';

// A Voximplant rule id field that can offer the ACCOUNT'S ACTUAL RULES instead of
// asking an operator to remember a number.
//
// WHY. A wrong rule id here fails silently: the call still dials, it just runs a
// different scenario. That is not hypothetical — comments in this repo described
// rule 1494311 (`OutCall`, the legacy DTMF flow) as "RSVPAgent's rule" while the
// live value is 1520915 (`OutCallAgent`), and this field's own placeholder
// offered the wrong id as its example. A list read from the platform cannot drift
// like that. It also survives a migration: six scenario ids changed on
// 2026-09-14, and every number written down beforehand was stale by morning.
//
// ON DEMAND, NOT ON RENDER. The page this sits on deliberately keeps live
// Voximplant calls out of its render path ("an unbounded-latency external
// dependency in a very hot render path"), so nothing is fetched until the
// operator asks. Until then — and whenever the API is unreachable — the field is
// exactly the plain text input it was before, so a Voximplant outage can never
// stop someone from saving a rule id they already know.
//
// ONE MOUNTED INPUT AT A TIME. Base UI's Select renders its own hidden input and
// submits under `name`; the manual <input> carries the same `name`. Rendering
// both would put two values in the FormData for one field, so exactly one is
// mounted and the other is absent from the tree.
//
// The action is invoked inside startTransition — the required way to dispatch a
// Server Function from an event handler in this Next.js version (see
// node_modules/next/dist/docs/01-app/02-guides/server-actions.md).

const inputClass =
  'w-full rounded-md border border-border bg-background px-3 py-2 text-sm outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/15';
const labelClass = 'mb-1 flex items-center gap-1 text-sm font-medium';

// Rule 1494311 is `OutCall`, the legacy DTMF `RSVP` scenario. CLAUDE.md forbids
// pointing an AI agent persona at it. Flagged rather than hidden: it is a real
// rule, someone may legitimately need to read its id, and silently omitting a
// row would make the list a liar about what the account contains.
const FORBIDDEN_FOR_AGENTS = '1494311';

function describe(rule: VoximplantRuleOption): string {
  const runs = rule.scenarios.length ? rule.scenarios.join(' + ') : 'ללא תרחיש';
  return `${rule.ruleName} — ${runs}`;
}

export function VoximplantRuleField({
  name,
  defaultValue,
  label = 'Rule ID',
  help,
  required = false,
}: {
  name: string;
  defaultValue: string;
  label?: string;
  help?: string;
  required?: boolean;
}) {
  const fieldId = useId();
  const [value, setValue] = useState(defaultValue);
  const [rules, setRules] = useState<VoximplantRuleOption[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function load() {
    setError(null);
    startTransition(async () => {
      const res = await loadVoximplantRulesAction();
      if (res.ok) {
        setRules(res.rules);
      } else {
        // Stay in manual mode — the field keeps working without the list.
        setRules(null);
        setError(res.message);
      }
    });
  }

  // A stored id the platform no longer returns (deleted rule, or a second
  // account). Kept visible instead of being silently dropped from the list,
  // because "the value you saved does not exist any more" is the single most
  // useful thing this field can tell an operator.
  const known = rules?.some((r) => r.ruleId === value) ?? true;
  const selected = rules?.find((r) => r.ruleId === value);
  const warn = value === FORBIDDEN_FOR_AGENTS;

  return (
    <div>
      <label htmlFor={fieldId} className={labelClass}>
        {label}
        {help ? <HelpTip text={help} /> : null}
      </label>

      {rules ? (
        <Select
          name={name}
          value={value}
          onValueChange={(next) => setValue(typeof next === 'string' ? next : '')}
          required={required}
        >
          <SelectTrigger id={fieldId} dir="ltr">
            <SelectValue>
              {selected ? describe(selected) : value || 'בחרו כלל'}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            {rules.map((rule) => (
              <SelectItem key={rule.ruleId} value={rule.ruleId}>
                <span dir="ltr" className="flex flex-col items-start">
                  <span className="font-medium">{describe(rule)}</span>
                  <span className="text-xs text-muted-foreground">
                    {rule.ruleId} · {rule.applicationName}
                  </span>
                </span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      ) : (
        <input
          id={fieldId}
          name={name}
          dir="ltr"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="לא הוגדר"
          className={inputClass}
        />
      )}

      <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
        {rules ? (
          <button
            type="button"
            onClick={() => setRules(null)}
            className="text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            הזנה ידנית
          </button>
        ) : (
          <button
            type="button"
            onClick={load}
            disabled={pending}
            className="text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
          >
            {pending ? 'טוען כללים…' : 'בחירה מרשימת הכללים בחשבון'}
          </button>
        )}

        {error ? (
          <span className="text-destructive" role="status">
            {error}
          </span>
        ) : null}

        {rules && !known && value ? (
          <span className="text-amber-600 dark:text-amber-500" role="status">
            ⚠️ המזהה השמור ({value}) לא קיים בחשבון — ייתכן שהכלל נמחק.
          </span>
        ) : null}

        {warn ? (
          <span className="text-destructive" role="status">
            ⚠️ 1494311 הוא הכלל OutCall (תרחיש ה-DTMF הישן) — אסור לסוכני AI.
          </span>
        ) : null}
      </div>
    </div>
  );
}
