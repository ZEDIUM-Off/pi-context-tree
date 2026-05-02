export type {
	Bundle,
	ExplainResult,
	LoadedSource,
	ScopeStability,
} from "./bundle/types.js";
export { buildBundle } from "./bundle/build.js";
export { explainHook, explainPath } from "./bundle/explain.js";
export { parsePromptFileReferences, parsePromptPaths } from "./bundle/prompt-paths.js";
export type { PromptFileReference } from "./bundle/prompt-paths.js";
export { formatExplain, formatMode, renderBundle } from "./bundle/render.js";
export { findNearestStability, stabilityMeaning } from "./bundle/stability.js";
