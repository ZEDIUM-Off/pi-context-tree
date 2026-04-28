# pi-context-tree

Pi extension for deterministic, path-scoped context injection from `CONTEXT.json` files.

## Vision

`pi-context-tree` moves context routing out of model behavior and into machine-readable repository config.

Instead of asking an agent to remember to read project docs, each folder can declare which files or URLs must be injected for a target path and operation.

```text
hook + optional target path
→ parent/all CONTEXT.json files
→ matching hooks[] entries
→ mode-specific inline excerpts or references
→ bounded context bundle
→ Pi turn, read result, edit preflight, or scoped session
```

## Current status

Implemented MVP:

- simplified `CONTEXT.json` v1 schema;
- implicit scope from `dirname(CONTEXT.json)`;
- `hooks[]` entries with `on`, path-aware `match[]`, and `inject[]`;
- hook/match compatibility validation: path-aware hooks require `match[]`, pathless hooks forbid it;
- hooks: `session:start`, `agent:start`, `tool:*`, `session:spawn`, `subagent:spawn`;
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

## `CONTEXT.json`

Scope is implicit: a `CONTEXT.json` applies to its containing folder.

Minimal example:

```json
{
  "$schema": "https://raw.githubusercontent.com/ZEDIUM-Off/pi-context-tree/v0.2.0/schemas/context.schema.json",
  "hooks": [
    {
      "on": "tool:read",
      "match": ["**/*.ts", "!**/*.test.ts"],
      "inject": ["./docs/domain-rules.md"]
    },
    {
      "on": "agent:start",
      "inject": [
        "https://raw.githubusercontent.com/badlogic/pi-mono/main/packages/coding-agent/docs/extensions.md"
      ]
    }
  ]
}
```

`inject[]` supports shorthand strings and typed objects. Shorthand defaults to reference mode. Object sources use one `mode` field for all content types:

```json
{
  "type": "file",
  "path": "./docs/implementation.md",
  "kind": "reference",
  "mode": {
    "type": "sections",
    "names": ["Tests unitaires et déterminisme"]
  }
}
```

Common modes:

- `inline`: inject full source content;
- `ref`: inject only path/URL and load instructions;
- `lines`: inject selected line ranges;
- `sections`: inject named markdown sections;
- `markers`: inject marker-delimited excerpts;
- `segments`: inject mixed annotated excerpts.

See [`docs/schema.md`](docs/schema.md) for full schema field behavior and best practices.

## Commands

```text
/ct-status                 show scan status and last injection summary
/ct-detail                 show detailed last injection references
/ct-reload                 reload all CONTEXT.json files
/ct-validate [path]        validate configs and list valid/invalid paths
/ct-explain <path> [hook]  explain matched hooks and sources
/ct-fetch <path>           compile bundle and fetch/cache inline URLs
/ct-cache-list             show URL cache directory
/ct-cache-refresh <path>   refresh cached URL sources for target
/ct-toggle on|off          toggle entire Context Tree extension runtime
/ct-tui on|off             toggle Context Tree widget display only
/ct-init [--resume]        initialize editable Context Tree config for current codebase
/ct-init-review <proposal> review agent proposal inside current init flow
/ct-new <path> [prompt]    create new Pi session seeded with session:spawn bundle
/ct-subagent <path> <task> planned subagent handoff via subagent:spawn
```

`subagent` is currently a planned interop point for `pi-subagents`.

Init flow is human-controlled and resumable. It scans repository rules/skills, proposes line-scoped rule injections, and proposes Context7-specific doc lookups per scope. It never injects broad root documentation links automatically; use Context7 `ctx7 library <name> <query>` then `ctx7 docs <libraryId> <query> --json` to select precise chunks.

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

Detailed source list stays on demand:

```text
/ct-detail
```

Hide widget only:

```text
/ct-tui off
```

Disable extension runtime:

```text
/ct-toggle off
```

## Changelog

Release notes live in [`CHANGELOG.md`](CHANGELOG.md). GitHub releases mirror the same version sections.

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
/ct-status
/ct-validate
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

Test against real external codebases:

```bash
pnpm test:workspace <giturl|local-path>
```

For a Git URL, this clones or fast-forwards the target repository under `.test-workspaces/`. For a local path, it uses that directory directly. Then it launches `pi -e <this repo>` from the workspace root. Extra args after the source are passed to `pi`.

## Repository self-context

This repo uses Context Tree to develop itself:

- root `CONTEXT.json` injects README only for scoped session context;
- `src/CONTEXT.json` injects Pi docs for extension runtime files and implementation-plan sections for core files;
- `scripts/CONTEXT.json` injects the canonical schema for schema generation;
- `test/CONTEXT.json` injects test strategy sections.

`AGENTS.md` is not injected by Context Tree because Pi already loads it as project context.
