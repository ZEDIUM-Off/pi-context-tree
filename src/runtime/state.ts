import type { PromptFileReference } from "../bundle.js";
import type { OptionalSessionContext } from "../pi/types.js";
import type { ContextScope } from "../scan.js";
import { createActiveInjectionRegistry, type ActiveInjectionRegistry, type ActiveInjection } from "../runtime-context/active-injection-registry.js";
import type { ResolutionBatch } from "../runtime-context/batch-resolver.js";
import type { InjectionParamsRegistry } from "../runtime-context/injection-params-registry.js";
import type { ResourceRegistry } from "../runtime-context/resource-registry.js";
import {
	statusText as renderStatusText,
	renderTui,
	summarizeScopes,
	summarizeSession,
} from "../tui.js";

export type RuntimeState = {
	scopes: ContextScope[];
	scanErrors: Array<{ configPath: string; message: string }>;
	tuiEnabled: boolean;
	extensionEnabled: boolean;
	injectedThisTurn: Set<string>;
	preflightSatisfied: Set<string>;
	sessionContextInjected: boolean;
	resources: ResourceRegistry;
	injectionParams: InjectionParamsRegistry;
	activeInjections: ActiveInjectionRegistry;
	resolutionHistory: ResolutionBatch[];
	activeChanges: ActiveInjection[];
	pendingPromptFileReferences: PromptFileReference[];
	editSession?: { targets: string[]; requestedAt: number; intent?: string };
	lastSession: ReturnType<typeof summarizeSession>;
	currentCwd: string;
	activeBranchKey?: string;
};

export function createRuntimeState(): RuntimeState {
	return {
		scopes: [],
		scanErrors: [],
		tuiEnabled: true,
		extensionEnabled: true,
		injectedThisTurn: new Set<string>(),
		preflightSatisfied: new Set<string>(),
		sessionContextInjected: false,
		resources: new Map(),
		injectionParams: [],
		activeInjections: createActiveInjectionRegistry(),
		resolutionHistory: [],
		activeChanges: [],
		pendingPromptFileReferences: [],
		lastSession: summarizeSession({}),
		currentCwd: process.cwd(),
	};
}

export function tuiState(state: RuntimeState) {
	return {
		scopesValid: state.scopes.length,
		scopesInvalid: state.scanErrors.length,
		enabled: state.tuiEnabled && state.extensionEnabled,
		scopes: summarizeScopes(
			state.currentCwd,
			state.scopes,
		),
		scanErrors: state.scanErrors,
		session: state.lastSession,
		activeStack: [...state.activeInjections.order].map((key) => state.activeInjections.entries.get(key)).filter((entry): entry is ActiveInjection => Boolean(entry)),
		resolutionHistory: state.resolutionHistory,
		activeChanges: state.activeChanges,
	};
}

export function statusText(state: RuntimeState): string {
	return renderStatusText(tuiState(state));
}

export function resetActiveRuntimeState(state: RuntimeState): void {
	state.injectedThisTurn.clear();
	state.preflightSatisfied.clear();
	state.activeInjections = createActiveInjectionRegistry();
	state.resolutionHistory = [];
	state.activeChanges = [];
	state.pendingPromptFileReferences = [];
	delete state.editSession;
	delete state.activeBranchKey;
}

function activeInjectionLine(state: RuntimeState): string {
	const latest = state.resolutionHistory[0];
	const invocation = latest?.invocations[0];
	const changed = state.activeChanges.length;
	const inserted = state.activeChanges.filter((entry) => entry.action === "inserted").length;
	const replaced = state.activeChanges.filter((entry) => entry.action === "replaced-mode" || entry.action === "replaced-params").length;
	const moved = state.activeChanges.filter((entry) => entry.action === "moved").length;
	const target = invocation?.target ? ` ${invocation.target}` : "";
	const diag = latest ? ` · ${latest.selected.length} selected · ${latest.skipped.length} skipped · ${latest.conflicts.length} conflicts` : "";
	return `Context Tree ${invocation?.hook ?? "context"}${target}: ${changed} active changes (${inserted} inserted, ${replaced} replaced, ${moved} moved)${diag}`;
}

export function showActiveInjection(
	state: RuntimeState,
	ctx: OptionalSessionContext,
): void {
	if (ctx.sessionManager)
		state.lastSession = summarizeSession(ctx.sessionManager);
	renderTui(ctx.ui, tuiState(state));
	if (state.activeChanges.length > 0) ctx.ui.notify(activeInjectionLine(state), "info");
}

export function showStatus(
	state: RuntimeState,
	ctx: OptionalSessionContext,
): void {
	if (ctx.sessionManager)
		state.lastSession = summarizeSession(ctx.sessionManager);
	renderTui(ctx.ui, tuiState(state));
}
