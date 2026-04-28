import path from "node:path";
import { StringEnum } from "@mariozechner/pi-ai";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type } from "typebox";
import {
	buildBundle,
	explainHook,
	explainPath,
	formatExplain,
	parsePromptPaths,
	renderBundle,
} from "./bundle.js";
import {
	reviewInitProposal,
	runInitWizard,
	submitInitPhase,
} from "./init/wizard.js";
import { decideScopeAccess } from "./permissions.js";
import {
	type ContextScope,
	scanAllContextTree,
	scanContextParents,
} from "./scan.js";
import type { HookName } from "./schema.js";
import {
	type detailText,
	type LastInjection,
	statusText as renderStatusText,
	renderTui,
	showDetailPanel,
	summarizeBundle,
	summarizeScopes,
	summarizeSession,
	type TuiApi,
} from "./tui.js";
import {
	applyUpgradePlan,
	formatUpgradePlan,
} from "./upgrade/apply-upgrade.js";
import { buildUpgradePlan } from "./upgrade/upgrade-plan.js";

const confidenceType = StringEnum(["high", "medium", "low"] as const);
const detectedTechType = Type.Object({
	id: Type.String({ description: "Stable id, e.g. typescript or shadcn-vue." }),
	name: Type.String({ description: "Human readable technology name." }),
	category: StringEnum([
		"language",
		"framework",
		"tool",
		"test",
		"build",
		"runtime",
	] as const),
	confidence: confidenceType,
	evidence: Type.Array(Type.String()),
	enabled: Type.Boolean(),
});
const modeProposalType = Type.Union([
	Type.Object({ type: StringEnum(["inline"] as const) }),
	Type.Object({ type: StringEnum(["ref"] as const) }),
	Type.Object({
		type: StringEnum(["lines"] as const),
		ranges: Type.Array(Type.String()),
	}),
	Type.Object({
		type: StringEnum(["sections"] as const),
		names: Type.Array(Type.String()),
	}),
	Type.Object({
		type: StringEnum(["markers"] as const),
		names: Type.Array(Type.String()),
	}),
]);
const ruleProposalType = Type.Object({
	path: Type.String(),
	title: Type.String(),
	kind: StringEnum(["skill", "rule", "doc"] as const),
	reason: Type.String(),
	mode: Type.Union([
		Type.Object({ type: StringEnum(["ref"] as const) }),
		Type.Object({
			type: StringEnum(["lines"] as const),
			ranges: Type.Array(Type.String()),
		}),
	]),
	enabled: Type.Boolean(),
});
const referenceProposalType = Type.Object({
	techId: Type.String(),
	scopePath: Type.String(),
	title: Type.String(),
	url: Type.String({ description: "context7:<libraryId> or URL." }),
	kind: StringEnum(["context7", "url"] as const),
	reason: Type.String(),
	query: Type.String(),
	libraryName: Type.String(),
	libraryId: Type.Optional(Type.String()),
	commands: Type.Array(Type.String()),
	enabled: Type.Boolean(),
});
const injectProposalType = Type.Union([
	Type.String({
		description: "Relative file path shorthand, e.g. ./docs/rules.md.",
	}),
	Type.Object({
		type: StringEnum(["file"] as const),
		path: Type.String(),
		kind: Type.Optional(Type.String()),
		mode: Type.Optional(modeProposalType),
		reason: Type.Optional(Type.String()),
	}),
	Type.Object({
		type: StringEnum(["url"] as const),
		url: Type.String({
			description:
				"Absolute http(s) URL only. For Context7 use https://context7.com/org/project.",
		}),
		kind: Type.Optional(Type.String()),
		mode: Type.Optional(modeProposalType),
		reason: Type.Optional(Type.String()),
	}),
]);
const hookProposalType = Type.Object({
	on: StringEnum([
		"session:start",
		"agent:start",
		"tool:read",
		"tool:edit",
		"tool:write",
		"tool:grep",
		"tool:find",
		"tool:ls",
		"tool:bash",
		"session:spawn",
		"subagent:spawn",
	] as const),
	match: Type.Optional(
		Type.Array(
			Type.String({
				description:
					"Required for tool:* and spawn hooks; forbidden for session:start and agent:start.",
			}),
		),
	),
	inject: Type.Array(injectProposalType),
});
const scopeProposalType = Type.Object({
	path: Type.String(),
	label: Type.String(),
	reason: Type.String(),
	confidence: confidenceType,
	enabled: Type.Boolean(),
	stability: Type.Object({
		state: StringEnum([
			"canonical",
			"stable",
			"in_progress",
			"experimental",
			"deprecated",
			"generated",
		] as const),
		summary: Type.String(),
	}),
	hooks: Type.Array(hookProposalType),
});
const phaseSubmitParameters = Type.Object({
	phase: StringEnum([
		"technology",
		"rules",
		"references",
		"scopes",
		"stability",
	] as const),
	technologies: Type.Optional(Type.Array(detectedTechType)),
	rules: Type.Optional(Type.Array(ruleProposalType)),
	references: Type.Optional(Type.Array(referenceProposalType)),
	scopes: Type.Optional(Type.Array(scopeProposalType)),
	notes: Type.Optional(Type.Array(Type.String())),
});

const hookNames = new Set<HookName>([
	"session:start",
	"agent:start",
	"tool:read",
	"tool:edit",
	"tool:write",
	"tool:grep",
	"tool:find",
	"tool:ls",
	"tool:bash",
	"session:spawn",
	"subagent:spawn",
]);

const contextMaintenanceSystemPrompt = `Context Tree active: repository contains hook-based CONTEXT.json routing files.

Context maintenance duties:
- Treat CONTEXT.json files as machine-readable hook contracts.
- Required sources are injected with path/url plus content. Optional sources are injected as path/url references with load commands.
- Keep hook matches narrow, explainable, and path-scoped when hook has a target path.
- Keep session:start hooks small and reference-first; avoid broad inline startup context.
- Keep codebase reference docs current when implementation, architecture, commands, tests, or domain rules change.
- When adding or moving files, update nearest CONTEXT.json hooks if context coverage changes.
- Do not inject AGENTS.md from CONTEXT.json; Pi loads it already.
- Use /ct-explain <path> <hook> when context coverage is unclear.`;

type CommandDeps = {
	reload: (cwd: string) => Promise<ContextScope[]>;
	showStatus: (ctx: { ui: TuiApi; sessionManager?: any }) => void;
	statusText: () => string;
	tuiState: () => Parameters<typeof detailText>[0];
	showDetail: (ctx: any) => Promise<void>;
	resolveAndRender: (
		cwd: string,
		target: string,
		hook: HookName,
	) => Promise<{
		bundle: Awaited<ReturnType<typeof buildBundle>>;
		rendered: string;
	}>;
	getScopes: () => ContextScope[];
	getScanErrors: () => Array<{ configPath: string; message: string }>;
	getLastInjection: () => LastInjection | undefined;
	setTuiEnabled: (value: boolean) => void;
	setExtensionEnabled: (value: boolean) => void;
};

const contextTree = (pi: ExtensionAPI) => {
	let scopes: ContextScope[] = [];
	let scanErrors: Array<{ configPath: string; message: string }> = [];
	let tuiEnabled = true;
	let extensionEnabled = true;
	const injectedThisTurn = new Set<string>();
	const preflightSatisfied = new Set<string>();
	let sessionContextInjected = false;
	let startupRendered = "";
	let lastInjection: LastInjection | undefined;
	let injectionHistory: LastInjection[] = [];
	let lastSession = summarizeSession({});
	let currentCwd = process.cwd();
	let activeBranchKey: string | undefined;

	function tuiState() {
		return {
			scopesValid: scopes.length,
			scopesInvalid: scanErrors.length,
			enabled: tuiEnabled && extensionEnabled,
			scopes: summarizeScopes(currentCwd, scopes, lastInjection),
			scanErrors,
			session: lastSession,
			injectionHistory,
			...(lastInjection ? { lastInjection } : {}),
		};
	}

	function statusText() {
		return renderStatusText(tuiState());
	}

	function showInjection(
		ctx: { ui: TuiApi; sessionManager?: any },
		cwd: string,
		bundle: Awaited<ReturnType<typeof buildBundle>>,
	) {
		currentCwd = cwd;
		if (ctx.sessionManager) lastSession = summarizeSession(ctx.sessionManager);
		lastInjection = summarizeBundle(cwd, bundle);
		injectionHistory = [lastInjection, ...injectionHistory].slice(0, 20);
		renderTui(ctx.ui, tuiState());
	}

	function showStatus(ctx: { ui: TuiApi; sessionManager?: any }) {
		if (ctx.sessionManager) lastSession = summarizeSession(ctx.sessionManager);
		renderTui(ctx.ui, tuiState());
	}

	async function reload(cwd: string) {
		const result = await scanAllContextTree(cwd);
		scopes = result.scopes;
		scanErrors = result.errors;
		return scopes;
	}

	async function resolveAndRender(cwd: string, target: string, hook: HookName) {
		const targetScopes = await scanContextParents(cwd, target);
		const explain = explainPath(cwd, targetScopes, target, hook);
		const bundle = await buildBundle(cwd, explain);
		return { explain, bundle, rendered: renderBundle(bundle) };
	}

	async function resolveStartup(cwd: string) {
		const explain = explainHook(cwd, scopes, "session:start");
		const bundle = await buildBundle(cwd, explain);
		return { explain, bundle, rendered: renderBundle(bundle) };
	}

	function maybeTrackBranch(ctx: { ui: TuiApi }, cwd: string, target: string) {
		const absolute = path.resolve(cwd, target);
		const scope = scopes
			.filter((s) => absolute.startsWith(s.dir))
			.sort((a, b) => b.dir.length - a.dir.length)[0];
		if (!scope?.config.branching?.enabled) return;
		const key =
			scope.config.branching.strategy === "by_path"
				? `path:${target}`
				: `scope:${scope.basePath}`;
		if (activeBranchKey === key) return;
		activeBranchKey = key;
		ctx.ui.notify(
			`Context Tree branch scope changed to ${key}. Use Pi /tree to navigate branches. Automatic leaf movement awaits Pi event-context navigation API.`,
			"warning",
		);
	}

	pi.on("session_start", async (_event, ctx) => {
		try {
			sessionContextInjected = false;
			startupRendered = "";
			await reload(ctx.cwd);
			const { bundle, rendered } = await resolveStartup(ctx.cwd);
			if (bundle.sources.length > 0) {
				startupRendered = rendered;
				showInjection(ctx, ctx.cwd, bundle);
			}
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
		if (!extensionEnabled) return;
		injectedThisTurn.clear();
	});

	pi.on("before_agent_start", async (event, ctx) => {
		if (!extensionEnabled) return;
		let systemPrompt =
			scopes.length > 0 &&
			!event.systemPrompt.includes("Context Tree active: repository contains")
				? `${event.systemPrompt}\n\n${contextMaintenanceSystemPrompt}`
				: event.systemPrompt;
		if (!sessionContextInjected) {
			sessionContextInjected = true;
			if (startupRendered)
				systemPrompt = `${systemPrompt}\n\n${startupRendered}`;
		}
		const paths = parsePromptPaths(event.prompt);
		const messages: string[] = [];
		for (const target of paths) {
			maybeTrackBranch(ctx, ctx.cwd, target);
			try {
				const { bundle, rendered } = await resolveAndRender(
					ctx.cwd,
					target,
					"agent:start",
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
			systemPrompt: `${systemPrompt}\n\n${messages.join("\n\n---\n\n")}`,
		};
	});

	pi.on("tool_call", async (event, ctx) => {
		if (!extensionEnabled) return;
		const target = toolTargetPath(event.toolName, event.input);
		if (!target) return;
		const hook = toolHook(event.toolName);
		if (!hook) return;
		maybeTrackBranch(ctx, ctx.cwd, target);
		const targetScopes = await scanContextParents(ctx.cwd, target);
		const explain = explainPath(ctx.cwd, targetScopes, target, hook);
		if (
			(hook === "tool:edit" || hook === "tool:write") &&
			explain.sources.length > 0
		) {
			const bundle = await buildBundle(ctx.cwd, explain);
			const key = `${target}:${hook}:${bundle.bundleHash}`;
			if (!preflightSatisfied.has(key)) {
				preflightSatisfied.add(key);
				injectedThisTurn.add(key);
				showInjection(ctx, ctx.cwd, bundle);
				pi.sendMessage(
					{
						customType: "context-tree",
						content: renderBundle(bundle),
						display: false,
					},
					{ deliverAs: "steer", triggerTurn: true },
				);
				return {
					block: true,
					reason: `Context Tree injected ${hook} context for ${target}. Retry after reading it.`,
				};
			}
		}
		const nearest = targetScopes.at(-1);
		const guard = nearest?.config.permissions?.scopeGuard;
		if (nearest && guard) {
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

	pi.on("tool_result", async (event, ctx) => {
		if (!extensionEnabled) return;
		if (event.toolName !== "read") return;
		const target = toolTargetPath(event.toolName, event.input);
		if (!target) return;
		try {
			const { bundle, rendered } = await resolveAndRender(
				ctx.cwd,
				target,
				"tool:read",
			);
			if (bundle.sources.length === 0) return;
			const key = `${target}:tool:read:${bundle.bundleHash}`;
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

	async function showDetail(ctx: any) {
		currentCwd = ctx.cwd;
		lastSession = summarizeSession(ctx.sessionManager);
		return showDetailPanel(ctx, tuiState());
	}

	pi.registerShortcut("alt+c", {
		description: "Show Context Tree injection details",
		handler: showDetail,
	});

	pi.registerTool({
		name: "ct_init_submit_phase",
		label: "Context Tree Init Phase",
		description:
			"Submit or patch exactly one Context Tree init phase, then resume the human review wizard.",
		promptSnippet:
			"Submit Context Tree init phase drafts with ct_init_submit_phase after phase-specific analysis.",
		promptGuidelines: [
			"Use ct_init_submit_phase when Context Tree init asks for a phase draft. Submit only the requested phase. Do not ask the user to paste slash commands.",
		],
		parameters: phaseSubmitParameters,
		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			await submitInitPhase(ctx, params);
			await runInitWizard(pi, ctx, true);
			return {
				content: [
					{
						type: "text",
						text: `Context Tree init ${params.phase} draft saved and human review resumed.`,
					},
				],
				details: { phase: params.phase, resumed: true },
			};
		},
	});

	registerCommands(pi, {
		reload,
		showStatus,
		statusText,
		tuiState,
		showDetail,
		resolveAndRender,
		getScopes: () => scopes,
		getScanErrors: () => scanErrors,
		getLastInjection: () => lastInjection,
		setTuiEnabled: (value) => {
			tuiEnabled = value;
		},
		setExtensionEnabled: (value) => {
			extensionEnabled = value;
		},
	});
};

function registerCommands(pi: ExtensionAPI, deps: CommandDeps) {
	const command = (
		name: string,
		description: string,
		handler: (args: string, ctx: any) => Promise<void> | void,
	) =>
		pi.registerCommand(name, {
			description,
			handler: async (args, ctx) => {
				await handler(args, ctx);
			},
		});
	command(
		"ct-status",
		"Show Context Tree scan status: valid/invalid CONTEXT.json count and last injection summary.",
		async (_args, ctx) =>
			ctx.ui.notify(
				deps.statusText(),
				deps.getScanErrors().length ? "warning" : "info",
			),
	);
	command(
		"ct-detail",
		"Open interactive Context Tree inspector with scopes, branch, injection stack, references, and warnings.",
		async (_args, ctx) => deps.showDetail(ctx),
	);
	const toggleTui = async (args: string, ctx: any) => {
		const mode = args.trim();
		if (mode !== "on" && mode !== "off")
			return ctx.ui.notify("Usage: /ct-tui on|off", "warning");
		deps.setTuiEnabled(mode === "on");
		deps.showStatus(ctx);
	};
	const toggleExtension = async (args: string, ctx: any) => {
		const mode = args.trim();
		if (mode !== "on" && mode !== "off")
			return ctx.ui.notify("Usage: /ct-toggle on|off", "warning");
		deps.setExtensionEnabled(mode === "on");
		deps.showStatus(ctx);
		ctx.ui.notify(`Context Tree extension ${mode}.`, "info");
	};
	command(
		"ct-tui",
		"Toggle Context Tree TUI widget only. Args: on|off.",
		toggleTui,
	);
	command(
		"ct-toggle",
		"Toggle entire Context Tree extension runtime. Args: on|off.",
		toggleExtension,
	);
	command(
		"ct-reload",
		"Reload all CONTEXT.json files and refresh Context Tree TUI status.",
		async (_args, ctx) => {
			await deps.reload(ctx.cwd);
			deps.showStatus(ctx);
			ctx.ui.notify(
				`Reloaded ${deps.getScopes().length} valid context scope(s), ${deps.getScanErrors().length} invalid.`,
				deps.getScanErrors().length ? "warning" : "info",
			);
		},
	);
	command(
		"ct-validate",
		"Validate all CONTEXT.json files and print valid/invalid paths. Args: optional path reserved.",
		async (_args, ctx) => {
			await deps.reload(ctx.cwd);
			const lines = [
				`Context Tree validation: ${deps.getScopes().length} valid, ${deps.getScanErrors().length} invalid.`,
			];
			for (const scope of deps.getScopes())
				lines.push(
					`- valid ${path.relative(ctx.cwd, scope.configPath) || "CONTEXT.json"}`,
				);
			for (const error of deps.getScanErrors())
				lines.push(
					`- invalid ${path.relative(ctx.cwd, error.configPath)}: ${error.message}`,
				);
			ctx.ui.notify(
				lines.join("\n"),
				deps.getScanErrors().length ? "error" : "info",
			);
		},
	);
	command(
		"ct-explain",
		"Explain matched hooks and sources for target. Args: <path> [hook], default hook agent:start.",
		async (args, ctx) => {
			const parts = args.trim().split(/\s+/).filter(Boolean);
			const maybeHook = parts.at(-1) as HookName | undefined;
			const hook =
				maybeHook && hookNames.has(maybeHook) ? maybeHook : "agent:start";
			const target = (hook === maybeHook ? parts.slice(0, -1) : parts).join(
				" ",
			);
			if (!target)
				return ctx.ui.notify("Usage: /ct-explain <path> [hook]", "warning");
			const targetScopes = await scanContextParents(ctx.cwd, target);
			ctx.ui.notify(
				formatExplain(
					ctx.cwd,
					explainPath(ctx.cwd, targetScopes, target, hook),
				),
				"info",
			);
		},
	);
	command(
		"ct-fetch",
		"Compile bundle for target and fetch/cache inline URL sources. Args: <path>.",
		async (args, ctx) => fetchCommand(args, ctx, deps),
	);
	command(
		"ct-cache-refresh",
		"Refresh cached URL sources for target bundle. Args: <path>.",
		async (args, ctx) => fetchCommand(args, ctx, deps),
	);
	command(
		"ct-cache-list",
		"Show Context Tree URL cache directory.",
		async (_args, ctx) =>
			ctx.ui.notify(
				"URL cache lives at .pi/context-tree/cache/urls. Use ls/find for detailed inspection.",
				"info",
			),
	);
	command(
		"ct-new",
		"Create new Pi session seeded with session:spawn bundle. Args: <path> [prompt].",
		async (args, ctx) => {
			const [targetPath, ...promptParts] = args
				.trim()
				.split(/\s+/)
				.filter(Boolean);
			const prompt = promptParts.join(" ");
			if (!targetPath)
				return ctx.ui.notify("Usage: /ct-new <path> [prompt]", "warning");
			await ctx.waitForIdle();
			const { bundle, rendered } = await deps.resolveAndRender(
				ctx.cwd,
				targetPath,
				"session:spawn",
			);
			const parentSession = ctx.sessionManager.getSessionFile();
			await ctx.newSession({
				...(parentSession ? { parentSession } : {}),
				setup: async (sm: any) => {
					sm.appendCustomEntry("context-tree", {
						targetPath,
						hook: "session:spawn",
						bundleHash: bundle.bundleHash,
					});
					sm.appendCustomMessageEntry("context-tree", rendered, false, {
						targetPath,
						bundleHash: bundle.bundleHash,
					});
					sm.appendSessionInfo(`context-tree: ${targetPath}`);
				},
				withSession: async (newCtx: any) => {
					if (prompt) await newCtx.sendUserMessage(prompt);
				},
			});
		},
	);
	command(
		"ct-schema-status",
		"Show schema refs and upgrade status for all CONTEXT.json files.",
		async (_args, ctx) => {
			const plan = await buildUpgradePlan(ctx.cwd, "0.2.0");
			ctx.ui.notify(
				formatUpgradePlan(ctx.cwd, plan),
				plan.some((item) => item.status === "invalid") ? "error" : "info",
			);
		},
	);
	command(
		"ct-upgrade-plan",
		"Preview CONTEXT.json schema migrations without writing.",
		async (_args, ctx) => {
			const plan = await buildUpgradePlan(ctx.cwd, "0.2.0");
			ctx.ui.notify(formatUpgradePlan(ctx.cwd, plan), "info");
		},
	);
	command(
		"ct-upgrade",
		"Migrate CONTEXT.json files to current required $schema contract after confirmation.",
		async (_args, ctx) => {
			const plan = await buildUpgradePlan(ctx.cwd, "0.2.0");
			const actionable = plan.filter((item) => item.after);
			if (actionable.length === 0)
				return ctx.ui.notify("No schema upgrade needed.", "info");
			const ok = await ctx.ui.confirm?.(
				"Apply Context Tree schema upgrade?",
				formatUpgradePlan(ctx.cwd, plan),
			);
			if (!ok) return;
			const count = await applyUpgradePlan(plan);
			await deps.reload(ctx.cwd);
			ctx.ui.notify(`Upgraded ${count} CONTEXT.json file(s).`, "info");
		},
	);
	command(
		"ct-init",
		"Initialize Context Tree for current codebase with editable TUI loops and agent feedback. Args: [--resume].",
		async (args, ctx) => runInitWizard(pi, ctx, args.includes("--resume")),
	);
	command(
		"ct-init-review",
		"Review and persist an agent init proposal in current init session. Args: proposal text/JSON.",
		async (args, ctx) => reviewInitProposal(ctx, args),
	);
	command(
		"ct-subagent",
		"Planned subagent handoff using subagent:spawn hook. Args: <path> <task>.",
		async (_args, ctx) =>
			ctx.ui.notify(
				"Subagent interop planned: resolve hook subagent:spawn via Context Tree bundle.",
				"warning",
			),
	);
}

async function fetchCommand(args: string, ctx: any, deps: CommandDeps) {
	const target = args.trim();
	if (!target) return ctx.ui.notify("Usage: /ct-fetch <path>", "warning");
	const { bundle } = await deps.resolveAndRender(
		ctx.cwd,
		target,
		"agent:start",
	);
	ctx.ui.notify(
		`Fetched/compiled ${bundle.sources.length} source(s). Bundle ${bundle.bundleHash.slice(0, 12)}.`,
		"info",
	);
}

function toolHook(toolName: string): HookName | undefined {
	if (
		["read", "edit", "write", "grep", "find", "ls", "bash"].includes(toolName)
	)
		return `tool:${toolName}` as HookName;
	return undefined;
}

function toolTargetPath(toolName: string, input: unknown): string | undefined {
	if (!input || typeof input !== "object") return undefined;
	const record = input as Record<string, unknown>;
	if (typeof record.path === "string") return record.path;
	if (typeof record.pattern === "string" && typeof record.path === "string")
		return record.path;
	if (toolName === "bash" && typeof record.command === "string")
		return parsePromptPaths(record.command)[0];
	return undefined;
}

export default contextTree;
