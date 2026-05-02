import path from "node:path";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

import type { buildBundle } from "../bundle.js";
import { decideScopeAccess } from "../permissions.js";
import { updateActiveInjections } from "../runtime-context/active-injection-registry.js";
import { resolveHookBatch } from "../runtime-context/batch-resolver.js";
import { scanContextParents } from "../scan.js";
import type { HookName } from "../schema.js";
import type { TuiApi } from "../tui.js";
import type { RuntimeState } from "./state.js";
import { showActiveInjection } from "./state.js";
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

async function resolveAndActivate(
	state: RuntimeState,
	cwd: string,
	target: string,
	hook: HookName,
	trigger: "assistant_tool_call" | "assistant_tool_result",
	toolName?: string,
	toolCallId?: string,
) {
	const invocation = {
		hook,
		target,
		trigger,
		...(toolName ? { toolName } : {}),
		...(toolCallId ? { toolCallId } : {}),
	};
	const resolution = await resolveHookBatch({
		params: state.injectionParams,
		invocations: [invocation],
		rootDir: cwd,
	});
	state.resolutionHistory = [resolution, ...state.resolutionHistory].slice(
		0,
		50,
	);
	state.activeChanges = updateActiveInjections({
		registry: state.activeInjections,
		params: resolution.selected,
		hook,
		targets: [target],
		warnings: resolution.warnings,
		trace: {
			trigger,
			synthetic: false,
			...(toolName ? { toolName } : {}),
			...(toolCallId ? { toolCallId } : {}),
		},
	});
	return resolution;
}

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
		if (hook === "tool:edit" || hook === "tool:write") {
			const protocol = state.editSession
				? "Use ct_patch for authorized targets."
				: "Call ct_edit_request first with the intended target, then use ct_patch.";
			return {
				block: true,
				reason: `Context Tree remaps direct ${event.toolName} calls to its edit protocol. ${protocol}`,
			};
		}
		const resolution = await resolveAndActivate(
			state,
			ctx.cwd,
			target,
			hook,
			"assistant_tool_call",
			event.toolName,
			event.toolCallId,
		);
		showActiveInjection(state, ctx);
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
			await resolveAndActivate(
				state,
				ctx.cwd,
				target,
				"tool:read",
				"assistant_tool_result",
				event.toolName,
				event.toolCallId,
			);
			showActiveInjection(state, ctx);
			return undefined;
		} catch (error) {
			ctx.ui.notify(
				`Context Tree read context update failed for ${target}: ${error instanceof Error ? error.message : String(error)}`,
				"error",
			);
			return undefined;
		}
	});
}
