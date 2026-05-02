import { readFile } from "node:fs/promises";
import path from "node:path";
import { readUrlCached } from "../cache.js";
import { extractContent } from "../extract.js";
import type { InjectionMode } from "../schema.js";
import { toPosix } from "../util.js";
import type { ActiveInjection } from "./active-injection-registry.js";
import type { RuntimeInjectionParam } from "./injection-params-registry.js";
import type { ResourceRegistry, RuntimeResource } from "./resource-registry.js";

export type ExtractionRequest = {
	cwd: string;
	param: RuntimeInjectionParam;
	resource: RuntimeResource;
	fetcher?: typeof fetch;
};

export type ExtractedSource = {
	param: RuntimeInjectionParam;
	resource: RuntimeResource;
	sourceId: string;
	content?: string;
	warnings: string[];
	provider: string;
	cacheMeta?: unknown;
	active?: ActiveInjection;
};

export interface ExtractionProvider {
	name: string;
	supports(request: ExtractionRequest): boolean;
	extract(request: ExtractionRequest): Promise<ExtractedSource>;
}

export type BundlePlan = {
	cwd: string;
	sources: ExtractedSource[];
	warnings: string[];
};

export type RenderedContextStack = {
	content: string;
	provider: string;
	warnings: string[];
	tokenEstimate: number;
};

export interface PackingProvider {
	name: string;
	supports(plan: BundlePlan): boolean;
	pack(plan: BundlePlan): Promise<RenderedContextStack>;
}

function sourceId(cwd: string, resource: RuntimeResource): string {
	if (resource.type === "url") return resource.url ?? resource.key.slice("url:".length);
	const absolute = resource.absolutePath ?? resource.key.slice("file:".length);
	const relative = toPosix(path.relative(cwd, absolute));
	return relative.startsWith("..") ? absolute : relative;
}

function modeExtract(mode: InjectionMode): Parameters<typeof extractContent>[1] | undefined {
	if (mode.type === "lines") return { lines: mode.ranges };
	if (mode.type === "sections") return { sections: mode.names };
	if (mode.type === "markers") return { markers: mode.names };
	if (mode.type === "segments") return { segments: mode.items };
	return undefined;
}

export class RefExtractionProvider implements ExtractionProvider {
	readonly name = "ref";
	supports(request: ExtractionRequest): boolean {
		return request.param.mode.type === "ref";
	}
	async extract(request: ExtractionRequest): Promise<ExtractedSource> {
		return { param: request.param, resource: request.resource, sourceId: sourceId(request.cwd, request.resource), warnings: [], provider: this.name };
	}
}

export class FileSystemExtractionProvider implements ExtractionProvider {
	readonly name = "filesystem";
	supports(request: ExtractionRequest): boolean {
		return request.resource.type === "file" && request.param.mode.type !== "ref";
	}
	async extract(request: ExtractionRequest): Promise<ExtractedSource> {
		const absolutePath = request.resource.absolutePath ?? request.resource.key.slice("file:".length);
		const raw = await readFile(absolutePath, "utf8");
		const content = request.param.mode.type === "inline" ? raw : extractContent(raw, modeExtract(request.param.mode));
		return { param: request.param, resource: request.resource, sourceId: sourceId(request.cwd, request.resource), content, warnings: [], provider: this.name };
	}
}

export class UrlCacheExtractionProvider implements ExtractionProvider {
	readonly name = "url-cache";
	supports(request: ExtractionRequest): boolean {
		return request.resource.type === "url" && request.param.mode.type !== "ref";
	}
	async extract(request: ExtractionRequest): Promise<ExtractedSource> {
		const url = request.resource.url ?? request.resource.key.slice("url:".length);
		const cached = await readUrlCached(request.cwd, url, request.param.cache, request.fetcher ?? fetch);
		const content = request.param.mode.type === "inline" ? cached.content : extractContent(cached.content, modeExtract(request.param.mode));
		return { param: request.param, resource: request.resource, sourceId: sourceId(request.cwd, request.resource), content, warnings: cached.warning ? [cached.warning] : [], provider: this.name, cacheMeta: cached.meta };
	}
}

export class ContextTreeMarkdownPacker implements PackingProvider {
	readonly name = "context-tree-markdown";
	supports(): boolean {
		return true;
	}
	async pack(plan: BundlePlan): Promise<RenderedContextStack> {
		const lines = [
			`<!-- context-tree:active-stack:start sources=${plan.sources.length} -->`,
			"# Context Tree Active Stack",
			"",
			`Active sources: ${plan.sources.length}`,
		];
		const warnings = [...plan.warnings, ...plan.sources.flatMap((source) => source.warnings)];
		if (warnings.length) lines.push("", "## Warnings", ...warnings.map((warning) => `- ${warning}`));
		lines.push("", "## Sources");
		for (const source of plan.sources) {
			lines.push(`- ${source.sourceId} (${formatMode(source.param.mode)}) via ${source.provider}`);
			if (source.active) lines.push(`  trigger: ${formatTraceSummary(source.active)}`);
		}
		for (const source of plan.sources) {
			lines.push("", `## Source: ${source.sourceId}`, "", `Mode: ${formatMode(source.param.mode)}`);
			if (source.param.kind) lines.push(`Kind: ${source.param.kind}`);
			if (source.param.reason) lines.push(`Reason: ${source.param.reason}`);
			if (source.active) lines.push("", "### Activation", "", ...formatTraceLines(source.active));
			if (source.content !== undefined) lines.push("", "### Content", "", source.content.trimEnd());
			else if (source.resource.type === "file") lines.push("", "### How to load if needed", `- read path="${source.sourceId}"`);
			else lines.push("", "### How to load if needed", `- web_fetch url="${source.sourceId}"`);
		}
		lines.push("<!-- context-tree:active-stack:end -->");
		const content = lines.join("\n");
		return { content, provider: this.name, warnings, tokenEstimate: Math.ceil(content.length / 4) };
	}
}

export class RepomixFilePacker implements PackingProvider {
	readonly name = "repomix-file";
	supports(plan: BundlePlan): boolean {
		return plan.sources.length > 1 && plan.sources.every((source) => source.resource.type === "file" && source.param.mode.type === "inline" && source.content !== undefined);
	}
	async pack(plan: BundlePlan): Promise<RenderedContextStack> {
		// Feature-gated placeholder: keep deterministic Context Tree rendering until Repomix API is wired.
		return new ContextTreeMarkdownPacker().pack(plan);
	}
}

export function defaultExtractionProviders(): ExtractionProvider[] {
	return [new RefExtractionProvider(), new FileSystemExtractionProvider(), new UrlCacheExtractionProvider()];
}

export function defaultPackingProviders(): PackingProvider[] {
	return [new RepomixFilePacker(), new ContextTreeMarkdownPacker()];
}

export async function extractActiveSources(input: { cwd: string; params: readonly RuntimeInjectionParam[]; entries?: readonly ActiveInjection[]; resources: ResourceRegistry; fetcher?: typeof fetch; providers?: ExtractionProvider[] }): Promise<{ sources: ExtractedSource[]; warnings: string[] }> {
	const providers = input.providers ?? defaultExtractionProviders();
	const sources: ExtractedSource[] = [];
	const warnings: string[] = [];
	const entriesByParam = new Map((input.entries ?? []).map((entry) => [entry.param.paramId, entry]));
	for (const param of input.params) {
		const resource = input.resources.get(param.resourceKey);
		if (!resource) {
			warnings.push(`Missing runtime resource for ${param.resourceKey}`);
			continue;
		}
		const request = { cwd: input.cwd, param, resource, ...(input.fetcher ? { fetcher: input.fetcher } : {}) };
		const provider = providers.find((item) => item.supports(request));
		if (!provider) {
			warnings.push(`No extraction provider for ${param.resourceKey} (${param.mode.type})`);
			continue;
		}
		const source = await provider.extract(request);
		const active = entriesByParam.get(param.paramId);
		sources.push(active ? { ...source, active } : source);
	}
	return { sources, warnings };
}

export async function renderContextStack(input: { cwd: string; params: readonly RuntimeInjectionParam[]; entries?: readonly ActiveInjection[]; resources: ResourceRegistry; warnings?: readonly string[]; fetcher?: typeof fetch; extractionProviders?: ExtractionProvider[]; packingProviders?: PackingProvider[] }): Promise<RenderedContextStack | undefined> {
	const extracted = await extractActiveSources({ cwd: input.cwd, params: input.params, ...(input.entries ? { entries: input.entries } : {}), resources: input.resources, ...(input.fetcher ? { fetcher: input.fetcher } : {}), ...(input.extractionProviders ? { providers: input.extractionProviders } : {}) });
	const plan = { cwd: input.cwd, sources: extracted.sources, warnings: [...(input.warnings ?? []), ...extracted.warnings] };
	if (plan.sources.length === 0 && plan.warnings.length === 0) return undefined;
	const packer = (input.packingProviders ?? defaultPackingProviders()).find((provider) => provider.supports(plan));
	if (!packer) return undefined;
	return packer.pack(plan);
}

function formatTraceSummary(entry: ActiveInjection): string {
	const trace = entry.trace;
	const prompt = trace.promptReference ? ` ${trace.promptReference}` : "";
	const synthetic = trace.synthetic ? "synthetic " : "";
	const target = trace.targets.length ? ` target=${trace.targets.join(",")}` : "";
	const source = trace.configPath && trace.configPath !== "<user-prompt>" ? ` from ${toPosix(path.relative(process.cwd(), trace.configPath))}#injection_rules[${trace.ruleIndex}].inject[${trace.injectIndex}]` : "";
	return `${trace.trigger}${prompt} -> ${synthetic}${trace.hook}${target}${source}`;
}

function formatTraceLines(entry: ActiveInjection): string[] {
	const trace = entry.trace;
	const lines = [
		`- trigger: ${trace.trigger}`,
		`- hook: ${trace.hook}`,
		`- synthetic: ${trace.synthetic}`,
		`- stack action: ${entry.action}`,
	];
	if (trace.promptReference) lines.push(`- prompt ref: ${trace.promptReference}`);
	if (trace.targets.length) lines.push(`- targets: ${trace.targets.join(", ")}`);
	if (trace.toolName) lines.push(`- tool: ${trace.toolName}`);
	if (trace.toolCallId) lines.push(`- tool call: ${trace.toolCallId}`);
	if (trace.configPath && trace.configPath !== "<user-prompt>") lines.push(`- config: ${trace.configPath}`);
	if (trace.ruleIndex !== undefined && trace.ruleIndex >= 0) lines.push(`- rule: injection_rules[${trace.ruleIndex}]`);
	if (trace.injectIndex !== undefined && trace.injectIndex >= 0) lines.push(`- inject: inject[${trace.injectIndex}]`);
	if (trace.sourceId) lines.push(`- source id: ${trace.sourceId}`);
	if (trace.reason) lines.push(`- reason: ${trace.reason}`);
	if (entry.warnings.length) lines.push(`- warnings: ${entry.warnings.length}`);
	return lines;
}

export function formatMode(mode: InjectionMode): string {
	if (mode.type === "lines") return `lines ${mode.ranges.join(", ")}`;
	if (mode.type === "sections") return `sections ${mode.names.join(", ")}`;
	if (mode.type === "markers") return `markers ${mode.names.join(", ")}`;
	if (mode.type === "segments") return `segments ${mode.items.length}`;
	return mode.type;
}
