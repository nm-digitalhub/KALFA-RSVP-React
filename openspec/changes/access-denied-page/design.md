# Design

## Context
See proposal.md. The three platform guards currently redirect to `/app`. Root layout permits a sibling `(access)` route group; logout already accepts POST. Installed Next.js docs confirm redirect throws and `unstable_rethrow` preserves framework signals.

## Goals / Non-Goals
Goals: preserve DAL authorization, explain denials and keep API transport usable.
Non-goals: changing roles, RLS, legacy requireAdmin, organization guards, deployment or authInterrupts.

## Decisions
- Use the supplied server page and design tokens, with requireUser only, to avoid a denial loop through the admin layout.
- Change only the three requested guard destinations. Use redirect rather than experimental forbidden.
- Replace handwritten action control-flow checks with unstable_rethrow; repair catches that swallow DAL redirects.
- At affected API boundaries convert known auth redirects to JSON 401/403, retaining DAL checks and rethrowing unrelated errors. Existing plain 403 handlers already meet the API requirement.

## Risks / Trade-offs
- A swallowed redirect can become a misleading action error: audit catches and add focused regression coverage.
- API consumers can reach guards indirectly through data modules: audit workflow polling and RDP issuance as well as direct imports.
- Live account verification needs an available authenticated browser session; never fabricate or modify Yaakov's credentials or grants.

## Migration Plan
No database migration. Verify focused tests, typecheck, lint and isolated build before a separately authorized deployment. Rollback is reverting scoped source changes.
