# Context Tree implementation

Context Tree resolves deterministic context from `CONTEXT.json` files.

```text
event hook + optional target path
→ parent/all CONTEXT.json files
→ ordered injection_rules[]
→ matching inject[].on selectors
→ resolved sources with overrides
→ rendered bundle
→ Pi injection point
```

## Schema target

The primary routing contract is:

```json
{
  "$schema": "./schemas/context.schema.json",
  "sources": {
    "rules": { "type": "file", "path": "./docs/rules.md" }
  },
  "injection_rules": [
    {
      "match": ["src/**/*.ts"],
      "inject": [{ "source": "rules", "on": "tool:read" }]
    }
  ]
}
```

Rules with `match` are path-aware. Rules without `match` are runtime/pathless. Each injection item owns its `on` selector and can override source metadata/mode for one or more hooks.

## Resolution of scopes

- Scope is implicit: `dirname(CONTEXT.json)`.
- The root project config is displayed as `<root>`.
- User-global config is loaded from `~/.pi/CONTEXT.json` or `PI_CONTEXT_TREE_GLOBAL`.
- Path-aware events scan parent scopes for the target path.
- Runtime startup scans all known scopes.

## Matching

For a target path, the resolver computes:

- path relative to the Pi cwd/root;
- path relative to the owning `CONTEXT.json` directory.

Patterns without `@` match the scope-relative path. Patterns with `@` match the root-relative path.

## Rule resolution

For a concrete hook:

1. Select candidate rules:
   - path-aware: rules with `match` whose patterns match the target;
   - runtime: rules without `match`.
2. For each rule, expand every `inject[].on` selector.
3. Keep injection items whose expanded selector contains the concrete hook.
4. Resolve `source` from the catalog.
5. Merge configuration:

```text
internal defaults
→ top-level defaults
→ sources[sourceId]
→ inject item overrides
→ hook-specific on-entry overrides
```

6. Normalize file paths relative to the owning config directory.
7. Dedupe rendered sources by location, mode, reason, and kind.

## Runtime behavior

- `session:start`: resolves runtime rules and stores startup context for the first agent turn.
- `agent:start`: resolves runtime rules and prompt-mentioned path contexts.
- `tool:read`: appends rendered bundle to read results.
- `tool:edit` / `tool:write`: preflight injects context once, blocks initial mutation, then allows retry.
- Scope guard still applies after context preflight checks.

## Commands

```text
/ct-status                 show scan status and last injection summary
/ct-detail                 show detailed last injection references
/ct-validate               validate configs and list valid/invalid paths
/ct-explain <path> [hook]  explain matched injection rules and sources
/ct-fetch <path>           compile bundle and fetch/cache inline URLs
/ct-cache-list             show URL cache directory
/ct-cache-refresh <path>   refresh cached URL sources for target
/ct-toggle on|off          toggle entire Context Tree extension runtime
/ct-tui on|off             toggle Context Tree widget display only
/ct-init [--resume]        initialize editable Context Tree config for current codebase
/ct-subagent <path> <task> planned subagent handoff via subagent:spawn
```

`/ct-reload` is no longer part of normal usage; path-aware resolution scans current parent configs for each event, while validation/status commands rescan as needed.

## Tests unitaires et déterminisme

Core resolver logic must stay testable without Pi.

Cover:

- schema rejects invalid runtime/path-aware combinations;
- source ids must exist;
- on selector group expansion and duplicate rejection;
- path-aware hooks match relative to scope;
- `@` root-relative matching and exclusions;
- pathless startup collects runtime rules;
- mode-specific sources render content or references correctly;
- ref sources render load commands;
- read self-injection is skipped;
- URL cache uses mock fetch only;
- command/TUI summaries use source/rule counts.
