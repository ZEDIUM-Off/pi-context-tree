import type { HookName } from "../schema.js";
import { representationKey } from "./conflict-resolution.js";
import type { RuntimeInjectionParam } from "./injection-params-registry.js";
import type { ResourceKey } from "./resource-key.js";

export type ActiveInjectionAction = "inserted" | "moved" | "replaced-mode" | "replaced-params" | "unchanged";

export type InjectionTrigger = "session_start" | "user_prompt" | "user_prompt_file_reference" | "assistant_tool_call" | "assistant_tool_result";

export type ActiveInjectionTrace = {
	trigger: InjectionTrigger;
	hook: HookName | "user:prompt-file";
	synthetic: boolean;
	targets: string[];
	promptReference?: string;
	toolName?: string;
	toolCallId?: string;
	configPath?: string;
	scopeDir?: string;
	ruleIndex?: number;
	injectIndex?: number;
	sourceId?: string;
	reason?: string;
};

export type ActiveInjection = {
	resourceKey: ResourceKey;
	param: RuntimeInjectionParam;
	action: ActiveInjectionAction;
	lastHook: HookName | "user:prompt-file";
	lastTargets: string[];
	invokedAt: number;
	invocationCount: number;
	previousParam?: RuntimeInjectionParam;
	warnings: string[];
	trace: ActiveInjectionTrace;
};

export type ActiveInjectionRegistry = {
	entries: Map<ResourceKey, ActiveInjection>;
	order: ResourceKey[];
};

export function createActiveInjectionRegistry(): ActiveInjectionRegistry {
	return { entries: new Map(), order: [] };
}

function moveToTop(order: ResourceKey[], key: ResourceKey): ResourceKey[] {
	return [...order.filter((item) => item !== key), key];
}

function replacementAction(previous: RuntimeInjectionParam, next: RuntimeInjectionParam): ActiveInjectionAction {
	if (representationKey(previous) === representationKey(next)) return "moved";
	return JSON.stringify(previous.mode) !== JSON.stringify(next.mode) ? "replaced-mode" : "replaced-params";
}

/** Inserts, moves, or replaces a resource representation while keeping one active entry per resource. */
export function updateActiveInjections(input: {
	registry: ActiveInjectionRegistry;
	params: readonly RuntimeInjectionParam[];
	hook: HookName | "user:prompt-file";
	targets?: readonly string[];
	invokedAt?: number;
	warnings?: readonly string[];
	trace?: Partial<ActiveInjectionTrace> | ((param: RuntimeInjectionParam) => Partial<ActiveInjectionTrace>);
}): ActiveInjection[] {
	const changed: ActiveInjection[] = [];
	const invokedAt = input.invokedAt ?? Date.now();
	for (const param of input.params) {
		const previous = input.registry.entries.get(param.resourceKey);
		const action: ActiveInjectionAction = previous ? replacementAction(previous.param, param) : "inserted";
		const tracePatch = typeof input.trace === "function" ? input.trace(param) : input.trace;
		const next: ActiveInjection = {
			resourceKey: param.resourceKey,
			param,
			action,
			lastHook: input.hook,
			lastTargets: [...(input.targets ?? [])],
			invokedAt,
			invocationCount: (previous?.invocationCount ?? 0) + 1,
			...(previous && action !== "moved" ? { previousParam: previous.param } : {}),
			warnings: [...(input.warnings ?? [])],
			trace: {
				trigger: "user_prompt",
				hook: input.hook,
				synthetic: false,
				targets: [...(input.targets ?? [])],
				configPath: param.configPath,
				scopeDir: param.scopeDir,
				ruleIndex: param.ruleIndex,
				injectIndex: param.injectIndex,
				sourceId: param.localSourceId,
				...(param.reason ? { reason: param.reason } : {}),
				...tracePatch,
			},
		};
		input.registry.entries.set(param.resourceKey, next);
		input.registry.order = moveToTop(input.registry.order, param.resourceKey);
		changed.push(next);
	}
	return changed;
}

export function activeInjectionStack(registry: ActiveInjectionRegistry): ActiveInjection[] {
	return registry.order.map((key) => registry.entries.get(key)).filter((entry): entry is ActiveInjection => Boolean(entry));
}
