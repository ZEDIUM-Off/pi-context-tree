import path from "node:path";
import { minimatch } from "minimatch";
import { grepFile, type GrepBackend } from "./grep.js";
import type { ContextScope } from "./scan.js";
import type { GrepMatch, HookName, InjectionRule, MatchEntry } from "./schema.js";
import { sha256, stripAtPrefix, toPosix } from "./util.js";

export { sha256, stripAtPrefix, toPosix };

export function contextId(
	scope: Pick<ContextScope, "basePath">,
	block: {
		match?: readonly MatchEntry[] | undefined;
		hook: HookName;
		source: string;
		ruleIndex: number;
		injectIndex: number;
	},
): string {
	return sha256(JSON.stringify({ basePath: scope.basePath, ...block, match: block.match ?? [] }));
}

export function hookMatches(hook: HookName, current: HookName): boolean {
	return hook === current;
}

export function operationMatches(operations: readonly HookName[], current: HookName): boolean {
	return operations.includes(current);
}

export function matchGlobs(patterns: string[], relativePath: string): boolean {
	const pos = patterns.filter((p) => !p.startsWith("!"));
	const neg = patterns.filter((p) => p.startsWith("!")).map((p) => p.slice(1));
	if (pos.length === 0) return false;
	return pos.some((p) => minimatch(relativePath, p, { dot: true })) && !neg.some((p) => minimatch(relativePath, p, { dot: true }));
}

function normalizePattern(pattern: string): string {
	return pattern.startsWith("./") ? pattern.slice(2) : pattern;
}

function splitScopedPattern(pattern: string): { negative: boolean; root: boolean; glob: string } {
	const negative = pattern.startsWith("!");
	const raw = negative ? pattern.slice(1) : pattern;
	const root = raw.startsWith("@");
	return { negative, root, glob: normalizePattern(root ? raw.slice(1).replace(/^\//, "") : raw) };
}

function scopedGlobMatches(pattern: string, relativeToScope: string, relativeToRoot: string): boolean {
	const scoped = splitScopedPattern(pattern);
	return minimatch(scoped.root ? relativeToRoot : relativeToScope, scoped.glob, { dot: true });
}

export function matchScopedPatterns(input: { patterns: readonly string[]; relativeToScope: string; relativeToRoot: string }): boolean {
	const positives = input.patterns.filter((pattern) => !pattern.startsWith("!"));
	if (!positives.length) return false;
	return positives.some((pattern) => scopedGlobMatches(pattern, input.relativeToScope, input.relativeToRoot)) && !input.patterns.filter((p) => p.startsWith("!")).some((pattern) => scopedGlobMatches(pattern, input.relativeToScope, input.relativeToRoot));
}

function asArray(value: string | string[]): string[] {
	return Array.isArray(value) ? value : [value];
}

function grepPatterns(value: string | string[]): { positive: string[]; negative: string[] } {
	const entries = asArray(value);
	return {
		positive: entries.filter((entry) => !entry.startsWith("!")),
		negative: entries.filter((entry) => entry.startsWith("!")).map((entry) => entry.slice(1)),
	};
}

function filesMatch(entry: GrepMatch, relativeToScope: string, relativeToRoot: string): boolean {
	return asArray(entry.files).some((pattern) => scopedGlobMatches(pattern, relativeToScope, relativeToRoot));
}

export type ScopedMatchResult = {
	matched: boolean;
	contentAware: boolean;
	warnings: string[];
};

export async function matchScopedEntries(input: {
	entries: readonly MatchEntry[];
	relativeToScope: string;
	relativeToRoot: string;
	absoluteTarget: string;
	grepBackend?: GrepBackend;
}): Promise<ScopedMatchResult> {
	let matchedPositive = false;
	let contentAware = false;
	const warnings: string[] = [];
	for (const entry of input.entries) {
		if (typeof entry === "string") {
			const scoped = splitScopedPattern(entry);
			const matched = scopedGlobMatches(entry, input.relativeToScope, input.relativeToRoot);
			if (scoped.negative && matched) return { matched: false, contentAware, warnings };
			if (!scoped.negative && matched) matchedPositive = true;
			continue;
		}
		contentAware = true;
		if (!filesMatch(entry, input.relativeToScope, input.relativeToRoot)) continue;
		const { positive, negative } = grepPatterns(entry.grep);
		let entryMatched = positive.length > 0;
		for (const pattern of positive) {
			const result = await grepFile({ file: input.absoluteTarget, pattern, ...(entry.maxBytes ? { maxBytes: entry.maxBytes } : {}), ...(input.grepBackend ? { backend: input.grepBackend } : {}) });
			if (result.warning) warnings.push(result.warning);
			if (!result.matched) {
				entryMatched = false;
				break;
			}
		}
		if (!entryMatched) continue;
		for (const pattern of negative) {
			const result = await grepFile({ file: input.absoluteTarget, pattern, ...(entry.maxBytes ? { maxBytes: entry.maxBytes } : {}), ...(input.grepBackend ? { backend: input.grepBackend } : {}) });
			if (result.warning) warnings.push(result.warning);
			if (result.matched) {
				entryMatched = false;
				break;
			}
		}
		if (entryMatched) matchedPositive = true;
	}
	return { matched: matchedPositive, contentAware, warnings };
}

export async function ruleMatchesPath(input: {
	rule: Pick<InjectionRule, "match">;
	relativeToScope: string;
	relativeToRoot: string;
	absoluteTarget: string;
	grepBackend?: GrepBackend;
}): Promise<ScopedMatchResult> {
	return input.rule.match
		? matchScopedEntries({ entries: input.rule.match, relativeToScope: input.relativeToScope, relativeToRoot: input.relativeToRoot, absoluteTarget: path.resolve(input.absoluteTarget), ...(input.grepBackend ? { grepBackend: input.grepBackend } : {}) })
		: { matched: false, contentAware: false, warnings: [] };
}
