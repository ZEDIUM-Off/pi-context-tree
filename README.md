# pi-context-tree

Pi extension for deterministic, path-scoped context injection from `CONTEXT.json` files.

## Vision

`pi-context-tree` moves context routing out of model behavior and into machine-readable repository config.

Instead of asking an agent to remember to read project docs, each folder can declare which files or URLs must be injected for a target path and operation.

```text
path + operation
→ parent CONTEXT.json files
→ matching context[] entries
→ local files / cached URLs / extracted sections
→ bounded context bundle
→ Pi turn, read result, edit preflight, or scoped session
```

## Current status

Implemented MVP:

- simplified `CONTEXT.json` v1 schema;
- implicit scope from `dirname(CONTEXT.json)`;
- `context[]` entries with `match[]`, required `operations[]`, and `inject[]`;
- glob matching with `!` exclusions;
- operations: `*`, `agent_start`, `read`, `edit`, `write`, `grep`, `find`, `ls`, `bash`, `session_spawn`, `subagent_spawn`;
- file and URL inject sources;
- URL cache under `.pi/context-tree/cache/urls`;
- markdown section extraction, line ranges, markers, and annotated segments;
- bundle hashing and dedupe;
- read-result context injection;
- edit/write preflight injection;
- self-read skip to avoid reinjecting the file being read;
- scoped session command;
- scope guard fallback;
- structured TUI status/widget;
- unit tests for schema, matching, extraction, cache, bundles, permissions.

## `CONTEXT.json` v1

Scope is implicit: a `CONTEXT.json` applies to its containing folder.

Minimal example:

```json
{
  "version": 1,
  "context": [
    {
      "match": ["**/*.ts", "!**/*.test.ts"],
      "operations": ["agent_start", "read", "edit"],
      "inject": [
        "./docs/domain-rules.md",
        "https://raw.githubusercontent.com/badlogic/pi-mono/main/packages/coding-agent/docs/extensions.md"
      ]
    }
  ]
}
```

`inject[]` supports shorthand strings and typed objects:

```json
{
  "type": "file",
  "path": "./docs/implementation.md",
  "kind": "reference",
  "required": false,
  "extract": {
    "sections": ["Tests unitaires et déterminisme"]
  }
}
```

## Commands

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
/context-tree subagent <path> <task>
```

`subagent` is currently a planned interop point for `pi-subagents`.

## TUI

Context Tree uses Pi's native UI APIs:

- `setStatus()` for compact footer status;
- `setWidget()` for a structured widget above the editor.

Compact widget shows:

```text
Context Tree
✓ 4 valid · 0 invalid
target: src/index.ts
op: read · sources: 2 · contexts: 1
bundle: 31b6cb906d6 · warnings: 0
```

Verbose mode adds source list:

```text
/context-tree tui verbose
```

Hide widget:

```text
/context-tree tui off
```

## Development

```bash
pnpm install
pnpm validate
```

`pnpm validate` runs:

```text
typecheck
schema:generate
test
```

## Install

From public GitHub repo:

```bash
pi install git:github.com/ZEDIUM-Off/pi-context-tree
```

Then open Pi in a project and check extension:

```text
/context-tree status
/context-tree validate
```

## Pi package

`package.json` exposes the extension entrypoint:

```json
{
  "pi": {
    "extensions": ["./src/index.ts"]
  }
}
```

Try once:

```bash
pnpm pi:dev
```

Install locally for self-development:

```bash
pnpm pi:install:local
pnpm pi:local
```

Use `/reload` after source changes.

## Repository self-context

This repo uses Context Tree to develop itself:

- root `CONTEXT.json` injects README only for startup/session context;
- `src/CONTEXT.json` injects Pi docs for extension runtime files and implementation-plan sections for core files;
- `scripts/CONTEXT.json` injects the canonical schema for schema generation;
- `test/CONTEXT.json` injects test strategy sections.

`AGENTS.md` is not injected by Context Tree because Pi already loads it as project context.
