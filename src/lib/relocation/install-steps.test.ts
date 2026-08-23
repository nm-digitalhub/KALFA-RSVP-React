import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { ExecuteLatchError } from "./exec";
import { NotImplementedError, type WizardContext } from "./engine";
import { buildInstallStepDefinitions, missingEnvKeys } from "./install-steps";

const ctx: WizardContext = {
  repoRoot: "/repo",
  targetOrigin: "https://new.example",
  previousOrigin: "https://new.example",
  mode: "dry-run",
};

describe("buildInstallStepDefinitions", () => {
  const defs = buildInstallStepDefinitions();

  it("covers the full §5b sequence with unique ids, DNS before cert", () => {
    const ids = defs.map((d) => d.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toEqual(
      expect.arrayContaining(["I0", "I1", "I2", "I3", "I4", "I5", "I6", "I7", "I8", "I9", "I10", "I11", "I12"]),
    );
    // DB-resident service settings need the RUNNING app's admin — after pm2
    // start (I7), before final verification (I11):
    expect(ids.indexOf("I7")).toBeLessThan(ids.indexOf("I12"));
    expect(ids.indexOf("I12")).toBeLessThan(ids.indexOf("I11"));
    expect(ids.indexOf("I10")).toBeLessThan(ids.indexOf("I9")); // http-01 needs DNS first
    // vhost + DNS + cert must precede the setup form — it is served THROUGH
    // the vhost on the real domain (design §5c, WordPress-style):
    for (const before of ["I8", "I10", "I9"]) {
      expect(ids.indexOf(before)).toBeLessThan(ids.indexOf("I4"));
    }
  });

  it("every system-level step sits behind a gate", () => {
    const gated = Object.fromEntries(defs.map((d) => [d.id, d.gate ?? null]));
    for (const id of ["I0", "I1", "I2", "I7", "I8", "I9"]) {
      expect(gated[id], id).toBe("install-prereqs");
    }
    expect(gated.I10).toBe("dns-write-local-zone");
  });

  it("no wired apply() mutates without RELOCATE_EXECUTE=1 (I3/I12 stay manual regardless)", async () => {
    expect(process.env.RELOCATE_EXECUTE).toBeUndefined(); // ambient safety: never set outside a real run
    const alwaysManual = new Set(["I3", "I12"]);
    const noopVerifyOnly = new Set(["I11"]); // apply() has nothing to mutate — resolves fine
    for (const def of defs) {
      if (alwaysManual.has(def.id)) {
        await expect(def.apply(ctx), def.id).rejects.toBeInstanceOf(NotImplementedError);
      } else if (noopVerifyOnly.has(def.id)) {
        await expect(def.apply(ctx), def.id).resolves.toBeUndefined();
      } else {
        await expect(def.apply(ctx), def.id).rejects.toBeInstanceOf(ExecuteLatchError);
      }
    }
  });


  it("plan lines carry the live-verified commands", async () => {
    const all = (
      await Promise.all(defs.map((d) => d.plan(ctx)))
    ).flat().join("\n");
    expect(all).toContain("deb.nodesource.com/setup_24.x");
    expect(all).toContain("pm2 startup systemd");
    expect(all).toContain("--exec letsencrypt cli.php");
    expect(all).toContain("certonly --webroot");
    expect(all).toContain("npm ci");
    expect(all).toContain("--ignore-scripts would break"); // the sharp/esbuild warning
    expect(all).toContain("nginx -t");
    expect(all).toContain("plesk bin dns");
    // Secrets go browser→server, never through the wizard's state/logs, and
    // the form rides the real domain (design §5c):
    expect(all).toContain("never through wizard state/logs");
    expect(all).toContain("/setup?token=");
    expect(all).toContain("CONTINUES AUTOMATICALLY");
  });
});

describe("missingEnvKeys / the secrets check (I4)", () => {
  let dir: string;
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it("no .env.local → pending (fresh install — the setup form is what CREATES it), every example key missing (names only)", async () => {
    dir = mkdtempSync(join(tmpdir(), "relocate-install-"));
    writeFileSync(join(dir, ".env.example"), "APP_ORIGIN=x\nSECRET_A=y\n");
    const { missing, hasEnv } = missingEnvKeys(dir);
    expect(hasEnv).toBe(false);
    expect(missing).toEqual(["APP_ORIGIN", "SECRET_A"]);
    const i4 = buildInstallStepDefinitions().find((d) => d.id === "I4")!;
    expect(await i4.check({ ...ctx, repoRoot: dir })).toBe("pending");
  });

  it("all example keys present → done", async () => {
    dir = mkdtempSync(join(tmpdir(), "relocate-install-"));
    writeFileSync(join(dir, ".env.example"), "APP_ORIGIN=x\nSECRET_A=y\n");
    writeFileSync(join(dir, ".env.local"), "APP_ORIGIN=real\nSECRET_A=real\nEXTRA=ok\n");
    const i4 = buildInstallStepDefinitions().find((d) => d.id === "I4")!;
    expect(await i4.check({ ...ctx, repoRoot: dir })).toBe("done");
  });

  it("partial keys → blocked, naming only the missing KEY", async () => {
    dir = mkdtempSync(join(tmpdir(), "relocate-install-"));
    writeFileSync(join(dir, ".env.example"), "APP_ORIGIN=x\nSECRET_A=y\n");
    writeFileSync(join(dir, ".env.local"), "APP_ORIGIN=real\n");
    const { missing } = missingEnvKeys(dir);
    expect(missing).toEqual(["SECRET_A"]);
  });
});
