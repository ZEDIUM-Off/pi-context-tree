# Context Tree schema

`CONTEXT.json` defines deterministic, path-scoped context injection for Pi.

```text
event hook + optional target path
→ parent/all CONTEXT.json files
→ ordered injection_rules[]
→ source-catalog entries with per-injection overrides
→ mode-specific content/reference bundle
→ Pi injection point
```

## Top-level object

```json
{
  "$schema": "./schemas/context.schema.json",
  "stability": { "state": "stable" },
  "defaults": {
    "cache": { "mode": "ttl", "ttl": "14d", "fallback": "stale" },
    "budget": { "maxTokens": 3000, "perSourceMaxTokens": 2000 }
  },
  "sources": {},
  "injection_rules": [],
  "branching": { "enabled": false },
  "permissions": {},
  "subagents": {}
}
```

Scope is implicit: `dirname(CONTEXT.json)`. The `CONTEXT.json` at the Pi cwd is displayed as `<root>`. A user-global config may be placed at `~/.pi/CONTEXT.json` or overridden with `PI_CONTEXT_TREE_GLOBAL`.

## sources

`sources` is a map of reusable file/url definitions keyed by stable ids.

```json
{
  "sources": {
    "rules": {
      "type": "file",
      "path": "./docs/rules.md",
      "kind": "rules",
      "reason": "Domain rules",
      "mode": { "type": "ref" }
    },
    "apiDocs": {
      "type": "url",
      "url": "https://example.com/api.md",
      "mode": { "type": "sections", "names": ["Authentication"] }
    }
  }
}
```

`mode` defaults to `{ "type": "ref" }`. Sources may also define default `kind`, `reason`, `cache`, and `budget`.

## injection_rules

`injection_rules` is the single ordered routing array. Rule kind is inferred:

- rule with `match` = path-aware rule;
- rule without `match` = runtime/pathless rule.

```json
{
  "match": ["src/**/*.ts", "!src/**/*.test.ts"],
  "inject": [
    { "source": "rules", "on": "tool:read" },
    {
      "source": "rules",
      "reason": "Edit guardrails",
      "on": [
        { "hooks": ["tool:edit", "tool:write"], "mode": { "type": "sections", "names": ["Editing"] } }
      ]
    }
  ]
}
```

Runtime example:

```json
{
  "inject": [
    { "source": "startup", "on": "session:start" },
    { "source": "piDocs", "on": "agent:start" }
  ]
}
```

## on selectors

Each injection item owns its `on` selector. Supported forms:

```json
"tool:read"
```

```json
"tool:*"
```

```json
["tool:read", "tool:write"]
```

```json
[
  { "hooks": ["tool:read"], "mode": { "type": "ref" } },
  { "hooks": ["tool:edit", "tool:write"], "mode": { "type": "lines", "ranges": ["1-120"] } }
]
```

Hook groups:

- `runtime:*` => `session:start`, `agent:start`
- `tool:*` => `tool:read`, `tool:edit`, `tool:write`, `tool:grep`, `tool:find`, `tool:ls`, `tool:bash`
- `spawn:*` => `session:spawn`, `subagent:spawn`
- `path:*` => all tool and spawn hooks

A single injection item must not expand the same concrete hook twice.

## Runtime/path-aware validation

Rules with `match` may only use path-aware hooks:

```text
tool:read tool:edit tool:write tool:grep tool:find tool:ls tool:bash session:spawn subagent:spawn
```

Rules without `match` may only use runtime hooks:

```text
session:start agent:start
```

`match` must contain at least one positive pattern.

## Match semantics

Patterns without `@` are relative to the owning `CONTEXT.json` directory.

```text
src/app/CONTEXT.json + "*.ts"   => src/app/*.ts
src/app/CONTEXT.json + "./*.ts" => src/app/*.ts
src/app/CONTEXT.json + "**/*.ts" => src/app/**/*.ts
```

Patterns starting with `@` are root-relative from the Pi cwd:

```text
"@src/test.md" => <root>/src/test.md
"!@src/**/*.test.ts" => root-relative exclusion
```

Prefer scope-relative patterns; use `@` only when a scoped file intentionally references root paths.

## Merge order

For a concrete injection:

```text
internal defaults
→ top-level defaults
→ sources[sourceId]
→ injection_rules[].inject[] item fields
→ matched on override fields
```

Hook-specific overrides may change metadata (`kind`, `reason`, `mode`, `cache`, `budget`) but not source location (`type`, `path`, `url`).

## Modes

- `inline`: include full selected content;
- `ref`: include load instructions only;
- `lines`: `{ "type": "lines", "ranges": ["10-40"] }`;
- `sections`: `{ "type": "sections", "names": ["API Contract"] }`;
- `markers`: `{ "type": "markers", "names": ["context:rules"] }`;
- `segments`: mixed ordered slices by marker, lines, or section.

## Best practices

- Keep `sources` canonical and reusable.
- Keep `injection_rules` grouped by path area.
- Prefer `ref` for broad orientation; inline only small required context.
- Do not inject `AGENTS.md`; Pi loads it already.
- Avoid injecting README on every read/edit.
- Avoid self-read duplication.
- Run `/ct-explain <path> <hook>` when coverage is unclear.
- Run `/ct-validate` after config edits.
