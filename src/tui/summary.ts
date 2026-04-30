import path from "node:path";
import type { Bundle, LoadedSource } from "../bundle.js";
import type { SessionManagerLike } from "../pi/types.js";
import type { ContextScope } from "../scan.js";
import type {
	InjectionReference,
	LastInjection,
	ScopeSummary,
	SessionSummary,
} from "./types.js";
import { countLines, estimateTokens } from "./format.js";

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

export function summarizeSession(
	sessionManager: SessionManagerLike,
): SessionSummary {
	const branch = safeCall<unknown[]>(
		() => sessionManager.getBranch?.() ?? [],
		[],
	);
	const entries = safeCall<unknown[]>(
		() => sessionManager.getEntries?.() ?? [],
		[],
	);
	const leafId = safeCall<string | null | undefined>(
		() => sessionManager.getLeafId?.(),
		undefined,
	);
	const sessionFile = safeCall<string | null | undefined>(
		() => sessionManager.getSessionFile?.(),
		undefined,
	);
	const id = safeCall<string | null | undefined>(
		() => sessionManager.getSessionId?.(),
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

function summarizeScope(
	cwd: string,
	scope: ContextScope,
	all: ContextScope[],
	bundle?: Bundle,
	last?: LastInjection,
): ScopeSummary {
	const rules = scope.config.injection_rules;
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
		hookCount: rules.length,
		pathAwareHookCount: rules.filter((rule) => rule.match).length,
		pathlessHookCount: rules.filter((rule) => !rule.match).length,
		...(bundle
			? { lastHook: bundle.operation, lastBundleHash: bundle.bundleHash }
			: {}),
		...(lastTouches && last
			? { lastHook: last.operation, lastBundleHash: last.bundleHash }
			: {}),
		sourceCount: Object.keys(scope.config.sources).length,
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
		scope.config.injection_rules.length === 0
	)
		return "medium";
	return "low";
}

function safeCall<T>(fn: () => T, fallback: T): T {
	try {
		return fn();
	} catch {
		return fallback;
	}
}
