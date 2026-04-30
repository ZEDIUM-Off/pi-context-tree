import type { NormalizedSource } from "../normalize.js";
import type { ContextScope } from "../scan.js";
import type { HookBlock, HookName, StabilityConfig } from "../schema.js";

export type LoadedSource = NormalizedSource & {
	content?: string;
	sourceId: string;
	warnings: string[];
	cacheMeta?: unknown;
};

export type Bundle = {
	targetPath: string;
	operation: HookName;
	bundleHash: string;
	contextIds: string[];
	stability?: ScopeStability;
	sources: LoadedSource[];
	warnings: string[];
};

export type ScopeStability = {
	scope: ContextScope;
	config: StabilityConfig;
};

export type ExplainResult = {
	targetPath: string;
	operation: HookName;
	matched: Array<{
		scope: ContextScope;
		block: HookBlock;
		contextId: string;
	}>;
	sources: NormalizedSource[];
	stability?: ScopeStability;
	warnings: string[];
};
