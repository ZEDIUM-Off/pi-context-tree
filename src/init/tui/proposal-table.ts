import type {
	CustomUi,
	ExtensionContextLike,
	ThemeLike,
} from "../../pi/types.js";
import {
	ProposalTable,
	type ProposalTableAction,
	type ProposalTableOptions,
} from "./proposal-table-model.js";
export type {
	ProposalTableAction,
	ProposalTableActionRow,
	ProposalTableOptions,
} from "./proposal-table-model.js";
export type { ProposalTableColumn } from "./proposal-table-render.js";
export { cell, hyperlink } from "./proposal-table-render.js";

export async function showProposalTable<TRow, TAction extends string>(
	ctx: ExtensionContextLike,
	options: ProposalTableOptions<TRow, TAction>,
): Promise<ProposalTableAction<TAction>> {
	if (typeof ctx.ui.custom !== "function")
		throw new Error("Custom UI is not available.");
	const custom = ctx.ui.custom as CustomUi;
	return custom<ProposalTableAction<TAction>>((tui, theme, _kb, done) => {
		if (!isThemeLike(theme)) throw new Error("Theme API is not available.");
		return new ProposalTable(options, theme, tui, done);
	});
}

function isThemeLike(value: unknown): value is ThemeLike {
	return (
		typeof value === "object" &&
		value !== null &&
		typeof (value as { fg?: unknown }).fg === "function" &&
		typeof (value as { bg?: unknown }).bg === "function"
	);
}
