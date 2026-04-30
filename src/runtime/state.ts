import { buildBundle } from "../bundle.js";
import type { OptionalSessionContext } from "../pi/types.js";
import type { ContextScope } from "../scan.js";
import {
	type LastInjection,
	statusText as renderStatusText,
	renderTui,
	summarizeBundle,
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
	startupRendered: string;
	lastInjection?: LastInjection;
	injectionHistory: LastInjection[];
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
		startupRendered: "",
		injectionHistory: [],
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
			state.lastInjection,
		),
		scanErrors: state.scanErrors,
		session: state.lastSession,
		injectionHistory: state.injectionHistory,
		...(state.lastInjection ? { lastInjection: state.lastInjection } : {}),
	};
}

export function statusText(state: RuntimeState): string {
	return renderStatusText(tuiState(state));
}

export function showInjection(
	state: RuntimeState,
	ctx: OptionalSessionContext,
	cwd: string,
	bundle: Awaited<ReturnType<typeof buildBundle>>,
): void {
	state.currentCwd = cwd;
	if (ctx.sessionManager)
		state.lastSession = summarizeSession(ctx.sessionManager);
	state.lastInjection = summarizeBundle(cwd, bundle);
	state.injectionHistory = [
		state.lastInjection,
		...state.injectionHistory,
	].slice(0, 20);
	renderTui(ctx.ui, tuiState(state));
}

export function showStatus(
	state: RuntimeState,
	ctx: OptionalSessionContext,
): void {
	if (ctx.sessionManager)
		state.lastSession = summarizeSession(ctx.sessionManager);
	renderTui(ctx.ui, tuiState(state));
}
