import type { ContextScope } from "../scan.js";
import type { SourceDefinition } from "../schema.js";
import { fileResourceKey, type ResourceKey, urlResourceKey } from "./resource-key.js";

export type ResourceDeclaration = {
	configPath: string;
	localSourceId: string;
	source: SourceDefinition;
};

export type RuntimeResource = {
	key: ResourceKey;
	type: "file" | "url";
	absolutePath?: string;
	url?: string;
	declarations: ResourceDeclaration[];
};

export type ResourceRegistry = Map<ResourceKey, RuntimeResource>;

export type ConfigScopeRuntime = {
	scope: ContextScope;
	configPath: string;
	scopeDir: string;
	basePath: string;
};

export function toConfigScopeRuntime(scope: ContextScope): ConfigScopeRuntime {
	return { scope, configPath: scope.configPath, scopeDir: scope.dir, basePath: scope.basePath };
}

export function resourceKeyForSource(source: SourceDefinition, scope: ConfigScopeRuntime, rootDir: string): ResourceKey {
	return source.type === "file"
		? fileResourceKey({ sourcePath: source.path, scopeDir: scope.scopeDir, rootDir })
		: urlResourceKey(source.url);
}

/** Builds canonical runtime resources while preserving every local source declaration as provenance. */
export function buildResourceRegistry(scopes: readonly ContextScope[], rootDir: string): ResourceRegistry {
	const registry: ResourceRegistry = new Map();
	for (const contextScope of scopes) {
		const scope = toConfigScopeRuntime(contextScope);
		for (const [localSourceId, source] of Object.entries(scope.scope.config.sources)) {
			const key = resourceKeyForSource(source, scope, rootDir);
			const existing = registry.get(key);
			const declaration = { configPath: scope.configPath, localSourceId, source };
			if (existing) {
				existing.declarations.push(declaration);
				continue;
			}
			registry.set(
				key,
				source.type === "file"
					? { key, type: "file", absolutePath: key.slice("file:".length), declarations: [declaration] }
					: { key, type: "url", url: key.slice("url:".length), declarations: [declaration] },
			);
		}
	}
	return registry;
}

export function ensureFileResource(registry: ResourceRegistry, absolutePath: string): ResourceKey {
	const key: ResourceKey = `file:${absolutePath}`;
	if (!registry.has(key)) registry.set(key, { key, type: "file", absolutePath, declarations: [] });
	return key;
}
