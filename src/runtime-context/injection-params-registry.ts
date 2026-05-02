import type { ContextScope } from "../scan.js";
import { pathAwareHooks, runtimeHooks, type BudgetConfig, type CacheConfig, type HookName, type InjectionMode, type MatchEntry, type SourceOverride } from "../schema.js";
import { expandOnSelector, type ResolvedOnEntry } from "../normalize.js";
import { contextId } from "../match.js";
import { resourceKeyForSource, toConfigScopeRuntime } from "./resource-registry.js";
import type { ResourceKey } from "./resource-key.js";

export type HookSelectorKind = "concrete" | "group" | "array" | "override";

export type RuntimeInjectionParam = {
	paramId: string;
	resourceKey: ResourceKey;
	configPath: string;
	scopeDir: string;
	basePath: string;
	localSourceId: string;
	ruleIndex: number;
	injectIndex: number;
	onIndex: number;
	hook: HookName;
	hookSelectorKind: HookSelectorKind;
	match?: MatchEntry[];
	pathAware: boolean;
	kind?: string;
	reason?: string;
	mode: InjectionMode;
	cache?: CacheConfig;
	budget?: BudgetConfig;
	order: number;
	scopeDepth: number;
};

export type InjectionParamsRegistry = RuntimeInjectionParam[];

function mergeCache(...items: Array<CacheConfig | undefined>): CacheConfig | undefined {
	const merged = Object.assign({}, ...items.filter(Boolean)) as CacheConfig;
	return Object.keys(merged).length ? merged : undefined;
}

function mergeBudget(...items: Array<BudgetConfig | undefined>): BudgetConfig | undefined {
	const merged = Object.assign({}, ...items.filter(Boolean)) as BudgetConfig;
	return Object.keys(merged).length ? merged : undefined;
}

function selectorKind(on: unknown): HookSelectorKind {
	if (typeof on === "string") return on.includes(":*") ? "group" : "concrete";
	if (Array.isArray(on) && on.some((entry) => typeof entry !== "string")) return "override";
	return "array";
}

function scopeDepth(scope: ContextScope): number {
	if (scope.global) return -1;
	if (scope.basePath === "<root>") return 0;
	return scope.basePath.split("/").filter(Boolean).length;
}

function mergeParamValues(scope: ContextScope, localSourceId: string, injectIndex: number, ruleIndex: number, onEntry: ResolvedOnEntry): Pick<RuntimeInjectionParam, "kind" | "reason" | "mode" | "cache" | "budget"> | undefined {
	const rule = scope.config.injection_rules[ruleIndex];
	const inject = rule?.inject[injectIndex];
	const source = inject ? scope.config.sources[localSourceId] : undefined;
	if (!source || !inject) return undefined;
	const values: Pick<RuntimeInjectionParam, "kind" | "reason" | "mode" | "cache" | "budget"> = {
		mode: onEntry.mode ?? inject.mode ?? source.mode ?? { type: "ref" },
	};
	const kind = onEntry.kind ?? inject.kind ?? source.kind;
	const reason = onEntry.reason ?? inject.reason ?? source.reason;
	const cache = mergeCache(scope.config.defaults?.cache, source.cache, inject.cache, onEntry.cache);
	const budget = mergeBudget(scope.config.defaults?.budget, source.budget, inject.budget, onEntry.budget);
	if (kind !== undefined) values.kind = kind;
	if (reason !== undefined) values.reason = reason;
	if (cache !== undefined) values.cache = cache;
	if (budget !== undefined) values.budget = budget;
	return values;
}

/** Compiles all rule/inject/on combinations into hook-specific runtime injection params. */
export function buildInjectionParamsRegistry(scopes: readonly ContextScope[], rootDir: string): InjectionParamsRegistry {
	let order = 0;
	const params: RuntimeInjectionParam[] = [];
	for (const contextScope of scopes) {
		const scope = toConfigScopeRuntime(contextScope);
		for (const [ruleIndex, rule] of contextScope.config.injection_rules.entries()) {
			for (const [injectIndex, inject] of rule.inject.entries()) {
				const source = contextScope.config.sources[inject.source];
				if (!source) continue;
				for (const [onIndex, onEntry] of expandOnSelector(inject.on).entries()) {
					const merged = mergeParamValues(contextScope, inject.source, injectIndex, ruleIndex, onEntry);
					if (!merged) continue;
					const pathAware = Boolean(rule.match);
					const expected = pathAware ? pathAwareHooks : runtimeHooks;
					if (!expected.has(onEntry.hook)) continue;
					params.push({
						paramId: contextId(contextScope, { match: rule.match, hook: onEntry.hook, source: inject.source, ruleIndex, injectIndex }),
						resourceKey: resourceKeyForSource(source, scope, rootDir),
						configPath: scope.configPath,
						scopeDir: scope.scopeDir,
						basePath: scope.basePath,
						localSourceId: inject.source,
						ruleIndex,
						injectIndex,
						onIndex,
						hook: onEntry.hook,
						hookSelectorKind: selectorKind(inject.on),
						...(rule.match ? { match: [...rule.match] } : {}),
						pathAware,
						...merged,
						order: order++,
						scopeDepth: scopeDepth(contextScope),
					});
				}
			}
		}
	}
	return params;
}
