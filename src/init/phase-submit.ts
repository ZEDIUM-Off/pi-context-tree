import type { ExtensionContextLike } from "../pi/types.js";
import { expectedSubmitPhase } from "./phase-machine.js";
import { initPhaseSubmitSchema } from "./phase-schemas.js";
import { loadLatestInitSession, persistInitSession } from "./session.js";

export async function submitInitPhase(
	ctx: ExtensionContextLike,
	input: unknown,
): Promise<void> {
	const session = await loadLatestInitSession(ctx.cwd);
	if (!session) throw new Error("No init session found. Run /ct-init first.");
	const parsed = initPhaseSubmitSchema.parse(input);
	const expected = expectedSubmitPhase(session.phase);
	const isCurrentPhaseSubmission = parsed.phase === expected;
	if (parsed.phase === "technology")
		session.technologies = parsed.technologies ?? [];
	else if (parsed.phase === "rules") session.rules = parsed.rules ?? [];
	else if (parsed.phase === "references")
		session.references = (parsed.references ?? []).map((ref) => {
			const { libraryId, ...rest } = ref;
			return libraryId ? { ...rest, libraryId } : rest;
		});
	else if (parsed.phase === "scopes" || parsed.phase === "stability")
		session.scopes = (parsed.scopes ?? []).map((scope) => ({
			...scope,
			hooks: scope.hooks.map((hook) => {
				const { match, ...rest } = hook;
				return match ? { ...rest, match } : rest;
			}),
		}));
	if (isCurrentPhaseSubmission) session.phase = parsed.phase;
	session.feedback.push({
		phase: parsed.phase,
		message: `agent phase submitted${isCurrentPhaseSubmission ? "" : expected ? ` (saved out of order; current expected phase is ${expected})` : ` (saved while wizard phase is ${session.phase})`}:\n${JSON.stringify(parsed, null, 2)}`,
		createdAt: new Date().toISOString(),
	});
	session.generatedFiles = [];
	await persistInitSession(session);
}

export async function reviewInitProposal(
	ctx: ExtensionContextLike,
	proposal: string,
): Promise<void> {
	const session = await loadLatestInitSession(ctx.cwd);
	if (!session)
		return ctx.ui.notify(
			"No init session found. Run /ct-init first.",
			"warning",
		);
	const edited = await ctx.ui.editor?.("Review agent init proposal", proposal);
	if (!edited) return;
	session.feedback.push({
		phase: session.phase,
		message: `agent proposal reviewed:\n${edited}`,
		createdAt: new Date().toISOString(),
	});
	await persistInitSession(session);
	ctx.ui.notify(
		"Agent proposal saved to init feedback. Use /ct-init --resume to continue.",
		"info",
	);
}
