# Proposal

## Why
Platform permission failures currently send authenticated users to `/app` without explaining the denial. Provide a clear recovery page without changing authorization policy.

## What Changes
- Add an authenticated Hebrew RTL access-denied page outside the admin layout.
- Redirect only the three platform DAL guards to it; preserve anonymous login redirects.
- Audit Server Action catches and API consumers so navigation signals propagate in actions and API failures remain HTTP errors.
- Cover denial, allowed access, and anonymous access in regression tests.

## Capabilities
### New Capabilities
- `platform-access-denial`: Explain platform access failures and preserve appropriate browser/API behavior.
### Modified Capabilities
None.

## Impact
Auth DAL, new page, affected action/API consumers and focused tests. No database or permission-policy changes, dependency additions, deployment, or experimental Next.js flags.
