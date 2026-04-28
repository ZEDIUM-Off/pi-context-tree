# AGENTS.md

## Project

`pi-context-tree` is a Pi extension for deterministic, path-scoped contextualization.

Goal: move routing/context-loading responsibility out of LLM prose and into machine-readable `CONTEXT.json` files. Agents receive mode-selected folder context automatically when they read, edit, write, or start work on files under matching scopes.

## Core idea

```text
hook + optional target path
→ parent/all CONTEXT.json files
→ matching hooks[] entries
→ mode-specific inline excerpts or references
→ context bundle
→ Pi injection point
```

`CONTEXT.json` is the machine contract. There is no special `CONTEXT.md` convention anymore; markdown files are normal inject sources referenced from JSON.

## Current schema direction

Scope is implicit:

```text
dirname(CONTEXT.json)
```

A config uses:

```json
{
  "$schema": "./schemas/context.schema.json",
  "hooks": [
    {
      "on": "tool:read",
      "match": ["**/*.ts", "!**/*.test.ts"],
      "inject": ["./docs/rules.md"]
    },
    {
      "on": "agent:start",
      "inject": ["./docs/startup.md"]
    }
  ]
}
```

Rules:

- `hooks[]` is the primary routing array.
- Path-aware hooks require `match[]`; pathless hooks (`session:start`, `agent:start`) must not define it.
- `match[]` uses glob patterns, with `!` for exclusions.
- `inject[]` accepts shorthand strings or typed objects.
- Paths are resolved relative to the owning `CONTEXT.json`.
- URLs are cached under `.pi/context-tree/cache/urls`.
- `mode` controls all source injection behavior: `inline`, `ref`, `lines`, `sections`, `markers`, `segments`.

## Hooks

Supported hooks:

```text
session:start
agent:start
tool:read
tool:edit
tool:write
tool:grep
tool:find
tool:ls
tool:bash
session:spawn
subagent:spawn
```

Behavior implemented:

- `session:start`: pathless startup references from all scopes, injected on first agent turn.
- `agent:start`: pathless hook selected by scope when prompt references paths such as `@src/index.ts`.
- `tool:read`: appends context bundle to read tool results.
- `tool:edit` / `tool:write`: preflight injects context once, blocks initial mutation, then allows retry.
- `session:spawn`: used by `/ct-new <path> [prompt]`.
- `subagent:spawn`: schema/config concept; runner interop still planned.

## Design principles

- Keep routing machine-readable and validated.
- Keep context minimal and path-scoped.
- Prefer canonical sources over duplicated rules.
- Do not inject `AGENTS.md` from `CONTEXT.json`; Pi already loads it.
- Do not inject README on every read/edit; keep broad orientation for startup/session only.
- Avoid self-read duplication: when reading a file, do not inject that same file as context.
- Default to explainable behavior before automation-heavy behavior.
- Core resolver logic must remain testable without Pi.

## Repository conventions

- Source lives in `src/`.
- Tests live in `test/` and use Node's built-in test runner with `tsx`.
- Generated JSON schema lives in `schemas/context.schema.json`.
- Pi package manifest lives in `package.json` under `pi.extensions`.
- Use TypeScript strict mode.
- Use Pi extension APIs from `@mariozechner/pi-coding-agent`.
- Prefer self-dev via local Pi package install: `pnpm pi:install:local`, then `pnpm pi:local` and `/reload` after source changes.
- Use `pnpm pi:dev` (`pi -e .`) only for quick one-off runs.

## Commands

Implemented commands:

```text
/ct-status
/ct-detail
/ct-reload
/ct-validate [path]
/ct-explain <path> [hook]
/ct-fetch <path>
/ct-cache-list
/ct-cache-refresh <path>
/ct-tui on|off
/ct-new <path> [prompt]
/ct-subagent <path> <task>
```

## TUI

Context Tree uses Pi TUI APIs:

- `ctx.ui.setStatus()` for footer status;
- `ctx.ui.setWidget()` for a structured widget.

Widget shows:

- valid/invalid `CONTEXT.json` count;
- last target;
- operation;
- source count;
- context count;
- bundle hash;
- warning count;
- detail hint for explicit source list command.

Modes:

```text
/ct-tui off
/ct-tui on
/ct-detail
```

## Self-context layout

This repo uses its own extension config:

- `CONTEXT.json`: startup README and config-file schema/implementation context.
- `src/CONTEXT.json`: Pi docs for extension entrypoint; implementation-plan sections for resolver/schema/core files.
- `scripts/CONTEXT.json`: schema source for schema generation scripts.
- `test/CONTEXT.json`: test strategy section for test files.

## Validation

Before considering work complete, run:

```bash
pnpm validate
```

This runs:

```text
pnpm typecheck
pnpm schema:generate
pnpm test
```

## Future work

- Richer custom TUI component instead of line widget.
- Real `pi-subagents` interop for `subagent:spawn`.
- Real `pi-guardrails` interop for permission policy sharing.
- Agentic config maintenance commands with history/rollback.
- More detailed `/ct-explain` output showing final/skipped/deduped bundle sources.
