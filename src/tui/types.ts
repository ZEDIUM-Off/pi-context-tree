import type { Operation } from "../schema.js";

export type InjectionReference = {
	id: string;
	kind: "file" | "url";
	mode: string;
	contextId?: string;
	lines: number;
	tokensApprox: number;
	uri: string;
	reason?: string;
};
export type LastInjection = {
	target: string;
	operation: Operation;
	bundleHash: string;
	sourceCount: number;
	fileCount: number;
	urlCount: number;
	lineCount: number;
	tokensApprox: number;
	contextCount: number;
	warningCount: number;
	warnings: string[];
	stability?: ScopeSummary;
	references: InjectionReference[];
};
export type ScopeSummary = {
	basePath: string;
	configPath: string;
	state: string;
	confidence: "high" | "medium" | "low";
	hookCount: number;
	pathAwareHookCount: number;
	pathlessHookCount: number;
	lastHook?: Operation;
	lastBundleHash?: string;
	sourceCount: number;
	children: string[];
	summary?: string;
	updatedAt?: string;
	updatedBy?: string;
};
export type SessionSummary = {
	file?: string;
	id?: string;
	leafId?: string;
	branchDepth: number;
	entryCount: number;
	mode: "main" | "branch" | "empty";
};
export type TuiState = {
	scopesValid: number;
	scopesInvalid: number;
	enabled: boolean;
	scopes?: ScopeSummary[];
	scanErrors?: Array<{ configPath: string; message: string }>;
	session?: SessionSummary;
	lastInjection?: LastInjection;
	injectionHistory?: LastInjection[];
};
export type TuiApi = {
	setStatus: (key: string, value: string | undefined) => void;
	setWidget: (key: string, lines: string[] | undefined) => void;
	notify: (message: string, level?: "info" | "warning" | "error") => void;
	theme?: unknown;
};
