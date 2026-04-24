# AGENTS.md

## Project

`pi-context-tree` is a Pi extension for folder-scoped contextualization.

Goal: move routing/context-loading responsibility out of LLM prose and into machine-readable `CONTEXT.json` files. Agents should receive required folder context automatically when they read or touch files under matching scopes.

## Core idea

- `CONTEXT.json` is machine contract: routing, includes, runtime hints.
- `CONTEXT.md` is optional human summary: short scope description only.
- Reference markdown/code files hold actual reusable context.
- Extension resolves context by file path, not by asking model to discover it.

Expected flow:

```text
file path -> parent scope CONTEXT.json files -> merged context bundle -> injected into Pi turn/tool result
```

## Design principles

- Keep routing machine-readable and validated.
- Keep context minimal and path-scoped.
- Prefer canonical sources over duplicated rules.
- Do not put large business rules inside `CONTEXT.json`; link files instead.
- Default to conservative injection: once per turn, deduped, token-capped.
- Start with explainable behavior before automation-heavy behavior.

## Planned MVP

1. Scan repository for `CONTEXT.json` files.
2. Resolve applicable scopes from a target file path.
3. Load `context.include[]` files.
4. Inject context for `read` results or next provider context.
5. Add `/context-tree status`, `/context-tree explain <path>`, `/context-tree validate`.

## Future runtime features

- Section extraction from markdown references.
- Runtime hints for model and thinking level.
- Tool policy suggestions and later enforcement.
- Skill file inclusion by scope.
- UI status showing active scope and loaded context.

## Repository conventions

- Source lives in `src/`.
- Pi package manifest lives in `package.json` under `pi.extensions`.
- Use TypeScript strict mode.
- Use Pi extension APIs from `@mariozechner/pi-coding-agent`.
- Use CLI commands for tool-owned files when available, e.g. `pnpm init`, `pnpm add`, `tsc --init`, `pi install`.
- Prefer self-dev via local Pi package install: `pnpm pi:install:local`, then run `pnpm pi:local` and use `/reload` after source changes.
- Use `pnpm pi:dev` (`pi -e .`) only for quick one-off runs.
- Before edits, understand Pi docs in `docs/extensions.md` and package docs when packaging changes.

## Context contract draft

Example scope file:

```json
{
  "version": 1,
  "scope": "src/features/billing",
  "applies": ["**/*.ts", "**/*.tsx"],
  "priority": 40,
  "context": {
    "mode": "once_per_turn",
    "maxTokens": 4000,
    "include": [
      {
        "path": "./CONTEXT.md",
        "kind": "summary",
        "required": true
      },
      {
        "path": "./references/domain-rules.md",
        "kind": "reference",
        "sections": ["Billing invariants"],
        "required": true
      },
      {
        "path": "./billing.types.ts",
        "kind": "code",
        "reason": "Canonical billing domain types",
        "required": true
      }
    ]
  },
  "runtime": {
    "model": {
      "provider": "anthropic",
      "id": "claude-sonnet-4-5",
      "policy": "suggest"
    },
    "thinking": "medium",
    "tools": {
      "policy": "suggest",
      "enable": ["read", "grep", "edit"],
      "disable": ["bash"]
    }
  }
}
```
