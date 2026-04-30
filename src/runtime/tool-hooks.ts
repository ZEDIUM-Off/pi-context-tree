import path from "node:path";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { buildBundle, explainPath, renderBundle } from "../bundle.js";
import { decideScopeAccess } from "../permissions.js";
import { scanContextParents } from "../scan.js";
import type { HookName } from "../schema.js";
import type { TuiApi } from "../tui.js";
import type { RuntimeState } from "./state.js";
import { showInjection } from "./state.js";
import { toolHook, toolTargetPath } from "./tool-target.js";

export type ToolHookDeps = {
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

export function registerToolHooks(
	pi: ExtensionAPI,
	state: RuntimeState,
	deps: ToolHookDeps,
): void {
	pi.on("tool_call", async (event, ctx) => {
		if (!state.extensionEnabled) return;
		const target = toolTargetPath(event.toolName, event.input);
		if (!target) return;
		const hook = toolHook(event.toolName);
		if (!hook) return;
		deps.maybeTrackBranch(ctx, ctx.cwd, target);
		const targetScopes = await scanContextParents(ctx.cwd, target);
		const explain = explainPath(ctx.cwd, targetScopes, target, hook);
		if (
			(hook === "tool:edit" || hook === "tool:write") &&
			explain.sources.length > 0
		) {
			const bundle = await buildBundle(ctx.cwd, explain);
			const key = `${target}:${hook}:${bundle.bundleHash}`;
			if (!state.preflightSatisfied.has(key)) {
				state.preflightSatisfied.add(key);
				state.injectedThisTurn.add(key);
				showInjection(state, ctx, ctx.cwd, bundle);
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
		if (!state.extensionEnabled) return;
		if (event.toolName !== "read") return;
		const target = toolTargetPath(event.toolName, event.input);
		if (!target) return;
		try {
			const { bundle, rendered } = await deps.resolveAndRender(
				ctx.cwd,
				target,
				"tool:read",
			);
			if (bundle.sources.length === 0) return;
			const key = `${target}:tool:read:${bundle.bundleHash}`;
			if (state.injectedThisTurn.has(key)) return;
			state.injectedThisTurn.add(key);
			showInjection(state, ctx, ctx.cwd, bundle);
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
}
