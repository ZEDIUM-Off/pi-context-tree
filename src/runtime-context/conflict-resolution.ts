import type { InjectionMode, MatchEntry } from "../schema.js";
import type { RuntimeInjectionParam } from "./injection-params-registry.js";
import type { ResourceKey } from "./resource-key.js";

export type ResolutionPriority = [number, number, number, number, number, number, number];

export type ResolutionConflict = {
	resourceKey: ResourceKey;
	winner: RuntimeInjectionParam;
	dropped: RuntimeInjectionParam[];
	reason: string;
	warning?: string;
};

type WinnerRecord = { param: RuntimeInjectionParam; priority: ResolutionPriority; duplicates: RuntimeInjectionParam[]; conflicts: RuntimeInjectionParam[]; warning?: string };

function modeKey(mode: InjectionMode): string {
	return JSON.stringify(mode);
}

export function representationKey(param: RuntimeInjectionParam): string {
	return JSON.stringify({ resourceKey: param.resourceKey, mode: param.mode, kind: param.kind, reason: param.reason, cache: param.cache, budget: param.budget });
}

function globSpecificity(pattern: string): number {
	const raw = pattern.replace(/^!/, "").replace(/^@\/?/, "").replace(/^\.\//, "");
	if (!/[{[*?]/.test(raw)) return 1000 + raw.length;
	const wildcardPenalty = (raw.match(/\*\*|[*?{]/g) ?? []).length * 50;
	return Math.max(1, raw.replace(/[!*?{}]/g, "").length - wildcardPenalty);
}

export function pathSpecificity(match?: readonly MatchEntry[]): number {
	if (!match) return 0;
	return Math.max(
		0,
		...match.map((entry) => {
			if (typeof entry === "string") return entry.startsWith("!") ? 0 : globSpecificity(entry);
			const files = Array.isArray(entry.files) ? entry.files : [entry.files];
			return Math.max(1, ...files.map(globSpecificity)) - 25;
		}),
	);
}

function hookSpecificity(kind: RuntimeInjectionParam["hookSelectorKind"]): number {
	return { override: 4, concrete: 3, array: 2, group: 1 }[kind];
}

export function priorityForParam(param: RuntimeInjectionParam): ResolutionPriority {
	return [param.scopeDepth, pathSpecificity(param.match), hookSpecificity(param.hookSelectorKind), param.ruleIndex, param.injectIndex, param.onIndex, param.order];
}

function comparePriority(left: ResolutionPriority, right: ResolutionPriority, includeOrder = true): number {
	const length = includeOrder ? left.length : left.length - 1;
	for (let index = 0; index < length; index++) {
		const delta = left[index]! - right[index]!;
		if (delta !== 0) return delta;
	}
	return 0;
}

function sameRepresentation(left: RuntimeInjectionParam, right: RuntimeInjectionParam): boolean {
	return representationKey(left) === representationKey(right) || (modeKey(left.mode) === modeKey(right.mode) && left.kind === right.kind && left.reason === right.reason && JSON.stringify(left.cache) === JSON.stringify(right.cache) && JSON.stringify(left.budget) === JSON.stringify(right.budget));
}

/** Selects one active representation per resource using nearest/specific/later precedence. */
export function resolveInjectionConflicts(candidates: readonly RuntimeInjectionParam[]): { selected: RuntimeInjectionParam[]; conflicts: ResolutionConflict[] } {
	const records = new Map<ResourceKey, WinnerRecord>();
	for (const param of candidates) {
		const priority = priorityForParam(param);
		const record = records.get(param.resourceKey);
		if (!record) {
			records.set(param.resourceKey, { param, priority, duplicates: [], conflicts: [] });
			continue;
		}
		if (sameRepresentation(record.param, param)) {
			record.duplicates.push(param);
			if (comparePriority(priority, record.priority) > 0) {
				record.duplicates.push(record.param);
				record.param = param;
				record.priority = priority;
			}
			continue;
		}
		const comparisonWithoutOrder = comparePriority(priority, record.priority, false);
		const comparison = comparisonWithoutOrder || comparePriority(priority, record.priority);
		if (comparison > 0) {
			record.conflicts.push(record.param, ...record.duplicates);
			record.param = param;
			record.priority = priority;
			record.duplicates = [];
		} else {
			record.conflicts.push(param);
		}
		if (comparisonWithoutOrder === 0) record.warning = `equal-priority conflict for ${param.resourceKey}; later order won deterministically`;
	}
	const selected = [...records.values()].map((record) => record.param).sort((a, b) => a.order - b.order);
	const conflicts = [...records.entries()]
		.filter(([, record]) => record.conflicts.length > 0)
		.map(([resourceKey, record]) => ({
			resourceKey,
			winner: record.param,
			dropped: record.conflicts,
			reason: record.warning ?? "selected by nearest/specific/later priority",
			...(record.warning ? { warning: record.warning } : {}),
		}));
	return { selected, conflicts };
}
