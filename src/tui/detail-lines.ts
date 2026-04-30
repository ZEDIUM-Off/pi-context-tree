import type { PanelColors } from "./colors.js";
import { formatNumber, osc8, padCell, short, shortenUrl } from "./format.js";
import type { TuiState } from "./types.js";

export function detailText(state: TuiState): string {
	return renderDetailLines(state).join("\n");
}

export function renderDetailLines(
	state: TuiState,
	selectedScope = 0,
): string[] {
	const last = state.lastInjection;
	const lines = [
		"# Context Tree injection detail",
		`status: scopes ${state.scopesValid} ok / ${state.scopesInvalid} bad`,
		`session: ${state.session ? `${state.session.mode} depth ${state.session.branchDepth}/${state.session.entryCount} leaf ${short(state.session.leafId ?? "none")}` : "unknown"}`,
		"",
	];
	if (last) {
		lines.push(
			`References: ${last.sourceCount} (${last.fileCount} files, ${last.urlCount} urls)`,
			...section("Last injection", [
				["target", last.target],
				["hook", last.operation],
				["bundle", last.bundleHash],
				["contexts", String(last.contextCount)],
				[
					"sources",
					`${last.sourceCount} (${last.fileCount} files, ${last.urlCount} urls)`,
				],
				[
					"References:",
					`${last.sourceCount} (${last.fileCount} files, ${last.urlCount} urls)`,
				],
				[
					"size",
					`${formatNumber(last.lineCount)} lines · ~${formatNumber(last.tokensApprox)} tokens`,
				],
				["warnings", String(last.warningCount)],
			]),
		);
		if (last.stability)
			lines.push(
				...section("Nearest stability", [
					["scope", last.stability.basePath],
					["state", last.stability.state],
					["confidence", last.stability.confidence],
					["summary", last.stability.summary ?? "-"],
				]),
			);
	} else lines.push("No injection yet.");
	lines.push("", "Scopes (↑↓ in panel, Enter expands, o copies file URI)");
	for (const [i, scope] of (state.scopes ?? []).entries()) {
		const mark = i === selectedScope ? "▶" : " ";
		lines.push(
			`${mark} ${scope.basePath}  state=${scope.state}  confidence=${scope.confidence}  rules=${scope.hookCount}  last=${scope.lastHook ?? "-"}  children=${scope.children.length}`,
		);
		if (i === selectedScope) {
			lines.push(`    config: file://${scope.configPath}`);
			lines.push(
				`    path-aware=${scope.pathAwareHookCount} runtime=${scope.pathlessHookCount} sources=${scope.sourceCount}`,
			);
			if (scope.summary) lines.push(`    summary: ${scope.summary}`);
			if (scope.children.length)
				lines.push(`    sub-scopes: ${scope.children.join(", ")}`);
		}
	}
	if (last?.references.length) {
		lines.push(
			"",
			"References (OSC8/file URI aware terminals allow ctrl+click)",
		);
		for (const ref of last.references) {
			const label = ref.kind === "url" ? shortenUrl(ref.id) : ref.id;
			lines.push(
				`• ${ref.kind} ${ref.mode} ${osc8(ref.uri, label)}  ${ref.lines}l ~${ref.tokensApprox}tok`,
			);
			if (ref.mode !== "ref") lines.push(`  ${osc8(ref.uri, ref.uri)}`);
		}
	}
	if (last?.warnings.length)
		lines.push("", "Warnings", ...last.warnings.map((w) => `! ${w}`));
	if (state.scanErrors?.length)
		lines.push(
			"",
			"Invalid scopes",
			...state.scanErrors.map((e) => `! ${e.configPath}: ${e.message}`),
		);
	if (state.injectionHistory?.length)
		lines.push(
			"",
			"Injection stack",
			...state.injectionHistory
				.slice(0, 8)
				.map(
					(i, n) =>
						`${n === 0 ? "top" : `#${n}`} ${i.operation} ${i.target} ${i.bundleHash.slice(0, 12)}`,
				),
		);
	return lines;
}

export function colorDetailLine(line: string, c: PanelColors): string {
	if (line.startsWith("# ")) return c.title(line.slice(2));
	if (line.startsWith("References:")) return c.accent(line);
	if (line.startsWith("status:") || line.startsWith("session:"))
		return c.dim(line);
	if (line.startsWith("┌") || line.startsWith("└")) return c.border(line);
	if (line.startsWith("│ warnings") && !line.endsWith(" 0"))
		return c.warning(line);
	if (line.startsWith("│")) return c.muted(line.slice(0, 15)) + line.slice(15);
	if (line.startsWith("▶")) return c.accent(line);
	if (
		line.includes("confidence=high") ||
		line.includes("state=canonical") ||
		line.includes("state=stable")
	)
		return c.success(line);
	if (line.includes("confidence=medium") || line.includes("experimental"))
		return c.warning(line);
	if (line.startsWith("!")) return c.error(line);
	if (line.startsWith("•")) return c.accent(line);
	if (line.startsWith("  file://") || line.startsWith("  http"))
		return c.dim(line);
	if (
		[
			"Scopes",
			"References",
			"Warnings",
			"Invalid scopes",
			"Injection stack",
		].some((h) => line.startsWith(h))
	)
		return c.title(line);
	return line;
}

function section(title: string, rows: Array<[string, string]>): string[] {
	const width = 82;
	const keyWidth = 12;
	const valueWidth = width - keyWidth - 5;
	const titleText = ` ${title} `;
	return [
		`┌${titleText}${"─".repeat(Math.max(0, width - titleText.length - 2))}┐`,
		...rows.map(
			([k, v]) => `│ ${k.padEnd(keyWidth)} ${padCell(v, valueWidth)} │`,
		),
		`└${"─".repeat(width - 2)}┘`,
	];
}
