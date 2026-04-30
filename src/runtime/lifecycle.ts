import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import {
	buildBundle,
	explainHook,
	parsePromptPaths,
	renderBundle,
} from "../bundle.js";
import type { ContextScope } from "../scan.js";
import type { HookName } from "../schema.js";
import type { TuiApi } from "../tui.js";
import { contextMaintenanceSystemPrompt } from "./context-maintenance.js";
import type { RuntimeState } from "./state.js";
import { showInjection, showStatus } from "./state.js";

export type LifecycleDeps = {
	reload: (cwd: string) => Promise<ContextScope[]>;
	resolveAndRender: (
		cwd: string,
		target: string,
		hook: HookName,
	) => Promise<{
		bundle: Awaited<ReturnType<typeof buildBundle>>;
		rendered: string;
	}>;
	maybeTrackBranch: (ctx: { ui: TuiApi }, cwd: string, target: string) => void;
};

export function registerLifecycleHandlers(
	pi: ExtensionAPI,
	state: RuntimeState,
	deps: LifecycleDeps,
): void {
	async function resolveStartup(cwd: string) {
		const explain = explainHook(cwd, state.scopes, "session:start");
		const bundle = await buildBundle(cwd, explain);
		return { explain, bundle, rendered: renderBundle(bundle) };
	}

	pi.on("session_start", async (_event, ctx) => {
		try {
			state.sessionContextInjected = false;
			state.startupRendered = "";
			await deps.reload(ctx.cwd);
			const { bundle, rendered } = await resolveStartup(ctx.cwd);
			if (bundle.sources.length > 0) {
				state.startupRendered = rendered;
				showInjection(state, ctx, ctx.cwd, bundle);
			}
			showStatus(state, ctx);
		} catch (error) {
			ctx.ui.setStatus("context-tree", "context-tree error");
			ctx.ui.notify(
				error instanceof Error ? error.message : String(error),
				"error",
			);
		}
	});

	pi.on("turn_start", async () => {
		if (!state.extensionEnabled) return;
		state.injectedThisTurn.clear();
	});

	pi.on("before_agent_start", async (event, ctx) => {
		if (!state.extensionEnabled) return;
		let systemPrompt =
			state.scopes.length > 0 &&
			!event.systemPrompt.includes("Context Tree active: repository contains")
				? `${event.systemPrompt}\n\n${contextMaintenanceSystemPrompt}`
				: event.systemPrompt;
		if (!state.sessionContextInjected) {
			state.sessionContextInjected = true;
			if (state.startupRendered)
				systemPrompt = `${systemPrompt}\n\n${state.startupRendered}`;
		}
		const paths = parsePromptPaths(event.prompt);
		const messages: string[] = [];
		for (const target of paths) {
			deps.maybeTrackBranch(ctx, ctx.cwd, target);
			try {
				const { bundle, rendered } = await deps.resolveAndRender(
					ctx.cwd,
					target,
					"agent:start",
				);
				if (bundle.sources.length === 0) continue;
				const key = `${target}:${bundle.bundleHash}`;
				if (state.injectedThisTurn.has(key)) continue;
				state.injectedThisTurn.add(key);
				showInjection(state, ctx, ctx.cwd, bundle);
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
}
