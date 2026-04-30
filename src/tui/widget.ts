import { panelColors, sessionColor, type PanelColors } from "./colors.js";
import { formatNumber, padAnsi, short } from "./format.js";
import type { TuiState } from "./types.js";

export function widgetLines(state: TuiState, theme?: unknown): string[] {
	const c = panelColors(theme);
	if (state.scopesValid === 0 && state.scopesInvalid === 0)
		return uninitializedWidgetLines(state, c);
	const health = state.scopesInvalid
		? c.warning(`⚠ ${state.scopesValid} valid · ${state.scopesInvalid} invalid`)
		: c.success(`✓ ${state.scopesValid} valid · 0 invalid`);
	const session = state.session
		? `${sessionColor(state.session.mode, c)(state.session.mode)} · ${c.dim("leaf")} ${short(state.session.leafId ?? "none")} · ${state.session.branchDepth}/${state.session.entryCount}`
		: c.dim("unknown");
	const last = state.lastInjection;
	const rows: Array<[string, string]> = [
		[c.accent("scopes"), health],
		[c.accent("session"), session],
		[
			c.accent("last"),
			last ? `${c.warning(last.operation)} ${last.target}` : c.dim("idle"),
		],
	];
	if (last)
		rows.push(
			[
				c.accent("sources"),
				`${c.success(String(last.sourceCount))} (${last.fileCount} files, ${last.urlCount} urls)`,
			],
			[
				c.accent("size"),
				`${formatNumber(last.lineCount)} lines · ~${formatNumber(last.tokensApprox)} tok`,
			],
			[c.accent("bundle"), c.dim(last.bundleHash.slice(0, 12))],
			[
				c.accent("warn"),
				last.warningCount
					? c.warning(String(last.warningCount))
					: c.success("0"),
			],
		);
	return [
		c.title("Context Tree"),
		...boxRows(rows, c),
		c.hint("detail: Alt+C or /ct-detail"),
	];
}

function uninitializedWidgetLines(state: TuiState, c: PanelColors): string[] {
	const session = state.session
		? `${sessionColor(state.session.mode, c)(state.session.mode)} · ${c.dim("leaf")} ${short(state.session.leafId ?? "none")} · ${state.session.branchDepth}/${state.session.entryCount}`
		: c.dim("unknown");
	const rows: Array<[string, string]> = [
		[c.accent("state"), c.warning("not initialized in this workspace")],
		[c.accent("session"), session],
		[c.accent("init"), c.success("/ct-init")],
		[c.accent("disable"), c.dim("/ct-toggle off")],
	];
	return [
		c.title("Context Tree"),
		...boxRows(rows, c),
		c.hint("No CONTEXT.json found. Initialize or disable extension runtime."),
	];
}

function boxRows(rows: Array<[string, string]>, c: PanelColors): string[] {
	return [
		c.border("┌──────────┬────────────────────────────────────────┐"),
		...rows.map(
			([k, v]) =>
				`${c.border("│")} ${padAnsi(k, 8)} ${c.border("│")} ${padAnsi(v, 38)} ${c.border("│")}`,
		),
		c.border("└──────────┴────────────────────────────────────────┘"),
	];
}
