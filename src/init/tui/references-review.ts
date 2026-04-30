import type { ExtensionContextLike } from "../../pi/types.js";
import type { InitSession, ReferenceProposal } from "../types.js";
import { standardReviewActions } from "./actions.js";
import {
	editJsonRow,
	progressForSession,
	type StandardReviewAction,
} from "./phase-review.js";
import { showProposalTable } from "./proposal-table.js";

export type ReferencesReviewAction = StandardReviewAction;

export async function reviewReferencesPhase(
	ctx: ExtensionContextLike,
	session: InitSession,
): Promise<ReferencesReviewAction> {
	while (true) {
		const result = await showProposalTable(ctx, {
			title: "Context Tree Init · references review",
			progress: progressForSession(session),
			rows: session.references,
			isEnabled: (ref) => ref.enabled,
			setEnabled: (ref, enabled) => {
				ref.enabled = enabled;
			},
			columns: [
				{ title: "Title", width: 28, render: (ref) => ref.title },
				{ title: "Scope", width: 20, render: (ref) => ref.scopePath },
				{
					title: "URL",
					width: 30,
					render: (ref) => referenceDisplayUrl(ref),
					href: (ref) => referenceDisplayUrl(ref),
				},
			],
			actions: standardReviewActions,
		});
		if (result.type === "action") return result.action;
		await editReference(ctx, session, result.index);
	}
}

async function editReference(
	ctx: ExtensionContextLike,
	session: InitSession,
	index: number,
): Promise<void> {
	const ref = session.references[index];
	if (!ref) return;
	const choice = await ctx.ui.select?.(`Reference: ${ref.title}`, [
		ref.enabled ? "Toggle off" : "Toggle on",
		"Change scope",
		"Edit URL / Context7 id",
		"Edit query",
		"Edit full reference JSON",
		"Back",
	]);
	if (!choice || choice === "Back") return;
	if (choice === "Toggle off" || choice === "Toggle on") {
		ref.enabled = !ref.enabled;
		return;
	}
	if (choice === "Change scope") {
		const scope = await ctx.ui.select?.(
			"Scope",
			session.scopes.filter((item) => item.enabled).map((item) => item.path),
		);
		if (scope) ref.scopePath = scope;
		return;
	}
	if (choice === "Edit URL / Context7 id") {
		const next = await ctx.ui.input?.("URL or context7:<libraryId>", ref.url);
		if (next) {
			ref.url = next;
			ref.kind = next.startsWith("context7:") ? "context7" : "url";
			if (next.startsWith("context7:"))
				ref.libraryId = next.slice("context7:".length);
			else delete ref.libraryId;
		}
		return;
	}
	if (choice === "Edit query") {
		const next = await ctx.ui.editor?.("Reference query", ref.query);
		if (next !== undefined) ref.query = next;
		return;
	}
	await editJsonRow(ctx, "Edit full reference JSON", ref, (value) => {
		session.references[index] = value;
	});
}

export function referenceDisplayUrl(ref: ReferenceProposal): string {
	if (ref.kind !== "context7") return ref.url;
	const libraryId = ref.libraryId ?? ref.url.replace(/^context7:/, "");
	if (/^https?:\/\//.test(ref.url)) return ref.url;
	return `https://context7.com/${libraryId.replace(/^\/+/, "")}`;
}
