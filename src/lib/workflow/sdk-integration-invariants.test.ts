import { readFileSync, readdirSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

// The assumptions this app makes about @workflowbuilder/sdk, turned into checks.
//
// ⚠️ WHY THESE ARE TESTS AND NOT NOTES. Every one of them was established by
// reading the SDK's own docs and then the published artifact, and every one of
// them is invisible at the type level: the compiler cannot see a second `<Root>`
// on a page, a subpath import that reaches into internals, or an immer copy that
// became shared on the next `npm install`. A note records what was true in
// September; a test says so on the day it stops being true — which is the day a
// version bump lands, and the only day anyone can act on it cheaply.

const ROOT = process.cwd();
const SDK = join(ROOT, 'node_modules/@workflowbuilder/sdk');

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.tsx?$/.test(entry) && !entry.endsWith('.test.ts') && !entry.endsWith('.test.tsx')) {
      out.push(full);
    }
  }
  return out;
}

const SOURCES = walk(join(ROOT, 'src'));

describe('SDK integration invariants', () => {
  it('mounts exactly one <WorkflowBuilder.Root>', () => {
    // ⚠️ "Mount only one <WorkflowBuilder.Root> per page. Multi-instance is not
    // supported: the plugin / decorator / JsonForms / i18n registries are
    // module-level singletons shared across mounts" — and the imperative
    // `useStore.{getState,setState,subscribe}` facade resolves through a
    // module-level "current" pointer, so a second Root would not merely render
    // twice: writes from one subtree would leak into the other.
    //
    // We call that facade directly (`useStore.setState({ globalVariables })`,
    // `useStore.getState().fetchData()`), so the leak would be ours to debug.
    // ⚠️ A MOUNT, NOT A MENTION. A plain `includes` counted three files on its
    // first run — two of them JSDoc blocks explaining the prop contract. A guard
    // that fails on its own documentation trains people to weaken it, so the
    // match is anchored: the line, trimmed, must OPEN with the element. A
    // comment line starts with `*` or `//`, a string with a quote.
    const mounts = SOURCES.filter((f) =>
      readFileSync(f, 'utf8')
        .split('\n')
        .some((line) => line.trimStart().startsWith('<WorkflowBuilder.Root')),
    );
    expect(mounts.map((f) => f.slice(ROOT.length + 1))).toHaveLength(1);
  });

  it('imports only the curated barrel, never a subpath', () => {
    // "@workflowbuilder/sdk/<subpath> ships raw .ts files and reaches into SDK
    // internals that may change without notice … Subpath imports are for
    // monorepo use only." The one sanctioned exception is the stylesheet.
    const offenders: string[] = [];
    for (const file of SOURCES) {
      const source = readFileSync(file, 'utf8');
      for (const m of source.matchAll(/['"]@workflowbuilder\/sdk\/([^'"]+)['"]/g)) {
        if (m[1] !== 'style.css') offenders.push(`${file.slice(ROOT.length + 1)} → ${m[1]}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('the SDK still does not disable immer auto-freeze globally', () => {
    // ⚠️ THE DOCS SAY IT DOES, AND THE ARTIFACT DOES NOT. `get-started/
    // side-effects` states the SDK calls `setAutoFreeze(false)` on import and
    // warns that this "disables auto-freeze globally for the host app — any of
    // your own reducers, RTK slices … lose that protection". RTK IS in our
    // runtime (recharts pulls it), so that warning would land on us.
    //
    // In 2.3.0 the published dist contains ZERO occurrences of autoFreeze: the
    // bundle imports `produce` from immer and nothing else. If a future version
    // restores the call, this test fails and the immer-copy check below becomes
    // the thing that decides whether it reaches our reducers.
    const dist = join(SDK, 'dist');
    const hits = readdirSync(dist)
      .filter((f) => f.endsWith('.js'))
      .filter((f) => /autoFreeze/i.test(readFileSync(join(dist, f), 'utf8')));
    expect(hits).toEqual([]);
  });

  it('the SDK does not share an immer copy with the reducers immer would freeze', () => {
    // WHAT THIS PROTECTS, and why it is phrased as "not the same copy" rather
    // than "the SDK has a nested copy".
    //
    // WHY A SEPARATE COPY IS SUFFICIENT — verified in immer's own source, not
    // inferred from the SDK's docs. `node_modules/immer/dist/immer.mjs`:
    //
    //   var Immer2 = class {
    //     constructor(config) { this.autoFreeze_ = true; }   // per INSTANCE
    //     setAutoFreeze(value) { this.autoFreeze_ = value; }
    //   }
    //   var immer = new Immer2();                            // module singleton
    //   var setAutoFreeze = immer.setAutoFreeze.bind(immer);
    //
    // The exported `setAutoFreeze` is BOUND to one module-level singleton, so
    // its blast radius is exactly one copy of the module. Two copies therefore
    // cannot reach each other — which is the whole mechanism this test guards.
    // (immer 11, RTK's copy, has the identical shape: same three lines.)
    //
    // The SDK's own docs (get-started/side-effects, saved 2026-09-09) say it
    // calls `setAutoFreeze(false)` on import and warn that "because immer is a
    // shared, deduped dependency, this disables auto-freeze globally for the
    // host app — any of your own reducers, RTK slices … lose that protection".
    // TWO things about that warning are false for us, both measured: the 2.3.0
    // artifact makes no such call (the test above), and immer is NOT deduped
    // here — the SDK resolves 10.x, RTK resolves 11.x. This test pins the
    // second one, because it is what makes the first one merely a warning.
    //
    // It changed on 2026-09-22: an `npm update` moved recharts 3.8 → 3.10.1
    // (RTK 2.12.0), and npm flipped the hoist — immer 10 came up to the root
    // next to the SDK and zustand, pushing RTK's immer 11 down under recharts.
    // The earlier form of this test asserted the OLD shape (a nested copy under
    // the SDK) and failed, although containment itself never lapsed. MEASURED
    // at that commit: the SDK dist has zero `autoFreeze` occurrences (the test
    // above), no source of ours imports `immer` or `zustand/middleware/immer`,
    // and @xyflow does not use that middleware either — so nothing routed
    // through the shared copy even while it was shared.
    //
    // Attempted and rejected: npm `overrides` pinning root immer to ^11 and the
    // SDK's to ^10. npm ignores it — the SDK's `^10.0.0` and RTK's `^11.0.0`
    // are both hard ranges and npm decides the hoist itself. Overrides DO work
    // in this repo (yaml is forced to 1.10.3 under voxengine-ci), so this is
    // npm declining this particular split, not a broken mechanism.
    const require_ = createRequire(join(ROOT, 'noop.js'));
    const resolveFrom = (from: string) =>
      require_.resolve('immer/package.json', { paths: [join(ROOT, 'node_modules', from)] });

    const sdkImmer = resolveFrom('@workflowbuilder/sdk');
    const rtkImmer = resolveFrom('@reduxjs/toolkit');

    // Anti-no-op: a typo'd package name would make both throw, not differ.
    expect(sdkImmer).toMatch(/immer/);
    expect(rtkImmer).toMatch(/immer/);

    expect(
      sdkImmer,
      'the SDK and RTK now resolve the SAME immer copy — a future SDK ' +
        'setAutoFreeze(false) would disable auto-freeze for RTK reducers',
    ).not.toBe(rtkImmer);

    // And they are different majors, so they cannot silently become one copy
    // on a future hoist without this test noticing.
    const major = (p: string) =>
      String((JSON.parse(readFileSync(p, 'utf8')) as { version: string }).version).split('.')[0];
    expect(major(sdkImmer)).not.toBe(major(rtkImmer));
  });

  it('still requires host-side hydration for persisted global variables', () => {
    // @workflowbuilder/sdk 2.3.0 persists globalVariables as part of its
    // integration data, but <WorkflowBuilder.Root> exposes initialNodes and
    // initialEdges without an equivalent initialGlobalVariables prop.
    //
    // KALFA therefore hydrates this one persisted field through useStore.
    // If a future SDK release adds a public Root prop, this test should fail so
    // the workaround can be reviewed instead of being carried forward blindly.
    const declarations = readFileSync(join(SDK, 'dist/index.d.ts'), 'utf8');

    expect(declarations).toContain(
      'export declare type WorkflowBuilderRootProps = PropsWithChildren<{',
    );
    expect(declarations).toContain('initialNodes?: WorkflowBuilderNode[];');
    expect(declarations).toContain('initialEdges?: WorkflowBuilderEdge[];');
    expect(declarations).not.toContain('initialGlobalVariables');

    // globalVariables themselves are nevertheless part of the SDK integration
    // model, so their absence above is specifically a Root hydration gap rather
    // than evidence that the SDK does not support/persist them.
    expect(declarations).toMatch(
      /IntegrationDataFormat\s*=\s*\{[\s\S]*?globalVariables:\s*VariablesIndex;[\s\S]*?\};/,
    );

    // There is also no public imperative setter equivalent to setStoreNodes /
    // setStoreEdges that KALFA could use instead of the store facade.
    const publicEntry = readFileSync(join(SDK, 'dist/index.js'), 'utf8');
    expect(publicEntry).toContain('setStoreNodes');
    expect(publicEntry).toContain('setStoreEdges');
    expect(publicEntry).not.toContain('setStoreGlobalVariables');
  });

  it('the palette is refreshed after its data changes, not merely re-passed', () => {
    // ⚠️ MEASURED IN THE BUNDLE: `<Root>` writes `nodeTypes` into a module-level
    // variable on every render, but the properties panel reads
    // `getNodeDefinition` off the STORE, and the store's copy is a snapshot taken
    // by `fetchData()` — which the Palette calls once, in a `useEffect` keyed on
    // the (stable) store function.
    //
    // So a new `nodeTypes` array alone never reaches an open form. The live
    // agent/rule dropdowns depend entirely on this refresh; without it they stay
    // empty forever and nothing errors.
    const editor = readFileSync(
      join(ROOT, 'src/app/(admin)/admin/workflows/[id]/workflow-editor.tsx'),
      'utf8',
    );
    expect(editor).toContain('fetchData()');
    // Keyed on the palette itself: keyed on anything narrower and a list that
    // arrives later would not trigger it.
    expect(editor).toMatch(/useEffect\(\s*\(\)\s*=>\s*\{[^}]*fetchData\(\)[^}]*\},\s*\[paletteItems\]\)/);
  });
});
