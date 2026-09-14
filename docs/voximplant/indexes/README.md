# Voximplant documentation indexes

Three `llms.txt` files, fetched 2026-09-15. Each line is a page title, a URL
already ending in `.md`, and a one-line description.

| file | scope | links |
|---|---|---|
| `llms.txt` | everything | 465 |
| `api-reference-llms.txt` | API reference only | 347 |
| `voxengine-llms.txt` | the VoxEngine section | 25 |

## How to use them

Find the page in an index, then fetch that one URL:

```bash
curl -fsSL https://docs.voximplant.ai/platform/voxengine/secrets.md
```

Every docs page serves clean Markdown when you append `.md`. The site says so
itself, at the top of `llms.txt`:

> For clean Markdown of any page, append `.md` to the page URL

## ⚠️ Why the pages themselves are NOT committed here

All 462 were downloaded during the 2026-09-15 research and deliberately left
out of the repo. The vendor's own guidance, from the README of
`github.com/voximplant/ai-agent-skills`:

> **Do not paste large documentation dumps into prompts by default. Prefer
> narrow page-level Markdown fetches.**

The full corpus is 5.0 MB — 3.6 MB of it API reference. Committing it would
create a second copy of someone else's documentation that goes stale silently
and invites exactly the dump-it-all habit that line warns against. An index is
110 KB and points at content that is always current.

Re-download the whole set if you ever need it offline:

```bash
grep -oE 'https://docs\.voximplant\.ai/[^)]+\.md' llms.txt | sort -u \
  | xargs -P 10 -I{} sh -c 'rel="${1#https://docs.voximplant.ai/}";
      mkdir -p "$(dirname "$rel")"; curl -fsSL "$1" -o "$rel"' _ {}
```

## ⚠️ Two vendor surfaces are stale — the indexes are not

Both the CI guide page and the in-panel quickstart still document the pre-36
scenario path (`voxfiles/scenarios/src/`). voxengine-ci 36.0.0 moved sources to
`voxfiles/applications/<application-name>/scenarios/src/` on 2026-09-14, and the
36.0.0 package README is the only vendor source that says so. Read a page from
these indexes for API surface; check the package README for layout.

## Not a substitute for the type declarations

`typings/voxengine.d.ts` (from `cdn.voximplant.com/voxengine_typings/`) is the
signature oracle — method names, event payload fields, enum spelling. Docs are
for architecture and recommended flows. Voximplant's own skill package puts it
the same way: the declaration file is "best downloaded locally and used for
validation rather than loaded as a general README source".
