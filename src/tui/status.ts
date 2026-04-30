import type { TuiState } from "./types.js";

export function statusText(state: TuiState): string {
	if (!state.enabled) return "context-tree off";
	if (state.scopesValid === 0 && state.scopesInvalid === 0)
		return "context-tree not initialized · /ct-init · /ct-toggle off";
	const session = state.session
		? ` · ${state.session.mode}:${state.session.branchDepth}/${state.session.entryCount}`
		: "";
	return `context-tree on${session}`;
}
