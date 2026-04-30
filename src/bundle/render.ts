import path from "node:path";
import type { NormalizedSource } from "../normalize.js";
import { toPosix } from "../util.js";
import { stabilityMeaning } from "./stability.js";
import type { Bundle, ExplainResult } from "./types.js";

export function formatMode(mode: NormalizedSource["mode"]): string {
	if (mode.type === "lines") return `lines ${mode.ranges.join(", ")}`;
	if (mode.type === "sections") return `sections ${mode.names.join(", ")}`;
	if (mode.type === "markers") return `markers ${mode.names.join(", ")}`;
	if (mode.type === "segments") return `segments ${mode.items.length}`;
	return mode.type;
}

export function renderBundle(bundle: Bundle): string {
	const lines = [
		"# Context Tree Bundle",
		"",
		`Target: \`${bundle.targetPath}\``,
		`Hook: \`${bundle.operation}\``,
		`Bundle: \`${bundle.bundleHash}\``,
	];
	if (bundle.stability) {
		const { scope, config } = bundle.stability;
		lines.push(
			"",
			"## Scope Stability",
			`Scope: \`${scope.basePath === "." ? "CONTEXT.json" : `${scope.basePath}/CONTEXT.json`}\``,
			`State: \`${config.state}\``,
			stabilityMeaning(config.state),
		);
		if (config.updatedAt || config.updatedBy)
			lines.push(
				`Updated: ${[config.updatedAt, config.updatedBy && `by ${config.updatedBy}`].filter(Boolean).join(" ")}`,
			);
		if (config.until) lines.push(`Until: ${config.until}`);
		if (config.summary) lines.push("", "Summary:", config.summary);
	}
	lines.push("", "## Sources");
	for (const source of bundle.sources)
		lines.push(`- ${source.sourceId} (${formatMode(source.mode)})`);
	if (bundle.warnings.length)
		lines.push("", "## Warnings", ...bundle.warnings.map((w) => `- ${w}`));
	for (const source of bundle.sources) {
		lines.push("", `## Source: ${source.sourceId}`, "");
		lines.push(`Mode: ${formatMode(source.mode)}`);
		if (source.kind) lines.push(`Kind: ${source.kind}`);
		if (source.reason) lines.push(`Reason: ${source.reason}`);
		if (source.content !== undefined) {
			lines.push("", "### Content", "", source.content.trimEnd());
			continue;
		}
		lines.push("", "### How to load if needed");
		if (source.type === "file") lines.push(`- read path="${source.sourceId}"`);
		else {
			lines.push(`- web_fetch url="${source.url}"`);
			lines.push(`- /ct-fetch ${bundle.targetPath}`);
		}
	}
	return lines.join("\n");
}

export function formatExplain(cwd: string, result: ExplainResult): string {
	const lines = [
		`Context tree explain: ${result.targetPath}`,
		`Hook: ${result.operation}`,
		"",
		"Matched hooks:",
	];
	if (!result.matched.length) lines.push("- none");
	for (const match of result.matched)
		lines.push(
			`- ${toPosix(path.relative(cwd, match.scope.configPath))} id=${match.contextId.slice(0, 12)} on=${match.block.on} match=${JSON.stringify(match.block.match ?? [])}`,
		);
	lines.push("", "Inject sources:");
	if (!result.sources.length) lines.push("- none");
	for (const source of result.sources)
		lines.push(
			`- ${source.type === "file" ? toPosix(path.relative(cwd, source.absolutePath ?? "")) : source.url} mode=${formatMode(source.mode)}`,
		);
	return lines.join("\n");
}
