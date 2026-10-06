import 'server-only';

import { registerMicrosoftProvider } from './microsoft';

export function registerBuiltInProviders(): void {
  // Provider registration is replacement-safe, so calling this more than once is
  // harmless during hot reloads and worker tests.
  registerMicrosoftProvider();
}
