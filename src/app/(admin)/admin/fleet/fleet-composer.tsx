'use client';

import {
  createContext,
  useActionState,
  useCallback,
  useContext,
  useId,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { useFormStatus } from 'react-dom';
import { useRouter } from 'next/navigation';
import { ArrowUp, Check, SendHorizontal, SlidersHorizontal, X } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { compactSelectClass, FieldError, FormError, FormNotice } from '@/components/forms';
import { deriveSubject, TITLE_MAX } from '@/lib/fleet/conversation';
import type { Reachability } from '@/lib/fleet/reachability';
import type { FormState } from '@/lib/validation/result';
import { cn } from '@/lib/utils';
import { answerFleetRequestAction, createFleetRequestAction, type FleetComposeState } from './actions';
import { NewGoalSheet } from './fleet-goals';

// The one composer of a conversation (plan D5). ONE form whose action switches
// with the mode — never two conditional forms, because unmounting a form
// throws the draft away. Both useActionState hooks are always called
// (rules-of-hooks) and live in the provider together with the draft, so the
// bubbles (which switch the mode) and the form read one source of truth.
//
//   new      → createFleetRequestAction (subject + body >= 10)
//   reply    → answerFleetRequestAction (answer <= 2000; approval: אשר/דחה)
//   continue → createFleetRequestAction with continueFrom=<id> (body >= 2)
//
// No optimistic append: the button shows pending, then the revalidated page
// brings the real bubble, and the router lands on it (?focus=).

export type ComposerMode =
  | { type: 'new' }
  | { type: 'reply'; id: string; title: string; kind: string }
  | { type: 'continue'; id: string; title: string };

type ComposerContextValue = {
  role: string;
  mode: ComposerMode;
  /** A submission is in flight — the mode cannot change until it settles. */
  busy: boolean;
  start: (mode: ComposerMode) => void;
  cancel: () => void;
  draft: string;
  setDraft: (value: string) => void;
  subjectOverride: string | null;
  setSubjectOverride: (value: string | null) => void;
  textareaRef: React.RefObject<HTMLTextAreaElement | null>;
  newState: FleetComposeState;
  newAction: (formData: FormData) => void;
  replyState: FormState;
  replyAction: (formData: FormData) => void;
  /** The last settled submission's message, whichever action it came from —
   * a successful reply switches the mode back to "new", and its notice must
   * survive that switch. */
  feedback: { error?: string; notice?: string } | null;
};

const ComposerContext = createContext<ComposerContextValue | null>(null);

export function useComposer(): ComposerContextValue {
  const ctx = useContext(ComposerContext);
  if (!ctx) throw new Error('useComposer must be used inside <ComposerProvider>');
  return ctx;
}

function focusSoon(ref: React.RefObject<HTMLTextAreaElement | null>) {
  requestAnimationFrame(() => ref.current?.focus());
}

export function ComposerProvider({ role, children }: { role: string; children?: ReactNode }) {
  const router = useRouter();
  const [mode, setMode] = useState<ComposerMode>({ type: 'new' });
  const [draft, setDraft] = useState('');
  // null = follow the first line of the draft; a string = the owner edited it.
  const [subjectOverride, setSubjectOverride] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const [feedback, setFeedback] = useState<ComposerContextValue['feedback']>(null);

  const [newState, newAction, newPending] = useActionState(
    async (prev: FleetComposeState, formData: FormData): Promise<FleetComposeState> => {
      const result = await createFleetRequestAction(prev, formData);
      setFeedback(result?.error || result?.notice ? { error: result.error, notice: result.notice } : null);
      // The draft clears only when the ACTIVE action reports success.
      if (result?.notice) {
        setDraft('');
        setSubjectOverride(null);
        setMode({ type: 'new' });
        const target = result.role ?? role;
        if (result.deduplicated && result.requestId) {
          // Today's identical message already exists: land on it and ring it
          // instead of pretending a second one was sent (plan D5).
          router.replace(`/admin/fleet?role=${encodeURIComponent(target)}&focus=${result.requestId}`, {
            scroll: false,
          });
        } else {
          // The revalidated page brings the new bubble. Viewing an older page
          // or an anchored message? Return to the live end so it is visible.
          const params = new URLSearchParams(window.location.search);
          if (params.has('before') || params.has('after') || params.has('focus')) {
            router.replace(`/admin/fleet?role=${encodeURIComponent(target)}`, { scroll: false });
          }
          // Focus stays in the composer for the next message (plan D5).
          focusSoon(textareaRef);
        }
      }
      return result;
    },
    null,
  );
  const [replyState, replyAction, replyPending] = useActionState(
    async (prev: FormState, formData: FormData): Promise<FormState> => {
      const result = await answerFleetRequestAction(prev, formData);
      setFeedback(result?.error || result?.notice ? { error: result.error, notice: result.notice } : null);
      if (result?.notice) {
        setDraft('');
        setMode({ type: 'new' });
        focusSoon(textareaRef);
      }
      return result;
    },
    null,
  );
  const busy = newPending || replyPending;

  const start = useCallback(
    (next: ComposerMode) => {
      if (busy) return;
      setMode(next);
      focusSoon(textareaRef);
    },
    [busy],
  );
  const cancel = useCallback(() => {
    if (busy) return;
    // Back to "new message" WITHOUT deleting the text (D5).
    setMode({ type: 'new' });
    focusSoon(textareaRef);
  }, [busy]);

  const value = useMemo<ComposerContextValue>(
    () => ({
      role,
      mode,
      busy,
      start,
      cancel,
      draft,
      setDraft,
      subjectOverride,
      setSubjectOverride,
      textareaRef,
      newState,
      newAction,
      replyState,
      replyAction,
      feedback,
    }),
    [role, mode, busy, start, cancel, draft, subjectOverride, newState, newAction, replyState, replyAction, feedback],
  );

  return <ComposerContext.Provider value={value}>{children}</ComposerContext.Provider>;
}

// "N פניות ממתינות לתשובתך ↑" — jumps to the first bubble waiting on the
// owner. Replaces the old "another message in this thread is waiting" Alert.
export function PendingBar({ count }: { count: number }) {
  if (count === 0) return null;
  return (
    <button
      type="button"
      onClick={() => {
        const target = document.querySelector<HTMLElement>('[data-waiting-owner="true"]');
        if (!target) return;
        const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        target.scrollIntoView({ block: 'center', behavior: reduce ? 'auto' : 'smooth' });
        target.focus({ preventScroll: true });
      }}
      className="flex min-h-11 w-full shrink-0 items-center justify-center gap-1.5 border-t border-border bg-background px-4 py-2 text-sm font-medium text-warning outline-none hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50"
    >
      {count === 1 ? 'פנייה אחת ממתינה לתשובתך' : `${count} פניות ממתינות לתשובתך`}
      <ArrowUp className="size-4" aria-hidden />
    </button>
  );
}

function SendButton({ children, disabled }: { children: ReactNode; disabled?: boolean }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size="lg" disabled={pending || disabled} className="min-h-11 min-w-11">
      {pending ? 'שולח…' : children}
    </Button>
  );
}

function VerdictSubmit({
  verdict,
  variant,
  children,
  describedBy,
}: {
  verdict: 'approved' | 'denied';
  variant: 'default' | 'destructive';
  children: ReactNode;
  describedBy: string;
}) {
  const { pending } = useFormStatus();
  return (
    <Button
      type="submit"
      name="verdict"
      value={verdict}
      size="lg"
      variant={variant}
      disabled={pending}
      aria-describedby={describedBy}
      className="min-h-11"
    >
      {children}
    </Button>
  );
}

const NEW_MAX = 8000;
const REPLY_MAX = 2000;

export function FleetComposer({
  reach,
  goalReach,
  hasClosedExchange,
  autoFocus,
}: {
  reach: Reachability;
  /** Same, for the goal_due trigger (the "+ מטרה" sheet). */
  goalReach: Reachability;
  /** At least one closed exchange exists — shows the "no context" hint. */
  hasClosedExchange: boolean;
  autoFocus: boolean;
}) {
  const {
    role,
    mode,
    busy,
    cancel,
    draft,
    setDraft,
    subjectOverride,
    setSubjectOverride,
    textareaRef,
    newState,
    newAction,
    replyState,
    replyAction,
    feedback,
  } = useComposer();
  const uid = useId();
  const [showOptions, setShowOptions] = useState(false);
  const [asFyi, setAsFyi] = useState(false);
  const [tier, setTier] = useState('0');

  const isReply = mode.type === 'reply';
  const isContinue = mode.type === 'continue';
  const isApprovalReply = mode.type === 'reply' && mode.kind === 'approval';
  const max = isReply ? REPLY_MAX : NEW_MAX;
  // A disabled/unknown agent: the box stays visible and explains why, but
  // cannot send. Answering an agent's still-open request is always allowed.
  const blocked = !isReply && reach.tone === 'blocked';
  const subject = subjectOverride ?? deriveSubject(draft);
  const bodyErrors = isReply ? replyState?.fieldErrors?.answer : newState?.fieldErrors?.body;
  const titleId = `${uid}-replying-to`;
  const errorId = `${uid}-body-error`;

  const placeholder =
    mode.type === 'reply'
      ? `תשובה ל-${mode.title}…`
      : mode.type === 'continue'
        ? `המשך ל-${mode.title}…`
        : `הודעה ל-${role}…`;

  return (
    <form
      action={isReply ? replyAction : newAction}
      aria-label={isReply ? 'תשובה לפנייה' : 'הודעה לסוכן'}
      className="shrink-0 space-y-2 border-t border-border bg-background px-3 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]"
      onKeyDown={(e) => {
        if (e.key === 'Escape' && mode.type !== 'new') {
          e.preventDefault();
          cancel();
        }
      }}
    >
      <input type="hidden" name="role" value={role} />
      {mode.type === 'reply' ? <input type="hidden" name="id" value={mode.id} /> : null}
      {mode.type === 'continue' ? <input type="hidden" name="continueFrom" value={mode.id} /> : null}
      {mode.type === 'new' ? (
        <>
          <input type="hidden" name="kind" value={asFyi ? 'fyi' : 'question'} />
          <input type="hidden" name="tier" value={tier} />
        </>
      ) : null}
      {isReply && !isApprovalReply ? <input type="hidden" name="verdict" value="answered" /> : null}

      {mode.type !== 'new' ? (
        <div className="flex items-center gap-2 rounded-lg bg-muted px-3 py-1.5 text-sm">
          <span className="shrink-0 text-foreground">{isContinue ? 'ממשיך את:' : 'משיב ל:'}</span>
          <bdi id={titleId} dir="auto" className="min-w-0 flex-1 font-medium wrap-anywhere">
            {mode.title}
          </bdi>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            onClick={cancel}
            disabled={busy}
            aria-label={isContinue ? 'ביטול ההמשך (Esc)' : 'ביטול התשובה (Esc)'}
            className="size-9"
          >
            <X aria-hidden />
          </Button>
        </div>
      ) : (
        <div className="flex items-center gap-2">
          <label htmlFor={`${uid}-subject`} className="shrink-0 text-sm font-medium">
            נושא:
          </label>
          <Input
            id={`${uid}-subject`}
            name="title"
            value={subject}
            onChange={(e) => setSubjectOverride(e.target.value)}
            maxLength={TITLE_MAX}
            disabled={blocked}
            placeholder="השורה הראשונה של ההודעה"
            dir="auto"
            className="h-9 min-w-0 flex-1"
          />
        </div>
      )}

      <div>
        <label htmlFor={`${uid}-body`} className="sr-only">
          {mode.type === 'reply' ? `תשובה ל-${mode.title}` : 'תוכן ההודעה'}
        </label>
        <Textarea
          id={`${uid}-body`}
          ref={textareaRef}
          name={isReply ? 'answer' : 'body'}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            // Enter adds a line; Ctrl/⌘+Enter sends — not mid-IME composition,
            // and not on an approval reply, where the verdict must be chosen.
            if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && !e.nativeEvent.isComposing && !isApprovalReply) {
              e.preventDefault();
              e.currentTarget.form?.requestSubmit();
            }
          }}
          maxLength={max}
          required={mode.type !== 'reply' || mode.kind === 'question'}
          disabled={blocked}
          autoFocus={autoFocus}
          rows={2}
          placeholder={placeholder}
          aria-describedby={cn(`${uid}-counter ${uid}-reach`, bodyErrors?.length && errorId)}
          aria-invalid={bodyErrors?.length ? true : undefined}
          // Auto-grow (field-sizing) up to 6 lines, then scroll. text-base
          // below md comes from the primitive — 16px stops iOS zoom.
          className="max-h-[calc(6lh+1rem)] resize-none"
        />
        <FieldError id={errorId} errors={bodyErrors} />
        {mode.type === 'new' ? <FieldError errors={newState?.fieldErrors?.title} /> : null}
        {mode.type === 'new' ? <FieldError errors={newState?.fieldErrors?.role} /> : null}
      </div>

      {showOptions && mode.type === 'new' ? (
        <fieldset className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-lg border border-border px-3 py-2 text-sm">
          <legend className="sr-only">אפשרויות שליחה</legend>
          <label className="flex min-h-11 items-center gap-2">
            <input type="checkbox" checked={asFyi} onChange={(e) => setAsFyi(e.target.checked)} className="size-4" />
            לידיעה בלבד
          </label>
          <label className="flex min-h-11 items-center gap-2">
            דרגה
            <select
              value={tier}
              onChange={(e) => setTier(e.target.value)}
              className={cn(compactSelectClass, 'text-base md:text-sm')}
            >
              <option value="0">0 — דיווח</option>
              <option value="1">1 — קוד/בטא</option>
              <option value="2">2 — רגיש</option>
            </select>
          </label>
          <p className="basis-full text-xs text-muted-foreground">
            הדרגה היא תיוג בלבד — היא לא מרחיבה את ההרשאות של הסוכן.
          </p>
        </fieldset>
      ) : null}

      <p
        id={`${uid}-reach`}
        className={cn(
          'text-xs',
          isReply || reach.tone === 'ok'
            ? 'text-muted-foreground'
            : reach.tone === 'warn'
              ? 'text-warning'
              : 'text-destructive',
        )}
      >
        {isReply ? 'התשובה תיקלט אצל הסוכן בתחילת ההרצה הבאה שלו.' : reach.text}
      </p>
      {mode.type === 'new' && hasClosedExchange ? (
        <p className="text-xs text-muted-foreground">
          הודעה חדשה נשלחת בלי הקשר · להמשך — &quot;השב&quot; על ההודעה
        </p>
      ) : null}

      {/* The softphone FAB is fixed bottom-4 start-4 (bottom-RIGHT in RTL).
          Below md this row is padded on the start side so the send controls
          never sit under it. */}
      <div className="flex flex-wrap items-center gap-2 max-md:ps-14">
        {mode.type === 'new' ? (
          <>
            <Button
              type="button"
              variant="ghost"
              size="icon-lg"
              onClick={() => setShowOptions((v) => !v)}
              aria-expanded={showOptions}
              aria-label="אפשרויות שליחה"
              disabled={blocked}
              className="size-11"
            >
              <SlidersHorizontal aria-hidden />
            </Button>
            <NewGoalSheet role={role} reach={goalReach} disabled={goalReach.tone === 'blocked' || busy} />
          </>
        ) : null}
        <span id={`${uid}-counter`} className="text-xs text-muted-foreground tabular-nums" dir="ltr">
          {draft.length}/{max}
        </span>
        <div className="ms-auto flex items-center gap-2">
          {isApprovalReply ? (
            <>
              <VerdictSubmit verdict="denied" variant="destructive" describedBy={titleId}>
                <X aria-hidden />
                דחה
              </VerdictSubmit>
              <VerdictSubmit verdict="approved" variant="default" describedBy={titleId}>
                <Check aria-hidden />
                אשר
              </VerdictSubmit>
            </>
          ) : (
            <SendButton disabled={blocked}>
              <SendHorizontal className="rtl:-scale-x-100" aria-hidden />
              {isReply ? 'שלח תשובה' : 'שלח'}
            </SendButton>
          )}
        </div>
      </div>

      <div aria-live="polite" className="space-y-2 empty:hidden">
        <FormError message={feedback?.error} />
        <FormNotice message={feedback?.notice} />
      </div>
    </form>
  );
}
