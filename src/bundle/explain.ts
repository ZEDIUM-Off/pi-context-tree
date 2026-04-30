import path from "node:path";
import { contextId, matchGlobs } from "../match.js";
import {
	dedupeSources,
	type NormalizedSource,
	normalizeInject,
} from "../normalize.js";
import type { ContextScope } from "../scan.js";
import type { HookName } from "../schema.js";
import { stripAtPrefix, toPosix } from "../util.js";
import { findNearestStability } from "./stability.js";
import type { ExplainResult } from "./types.js";

export function explainPath(
	cwd: string,
	scopes: ContextScope[],
	targetPath: string,
	operation: HookName = "agent:start",
): ExplainResult {
	const absoluteTarget = path.resolve(cwd, stripAtPrefix(targetPath));
	const relativeTarget = toPosix(path.relative(cwd, absoluteTarget));
	const matched: ExplainResult["matched"] = [];
	const sources: NormalizedSource[] = [];
	const warnings: string[] = [];

	for (const scope of scopes) {
		const relativeToScope = scope.global
			? relativeTarget || "."
			: toPosix(path.relative(scope.dir, absoluteTarget));
		if (!scope.global && relativeToScope.startsWith("..")) continue;
		for (const block of scope.config.hooks) {
			if (block.on !== operation) continue;
			if (block.match && !matchGlobs(block.match, relativeToScope || "."))
				continue;
			const id = contextId(scope, block);
			matched.push({ scope, block, contextId: id });
			for (const source of block.inject)
				sources.push(normalizeInject(source, scope, block, id));
		}
	}
	const stability = findNearestStability(scopes, absoluteTarget);
	return {
		targetPath: relativeTarget,
		operation,
		matched,
		sources: dedupeSources(sources),
		...(stability ? { stability } : {}),
		warnings,
	};
}

export function explainHook(
	_cwd: string,
	scopes: ContextScope[],
	operation: HookName,
): ExplainResult {
	const matched: ExplainResult["matched"] = [];
	const sources: NormalizedSource[] = [];
	const warnings: string[] = [];
	for (const scope of scopes) {
		for (const block of scope.config.hooks) {
			if (block.on !== operation) continue;
			if (block.match) continue;
			const id = contextId(scope, block);
			matched.push({ scope, block, contextId: id });
			for (const source of block.inject)
				sources.push(normalizeInject(source, scope, block, id));
		}
	}
	return {
		targetPath: `<${operation}>`,
		operation,
		matched,
		sources: dedupeSources(sources),
		warnings,
	};
}
