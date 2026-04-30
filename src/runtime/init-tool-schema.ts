import { StringEnum } from "@mariozechner/pi-ai";
import { Type } from "typebox";

const confidenceType = StringEnum(["high", "medium", "low"] as const);
const detectedTechType = Type.Object({
	id: Type.String({ description: "Stable id, e.g. typescript or shadcn-vue." }),
	name: Type.String({ description: "Human readable technology name." }),
	category: StringEnum([
		"language",
		"framework",
		"tool",
		"test",
		"build",
		"runtime",
	] as const),
	confidence: confidenceType,
	evidence: Type.Array(Type.String()),
	enabled: Type.Boolean(),
});
const modeProposalType = Type.Union([
	Type.Object({ type: StringEnum(["inline"] as const) }),
	Type.Object({ type: StringEnum(["ref"] as const) }),
	Type.Object({
		type: StringEnum(["lines"] as const),
		ranges: Type.Array(Type.String()),
	}),
	Type.Object({
		type: StringEnum(["sections"] as const),
		names: Type.Array(Type.String()),
	}),
	Type.Object({
		type: StringEnum(["markers"] as const),
		names: Type.Array(Type.String()),
	}),
]);
const ruleProposalType = Type.Object({
	path: Type.String(),
	title: Type.String(),
	kind: StringEnum(["skill", "rule", "doc"] as const),
	reason: Type.String(),
	mode: Type.Union([
		Type.Object({ type: StringEnum(["ref"] as const) }),
		Type.Object({
			type: StringEnum(["lines"] as const),
			ranges: Type.Array(Type.String()),
		}),
	]),
	enabled: Type.Boolean(),
});
const referenceProposalType = Type.Object({
	techId: Type.String(),
	scopePath: Type.String(),
	title: Type.String(),
	url: Type.String({ description: "context7:<libraryId> or URL." }),
	kind: StringEnum(["context7", "url"] as const),
	reason: Type.String(),
	query: Type.String(),
	libraryName: Type.String(),
	libraryId: Type.Optional(Type.String()),
	commands: Type.Array(Type.String()),
	enabled: Type.Boolean(),
});
const injectProposalType = Type.Union([
	Type.String({
		description: "Relative file path shorthand, e.g. ./docs/rules.md.",
	}),
	Type.Object({
		type: StringEnum(["file"] as const),
		path: Type.String(),
		kind: Type.Optional(Type.String()),
		mode: Type.Optional(modeProposalType),
		reason: Type.Optional(Type.String()),
	}),
	Type.Object({
		type: StringEnum(["url"] as const),
		url: Type.String({
			description:
				"Absolute http(s) URL only. For Context7 use https://context7.com/org/project.",
		}),
		kind: Type.Optional(Type.String()),
		mode: Type.Optional(modeProposalType),
		reason: Type.Optional(Type.String()),
	}),
]);
const hookProposalType = Type.Object({
	on: StringEnum([
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
	] as const),
	match: Type.Optional(
		Type.Array(
			Type.String({
				description:
					"Required for tool:* and spawn hooks; forbidden for session:start and agent:start.",
			}),
		),
	),
	inject: Type.Array(injectProposalType),
});
const scopeProposalType = Type.Object({
	path: Type.String(),
	label: Type.String(),
	reason: Type.String(),
	confidence: confidenceType,
	enabled: Type.Boolean(),
	stability: Type.Object({
		state: StringEnum([
			"canonical",
			"stable",
			"in_progress",
			"experimental",
			"deprecated",
			"generated",
		] as const),
		summary: Type.String(),
	}),
	hooks: Type.Array(hookProposalType),
});

export const phaseSubmitParameters = Type.Object({
	phase: StringEnum([
		"technology",
		"rules",
		"references",
		"scopes",
		"stability",
	] as const),
	technologies: Type.Optional(Type.Array(detectedTechType)),
	rules: Type.Optional(Type.Array(ruleProposalType)),
	references: Type.Optional(Type.Array(referenceProposalType)),
	scopes: Type.Optional(Type.Array(scopeProposalType)),
	notes: Type.Optional(Type.Array(Type.String())),
});
