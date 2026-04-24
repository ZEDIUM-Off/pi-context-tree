# pi-context-tree

Pi extension for folder-scoped, path-routed contextualization.

## Vision

`pi-context-tree` moves context routing out of model behavior and into machine-readable `CONTEXT.json` files. When Pi reads or touches a file, the extension can resolve nearest folder scopes and inject required context automatically.

This adapts ideas from Interpreted Context Methodology while going further: markdown remains human-readable reference material, while JSON becomes runtime routing config.

## Status

Scaffold only. Runtime routing not implemented yet.

Current extension:

- loads in Pi
- sets small status indicator
- registers `/context-tree status`

## Pi package

`package.json` exposes extension entrypoint:

```json
{
  "pi": {
    "extensions": ["./src/index.ts"]
  }
}
```

Try once without installing:

```bash
pnpm pi:dev
```

Install from local sources into project Pi settings:

```bash
pnpm pi:install:local
pnpm pi:local
```

This writes `.pi/settings.json` with a local package path. In this mode Pi loads the package like a finished extension, while still reading current source files. Use `/reload` after source changes.

Then run:

```text
/context-tree status
```

## Development

```bash
pnpm install
pnpm typecheck
```

## Planned commands

```text
/context-tree status
/context-tree explain <path>
/context-tree validate
/context-tree reload
```

## Draft `CONTEXT.json`

```json
{
  "version": 1,
  "scope": ".",
  "applies": ["**/*"],
  "priority": 0,
  "context": {
    "mode": "once_per_turn",
    "maxTokens": 3000,
    "include": [
      {
        "path": "./CONTEXT.md",
        "kind": "summary",
        "required": false
      }
    ]
  },
  "runtime": {
    "model": null,
    "thinking": null,
    "tools": null
  }
}
```

## Scope file roles

- `CONTEXT.json`: machine routing contract
- `CONTEXT.md`: short human summary
- `references/*.md`: detailed rules and docs
- code files: canonical implementation references

## Inspiration

- Pi extension API
- Interpreted Context Methodology conventions
