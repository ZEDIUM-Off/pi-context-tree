import path from "node:path";
import type { ContextScope } from "./scan.js";
import type { CacheConfig, HookBlock, InjectObject } from "./schema.js";
import { stripAtPrefix } from "./util.js";

export type NormalizedSource = InjectObject & {
	absolutePath?: string;
	owner: ContextScope;
	contextId: string;
	block: HookBlock;
	cache?: CacheConfig;
};

export function normalizeInject(
	input: string | InjectObject,
	owner: ContextScope,
	block: HookBlock,
	id: string,
): NormalizedSource {
	const obj: InjectObject =
		typeof input === "string"
			? input.startsWith("http://") || input.startsWith("https://")
				? { type: "url", url: input, mode: { type: "ref" } }
				: { type: "file", path: input, mode: { type: "ref" } }
			: input;
	const cache = {
		...(owner.config.defaults?.cache ?? {}),
		...(block.cache ?? {}),
		...(obj.cache ?? {}),
	} as CacheConfig;
	if (obj.type === "file") {
		const absolutePath = path.resolve(owner.dir, stripAtPrefix(obj.path));
		return { ...obj, owner, block, contextId: id, absolutePath, cache };
	}
	return { ...obj, owner, block, contextId: id, cache };
}

export function dedupeSources(sources: NormalizedSource[]): NormalizedSource[] {
	const seen = new Set<string>();
	return sources.filter((s) => {
		const key =
			s.type === "file"
				? `${s.absolutePath}:${JSON.stringify(s.mode)}`
				: `${s.url}:${JSON.stringify(s.mode)}`;
		if (seen.has(key)) return false;
		seen.add(key);
		return true;
	});
}
