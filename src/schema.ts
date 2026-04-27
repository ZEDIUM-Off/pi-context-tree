import { z } from "zod";

export const operationSchema = z.enum([
	"*",
	"agent_start",
	"read",
	"edit",
	"write",
	"grep",
	"find",
	"ls",
	"bash",
	"session_spawn",
	"subagent_spawn",
]);

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

export const fileInjectSchema = z.object({
	type: z.literal("file"),
	path: z.string().min(1),
	kind: z.string().optional(),
	required: z.boolean().default(false),
	cache: cacheSchema.optional(),
	budget: budgetSchema.optional(),
	extract: extractSchema.optional(),
	reason: z.string().optional(),
});

export const urlInjectSchema = z.object({
	type: z.literal("url"),
	url: z.string().url(),
	kind: z.string().optional(),
	required: z.boolean().default(false),
	cache: cacheSchema.optional(),
	budget: budgetSchema.optional(),
	extract: extractSchema.optional(),
	reason: z.string().optional(),
});

export const injectObjectSchema = z.discriminatedUnion("type", [
	fileInjectSchema,
	urlInjectSchema,
]);
export const injectSchema = z.union([z.string().min(1), injectObjectSchema]);

export const contextBlockSchema = z
	.object({
		match: z.array(z.string().min(1)).min(1),
		operations: z.array(operationSchema).min(1),
		inject: z.array(injectSchema).min(1),
		cache: cacheSchema.optional(),
		budget: budgetSchema.optional(),
		agents: z.array(z.string().min(1)).optional(),
	})
	.refine((value) => value.match.some((pattern) => !pattern.startsWith("!")), {
		message: "match must contain at least one positive glob",
		path: ["match"],
	});

export const defaultsSchema = z.object({
	cache: cacheSchema.optional(),
	budget: budgetSchema.optional(),
});

export const contextFileSchema = z
	.object({
		$schema: z.string().optional(),
		version: z.literal(1),
		defaults: defaultsSchema.optional(),
		context: z.array(contextBlockSchema).default([]),
		session: z.any().optional(),
		permissions: z.any().optional(),
		subagents: z.any().optional(),
	})
	.strict();

export type Operation = z.infer<typeof operationSchema>;
export type CacheConfig = z.infer<typeof cacheSchema>;
export type BudgetConfig = z.infer<typeof budgetSchema>;
export type ExtractConfig = z.infer<typeof extractSchema>;
export type InjectObject = z.infer<typeof injectObjectSchema>;
export type InjectInput = z.infer<typeof injectSchema>;
export type ContextBlock = z.infer<typeof contextBlockSchema>;
export type ContextFile = z.infer<typeof contextFileSchema>;
export type { Operation as ContextOperation };
