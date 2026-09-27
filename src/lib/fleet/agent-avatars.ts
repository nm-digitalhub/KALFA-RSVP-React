// Fleet role → avatar image under public/fleet/avatars/. An explicit map, not a
// path built from the role string: role names reach the UI from DB rows, and a
// template like `/fleet/avatars/${role}.png` would request (and 404 on) any
// value that happens to be stored there. A role missing from this map — a new
// role, or smoke-test/smoke-test-t2 today — renders its initials instead.
const FLEET_AGENT_AVATARS: Readonly<Record<string, string>> = {
  'brand-director': '/fleet/avatars/brand-director.png',
  'business-ops': '/fleet/avatars/business-ops.png',
  'callback-triage': '/fleet/avatars/callback-triage.png',
  'chief-of-staff': '/fleet/avatars/chief-of-staff.png',
  'content-seo-strategist': '/fleet/avatars/content-seo-strategist.png',
  'creative-producer': '/fleet/avatars/creative-producer.png',
  'dev-engineer': '/fleet/avatars/dev-engineer.png',
  'event-health-watcher': '/fleet/avatars/event-health-watcher.png',
  'fleet-maintainer': '/fleet/avatars/fleet-maintainer.png',
  'lifecycle-copywriter': '/fleet/avatars/lifecycle-copywriter.png',
  main: '/fleet/avatars/main.png',
  'marketing-content': '/fleet/avatars/marketing-content.png',
  'ops-monitor': '/fleet/avatars/ops-monitor.png',
  'qa-runner': '/fleet/avatars/qa-runner.png',
  'social-manager': '/fleet/avatars/social-manager.png',
  'support-drafter': '/fleet/avatars/support-drafter.png',
};

export function getFleetAgentAvatarSrc(role: string): string | null {
  return Object.hasOwn(FLEET_AGENT_AVATARS, role) ? FLEET_AGENT_AVATARS[role] : null;
}

export const FLEET_AGENT_AVATAR_ROLES = Object.keys(FLEET_AGENT_AVATARS);
