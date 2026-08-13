/**
 * Client-safe mirror of `voxUserNameFor` in
 * src/lib/data/console-agent-provisioning.ts (read + verified there,
 * 2026-08-12: `` `agent_${userId.toLowerCase()}` ``, 42 chars, matching
 * Voximplant's [a-z0-9][a-z0-9_-]{2,49} user-name pattern).
 *
 * Duplicated rather than imported: that module starts with `import
 * 'server-only'`, so it cannot be pulled into browser code (the softphone
 * panel needs this to build an internal-call destination —
 * ConsoleInternal's rule pattern is literally `^agent_.*`). The value is not
 * a secret, just a deterministic naming convention, so mirroring the
 * one-line algorithm here (instead of exposing vox_username through the
 * roster view/RLS) is the smaller surface.
 */
export function agentVoxUsernameFor(userId: string): string {
  return `agent_${userId.toLowerCase()}`;
}
