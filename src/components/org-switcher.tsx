'use client';

import { Building2, Check, ChevronDown } from 'lucide-react';

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Button } from '@/components/ui/button';
import { setActiveOrgAction } from '@/app/(customer)/app/team/actions';

export type OrgOption = { id: string; name: string };

// Active-organization switcher for the app shell. A single org renders as a
// static label; multiple orgs render a dropdown whose items submit the active
// org (verified server-side in setActiveOrgAction before the cookie is set).
export function OrgSwitcher({
  orgs,
  activeOrgId,
}: {
  orgs: OrgOption[];
  activeOrgId: string | null;
}) {
  if (orgs.length === 0) {
    return null;
  }
  const active = orgs.find((o) => o.id === activeOrgId) ?? orgs[0];

  if (orgs.length === 1) {
    return (
      <span className="hidden items-center gap-1.5 text-sm text-muted-foreground sm:inline-flex">
        <Building2 className="size-4" aria-hidden />
        {active.name}
      </span>
    );
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button variant="ghost" className="h-9 gap-2 px-2">
            <Building2 className="size-4" aria-hidden />
            <span className="hidden max-w-32 truncate text-sm sm:inline">
              {active.name}
            </span>
            <ChevronDown className="size-4 text-muted-foreground" />
          </Button>
        }
      />
      <DropdownMenuContent align="start" className="w-56">
        <DropdownMenuGroup>
          <DropdownMenuLabel>הארגונים שלי</DropdownMenuLabel>
          <DropdownMenuSeparator />
          {orgs.map((o) => (
            <form key={o.id} action={setActiveOrgAction}>
              <input type="hidden" name="org_id" value={o.id} />
              <DropdownMenuItem
                render={
                  <button
                    type="submit"
                    className="flex w-full items-center justify-between"
                    onClick={(event) => event.currentTarget.form?.requestSubmit()}
                  >
                    <span className="truncate">{o.name}</span>
                    {o.id === active.id ? <Check className="size-4" /> : null}
                  </button>
                }
              />
            </form>
          ))}
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
