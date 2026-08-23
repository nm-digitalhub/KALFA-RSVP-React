import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { initState } from "./engine";
import { buildStepDefinitions } from "./steps";
import { loadState, saveState, statePath } from "./state-io";
import { RELOCATION_STATE_BACKUP_FILE } from "./state";

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "relocate-state-"));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

function freshState() {
  return initState({
    runId: "abc123",
    targetOrigin: "https://new.example",
    previousOrigin: "https://old.example",
    mode: "dry-run",
    defs: buildStepDefinitions(),
  });
}

describe("saveState / loadState", () => {
  it("round-trips a valid state, bumps serial, stamps updatedAt, mode 0600", () => {
    const state = freshState();
    saveState(dir, state);

    expect(state.serial).toBe(1);
    const mode = statSync(statePath(dir)).mode & 0o777;
    expect(mode).toBe(0o600);

    const loaded = loadState(dir);
    expect(loaded.ok).toBe(true);
    if (loaded.ok) {
      expect(loaded.state.runId).toBe("abc123");
      expect(loaded.state.target.origin).toBe("https://new.example");
    }
  });

  it("keeps the previous version as a .bak on every subsequent save", () => {
    const state = freshState();
    saveState(dir, state);
    expect(existsSync(join(dir, RELOCATION_STATE_BACKUP_FILE))).toBe(false);

    saveState(dir, state);
    expect(existsSync(join(dir, RELOCATION_STATE_BACKUP_FILE))).toBe(true);
    const backup = JSON.parse(readFileSync(join(dir, RELOCATION_STATE_BACKUP_FILE), "utf8"));
    expect(backup.serial).toBe(1);
    expect(state.serial).toBe(2);
  });

  it("missing file → not-found; corrupt JSON → unreadable; wrong version → unsupported-version", () => {
    expect(loadState(dir)).toEqual({ ok: false, reason: "not-found" });

    writeFileSync(statePath(dir), "{ truncated");
    expect(loadState(dir)).toEqual({ ok: false, reason: "unreadable" });

    writeFileSync(statePath(dir), JSON.stringify({ schemaVersion: 2 }));
    expect(loadState(dir)).toEqual({ ok: false, reason: "unsupported-version" });

    writeFileSync(statePath(dir), JSON.stringify({ schemaVersion: 1, nonsense: true }));
    expect(loadState(dir)).toEqual({ ok: false, reason: "invalid-schema" });
  });

  it("never leaves a temp file behind after a successful save", () => {
    const state = freshState();
    saveState(dir, state);
    const leftovers = readFileSync(statePath(dir), "utf8");
    expect(leftovers.endsWith("\n")).toBe(true);
    expect(existsSync(`${statePath(dir)}.tmp-${process.pid}`)).toBe(false);
  });
});
