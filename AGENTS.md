# AGENTS.md

## Project

`pi-context-tree` is a Pi extension for deterministic, path-scoped contextualization.

Goal: move routing/context-loading responsibility out of LLM prose and into machine-readable `CONTEXT.json` files. Agents receive required folder context automatically when they read, edit, write, or start work on files under matching scopes.

## Core idea

```text
path + operation
→ parent CONTEXT.json files
→ matching context[] entries
→ local files / cached URLs / extracted sections
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
  "version": 1,
  "context": [
    {
      "match": ["**/*.ts", "!**/*.test.ts"],
      "operations": ["agent_start", "read", "edit"],
      "inject": ["./docs/rules.md"]
    }
  ]
}
```

Rules:

- `context[]` is the primary routing array.
- `match[]` uses glob patterns, with `!` for exclusions.
- `operations[]` is required and may contain `"*"`.
- `inject[]` accepts shorthand strings or typed objects.
- Paths are resolved relative to the owning `CONTEXT.json`.
- URLs are cached under `.pi/context-tree/cache/urls`.
- File extraction supports markdown sections, line ranges, markers, and annotated segments.

## Operations

Supported operations:

```text
*
agent_start
read
edit
write
grep
find
ls
bash
session_spawn
subagent_spawn
```

Behavior implemented:

- `agent_start`: injects bundles when prompt references paths such as `@src/index.ts`.
- `read`: appends context bundle to read tool results.
- `edit` / `write`: preflight injects context once, blocks initial mutation, then allows retry.
- `session_spawn`: used by `/context-tree new <path> [prompt]`.
- `subagent_spawn`: schema/config concept; runner interop still planned.

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
/context-tree help
/context-tree status
/context-tree reload
/context-tree validate [path]
/context-tree explain <path> [operation]
/context-tree fetch <path>
/context-tree cache list
/context-tree cache refresh <path>
/context-tree tui on|off|compact|verbose
/context-tree new <path> [prompt]
```

Planned command:

```text
/context-tree subagent <path> <task>
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
- source list in verbose mode.

Modes:

```text
/context-tree tui compact
/context-tree tui verbose
/context-tree tui off
/context-tree tui on
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
- Real `pi-subagents` interop for `subagent_spawn`.
- Real `pi-guardrails` interop for permission policy sharing.
- Agentic config maintenance commands with history/rollback.
- More detailed `/context-tree explain` output showing final/skipped/deduped bundle sources.
