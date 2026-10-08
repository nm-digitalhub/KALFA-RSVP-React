export type PackageCopyField = 'description' | 'includes';

export type PackageCopyResult =
  | { ok: true; text: string }
  | { ok: false; error: string };
