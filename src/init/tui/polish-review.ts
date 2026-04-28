import type { GeneratedContextFile, InitSession } from "../types.js";
import { showProposalTable } from "./proposal-table.js";

export type PolishReviewAction =
	| "write"
	| "advanced"
	| "revise"
	| "back"
	| "cancel";

export async function reviewPolishPhase(
	ctx: any,
	session: InitSession,
): Promise<PolishReviewAction> {
	while (true) {
		const result = await showProposalTable(ctx, {
			title: "Context Tree Init · polish / write review",
			rows: session.generatedFiles,
			isEnabled: () => true,
			setEnabled: () => {},
			columns: [
				{ title: "Action", width: 8, render: (file) => file.action },
				{ title: "Kind", width: 8, render: (file) => file.kind },
				{ title: "Path", width: 42, render: (file) => file.path },
				{
					title: "Warnings",
					width: 12,
					render: (file) => String(file.warnings.length),
				},
			],
			actions: [
				{ label: "Write files", action: "write" },
				{ label: "Advanced: edit generated JSON", action: "advanced" },
				{ label: "Reject + comment / revise", action: "revise" },
				{ label: "Back", action: "back" },
				{ label: "Cancel", action: "cancel" },
			],
		});
		if (result.type === "action") return result.action;
		await editGeneratedFile(ctx, session.generatedFiles[result.index]);
	}
}

async function editGeneratedFile(
	ctx: any,
	file: GeneratedContextFile | undefined,
): Promise<void> {
	if (!file) return;
	if (file.kind === "context") {
		const edited = await ctx.ui.editor?.(
			`Edit ${file.path}`,
			JSON.stringify(file.config, null, "\t"),
		);
		if (!edited) return;
		try {
			file.config = JSON.parse(edited);
		} catch (error) {
			ctx.ui.notify(
				error instanceof Error ? error.message : String(error),
				"error",
			);
		}
		return;
	}
	const edited = await ctx.ui.editor?.(`Edit ${file.path}`, file.content ?? "");
	if (edited !== undefined) file.content = edited;
}
