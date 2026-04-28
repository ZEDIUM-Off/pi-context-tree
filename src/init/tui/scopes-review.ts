import { stabilityStateSchema } from "../../schema.js";
import type { InitSession } from "../types.js";
import { standardReviewActions } from "./actions.js";
import {
	editJsonRow,
	progressForSession,
	type StandardReviewAction,
} from "./phase-review.js";
import { showProposalTable } from "./proposal-table.js";

export type ScopesReviewAction = StandardReviewAction;

export async function reviewScopesPhase(
	ctx: any,
	session: InitSession,
): Promise<ScopesReviewAction> {
	while (true) {
		const result = await showProposalTable(ctx, {
			title: "Context Tree Init · scopes review",
			progress: progressForSession(session),
			rows: session.scopes,
			isEnabled: (scope) => scope.enabled,
			setEnabled: (scope, enabled) => {
				scope.enabled = enabled;
			},
			columns: [
				{ title: "Path", width: 28, render: (scope) => scope.path },
				{
					title: "Stability",
					width: 18,
					render: (scope) => scope.stability?.state ?? "",
				},
				{
					title: "Summary",
					width: 30,
					render: (scope) => scope.stability?.summary || scope.reason,
				},
			],
			actions: standardReviewActions,
		});
		if (result.type === "action") return result.action;
		await editScope(ctx, session, result.index);
	}
}

async function editScope(
	ctx: any,
	session: InitSession,
	index: number,
): Promise<void> {
	const scope = session.scopes[index];
	if (!scope) return;
	const choice = await ctx.ui.select?.(`Scope: ${scope.path}`, [
		scope.enabled ? "Toggle off" : "Toggle on",
		"Change stability",
		"Edit stability summary",
		"Edit hooks JSON",
		"Edit full scope JSON",
		"Back",
	]);
	if (!choice || choice === "Back") return;
	if (choice === "Toggle off" || choice === "Toggle on") {
		scope.enabled = !scope.enabled;
		return;
	}
	if (choice === "Change stability") {
		const next = await ctx.ui.select?.(
			"Stability",
			stabilityStateSchema.options,
		);
		if (next) scope.stability.state = next;
		return;
	}
	if (choice === "Edit stability summary") {
		const next = await ctx.ui.editor?.(
			"Stability summary",
			scope.stability.summary,
		);
		if (next !== undefined) scope.stability.summary = next;
		return;
	}
	if (choice === "Edit hooks JSON") {
		const edited = await ctx.ui.editor?.(
			"Edit hooks JSON",
			JSON.stringify(scope.hooks, null, "\t"),
		);
		if (!edited) return;
		try {
			scope.hooks = JSON.parse(edited);
		} catch (error) {
			ctx.ui.notify(
				error instanceof Error ? error.message : String(error),
				"error",
			);
		}
		return;
	}
	await editJsonRow(ctx, "Edit full scope JSON", scope, (value) => {
		session.scopes[index] = value;
	});
}
