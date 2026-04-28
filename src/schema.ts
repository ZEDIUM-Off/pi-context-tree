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

export const pathAwareHooks = new Set<string>([
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

export const pathlessHooks = new Set<string>(["session:start", "agent:start"]);

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
	.refine(
		(value) =>
			[value.marker, value.lines, value.section].filter(Boolean).length === 1,
		{
			message: "segment must specify exactly one of marker, lines, section",
		},
	);

export const extractSchema = z.object({
	sections: z.array(z.string().min(1)).optional(),
	lines: z.union([z.string().min(1), z.array(z.string().min(1))]).optional(),
	markers: z.array(z.string().min(1)).optional(),
	segments: z.array(segmentSchema).optional(),
	annotations: z
		.array(
			z.object({
				target: z.string().min(1),
				note: z.string().min(1),
			}),
		)
		.optional(),
	maxTokens: z.number().int().positive().optional(),
});

export const formatSchema = z
	.object({
		language: z.string().min(1).optional(),
		label: z.string().min(1).optional(),
	})
	.strict();

const inlineModeSchema = z
	.object({
		type: z.literal("inline"),
		format: formatSchema.optional(),
	})
	.strict();

const refModeSchema = z
	.object({
		type: z.literal("ref"),
		format: formatSchema.optional(),
	})
	.strict();

const linesModeSchema = z
	.object({
		type: z.literal("lines"),
		ranges: z.array(z.string().min(1)).min(1),
		format: formatSchema.optional(),
	})
	.strict();

const sectionsModeSchema = z
	.object({
		type: z.literal("sections"),
		names: z.array(z.string().min(1)).min(1),
		format: formatSchema.optional(),
	})
	.strict();

const markersModeSchema = z
	.object({
		type: z.literal("markers"),
		names: z.array(z.string().min(1)).min(1),
		format: formatSchema.optional(),
	})
	.strict();

const segmentsModeSchema = z
	.object({
		type: z.literal("segments"),
		items: z.array(segmentSchema).min(1),
		format: formatSchema.optional(),
	})
	.strict();

export const injectionModeSchema = z.discriminatedUnion("type", [
	inlineModeSchema,
	refModeSchema,
	linesModeSchema,
	sectionsModeSchema,
	markersModeSchema,
	segmentsModeSchema,
]);

export const fileInjectSchema = z
	.object({
		type: z.literal("file"),
		path: z.string().min(1),
		kind: z.string().optional(),
		mode: injectionModeSchema.default({ type: "ref" }),
		cache: cacheSchema.optional(),
		budget: budgetSchema.optional(),
		reason: z.string().optional(),
	})
	.strict();

export const urlInjectSchema = z
	.object({
		type: z.literal("url"),
		url: z.string().url(),
		kind: z.string().optional(),
		mode: injectionModeSchema.default({ type: "ref" }),
		cache: cacheSchema.optional(),
		budget: budgetSchema.optional(),
		reason: z.string().optional(),
	})
	.strict();

export const injectObjectSchema = z.discriminatedUnion("type", [
	fileInjectSchema,
	urlInjectSchema,
]);
export const injectSchema = z.union([z.string().min(1), injectObjectSchema]);

export const hookBlockSchema = z
	.object({
		on: hookNameSchema,
		match: z.array(z.string().min(1)).min(1).optional(),
		inject: z.array(injectSchema).min(1),
		cache: cacheSchema.optional(),
		budget: budgetSchema.optional(),
		agents: z.array(z.string().min(1)).optional(),
	})
	.refine((value) => !pathAwareHooks.has(value.on) || value.match, {
		message: "path-aware hooks require match[]",
		path: ["match"],
	})
	.refine((value) => !pathlessHooks.has(value.on) || !value.match, {
		message: "pathless hooks must not define match[]",
		path: ["match"],
	})
	.refine(
		(value) =>
			!value.match || value.match.some((pattern) => !pattern.startsWith("!")),
		{
			message: "match must contain at least one positive glob",
			path: ["match"],
		},
	);

export const branchingSchema = z.object({
	enabled: z.boolean().default(false),
	strategy: z
		.enum(["by_scope", "by_path", "by_context_id"])
		.default("by_scope"),
	summarizeOnLeave: z.enum(["ask", "always", "never"]).default("ask"),
});

export const defaultsSchema = z.object({
	cache: cacheSchema.optional(),
	budget: budgetSchema.optional(),
});

export const stabilityStateSchema = z.enum([
	"canonical",
	"stable",
	"in_progress",
	"experimental",
	"deprecated",
	"generated",
]);

export const stabilitySchema = z
	.object({
		state: stabilityStateSchema,
		summary: z.string().min(1).max(500).optional(),
		updatedAt: z.string().min(1).optional(),
		updatedBy: z.string().min(1).max(80).optional(),
		until: z.string().min(1).max(300).optional(),
	})
	.strict();

export const contextFileSchema = z
	.object({
		$schema: z.string().min(1),
		stability: stabilitySchema.optional(),
		defaults: defaultsSchema.optional(),
		hooks: z.array(hookBlockSchema).default([]),
		branching: branchingSchema.optional(),
		permissions: z.any().optional(),
		subagents: z.any().optional(),
	})
	.strict();

export type HookName = z.infer<typeof hookNameSchema>;
export type Operation = HookName;
export type CacheConfig = z.infer<typeof cacheSchema>;
export type BudgetConfig = z.infer<typeof budgetSchema>;
export type ExtractConfig = z.infer<typeof extractSchema>;
export type InjectionMode = z.infer<typeof injectionModeSchema>;
export type InjectObject = z.infer<typeof injectObjectSchema>;
export type InjectInput = z.infer<typeof injectSchema>;
export type HookBlock = z.infer<typeof hookBlockSchema>;
export type ContextBlock = HookBlock;
export type BranchingConfig = z.infer<typeof branchingSchema>;
export type StabilityState = z.infer<typeof stabilityStateSchema>;
export type StabilityConfig = z.infer<typeof stabilitySchema>;
export type ContextFile = z.infer<typeof contextFileSchema>;
export type { HookName as ContextOperation };
