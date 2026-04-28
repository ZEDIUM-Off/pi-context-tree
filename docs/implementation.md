# Context Tree implementation notes

Context Tree routes context from machine-readable `CONTEXT.json` files into Pi hooks.

```text
path/event
→ parent CONTEXT.json files or all startup scopes
→ matching hooks[] entries
→ local files / cached URLs / references
→ Context Tree bundle
→ Pi injection point
```

## Schéma cible v1

Scope is implicit: `dirname(CONTEXT.json)`.

Minimal path-aware hook:

```json
{
  "hooks": [
    {
      "on": "tool:read",
      "match": ["src/**/*.ts", "!**/*.test.ts"],
      "inject": ["./docs/rules.md"]
    }
  ]
}
```

Pathless startup hook:

```json
{
  "hooks": [
    {
      "on": "session:start",
      "inject": [
        {
          "type": "url",
          "url": "https://raw.githubusercontent.com/badlogic/pi-mono/main/packages/coding-agent/docs/session.md",
          "kind": "pi-doc",
          "mode": { "type": "ref" },
          "reason": "Pi session tree and branch model"
        }
      ]
    }
  ]
}
```

Supported hook names:

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

Rules:

- `hooks[]` is required conceptually and defaults to empty.
- Path-aware hooks (`tool:*`, `session:spawn`, `subagent:spawn`) require `match[]`.
- Pathless hooks (`session:start`, `agent:start`) must not define `match[]`.
- `match[]` supports positive globs and `!` exclusions.
- `inject[]` accepts shorthand file/url strings or typed objects.
- Paths resolve relative to owning `CONTEXT.json`.

## Résolution des scopes

For a path target:

```text
src/features/billing/invoice.service.ts
```

Collect parent configs:

```text
/CONTEXT.json
/src/CONTEXT.json
/src/features/CONTEXT.json
/src/features/billing/CONTEXT.json
```

Each config's scope is `dirname(CONTEXT.json)`. `match[]` is evaluated relative to that scope.

Example:

```text
CONTEXT: src/features/billing/CONTEXT.json
Target:  src/features/billing/invoice.service.ts
Rel:     invoice.service.ts
```

## Résolution `hooks[]`

Path-aware hook resolution:

1. Scan parent `CONTEXT.json` files root → leaf.
2. Read `hooks[]` in file order.
3. Keep hooks where `on` equals current hook.
4. Match target path relative to hook scope.
5. Normalize `inject[]`.
6. Apply defaults: config → hook → source.
7. Deduplicate by normalized path/url + mode.
8. Load non-ref mode content and keep ref sources as metadata.
9. Render stable bundle.

Pathless startup/agent hook resolution:

1. `session:start` scans all `CONTEXT.json` files and collects startup sources from every scope.
2. `agent:start` uses parent scopes for any prompt-mentioned path, but the hook itself has no `match[]`; scope membership selects it.
3. Reject `match[]` on pathless hooks at schema validation.
4. Render mode-specific startup bundle for first `before_agent_start`.

## Injection mode

Every source uses exactly one `mode` object. There is no separate `required`, `delivery`, or top-level `extract` field.

Common modes:

```text
inline    inject full content
ref       inject path/URL and load instructions only
lines     inject selected line ranges
sections  inject named markdown sections
markers   inject marker-delimited excerpts
segments  inject mixed annotated excerpts
```

Every rendered source keeps path or URL visible.

Full inline source:

```json
{
  "type": "file",
  "path": "./docs/domain-rules.md",
  "mode": { "type": "inline" }
}
```

Reference source:

```json
{
  "type": "url",
  "url": "https://example.com/docs",
  "mode": { "type": "ref" }
}
```

Line ranges:

```json
{
  "type": "file",
  "path": "./billing.types.ts",
  "mode": { "type": "lines", "ranges": ["20-120", "180-220"] }
}
```

Markdown sections:

```json
{
  "type": "file",
  "path": "./docs/domain-rules.md",
  "mode": { "type": "sections", "names": ["Billing invariants"] }
}
```

Markers:

```ts
// context-tree:start billing-domain-types
export type InvoiceStatus = "draft" | "open" | "paid" | "void";
// context-tree:end billing-domain-types
```

```json
{
  "type": "file",
  "path": "./billing.types.ts",
  "mode": { "type": "markers", "names": ["billing-domain-types"] }
}
```

Annotated segments:

```json
{
  "type": "file",
  "path": "./billing.types.ts",
  "mode": {
    "type": "segments",
    "items": [
      { "marker": "billing-domain-types", "note": "Canonical domain types." },
      { "section": "Billing invariants", "note": "Checklist before edit." }
    ]
  }
}
```

See `docs/schema.md` for full schema reference and best practices.

## Branching by scope

`branching` is scope behavior, not injection source behavior.

```json
{
  "branching": {
    "enabled": true,
    "strategy": "by_scope",
    "summarizeOnLeave": "ask"
  },
  "hooks": []
}
```

Strategies:

```text
by_scope       one work branch per CONTEXT.json scope
by_path        one work branch per target path
by_context_id  one work branch per matched hook id
```

Current runtime tracks scope changes and warns with branch key. Actual automatic Pi leaf movement requires event-context navigation API; until available, users navigate with native `/tree`.

## Commands

Context Tree commands use `/ct-*` for discoverability:

```text
/ct-status                 show scan status and last injection summary
/ct-detail                 show detailed last injection references
/ct-reload                 reload all CONTEXT.json files
/ct-validate [path]        validate configs and list valid/invalid paths
/ct-explain <path> [hook]  explain matched hooks and sources
/ct-fetch <path>           compile bundle and fetch/cache inline URLs
/ct-cache-list             show URL cache directory
/ct-cache-refresh <path>   refresh cached URL sources for target
/ct-tui on|off             toggle Context Tree widget
/ct-new <path> [prompt]    create new Pi session seeded with session:spawn bundle
/ct-subagent <path> <task> planned subagent handoff via subagent:spawn
```

## Best practices

- Prefer `mode: { "type": "ref" }` for broad docs.
- Use `inline`, `sections`, `markers`, `lines`, or `segments` for invariants needed before edit/write.
- Keep `session:start` deliberate: inline core startup docs only when always useful.
- Put domain rules near domain scope.
- Use exclusions for tests/generated files.
- Do not inject `AGENTS.md`; Pi already loads it.
- Do not inject README globally unless startup tasks genuinely need it every session.
- Update hooks when files move or architecture changes.

## Tests unitaires et déterminisme

Core resolver logic must stay testable without Pi.

Cover:

- schema rejects unsupported `context[]` and invalid hook/match combinations;
- path-aware hooks match relative to scope;
- pathless startup collects all scopes;
- mode-specific sources render content or references correctly;
- ref sources render load commands;
- read self-injection is skipped;
- URL cache uses mock fetch only;
- `/ct-*` command behavior;
- branching key selection and scope-change detection.
