// Password-strength UI helper. This is feedback ONLY — the server-side Zod
// `min(8)` check in signupSchema remains the real gate. The zxcvbn-ts engine is
// heavy (~50KB), so it is imported DYNAMICALLY (inside loadPasswordScorer) and
// stays out of the initial client bundle; it loads on the first password
// keystroke. Strength labels/colors are UI content (data), not hardcoded policy.

export type PasswordScore = 0 | 1 | 2 | 3 | 4;

export const STRENGTH_LABELS: readonly string[] = [
  'חלשה מאוד',
  'חלשה',
  'בינונית',
  'חזקה',
  'חזקה מאוד',
];

// Tailwind classes are kept as literals so the JIT scanner includes them.
export const STRENGTH_BAR_COLORS: readonly string[] = [
  'bg-red-500',
  'bg-orange-500',
  'bg-yellow-500',
  'bg-green-400',
  'bg-green-600',
];

type Scorer = (password: string) => PasswordScore;

// Created once and reused. The dynamic imports keep zxcvbn-ts off the initial
// bundle (lazy-loaded on first use).
let scorerPromise: Promise<Scorer> | null = null;

export function loadPasswordScorer(): Promise<Scorer> {
  if (!scorerPromise) {
    scorerPromise = (async () => {
      const [{ ZxcvbnFactory }, common] = await Promise.all([
        import('@zxcvbn-ts/core'),
        import('@zxcvbn-ts/language-common'),
      ]);
      const factory = new ZxcvbnFactory({
        dictionary: { ...common.dictionary },
        graphs: common.adjacencyGraphs,
      });
      return (password: string): PasswordScore =>
        factory.check(password).score as PasswordScore;
    })();
  }
  return scorerPromise;
}
