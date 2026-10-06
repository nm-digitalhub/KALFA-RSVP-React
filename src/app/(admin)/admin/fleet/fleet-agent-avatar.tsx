import { UserRound } from 'lucide-react';

import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { getFleetAgentAvatarSrc } from '@/lib/fleet/agent-avatars';
import type { ContentAuthor } from '@/lib/fleet/content-author';
import { getInitials } from '@/lib/utils';

// `sm` sits next to a message bubble, `default` in the conversation list and header.
type AvatarSize = 'sm' | 'default';

// The agent's own image (explicit map in lib/fleet/agent-avatars — never a
// path built from the role), or its initials when the role has none yet.
export function FleetAgentAvatar({ role, size = 'default' }: { role: string; size?: AvatarSize }) {
  const src = getFleetAgentAvatarSrc(role);
  const initials = getInitials(role.replace(/-/g, ' '));
  return (
    <Avatar size={size} role="img" aria-label={`הסוכן ${role}`}>
      {src ? <AvatarImage src={src} alt="" /> : null}
      <AvatarFallback aria-hidden>{initials}</AvatarFallback>
    </Avatar>
  );
}

// The owner's side: same initials treatment as the signed-in user's avatar in
// the admin shell (admin-shell.tsx). `name` is the answerer's profile name
// when known; an owner-opened request carries no author id, so it falls back
// to a generic person icon.
export function FleetOwnerAvatar({ name, size = 'default' }: { name?: string | null; size?: AvatarSize }) {
  const label = name?.trim() ? `הבעלים — ${name.trim()}` : 'הבעלים';
  return (
    <Avatar size={size} role="img" aria-label={label}>
      <AvatarFallback aria-hidden className="bg-primary text-xs font-bold text-primary-foreground">
        {name?.trim() ? getInitials(name) : <UserRound className="size-4" />}
      </AvatarFallback>
    </Avatar>
  );
}

// Picks the right avatar for a piece of content by who WROTE it — not by the
// row's role, which only says whose conversation it is.
export function FleetAuthorAvatar({
  author,
  role,
  ownerName,
  size = 'default',
}: {
  author: ContentAuthor;
  role: string;
  ownerName?: string | null;
  size?: AvatarSize;
}) {
  return author === 'agent' ? (
    <FleetAgentAvatar role={role} size={size} />
  ) : (
    <FleetOwnerAvatar name={ownerName} size={size} />
  );
}
