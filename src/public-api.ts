export type {
	BranchingConfig,
	BudgetConfig,
	CacheConfig,
	ContextFile,
	ExtractConfig,
	HookBlock,
	HookName,
	InjectInput,
	InjectObject,
	InjectionMode,
	Operation,
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
	formatSchema,
	hookBlockSchema,
	hookNameSchema,
	injectObjectSchema,
	injectSchema,
	injectionModeSchema,
	pathAwareHooks,
	pathlessHooks,
	stabilitySchema,
	stabilityStateSchema,
	urlInjectSchema,
} from "./schema.js";

export type { ContextScope, ScanAllResult } from "./scan.js";
export {
	globalContextPath,
	scanAllContextTree,
	scanContextParents,
} from "./scan.js";

export { contextId, hookMatches, matchGlobs, operationMatches } from "./match.js";

export type { NormalizedSource } from "./normalize.js";
export { dedupeSources, normalizeInject } from "./normalize.js";

export {
	extractContent,
	extractLines,
	extractMarker,
	extractSection,
} from "./extract.js";

export type {
	Bundle,
	ExplainResult,
	LoadedSource,
	ScopeStability,
} from "./bundle.js";
export {
	buildBundle,
	explainHook,
	explainPath,
	formatExplain,
	formatMode,
	parsePromptPaths,
	renderBundle,
} from "./bundle.js";
