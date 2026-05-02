import { stat } from "node:fs/promises";
import path from "node:path";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { type buildBundle, parsePromptFileReferences, type PromptFileReference } from "../bundle.js";
import { updateActiveInjections } from "../runtime-context/active-injection-registry.js";
import {
	type HookInvocation,
	resolveHookBatch,
} from "../runtime-context/batch-resolver.js";
import type { RuntimeInjectionParam } from "../runtime-context/injection-params-registry.js";
import { ensureFileResource } from "../runtime-context/resource-registry.js";
import { stripAtPrefix, toPosix } from "../util.js";
import type { ContextScope } from "../scan.js";
import type { HookName } from "../schema.js";
import type { TuiApi } from "../tui.js";
import { contextMaintenanceSystemPrompt } from "./context-maintenance.js";
import type { RuntimeState } from "./state.js";
import { resetActiveRuntimeState, showActiveInjection, showStatus } from "./state.js";

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

async function existingPromptFileReferences(cwd: string, refs: readonly PromptFileReference[]): Promise<PromptFileReference[]> {
	const root = path.resolve(cwd);
	const existing: PromptFileReference[] = [];
	for (const ref of refs) {
		const absolute = path.resolve(root, stripAtPrefix(ref.path));
		if (absolute !== root && !absolute.startsWith(`${root}${path.sep}`)) continue;
		const info = await stat(absolute).catch(() => undefined);
		if (!info?.isFile()) continue;
		existing.push({ ...ref, path: toPosix(path.relative(root, absolute)) });
	}
	return existing;
}

function promptReferenceParam(cwd: string, ref: PromptFileReference, order: number): RuntimeInjectionParam {
	const absolute = path.resolve(cwd, stripAtPrefix(ref.path));
	return {
		paramId: `prompt-ref:${absolute}`,
		resourceKey: `file:${absolute}`,
		configPath: "<user-prompt>",
		scopeDir: cwd,
		basePath: "<prompt>",
		localSourceId: "<prompt-ref>",
		ruleIndex: -1,
		injectIndex: -1,
		onIndex: 0,
		hook: "agent:start",
		hookSelectorKind: "concrete",
		pathAware: false,
		kind: "prompt-file-reference",
		reason: "Explicitly referenced by user prompt",
		mode: { type: "inline" },
		order,
		scopeDepth: Number.MAX_SAFE_INTEGER,
	};
}

function activatePromptReferencedFiles(state: RuntimeState, cwd: string, refs: readonly PromptFileReference[]) {
	if (!refs.length) return [];
	const params = refs.map((ref, index) => {
		const absolute = path.resolve(cwd, stripAtPrefix(ref.path));
		ensureFileResource(state.resources, absolute);
		return promptReferenceParam(cwd, ref, Number.MAX_SAFE_INTEGER - refs.length + index);
	});
	return updateActiveInjections({
		registry: state.activeInjections,
		params,
		hook: "user:prompt-file",
		targets: refs.map((ref) => ref.path),
		trace: (param) => {
			const ref = refs.find((item) => `file:${path.resolve(cwd, stripAtPrefix(item.path))}` === param.resourceKey);
			return {
				trigger: "user_prompt_file_reference",
				hook: "user:prompt-file",
				synthetic: false,
				...(ref?.raw ? { promptReference: ref.raw } : {}),
				scopeDir: cwd,
				sourceId: "<prompt-ref>",
			};
		},
	});
}

export function registerLifecycleHandlers(
	pi: ExtensionAPI,
	state: RuntimeState,
	deps: LifecycleDeps,
): void {
	async function resolveAndActivate(
		cwd: string,
		invocations: HookInvocation[],
		explicitTargets: readonly string[] = [],
	) {
		const resolution = await resolveHookBatch({
			params: state.injectionParams,
			invocations,
			rootDir: cwd,
			...(explicitTargets.length ? { explicitTargets } : {}),
		});
		state.resolutionHistory = [resolution, ...state.resolutionHistory].slice(
			0,
			50,
		);
		const hook = invocations[0]?.hook ?? "session:start";
		const targets = invocations.flatMap((item) =>
			item.target ? [item.target] : [],
		);
		state.activeChanges = updateActiveInjections({
			registry: state.activeInjections,
			params: resolution.selected,
			hook,
			targets,
			warnings: resolution.warnings,
			trace: (param) => {
				const invocation = invocations.find((item) => item.hook === param.hook && (!param.pathAware || item.target));
				return {
					hook: invocation?.hook ?? hook,
					trigger: invocation?.trigger ?? (hook === "session:start" ? "session_start" : "user_prompt"),
					synthetic: invocation?.synthetic ?? false,
					targets: invocation?.target ? [invocation.target] : targets,
					...(invocation?.promptReference ? { promptReference: invocation.promptReference } : {}),
					...(invocation?.toolName ? { toolName: invocation.toolName } : {}),
					...(invocation?.toolCallId ? { toolCallId: invocation.toolCallId } : {}),
				};
			},
		});
		return resolution;
	}

	pi.on("session_start", async (_event, ctx) => {
		try {
			state.sessionContextInjected = false;
			resetActiveRuntimeState(state);
			await deps.reload(ctx.cwd);
			await resolveAndActivate(ctx.cwd, [{ hook: "session:start" }]);
			showActiveInjection(state, ctx);
		} catch (error) {
			ctx.ui.setStatus("context-tree", "context-tree error");
			ctx.ui.notify(
				error instanceof Error ? error.message : String(error),
				"error",
			);
		}
	});

	pi.on("input", async (event, ctx) => {
		if (!state.extensionEnabled) return { action: "continue" };
		if (event.source === "extension") return { action: "continue" };
		state.pendingPromptFileReferences = await existingPromptFileReferences(ctx.cwd, parsePromptFileReferences(event.text));
		return { action: "continue" };
	});

	pi.on("turn_start", async () => {
		if (!state.extensionEnabled) return;
		state.injectedThisTurn.clear();
	});

	pi.on("before_agent_start", async (event, ctx) => {
		if (!state.extensionEnabled) return;
		const systemPrompt =
			state.scopes.length > 0 &&
			!event.systemPrompt.includes("Context Tree active: repository contains")
				? `${event.systemPrompt}\n\n${contextMaintenanceSystemPrompt}`
				: event.systemPrompt;
		if (!state.sessionContextInjected) state.sessionContextInjected = true;
		const refs = state.pendingPromptFileReferences.length
			? state.pendingPromptFileReferences
			: await existingPromptFileReferences(ctx.cwd, parsePromptFileReferences(event.prompt));
		state.pendingPromptFileReferences = [];
		const paths = refs.map((ref) => ref.path);
		for (const target of paths) deps.maybeTrackBranch(ctx, ctx.cwd, target);
		const promptChanges = activatePromptReferencedFiles(state, ctx.cwd, refs);
		const invocations: HookInvocation[] = refs.length
			? [
				{ hook: "agent:start", trigger: "user_prompt" },
				...refs.map((ref): HookInvocation => ({ hook: "tool:read", target: ref.path, trigger: "user_prompt_file_reference", promptReference: ref.raw, synthetic: true })),
			]
			: [{ hook: "agent:start", trigger: "user_prompt" }];
		await resolveAndActivate(ctx.cwd, invocations, paths);
		state.activeChanges = [...promptChanges, ...state.activeChanges];
		showActiveInjection(state, ctx);
		return systemPrompt === event.systemPrompt ? undefined : { systemPrompt };
	});
}
