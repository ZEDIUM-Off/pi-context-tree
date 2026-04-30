import { minimatch } from "minimatch";
import type { ContextScope } from "./scan.js";
import type { HookName, InjectionRule } from "./schema.js";
import { sha256, stripAtPrefix, toPosix } from "./util.js";

export { sha256, stripAtPrefix, toPosix };

export function contextId(
	scope: Pick<ContextScope, "basePath">,
	block: {
		match?: readonly string[] | undefined;
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

function splitScopedPattern(pattern: string): { root: boolean; glob: string } {
	const raw = pattern.startsWith("!") ? pattern.slice(1) : pattern;
	const root = raw.startsWith("@");
	return { root, glob: normalizePattern(root ? raw.slice(1).replace(/^\//, "") : raw) };
}

export function matchScopedPatterns(input: { patterns: readonly string[]; relativeToScope: string; relativeToRoot: string }): boolean {
	const positives = input.patterns.filter((pattern) => !pattern.startsWith("!"));
	if (!positives.length) return false;
	const matches = (pattern: string): boolean => {
		const scoped = splitScopedPattern(pattern);
		return minimatch(scoped.root ? input.relativeToRoot : input.relativeToScope, scoped.glob, { dot: true });
	};
	return positives.some(matches) && !input.patterns.filter((p) => p.startsWith("!")).some(matches);
}

export function ruleMatchesPath(rule: Pick<InjectionRule, "match">, relativeToScope: string, relativeToRoot: string): boolean {
	return rule.match ? matchScopedPatterns({ patterns: rule.match, relativeToScope, relativeToRoot }) : false;
}
