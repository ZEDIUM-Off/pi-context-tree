export type {
	BranchingConfig,
	BudgetConfig,
	CacheConfig,
	ContextFile,
	ExtractConfig,
	HookGroup,
	HookName,
	InjectInput,
	InjectObject,
	InjectionItem,
	InjectionMode,
	InjectionRule,
	OnSelector,
	Operation,
	SourceDefinition,
	SourceOverride,
	StabilityConfig,
	StabilityState,
} from "./schema.js";
export {
	branchingSchema,
	budgetSchema,
	cacheSchema,
	contextFileSchema,
	defaultsSchema,
	extractSchema,
	fileInjectSchema,
	fileSourceDefinitionSchema,
	formatSchema,
	hookGroupSchema,
	hookNameSchema,
	injectObjectSchema,
	injectSchema,
	injectionItemSchema,
	injectionModeSchema,
	injectionRuleSchema,
	onSelectorSchema,
	pathAwareHookNames,
	pathAwareHooks,
	runtimeHookNames,
	runtimeHooks,
	sourceDefinitionSchema,
	sourceOverrideSchema,
	spawnHookNames,
	spawnHooks,
	stabilitySchema,
	stabilityStateSchema,
	toolHookNames,
	toolHooks,
	urlInjectSchema,
	urlSourceDefinitionSchema,
} from "./schema.js";

export type { ContextScope, ScanAllResult } from "./scan.js";
export { globalContextPath, scanAllContextTree, scanContextParents } from "./scan.js";
export { contextId, hookMatches, matchGlobs, matchScopedPatterns, operationMatches } from "./match.js";
export type { NormalizedSource, ResolvedOnEntry } from "./normalize.js";
export { dedupeSources, expandOnSelector, normalizeInject, resolveInjectionForHook } from "./normalize.js";
export { extractContent, extractLines, extractMarker, extractSection } from "./extract.js";
export type { Bundle, ExplainResult, LoadedSource, ScopeStability } from "./bundle.js";
export { buildBundle, explainHook, explainPath, formatExplain, formatMode, parsePromptPaths, renderBundle } from "./bundle.js";
