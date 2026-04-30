import { readFile } from "node:fs/promises";
import path from "node:path";
import { readUrlCached } from "../cache.js";
import { extractContent } from "../extract.js";
import type { NormalizedSource } from "../normalize.js";
import { sha256, stripAtPrefix, toPosix } from "../util.js";
import type { Bundle, ExplainResult, LoadedSource } from "./types.js";

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
	const relativeSource =
		source.type === "file"
			? toPosix(path.relative(cwd, source.absolutePath ?? source.path))
			: undefined;
	return {
		...source,
		sourceId:
			source.type === "file"
				? relativeSource?.startsWith("..")
					? (source.absolutePath ?? source.path)
					: (relativeSource ?? source.path)
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
		if (rel.startsWith("..") && !source.owner.global)
			throw new Error(`Path escapes repo: ${source.path}`);
		const raw = await readFile(source.absolutePath, "utf8");
		return {
			...source,
			content: extractSourceContent(raw, source),
			sourceId: rel.startsWith("..") ? source.absolutePath : rel,
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
