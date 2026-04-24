import { z } from "zod";

export const contextModeSchema = z.enum(["once_per_turn", "once_per_session", "always"]);
export const includeKindSchema = z.enum(["summary", "reference", "code", "test", "schema", "skill", "artifact"]);
export const runtimePolicySchema = z.enum(["suggest", "auto", "lock"]);
export const thinkingSchema = z.enum(["off", "minimal", "low", "medium", "high", "xhigh"]);

export const contextIncludeSchema = z.object({
  path: z.string().min(1),
  kind: includeKindSchema.default("reference"),
  sections: z.array(z.string().min(1)).optional(),
  required: z.boolean().default(false),
  reason: z.string().optional(),
});

export const contextConfigSchema = z.object({
  mode: contextModeSchema.default("once_per_turn"),
  maxTokens: z.number().int().positive().default(3000),
  include: z.array(contextIncludeSchema).default([]),
  exclude: z.array(z.string().min(1)).default([]),
});

export const modelHintSchema = z.object({
  provider: z.string().min(1),
  id: z.string().min(1),
  policy: runtimePolicySchema.default("suggest"),
});

export const toolsHintSchema = z.object({
  policy: runtimePolicySchema.default("suggest"),
  enable: z.array(z.string().min(1)).optional(),
  disable: z.array(z.string().min(1)).optional(),
});

export const runtimeConfigSchema = z.object({
  model: modelHintSchema.nullable().optional(),
  thinking: thinkingSchema.nullable().optional(),
  tools: toolsHintSchema.nullable().optional(),
});

export const contextFileSchema = z.object({
  $schema: z.string().optional(),
  version: z.literal(1),
  scope: z.string().min(1).default("."),
  applies: z.array(z.string().min(1)).default(["**/*"]),
  priority: z.number().int().default(0),
  context: contextConfigSchema.default({ mode: "once_per_turn", maxTokens: 3000, include: [], exclude: [] }),
  runtime: runtimeConfigSchema.default({}),
});

export type ContextMode = z.infer<typeof contextModeSchema>;
export type IncludeKind = z.infer<typeof includeKindSchema>;
export type ContextInclude = z.infer<typeof contextIncludeSchema>;
export type ContextConfig = z.infer<typeof contextConfigSchema>;
export type RuntimeConfig = z.infer<typeof runtimeConfigSchema>;
export type ContextFile = z.infer<typeof contextFileSchema>;
