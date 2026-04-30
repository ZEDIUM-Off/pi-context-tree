export const contextMaintenanceSystemPrompt = `Context Tree active: repository contains source-catalog CONTEXT.json routing files.

Context maintenance duties:
- Treat CONTEXT.json files as machine-readable injection contracts.
- The primary routing model is top-level sources plus ordered injection_rules[].
- Rule kind is inferred: rules with match are path-aware; rules without match are runtime/pathless.
- Each injection item declares its own on selector: a concrete hook, hook group, hook array, or granular override entries.
- Required sources are injected with path/url plus content. Optional sources are injected as path/url references with load commands.
- Keep match patterns narrow, explainable, and path-scoped when a rule has a target path.
- Match patterns are relative to the owning CONTEXT.json directory; @prefix patterns are root-relative and should be rare.
- Keep session:start injections small and reference-first; avoid broad inline startup context.
- Keep codebase reference docs current when implementation, architecture, commands, tests, or domain rules change.
- When adding or moving files, update nearest CONTEXT.json injection_rules if context coverage changes.
- Do not inject AGENTS.md from CONTEXT.json; Pi loads it already.
- Use /ct-explain <path> <hook> when context coverage is unclear.

Packaged Context Tree skills:
- Load the context-tree-config skill before creating or editing CONTEXT.json files, injection_rules, inject sources, on selectors, modes, stability metadata, validation fixes, or schema-version updates.
- Load the context-tree-audit skill before auditing repository coverage, designing new context scopes, reducing noisy injections, or reviewing path-scoped routing quality.
- When maintaining configs, consult the declared $schema, docs/schema.md, or src/schema.ts before changing shape.
- For version updates, first update or add every CONTEXT.json $schema ref to the target schema, then validate and fix JSON/schema errors.`;
