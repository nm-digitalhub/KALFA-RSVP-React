'use client';

import { FileText } from 'lucide-react';

import {
  Sheet,
  SheetTrigger,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';

// Shows the FULL agreement in a slide-in panel so the signing page stays light.
// The HTML is server-generated (the exact body that gets signed) and trusted;
// it's styled by the global .agreement-doc CSS injected on the page.
export function AgreementSheet({ html }: { html: string }) {
  return (
    <Sheet>
      <SheetTrigger
        render={<Button variant="outline" className="w-full justify-center gap-2" />}
      >
        <FileText className="size-4" aria-hidden />
        קריאת ההסכם המלא
      </SheetTrigger>
      <SheetContent side="right" className="w-full p-0 sm:max-w-2xl">
        <SheetHeader className="border-b border-border">
          <SheetTitle>הסכם אישור קמפיין ושירות</SheetTitle>
        </SheetHeader>
        <div
          className="agreement-doc flex-1 overflow-y-auto px-5 pb-8 pt-2"
          dangerouslySetInnerHTML={{ __html: html }}
        />
      </SheetContent>
    </Sheet>
  );
}
