'use client';

import { defineStepper } from '@stepperize/react';
import { Check, Circle, LoaderCircle, Lock } from 'lucide-react';
import { useRouter } from 'next/navigation';

import { buttonVariants } from '@/components/ui/button';
import type { SetupStep } from '@/lib/data/setup-steps';
import { cn } from '@/lib/utils';

// View of the one-time setup flow. The step states are decided on the SERVER
// (computeSetupSteps); this component only renders them, so the stepper is fully
// controlled: `step` and `completed` come from props. The only navigation is
// "back", and it is the library's own `Stepper.Prev` button: the server says
// whether there is a back at all and where it leads (setupBackTarget), and
// `onStepChange` — the library's hook for syncing a stepper with the router —
// follows that link. Nothing else can change the step (no Trigger, no Next, and
// `beforeStepChange` refuses any direction but "prev"); each step's action lives
// in its own page/form.
//
// Stepperize models two independent axes, and so do we: `data-status` is the
// step's POSITION relative to the active one, `data-complete` is BUSINESS
// completion. A blocked step has no counterpart in the library, so it is marked
// with our own `data-blocked`. No Trigger is rendered — the list is not a tab
// widget — so the items are plain `<li>`s inside an `<ol role="list">`.
//
// The definition is static and module-level (the library requires it) and holds
// ids only. Labels and hints arrive as props: a Client Component's imports are
// bundled for the browser (Next docs, "Server and Client Boundary"), so the
// label map — which lives next to server-side validation code — is resolved on
// the server and passed down as serializable data. The type import below is
// erased at build time.
const setupFlow = defineStepper([
  { id: 'details' },
  { id: 'confirm' },
  // Present only while a fixed-price package is on offer (or chosen); the server simply leaves it out of `steps`
  // otherwise, and the list below skips ids it was not given.
  { id: 'package' },
  { id: 'sign' },
  { id: 'pay' },
  { id: 'live' },
]);
const { Stepper } = setupFlow;

// The icon is aria-hidden by the library, so the state is also spoken as text.
const STATE_SR_LABELS: Record<SetupStep['state'], string> = {
  done: 'הושלם',
  current: 'שלב נוכחי',
  pending: 'ממתין',
  blocked: 'חסום',
};

function StepIcon({ state }: { state: SetupStep['state'] }) {
  return (
    <span
      className={cn(
        'mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full',
        state === 'done' && 'bg-success/15 text-success',
        state === 'current' && 'bg-primary/10 text-primary',
        state === 'pending' && 'bg-muted text-muted-foreground',
        state === 'blocked' && 'bg-warning/10 text-warning',
      )}
    >
      {state === 'done' ? <Check className="size-4" /> : null}
      {state === 'current' ? <LoaderCircle className="size-4" /> : null}
      {state === 'pending' ? <Circle className="size-3" /> : null}
      {state === 'blocked' ? <Lock className="size-4" /> : null}
    </span>
  );
}

const noop = () => undefined;

export type SetupStepView = SetupStep & { label: string };
/** Where "back" leads, decided on the server: the href, and the name of the step it leads to. */
export type SetupStepperBack = { href: string; label: string };

export function SetupStepper({ steps, back = null }: { steps: SetupStepView[]; back?: SetupStepperBack | null }) {
  const router = useRouter();
  const byKey = new Map(steps.map((s) => [s.key, s]));
  // The server marks at most one step `current` (or `blocked`, when the next
  // step cannot proceed). When every step is done there is none: point at the
  // last one so the library always has a valid active step.
  const active =
    steps.find((s) => s.state === 'current') ??
    steps.find((s) => s.state === 'blocked') ??
    steps[steps.length - 1];
  const completed = steps.filter((s) => s.state === 'done').map((s) => s.key);

  return (
    <Stepper.Root
      step={active.key}
      onStepChange={() => {
        if (back) router.push(back.href);
      }}
      beforeStepChange={(context) => back !== null && context.direction === 'prev'}
      completed={completed}
      onCompletedChange={noop}
      orientation="vertical"
      aria-label="שלבי ההקמה"
    >
      <Stepper.List role="list" className="space-y-1">
        <Stepper.Items>
          {(item) => {
            const s = byKey.get(item.id);
            if (!s) return null;
            // Numbered by the position among the steps actually shown, so a step the server left out leaves no gap.
            const position = steps.findIndex((x) => x.key === item.id) + 1;
            const isCurrent = s.state === 'current';
            return (
              <Stepper.Item
                key={item.id}
                aria-current={isCurrent ? 'step' : undefined}
                data-blocked={s.state === 'blocked' ? '' : undefined}
                className={cn(
                  'flex items-start gap-3 rounded-md px-2 py-2',
                  isCurrent && 'bg-primary/5',
                )}
              >
                <Stepper.Indicator render={(props) => <span {...props}><StepIcon state={s.state} /></span>} />
                <div className="min-w-0 flex-1">
                  <Stepper.Title
                    render={(props) => (
                      <p {...props} className={cn('text-sm font-medium', s.state === 'pending' && 'text-muted-foreground')}>
                        {position}. {s.label}
                        <span className="sr-only"> – {STATE_SR_LABELS[s.state]}</span>
                      </p>
                    )}
                  />
                  {s.hint ? (
                    <Stepper.Description
                      render={(props) => (
                        <p {...props} className="text-xs text-muted-foreground">
                          {s.hint}
                        </p>
                      )}
                    />
                  ) : null}
                </div>
              </Stepper.Item>
            );
          }}
        </Stepper.Items>
      </Stepper.List>
      {back ? (
        <Stepper.Actions className="mt-3">
          <Stepper.Prev
            render={(props) => (
              <button {...props} className={cn(buttonVariants({ variant: 'outline', size: 'sm' }))}>
                <span aria-hidden="true">→</span>
                חזרה: {back.label}
              </button>
            )}
          />
        </Stepper.Actions>
      ) : null}
    </Stepper.Root>
  );
}
