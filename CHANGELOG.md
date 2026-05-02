# Changelog

All notable changes to `pi-context-tree` are documented here.

Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). Versions follow semantic versioning while the public schema is still pre-1.0.

## [Unreleased]

## [0.4.0] - 2026-05-02

### Added

- Added active-stack runtime context injection with prompt `@file` references, synthetic `tool:read` activation, explicit activation provenance, and TUI feedback for effective context changes.
- Added Context Tree edit-tool feedback: `ct_edit_request` and `ct_patch` now provide custom TUI rendering plus agent-readable patch summaries with line counts and focused diff previews.

### Changed

- Clarified `session:start`, `agent:start`, and `tool:*` hook timing in schema documentation and reduced self-context child-scope `agent:start` noise in favor of path-aware tool hooks.
- Reset active runtime state on `session_start` / reload so removed or changed `CONTEXT.json` rules cannot remain stale in the active stack.
- Removed `agent:start` injections from `src/CONTEXT.json`; source-level self-context now activates from path-aware file reads/edits instead of every prompt.
- Improved collapsed `ct_patch` TUI output so it shows a small diff preview plus an explicit expand hint instead of only saying that expansion is possible.

### Fixed

- Fixed `ct_patch` support for creating missing authorized files with one empty-`oldText` patch.

## [0.3.0] - 2026-04-30

### Added

- Added source-catalog based `CONTEXT.json` routing with top-level `sources` and ordered `injection_rules[]`.
- Added per-injection `on` selectors, hook groups, and hook-specific override entries for mode/cache/budget metadata.
- Added scope-relative matching with `@` root-relative escape support.
- Added automatic Context Tree schema and best-practice maintenance context for `CONTEXT.json` read/edit/write operations.
- Added tests for new schema validation, matching, merge order, runtime/path-aware rule separation, hot re-resolution behavior, and maintenance injection.

### Changed

- Replaced the primary legacy `hooks[]` routing model with inferred path-aware/runtime `injection_rules[]`.
- Migrated repository self-context files and public docs to the new schema syntax.
- Updated generated JSON schema and public API exports for source definitions, injection rules, on selectors, and resolver helpers.
- Updated `/ct-explain`, status/TUI summaries, init generation, and upgrade planning to use the new routing contract.

## [0.2.2] - 2026-04-30

### Added

- Added user-global Context Tree config loading from `~/.pi/CONTEXT.json`, with `PI_CONTEXT_TREE_GLOBAL` override for tests and custom setups.

### Changed

- Cleaned up the code architecture by splitting runtime, command, bundle, TUI, and init-wizard responsibilities into focused modules.
- Split `/ct-*` command registration into dedicated command groups for status, explain, cache, upgrade, init, and subagent concerns.
- Updated public documentation to reflect the current architecture and command surface.

### Removed

- Removed `/ct-new`; session workflows are now left to Context Tree configuration and future config-driven integrations.

## [0.2.1] - 2026-04-29

### Added

- Added `docs/schema.md` as full public schema guide for `CONTEXT.json`, hooks, modes, cache, budgets, permissions, and stability metadata.
- Added versioned schema publishing under `schemas/versions/` plus `pnpm schema:release`.
- Added release preparation script `pnpm release:prepare`.
- Added local Pi development helpers that preserve user Pi settings during `pi -e .` runs.
- Added external workspace smoke-test helper `pnpm test:workspace <giturl|local-path>`.
- Added human-controlled Context Tree init flow with repository scan, rule discovery, reference proposals, scope proposals, review phases, and resumable sessions.
- Added upgrade helper modules for future schema/config migrations.
- Added changelog and mapped existing tags to GitHub releases.

### Changed

- Updated README, contributing guide, implementation notes, release checklist, and repository agent guidance for current `/ct-*` command surface and hook-based schema.
- Expanded `CONTEXT.json` self-context coverage for source, scripts, and tests.
- Expanded generated JSON schema for stability, defaults, hook-level/source-level cache and budget hints, permissions, branching, and subagent placeholders.
- Improved bundle rendering, TUI summaries, command handling, matching, normalization, and schema validation.
- Tightened npm package hygiene so local `.pi`, `.pi-lens`, `.zed`, workspaces, tarballs, and artifacts stay out of public packages.
- Bumped package version to `0.2.1` and published matching schema snapshot.

### Fixed

- Fixed stale release/checklist command examples that still used old `/context-tree ...` names.
- Fixed package dry-run including local Pi Lens and editor state.

## [0.2.0] - 2026-04-29

### Added

- Added hook-based Context Tree runtime using `hooks[]` with `on`, path-aware `match[]`, and `inject[]`.
- Added support for pathless hooks `session:start` and `agent:start`.
- Added support for path-aware hooks `tool:read`, `tool:edit`, `tool:write`, `tool:grep`, `tool:find`, `tool:ls`, `tool:bash`, `session:spawn`, and `subagent:spawn`.
- Added unified source `mode` handling: `inline`, `ref`, `lines`, `sections`, `markers`, and `segments`.
- Added bundle hashing, source dedupe, self-read skipping, and URL cache support.
- Added compact TUI status/widget plus `/ct-detail` for full source references.
- Added `/ct-status`, `/ct-reload`, `/ct-validate`, `/ct-explain`, `/ct-fetch`, `/ct-cache-list`, `/ct-cache-refresh`, `/ct-tui`, `/ct-new`, and `/ct-subagent` command surface.
- Added schema validation for hook/match compatibility.
- Added tests for schema, matching, scanning, bundles, extraction, cache, permissions, prompt paths, and TUI behavior.

### Changed

- Replaced earlier context routing shape with implicit-scope `CONTEXT.json` files and hook-driven matching.
- Split resolver/runtime code into focused modules for bundle building, cache, extraction, hooks, matching, normalization, scanning, schema, sessions, subagents, and TUI.
- Updated package metadata, scripts, lockfile, TypeScript config, and repository self-context for public extension use.

## [0.1.0] - 2026-04-28

### Added

- Initial public MVP release of `pi-context-tree`.
- Added Pi extension manifest and install path for GitHub-based usage.
- Added first `CONTEXT.json` schema and deterministic context routing prototype.
- Added basic README, contribution docs, license, implementation notes, release checklist, tests, and CI-oriented package setup.

### Fixed

- Synced `pnpm-lock.yaml` for reproducible installs.

[Unreleased]: https://github.com/ZEDIUM-Off/pi-context-tree/compare/v0.4.0...HEAD
[0.4.0]: https://github.com/ZEDIUM-Off/pi-context-tree/compare/v0.3.0...v0.4.0
[0.3.0]: https://github.com/ZEDIUM-Off/pi-context-tree/compare/v0.2.2...v0.3.0
[0.2.2]: https://github.com/ZEDIUM-Off/pi-context-tree/compare/v0.2.1...v0.2.2
[0.2.1]: https://github.com/ZEDIUM-Off/pi-context-tree/compare/v0.2.0...v0.2.1
[0.2.0]: https://github.com/ZEDIUM-Off/pi-context-tree/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/ZEDIUM-Off/pi-context-tree/releases/tag/v0.1.0
