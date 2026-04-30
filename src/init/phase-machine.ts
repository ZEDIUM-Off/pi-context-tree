import type { InitPhase } from "./types.js";

export const initPhases = [
	"scan",
	"technology",
	"rules",
	"scopes",
	"references",
	"preview",
] as const satisfies readonly InitPhase[];

export const submitPhases = [
	"technology",
	"rules",
	"scopes",
	"references",
] as const satisfies readonly InitPhase[];

export function phaseIndex(phase: InitPhase): number {
	const index = initPhases.findIndex((item) => item === phase);
	return index < 0 ? 0 : index;
}

export function expectedSubmitPhase(
	current: InitPhase,
): (typeof submitPhases)[number] | undefined {
	if (current === "scan") return "technology";
	if (submitPhases.includes(current as (typeof submitPhases)[number]))
		return current as (typeof submitPhases)[number];
	return undefined;
}

export function nextPhase(phase: InitPhase): InitPhase {
	const index = phaseIndex(phase);
	return initPhases[index + 1] ?? "success";
}

export function previousPhase(phase: InitPhase): InitPhase {
	const index = phaseIndex(phase);
	return initPhases[Math.max(index - 1, 0)] ?? "scan";
}

export function shouldRequestAgentForPhase(phase: InitPhase): boolean {
	return submitPhases.includes(phase as (typeof submitPhases)[number]);
}
