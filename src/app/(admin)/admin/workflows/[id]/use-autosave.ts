'use client';

// Automatic saving, restored.
//
// WHAT WAS BROKEN, and it was silent.
//
// The SDK auto-saves. It also saves when the page is being unloaded. Neither is
// a property of the editor: BOTH live inside the Save button of
// `WorkflowBuilder.TopBar` — in the 2.3.0 bundle the save-button component calls
// `o4()` (the debounced auto-save effect) and `a4()` (the `beforeunload`
// listener) before rendering anything.
//
// This admin editor mounts `Palette`, `Canvas` and `PropertiesPanel` and
// replaces the TopBar with its own Hebrew, RTL toolbar. That swap — made for
// good reasons — took the auto-save with it, and nothing said so: no warning, no
// type error, and a manual Save button still sitting there working perfectly.
// An owner could arrange a diagram for ten minutes, close the tab, and lose all
// of it.
//
// THE CONSTANTS BELOW ARE THE SDK'S OWN, read out of the bundle rather than
// guessed, so the embedded editor behaves like the demo the owner compared it
// against:
//
//   `n4 = ["nodeDragStart", "nodeDragChange"]`  changes that do NOT trigger a save
//   `t4 = 10`                                   seconds since the last attempt
//   `r4 = 400`                                  debounce, in ms
//
// The one deliberate divergence is `setDiagramModel`, which fires when a diagram
// is LOADED. Upstream lets it schedule a save, so opening a workflow writes it
// straight back unchanged. Harmless, and still a pointless write on every open,
// so it is skipped here.
import { useChangesTrackerStore } from '@workflowbuilder/sdk';
import { useEffect, useRef } from 'react';

/**
 * Change names that must not schedule a save.
 *
 * The first two are upstream's: they fire continuously while a node is being
 * dragged, and saving mid-drag would write a position the owner has not chosen
 * yet. `manualSave` is emitted BY a successful manual save — reacting to it
 * would save again, forever. `setDiagramModel` is the load, as above.
 */
const IGNORED_CHANGES = new Set([
  'nodeDragStart',
  'nodeDragChange',
  'manualSave',
  'setDiagramModel',
]);

const MIN_SECONDS_SINCE_LAST_ATTEMPT = 10;
const DEBOUNCE_MS = 400;

/**
 * Schedule a save after a tracked diagram change.
 *
 * `enabled` is the caller's gate, not a convenience: a read-only editor must not
 * write, and neither must one whose name field is empty — the manual button
 * already refuses that, and an auto-save that ignored it would persist a state
 * the owner is being told is invalid.
 */
export function useAutoSave(save: () => Promise<void>, enabled: boolean) {
  const lastChangeName = useChangesTrackerStore((s) => s.lastChangeName);
  const lastChangeTimestamp = useChangesTrackerStore((s) => s.lastChangeTimestamp);

  // Refs, not state: changing either must not itself cause a render, and the
  // unload handler below has to read the latest value without being re-bound.
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  // `0` rather than `Date.now()`, and stamped on mount below. Reading the clock
  // during render is an impure call — the React compiler rejects it, and it is
  // wrong for a reason beyond the rule: under StrictMode or a re-render the
  // initializer is evaluated more than once, so "when this editor opened" would
  // quietly become "some later render".
  const lastAttempt = useRef(0);
  const isDirty = useRef(false);
  const saveRef = useRef(save);
  const enabledRef = useRef(enabled);

  // Written in an effect, not during render. Refs are not a side channel out of
  // the render pass; assigning one there is the same class of mistake as
  // mutating state, and the compiler is right to refuse it.
  useEffect(() => {
    saveRef.current = save;
    enabledRef.current = enabled;
  }, [save, enabled]);

  // The clock starts when the editor mounts, so a change arriving right after a
  // diagram loads does not read as "10 seconds since the last attempt" and save
  // immediately.
  useEffect(() => {
    lastAttempt.current = Date.now();
  }, []);

  useEffect(() => {
    if (!enabled || lastChangeName === '' || IGNORED_CHANGES.has(lastChangeName)) return;

    isDirty.current = true;
    clearTimeout(timer.current);

    // Upstream's rule: only once the last attempt is far enough behind. It makes
    // a burst of edits cost one write rather than one per edit, and it is why a
    // busy owner does not generate a save per keystroke.
    if ((lastChangeTimestamp - lastAttempt.current) / 1000 <= MIN_SECONDS_SINCE_LAST_ATTEMPT) {
      return;
    }

    timer.current = setTimeout(() => {
      lastAttempt.current = Date.now();
      isDirty.current = false;
      void saveRef.current();
    }, DEBOUNCE_MS);

    return () => clearTimeout(timer.current);
  }, [enabled, lastChangeName, lastChangeTimestamp]);

  // The last line of defence, and honestly a partial one.
  //
  // A `beforeunload` handler cannot await: the browser tears the page down and a
  // server action in flight may never land. Upstream does exactly this and has
  // the same limit. It is kept because a save that usually succeeds is better
  // than none, and because the debounce above already keeps the unsaved window
  // to seconds.
  //
  // What is NOT done here: calling `preventDefault()` to raise the browser's
  // "leave site?" dialog. That would make the window reliable, at the cost of
  // interrupting every single exit from the page — including the ones with
  // nothing pending. Worth offering as a setting; not worth imposing.
  useEffect(() => {
    function onBeforeUnload() {
      if (!enabledRef.current || !isDirty.current) return;
      isDirty.current = false;
      void saveRef.current();
    }
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, []);
}
