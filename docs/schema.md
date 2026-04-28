# Context Tree schema

`CONTEXT.json` defines deterministic, path-scoped context injection for Pi.

```text
hook + optional target path
→ parent/all CONTEXT.json files
→ matching hooks[] entries
→ inject[] sources
→ mode-specific content/reference bundle
→ Pi injection point
```

## Top-level object

```json
{
  "$schema": "./schemas/context.schema.json",
  "stability": {
    "state": "in_progress",
    "summary": "Resolver refactor active; do not infer final patterns yet.",
    "updatedAt": "2026-04-28",
    "updatedBy": "agent"
  },
  "defaults": {
    "cache": { "mode": "ttl", "ttl": "14d", "fallback": "stale" },
    "budget": { "maxTokens": 3000, "perSourceMaxTokens": 2000 }
  },
  "hooks": [],
  "branching": { "enabled": false },
  "permissions": {},
  "subagents": {}
}
```

| Field         | Required | Meaning                                        |
| ------------- | -------: | ---------------------------------------------- |
| `$schema`     |      yes | JSON schema URI/path for editor validation and release alignment. |
| `stability`   |       no | Real maturity/trust state for code under this scope. |
| `defaults`    |       no | Scope defaults inherited by hooks and sources. |
| `hooks`       |       no | Routing rules. Defaults to empty array.        |
| `branching`   |       no | Optional branch-scope behavior.                |
| `permissions` |       no | Optional scope guard behavior.                 |
| `subagents`   |       no | Reserved subagent interop settings.            |

Scope is implicit: `dirname(CONTEXT.json)`.

## stability

`stability` is a top-level scope signal for AI-assisted editing. It tells agents whether code under this scope is trusted reference, stable working code, active work, prototype, deprecated, or generated. It is not an edit policy engine; detailed rules still belong in hook-injected `.md` files.

Nearest parent `CONTEXT.json` with `stability` wins for a target path. Child scopes override parent scopes completely.

```json
{
  "stability": {
    "state": "in_progress",
    "summary": "Parser migration active. Do not copy current structure as final pattern.",
    "updatedAt": "2026-04-28",
    "updatedBy": "agent",
    "until": "User validates after pnpm validate"
  }
}
```

| Field       | Required | Meaning |
| ----------- | -------: | ------- |
| `state`     |      yes | One of `canonical`, `stable`, `in_progress`, `experimental`, `deprecated`, `generated`. |
| `summary`   |       no | Short human explanation shown in bundles. |
| `updatedAt` |       no | Last update date/time, usually ISO-like. |
| `updatedBy` |       no | Maintainer identity, e.g. `user`, `agent`, team name. |
| `until`     |       no | Optional condition for revisiting temporary states. |

State meanings:

- `canonical`: trusted reference code; agent may use conventions as inspiration.
- `stable`: reliable code; preserve behavior; reasonable local inspiration.
- `in_progress`: active work; do not infer stable project conventions.
- `experimental`: prototype/exploration; avoid copying patterns without explicit reason.
- `deprecated`: avoid extending or copying.
- `generated`: generated code; do not use as human style; edit generator/source when possible.

Agents may update `stability` when opening or closing a scoped chantier. Example: set `in_progress` before a refactor, then user/agent sets `stable` or `canonical` after validation.

## hooks[]

```json
{
  "on": "tool:read",
  "match": ["src/**/*.ts", "!**/*.test.ts"],
  "inject": ["./docs/rules.md"],
  "cache": { "mode": "ttl", "ttl": "14d" },
  "budget": { "perSourceMaxTokens": 1200 },
  "agents": ["coder"]
}
```

| Field    |        Required | Meaning                                                                                    |
| -------- | --------------: | ------------------------------------------------------------------------------------------ |
| `on`     |             yes | Hook name.                                                                                 |
| `match`  | path-aware only | Glob list relative to owning scope. `!` excludes. Must include at least one positive glob. |
| `inject` |             yes | Source list. Strings or objects.                                                           |
| `cache`  |              no | Hook-level cache defaults for URL sources.                                                 |
| `budget` |              no | Hook-level token budget hints.                                                             |
| `agents` |              no | Reserved filter for future agent-specific routing.                                         |

### Hook names

Pathless hooks: no `match` allowed.

- `session:start`: all scopes, first agent turn in session.
- `agent:start`: selected by prompt-mentioned paths such as `@src/index.ts`.

Path-aware hooks: `match` required.

- `tool:read`
- `tool:edit`
- `tool:write`
- `tool:grep`
- `tool:find`
- `tool:ls`
- `tool:bash`
- `session:spawn`
- `subagent:spawn`

## inject[] source shorthand

```json
{
  "inject": ["./docs/rules.md", "https://example.com/api.md"]
}
```

String shorthand creates `file` or `url` source with default mode:

```json
{ "mode": { "type": "ref" } }
```

Use object form for all non-default behavior.

## Source objects

### File source

```json
{
  "type": "file",
  "path": "./docs/rules.md",
  "kind": "domain-rules",
  "reason": "Canonical billing invariants",
  "mode": { "type": "inline" },
  "cache": {},
  "budget": {}
}
```

| Field    | Required | Meaning                                                       |
| -------- | -------: | ------------------------------------------------------------- |
| `type`   |      yes | Must be `file`.                                               |
| `path`   |      yes | File path relative to owning `CONTEXT.json`.                  |
| `kind`   |       no | Human category: `overview`, `schema`, `rules`, `pi-doc`, etc. |
| `reason` |       no | Why this source is injected. Shown in bundle.                 |
| `mode`   |       no | Injection mode. Defaults to `{ "type": "ref" }`.              |
| `cache`  |       no | Accepted for uniformity; meaningful mostly for URL sources.   |
| `budget` |       no | Per-source budget hints.                                      |

### URL source

```json
{
  "type": "url",
  "url": "https://example.com/api.md",
  "kind": "api-doc",
  "reason": "External API contract",
  "mode": { "type": "sections", "names": ["Authentication"] },
  "cache": { "mode": "ttl", "ttl": "7d", "fallback": "stale" }
}
```

| Field    | Required | Meaning                                          |
| -------- | -------: | ------------------------------------------------ |
| `type`   |      yes | Must be `url`.                                   |
| `url`    |      yes | HTTP(S) URL.                                     |
| `kind`   |       no | Human category.                                  |
| `reason` |       no | Why this source is injected.                     |
| `mode`   |       no | Injection mode. Defaults to `{ "type": "ref" }`. |
| `cache`  |       no | URL cache policy.                                |
| `budget` |       no | Per-source budget hints.                         |

URLs are cached under `.pi/context-tree/cache/urls`.

## mode

`mode` is one unified injection contract for all source types: files, code, markdown, URLs, generated docs.

There is no separate `required`, `delivery`, or top-level `extract` field. If a mode needs content, Context Tree loads it. If loading fails, injection fails. If mode is `ref`, Context Tree renders only identity and load instructions.

### `inline`

Inject full source content.

```json
{ "type": "inline" }
```

Example:

```json
{
  "type": "file",
  "path": "./README.md",
  "mode": { "type": "inline" }
}
```

Behavior:

- file: read full file;
- URL: fetch/cache full document;
- render: `### Content` with full content;
- missing/unreadable source: error.

### `ref`

Inject reference only.

```json
{ "type": "ref" }
```

Behavior:

- no content loaded;
- render: path/URL, mode, kind/reason, and load command;
- useful for broad background docs or expensive URLs.

### `lines`

Inject selected line ranges.

```json
{
  "type": "lines",
  "ranges": ["20-80", "120-150"]
}
```

Rendered content includes range headers:

```md
# lines:20-80

...

# lines:120-150

...
```

Use for stable files where line numbers do not drift often.

### `sections`

Inject named markdown sections.

```json
{
  "type": "sections",
  "names": ["Billing invariants", "Security rules"]
}
```

Section names must match markdown heading text exactly. Content includes heading and section body until next heading of same or higher level.

### `markers`

Inject marker-delimited code or text.

```ts
// context-tree:start billing-domain-types
export type InvoiceStatus = "draft" | "open" | "paid" | "void";
// context-tree:end billing-domain-types
```

```json
{
  "type": "markers",
  "names": ["billing-domain-types"]
}
```

Use markers for stable semantic excerpts inside source files.

### `segments`

Inject mixed annotated excerpts.

```json
{
  "type": "segments",
  "items": [
    { "section": "Billing invariants", "note": "Checklist before edits." },
    { "marker": "billing-domain-types", "note": "Canonical domain types." },
    { "lines": "20-40", "note": "Generated enum mapping." }
  ]
}
```

Each item must specify exactly one of `section`, `marker`, or `lines`. `note` is rendered as `Agent note:` before that excerpt.

### format

Every mode may include optional `format` metadata.

```json
{
  "type": "lines",
  "ranges": ["20-40"],
  "format": { "language": "ts", "label": "Billing totals" }
}
```

Current behavior: metadata is validated and reserved for richer rendering. Content extraction stays text-based.

## cache

```json
{
  "mode": "ttl",
  "ttl": "14d",
  "fallback": "stale"
}
```

| Field      | Values                              | Meaning                                   |
| ---------- | ----------------------------------- | ----------------------------------------- |
| `mode`     | `ttl`, `manual`, `pinned`, `latest` | Cache strategy.                           |
| `ttl`      | duration string                     | Time-to-live hint, default `14d`.         |
| `fallback` | `stale`, `error`                    | Use stale cache on fetch failure or fail. |

Precedence: source `cache` > hook `cache` > top-level `defaults.cache`.

## budget

```json
{
  "maxTokens": 3000,
  "perSourceMaxTokens": 1200,
  "priority": 10
}
```

Budget fields are validated hints for bundle control and future truncation. Precedence: source > hook > top-level defaults.

## Resolution order

For path-aware hooks:

1. collect parent `CONTEXT.json` files root → leaf;
2. keep hook blocks whose `on` matches operation;
3. evaluate `match[]` relative to owning scope;
4. normalize sources and apply defaults;
5. dedupe by path/URL + `mode`;
6. load content for non-`ref` modes;
7. render stable bundle.

For pathless hooks:

- `session:start`: scans all scopes;
- `agent:start`: uses parent scopes for prompt-mentioned paths; hook itself has no `match[]`.

## Examples

### Startup with README and package inline

```json
{
  "hooks": [
    {
      "on": "session:start",
      "inject": [
        { "type": "file", "path": "./README.md", "mode": { "type": "inline" } },
        {
          "type": "file",
          "path": "./package.json",
          "mode": { "type": "inline" }
        }
      ]
    }
  ]
}
```

### Edit safety with exact rule sections

```json
{
  "on": "tool:edit",
  "match": ["src/billing/**/*.ts"],
  "inject": [
    {
      "type": "file",
      "path": "./docs/domain.md",
      "kind": "rules",
      "reason": "Billing invariants must hold before edits",
      "mode": { "type": "sections", "names": ["Billing invariants"] }
    }
  ]
}
```

### Broad reference docs

```json
{
  "type": "url",
  "url": "https://example.com/large-api.md",
  "kind": "api-doc",
  "mode": { "type": "ref" }
}
```

## Best practices

- Put broad orientation in `session:start`; choose `inline` only when you truly want it available every session.
- Use `ref` for large docs, optional background, and expensive URLs.
- Use `sections` for markdown docs; section headings survive edits better than line ranges.
- Use `markers` for semantic code excerpts that move over time.
- Use `lines` for generated or stable files where ranges are reliable.
- Keep `match[]` narrow and explainable.
- Add `reason` for every non-obvious source.
- Prefer few precise excerpts over whole-document injection for edit/write hooks.
- Do not inject `AGENTS.md`; Pi already loads it.
- Avoid injecting same target file on `tool:read`; Context Tree skips self-injection.
