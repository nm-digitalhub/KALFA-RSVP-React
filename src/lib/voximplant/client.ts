import 'server-only';

// Server-only entry point for the Voximplant Management API client.
//
// The implementation is split: `./core` is READ-ONLY (shared with the CLI),
// `./mutations` holds the mutating wrappers and is NEVER imported by the CLI
// (guard test). This module re-exports both behind the `server-only` guard,
// which prevents either from ever being bundled into a browser/client
// component. Import THIS from Next server code (Server Actions, Route
// Handlers); the CLI imports `./core` only.
export type { VoximplantConfig, VoxParams } from './core';
export {
  VoximplantApiError,
  VoximplantNetworkError,
  signManagementJwt,
  voxRequest,
  getAccountInfo,
} from './core';
export { startScenarios, setAccountCallbackUrl } from './mutations';
