export const contextMaintenanceSystemPrompt = `Context Tree active: repository contains hook-based CONTEXT.json routing files.

Context maintenance duties:
- Treat CONTEXT.json files as machine-readable hook contracts.
- Required sources are injected with path/url plus content. Optional sources are injected as path/url references with load commands.
- Keep hook matches narrow, explainable, and path-scoped when hook has a target path.
- Keep session:start hooks small and reference-first; avoid broad inline startup context.
- Keep codebase reference docs current when implementation, architecture, commands, tests, or domain rules change.
- When adding or moving files, update nearest CONTEXT.json hooks if context coverage changes.
- Do not inject AGENTS.md from CONTEXT.json; Pi loads it already.
- Use /ct-explain <path> <hook> when context coverage is unclear.`;
