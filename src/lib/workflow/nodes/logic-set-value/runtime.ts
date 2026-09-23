// `logic.set_value` — the step handler. Server side: SDK-free, and it imports
// the shared step contract from `steps/shared`, never from `steps/index` (the
// registry imports this file, so that would be a cycle).
import { readString, type StepHandler } from '../../steps/shared';

// No I/O, and that is the feature.
//
// The value arrives here ALREADY RESOLVED — `resolveConfigTemplates` ran over
// the whole config before this handler was called — so this returns it as an
// output and downstream nodes read it as `{{nodes.<id>.value}}`.
//
// One line of code for a real composition primitive: define a greeting once and
// use it in every branch, instead of repeating the same expression in three
// message bodies and fixing a typo in two of them.
export const setValue: StepHandler = async (config) => ({
  output: { value: readString(config, 'value') },
});
