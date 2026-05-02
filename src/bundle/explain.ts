import path from "node:path";
import { contextId, ruleMatchesPath } from "../match.js";
import {
	dedupeSources,
	type NormalizedSource,
	normalizeInject,
	resolveInjectionForHook,
} from "../normalize.js";
import type { ContextScope } from "../scan.js";
import type { HookName } from "../schema.js";
import { stripAtPrefix, toPosix } from "../util.js";
import { findNearestStability } from "./stability.js";
import type { ExplainResult } from "./types.js";

export async function explainPath(
	cwd: string,
	scopes: ContextScope[],
	targetPath: string,
	operation: HookName = "agent:start",
): Promise<ExplainResult> {
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
		for (const [ruleIndex, rule] of scope.config.injection_rules.entries()) {
			if (rule.match) {
				const match = await ruleMatchesPath({
					rule,
					relativeToScope: relativeToScope || ".",
					relativeToRoot: relativeTarget || ".",
					absoluteTarget,
				});
				warnings.push(...match.warnings);
				if (!match.matched) continue;
			}
			for (const [injectIndex, item] of rule.inject.entries()) {
				const source = resolveInjectionForHook(scope, item, operation);
				if (!source) continue;
				const id = contextId(scope, {
					match: rule.match,
					hook: operation,
					source: item.source,
					ruleIndex,
					injectIndex,
				});
				matched.push({
					scope,
					rule,
					ruleIndex,
					injectIndex,
					source: item.source,
					hook: operation,
					contextId: id,
				});
				sources.push(
					normalizeInject(source, scope, id, {
						...(rule.match ? { ruleMatch: rule.match } : {}),
						sourceKey: item.source,
						hook: operation,
					}),
				);
			}
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
		for (const [ruleIndex, rule] of scope.config.injection_rules.entries()) {
			if (rule.match) continue;
			for (const [injectIndex, item] of rule.inject.entries()) {
				const source = resolveInjectionForHook(scope, item, operation);
				if (!source) continue;
				const id = contextId(scope, {
					hook: operation,
					source: item.source,
					ruleIndex,
					injectIndex,
				});
				matched.push({
					scope,
					rule,
					ruleIndex,
					injectIndex,
					source: item.source,
					hook: operation,
					contextId: id,
				});
				sources.push(
					normalizeInject(source, scope, id, {
						sourceKey: item.source,
						hook: operation,
					}),
				);
			}
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
