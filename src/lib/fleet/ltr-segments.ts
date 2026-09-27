// Splits agent/owner text into plain runs and left-to-right tokens (inline
// `code`, URLs, file paths, file names) so the bubble can isolate each token
// in <bdi dir="ltr">/<code dir="ltr">.
//
// Why not dir="auto" on the whole body: a message that starts with "PR #12"
// would lay the entire Hebrew paragraph out LTR. Isolating only the tokens
// keeps the paragraph RTL and stops paths like "plans/x.md" from flipping into
// "x.md/plans" mid-line (plan L6, D3).

export type LtrSegment = { type: 'text' | 'ltr' | 'code'; value: string };

const FILE_EXT =
  'md|mdx|tsx?|jsx?|mjs|cjs|json|sql|sh|ya?ml|png|jpe?g|webp|gif|svg|mp3|mp4|wav|m4a|ogg|webm|csv|pdf|html|css|txt|log|ndjson';

const LTR_TOKEN = new RegExp(
  [
    '`([^`\\n]+)`', // inline code
    'https?:\\/\\/[^\\s<>()]+', // URL
    '[A-Za-z0-9_@.~-]*(?:\\/[A-Za-z0-9_@.~-]+)+\\/?', // path with a slash (Latin segments only)
    `\\b[A-Za-z0-9_-]+(?:\\.[A-Za-z0-9_-]+)*\\.(?:${FILE_EXT})\\b`, // bare file name
  ].join('|'),
  'g',
);

export function ltrSegments(text: string): LtrSegment[] {
  const out: LtrSegment[] = [];
  let last = 0;
  for (const m of text.matchAll(LTR_TOKEN)) {
    const at = m.index ?? 0;
    if (at > last) out.push({ type: 'text', value: text.slice(last, at) });
    if (m[1] !== undefined) out.push({ type: 'code', value: m[1] });
    else out.push({ type: 'ltr', value: m[0] });
    last = at + m[0].length;
  }
  if (last < text.length) out.push({ type: 'text', value: text.slice(last) });
  return out;
}
