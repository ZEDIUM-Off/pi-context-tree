import path from "node:path";
import type { ContextScope } from "./scan.js";
import {
	pathAwareHookNames,
	runtimeHookNames,
	spawnHookNames,
	toolHookNames,
	type CacheConfig,
	type HookName,
	type InjectObject,
	type InjectionItem,
	type MatchEntry,
	type OnSelector,
	type SourceDefinition,
	type SourceOverride,
} from "./schema.js";
import { stripAtPrefix } from "./util.js";

export type ResolvedOnEntry = SourceOverride & { hook: HookName };

export type NormalizedSource = InjectObject & {
	absolutePath?: string;
	owner: ContextScope;
	contextId: string;
	ruleMatch?: readonly MatchEntry[];
	sourceKey?: string;
	hook?: HookName;
	cache?: CacheConfig;
};

const hookGroups = {
	"runtime:*": runtimeHookNames,
	"tool:*": toolHookNames,
	"spawn:*": spawnHookNames,
	"path:*": pathAwareHookNames,
} as const;

function expandHookName(input: string): HookName[] {
	return input in hookGroups ? [...hookGroups[input as keyof typeof hookGroups]] : [input as HookName];
}

export function expandOnSelector(on: OnSelector): ResolvedOnEntry[] {
	if (typeof on === "string") return expandHookName(on).map((hook) => ({ hook }));
	return on.flatMap((entry) => {
		if (typeof entry === "string") return expandHookName(entry).map((hook) => ({ hook }));
		const { hooks, ...override } = entry;
		return hooks.flatMap((hookOrGroup) => expandHookName(hookOrGroup).map((hook) => ({ ...override, hook })));
	});
}

function defined<T extends object>(value: T): Partial<T> {
	return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined)) as Partial<T>;
}

function mergeCache(...items: Array<CacheConfig | undefined>): CacheConfig {
	return Object.assign({}, ...items.filter(Boolean)) as CacheConfig;
}

function mergeBudget(...items: Array<{ budget?: object | undefined }>): object {
	return Object.assign({}, ...items.map((item) => item.budget).filter(Boolean));
}

function resolveObject(owner: ContextScope, source: SourceDefinition, inject: InjectionItem, onEntry: ResolvedOnEntry): InjectObject {
	const merged = {
		kind: source.kind,
		reason: source.reason,
		mode: source.mode ?? { type: "ref" },
		cache: mergeCache(owner.config.defaults?.cache, source.cache, inject.cache, onEntry.cache),
		budget: mergeBudget(owner.config.defaults ?? {}, source, inject, onEntry),
	};
	const final = Object.assign({}, merged, defined({ kind: inject.kind, reason: inject.reason, mode: inject.mode }), defined({ kind: onEntry.kind, reason: onEntry.reason, mode: onEntry.mode }));
	return source.type === "file" ? { type: "file", path: source.path, ...final } : { type: "url", url: source.url, ...final };
}

export function resolveInjectionForHook(owner: ContextScope, inject: InjectionItem, hook: HookName): InjectObject | undefined {
	const source = owner.config.sources[inject.source];
	if (!source) return undefined;
	const onEntry = expandOnSelector(inject.on).find((entry) => entry.hook === hook);
	return onEntry ? resolveObject(owner, source, inject, onEntry) : undefined;
}

export function normalizeInject(input: InjectObject, owner: ContextScope, id: string, meta?: { ruleMatch?: readonly MatchEntry[]; sourceKey?: string; hook?: HookName }): NormalizedSource {
	const cache = mergeCache(owner.config.defaults?.cache, input.cache);
	const base = { owner, contextId: id, ...(meta?.ruleMatch ? { ruleMatch: meta.ruleMatch } : {}), ...(meta?.sourceKey ? { sourceKey: meta.sourceKey } : {}), ...(meta?.hook ? { hook: meta.hook } : {}), cache };
	if (input.type === "file") return { ...input, ...base, absolutePath: path.resolve(owner.dir, stripAtPrefix(input.path)) };
	return { ...input, ...base };
}

export function dedupeSources(sources: NormalizedSource[]): NormalizedSource[] {
	const seen = new Set<string>();
	return sources.filter((s) => {
		const key = JSON.stringify({ id: s.type === "file" ? s.absolutePath : s.url, mode: s.mode, reason: s.reason, kind: s.kind });
		if (seen.has(key)) return false;
		seen.add(key);
		return true;
	});
}
