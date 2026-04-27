import path from "node:path";
import type { Bundle, LoadedSource } from "./bundle.js";
import type { Operation } from "./schema.js";

export type TuiMode = "compact" | "verbose";
export type InjectionReference = {
	id: string;
	kind: "file" | "url";
	lines: number;
	tokensApprox: number;
	uri: string;
};
export type LastInjection = {
	target: string;
	operation: Operation;
	bundleHash: string;
	sourceCount: number;
	fileCount: number;
	urlCount: number;
	lineCount: number;
	tokensApprox: number;
	contextCount: number;
	warningCount: number;
	references: InjectionReference[];
};
export type TuiState = {
	scopesValid: number;
	scopesInvalid: number;
	enabled: boolean;
	mode: TuiMode;
	lastInjection?: LastInjection;
};
export type TuiApi = {
	setStatus: (key: string, value: string) => void;
	setWidget: (key: string, lines: string[] | undefined) => void;
};

export function summarizeBundle(cwd: string, bundle: Bundle): LastInjection {
	const references = bundle.sources.map((source) =>
		referenceForSource(cwd, source),
	);
	return {
		target: bundle.targetPath,
		operation: bundle.operation,
		bundleHash: bundle.bundleHash,
		sourceCount: bundle.sources.length,
		fileCount: references.filter((ref) => ref.kind === "file").length,
		urlCount: references.filter((ref) => ref.kind === "url").length,
		lineCount: references.reduce((sum, ref) => sum + ref.lines, 0),
		tokensApprox: references.reduce((sum, ref) => sum + ref.tokensApprox, 0),
		contextCount: bundle.contextIds.length,
		warningCount: bundle.warnings.length,
		references,
	};
}

export function statusText(state: TuiState): string {
	const health = `${state.scopesValid} valid/${state.scopesInvalid} invalid`;
	if (!state.lastInjection) return `context-tree ${health} · idle`;
	return `context-tree ${health} · ${state.lastInjection.operation} ${state.lastInjection.target} · ${state.lastInjection.sourceCount} src · ${formatNumber(state.lastInjection.tokensApprox)} tok · ${state.lastInjection.bundleHash.slice(0, 12)}`;
}

export function widgetLines(state: TuiState): string[] {
	const health = state.scopesInvalid
		? `⚠ ${state.scopesValid} valid · ${state.scopesInvalid} invalid`
		: `✓ ${state.scopesValid} valid · 0 invalid`;
	if (!state.lastInjection)
		return ["Context Tree", health, "last: idle", "mode: " + state.mode];
	const last = state.lastInjection;
	const base = [
		"Context Tree",
		health,
		`last: ${last.operation} ${last.target}`,
		`refs: ${last.sourceCount} (${last.fileCount} files, ${last.urlCount} urls) · contexts: ${last.contextCount}`,
		`size: ${formatNumber(last.lineCount)} lines · ~${formatNumber(last.tokensApprox)} tok · warnings: ${last.warningCount}`,
		`bundle: ${last.bundleHash.slice(0, 12)} · detail: Ctrl+Shift+C or /context-tree detail`,
	];
	if (state.mode === "verbose") {
		base.push("references:");
		base.push(
			...last.references
				.slice(0, 6)
				.map(
					(ref) =>
						`- ${ref.id} · ${formatNumber(ref.lines)} lines · ~${formatNumber(ref.tokensApprox)} tok`,
				),
		);
		if (last.references.length > 6)
			base.push(`- ... ${last.references.length - 6} more`);
		if (state.scopesInvalid)
			base.push(
				`invalid contexts: ${state.scopesInvalid} (run /context-tree validate)`,
			);
	}
	return base;
}

export function detailText(state: TuiState): string {
	const last = state.lastInjection;
	if (!last) return "Context Tree: no injection yet.";
	const lines = [
		"# Context Tree injection detail",
		"",
		`Target: ${last.target}`,
		`Operation: ${last.operation}`,
		`Bundle: ${last.bundleHash}`,
		`Contexts: ${last.contextCount}`,
		`References: ${last.sourceCount} (${last.fileCount} files, ${last.urlCount} urls)`,
		`Size: ${formatNumber(last.lineCount)} lines · ~${formatNumber(last.tokensApprox)} tokens`,
		`Warnings: ${last.warningCount}`,
		"",
		"## References",
	];
	for (const ref of last.references) {
		lines.push(
			`- ${ref.kind} ${ref.id}`,
			`  ${ref.uri}`,
			`  ${formatNumber(ref.lines)} lines · ~${formatNumber(ref.tokensApprox)} tokens`,
		);
	}
	return lines.join("\n");
}

export function renderTui(ui: TuiApi, state: TuiState): void {
	ui.setStatus("context-tree", statusText(state));
	ui.setWidget("context-tree", state.enabled ? widgetLines(state) : undefined);
}

function referenceForSource(
	cwd: string,
	source: LoadedSource,
): InjectionReference {
	const lines = countLines(source.content);
	const tokensApprox = estimateTokens(source.content);
	if (source.type === "file") {
		const absolutePath =
			source.absolutePath ?? path.resolve(cwd, source.sourceId);
		return {
			id: source.sourceId,
			kind: "file",
			lines,
			tokensApprox,
			uri: `file://${absolutePath}`,
		};
	}
	return {
		id: source.sourceId,
		kind: "url",
		lines,
		tokensApprox,
		uri: source.url,
	};
}

function countLines(value: string): number {
	if (!value) return 0;
	return value.split(/\r\n|\r|\n/).length;
}

function estimateTokens(value: string): number {
	return Math.ceil(value.length / 4);
}

function formatNumber(value: number): string {
	return new Intl.NumberFormat("en", {
		notation: value >= 10_000 ? "compact" : "standard",
	}).format(value);
}
