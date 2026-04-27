import { readFile } from "node:fs/promises";
import path from "node:path";
import { readUrlCached } from "./cache.js";
import { extractContent } from "./extract.js";
import { contextId, matchGlobs, operationMatches } from "./match.js";
import {
	dedupeSources,
	type NormalizedSource,
	normalizeInject,
} from "./normalize.js";
import type { ContextScope } from "./scan.js";
import type { ContextBlock, Operation } from "./schema.js";
import { sha256, stripAtPrefix, toPosix } from "./util.js";

export type LoadedSource = NormalizedSource & {
	content: string;
	sourceId: string;
	warnings: string[];
	cacheMeta?: unknown;
};

export type Bundle = {
	targetPath: string;
	operation: Operation;
	bundleHash: string;
	contextIds: string[];
	sources: LoadedSource[];
	warnings: string[];
};

export type ExplainResult = {
	targetPath: string;
	operation: Operation;
	matched: Array<{
		scope: ContextScope;
		block: ContextBlock;
		contextId: string;
	}>;
	sources: NormalizedSource[];
	warnings: string[];
};

export function explainPath(
	cwd: string,
	scopes: ContextScope[],
	targetPath: string,
	operation: Operation = "agent_start",
): ExplainResult {
	const absoluteTarget = path.resolve(cwd, stripAtPrefix(targetPath));
	const relativeTarget = toPosix(path.relative(cwd, absoluteTarget));
	const matched: ExplainResult["matched"] = [];
	const sources: NormalizedSource[] = [];
	const warnings: string[] = [];

	for (const scope of scopes) {
		const relativeToScope = toPosix(path.relative(scope.dir, absoluteTarget));
		if (relativeToScope.startsWith("..")) continue;
		for (const block of scope.config.context) {
			if (!operationMatches(block.operations, operation)) continue;
			if (!matchGlobs(block.match, relativeToScope || ".")) continue;
			const id = contextId(scope, block);
			matched.push({ scope, block, contextId: id });
			for (const source of block.inject)
				sources.push(normalizeInject(source, scope, block, id));
		}
	}
	return {
		targetPath: relativeTarget,
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
			explain.operation === "read" &&
			source.type === "file" &&
			source.absolutePath === absoluteTarget
		) {
			warnings.push(
				`Skipped self-injection for read target: ${explain.targetPath}`,
			);
			continue;
		}
		try {
			loaded.push(await loadSource(cwd, source, options));
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			if (source.required) throw new Error(message);
			warnings.push(message);
		}
	}
	const hashInput = loaded
		.map((s) => `${s.sourceId}\n${s.content}`)
		.join("\n---\n");
	return {
		targetPath: explain.targetPath,
		operation: explain.operation,
		contextIds: [...new Set(explain.matched.map((m) => m.contextId))],
		sources: loaded,
		warnings,
		bundleHash: sha256(hashInput),
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
			content: extractContent(raw, source.extract),
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
		content: extractContent(cached.content, source.extract),
		sourceId: source.url,
		warnings: cached.warning ? [cached.warning] : [],
		cacheMeta: cached.meta,
	};
}

export function renderBundle(bundle: Bundle): string {
	const lines = [
		"# Context Tree Bundle",
		"",
		`Target: \`${bundle.targetPath}\``,
		`Operation: \`${bundle.operation}\``,
		`Bundle: \`${bundle.bundleHash}\``,
		"",
		"## Loaded sources",
	];
	for (const source of bundle.sources) lines.push(`- ${source.sourceId}`);
	if (bundle.warnings.length)
		lines.push("", "## Warnings", ...bundle.warnings.map((w) => `- ${w}`));
	for (const source of bundle.sources)
		lines.push(
			"",
			`## Source: ${source.sourceId}`,
			"",
			source.content.trimEnd(),
		);
	return lines.join("\n");
}

export function formatExplain(cwd: string, result: ExplainResult): string {
	const lines = [
		`Context tree explain: ${result.targetPath}`,
		`Operation: ${result.operation}`,
		"",
		"Matched contexts:",
	];
	if (!result.matched.length) lines.push("- none");
	for (const match of result.matched)
		lines.push(
			`- ${toPosix(path.relative(cwd, match.scope.configPath))} id=${match.contextId.slice(0, 12)} match=${JSON.stringify(match.block.match)} operations=${JSON.stringify(match.block.operations)}`,
		);
	lines.push("", "Inject sources:");
	if (!result.sources.length) lines.push("- none");
	for (const source of result.sources)
		lines.push(
			`- ${source.type === "file" ? toPosix(path.relative(cwd, source.absolutePath ?? "")) : source.url}${source.required ? " required" : ""}`,
		);
	return lines.join("\n");
}

export function parsePromptPaths(prompt: string): string[] {
	const found = new Set<string>();
	for (const m of prompt.matchAll(/@([\w./-]+\.[\w]+)/g)) if (m[1]) found.add(m[1]);
	for (const m of prompt.matchAll(
		/(?:^|\s)([\w./-]+\.(?:ts|tsx|js|jsx|md|json|py|go|rs))/g,
	))
		if (m[1]) found.add(m[1]);
	return [...found];
}
