When working on this project, follow the OpenSpec spec-driven development workflow.

A change is the unit of work: `openspec/changes/<name>/` holds its proposal, specs, design and tasks.

## 1. Plan

Create the change and its planning artifacts (`/opsx:propose`, or `openspec new change "<name>"` — never scaffold the directory by hand). The proposal says why, the specs say what, the design records decisions, tasks.md is the ordered checklist.

## 2. Implement

Ask: "Apply the OpenSpec change <name>" (`/opsx:apply <name>`). Work through tasks.md in order; mark a task `[x]` only when its behavior is fully implemented and its own Verify line passed. The project's Definition of Done (CLAUDE.md) applies to every task.

## 3. Archive

When every task is done and verified, `/opsx:archive <name>` merges the change's specs into `openspec/specs/` — the source of truth.
