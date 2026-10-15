// Shared by the deploy steps that ask pm2 what is running (worker-build-restart.mjs,
// owner-agent-build-restart.mjs).
//
// Why this exists: when the pm2 CLI and the in-memory daemon are different versions,
// the CLI prints ">>>> In-memory PM2 is out-of-date, do: $ pm2 update" to STDOUT —
// before the JSON (lib/binaries/CLI.js, pm2 7.0.4). `JSON.parse(stdout)` then throws
// at exactly the moment something needs attention, and both scripts read the throw as
// "pm2 is not answering" (15.10.2026: a needless worker restart, and an owner-agent
// step that gave up). The root cause (two installs, v6 daemon vs v7 CLI) was removed
// the same day; this keeps a recurrence from being misread, and still says so out loud.

/**
 * Parse the stdout of `pm2 jlist`.
 *
 * Returns `{ list, notice }`: `list` is the process array, `notice` is whatever pm2
 * printed before it (empty when nothing). Returns `null` when no JSON array is present
 * at all — that is a real failure and the caller keeps treating it as one.
 */
export function parseJlist(stdout) {
  if (typeof stdout !== 'string') return null;
  const lines = stdout.split('\n');
  // Walk from the last line backwards: jlist writes the JSON last, so the first
  // candidate that starts with `[` and parses is the process list; everything above
  // it is pm2's own text.
  for (let i = lines.length - 1; i >= 0; i--) {
    if (!lines[i].trimStart().startsWith('[')) continue;
    const candidate = lines.slice(i).join('\n');
    let list;
    try {
      list = JSON.parse(candidate);
    } catch {
      continue;
    }
    if (!Array.isArray(list)) continue;
    return { list, notice: lines.slice(0, i).join('\n').replace(/\x1b\[[0-9;]*m/g, '').trim() };
  }
  return null;
}

/** One loud line for a non-empty notice, so a version mismatch is reported, not hidden. */
export function warnOnNotice(scriptName, notice) {
  if (!notice) return;
  console.warn(
    `${scriptName}: pm2 printed text before its JSON — usually a CLI/daemon version mismatch ` +
      `(run \`pm2 update\` and check \`type -a pm2\`). First line: ${notice.split('\n').find((l) => l.trim()) ?? ''}`,
  );
}
