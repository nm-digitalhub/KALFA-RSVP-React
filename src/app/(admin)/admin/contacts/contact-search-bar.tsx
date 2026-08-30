'use client';

import Link from 'next/link';

import { Button } from '@/components/ui/button';
import { ButtonGroup } from '@/components/ui/button-group';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { ListFilterIcon, ChevronDownIcon, XIcon, SearchIcon } from 'lucide-react';
import { CONTACT_STATUSES } from '@/lib/validation/admin';
import { contactStatusLabel } from '@/lib/data/admin/labels';

// Search + status filter for the contacts inbox — a GET form (works without
// JS: Enter submits it natively) wrapping a shadcn/reui ButtonGroup
// (filter dropdown + search input + clear). Every menu item and the clear
// button are plain links, not client-side navigation — this component is
// 'use client' only because the dropdown menu itself needs to portal.
//
// The dropdown offers two coarse shortcuts ('open'/'closed', expanded
// server-side in listContactMessages) ABOVE the real per-status values, so an
// admin can jump to "everything still needing attention" without hunting
// through five exact statuses.
const STATUS_GROUPS = [
  { value: 'open', label: 'פתוחות' },
  { value: 'closed', label: 'סגורות' },
] as const;

const STATUS_VALUES = [...CONTACT_STATUSES, 'reopened'] as const;

function buildHref(basePath: string, params: Record<string, string | undefined>): string {
  const qs = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value) qs.set(key, value);
  }
  const s = qs.toString();
  return s ? `${basePath}?${s}` : basePath;
}

export function ContactSearchBar({
  basePath,
  search,
  status,
}: {
  basePath: string;
  search?: string;
  status?: string;
}) {
  const activeLabel =
    STATUS_GROUPS.find((g) => g.value === status)?.label ??
    (status ? contactStatusLabel(status) : 'כל הפניות');

  return (
    <form method="get" action={basePath} className="flex flex-col gap-1">
      {status ? <input type="hidden" name="status" value={status} /> : null}
      <ButtonGroup className="w-full max-w-lg">
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              // Button's default size is h-10 below the md breakpoint (only
              // md:h-8 matches Input's height) — pinned to h-8 explicitly so
              // the trigger and the input line up at every width, not just
              // desktop.
              <Button type="button" variant="outline" className="h-8">
                <ListFilterIcon aria-hidden="true" />
                {activeLabel}
                <ChevronDownIcon aria-hidden="true" />
              </Button>
            }
          />
          <DropdownMenuContent align="start" className="w-48">
            <DropdownMenuItem
              render={<Link href={buildHref(basePath, { q: search })}>כל הפניות</Link>}
            />
            {STATUS_GROUPS.map((g) => (
              <DropdownMenuItem
                key={g.value}
                render={
                  <Link href={buildHref(basePath, { q: search, status: g.value })}>
                    {g.label}
                  </Link>
                }
              />
            ))}
            {STATUS_VALUES.map((s) => (
              <DropdownMenuItem
                key={s}
                render={
                  <Link href={buildHref(basePath, { q: search, status: s })}>
                    {contactStatusLabel(s)}
                  </Link>
                }
              />
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
        <Input
          name="q"
          type="search"
          defaultValue={search ?? ''}
          placeholder="חיפוש לפי שם, אימייל, טלפון או נושא…"
          // No dir="auto": on an EMPTY input some browsers don't consult the
          // placeholder for the auto-direction heuristic and fall back to LTR,
          // which right-aligns the dropdown button but left-aligns the (Hebrew)
          // placeholder text inside the same wide box — reading as a big gap
          // between them. The page is already dir="rtl"; Unicode bidi already
          // renders an English/mixed search term typed into it correctly
          // without needing the input's own base direction to flip.
        />
        {search ? (
          <Button
            type="button"
            variant="outline"
            size="icon"
            aria-label="ניקוי חיפוש"
            render={<Link href={buildHref(basePath, { status })} />}
          >
            <XIcon aria-hidden="true" />
          </Button>
        ) : (
          <Button type="submit" variant="outline" size="icon" aria-label="חיפוש">
            <SearchIcon aria-hidden="true" />
          </Button>
        )}
      </ButtonGroup>
    </form>
  );
}
