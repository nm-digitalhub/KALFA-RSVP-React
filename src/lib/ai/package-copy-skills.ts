import 'server-only';

import path from 'node:path';
import { nodeExec } from '@/lib/owner-agent/runner';

// Sources and task instructions are selected on the server, never supplied by the browser.
const HEBREW_WRITER = {
  source: 'https://github.com/skills-il/localization/tree/v1.3.0-hebrew-content-writer/hebrew-content-writer',
  skill: 'hebrew-content-writer',
};
// The task is a REWRITE, not a proofread: the model is told what it may change (order, structure, mechanical or translated phrasing,
// the opening) so it does not stop at fixing commas. What it may not change is in the boundaries of package-copy.ts.
const contexts = {
  description: {
    ...HEBREW_WRITER,
    task: 'שכתב את תיאור החבילה כך שיישמע כמו טקסט שיווקי טבעי שנכתב בעברית מלכתחילה, לא כמו תרגום. מותר ורצוי לשנות את סדר המשפטים והמבנה, לפצל או לאחד משפטים, להחליף ניסוחים מכניים או מתורגמים, ולפתוח בתועלת ללקוח. אל תסתפק בהגהה. לכל היותר 2000 תווים.',
  },
  includes: {
    ...HEBREW_WRITER,
    task: 'שכתב כל פריט כך שיהיה קצר, ברור ומוחשי, בעברית טבעית. שמור על מספר הפריטים ועל סדרם, פריט בכל שורה, בלי תבליטים ובלי מספור. לכל היותר 200 תווים לפריט.',
  },
} as const;

// Cache includes the pending promise: simultaneous fields do not download twice.
const cache = new Map<string, Promise<string>>();

async function fetchSkill(
  context: typeof contexts[keyof typeof contexts],
  repoDir: string,
  cliEnv: NodeJS.ProcessEnv,
): Promise<string> {
  const outcome = await nodeExec({
    file: 'npx',
    args: ['--no-install', 'skills', 'use', context.source, '--skill', context.skill],
    cwd: repoDir,
    env: {
      ...cliEnv,
      PATH: `${path.dirname(process.execPath)}:${cliEnv.PATH ?? ''}`,
      CI: '1', DISABLE_TELEMETRY: '1',
    },
    input: '', timeoutMs: 30_000, killAfterMs: 2_000, maxBuffer: 192 * 1024,
  });
  if (!outcome.ok) throw new Error('Skill loading failed');
  // skills use embeds the complete main file, then appends temporary support paths.
  // Take the actual instructions, rather than feeding CLI boilerplate or paths to Claude.
  const match = /<SKILL\.md>\r?\n([\s\S]+?)\r?\n<\/SKILL\.md>/.exec(outcome.stdout);
  const content = match?.[1];
  if (!content || Buffer.byteLength(content, 'utf8') > 48 * 1024
    || !/^name:\s*hebrew-content-writer\s*$/m.test(content)) {
    throw new Error('Unexpected skill instructions');
  }
  return content;
}

export async function getPackageCopySkill(
  field: keyof typeof contexts,
  repoDir: string,
  cliEnv: NodeJS.ProcessEnv,
): Promise<{ instructions: string; task: string }> {
  const context = contexts[field];
  const key = `${repoDir}:${context.source}:${context.skill}`;
  let pending = cache.get(key);
  if (!pending) {
    pending = fetchSkill(context, repoDir, cliEnv).catch((error: unknown) => {
      cache.delete(key);
      throw error;
    });
    cache.set(key, pending);
  }
  return { instructions: await pending, task: context.task };
}
