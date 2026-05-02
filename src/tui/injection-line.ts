import { formatNumber, shortenUrl } from "./format.js";
import type { InjectionReference, LastInjection } from "./types.js";

const MAX_INLINE_REFERENCES = 4;

export function injectionLine(injection: LastInjection): string {
	const references = injection.references
		.slice(0, MAX_INLINE_REFERENCES)
		.map(referenceLabel);
	const remaining = injection.references.length - references.length;
	const sourceSummary =
		references.length === 0
			? "0 sources"
			: `${injection.sourceCount} source${injection.sourceCount === 1 ? "" : "s"}: ${references.join(", ")}${remaining > 0 ? `, +${remaining}` : ""}`;
	const warningSummary = injection.warningCount
		? ` · ⚠ ${injection.warningCount}`
		: "";
	return `[Context Tree] ${injection.operation} ${injection.target} → ${sourceSummary} · ~${formatNumber(injection.tokensApprox)} tok · ${injection.bundleHash.slice(0, 12)}${warningSummary}`;
}

function referenceLabel(reference: InjectionReference): string {
	const id = reference.kind === "url" ? shortenUrl(reference.id) : reference.id;
	return `${id}:${reference.mode}`;
}
