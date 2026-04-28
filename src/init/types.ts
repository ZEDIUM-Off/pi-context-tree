import type { ContextFile, StabilityState } from "../schema.js";

export type InitPhase =
	| "scan"
	| "technology"
	| "references"
	| "rules"
	| "scopes"
	| "stability"
	| "preview"
	| "success";

export type FsScanResult = {
	cwd: string;
	files: Array<{ path: string; size: number; extension: string }>;
	dirs: string[];
	ignored: string[];
	stats: {
		fileCount: number;
		dirCount: number;
		byExtension: Record<string, number>;
		totalBytes: number;
	};
};

export type DetectedTech = {
	id: string;
	name: string;
	category: "language" | "framework" | "tool" | "test" | "build" | "runtime";
	confidence: "high" | "medium" | "low";
	evidence: string[];
	enabled: boolean;
};

export type ReferenceProposal = {
	techId: string;
	scopePath: string;
	title: string;
	url: string;
	kind: "context7" | "url";
	reason: string;
	query: string;
	libraryName: string;
	libraryId?: string;
	commands: string[];
	enabled: boolean;
};

export type RuleProposal = {
	path: string;
	title: string;
	kind: "skill" | "rule" | "doc";
	reason: string;
	mode: { type: "ref" } | { type: "lines"; ranges: string[] };
	enabled: boolean;
};

export type HookProposal = {
	on: string;
	match?: string[];
	inject: unknown[];
};

export type ScopeProposal = {
	path: string;
	label: string;
	reason: string;
	confidence: "high" | "medium" | "low";
	enabled: boolean;
	stability: {
		state: StabilityState;
		summary: string;
	};
	hooks: HookProposal[];
};

export type GeneratedContextFile = {
	path: string;
	action: "create" | "update";
	kind: "context" | "doc";
	config?: ContextFile;
	content?: string;
	warnings: string[];
};

export type InitFeedback = {
	phase: InitPhase;
	message: string;
	createdAt: string;
};

export type InitSession = {
	id: string;
	cwd: string;
	phase: InitPhase;
	scan?: FsScanResult;
	technologies: DetectedTech[];
	references: ReferenceProposal[];
	rules: RuleProposal[];
	scopes: ScopeProposal[];
	generatedFiles: GeneratedContextFile[];
	feedback: InitFeedback[];
};
