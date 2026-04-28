import path from "node:path";
import type { Bundle, LoadedSource } from "./bundle.js";
import type { ContextScope } from "./scan.js";
import type { Operation } from "./schema.js";

export type InjectionReference = {
	id: string;
	kind: "file" | "url";
	mode: string;
	contextId?: string;
	lines: number;
	tokensApprox: number;
	uri: string;
	reason?: string;
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
	warnings: string[];
	stability?: ScopeSummary;
	references: InjectionReference[];
};
export type ScopeSummary = {
	basePath: string;
	configPath: string;
	state: string;
	confidence: "high" | "medium" | "low";
	hookCount: number;
	pathAwareHookCount: number;
	pathlessHookCount: number;
	lastHook?: Operation;
	lastBundleHash?: string;
	sourceCount: number;
	children: string[];
	summary?: string;
	updatedAt?: string;
	updatedBy?: string;
};
export type SessionSummary = {
	file?: string;
	id?: string;
	leafId?: string;
	branchDepth: number;
	entryCount: number;
	mode: "main" | "branch" | "empty";
};
export type TuiState = {
	scopesValid: number;
	scopesInvalid: number;
	enabled: boolean;
	scopes?: ScopeSummary[];
	scanErrors?: Array<{ configPath: string; message: string }>;
	session?: SessionSummary;
	lastInjection?: LastInjection;
	injectionHistory?: LastInjection[];
};
export type TuiApi = {
	setStatus: (key: string, value: string | undefined) => void;
	setWidget: (key: string, lines: string[] | undefined) => void;
	notify: (message: string, level?: "info" | "warning" | "error") => void;
	theme?: any;
};

export function summarizeBundle(cwd: string, bundle: Bundle): LastInjection {
	const references = bundle.sources.map((source) =>
		referenceForSource(cwd, source),
	);
	const stability = bundle.stability
		? summarizeScope(cwd, bundle.stability.scope, [], bundle)
		: undefined;
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
		warningCount:
			bundle.warnings.length +
			bundle.sources.reduce((sum, source) => sum + source.warnings.length, 0),
		warnings: [
			...bundle.warnings,
			...bundle.sources.flatMap((source) => source.warnings),
		],
		...(stability ? { stability } : {}),
		references,
	};
}

export function summarizeScopes(
	cwd: string,
	scopes: ContextScope[],
	last?: LastInjection,
): ScopeSummary[] {
	return scopes.map((scope) =>
		summarizeScope(cwd, scope, scopes, undefined, last),
	);
}

export function summarizeSession(sessionManager: any): SessionSummary {
	const branch = safeCall<any[]>(() => sessionManager.getBranch(), []);
	const entries = safeCall<any[]>(() => sessionManager.getEntries(), []);
	const leafId = safeCall<string | undefined>(
		() => sessionManager.getLeafId(),
		undefined,
	);
	const sessionFile = safeCall<string | undefined>(
		() => sessionManager.getSessionFile(),
		undefined,
	);
	const id = safeCall<string | undefined>(
		() => sessionManager.getSessionId(),
		undefined,
	);
	return {
		...(sessionFile ? { file: sessionFile } : {}),
		...(id ? { id } : {}),
		...(leafId ? { leafId } : {}),
		branchDepth: branch.length,
		entryCount: entries.length,
		mode:
			branch.length === 0
				? "empty"
				: branch.length < entries.length
					? "branch"
					: "main",
	};
}

export function statusText(state: TuiState): string {
	if (!state.enabled) return "context-tree off";
	if (state.scopesValid === 0 && state.scopesInvalid === 0)
		return "context-tree not initialized · /ct-init · /ct-toggle off";
	const session = state.session
		? ` · ${state.session.mode}:${state.session.branchDepth}/${state.session.entryCount}`
		: "";
	return `context-tree on${session}`;
}

export function widgetLines(state: TuiState, theme?: any): string[] {
	const c = panelColors(theme);
	if (state.scopesValid === 0 && state.scopesInvalid === 0)
		return uninitializedWidgetLines(state, c);
	const health = state.scopesInvalid
		? c.warning(`⚠ ${state.scopesValid} valid · ${state.scopesInvalid} invalid`)
		: c.success(`✓ ${state.scopesValid} valid · 0 invalid`);
	const session = state.session
		? `${sessionColor(state.session.mode, c)(state.session.mode)} · ${c.dim("leaf")} ${short(state.session.leafId ?? "none")} · ${state.session.branchDepth}/${state.session.entryCount}`
		: c.dim("unknown");
	const last = state.lastInjection;
	const rows: Array<[string, string]> = [
		[c.accent("scopes"), health],
		[c.accent("session"), session],
		[
			c.accent("last"),
			last ? `${c.warning(last.operation)} ${last.target}` : c.dim("idle"),
		],
	];
	if (last)
		rows.push(
			[
				c.accent("sources"),
				`${c.success(String(last.sourceCount))} (${last.fileCount} files, ${last.urlCount} urls)`,
			],
			[
				c.accent("size"),
				`${formatNumber(last.lineCount)} lines · ~${formatNumber(last.tokensApprox)} tok`,
			],
			[c.accent("bundle"), c.dim(last.bundleHash.slice(0, 12))],
			[
				c.accent("warn"),
				last.warningCount
					? c.warning(String(last.warningCount))
					: c.success("0"),
			],
		);
	return [
		c.title("Context Tree"),
		...boxRows(rows, c),
		c.hint("detail: Alt+C or /ct-detail"),
	];
}

function uninitializedWidgetLines(
	state: TuiState,
	c: ReturnType<typeof panelColors>,
): string[] {
	const session = state.session
		? `${sessionColor(state.session.mode, c)(state.session.mode)} · ${c.dim("leaf")} ${short(state.session.leafId ?? "none")} · ${state.session.branchDepth}/${state.session.entryCount}`
		: c.dim("unknown");
	const rows: Array<[string, string]> = [
		[c.accent("state"), c.warning("not initialized in this workspace")],
		[c.accent("session"), session],
		[c.accent("init"), c.success("/ct-init")],
		[c.accent("disable"), c.dim("/ct-toggle off")],
	];
	return [
		c.title("Context Tree"),
		...boxRows(rows, c),
		c.hint("No CONTEXT.json found. Initialize or disable extension runtime."),
	];
}

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
			`${mark} ${scope.basePath}  state=${scope.state}  confidence=${scope.confidence}  hooks=${scope.hookCount}  last=${scope.lastHook ?? "-"}  children=${scope.children.length}`,
		);
		if (i === selectedScope) {
			lines.push(`    config: file://${scope.configPath}`);
			lines.push(
				`    path-aware=${scope.pathAwareHookCount} pathless=${scope.pathlessHookCount} sources=${scope.sourceCount}`,
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

export async function showDetailPanel(
	ctx: any,
	state: TuiState,
): Promise<void> {
	let selected = 0;
	await ctx.ui.custom(
		(tui: any, theme: any, _kb: any, done: (value: void) => void) => ({
			render(width: number) {
				const popupWidth = Math.max(48, Math.min(110, width - 4));
				const innerWidth = popupWidth - 2;
				const c = panelColors(theme);
				const raw = renderDetailLines(state, selected)
					.filter((line) => !line.startsWith("╔") && !line.startsWith("╚"))
					.map((line) => colorDetailLine(line, c));
				const lines = raw.slice(0, 34);
				const title = ` ${c.title("Context Tree Inspector")} ${c.dim("scope/session/injection")}`;
				const top = framedTitle(title, innerWidth, c.border);
				const body = lines.map(
					(line) =>
						c.border("│") + padAnsi(` ${line}`, innerWidth) + c.border("│"),
				);
				const footer = `${c.hint("↑↓")} scope  ${c.hint("o")} copy config URI  ${c.hint("q/esc")} close`;
				return [
					top,
					c.border("│") + " ".repeat(innerWidth) + c.border("│"),
					...body,
					c.border("├" + "─".repeat(innerWidth) + "┤"),
					c.border("│") + padAnsi(` ${footer}`, innerWidth) + c.border("│"),
					c.border(`╰${"─".repeat(innerWidth)}╯`),
				];
			},
			invalidate() {},
			handleInput(data: string) {
				if (data === "\u001b[A") selected = Math.max(0, selected - 1);
				else if (data === "\u001b[B")
					selected = Math.min((state.scopes?.length ?? 1) - 1, selected + 1);
				else if (data === "\u001b" || data === "q") return done();
				else if (data === "o")
					ctx.ui.setEditorText(
						`file://${state.scopes?.[selected]?.configPath ?? ""}`,
					);
				tui.requestRender();
			},
		}),
		{
			overlay: true,
			overlayOptions: {
				width: "92%",
				maxHeight: "88%",
				anchor: "center",
				margin: 1,
			},
		},
	);
}

export function renderTui(ui: TuiApi, state: TuiState): void {
	ui.setStatus("context-tree", statusText(state));
	ui.setWidget(
		"context-tree",
		state.enabled ? widgetLines(state, ui.theme) : undefined,
	);
}

function summarizeScope(
	cwd: string,
	scope: ContextScope,
	all: ContextScope[],
	bundle?: Bundle,
	last?: LastInjection,
): ScopeSummary {
	const hooks = scope.config.hooks;
	const state = scope.config.stability?.state ?? "unspecified";
	const children = all
		.filter((s) => s.dir !== scope.dir && path.dirname(s.dir) === scope.dir)
		.map((s) => s.basePath);
	const lastTouches =
		last &&
		(last.target === `<${last.operation}>` ||
			path.resolve(cwd, last.target).startsWith(scope.dir));
	return {
		basePath: scope.basePath,
		configPath: scope.configPath,
		state,
		confidence: confidenceFor(state, scope),
		hookCount: hooks.length,
		pathAwareHookCount: hooks.filter((h) => h.match).length,
		pathlessHookCount: hooks.filter((h) => !h.match).length,
		...(bundle
			? { lastHook: bundle.operation, lastBundleHash: bundle.bundleHash }
			: {}),
		...(lastTouches && last
			? { lastHook: last.operation, lastBundleHash: last.bundleHash }
			: {}),
		sourceCount: hooks.reduce((sum, hook) => sum + hook.inject.length, 0),
		children,
		...(scope.config.stability?.summary
			? { summary: scope.config.stability.summary }
			: {}),
		...(scope.config.stability?.updatedAt
			? { updatedAt: scope.config.stability.updatedAt }
			: {}),
		...(scope.config.stability?.updatedBy
			? { updatedBy: scope.config.stability.updatedBy }
			: {}),
	};
}

function referenceForSource(
	cwd: string,
	source: LoadedSource,
): InjectionReference {
	const lines = countLines(source.content ?? "");
	const tokensApprox = estimateTokens(source.content ?? "");
	const base = {
		mode: source.mode.type,
		contextId: source.contextId,
		lines,
		tokensApprox,
		...(source.reason ? { reason: source.reason } : {}),
	};
	if (source.type === "file") {
		const absolutePath =
			source.absolutePath ?? path.resolve(cwd, source.sourceId);
		return {
			...base,
			id: source.sourceId,
			kind: "file",
			uri: `file://${absolutePath}`,
		};
	}
	return { ...base, id: source.sourceId, kind: "url", uri: source.url };
}

function confidenceFor(
	state: string,
	scope: ContextScope,
): ScopeSummary["confidence"] {
	if (["canonical", "stable", "generated"].includes(state)) return "high";
	if (
		["in_progress", "experimental"].includes(state) ||
		scope.config.hooks.length === 0
	)
		return "medium";
	return "low";
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
function shortenUrl(value: string): string {
	try {
		const url = new URL(value);
		const file = url.pathname.split("/").filter(Boolean).at(-1) ?? url.hostname;
		return `${url.hostname}/…/${file}`;
	} catch {
		return value.length > 72 ? `${value.slice(0, 71)}…` : value;
	}
}

function sessionColor(
	mode: SessionSummary["mode"],
	c: ReturnType<typeof panelColors>,
): (text: string) => string {
	if (mode === "main") return c.success;
	if (mode === "branch") return c.warning;
	return c.dim;
}

function boxRows(
	rows: Array<[string, string]>,
	c = panelColors(undefined),
): string[] {
	return [
		c.border("┌──────────┬────────────────────────────────────────┐"),
		...rows.map(
			([k, v]) =>
				`${c.border("│")} ${padAnsi(k, 8)} ${c.border("│")} ${padAnsi(v, 38)} ${c.border("│")}`,
		),
		c.border("└──────────┴────────────────────────────────────────┘"),
	];
}
function panelColors(theme: any) {
	const ansi = (code: string, text: string) =>
		theme ? `\u001b[${code}m${text}\u001b[0m` : text;
	const fg = (name: string, code: string) => (text: string) =>
		theme?.fg ? theme.fg(name, text) : ansi(code, text);
	return {
		border: fg("borderAccent", "36"),
		title: (text: string) =>
			theme?.bold ? fg("accent", "36")(theme.bold(text)) : ansi("1;36", text),
		success: fg("success", "32"),
		warning: fg("warning", "33"),
		error: fg("error", "31"),
		accent: fg("accent", "36"),
		muted: fg("muted", "2"),
		dim: fg("dim", "2"),
		hint: (text: string) => ansi("3;2", text),
	};
}

function colorDetailLine(
	line: string,
	c: ReturnType<typeof panelColors>,
): string {
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

function framedTitle(
	title: string,
	width: number,
	border: (text: string) => string,
): string {
	const titleWidth = visibleAnsiWidth(title);
	const fill = Math.max(0, width - titleWidth);
	const left = Math.floor(fill / 2);
	return (
		border("╭" + "─".repeat(left)) +
		title +
		border("─".repeat(fill - left) + "╮")
	);
}

function padAnsi(value: string, width: number): string {
	const clipped = truncateAnsi(value, width);
	return clipped + " ".repeat(Math.max(0, width - visibleAnsiWidth(clipped)));
}

function truncateAnsi(value: string, width: number): string {
	return visibleAnsiWidth(value) <= width
		? value
		: `${stripAnsi(value).slice(0, Math.max(0, width - 1))}…`;
}

function visibleAnsiWidth(value: string): number {
	return stripAnsi(value).length;
}

function stripAnsi(value: string): string {
	const esc = String.fromCharCode(27);
	const bel = String.fromCharCode(7);
	const sgr = new RegExp(`${esc}\\[[0-9;]*m`, "g");
	const osc8 = new RegExp(`${esc}]8;;.*?${bel}`, "g");
	return value.replace(sgr, "").replace(osc8, "");
}

function safeCall<T>(fn: () => T, fallback: T): T {
	try {
		return fn();
	} catch {
		return fallback;
	}
}
function countLines(value: string): number {
	return value ? value.split(/\r\n|\r|\n/).length : 0;
}
function estimateTokens(value: string): number {
	return Math.ceil(value.length / 4);
}
function formatNumber(value: number): string {
	return new Intl.NumberFormat("en", {
		notation: value >= 10_000 ? "compact" : "standard",
	}).format(value);
}
function padCell(value: string, width: number): string {
	return (
		value.length > width ? `${value.slice(0, width - 1)}…` : value
	).padEnd(width, " ");
}
function short(value: string): string {
	return value.length > 12 ? value.slice(0, 12) : value;
}
function osc8(uri: string, label: string): string {
	return `\u001B]8;;${uri}\u0007${label}\u001B]8;;\u0007`;
}
