import 'server-only';

// Server-only entry point for the Voximplant Management API client.
//
// The implementation lives in `./core` (runtime-agnostic, no `server-only`) so it
// can be shared with the in-repo CLI (`./cli`) without duplicating JWT+fetch. This
// module just re-exports it behind the `server-only` guard, which prevents the
// client from ever being bundled into a browser/client component. Import THIS from
// Next server code (Server Actions, Route Handlers); the CLI imports `./core`.
export type { VoximplantConfig, VoxParams } from './core';
export {
  VoximplantApiError,
  VoximplantNetworkError,
  signManagementJwt,
  voxRequest,
  getAccountInfo,
  startScenarios,
} from './core';
