# Architecture review

## Goal

Make Context Tree easy to contribute to by keeping responsibilities small and explicit.

Current implementation works, but several responsibilities still live together in large files. Before the project grows, split the code into focused modules.

## Current state

```text
src/context-schema.ts   schema and inferred TS types
src/context-tree.ts     scan, match, normalize, extraction, URL cache, bundle rendering
src/permissions.ts      scope guard decision logic
src/index.ts            Pi extension hooks, commands, TUI state, session command
```

This is acceptable for MVP, but `context-tree.ts` and `index.ts` are too broad for long-term maintenance.

## Target architecture

```text
src/schema.ts
  Zod schema, operation enum, public config types.

src/scan.ts
  Find all CONTEXT.json files, scan parent contexts for one target, report invalid configs.

src/match.ts
  Operation matching, glob matching, contextId calculation.

src/normalize.ts
  Normalize inject shorthand to typed sources, apply defaults cascade, dedupe source keys.

src/extract.ts
  Markdown sections, line ranges, markers, annotated segments.

src/cache.ts
  URL cache keying, TTL, stale fallback, metadata read/write.

src/bundle.ts
  Load sources, apply self-read skip, build bundle hash, render bundle markdown.

src/permissions.ts
  Pure scope guard decision engine.

src/tui.ts
  TUI state, compact/verbose widget rendering, status rendering.

src/sessions.ts
  /context-tree new helpers, custom session entries/messages.

src/subagents.ts
  Resolve subagent_spawn context and interop with pi-subagents.

src/commands.ts
  Slash command parsing and handlers.

src/hooks.ts
  Pi event hooks: before_agent_start, tool_call, tool_result, turn_start.

src/index.ts
  Extension composition only: register hooks and commands.
```

## Refactor phases

### Phase 1 — Pure core split

Move pure functions without behavior change:

- `scanAllContextTree`, `scanContextParents` → `scan.ts`
- `operationMatches`, `matchGlobs`, `contextId` → `match.ts`
- inject normalization/dedupe → `normalize.ts`
- extraction functions → `extract.ts`
- URL cache → `cache.ts`
- `buildBundle`, `renderBundle`, `formatExplain` → `bundle.ts`

Keep compatibility exports from `context-tree.ts` during transition.

### Phase 2 — Pi integration split

Move side-effectful code:

- TUI state/rendering → `tui.ts`
- command handlers → `commands.ts`
- hook handlers → `hooks.ts`
- session creation → `sessions.ts`

`index.ts` should become short.

### Phase 3 — Integration modules

Add optional integration boundaries:

- `subagents.ts` for `pi-subagents`;
- `guardrails.ts` for `pi-guardrails`;
- `config-maintenance.ts` for future agentic config edits/history.

## Public API boundaries

Stable-ish core exports should be pure and testable:

```ts
scanAllContextTree(cwd)
scanContextParents(cwd, target)
explainPath(cwd, scopes, target, operation)
buildBundle(cwd, explain, options)
renderBundle(bundle)
decideScopeAccess(input)
```

Pi-specific functions should not leak into core modules.

## Test strategy after split

Mirror modules in tests:

```text
test/schema.test.ts
test/scan.test.ts
test/match.test.ts
test/normalize.test.ts
test/extract.test.ts
test/cache.test.ts
test/bundle.test.ts
test/permissions.test.ts
test/tui.test.ts
test/commands.test.ts
test/hooks.test.ts
```

Use fixtures for parent/child context resolution.

No live network in tests; URL fetch must stay injectable.

## Current implementation gaps vs plan

Implemented:

- simplified schema;
- implicit scope;
- match/operations;
- file/url inject;
- URL cache TTL/stale;
- extraction sections/lines/markers/segments;
- bundle hash/render;
- read injection;
- edit/write preflight;
- scoped session creation;
- basic scope guard fallback;
- structured TUI compact/verbose;
- tests for core behavior.

Partial or planned:

- defaults cascade is currently basic, not deeply modeled/tested across all fields;
- token budget is represented but not fully enforced;
- `context` hook is not used yet;
- scope-aware compact/tree summaries are not implemented;
- subagent runner interop is still a stub;
- guardrails interop is not implemented;
- agentic config maintenance/history/rollback is not implemented;
- explain output does not yet show final/skipped/deduped source details.

## Release guidance

For a first public release, prefer transparency:

- call the release `0.1.0`;
- describe current MVP clearly;
- mark subagents/guardrails/config-maintenance as planned;
- keep architecture-review doc visible to contributors.
