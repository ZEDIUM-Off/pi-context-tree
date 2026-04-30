import { statusText } from "./status.js";
import type { TuiApi, TuiState } from "./types.js";
import { widgetLines } from "./widget.js";

export function renderTui(ui: TuiApi, state: TuiState): void {
	ui.setStatus("context-tree", statusText(state));
	ui.setWidget(
		"context-tree",
		state.enabled ? widgetLines(state, ui.theme) : undefined,
	);
}
