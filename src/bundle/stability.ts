import path from "node:path";
import type { ContextScope } from "../scan.js";
import type { StabilityConfig } from "../schema.js";
import { toPosix } from "../util.js";
import type { ScopeStability } from "./types.js";

export function findNearestStability(
	scopes: ContextScope[],
	absoluteTarget: string,
): ScopeStability | undefined {
	let nearest: ScopeStability | undefined;
	for (const scope of scopes) {
		if (!scope.config.stability) continue;
		const relativeToScope = scope.global
			? "."
			: toPosix(path.relative(scope.dir, absoluteTarget));
		if (!scope.global && relativeToScope.startsWith("..")) continue;
		if (
			!nearest ||
			(!scope.global &&
				(nearest.scope.global || scope.dir.length >= nearest.scope.dir.length))
		)
			nearest = { scope, config: scope.config.stability };
	}
	return nearest;
}

export function stabilityMeaning(state: StabilityConfig["state"]): string {
	const meanings: Record<StabilityConfig["state"], string> = {
		canonical:
			"Meaning: trusted reference code. Prefer its conventions when editing related files.",
		stable:
			"Meaning: reliable code. Preserve behavior. Reasonable inspiration, not necessarily global pattern.",
		in_progress:
			"Meaning: active work. Do not infer stable project conventions from this code.",
		experimental:
			"Meaning: prototype/exploration. Do not copy patterns without explicit reason.",
		deprecated:
			"Meaning: deprecated code. Avoid extending or copying patterns.",
		generated:
			"Meaning: generated code. Do not use as human style; edit generator/source when possible.",
	};
	return meanings[state];
}
