import { z } from "zod";

export const hookNameSchema = z.enum([
	"session:start",
	"agent:start",
	"tool:read",
	"tool:edit",
	"tool:write",
	"tool:grep",
	"tool:find",
	"tool:ls",
	"tool:bash",
	"session:spawn",
	"subagent:spawn",
]);

export const runtimeHookNames = ["session:start", "agent:start"] as const;
export const toolHookNames = [
	"tool:read",
	"tool:edit",
	"tool:write",
	"tool:grep",
	"tool:find",
	"tool:ls",
	"tool:bash",
] as const;
export const spawnHookNames = ["session:spawn", "subagent:spawn"] as const;
export const pathAwareHookNames = [...toolHookNames, ...spawnHookNames] as const;

export const runtimeHooks = new Set<string>(runtimeHookNames);
export const toolHooks = new Set<string>(toolHookNames);
export const spawnHooks = new Set<string>(spawnHookNames);
export const pathAwareHooks = new Set<string>(pathAwareHookNames);
export const hookGroupSchema = z.enum(["runtime:*", "tool:*", "spawn:*", "path:*"]);
const hookOrGroupSchema = z.union([hookNameSchema, hookGroupSchema]);

export const cacheSchema = z
	.object({
		mode: z.enum(["ttl", "manual", "pinned", "latest"]).default("ttl"),
		ttl: z.string().default("14d"),
		fallback: z.enum(["stale", "error"]).default("stale"),
	})
	.partial();

export const budgetSchema = z.object({
	maxTokens: z.number().int().positive().optional(),
	perSourceMaxTokens: z.number().int().positive().optional(),
	priority: z.number().int().optional(),
});

const segmentSchema = z
	.object({
		marker: z.string().min(1).optional(),
		lines: z.string().min(1).optional(),
		section: z.string().min(1).optional(),
		note: z.string().optional(),
	})
	.refine((value) => [value.marker, value.lines, value.section].filter(Boolean).length === 1, {
		message: "segment must specify exactly one of marker, lines, section",
	});

export const extractSchema = z.object({
	sections: z.array(z.string().min(1)).optional(),
	lines: z.union([z.string().min(1), z.array(z.string().min(1))]).optional(),
	markers: z.array(z.string().min(1)).optional(),
	segments: z.array(segmentSchema).optional(),
	annotations: z.array(z.object({ target: z.string().min(1), note: z.string().min(1) })).optional(),
	maxTokens: z.number().int().positive().optional(),
});

export const formatSchema = z.object({ language: z.string().min(1).optional(), label: z.string().min(1).optional() }).strict();
const inlineModeSchema = z.object({ type: z.literal("inline"), format: formatSchema.optional() }).strict();
const refModeSchema = z.object({ type: z.literal("ref"), format: formatSchema.optional() }).strict();
const linesModeSchema = z.object({ type: z.literal("lines"), ranges: z.array(z.string().min(1)).min(1), format: formatSchema.optional() }).strict();
const sectionsModeSchema = z.object({ type: z.literal("sections"), names: z.array(z.string().min(1)).min(1), format: formatSchema.optional() }).strict();
const markersModeSchema = z.object({ type: z.literal("markers"), names: z.array(z.string().min(1)).min(1), format: formatSchema.optional() }).strict();
const segmentsModeSchema = z.object({ type: z.literal("segments"), items: z.array(segmentSchema).min(1), format: formatSchema.optional() }).strict();

export const injectionModeSchema = z.discriminatedUnion("type", [inlineModeSchema, refModeSchema, linesModeSchema, sectionsModeSchema, markersModeSchema, segmentsModeSchema]);

export const sourceOverrideSchema = z.object({
	kind: z.string().optional(),
	mode: injectionModeSchema.optional(),
	cache: cacheSchema.optional(),
	budget: budgetSchema.optional(),
	reason: z.string().optional(),
}).strict();
const onOverrideSchema = sourceOverrideSchema.extend({ hooks: z.array(hookOrGroupSchema).min(1) });

function expandedHooks(value: unknown): string[] {
	const expand = (entry: unknown): string[] => {
		if (typeof entry !== "string") return [];
		if (entry === "runtime:*") return [...runtimeHookNames];
		if (entry === "tool:*") return [...toolHookNames];
		if (entry === "spawn:*") return [...spawnHookNames];
		if (entry === "path:*") return [...pathAwareHookNames];
		return hookNameSchema.safeParse(entry).success ? [entry] : [];
	};
	if (typeof value === "string") return expand(value);
	if (!Array.isArray(value)) return [];
	return value.flatMap((entry) => typeof entry === "string" ? expand(entry) : (entry as { hooks?: unknown[] })?.hooks?.flatMap(expand) ?? []);
}
const hasDuplicateHook = (value: unknown): boolean => {
	const hooks = expandedHooks(value);
	return new Set(hooks).size !== hooks.length;
};

export const onSelectorSchema = z.union([hookOrGroupSchema, z.array(hookOrGroupSchema).min(1), z.array(onOverrideSchema).min(1)]).refine((value) => !hasDuplicateHook(value), {
	message: "on selector must not expand the same hook more than once",
});

export const fileInjectSchema = z.object({
	type: z.literal("file"), path: z.string().min(1), kind: z.string().optional(), mode: injectionModeSchema.default({ type: "ref" }), cache: cacheSchema.optional(), budget: budgetSchema.optional(), reason: z.string().optional(),
}).strict();
export const urlInjectSchema = z.object({
	type: z.literal("url"), url: z.string().url(), kind: z.string().optional(), mode: injectionModeSchema.default({ type: "ref" }), cache: cacheSchema.optional(), budget: budgetSchema.optional(), reason: z.string().optional(),
}).strict();
export const injectObjectSchema = z.discriminatedUnion("type", [fileInjectSchema, urlInjectSchema]);
export const injectSchema = z.union([z.string().min(1), injectObjectSchema]);
export const fileSourceDefinitionSchema = fileInjectSchema;
export const urlSourceDefinitionSchema = urlInjectSchema;
export const sourceDefinitionSchema = injectObjectSchema;

export const injectionItemSchema = sourceOverrideSchema.extend({ source: z.string().min(1), on: onSelectorSchema });
export const grepMatchSchema = z.object({
	files: z.union([z.string().min(1), z.array(z.string().min(1)).min(1)]),
	grep: z.union([z.string().min(1), z.array(z.string().min(1)).min(1)]),
	maxBytes: z.number().int().positive().optional(),
}).strict();
export const matchEntrySchema = z.union([z.string().min(1), grepMatchSchema]);
export const injectionRuleSchema = z.object({ match: z.array(matchEntrySchema).min(1).optional(), inject: z.array(injectionItemSchema).min(1) }).strict().superRefine((value, ctx) => {
	if (value.match && !value.match.some((entry) => typeof entry !== "string" || !entry.startsWith("!")))
		ctx.addIssue({ code: "custom", message: "match must contain at least one positive pattern", path: ["match"] });
	const allowed = value.match ? pathAwareHooks : runtimeHooks;
	const label = value.match ? "path-aware" : "runtime";
	for (const [index, item] of value.inject.entries())
		for (const hook of expandedHooks(item.on))
			if (!allowed.has(hook)) ctx.addIssue({ code: "custom", message: `${label} rule cannot use hook ${hook}`, path: ["inject", index, "on"] });
});

export const branchingSchema = z.object({ enabled: z.boolean().default(false), strategy: z.enum(["by_scope", "by_path", "by_context_id"]).default("by_scope"), summarizeOnLeave: z.enum(["ask", "always", "never"]).default("ask") });
export const defaultsSchema = z.object({ cache: cacheSchema.optional(), budget: budgetSchema.optional() });
export const stabilityStateSchema = z.enum(["canonical", "stable", "in_progress", "experimental", "deprecated", "generated"]);
export const stabilitySchema = z.object({ state: stabilityStateSchema, summary: z.string().min(1).max(500).optional(), updatedAt: z.string().min(1).optional(), updatedBy: z.string().min(1).max(80).optional(), until: z.string().min(1).max(300).optional() }).strict();

export const contextFileSchema = z.object({
	$schema: z.string().min(1),
	stability: stabilitySchema.optional(),
	defaults: defaultsSchema.optional(),
	sources: z.record(z.string().min(1), sourceDefinitionSchema).default({}),
	injection_rules: z.array(injectionRuleSchema).default([]),
	branching: branchingSchema.optional(),
	permissions: z.object({ scopeGuard: z.unknown().optional() }).passthrough().optional(),
	subagents: z.unknown().optional(),
}).strict().superRefine((value, ctx) => {
	for (const [ruleIndex, rule] of value.injection_rules.entries())
		for (const [injectIndex, item] of rule.inject.entries())
			if (!value.sources[item.source]) ctx.addIssue({ code: "custom", message: `unknown source id: ${item.source}`, path: ["injection_rules", ruleIndex, "inject", injectIndex, "source"] });
});

export type HookName = z.infer<typeof hookNameSchema>;
export type HookGroup = z.infer<typeof hookGroupSchema>;
export type OnSelector = z.infer<typeof onSelectorSchema>;
export type Operation = HookName;
export type CacheConfig = z.infer<typeof cacheSchema>;
export type BudgetConfig = z.infer<typeof budgetSchema>;
export type ExtractConfig = z.infer<typeof extractSchema>;
export type InjectionMode = z.infer<typeof injectionModeSchema>;
export type SourceOverride = z.infer<typeof sourceOverrideSchema>;
export type InjectObject = z.infer<typeof injectObjectSchema>;
export type SourceDefinition = z.infer<typeof sourceDefinitionSchema>;
export type InjectionItem = z.infer<typeof injectionItemSchema>;
export type GrepMatch = z.infer<typeof grepMatchSchema>;
export type MatchEntry = z.infer<typeof matchEntrySchema>;
export type InjectionRule = z.infer<typeof injectionRuleSchema>;
export type InjectInput = z.infer<typeof injectSchema>;
export type BranchingConfig = z.infer<typeof branchingSchema>;
export type StabilityState = z.infer<typeof stabilityStateSchema>;
export type StabilityConfig = z.infer<typeof stabilitySchema>;
export type ContextFile = z.infer<typeof contextFileSchema>;
