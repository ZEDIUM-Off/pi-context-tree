import path from "node:path";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { buildBundle, explainPath, renderBundle } from "../bundle.js";
import { registerCommands } from "../commands/register.js";
import { runInitWizard, submitInitPhase } from "../init/wizard.js";
import type { ExtensionContextLike } from "../pi/types.js";
import { scanAllContextTree, scanContextParents } from "../scan.js";
import type { HookName } from "../schema.js";
import { showDetailPanel, summarizeSession, type TuiApi } from "../tui.js";
import { phaseSubmitParameters } from "./init-tool-schema.js";
import { registerLifecycleHandlers } from "./lifecycle.js";
import {
	createRuntimeState,
	showStatus,
	statusText,
	tuiState,
} from "./state.js";
import { registerToolHooks } from "./tool-hooks.js";

const contextTree = (pi: ExtensionAPI) => {
	const state = createRuntimeState();

	async function reload(cwd: string) {
		const result = await scanAllContextTree(cwd);
		state.scopes = result.scopes;
		state.scanErrors = result.errors;
		return state.scopes;
	}

	async function resolveAndRender(cwd: string, target: string, hook: HookName) {
		const targetScopes = await scanContextParents(cwd, target);
		const explain = explainPath(cwd, targetScopes, target, hook);
		const bundle = await buildBundle(cwd, explain);
		return { explain, bundle, rendered: renderBundle(bundle) };
	}

	function maybeTrackBranch(ctx: { ui: TuiApi }, cwd: string, target: string) {
		const absolute = path.resolve(cwd, target);
		const scope = state.scopes
			.filter((s) => absolute.startsWith(s.dir))
			.sort((a, b) => b.dir.length - a.dir.length)[0];
		if (!scope?.config.branching?.enabled) return;
		const key =
			scope.config.branching.strategy === "by_path"
				? `path:${target}`
				: `scope:${scope.basePath}`;
		if (state.activeBranchKey === key) return;
		state.activeBranchKey = key;
		ctx.ui.notify(
			`Context Tree branch scope changed to ${key}. Use Pi /tree to navigate branches. Automatic leaf movement awaits Pi event-context navigation API.`,
			"warning",
		);
	}

	registerLifecycleHandlers(pi, state, {
		reload,
		resolveAndRender,
		maybeTrackBranch,
	});
	registerToolHooks(pi, state, {
		resolveAndRender,
		maybeTrackBranch,
	});

	async function showDetail(ctx: ExtensionContextLike) {
		state.currentCwd = ctx.cwd;
		state.lastSession = summarizeSession(ctx.sessionManager);
		return showDetailPanel(ctx, tuiState(state));
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
		showStatus: (ctx) => showStatus(state, ctx),
		statusText: () => statusText(state),
		showDetail,
		resolveAndRender,
		getScopes: () => state.scopes,
		getScanErrors: () => state.scanErrors,
		setTuiEnabled: (value) => {
			state.tuiEnabled = value;
		},
		setExtensionEnabled: (value) => {
			state.extensionEnabled = value;
		},
	});
};

export default contextTree;
