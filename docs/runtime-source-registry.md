# Runtime source registry architecture

Context Tree uses a deterministic active context stack instead of appending bundles to tool results or startup prompts. Existing `CONTEXT.json` files remain the authoring contract; the runtime compiles them into resource and injection-param registries.

## Pipeline

```text
CONTEXT.json scopes
→ canonical resources
→ hook-specific injection params
→ batch hook resolution
→ conflict resolution
→ active injection stack
→ Pi context hook rendering
```

The bundle API remains as a compatibility and command helper surface; runtime model context is supplied by the active stack.

## Resources

A resource is the physical or logical thing being injected, independent of local `sources{}` aliases.

```ts
type ResourceKey = `file:${absolutePath}` | `url:${canonicalUrl}`;
```

Rules:

- File paths are canonicalized relative to the owning scope directory.
- `@` source paths are canonicalized relative to the Pi root.
- URLs are canonicalized for stable identity: lowercase protocol/host, default port removal, fragment removal, and sorted query parameters.
- Multiple `configPath#sourceId` declarations of the same file or URL merge into one resource while preserving declaration provenance.

Local source ids are not runtime identities. They are aliases and diagnostics metadata.

## Injection params

Every `injection_rules[].inject[].on` selector is expanded at compile time into concrete hook params.

A runtime param records:

- canonical `resourceKey`;
- source provenance (`configPath`, local source id, rule/inject/on indexes);
- hook, selector kind, and path-awareness;
- resolved match entries;
- merged kind, reason, mode, cache, and budget;
- deterministic order and scope depth.

Override precedence stays compatible with current behavior:

```text
scope defaults
→ source definition
→ inject item override
→ per-on override
```

## Batch resolution

The resolver accepts one or many hook invocations:

```ts
type HookInvocation = {
  hook: HookName;
  target?: string;
  toolName?: string;
  toolCallId?: string;
  turnIndex?: number;
  trigger?: InjectionTrigger;
  promptReference?: string;
  synthetic?: boolean;
};
```

Path-aware params match target paths using existing scoped glob and grep semantics. Runtime/pathless params match runtime invocations. The same function handles one-item and multi-item batches.

Within a batch:

- exact duplicate resource representations are deduped;
- if a file resource is also a tool target in the batch, it is skipped as context;
- skipped entries include a machine-readable reason for TUI/detail output;
- selected candidates are then passed through conflict resolution.

## Conflict policy

Context Tree keeps at most one active representation for each resource. When candidates target the same resource with different representations, the default winner is nearest and most specific.

Priority tuple, compared descending:

```text
scopeDepth
pathSpecificity
hookSpecificity
ruleIndex
injectIndex
onIndex
order
```

Guidance:

- nearest scope beats parent/global scope;
- exact/narrow path match beats broad glob;
- concrete or override hook selection beats hook groups;
- later rule/inject/on entries win at equal specificity;
- later order is the final deterministic fallback.

Same resource and same representation is provenance dedupe, not a warning. Same resource and different representation is a conflict. Equal-priority conflicts choose later order and emit a warning.

## Active injection stack

The active stack is keyed by `resourceKey` and contains one entry per resource:

```ts
type ActiveInjection = {
  resourceKey: ResourceKey;
  param: RuntimeInjectionParam;
  action: "inserted" | "moved" | "replaced-mode" | "replaced-params" | "unchanged";
  lastHook: HookName | "user:prompt-file";
  lastTargets: string[];
  invokedAt: number;
  invocationCount: number;
  previousParam?: RuntimeInjectionParam;
  warnings: string[];
  trace: ActiveInjectionTrace;
};
```

Update rules:

- absent resource: insert;
- same representation: move/reposition and update invocation metadata;
- different mode: replace the old representation;
- same mode but different resolved params: replace params;
- replacement moves the resource to the top of the stack.

The active stack represents current model context; resolution history records all invocations. The TUI widget and notifications are refreshed after effective active-stack updates.

## Provider model

Extraction and packing are separate responsibilities.

Extraction providers load or reference a resource according to `RuntimeInjectionParam.mode`:

- ref provider returns metadata/load commands without content;
- filesystem provider handles file `inline`, `lines`, `sections`, `markers`, and `segments` modes;
- URL cache provider preserves existing URL cache behavior;
- future providers can specialize GitHub or HTML sources.

Packing providers render extracted active sources for model context:

- Context Tree markdown packer is the deterministic fallback;
- Repomix can pack supported full-file sets later;
- fine-grained extraction modes must not be converted into virtual files solely to force Repomix usage.

## Pi runtime direction

The runtime flow is:

```ts
pi.on("context", async (event) => {
  const messages = stripLegacyContextTreeBlocks(event.messages);
  const stack = activeInjectionStack(state.activeInjections);
  const rendered = await renderContextStack({ entries: stack, params: stack.map((entry) => entry.param), resources });
  return { messages: appendActiveContextMessage(messages, rendered) };
});
```

Tool results stay clean for context injection: `session:start`, `agent:start`, `tool:*`, prompt `@file` references, and edit request hooks update the active registry instead of appending context to tool output. The context hook renders one canonical stack near the end of model context with explicit `context-tree:active-stack` markers.

Legacy `# Context Tree Bundle` blocks are stripped best-effort for older sessions.

The edit protocol introduces a request step before mutations:

1. `ct_edit_request` declares targets and intent, resolves edit/write context, and authorizes the target set.
2. `ct_patch` applies granular patches only to authorized targets, and can create a missing authorized file with one empty-oldText patch.
3. New target sets trigger new resolution; repeated patches to the same target set do not reinject.

Context Tree edit tools still return visible tool results. `ct_edit_request` returns a concise authorization summary. `ct_patch` returns an agent-readable summary with line counts and a focused unified diff, and exposes the same data in `details` for custom TUI rendering. The TUI default view stays compact; expanding the tool row shows the diff preview.
