import { minimatch } from "minimatch";
import type { ContextScope } from "./scan.js";
import type { ContextBlock, Operation } from "./schema.js";
import { sha256, stripAtPrefix, toPosix } from "./util.js";

export { sha256, stripAtPrefix, toPosix };

export function contextId(
	scope: ContextScope,
	block: Pick<ContextBlock, "match" | "operations">,
): string {
	return sha256(
		JSON.stringify({
			basePath: scope.basePath,
			match: block.match,
			operations: [...block.operations].sort(),
		}),
	);
}

export function operationMatches(
	operations: Operation[],
	operation: Operation,
): boolean {
	return operations.includes("*") || operations.includes(operation);
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
