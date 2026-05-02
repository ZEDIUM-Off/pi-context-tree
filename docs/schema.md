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

## Hook timing and Pi event mapping

Context Tree hook names are config-level injection moments. They map to Pi runtime events, but they are not all interchangeable.

```text
Pi session_start
→ Context Tree session:start
→ active stack is updated once for session-level context

User input
→ Pi input                 raw prompt, before @file/template/skill expansion
→ Context Tree captures explicit @file references here
→ Pi before_agent_start    expanded prompt, once per user prompt
→ Context Tree agent:start pathless runtime rules
→ Context Tree synthetic tool:read for each explicit @file reference
→ Pi context               active stack is rendered for the next LLM call

Assistant tool call
→ Pi tool_call             preflight, can block edit/write
→ Context Tree tool:<name> updates active stack before execution
→ Pi tool_result           after execution; read results stay clean
→ Context Tree tool:read updates active stack for the next LLM call
→ Pi context               active stack is rendered again if another LLM call follows
```

### `session:start`

Use `session:start` for small, session-wide orientation that should be available after startup, reload, resume, new session, or fork. It is pathless and does not mean “before every prompt”. Prefer `ref` mode or small summaries.

Good uses:

- project README as `ref`;
- package metadata as `ref`;
- global rules that should apply for the whole session.

Avoid:

- large inline docs;
- path-specific implementation docs;
- anything that should only appear when a matching file is read or edited.

### `agent:start`

Use `agent:start` for context that should be refreshed once per user prompt after prompt expansion and before the agent loop. It is also pathless in `CONTEXT.json` rules, so it applies broadly for its loaded scope. Do not use child-scope `agent:start` as a substitute for “when a file under this folder is referenced”; use a matched `tool:read` rule for that.

Good uses:

- small global behavioral rules;
- broad extension API docs when every prompt in that scope needs them;
- reference-only orientation that is safe to see frequently.

Avoid:

- folder-specific implementation docs that should only load for files in that folder;
- heavy inline content;
- test or script rules that should only apply during read/edit of matching files.

### `tool:read`

Use `tool:read` for context needed when a file is inspected. It runs for actual assistant `read` tool results and for explicit user `@file` references through a synthetic read activation. Tool outputs remain clean; Context Tree updates the active stack and the Pi `context` hook renders it before the next model call.

When the user writes `@src/file.ts`, Context Tree:

1. captures the raw `@file` token from Pi `input`;
2. ignores directories such as `@src/` and paths that do not exist;
3. injects the referenced file itself inline as an explicit prompt-file source;
4. resolves matching `tool:read` injection rules for that file;
5. skips configured injections whose source file is also one of the explicit prompt targets.

Plain path mentions such as `src/file.ts` do not trigger prompt-reference behavior.

### `tool:edit` and `tool:write`

Use `tool:edit` and `tool:write` for mutation guardrails. Context Tree updates edit/write context during tool preflight. Direct edit/write calls may be blocked once so the updated active stack is available on retry. The `ct_edit_request` / `ct_patch` protocol is preferred for Context Tree-gated edits.

### `tool:grep`, `tool:find`, `tool:ls`, and `tool:bash`

Use these only when a search/list/shell operation needs path-scoped context. Keep matches narrow; broad rules on these hooks can be noisy because agents may search widely.

### Spawn hooks

`session:spawn` and `subagent:spawn` are schema/config hooks for planned workflow and subagent interop. They are path-aware in the schema but are not the normal way to influence a current prompt.

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
