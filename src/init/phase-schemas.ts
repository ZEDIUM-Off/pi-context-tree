import { z } from "zod";
import {
	contextFileSchema,
	hookNameSchema,
	injectSchema,
	pathAwareHooks,
	pathlessHooks,
	stabilityStateSchema,
} from "../schema.js";

export const detectedTechSchema = z.object({
	id: z.string().min(1),
	name: z.string().min(1),
	category: z.enum([
		"language",
		"framework",
		"tool",
		"test",
		"build",
		"runtime",
	]),
	confidence: z.enum(["high", "medium", "low"]),
	evidence: z.array(z.string()).default([]),
	enabled: z.boolean().default(true),
});

export const referenceProposalSchema = z.object({
	techId: z.string().min(1),
	scopePath: z.string().min(1),
	title: z.string().min(1),
	url: z.string().min(1),
	kind: z.enum(["context7", "url"]),
	reason: z.string().min(1),
	query: z.string().min(1),
	libraryName: z.string().min(1),
	libraryId: z.string().optional(),
	commands: z.array(z.string()).default([]),
	enabled: z.boolean().default(false),
});

export const ruleProposalSchema = z.object({
	path: z.string().min(1),
	title: z.string().min(1),
	kind: z.enum(["skill", "rule", "doc"]),
	reason: z.string().min(1),
	mode: z.union([
		z.object({ type: z.literal("ref") }),
		z.object({ type: z.literal("lines"), ranges: z.array(z.string()).min(1) }),
	]),
	enabled: z.boolean().default(true),
});

export const hookProposalSchema = z
	.object({
		on: hookNameSchema,
		match: z.array(z.string().min(1)).min(1).optional(),
		inject: z.array(injectSchema).min(1),
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

export const scopeProposalSchema = z.object({
	path: z.string().min(1),
	label: z.string().min(1),
	reason: z.string().min(1),
	confidence: z.enum(["high", "medium", "low"]),
	enabled: z.boolean().default(true),
	stability: z.object({
		state: stabilityStateSchema,
		summary: z.string().min(1),
	}),
	hooks: z.array(hookProposalSchema),
});

export const initPhaseSubmitSchema = z.object({
	phase: z.enum(["technology", "rules", "references", "scopes", "stability"]),
	technologies: z.array(detectedTechSchema).optional(),
	rules: z.array(ruleProposalSchema).optional(),
	references: z.array(referenceProposalSchema).optional(),
	scopes: z.array(scopeProposalSchema).optional(),
	notes: z.array(z.string()).optional(),
});

export const generatedPreviewSchema = z.array(
	z
		.object({ kind: z.string(), config: contextFileSchema.optional() })
		.passthrough(),
);
