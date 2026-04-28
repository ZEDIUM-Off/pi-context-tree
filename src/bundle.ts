import { readFile } from "node:fs/promises";
import path from "node:path";
import { readUrlCached } from "./cache.js";
import { extractContent } from "./extract.js";
import { contextId, matchGlobs } from "./match.js";
import {
	dedupeSources,
	type NormalizedSource,
	normalizeInject,
} from "./normalize.js";
import type { ContextScope } from "./scan.js";
import type { HookBlock, HookName, StabilityConfig } from "./schema.js";
import { sha256, stripAtPrefix, toPosix } from "./util.js";

export type LoadedSource = NormalizedSource & {
	content?: string;
	sourceId: string;
	warnings: string[];
	cacheMeta?: unknown;
};

export type Bundle = {
	targetPath: string;
	operation: HookName;
	bundleHash: string;
	contextIds: string[];
	stability?: ScopeStability;
	sources: LoadedSource[];
	warnings: string[];
};

export type ScopeStability = {
	scope: ContextScope;
	config: StabilityConfig;
};

export type ExplainResult = {
	targetPath: string;
	operation: HookName;
	matched: Array<{
		scope: ContextScope;
		block: HookBlock;
		contextId: string;
	}>;
	sources: NormalizedSource[];
	stability?: ScopeStability;
	warnings: string[];
};

export function explainPath(
	cwd: string,
	scopes: ContextScope[],
	targetPath: string,
	operation: HookName = "agent:start",
): ExplainResult {
	const absoluteTarget = path.resolve(cwd, stripAtPrefix(targetPath));
	const relativeTarget = toPosix(path.relative(cwd, absoluteTarget));
	const matched: ExplainResult["matched"] = [];
	const sources: NormalizedSource[] = [];
	const warnings: string[] = [];

	for (const scope of scopes) {
		const relativeToScope = toPosix(path.relative(scope.dir, absoluteTarget));
		if (relativeToScope.startsWith("..")) continue;
		for (const block of scope.config.hooks) {
			if (block.on !== operation) continue;
			if (block.match && !matchGlobs(block.match, relativeToScope || "."))
				continue;
			const id = contextId(scope, block);
			matched.push({ scope, block, contextId: id });
			for (const source of block.inject)
				sources.push(normalizeInject(source, scope, block, id));
		}
	}
	const stability = findNearestStability(scopes, absoluteTarget);
	return {
		targetPath: relativeTarget,
		operation,
		matched,
		sources: dedupeSources(sources),
		...(stability ? { stability } : {}),
		warnings,
	};
}

function findNearestStability(
	scopes: ContextScope[],
	absoluteTarget: string,
): ScopeStability | undefined {
	let nearest: ScopeStability | undefined;
	for (const scope of scopes) {
		if (!scope.config.stability) continue;
		const relativeToScope = toPosix(path.relative(scope.dir, absoluteTarget));
		if (relativeToScope.startsWith("..")) continue;
		if (!nearest || scope.dir.length >= nearest.scope.dir.length)
			nearest = { scope, config: scope.config.stability };
	}
	return nearest;
}

export function explainHook(
	_cwd: string,
	scopes: ContextScope[],
	operation: HookName,
): ExplainResult {
	const matched: ExplainResult["matched"] = [];
	const sources: NormalizedSource[] = [];
	const warnings: string[] = [];
	for (const scope of scopes) {
		for (const block of scope.config.hooks) {
			if (block.on !== operation) continue;
			if (block.match) continue;
			const id = contextId(scope, block);
			matched.push({ scope, block, contextId: id });
			for (const source of block.inject)
				sources.push(normalizeInject(source, scope, block, id));
		}
	}
	return {
		targetPath: `<${operation}>`,
		operation,
		matched,
		sources: dedupeSources(sources),
		warnings,
	};
}

export async function buildBundle(
	cwd: string,
	explain: ExplainResult,
	options: { fetcher?: typeof fetch } = {},
): Promise<Bundle> {
	const loaded: LoadedSource[] = [];
	const warnings = [...explain.warnings];
	const absoluteTarget = path.resolve(cwd, stripAtPrefix(explain.targetPath));
	for (const source of explain.sources) {
		if (
			explain.operation === "tool:read" &&
			source.type === "file" &&
			source.absolutePath === absoluteTarget
		) {
			warnings.push(
				`Skipped self-injection for read target: ${explain.targetPath}`,
			);
			continue;
		}
		try {
			loaded.push(
				source.mode.type === "ref"
					? referenceSource(cwd, source)
					: await loadSource(cwd, source, options),
			);
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			throw new Error(message);
		}
	}
	const hashInput = loaded
		.map((s) => `${s.sourceId}\n${s.content ?? "<reference>"}`)
		.join("\n---\n");
	return {
		targetPath: explain.targetPath,
		operation: explain.operation,
		contextIds: [...new Set(explain.matched.map((m) => m.contextId))],
		...(explain.stability ? { stability: explain.stability } : {}),
		sources: loaded,
		warnings,
		bundleHash: sha256(hashInput),
	};
}

function referenceSource(cwd: string, source: NormalizedSource): LoadedSource {
	return {
		...source,
		sourceId:
			source.type === "file"
				? toPosix(path.relative(cwd, source.absolutePath ?? source.path))
				: source.url,
		warnings: [],
	};
}

async function loadSource(
	cwd: string,
	source: NormalizedSource,
	options: { fetcher?: typeof fetch },
): Promise<LoadedSource> {
	if (source.type === "file") {
		if (!source.absolutePath)
			throw new Error("file source missing absolutePath");
		const rel = toPosix(path.relative(cwd, source.absolutePath));
		if (rel.startsWith(".."))
			throw new Error(`Path escapes repo: ${source.path}`);
		const raw = await readFile(source.absolutePath, "utf8");
		return {
			...source,
			content: extractSourceContent(raw, source),
			sourceId: rel,
			warnings: [],
		};
	}
	const cached = await readUrlCached(
		cwd,
		source.url,
		source.cache,
		options.fetcher ?? fetch,
	);
	return {
		...source,
		content: extractSourceContent(cached.content, source),
		sourceId: source.url,
		warnings: cached.warning ? [cached.warning] : [],
		cacheMeta: cached.meta,
	};
}

function extractSourceContent(raw: string, source: NormalizedSource): string {
	const mode = source.mode;
	if (mode.type === "inline") return raw;
	if (mode.type === "lines") return extractContent(raw, { lines: mode.ranges });
	if (mode.type === "sections")
		return extractContent(raw, { sections: mode.names });
	if (mode.type === "markers")
		return extractContent(raw, { markers: mode.names });
	if (mode.type === "segments")
		return extractContent(raw, { segments: mode.items });
	return raw;
}

function formatMode(mode: NormalizedSource["mode"]): string {
	if (mode.type === "lines") return `lines ${mode.ranges.join(", ")}`;
	if (mode.type === "sections") return `sections ${mode.names.join(", ")}`;
	if (mode.type === "markers") return `markers ${mode.names.join(", ")}`;
	if (mode.type === "segments") return `segments ${mode.items.length}`;
	return mode.type;
}

function stabilityMeaning(state: StabilityConfig["state"]): string {
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

export function parsePromptPaths(prompt: string): string[] {
	const found = new Set<string>();
	for (const m of prompt.matchAll(/@([\w./-]+\.[\w]+)/g))
		if (m[1]) found.add(m[1]);
	for (const m of prompt.matchAll(
		/(?:^|\s)([\w./-]+\.(?:ts|tsx|js|jsx|md|json|py|go|rs))/g,
	))
		if (m[1]) found.add(m[1]);
	return [...found];
}
