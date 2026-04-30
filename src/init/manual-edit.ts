import type { ExtensionContextLike } from "../pi/types.js";
import type { InitPhase, InitSession } from "./types.js";
import { phaseValue, setPhaseValue, validatePhase } from "./phase-values.js";

export async function editPhaseJson(
	ctx: ExtensionContextLike,
	session: InitSession,
	phase: InitPhase,
): Promise<void> {
	const current = phaseValue(session, phase);
	const edited = await ctx.ui.editor?.(
		`Edit ${phase} JSON`,
		JSON.stringify(current, null, "\t"),
	);
	if (!edited) return;
	let parsed: unknown;
	try {
		parsed = JSON.parse(edited);
	} catch (error) {
		ctx.ui.notify(
			error instanceof Error ? error.message : String(error),
			"error",
		);
		return;
	}
	try {
		validatePhase(phase, parsed);
		setPhaseValue(session, phase, parsed);
	} catch (error) {
		ctx.ui.notify(
			error instanceof Error ? error.message : String(error),
			"error",
		);
	}
}
