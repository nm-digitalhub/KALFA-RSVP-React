import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

// tier0-design.settings.json is tier0 plus Claude Design, for the three design
// roles only (fleet.json "settings": "tier0-design"). The CLI in print mode
// silently IGNORES a settings file that fails validation, and a hand-edited
// copy drifts — so this pins it to tier0 read live: every tier0 rule and hook
// must still be here, and the only additions are the named design tools.

const FLEET_DIR = join(import.meta.dirname, '../../../.claude/fleet');

type Settings = {
  permissions: { defaultMode: string; allow: string[]; deny: string[] };
  hooks?: unknown;
  enabledPlugins?: Record<string, boolean>;
};
type FleetConfig = { roles: Record<string, { settings?: string; mcp_config?: string; tier?: number }> };

const read = <T>(file: string) => JSON.parse(readFileSync(join(FLEET_DIR, file), 'utf8')) as T;
const tier0 = read<Settings>('settings/tier0.settings.json');
const design = read<Settings>('settings/tier0-design.settings.json');
const fleet = read<FleetConfig>('fleet.json');

const DESIGN_ROLES = ['social-manager', 'brand-director', 'creative-producer'];

describe('tier0-design settings', () => {
  it('keeps every tier0 allow, deny and hook verbatim', () => {
    expect(design.permissions.defaultMode).toBe(tier0.permissions.defaultMode);
    expect(tier0.permissions.allow.filter((r) => !design.permissions.allow.includes(r))).toEqual([]);
    expect(tier0.permissions.deny.filter((r) => !design.permissions.deny.includes(r))).toEqual([]);
    expect(design.hooks).toEqual(tier0.hooks);
    expect(design.enabledPlugins).toEqual(tier0.enabledPlugins);
  });

  it('adds only claude-design tools, by exact name (no server-wide wildcard)', () => {
    const extraAllow = design.permissions.allow.filter((r) => !tier0.permissions.allow.includes(r));
    expect(extraAllow.length).toBeGreaterThan(0);
    for (const r of extraAllow) expect(r).toMatch(/^mcp__claude-design__[a-z_]+$/);
  });

  it('denies sharing, membership and delete tools — designs stay private drafts', () => {
    for (const tool of ['update_sharing', 'add_member', 'remove_member', 'update_member_role', 'delete_files']) {
      expect(design.permissions.deny).toContain(`mcp__claude-design__${tool}`);
      expect(design.permissions.allow).not.toContain(`mcp__claude-design__${tool}`);
    }
  });

  it('is used by exactly the three design roles, which stay tier 0', () => {
    const users = Object.entries(fleet.roles)
      .filter(([, r]) => typeof r === 'object' && r.settings === 'tier0-design')
      .map(([name]) => name)
      .sort();
    expect(users).toEqual([...DESIGN_ROLES].sort());
    for (const name of DESIGN_ROLES) {
      expect(fleet.roles[name].tier).toBe(0);
      expect(fleet.roles[name].mcp_config).toBe('design');
    }
  });

  it('points the design MCP config at the Claude Design server', () => {
    const mcp = read<{ mcpServers: Record<string, { type: string; url: string }> }>('settings/design.mcp.json');
    expect(Object.keys(mcp.mcpServers)).toEqual(['claude-design']);
    expect(mcp.mcpServers['claude-design'].url).toBe('https://api.anthropic.com/v1/design/mcp');
  });
});
