import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import path from "node:path";
import { buildBundle, explainPath, formatExplain, parsePromptPaths, renderBundle, scanAllContextTree, scanContextParents, type ContextScope, type Operation } from "./context-tree.js";
import { decideScopeAccess } from "./permissions.js";

const operations = new Set(["*", "agent_start", "read", "edit", "write", "grep", "find", "ls", "bash", "session_spawn", "subagent_spawn"]);

const helpText = `Context Tree commands:

/context-tree status
  Show loaded context scope count.

/context-tree reload
  Reload CONTEXT.json files.

/context-tree validate [path]
  Validate CONTEXT.json files from repo root to path.

/context-tree explain <path> [operation]
  Explain matching context[] blocks and inject sources.
  Operations: *, agent_start, read, edit, write, grep, find, ls, bash, session_spawn, subagent_spawn

/context-tree fetch <path>
  Compile bundle for path and fetch/cache URL sources.

/context-tree cache list
  Show URL cache location.

/context-tree cache refresh <path>
  Compile bundle and refresh stale URL cache entries.

/context-tree tui on|off|compact|verbose
  Show/hide Context Tree widget or switch between compact and verbose views.

/context-tree new <path> [prompt]
  Create scoped Pi session with session_spawn bundle injected.

/context-tree subagent <path> <task>
  Planned pi-subagents interop. Currently reports setup hint.

CONTEXT.json v1:
- scope is implicit: dirname(CONTEXT.json)
- context[] entries require match[], operations[], inject[]
- match supports ! exclusions
- operations may be ["*"]
- inject accepts file/url strings or typed objects`;

type TuiMode = "compact" | "verbose";
type LastInjection = {
  target: string;
  operation: Operation;
  bundleHash: string;
  sourceCount: number;
  contextCount: number;
  warningCount: number;
  sources: string[];
};

const contextTree = (pi: ExtensionAPI) => {
  let scopes: ContextScope[] = [];
  let scanErrors: Array<{ configPath: string; message: string }> = [];
  let tuiEnabled = true;
  let tuiMode: TuiMode = "compact";
  const injectedThisTurn = new Set<string>();
  const preflightSatisfied = new Set<string>();
  let lastInjection: LastInjection | undefined;

  function statusText() {
    const health = `${scopes.length} valid/${scanErrors.length} invalid`;
    if (!lastInjection) return `context-tree ${health} · idle`;
    return `context-tree ${health} · ${lastInjection.operation} ${lastInjection.target} · ${lastInjection.sourceCount} src · ${lastInjection.bundleHash.slice(0, 12)}`;
  }

  function widgetLines(): string[] {
    const health = scanErrors.length ? `⚠ ${scopes.length} valid · ${scanErrors.length} invalid` : `✓ ${scopes.length} valid · 0 invalid`;
    if (!lastInjection) return ["Context Tree", health, "last: idle", "mode: " + tuiMode];
    const base = [
      "Context Tree",
      health,
      `target: ${lastInjection.target}`,
      `op: ${lastInjection.operation} · sources: ${lastInjection.sourceCount} · contexts: ${lastInjection.contextCount}`,
      `bundle: ${lastInjection.bundleHash.slice(0, 12)} · warnings: ${lastInjection.warningCount}`,
    ];
    if (tuiMode === "verbose") {
      base.push("sources:");
      base.push(...lastInjection.sources.slice(0, 6).map((source) => `- ${source}`));
      if (lastInjection.sources.length > 6) base.push(`- ... ${lastInjection.sources.length - 6} more`);
      if (scanErrors.length) base.push(`invalid contexts: ${scanErrors.length} (run /context-tree validate)`);
    }
    return base;
  }

  function renderTui(ctx: { ui: { setStatus: (key: string, value: string) => void; setWidget: (key: string, lines: string[] | undefined) => void } }) {
    ctx.ui.setStatus("context-tree", statusText());
    ctx.ui.setWidget("context-tree", tuiEnabled ? widgetLines() : undefined);
  }

  function showInjection(ctx: { ui: { setStatus: (key: string, value: string) => void; setWidget: (key: string, lines: string[] | undefined) => void } }, target: string, operation: Operation, bundleHash: string, sourceCount: number, contextCount: number, warningCount: number, sources: string[]) {
    lastInjection = { target, operation, bundleHash, sourceCount, contextCount, warningCount, sources };
    renderTui(ctx);
  }

  function showStatus(ctx: { ui: { setStatus: (key: string, value: string) => void; setWidget: (key: string, lines: string[] | undefined) => void } }) {
    renderTui(ctx);
  }

  async function reload(cwd: string, _target = ".") {
    const result = await scanAllContextTree(cwd);
    scopes = result.scopes;
    scanErrors = result.errors;
    return scopes;
  }

  async function resolveAndRender(cwd: string, target: string, operation: Operation) {
    const targetScopes = await scanContextParents(cwd, target);
    const explain = explainPath(cwd, targetScopes, target, operation);
    const bundle = await buildBundle(cwd, explain);
    return { explain, bundle, rendered: renderBundle(bundle) };
  }

  pi.on("session_start", async (_event, ctx) => {
    try {
      await reload(ctx.cwd);
      showStatus(ctx);
    } catch (error) {
      ctx.ui.setStatus("context-tree", "context-tree error");
      ctx.ui.notify(error instanceof Error ? error.message : String(error), "error");
    }
  });

  pi.on("turn_start", async () => {
    injectedThisTurn.clear();
    preflightSatisfied.clear();
  });

  pi.on("before_agent_start", async (event, ctx) => {
    const paths = parsePromptPaths(event.prompt);
    if (paths.length === 0) return;
    const messages: string[] = [];
    for (const target of paths) {
      try {
        const { bundle, rendered } = await resolveAndRender(ctx.cwd, target, "agent_start");
        if (bundle.sources.length === 0) continue;
        const key = `${target}:${bundle.bundleHash}`;
        if (injectedThisTurn.has(key)) continue;
        injectedThisTurn.add(key);
        showInjection(ctx, target, "agent_start", bundle.bundleHash, bundle.sources.length, bundle.contextIds.length, bundle.warnings.length, bundle.sources.map((source) => source.sourceId));
        messages.push(rendered);
      } catch (error) {
        messages.push(`Context Tree failed for ${target}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    if (messages.length === 0) return;
    return { message: { customType: "context-tree", content: messages.join("\n\n---\n\n"), display: true } };
  });

  pi.on("tool_call", async (event, ctx) => {
    const target = toolTargetPath(event.toolName, event.input);
    if (!target) return;
    const operation = toolOperation(event.toolName);
    if (!operation) return;
    const targetScopes = await scanContextParents(ctx.cwd, target);
    const explain = explainPath(ctx.cwd, targetScopes, target, operation);

    if ((operation === "edit" || operation === "write") && explain.sources.length > 0) {
      const bundle = await buildBundle(ctx.cwd, explain);
      const key = `${target}:${operation}:${bundle.bundleHash}`;
      if (!preflightSatisfied.has(key)) {
        preflightSatisfied.add(key);
        injectedThisTurn.add(key);
        showInjection(ctx, target, operation, bundle.bundleHash, bundle.sources.length, bundle.contextIds.length, bundle.warnings.length, bundle.sources.map((source) => source.sourceId));
        pi.sendMessage({ customType: "context-tree", content: renderBundle(bundle), display: true }, { deliverAs: "steer", triggerTurn: true });
        return { block: true, reason: `Context Tree injected required ${operation} context for ${target}. Retry after reading it.` };
      }
    }

    const nearest = targetScopes.at(-1);
    const guard = nearest?.config.permissions?.scopeGuard;
    if (nearest && guard && ["read", "edit", "write", "grep", "find", "ls", "bash"].includes(operation)) {
      const decision = decideScopeAccess({ cwd: ctx.cwd, scopeDir: nearest.dir, targetPath: target, config: guard, interactive: ctx.hasUI });
      if (decision.action === "block") return { block: true, reason: `Context Tree scope guard blocked ${target}: ${decision.reason}` };
      if (decision.action === "ask") {
        const ok = await ctx.ui.confirm("Context Tree scope guard", `${event.toolName} wants access outside scope ${path.relative(ctx.cwd, nearest.dir)}: ${target}. Allow once?`);
        if (!ok) return { block: true, reason: "Denied by Context Tree scope guard" };
      }
    }
  });

  pi.on("tool_result", async (event, ctx) => {
    if (event.toolName !== "read") return;
    const target = toolTargetPath(event.toolName, event.input);
    if (!target) return;
    try {
      const { bundle, rendered } = await resolveAndRender(ctx.cwd, target, "read");
      if (bundle.sources.length === 0) return;
      const key = `${target}:read:${bundle.bundleHash}`;
      if (injectedThisTurn.has(key)) return;
      injectedThisTurn.add(key);
      showInjection(ctx, target, "read", bundle.bundleHash, bundle.sources.length, bundle.contextIds.length, bundle.warnings.length, bundle.sources.map((source) => source.sourceId));
      return {
        content: [
          ...event.content,
          { type: "text", text: `\n\n---\n\n${rendered}` },
        ],
      };
    } catch (error) {
      return {
        content: [
          ...event.content,
          { type: "text", text: `\n\nContext Tree read injection failed for ${target}: ${error instanceof Error ? error.message : String(error)}` },
        ],
      };
    }
  });


  pi.registerCommand("context-tree", {
    description: "Inspect and operate deterministic path-scoped context routing.",
    handler: async (args, ctx) => {
      const [command = "status", ...rest] = args.trim().split(/\s+/).filter(Boolean);

      if (command === "help" || command === "--help" || command === "-h") {
        ctx.ui.notify(helpText, "info");
        return;
      }

      if (command === "status") {
        ctx.ui.notify(statusText(), scanErrors.length ? "warning" : "info");
        return;
      }

      if (command === "tui") {
        const mode = rest[0];
        if (mode !== "on" && mode !== "off" && mode !== "compact" && mode !== "verbose") {
          ctx.ui.notify("Usage: /context-tree tui on|off|compact|verbose", "warning");
          return;
        }
        if (mode === "on") tuiEnabled = true;
        if (mode === "off") tuiEnabled = false;
        if (mode === "compact" || mode === "verbose") {
          tuiEnabled = true;
          tuiMode = mode;
        }
        showStatus(ctx);
        ctx.ui.notify(`Context Tree TUI ${tuiEnabled ? `enabled (${tuiMode})` : "disabled"}.`, "info");
        return;
      }

      if (command === "reload") {
        await reload(ctx.cwd);
        showStatus(ctx);
        ctx.ui.notify(`Reloaded ${scopes.length} valid context scope(s), ${scanErrors.length} invalid.`, scanErrors.length ? "warning" : "info");
        return;
      }

      if (command === "validate") {
        await reload(ctx.cwd);
        showStatus(ctx);
        const lines = [`Context Tree validation: ${scopes.length} valid, ${scanErrors.length} invalid.`];
        for (const scope of scopes) lines.push(`- valid ${path.relative(ctx.cwd, scope.configPath) || "CONTEXT.json"}`);
        for (const error of scanErrors) lines.push(`- invalid ${path.relative(ctx.cwd, error.configPath)}: ${error.message}`);
        ctx.ui.notify(lines.join("\n"), scanErrors.length ? "error" : "info");
        return;
      }

      if (command === "explain") {
        const opMaybe = rest.at(-1);
        const operation = opMaybe && operations.has(opMaybe) ? opMaybe as Operation : "agent_start";
        const pathParts = operation === opMaybe ? rest.slice(0, -1) : rest;
        const targetPath = pathParts.join(" ");
        if (!targetPath) {
          ctx.ui.notify("Usage: /context-tree explain <path> [operation]", "warning");
          return;
        }
        const targetScopes = await scanContextParents(ctx.cwd, targetPath);
        const result = explainPath(ctx.cwd, targetScopes, targetPath, operation);
        ctx.ui.notify(formatExplain(ctx.cwd, result), "info");
        return;
      }

      if (command === "fetch" || (command === "cache" && rest[0] === "refresh")) {
        const targetPath = command === "fetch" ? rest.join(" ") : rest.slice(1).join(" ");
        if (!targetPath) {
          ctx.ui.notify(`Usage: /context-tree ${command === "fetch" ? "fetch" : "cache refresh"} <path>`, "warning");
          return;
        }
        const { bundle } = await resolveAndRender(ctx.cwd, targetPath, "agent_start");
        ctx.ui.notify(`Fetched/compiled ${bundle.sources.length} source(s). Bundle ${bundle.bundleHash.slice(0, 12)}.`, "info");
        return;
      }

      if (command === "cache" && rest[0] === "list") {
        ctx.ui.notify("URL cache lives at .pi/context-tree/cache/urls. Use ls/find for detailed inspection.", "info");
        return;
      }

      if (command === "new") {
        const targetPath = rest[0];
        const prompt = rest.slice(1).join(" ");
        if (!targetPath) {
          ctx.ui.notify("Usage: /context-tree new <path> [prompt]", "warning");
          return;
        }
        await ctx.waitForIdle();
        const { bundle, rendered } = await resolveAndRender(ctx.cwd, targetPath, "session_spawn");
        const parentSession = ctx.sessionManager.getSessionFile();
        await ctx.newSession({
          ...(parentSession ? { parentSession } : {}),
          setup: async (sm) => {
            sm.appendCustomEntry("context-tree", { targetPath, operation: "session_spawn", bundleHash: bundle.bundleHash });
            sm.appendCustomMessageEntry("context-tree", rendered, true, { targetPath, bundleHash: bundle.bundleHash });
            sm.appendSessionInfo(`context-tree: ${targetPath}`);
          },
          withSession: async (newCtx) => {
            if (prompt) await newCtx.sendUserMessage(prompt);
          },
        });
        return;
      }

      if (command === "subagent") {
        ctx.ui.notify("Subagent interop planned: install/use pi-subagents and resolve operation subagent_spawn via Context Tree bundle.", "warning");
        return;
      }

      ctx.ui.notify(`Unknown context-tree command: ${command}`, "warning");
    },
  });
};

function toolOperation(toolName: string): Operation | undefined {
  if (["read", "edit", "write", "grep", "find", "ls", "bash"].includes(toolName)) return toolName as Operation;
  return undefined;
}

function toolTargetPath(toolName: string, input: unknown): string | undefined {
  if (!input || typeof input !== "object") return undefined;
  const record = input as Record<string, unknown>;
  if (typeof record.path === "string") return record.path;
  if (typeof record.pattern === "string" && typeof record.path === "string") return record.path;
  if (toolName === "bash" && typeof record.command === "string") {
    const paths = parsePromptPaths(record.command);
    return paths[0];
  }
  return undefined;
}

export default contextTree;
