// Pins the one thing in app-bar.tsx that is minifier output.
//
// The SDK registers its own language switcher at module load, with no `name`,
// so the decorator registry keys it by the MINIFIED function name of the
// component. Removing it means re-registering that exact key. There is no
// public list API to discover the key from — only `hasRegisteredComponentDecorator`,
// which answers yes/no for a name you already have.
//
// So the name is a literal in our source, and this is the join. On an SDK
// upgrade that remints it, the switcher silently comes back: the "EN" button
// reappears over a Hebrew editor, and tsc, eslint and the build all stay green
// because nothing about it is a type. This test fails instead.
//
// TO FIX A FAILURE: open node_modules/@workflowbuilder/sdk/dist/index-*.js and
// search for `"OptionalAppBarControls"`. The registration whose content renders
// `code.toUpperCase()` from a two-entry `[{en},{pl}]` list is the switcher; its
// `content` identifier is the new name. Update the constant in app-bar.tsx.
import { hasRegisteredComponentDecorator } from '@workflowbuilder/sdk';
import { describe, expect, it } from 'vitest';

// Kept as its own literal rather than imported from app-bar.tsx: that module is
// a client component pulling in React UI, and this assertion is about the SDK.
const SDK_LANGUAGE_SWITCHER = 'jA';

describe("the SDK's built-in app-bar language switcher", () => {
  it('is still registered under the name app-bar.tsx replaces', () => {
    // Registered by the SDK's own module-load side effect, not by us — merely
    // importing the package above is what puts it in the registry.
    expect(
      hasRegisteredComponentDecorator('OptionalAppBarControls', SDK_LANGUAGE_SWITCHER),
    ).toBe(true);
  });

  it('does not answer yes for a name that was never registered', () => {
    // Guards against the assertion above passing vacuously if the function ever
    // starts returning a truthy value for everything.
    expect(
      hasRegisteredComponentDecorator('OptionalAppBarControls', 'kalfa-not-a-real-plugin'),
    ).toBeFalsy();
  });
});
