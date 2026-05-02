import path from "node:path";
import type { GrepBackend } from "../grep.js";
import { matchScopedEntries } from "../match.js";
import { stripAtPrefix, toPosix } from "../util.js";
import type { HookName } from "../schema.js";
import { type InjectionTrigger } from "./active-injection-registry.js";
import { resolveInjectionConflicts, representationKey, type ResolutionConflict } from "./conflict-resolution.js";
import type { RuntimeInjectionParam } from "./injection-params-registry.js";
import type { ResourceKey } from "./resource-key.js";

export type HookInvocation = {
	hook: HookName;
	target?: string;
	toolName?: string;
	toolCallId?: string;
	turnIndex?: number;
	trigger?: InjectionTrigger;
	promptReference?: string;
	synthetic?: boolean;
};

export type SkippedInjection = {
	resourceKey: ResourceKey;
	param: RuntimeInjectionParam;
	invocation: HookInvocation;
	reason: string;
};

export type ResolutionBatch = {
	invocations: HookInvocation[];
	candidates: RuntimeInjectionParam[];
	selected: RuntimeInjectionParam[];
	conflicts: ResolutionConflict[];
	skipped: SkippedInjection[];
	warnings: string[];
};

function targetPaths(invocations: readonly HookInvocation[], rootDir: string): Set<string> {
	return new Set(invocations.flatMap((invocation) => invocation.target ? [path.resolve(rootDir, stripAtPrefix(invocation.target))] : []));
}

function relativeToScope(target: string, param: RuntimeInjectionParam): string {
	return toPosix(path.relative(param.scopeDir, target));
}

function relativeToRoot(target: string, rootDir: string): string {
	return toPosix(path.relative(rootDir, target));
}

async function paramMatchesInvocation(input: { param: RuntimeInjectionParam; invocation: HookInvocation; rootDir: string; grepBackend?: GrepBackend }): Promise<{ matched: boolean; warnings: string[] }> {
	if (input.param.hook !== input.invocation.hook) return { matched: false, warnings: [] };
	if (!input.param.pathAware) return { matched: true, warnings: [] };
	if (!input.param.match || !input.invocation.target) return { matched: false, warnings: [] };
	const absoluteTarget = path.resolve(input.rootDir, stripAtPrefix(input.invocation.target));
	const result = await matchScopedEntries({
		entries: input.param.match,
		relativeToScope: relativeToScope(absoluteTarget, input.param),
		relativeToRoot: relativeToRoot(absoluteTarget, input.rootDir),
		absoluteTarget,
		...(input.grepBackend ? { grepBackend: input.grepBackend } : {}),
	});
	return { matched: result.matched, warnings: result.warnings };
}

/** Resolves one or many hook invocations using the same candidate/conflict algorithm. */
export async function resolveHookBatch(input: { params: readonly RuntimeInjectionParam[]; invocations: readonly HookInvocation[]; rootDir: string; grepBackend?: GrepBackend; explicitTargets?: readonly string[] }): Promise<ResolutionBatch> {
	const candidates: RuntimeInjectionParam[] = [];
	const skipped: SkippedInjection[] = [];
	const warnings: string[] = [];
	const seenRepresentations = new Set<string>();
	const batchTargets = targetPaths(input.invocations, input.rootDir);
	for (const target of input.explicitTargets ?? []) batchTargets.add(path.resolve(input.rootDir, stripAtPrefix(target)));
	for (const invocation of input.invocations) {
		for (const param of input.params) {
			const match = await paramMatchesInvocation({ param, invocation, rootDir: input.rootDir, ...(input.grepBackend ? { grepBackend: input.grepBackend } : {}) });
			warnings.push(...match.warnings);
			if (!match.matched) continue;
			if (param.resourceKey.startsWith("file:") && batchTargets.has(param.resourceKey.slice("file:".length))) {
				skipped.push({ resourceKey: param.resourceKey, param, invocation, reason: input.explicitTargets?.length ? "source file is explicitly referenced by user prompt" : "source file is also a target in this hook batch" });
				continue;
			}
			const key = representationKey(param);
			if (seenRepresentations.has(key)) continue;
			seenRepresentations.add(key);
			candidates.push(param);
		}
	}
	const resolved = resolveInjectionConflicts(candidates);
	return { invocations: [...input.invocations], candidates, selected: resolved.selected, conflicts: resolved.conflicts, skipped, warnings: [...warnings, ...resolved.conflicts.flatMap((conflict) => conflict.warning ? [conflict.warning] : [])] };
}
