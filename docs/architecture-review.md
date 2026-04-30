# Architecture review

## Goal

Make Context Tree easy to contribute to by keeping responsibilities small and explicit.

Current implementation works, but several responsibilities still live together in large files. Before the project grows, split the code into focused modules.

## Current state

```text
src/context-schema.ts   explicit schema compatibility exports
src/context-tree.ts     explicit public API compatibility exports
src/public-api.ts       curated public API surface
src/runtime/            Pi extension lifecycle and tool hooks
src/commands/           slash command registration and handlers
src/bundle/             explain/build/render/stability bundle modules
src/tui/                TUI state summaries, widgets, detail panel, formatting
src/init/               init wizard phase machine, prompts, submit/review flow
src/permissions.ts      scope guard decision logic
```

The large legacy entrypoints have been split. `context-tree.ts` is now a compatibility facade over the curated `public-api.ts` surface rather than a broad export of internals.

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
  Compatibility facade for public bundle exports.

src/bundle/
  Explain hooks, load sources, apply self-read skip, build bundle hash, render bundle markdown.

src/permissions.ts
  Pure scope guard decision engine.

src/tui.ts
  Compatibility facade for public TUI exports.

src/tui/
  TUI state, compact widget rendering, status rendering, on-demand detail text.

src/subagents.ts
  Resolve subagent:spawn context and interop with pi-subagents.

src/commands/register.ts
  Slash command composition only.

src/commands/*-commands.ts
  Slash command handlers grouped by status, explain, cache, upgrade, init, and subagent concerns.

src/runtime/lifecycle.ts
  Pi lifecycle hooks: session_start, before_agent_start, turn_start.

src/runtime/tool-hooks.ts
  Pi tool hooks: tool_call, tool_result.

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

Keep `context-tree.ts` as a curated compatibility facade over `public-api.ts` during transition.

### Phase 2 — Pi integration split

Move side-effectful code:

- TUI state/rendering → `tui.ts`
- command handlers → grouped `commands/*-commands.ts` modules
- hook handlers → `runtime/lifecycle.ts` and `runtime/tool-hooks.ts`

`index.ts` should become short.

### Phase 3 — Integration modules

Add optional integration boundaries:

- `subagents.ts` for `pi-subagents`;
- `guardrails.ts` for `pi-guardrails`;
- `config-maintenance.ts` for future agentic config edits/history.

## Public API boundaries

Stable-ish core exports should be pure and testable:

```ts
scanAllContextTree(cwd);
scanContextParents(cwd, target);
explainPath(cwd, scopes, target, operation);
buildBundle(cwd, explain, options);
renderBundle(bundle);
decideScopeAccess(input);
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
- user-global config loading via `~/.pi/CONTEXT.json` / `PI_CONTEXT_TREE_GLOBAL`;
- basic scope guard fallback;
- structured compact TUI with on-demand details;
- tests for core behavior.

Partial or planned:

- `session:spawn` remains a schema hook for future config-driven session workflows; the old `/ct-new` command has been removed;
- defaults cascade is currently basic, not deeply modeled/tested across all fields;
- token budget is represented but not fully enforced;
- `context` hook is not used yet;
- scope-aware compact/tree summaries are not implemented;
- subagent runner interop is still a stub;
- guardrails interop is not implemented;
- agentic config maintenance/history/rollback is not implemented;
- explain output does not yet show final/skipped/deduped source details.

## Release guidance

For public releases, prefer transparency:

- describe current runtime and command surface exactly;
- mark subagents/guardrails/config-maintenance as planned;
- keep architecture-review doc visible to contributors.
