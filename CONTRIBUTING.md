# Contributing to pi-context-tree

Thanks for helping improve Context Tree.

## Philosophy

Context Tree is not prompt engineering. It is deterministic context engineering for code agents.

Core belief:

```text
Do not ask agents to rediscover project context.
Declare which context applies where.
```

A codebase should be able to describe:

- which context applies to each path;
- which operations need that context;
- which files, URLs, sections, or markers should be injected;
- what should happen before reads, edits, writes, sessions, and subagents.

The result should be auditable, testable, and understandable by humans.

## Design principles

- Keep `CONTEXT.json` simple and declarative.
- Scope comes from the file location, not from a `scope` field.
- Prefer small, path-scoped context over global prompt blobs.
- Do not inject `AGENTS.md`; Pi already loads it.
- Avoid self-read duplication.
- Keep resolver logic testable without Pi.
- Add tests for every schema or matching behavior change.
- Prefer small files with one responsibility.

## Areas to improve

### Schema and validation

- Better error messages.
- More schema examples.
- Optional stricter policies for enterprise repos.

### Matching and resolution

- More explicit final/skipped/deduped source reporting.
- Better operation-specific matching for grep/find/bash.
- Better path parsing for shell commands.

### Source extraction

- AST symbol extraction.
- Richer marker formats.
- Token-aware extraction.
- Better markdown section edge cases.

### URL cache

- ETag / Last-Modified support.
- Manual pinning and lockfiles.
- Better cache inspection commands.

### Pi integration

- Richer TUI component.
- Better message rendering for context bundles.
- Scope-aware compaction/tree summaries.
- Agentic tools for config maintenance.

### Integrations

- `pi-subagents` interop for `subagent_spawn`.
- `pi-guardrails` interop for permission policies.

## Development setup

```bash
pnpm install
pnpm validate
```

`pnpm validate` runs:

```text
pnpm typecheck
pnpm schema:generate
pnpm test
```

## Local Pi testing

One-off run:

```bash
pnpm pi:dev
```

Project-local install:

```bash
pnpm pi:install:local
pnpm pi:local
```

Then in Pi:

```text
/reload
/ct-validate
/ct-tui on
```

## Testing expectations

Use Node's built-in test runner with `tsx`.

Add tests for:

- schema validation;
- matching and exclusions;
- operation filtering;
- context ID stability;
- source normalization;
- extraction;
- bundle hashes;
- cache behavior with mocked fetch;
- permissions/scope guard decisions.

Do not rely on live network in tests.

## Architecture expectations

Keep files granular. If a file grows too many responsibilities, split it.

Preferred direction:

```text
src/schema.ts          schema + types
src/scan.ts            CONTEXT.json discovery
src/match.ts           glob/operation matching
src/normalize.ts       inject/default normalization
src/extract.ts         section/line/marker extraction
src/cache.ts           URL cache
src/bundle.ts          bundle build/render/hash
src/permissions.ts     scope guard decisions
src/tui.ts             status/widget rendering
src/sessions.ts        scoped session command helpers
src/subagents.ts       pi-subagents interop
src/commands.ts        slash command handlers
src/hooks.ts           Pi event hooks
src/index.ts           extension composition only
```

Current code is not fully split yet; see `docs/architecture-review.md`.

## Pull request checklist

- [ ] `pnpm validate` passes.
- [ ] New behavior has tests.
- [ ] README/AGENTS/docs updated if user-facing behavior changes.
- [ ] No generated cache files committed.
- [ ] No `.pi/settings.json` committed.
- [ ] Public API/schema changes are described.
