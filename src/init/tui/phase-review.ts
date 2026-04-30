import type { ExtensionContextLike } from "../../pi/types.js";
import type { InitSession } from "../types.js";
import { standardReviewActions } from "./actions.js";
import {
	type ProposalTableColumn,
	showProposalTable,
} from "./proposal-table.js";

export type StandardReviewAction =
	| "accept"
	| "advanced"
	| "revise"
	| "back"
	| "cancel";

export async function reviewEditableRows<TRow>(
	ctx: ExtensionContextLike,
	options: {
		title: string;
		rows: TRow[];
		isEnabled: (row: TRow) => boolean;
		setEnabled: (row: TRow, enabled: boolean) => void;
		columns: ProposalTableColumn<TRow>[];
		editTitle: string;
	},
): Promise<StandardReviewAction> {
	while (true) {
		const result = await showProposalTable<TRow, StandardReviewAction>(ctx, {
			title: options.title,
			rows: options.rows,
			isEnabled: options.isEnabled,
			setEnabled: options.setEnabled,
			columns: options.columns,
			actions: standardReviewActions,
		});
		if (result.type === "action") return result.action;
		const row = options.rows[result.index];
		if (!row) continue;
		await editJsonRow(ctx, options.editTitle, row, (value) => {
			options.rows[result.index] = value;
		});
	}
}

export async function editJsonRow<TRow>(
	ctx: ExtensionContextLike,
	title: string,
	row: TRow,
	apply: (value: TRow) => void,
): Promise<void> {
	const edited = await ctx.ui.editor?.(title, JSON.stringify(row, null, "\t"));
	if (!edited) return;
	try {
		apply(JSON.parse(edited));
	} catch (error) {
		ctx.ui.notify(
			error instanceof Error ? error.message : String(error),
			"error",
		);
	}
}

export function progressForSession(session: InitSession): string {
	return `tech ${session.technologies.filter((item) => item.enabled).length} · rules ${session.rules.filter((item) => item.enabled).length} · scopes ${session.scopes.filter((item) => item.enabled).length} · refs ${session.references.filter((item) => item.enabled).length}`;
}
