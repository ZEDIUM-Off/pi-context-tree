import type { Dirent } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { globalContextPath } from "../scan.js";
import { contextFileSchema } from "../schema.js";
import { currentSchemaUrl, parseSchemaRef } from "./schema-ref.js";

export type UpgradePlanItem = {
	path: string;
	status: "current" | "outdated" | "local" | "missing" | "unknown" | "invalid";
	message: string;
	before?: unknown;
	after?: unknown;
};

export async function buildUpgradePlan(
	cwd: string,
	version?: string,
): Promise<UpgradePlanItem[]> {
	const targetSchema = currentSchemaUrl(version);
	const out: UpgradePlanItem[] = [];
	for (const configPath of await listContextJsonPaths(cwd)) {
		const raw = await readJsonObject(configPath);
		if (!raw.ok) {
			out.push({ path: configPath, status: "invalid", message: raw.message });
			continue;
		}
		const schemaRef =
			typeof raw.value.$schema === "string" ? raw.value.$schema : undefined;
		const ref = parseSchemaRef(schemaRef);
		const after = migrateLegacyHooks({ ...raw.value, $schema: targetSchema });
		const validation = contextFileSchema.safeParse(after);
		if (!validation.success) {
			out.push({
				path: configPath,
				status: "invalid",
				message: `schema set to target; remaining validation error: ${validation.error.message}`,
				before: raw.value,
				after,
			});
			continue;
		}
		if (schemaRef === targetSchema) {
			out.push({ path: configPath, status: "current", message: "schema current" });
			continue;
		}
		out.push({
			path: configPath,
			status: upgradeStatus(ref.kind),
			message: `set schema ${ref.raw ?? "<missing>"} -> ${targetSchema}`,
			before: raw.value,
			after,
		});
	}
	return out.sort((a, b) => a.path.localeCompare(b.path));
}

function upgradeStatus(
	kind: ReturnType<typeof parseSchemaRef>["kind"],
): UpgradePlanItem["status"] {
	if (kind === "github-release" || kind === "github-dev") return "outdated";
	return kind;
}

type JsonReadResult =
	| { ok: true; value: Record<string, unknown> }
	| { ok: false; message: string };

async function readJsonObject(filePath: string): Promise<JsonReadResult> {
	try {
		const value: unknown = JSON.parse(await readFile(filePath, "utf8"));
		if (value && typeof value === "object" && !Array.isArray(value))
			return { ok: true, value: value as Record<string, unknown> };
		return { ok: false, message: "CONTEXT.json must contain a JSON object" };
	} catch (error) {
		return {
			ok: false,
			message: error instanceof Error ? error.message : String(error),
		};
	}
}

function migrateLegacyHooks(value: Record<string, unknown>): Record<string, unknown> {
	if (!Array.isArray(value.hooks)) return value;
	const sources: Record<string, unknown> = isRecord(value.sources)
		? { ...value.sources }
		: {};
	const rulesByMatch = new Map<string, { match?: string[]; inject: unknown[] }>();
	for (const hook of value.hooks) {
		if (!isRecord(hook) || typeof hook.on !== "string" || !Array.isArray(hook.inject))
			continue;
		const explicitMatch = Array.isArray(hook.match)
			? hook.match.filter((item): item is string => typeof item === "string")
			: undefined;
		const match = explicitMatch ?? (isLegacyPathAwareHook(hook.on) ? ["**/*"] : undefined);
		const key = JSON.stringify(match ?? null);
		const rule = rulesByMatch.get(key) ?? {
			...(match ? { match } : {}),
			inject: [],
		};
		for (const source of hook.inject) {
			const normalized = normalizeLegacySource(source);
			if (!normalized) continue;
			const sourceId = sourceIdFor(normalized, sources);
			sources[sourceId] = normalized.source;
			rule.inject.push({ source: sourceId, on: hook.on, ...normalized.override });
		}
		rulesByMatch.set(key, rule);
	}
	const { hooks: _hooks, ...rest } = value;
	return {
		...rest,
		sources,
		injection_rules: [
			...(Array.isArray(value.injection_rules) ? value.injection_rules : []),
			...rulesByMatch.values(),
		],
	};
}

function isLegacyPathAwareHook(hook: string): boolean {
	return hook.startsWith("tool:") || hook === "session:spawn" || hook === "subagent:spawn";
}

function normalizeLegacySource(
	input: unknown,
): { source: Record<string, unknown>; override: Record<string, unknown> } | undefined {
	let source: Record<string, unknown>;
	if (typeof input === "string")
		source = input.startsWith("http://") || input.startsWith("https://")
			? { type: "url", url: input, mode: { type: "ref" } }
			: { type: "file", path: input, mode: { type: "ref" } };
	else if (isRecord(input)) source = { ...input };
	else return undefined;
	const override: Record<string, unknown> = {};
	for (const key of ["kind", "reason", "mode", "cache", "budget"])
		if (source[key] !== undefined) override[key] = source[key];
	return { source, override };
}

function sourceIdFor(
	value: { source: Record<string, unknown> },
	existing: Record<string, unknown>,
): string {
	const location =
		typeof value.source.path === "string"
			? value.source.path
			: typeof value.source.url === "string"
				? value.source.url
				: "source";
	const base =
		location
			.replace(/^https?:\/\//, "")
			.replace(/[^a-zA-Z0-9]+/g, "_")
			.replace(/^_+|_+$/g, "")
			.slice(0, 48) || "source";
	let id = base;
	let index = 2;
	const serialized = JSON.stringify(value.source);
	while (existing[id] && JSON.stringify(existing[id]) !== serialized) {
		id = `${base}_${index}`;
		index += 1;
	}
	return id;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function listContextJsonPaths(cwd: string): Promise<string[]> {
	const paths = new Set<string>();
	try {
		await readFile(globalContextPath(), "utf8");
		paths.add(globalContextPath());
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== "ENOENT")
			paths.add(globalContextPath());
	}

	async function walk(dir: string): Promise<void> {
		let entries: Dirent[];
		try {
			entries = await readdir(dir, { withFileTypes: true });
		} catch {
			return;
		}
		for (const entry of entries) {
			if (
				entry.name === "node_modules" ||
				entry.name === ".git" ||
				entry.name === ".pi"
			)
				continue;
			const full = path.join(dir, entry.name);
			if (entry.isDirectory()) {
				await walk(full);
				continue;
			}
			if (entry.isFile() && entry.name === "CONTEXT.json") paths.add(full);
		}
	}

	await walk(cwd);
	return [...paths];
}
