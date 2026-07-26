import { realpath, stat, readFile } from 'node:fs/promises';
import path from 'node:path';

import { requirePlatformPermission } from '@/lib/auth/dal';

// Admin-only streaming of fleet-request ATTACHMENTS (files agents saved under
// .fleet-logs/drafts/ and referenced from fleet_requests.payload.attachments).
// Lets the owner ear-check audio / view images directly from /admin/fleet on
// any device, instead of shelling into the server.
//
// Security model (defense in depth):
// - requirePlatformPermission('manage_settings') — the same gate as the fleet
//   DAL. A failed gate (NEXT_REDIRECT) is converted to a plain 403 so an
//   <audio>/<img> fetch fails cleanly instead of following an HTML redirect.
// - The ONLY servable tree is <repo>/.fleet-logs/drafts. The query path must be
//   relative, is resolved with realpath (symlink-escape safe), and must remain
//   inside the realpath'd drafts root. Anything else → generic 404 (no
//   existence/structure leaking).
// - Regular files only, hard size cap, extension→MIME allowlist; unknown types
//   are served as octet-stream downloads, never sniffed.

const MAX_BYTES = 25 * 1024 * 1024; // 25MB — drafts are small media files

const MIME_BY_EXT: Record<string, { type: string; inline: boolean }> = {
  '.mp3': { type: 'audio/mpeg', inline: true },
  '.wav': { type: 'audio/wav', inline: true },
  '.m4a': { type: 'audio/mp4', inline: true },
  '.ogg': { type: 'audio/ogg', inline: true },
  '.png': { type: 'image/png', inline: true },
  '.jpg': { type: 'image/jpeg', inline: true },
  '.jpeg': { type: 'image/jpeg', inline: true },
  '.webp': { type: 'image/webp', inline: true },
  '.gif': { type: 'image/gif', inline: true },
  '.pdf': { type: 'application/pdf', inline: true },
  '.txt': { type: 'text/plain; charset=utf-8', inline: true },
  '.md': { type: 'text/plain; charset=utf-8', inline: true },
  '.json': { type: 'application/json; charset=utf-8', inline: true },
  '.mp4': { type: 'video/mp4', inline: true },
  '.webm': { type: 'video/webm', inline: true },
};

function isNextRedirect(err: unknown): boolean {
  return (
    !!err &&
    typeof err === 'object' &&
    'digest' in err &&
    typeof (err as { digest?: unknown }).digest === 'string' &&
    (err as { digest: string }).digest.startsWith('NEXT_REDIRECT')
  );
}

export async function GET(request: Request): Promise<Response> {
  try {
    await requirePlatformPermission('manage_settings');
  } catch (err) {
    if (isNextRedirect(err)) return new Response('Forbidden', { status: 403 });
    throw err;
  }

  const url = new URL(request.url);
  const rel = url.searchParams.get('path') ?? '';

  // Relative, non-empty, no NUL, no absolute/backslash forms. Traversal via
  // ".." is neutralized by the realpath prefix check below, but reject the
  // obvious junk early.
  if (!rel || rel.includes('\0') || path.isAbsolute(rel) || rel.includes('\\')) {
    return new Response('Bad request', { status: 400 });
  }

  const draftsRoot = await realpath(path.join(process.cwd(), '.fleet-logs', 'drafts'));

  let resolved: string;
  try {
    resolved = await realpath(path.resolve(process.cwd(), rel));
  } catch {
    return new Response('Not found', { status: 404 }); // does not exist — generic
  }

  // The resolved real path must live INSIDE the drafts root (symlink-safe).
  if (resolved !== draftsRoot && !resolved.startsWith(draftsRoot + path.sep)) {
    return new Response('Not found', { status: 404 }); // outside allowlist — generic
  }

  const info = await stat(resolved);
  if (!info.isFile()) return new Response('Not found', { status: 404 });
  if (info.size > MAX_BYTES) return new Response('File too large', { status: 413 });

  const ext = path.extname(resolved).toLowerCase();
  const mime = MIME_BY_EXT[ext] ?? { type: 'application/octet-stream', inline: false };
  const filename = path.basename(resolved);

  const bytes = await readFile(resolved);
  return new Response(new Uint8Array(bytes), {
    status: 200,
    headers: {
      'Content-Type': mime.type,
      'Content-Length': String(info.size),
      // RFC 5987 filename* so Hebrew/unicode names survive; inline for media.
      'Content-Disposition': `${mime.inline ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(filename)}`,
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}
