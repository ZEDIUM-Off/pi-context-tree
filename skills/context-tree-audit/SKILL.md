---
name: context-tree-audit
description: Audit and improve Context Tree coverage for a codebase. Use when assessing whether agents receive the right path-scoped context, designing new CONTEXT.json scopes, reviewing injection_rules matches, or reducing noisy/duplicated injections.
---

# Context Tree Audit

Use this skill to evaluate context routing quality before making broad config changes.

## Schema references

Before auditing or proposing changes, load the expected config schema. This skill is packaged with the extension, so these references are available even when auditing an unrelated user project:

- From this skill directory, read `../../docs/schema.md` for the bundled human schema reference.
- From this skill directory, read `../../src/schema.ts` for the bundled canonical Zod schema when implementation details matter.
- Follow the `$schema` URL/path declared by each audited `CONTEXT.json` when the project is pinned to a specific release.
- Target release schemas use `https://raw.githubusercontent.com/ZEDIUM-Off/pi-context-tree/v<version>/schemas/context.schema.json`.

When using relative paths above, resolve them against this skill directory before calling `read`. If configs mix schema versions, treat version alignment as the first audit finding.

## Audit goals

A healthy Context Tree setup is:

- Deterministic: injection_rules, on selectors, and globs explain why context appears.
- Minimal: agents receive only context needed for the current path and operation.
- Path-scoped: child scopes refine parent scopes for specific folders.
- Canonical: injected sources point to authoritative docs, schemas, or rules.
- Maintainable: changes to code layout have obvious context updates.

## Audit workflow

1. Map the repository structure and existing `CONTEXT.json` files.
2. Check every top-level `$schema` before interpreting validation errors. Missing or outdated `$schema` refs are a blocking audit item.
3. Identify important responsibility boundaries: source roots, tests, scripts, generated files, docs, domain modules, adapters, UI, commands.
4. For representative paths, run or ask the user to run:
   - `/ct-explain <path> agent:start`
   - `/ct-explain <path> tool:read`
   - `/ct-explain <path> tool:edit`
5. Check whether injected sources answer the agent's likely questions for that path.
6. Remove or narrow noisy broad injections.
7. Add child `CONTEXT.json` files only when a folder has stable, distinct context needs.
8. Validate with `/ct-validate [path]` and project validation commands.

## Version update audit protocol

When the goal is to update configs between Context Tree versions:

1. Inventory every `CONTEXT.json` and its current `$schema` value.
2. First update or add every `$schema` line to the target version/schema reference.
3. Then validate all configs against that target schema.
4. Analyze JSON parse errors separately from schema errors:
   - parse errors must be fixed before schema validation is meaningful;
   - schema errors should be grouped by repeated migration pattern.
5. Correct schema errors with the smallest config-preserving edit.
6. Re-run validation until all configs are valid.
7. Use `/ct-explain` on representative paths to catch accidental routing changes.
8. Report old/new schema refs, files fixed, remaining risks, and commands run.

## Coverage heuristics

Add a child `CONTEXT.json` when a folder has one of these:

- Different architectural layer rules.
- Distinct test strategy.
- Generated or deprecated status.
- Required external docs or API references.
- Special edit safety rules.
- Stable domain invariants not needed elsewhere.

Prefer parent injection_rules when context is genuinely shared by all descendants.

## Stability guidance

Use `stability` to tell agents how much to trust a scope:

```json
{
  "stability": {
    "state": "canonical",
    "summary": "Core implementation patterns. Prefer these conventions when editing related files.",
    "updatedAt": "2026-04-30",
    "updatedBy": "agent"
  }
}
```

States:

- `canonical`: trusted source of local patterns.
- `stable`: reliable baseline; preserve behavior.
- `in_progress`: active work; expect churn.
- `experimental`: exploratory; do not generalize blindly.
- `deprecated`: avoid extending; migrate away when asked.
- `generated`: do not edit manually unless generation changes.

## Review questions

For every injection rule, ask:

- Which concrete paths should match?
- Which paths must not match?
- Is this source needed for read, edit, write, or only startup?
- Can this be a `ref` or sliced mode instead of `inline`?
- Is the source canonical, current, and near the owning scope?
- Would this injection surprise an agent reading an unrelated file?

## Output format for audits

When reporting an audit, group findings as:

- Missing context: path/hook, expected source, why.
- Noisy context: path/hook, current source, narrowing proposal.
- Stale context: source, evidence, update needed.
- Scope proposal: directory, stability state, sources and injection_rules to add.
- Validation: commands run and results.
