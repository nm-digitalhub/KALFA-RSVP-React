// Attachments an agent referenced in payload.attachments — files it saved under
// .fleet-logs/drafts/, served through the admin-gated /api/admin/fleet-file
// route (realpath-allowlisted there; a bad/outside path simply 404s). Audio,
// images and video play inline so the owner can check a draft straight from
// the bubble.

type RequestAttachment = { path: string; label?: string; mime?: string };

export function parseAttachments(payload: unknown): RequestAttachment[] {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return [];
  const raw = (payload as { attachments?: unknown }).attachments;
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((item): RequestAttachment[] => {
    if (!item || typeof item !== 'object') return [];
    const { path, label, mime } = item as Record<string, unknown>;
    if (typeof path !== 'string' || !path.trim()) return [];
    return [
      {
        path,
        label: typeof label === 'string' ? label : undefined,
        mime: typeof mime === 'string' ? mime : undefined,
      },
    ];
  });
}

function attachmentKind(att: RequestAttachment): 'audio' | 'image' | 'video' | 'file' {
  const hint = att.mime ?? '';
  if (hint.startsWith('audio/')) return 'audio';
  if (hint.startsWith('image/')) return 'image';
  if (hint.startsWith('video/')) return 'video';
  const ext = att.path.toLowerCase().split('.').pop() ?? '';
  if (['mp3', 'wav', 'm4a', 'ogg'].includes(ext)) return 'audio';
  if (['png', 'jpg', 'jpeg', 'webp', 'gif'].includes(ext)) return 'image';
  if (['mp4', 'webm'].includes(ext)) return 'video';
  return 'file';
}

// Inside a bubble: no full path by default (it is noise for the owner and
// flips direction mid-line); the file name is enough, and the path stays one
// hover away in `title`.
export function AttachmentItem({ att }: { att: RequestAttachment }) {
  const src = `/api/admin/fleet-file?path=${encodeURIComponent(att.path)}`;
  const name = att.label ?? (att.path.split('/').pop() || att.path);
  const kind = attachmentKind(att);
  return (
    <li className="space-y-1.5">
      {kind === 'audio' ? (
        <audio controls preload="none" src={src} className="w-full" aria-label={name} />
      ) : kind === 'image' ? (
        // eslint-disable-next-line @next/next/no-img-element -- authed dynamic stream, not an optimizable static asset
        <img src={src} alt={name} className="max-h-72 max-w-full rounded-md" />
      ) : kind === 'video' ? (
        <video controls preload="none" src={src} className="max-h-72 w-full rounded-md" aria-label={name} />
      ) : null}
      <a
        href={src}
        download={kind === 'file' ? true : undefined}
        title={att.path}
        className="inline-flex max-w-full items-center rounded-4xl border border-border px-2 py-0.5 text-xs text-primary hover:underline"
      >
        <bdi dir="ltr" className="wrap-anywhere">
          {name}
        </bdi>
      </a>
    </li>
  );
}

export function AttachmentList({ payload }: { payload: unknown }) {
  const attachments = parseAttachments(payload);
  if (attachments.length === 0) return null;
  return (
    <ul className="space-y-3" aria-label="קבצים מצורפים">
      {attachments.map((att) => (
        <AttachmentItem key={att.path} att={att} />
      ))}
    </ul>
  );
}
