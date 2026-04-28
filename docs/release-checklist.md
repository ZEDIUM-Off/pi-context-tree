# Release checklist

## Goal

Make `pi-context-tree` installable from the public GitHub repository with:

```bash
pi install git:github.com/ZEDIUM-Off/pi-context-tree
```

or, for npm publishing later:

```bash
pi install npm:pi-context-tree
```

## Required before public release

- [ ] Repository is public.
- [ ] `package.json` has correct `name`, `version`, `description`, `keywords`, `license`.
- [ ] `package.json` has a valid `pi.extensions` entry.
- [ ] `package.json` is not marked `private` for npm releases.
- [ ] Runtime dependencies are in `dependencies`, not only `devDependencies`.
- [ ] No `.pi/settings.json` in package or git.
- [ ] No generated URL cache in package or git.
- [ ] No subagent handoff artifacts such as `context.md` in package or git.
- [ ] `README.md` documents install and usage.
- [ ] `CHANGELOG.md` has an entry for the release and GitHub release notes mirror it.
- [ ] `CONTRIBUTING.md` documents philosophy and development flow.
- [ ] `LICENSE` exists if package says MIT.
- [ ] `pnpm validate` passes.
- [ ] `npm pack --dry-run` only includes intended files.

## Current package expectations

Pi package manifest:

```json
{
  "pi": {
    "extensions": ["./src/index.ts"]
  }
}
```

Runtime dependencies currently needed:

```text
@mariozechner/pi-ai
@mariozechner/pi-coding-agent
@mariozechner/pi-tui
minimatch
typebox
zod
```

## Changelog and GitHub releases

Before tagging a release:

1. Move relevant `CHANGELOG.md` bullets from `[Unreleased]` to the target version.
2. Update compare links at the bottom of `CHANGELOG.md`.
3. Use that version section as GitHub release notes:

```bash
gh release create vX.Y.Z --title "vX.Y.Z" --notes-file /tmp/pi-context-tree-vX.Y.Z.md
```

For existing tags, use:

```bash
gh release edit vX.Y.Z --title "vX.Y.Z" --notes-file /tmp/pi-context-tree-vX.Y.Z.md
```

## Suggested dry run

```bash
pnpm validate
npm pack --dry-run
```

Expected tarball contents should include:

```text
src/**
schemas/context.schema.json
README.md
AGENTS.md
CONTRIBUTING.md
docs/**
package.json
LICENSE
```

Should not include:

```text
.pi/**
node_modules/**
context.md
.pi/context-tree/cache/**
```

## Install smoke test

From another temp project:

```bash
pi install git:github.com/ZEDIUM-Off/pi-context-tree
pi
/ct-validate
/ct-tui on
```

Expected:

```text
Context Tree validation: ...
```

## Versioning

Current public line is `0.2.x`.

Use patch releases for documentation, packaging, and compatibility fixes.
Use minor releases for schema additions or new commands.
Use major release only for breaking `CONTEXT.json` schema changes after public adoption.
