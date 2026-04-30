---
name: context-tree-config
description: Maintain Context Tree CONTEXT.json files. Use when creating, editing, validating, or explaining source-catalog injection_rules, inject sources, on selectors, modes, matches, stability metadata, or path-scoped context rules.
---

# Context Tree Config

Use this skill when a task changes `CONTEXT.json` files or when code/doc moves require context coverage updates.

## Schema references

Before creating, editing, or fixing a `CONTEXT.json`, load at least one authoritative schema reference:

- `../../docs/schema.md` for the human schema reference.
- `../../src/schema.ts` for the canonical Zod schema when implementation details matter.
- Follow the audited file's `$schema` URL/path when available.

## Operating rules

- Treat each `CONTEXT.json` as a machine-readable routing contract for its directory scope.
- Scope is implicit: the owning directory of the `CONTEXT.json`.
- Use `sources` for reusable file/url definitions.
- Use ordered `injection_rules[]` for routing.
- Put `on` on each `inject[]` item.
- Rules with `match[]` are path-aware and may only use path-aware hooks.
- Rules without `match[]` are runtime/pathless and may only use runtime hooks.
- Match patterns are scope-relative; `@` escapes to the Pi root and should be rare.
- Do not inject `AGENTS.md`; Pi already loads it.
- Prefer canonical docs/rules over duplicated prose.
- Prefer `ref` for broad orientation and `inline` only for small required context.
- Avoid self-read duplication.

## Minimal file

```json
{
  "$schema": "./schemas/context.schema.json",
  "sources": {},
  "injection_rules": []
}
```

## Common pattern

```json
{
  "sources": {
    "rules": {
      "type": "file",
      "path": "./docs/rules.md",
      "kind": "rules",
      "mode": { "type": "ref" },
      "reason": "Domain rules"
    }
  },
  "injection_rules": [
    {
      "match": ["src/domain/**/*.ts", "!src/domain/**/*.test.ts"],
      "inject": [
        { "source": "rules", "on": "tool:read" },
        {
          "source": "rules",
          "on": [
            { "hooks": ["tool:edit", "tool:write"], "mode": { "type": "sections", "names": ["Invariants", "Error Model"] } }
          ]
        }
      ]
    }
  ]
}
```

## Edit workflow

1. Load `docs/schema.md`, `src/schema.ts`, or the target file's `$schema`.
2. Identify the smallest scope that owns the files.
3. Read nearest parent/child `CONTEXT.json` files.
4. Add source definitions once under `sources`.
5. Add or update the narrowest `injection_rules[]` entry.
6. Put hook routing on `inject[].on`; use override entries for hook-specific modes.
7. Run `/ct-explain <path> <hook>` when coverage is unclear.
8. Run `/ct-validate` after config edits.
9. In this repository, run `pnpm validate` before considering work complete.

## Red flags

- Reintroducing legacy `hooks[]`.
- Duplicating identical source definitions instead of reusing `sources` ids.
- Using broad matches like `**/*` for narrow rules.
- Adding runtime hooks to matched rules, or path-aware hooks to matchless rules.
- Inlining large docs when a reference or section slice is enough.
