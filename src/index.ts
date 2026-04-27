import path from "node:path";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import {
	buildBundle,
	explainPath,
	formatExplain,
	parsePromptPaths,
	renderBundle,
} from "./bundle.js";
import {
	scanAllContextTree,
	scanContextParents,
	type ContextScope,
} from "./scan.js";
import type { Operation } from "./schema.js";
import { decideScopeAccess } from "./permissions.js";
import {
	detailText,
	renderTui,
	statusText as renderStatusText,
	summarizeBundle,
	type LastInjection,
	type TuiApi,
	type TuiMode,
} from "./tui.js";

const operations = new Set([
	"*",
	"agent_start",
	"read",
	"edit",
	"write",
	"grep",
	"find",
	"ls",
	"bash",
	"session_spawn",
	"subagent_spawn",
]);

const contextMaintenanceSystemPrompt = `Context Tree active: repository contains CONTEXT.json routing files.

Context maintenance duties:
- Treat CONTEXT.json files as machine-readable context routing contracts.
- Keep codebase reference documentation current when implementation, architecture, commands, tests, or domain rules change.
- Prefer small, canonical, path-scoped inject sources over broad README-style context.
- When adding or moving files, ensure nearest CONTEXT.json routes relevant documentation to matching paths and operations.
- When editing files, update referenced docs or CONTEXT.json inject rules if stale, missing, too broad, duplicated, or inefficient.
- Keep injections efficient: minimal sources, precise globs, exclusions for tests/generated files when appropriate, no AGENTS.md injection, no self-read duplication.
- Use /context-tree explain <path> <operation> when context coverage is unclear.`;

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

/context-tree detail
  Show detailed last injection reference list with file:// and URL links. Shortcut: Ctrl+Shift+C

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

const contextTree = (pi: ExtensionAPI) => {
	let scopes: ContextScope[] = [];
	let scanErrors: Array<{ configPath: string; message: string }> = [];
	let tuiEnabled = true;
	let tuiMode: TuiMode = "compact";
	const injectedThisTurn = new Set<string>();
	const preflightSatisfied = new Set<string>();
	let lastInjection: LastInjection | undefined;

	function tuiState() {
		return {
			scopesValid: scopes.length,
			scopesInvalid: scanErrors.length,
			enabled: tuiEnabled,
			mode: tuiMode,
			...(lastInjection ? { lastInjection } : {}),
		};
	}

	function statusText() {
		return renderStatusText(tuiState());
	}

	function showInjection(ctx: { ui: TuiApi }, cwd: string, bundle: Awaited<ReturnType<typeof buildBundle>>) {
		lastInjection = summarizeBundle(cwd, bundle);
		renderTui(ctx.ui, tuiState());
	}

	function showStatus(ctx: { ui: TuiApi }) {
		renderTui(ctx.ui, tuiState());
	}

	async function reload(cwd: string, _target = ".") {
		const result = await scanAllContextTree(cwd);
		scopes = result.scopes;
		scanErrors = result.errors;
		return scopes;
	}

	async function resolveAndRender(
		cwd: string,
		target: string,
		operation: Operation,
	) {
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
			ctx.ui.notify(
				error instanceof Error ? error.message : String(error),
				"error",
			);
		}
	});

	pi.on("turn_start", async () => {
		injectedThisTurn.clear();
	});

	pi.on("before_agent_start", async (event, ctx) => {
		const systemPrompt =
			scopes.length > 0 &&
			!event.systemPrompt.includes(
				"Context Tree active: repository contains CONTEXT.json routing files.",
			)
				? `${event.systemPrompt}\n\n${contextMaintenanceSystemPrompt}`
				: event.systemPrompt;
		const paths = parsePromptPaths(event.prompt);
		if (paths.length === 0)
			return systemPrompt === event.systemPrompt ? undefined : { systemPrompt };
		const messages: string[] = [];
		for (const target of paths) {
			try {
				const { bundle, rendered } = await resolveAndRender(
					ctx.cwd,
					target,
					"agent_start",
				);
				if (bundle.sources.length === 0) continue;
				const key = `${target}:${bundle.bundleHash}`;
				if (injectedThisTurn.has(key)) continue;
				injectedThisTurn.add(key);
				showInjection(ctx, ctx.cwd, bundle);
				messages.push(rendered);
			} catch (error) {
				messages.push(
					`Context Tree failed for ${target}: ${error instanceof Error ? error.message : String(error)}`,
				);
			}
		}
		if (messages.length === 0)
			return systemPrompt === event.systemPrompt ? undefined : { systemPrompt };
		return {
			systemPrompt,
			message: {
				customType: "context-tree",
				content: messages.join("\n\n---\n\n"),
				display: true,
			},
		};
	});

	pi.on("tool_call", async (event, ctx) => {
		const target = toolTargetPath(event.toolName, event.input);
		if (!target) return;
		const operation = toolOperation(event.toolName);
		if (!operation) return;
		const targetScopes = await scanContextParents(ctx.cwd, target);
		const explain = explainPath(ctx.cwd, targetScopes, target, operation);

		if (
			(operation === "edit" || operation === "write") &&
			explain.sources.length > 0
		) {
			const bundle = await buildBundle(ctx.cwd, explain);
			const key = `${target}:${operation}:${bundle.bundleHash}`;
			if (!preflightSatisfied.has(key)) {
				preflightSatisfied.add(key);
				injectedThisTurn.add(key);
				showInjection(ctx, ctx.cwd, bundle);
				pi.sendMessage(
					{
						customType: "context-tree",
						content: renderBundle(bundle),
						display: true,
					},
					{ deliverAs: "steer", triggerTurn: true },
				);
				return {
					block: true,
					reason: `Context Tree injected required ${operation} context for ${target}. Retry after reading it.`,
				};
			}
		}

		const nearest = targetScopes.at(-1);
		const guard = nearest?.config.permissions?.scopeGuard;
		if (
			nearest &&
			guard &&
			["read", "edit", "write", "grep", "find", "ls", "bash"].includes(
				operation,
			)
		) {
			const decision = decideScopeAccess({
				cwd: ctx.cwd,
				scopeDir: nearest.dir,
				targetPath: target,
				config: guard,
				interactive: ctx.hasUI,
			});
			if (decision.action === "block")
				return {
					block: true,
					reason: `Context Tree scope guard blocked ${target}: ${decision.reason}`,
				};
			if (decision.action === "ask") {
				const ok = await ctx.ui.confirm(
					"Context Tree scope guard",
					`${event.toolName} wants access outside scope ${path.relative(ctx.cwd, nearest.dir)}: ${target}. Allow once?`,
				);
				if (!ok)
					return { block: true, reason: "Denied by Context Tree scope guard" };
			}
		}
	});

	pi.registerShortcut("ctrl+shift+c", {
		description: "Show Context Tree injection details",
		handler: async (ctx) => {
			ctx.ui.notify(detailText(tuiState()), lastInjection ? "info" : "warning");
		},
	});

	pi.on("tool_result", async (event, ctx) => {
		if (event.toolName !== "read") return;
		const target = toolTargetPath(event.toolName, event.input);
		if (!target) return;
		try {
			const { bundle, rendered } = await resolveAndRender(
				ctx.cwd,
				target,
				"read",
			);
			if (bundle.sources.length === 0) return;
			const key = `${target}:read:${bundle.bundleHash}`;
			if (injectedThisTurn.has(key)) return;
			injectedThisTurn.add(key);
			showInjection(ctx, ctx.cwd, bundle);
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
					{
						type: "text",
						text: `\n\nContext Tree read injection failed for ${target}: ${error instanceof Error ? error.message : String(error)}`,
					},
				],
			};
		}
	});

	pi.registerCommand("context-tree", {
		description:
			"Inspect and operate deterministic path-scoped context routing.",
		handler: async (args, ctx) => {
			const [command = "status", ...rest] = args
				.trim()
				.split(/\s+/)
				.filter(Boolean);

			if (command === "help" || command === "--help" || command === "-h") {
				ctx.ui.notify(helpText, "info");
				return;
			}

			if (command === "status") {
				ctx.ui.notify(statusText(), scanErrors.length ? "warning" : "info");
				return;
			}

			if (command === "detail") {
				ctx.ui.notify(detailText(tuiState()), lastInjection ? "info" : "warning");
				return;
			}

			if (command === "tui") {
				const mode = rest[0];
				if (
					mode !== "on" &&
					mode !== "off" &&
					mode !== "compact" &&
					mode !== "verbose"
				) {
					ctx.ui.notify(
						"Usage: /context-tree tui on|off|compact|verbose",
						"warning",
					);
					return;
				}
				if (mode === "on") tuiEnabled = true;
				if (mode === "off") tuiEnabled = false;
				if (mode === "compact" || mode === "verbose") {
					tuiEnabled = true;
					tuiMode = mode;
				}
				showStatus(ctx);
				ctx.ui.notify(
					`Context Tree TUI ${tuiEnabled ? `enabled (${tuiMode})` : "disabled"}.`,
					"info",
				);
				return;
			}

			if (command === "reload") {
				await reload(ctx.cwd);
				showStatus(ctx);
				ctx.ui.notify(
					`Reloaded ${scopes.length} valid context scope(s), ${scanErrors.length} invalid.`,
					scanErrors.length ? "warning" : "info",
				);
				return;
			}

			if (command === "validate") {
				await reload(ctx.cwd);
				showStatus(ctx);
				const lines = [
					`Context Tree validation: ${scopes.length} valid, ${scanErrors.length} invalid.`,
				];
				for (const scope of scopes)
					lines.push(
						`- valid ${path.relative(ctx.cwd, scope.configPath) || "CONTEXT.json"}`,
					);
				for (const error of scanErrors)
					lines.push(
						`- invalid ${path.relative(ctx.cwd, error.configPath)}: ${error.message}`,
					);
				ctx.ui.notify(lines.join("\n"), scanErrors.length ? "error" : "info");
				return;
			}

			if (command === "explain") {
				const opMaybe = rest.at(-1);
				const operation =
					opMaybe && operations.has(opMaybe)
						? (opMaybe as Operation)
						: "agent_start";
				const pathParts = operation === opMaybe ? rest.slice(0, -1) : rest;
				const targetPath = pathParts.join(" ");
				if (!targetPath) {
					ctx.ui.notify(
						"Usage: /context-tree explain <path> [operation]",
						"warning",
					);
					return;
				}
				const targetScopes = await scanContextParents(ctx.cwd, targetPath);
				const result = explainPath(
					ctx.cwd,
					targetScopes,
					targetPath,
					operation,
				);
				ctx.ui.notify(formatExplain(ctx.cwd, result), "info");
				return;
			}

			if (
				command === "fetch" ||
				(command === "cache" && rest[0] === "refresh")
			) {
				const targetPath =
					command === "fetch" ? rest.join(" ") : rest.slice(1).join(" ");
				if (!targetPath) {
					ctx.ui.notify(
						`Usage: /context-tree ${command === "fetch" ? "fetch" : "cache refresh"} <path>`,
						"warning",
					);
					return;
				}
				const { bundle } = await resolveAndRender(
					ctx.cwd,
					targetPath,
					"agent_start",
				);
				ctx.ui.notify(
					`Fetched/compiled ${bundle.sources.length} source(s). Bundle ${bundle.bundleHash.slice(0, 12)}.`,
					"info",
				);
				return;
			}

			if (command === "cache" && rest[0] === "list") {
				ctx.ui.notify(
					"URL cache lives at .pi/context-tree/cache/urls. Use ls/find for detailed inspection.",
					"info",
				);
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
				const { bundle, rendered } = await resolveAndRender(
					ctx.cwd,
					targetPath,
					"session_spawn",
				);
				const parentSession = ctx.sessionManager.getSessionFile();
				await ctx.newSession({
					...(parentSession ? { parentSession } : {}),
					setup: async (sm) => {
						sm.appendCustomEntry("context-tree", {
							targetPath,
							operation: "session_spawn",
							bundleHash: bundle.bundleHash,
						});
						sm.appendCustomMessageEntry("context-tree", rendered, true, {
							targetPath,
							bundleHash: bundle.bundleHash,
						});
						sm.appendSessionInfo(`context-tree: ${targetPath}`);
					},
					withSession: async (newCtx) => {
						if (prompt) await newCtx.sendUserMessage(prompt);
					},
				});
				return;
			}

			if (command === "subagent") {
				ctx.ui.notify(
					"Subagent interop planned: install/use pi-subagents and resolve operation subagent_spawn via Context Tree bundle.",
					"warning",
				);
				return;
			}

			ctx.ui.notify(`Unknown context-tree command: ${command}`, "warning");
		},
	});
};

function toolOperation(toolName: string): Operation | undefined {
	if (
		["read", "edit", "write", "grep", "find", "ls", "bash"].includes(toolName)
	)
		return toolName as Operation;
	return undefined;
}

function toolTargetPath(toolName: string, input: unknown): string | undefined {
	if (!input || typeof input !== "object") return undefined;
	const record = input as Record<string, unknown>;
	if (typeof record.path === "string") return record.path;
	if (typeof record.pattern === "string" && typeof record.path === "string")
		return record.path;
	if (toolName === "bash" && typeof record.command === "string") {
		const paths = parsePromptPaths(record.command);
		return paths[0];
	}
	return undefined;
}

export default contextTree;
