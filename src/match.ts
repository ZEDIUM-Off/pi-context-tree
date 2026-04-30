import { minimatch } from "minimatch";
import type { ContextScope } from "./scan.js";
import type { HookBlock, HookName } from "./schema.js";
import { sha256, stripAtPrefix, toPosix } from "./util.js";

export { sha256, stripAtPrefix, toPosix };

export function contextId(
	scope: Pick<ContextScope, "basePath">,
	block: { on: HookBlock["on"]; match?: readonly string[] | undefined },
): string {
	return sha256(
		JSON.stringify({
			basePath: scope.basePath,
			on: block.on,
			match: block.match ?? [],
		}),
	);
}

export function hookMatches(hook: HookName, current: HookName): boolean {
	return hook === current;
}

export function operationMatches(
	operations: readonly HookName[],
	current: HookName,
): boolean {
	return operations.includes(current);
}

export function matchGlobs(patterns: string[], relativePath: string): boolean {
	const pos = patterns.filter((p) => !p.startsWith("!"));
	const neg = patterns.filter((p) => p.startsWith("!")).map((p) => p.slice(1));
	if (pos.length === 0) return false;
	return (
		pos.some((p) => minimatch(relativePath, p, { dot: true })) &&
		!neg.some((p) => minimatch(relativePath, p, { dot: true }))
	);
}
