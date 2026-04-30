import path from "node:path";
import { pathToFileURL } from "node:url";
import type { ExtensionContextLike } from "../../pi/types.js";
import type { InitSession } from "../types.js";
import { progressForSession } from "./phase-review.js";
import { showProposalTable } from "./proposal-table.js";
import { editRule } from "./rule-editor.js";

export type RulesReviewAction =
	| "accept"
	| "advanced"
	| "revise"
	| "back"
	| "cancel";

export async function reviewRulesPhase(
	ctx: ExtensionContextLike,
	session: InitSession,
): Promise<RulesReviewAction> {
	while (true) {
		const result = await showProposalTable(ctx, {
			title: "Context Tree Init · rules review",
			progress: progressForSession(session),
			rows: session.rules,
			isEnabled: (rule) => rule.enabled,
			setEnabled: (rule, enabled) => {
				rule.enabled = enabled;
			},
			columns: [
				{ title: "Title", width: 32, render: (rule) => rule.title },
				{
					title: "Path",
					width: 52,
					render: (rule) => path.join(session.cwd, rule.path),
					href: (rule) => pathToFileURL(path.join(session.cwd, rule.path)).href,
				},
				{
					title: "Mode",
					width: 12,
					render: (rule) =>
						rule.mode.type === "lines" ? rule.mode.ranges.join(",") : "ref",
				},
			],
			actions: [
				{ label: "Accept step", action: "accept" },
				{ label: "Advanced: edit JSON", action: "advanced" },
				{ label: "Reject + comment / revise", action: "revise" },
				{ label: "Back", action: "back" },
				{ label: "Cancel", action: "cancel" },
			],
		});
		if (result.type === "action") return result.action;
		await editRule(ctx, session, result.index);
	}
}
