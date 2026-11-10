// Content blocks the marketing pages repeat with different copy (the event-type
// pages, /whatsapp, /guest-list-template). Markup only: each page passes its own
// already-translated items, so its t() keys stay in the page.

// A two-column grid of title + description cards, revealed as a group on scroll.
export function SiteCardGrid({ items }: { items: readonly { title: string; d: string }[] }) {
  return (
    <div className="k-reveal-group mt-10 grid gap-4 sm:grid-cols-2">
      {items.map(({ title, d }) => (
        <div key={title} className="k-card rounded-xl border border-border bg-background p-6 hover:shadow-md">
          <h3 className="text-lg font-bold">{title}</h3>
          <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">{d}</p>
        </div>
      ))}
    </div>
  );
}

// Questions and answers, expanded — never behind an accordion: these are public
// pages meant to be extractable by search and AI answer engines, the same
// reasoning as /faq.
export function SiteFaqList({ items }: { items: readonly { q: string; a: string }[] }) {
  return (
    <div className="k-reveal-group mt-8 space-y-8">
      {items.map((f) => (
        <div key={f.q} className="border-b border-border pb-6 last:border-b-0 last:pb-0">
          <h3 className="text-lg font-bold">{f.q}</h3>
          <p className="mt-2 max-w-prose text-base leading-relaxed text-muted-foreground">
            {f.a}
          </p>
        </div>
      ))}
    </div>
  );
}
