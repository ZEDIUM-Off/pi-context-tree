# Context Tree implementation

Context Tree resolves deterministic context from `CONTEXT.json` files.

```text
event hook + optional target path
→ parent/all CONTEXT.json files
→ ordered injection_rules[]
→ matching inject[].on selectors
→ resolved sources with overrides
→ runtime injection params
→ active injection stack
→ Pi context hook rendering
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

Active-stack runtime path:

- Config scopes compile into a resource registry keyed by canonical file path or URL.
- Rule inject items compile into hook-specific runtime injection params with full provenance and merged overrides.
- `session:start`, `agent:start`, and `tool:*` invocations update the active injection registry.
- One or more hook invocations resolve as a batch; same-file targets are skipped as context and same-resource conflicts are resolved deterministically.
- The active injection registry keeps at most one representation per resource and records whether each invocation inserted, moved, or replaced it.
- Pi's `context` hook renders one canonical Context Tree active-stack message marked with `context-tree:active-stack` comments.
- Context injection no longer appends bundles to tool outputs; legacy `# Context Tree Bundle` blocks are stripped best-effort from older sessions.
- `ct_edit_request` and `ct_patch` are edit tools, not context-injection carriers: they intentionally return visible tool results. `ct_patch` returns a compact line-count summary plus focused unified diff for the agent and exposes the same details to custom TUI rendering.
- `tool:edit` / `tool:write` direct calls update active context and use a retry gate. When a Context Tree edit session is active, direct edit/write calls are blocked in favor of `ct_patch`.
- Scope guard still applies after context updates.

Compatibility path:

- `buildBundle` / `renderBundle` remain available for commands and public API compatibility.
- Runtime model context no longer depends on appending those rendered bundles to system prompts or tool results.

## Commands

```text
/ct-status                 show scan status and active stack summary
/ct-detail                 show active stack, resolution history, conflicts, skips, and references
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
- command/TUI summaries expose active stack counts, resolution diagnostics, conflicts, skips, and source/rule provenance.
