import { access } from "node:fs/promises";
import path from "node:path";
import type { ContextFile } from "../schema.js";
import { contextFileSchema } from "../schema.js";
import type {
	GeneratedContextFile,
	InitSession,
	ReferenceProposal,
	ScopeProposal,
} from "./types.js";

export function currentReleaseSchemaUrl(version = "0.2.0"): string {
	return `https://raw.githubusercontent.com/ZEDIUM-Off/pi-context-tree/v${version}/schemas/context.schema.json`;
}

export async function generateContextFiles(
	session: InitSession,
	version?: string,
): Promise<GeneratedContextFile[]> {
	const out: GeneratedContextFile[] = [];
	for (const scope of session.scopes.filter((item) => item.enabled)) {
		const config = configForScope(scope, session, version);
		const parsed = contextFileSchema.parse(config);
		const filePath = path.join(session.cwd, scope.path, "CONTEXT.json");
		out.push({
			path:
				path.relative(session.cwd, filePath).replaceAll(path.sep, "/") ||
				"CONTEXT.json",
			action: (await exists(filePath)) ? "update" : "create",
			kind: "context",
			config: parsed,
			warnings: [],
		});
		for (const docPath of referencedGeneratedDocs(scope)) {
			const full = path.join(session.cwd, docPath);
			if (await exists(full)) continue;
			out.push({
				path: docPath,
				action: "create",
				kind: "doc",
				content: generatedDocContent(scope),
				warnings: [],
			});
		}
	}
	return out;
}

function configForScope(
	scope: ScopeProposal,
	session: InitSession,
	version?: string,
): ContextFile {
	const rules = withReferenceHooks(scope, session).map(normalizeHook);
	const sources: ContextFile["sources"] = {};
	const injectionRules: ContextFile["injection_rules"] = [];
	for (const hook of rules) {
		const inject = hook.inject.map((source) => {
			const normalized = normalizeInject(source);
			const id = sourceIdFor(normalized, sources);
			sources[id] = normalized;
			return { source: id, on: hook.on as ContextFile["injection_rules"][number]["inject"][number]["on"] };
		});
		injectionRules.push({
			...(hook.match ? { match: hook.match } : {}),
			inject,
		});
	}
	return {
		$schema: currentReleaseSchemaUrl(version),
		stability: {
			state: scope.stability.state,
			summary: scope.stability.summary,
			updatedAt: new Date().toISOString().slice(0, 10),
			updatedBy: "ct-init",
		},
		sources,
		injection_rules: injectionRules,
	};
}

function withReferenceHooks(scope: ScopeProposal, session: InitSession) {
	const refs = session.references.filter(
		(ref) => ref.enabled && ref.scopePath === scope.path,
	);
	if (!refs.length) return scope.hooks;
	return [
		...scope.hooks,
		{
			on: "agent:start",
			inject: refs.map(referenceToInject),
		},
	];
}

function referenceToInject(ref: ReferenceProposal) {
	return {
		type: "url",
		url: referenceUrl(ref),
		kind: ref.kind === "context7" ? "context7" : "reference",
		mode: { type: "ref" },
		reason: `${ref.title}: ${ref.reason}`,
	};
}

function referenceUrl(ref: ReferenceProposal): string {
	if (ref.kind !== "context7") return ref.url;
	if (/^https?:\/\//.test(ref.url)) return ref.url;
	const libraryId = ref.libraryId ?? ref.url.replace(/^context7:/, "");
	return `https://context7.com/${libraryId.replace(/^\/+/, "")}`;
}

function normalizeHook(hook: {
	on: string;
	match?: string[];
	inject: unknown[];
}) {
	return {
		...hook,
		inject: hook.inject.map(normalizeInject),
	};
}

function normalizeInject(source: unknown): ContextFile["sources"][string] {
	if (typeof source === "string") {
		if (source.startsWith("context7:"))
			return {
				type: "url",
				url: `https://context7.com/${source.slice("context7:".length).replace(/^\/+/, "")}`,
				kind: "context7",
				mode: { type: "ref" },
			};
		if (/^https?:\/\//.test(source))
			return { type: "url", url: source, mode: { type: "ref" } };
		return { type: "file", path: source, mode: { type: "ref" } };
	}
	if (typeof source !== "object" || !source)
		return { type: "file", path: "./docs/context-tree/generated.md", mode: { type: "ref" } };
	const record = source as Record<string, unknown>;
	if (record.type === "url" && typeof record.url === "string")
		return {
			type: "url",
			url: record.url.startsWith("context7:")
				? `https://context7.com/${record.url.slice("context7:".length).replace(/^\/+/, "")}`
				: record.url,
			...(typeof record.kind === "string" ? { kind: record.kind } : {}),
			mode: isMode(record.mode) ? record.mode : { type: "ref" },
			...(typeof record.reason === "string" ? { reason: record.reason } : {}),
		};
	if (record.type === "file" && typeof record.path === "string")
		return {
			type: "file",
			path: record.path,
			...(typeof record.kind === "string" ? { kind: record.kind } : {}),
			mode: isMode(record.mode) ? record.mode : { type: "ref" },
			...(typeof record.reason === "string" ? { reason: record.reason } : {}),
		};
	if (typeof record.url === "string")
		return { type: "url", url: record.url, mode: { type: "ref" } };
	if (typeof record.path === "string")
		return { type: "file", path: record.path, mode: { type: "ref" } };
	return { type: "file", path: "./docs/context-tree/generated.md", mode: { type: "ref" } };
}

function isMode(value: unknown): value is ContextFile["sources"][string]["mode"] {
	return typeof value === "object" && value !== null && typeof (value as { type?: unknown }).type === "string";
}

function sourceIdFor(source: ContextFile["sources"][string], existing: ContextFile["sources"]): string {
	const base = source.type === "file" ? source.path : source.url;
	const slug = base
		.replace(/^https?:\/\//, "")
		.replace(/[^a-zA-Z0-9]+/g, "_")
		.replace(/^_+|_+$/g, "")
		.slice(0, 48) || "source";
	let id = slug;
	let suffix = 2;
	const value = JSON.stringify(source);
	while (existing[id] && JSON.stringify(existing[id]) !== value) {
		id = `${slug}_${suffix}`;
		suffix += 1;
	}
	return id;
}

function referencedGeneratedDocs(scope: ScopeProposal): string[] {
	const docs = new Set<string>();
	for (const hook of scope.hooks) {
		for (const source of hook.inject) {
			if (!isFileInjectSource(source)) continue;
			const sourcePath = source.path;
			if (!sourcePath?.includes("docs/context-tree/")) continue;
			const normalized = path
				.normalize(path.join(scope.path === "." ? "" : scope.path, sourcePath))
				.replaceAll(path.sep, "/");
			docs.add(normalized);
		}
	}
	return [...docs].sort();
}

function isFileInjectSource(
	source: unknown,
): source is { type: "file"; path?: string } {
	return (
		typeof source === "object" &&
		source !== null &&
		(source as { type?: unknown }).type === "file"
	);
}

function generatedDocContent(scope: ScopeProposal): string {
	return `# ${scope.label}\n\nGenerated by /ct-init. Human choices are authoritative; edit this guidance before relying on it.\n\n## Scope\n\n${scope.reason}\n\n## Stable patterns\n\n- TODO\n\n## Avoid inferring from\n\n- TODO\n`;
}

async function exists(filePath: string): Promise<boolean> {
	try {
		await access(filePath);
		return true;
	} catch {
		return false;
	}
}
