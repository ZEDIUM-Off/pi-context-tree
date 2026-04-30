import type { ExtensionContextLike, PiMessagingLike } from "../pi/types.js";
import { persistInitSession } from "./session.js";
import type { InitPhase, InitSession } from "./types.js";
import { agentAnalysisPrompt, revisionPrompt } from "./agent-prompts.js";

export async function requestAgentAnalysis(
	pi: PiMessagingLike,
	ctx: ExtensionContextLike,
	session: InitSession,
): Promise<void> {
	ctx.ui.notify(
		"Agent analysis requested in current session. Wizard paused; proposal tool will reopen review when ready.",
		"info",
	);
	const options: { deliverAs: "followUp" } | undefined = ctx.isIdle?.()
		? undefined
		: { deliverAs: "followUp" };
	await pi.sendUserMessage(agentAnalysisPrompt(session), options);
}

export async function sendRevisionRequest(
	pi: PiMessagingLike,
	ctx: ExtensionContextLike,
	session: InitSession,
	phase: InitPhase,
): Promise<"cancel"> {
	const feedback = await ctx.ui.editor?.("Tell agent what should change", "");
	if (!feedback) return "cancel";
	session.feedback.push({
		phase,
		message: feedback,
		createdAt: new Date().toISOString(),
	});
	await persistInitSession(session);
	if (ctx.isIdle?.()) {
		await pi.sendUserMessage(revisionPrompt(session, phase, feedback));
	} else {
		await pi.sendUserMessage(revisionPrompt(session, phase, feedback), {
			deliverAs: "steer",
		});
	}
	ctx.ui.notify(
		"Feedback sent to agent. Wizard paused; proposal tool will reopen this step when ready.",
		"info",
	);
	return "cancel";
}
