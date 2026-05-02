import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { contextFileSchema, type ContextFile } from "../src/schema.js";
import type { ContextScope } from "../src/scan.js";
import { activeInjectionStack, createActiveInjectionRegistry, updateActiveInjections } from "../src/runtime-context/active-injection-registry.js";
import { resolveHookBatch } from "../src/runtime-context/batch-resolver.js";
import { priorityForParam, resolveInjectionConflicts } from "../src/runtime-context/conflict-resolution.js";
import { buildInjectionParamsRegistry, type RuntimeInjectionParam } from "../src/runtime-context/injection-params-registry.js";
import { canonicalUrl } from "../src/runtime-context/resource-key.js";
import { buildResourceRegistry } from "../src/runtime-context/resource-registry.js";

function tempRepo(): string {
	return mkdtempSync(path.join(tmpdir(), "context-tree-runtime-"));
}

function scope(root: string, dir: string, config: ContextFile, global = false): ContextScope {
	return {
		configPath: path.join(dir, "CONTEXT.json"),
		dir,
		basePath: global ? "<global>" : path.relative(root, dir).split(path.sep).join("/") || "<root>",
		config,
		...(global ? { global: true } : {}),
	};
}

function config(value: Record<string, unknown>): ContextFile {
	return contextFileSchema.parse({ $schema: "./schemas/context.schema.json", ...value });
}

function param(base: Partial<RuntimeInjectionParam> = {}): RuntimeInjectionParam {
	return {
		paramId: base.paramId ?? `p-${base.order ?? 0}`,
		resourceKey: base.resourceKey ?? "file:/repo/rules.md",
		configPath: base.configPath ?? "/repo/CONTEXT.json",
		scopeDir: base.scopeDir ?? "/repo",
		basePath: base.basePath ?? "<root>",
		localSourceId: base.localSourceId ?? "rules",
		ruleIndex: base.ruleIndex ?? 0,
		injectIndex: base.injectIndex ?? 0,
		onIndex: base.onIndex ?? 0,
		hook: base.hook ?? "tool:read",
		hookSelectorKind: base.hookSelectorKind ?? "concrete",
		...(base.match ? { match: base.match } : {}),
		pathAware: base.pathAware ?? true,
		...(base.kind ? { kind: base.kind } : {}),
		...(base.reason ? { reason: base.reason } : {}),
		mode: base.mode ?? { type: "ref" },
		...(base.cache ? { cache: base.cache } : {}),
		...(base.budget ? { budget: base.budget } : {}),
		order: base.order ?? 0,
		scopeDepth: base.scopeDepth ?? 0,
	};
}

test("resource registry canonicalizes and dedupes file and URL declarations", () => {
	const root = tempRepo();
	const child = path.join(root, "src");
	const scopes = [
		scope(root, root, config({ sources: { rootRules: { type: "file", path: "./rules.md" }, docs: { type: "url", url: "HTTPS://Example.com:443/a?b=2&a=1#frag" } } })),
		scope(root, child, config({ sources: { childRules: { type: "file", path: "@/rules.md" }, docsAgain: { type: "url", url: "https://example.com/a?a=1&b=2" } } })),
	];
	const registry = buildResourceRegistry(scopes, root);
	assert.equal(registry.size, 2);
	assert.equal(registry.get(`file:${path.join(root, "rules.md")}`)?.declarations.length, 2);
	assert.equal(registry.get("url:https://example.com/a?a=1&b=2")?.declarations.length, 2);
	assert.equal(canonicalUrl("HTTPS://Example.com:443/a?b=2&a=1#frag"), "https://example.com/a?a=1&b=2");
});

test("injection params compile overrides, hook groups, provenance, and root-relative sources", () => {
	const root = tempRepo();
	const src = path.join(root, "src");
	const owner = scope(root, src, config({
		defaults: { cache: { ttl: "1d" }, budget: { maxTokens: 500 } },
		sources: { rules: { type: "file", path: "@/docs/rules.md", kind: "source-kind", reason: "source-reason", mode: { type: "ref" }, cache: { fallback: "error" } } },
		injection_rules: [{ match: ["**/*.ts"], inject: [{ source: "rules", on: [{ hooks: ["tool:*"], mode: { type: "lines", ranges: ["1-3"] }, reason: "on-reason" }], kind: "inject-kind" }] }],
	}));
	const params = buildInjectionParamsRegistry([owner], root);
	assert.equal(params.length, 7);
	const read = params.find((item) => item.hook === "tool:read");
	assert.ok(read);
	assert.equal(read.resourceKey, `file:${path.join(root, "docs/rules.md")}`);
	assert.equal(read.configPath, path.join(src, "CONTEXT.json"));
	assert.equal(read.localSourceId, "rules");
	assert.equal(read.ruleIndex, 0);
	assert.equal(read.injectIndex, 0);
	assert.equal(read.onIndex, 0);
	assert.equal(read.hookSelectorKind, "override");
	assert.equal(read.kind, "inject-kind");
	assert.equal(read.reason, "on-reason");
	assert.deepEqual(read.mode, { type: "lines", ranges: ["1-3"] });
	assert.equal(read.cache?.ttl, "14d");
	assert.equal(read.cache?.fallback, "error");
	assert.equal(read.budget?.maxTokens, 500);
});

test("conflict resolver dedupes same representation and applies deterministic priority", () => {
	const broad = param({ match: ["**/*.ts"], mode: { type: "ref" }, scopeDepth: 0, order: 0 });
	const exact = param({ match: ["src/index.ts"], mode: { type: "inline" }, scopeDepth: 0, order: 1 });
	const child = param({ match: ["**/*.ts"], mode: { type: "sections", names: ["Runtime"] }, scopeDepth: 2, order: 2 });
	const sameAsChild = param({ match: ["**/*.ts"], mode: { type: "sections", names: ["Runtime"] }, scopeDepth: 2, order: 3 });
	assert.ok(priorityForParam(exact)[1] > priorityForParam(broad)[1]);
	const resolved = resolveInjectionConflicts([broad, exact, child, sameAsChild]);
	assert.equal(resolved.selected.length, 1);
	assert.deepEqual(resolved.selected[0]?.mode, { type: "sections", names: ["Runtime"] });
	assert.equal(resolved.conflicts.length, 1);
	assert.equal(resolved.conflicts[0]?.dropped.length, 2);
});

test("equal-priority conflicts warn and choose later order", () => {
	const first = param({ mode: { type: "ref" }, order: 1 });
	const second = param({ mode: { type: "inline" }, order: 2 });
	const resolved = resolveInjectionConflicts([first, second]);
	assert.equal(resolved.selected[0], second);
	assert.match(resolved.conflicts[0]?.warning ?? "", /equal-priority conflict/);
});

test("batch resolver matches single and multi invocations, dedupes, and skips same-file targets", async () => {
	const root = tempRepo();
	await mkdir(path.join(root, "src"), { recursive: true });
	await writeFile(path.join(root, "src/a.ts"), "export const a = 1;\n");
	await writeFile(path.join(root, "src/rules.md"), "rules\n");
	const owner = scope(root, path.join(root, "src"), config({
		sources: { rules: { type: "file", path: "./rules.md" }, self: { type: "file", path: "./a.ts" } },
		injection_rules: [{ match: ["**/*.ts"], inject: [{ source: "rules", on: "tool:read" }, { source: "self", on: "tool:read" }] }],
	}));
	const params = buildInjectionParamsRegistry([owner], root);
	const single = await resolveHookBatch({ params, invocations: [{ hook: "tool:read", target: "src/a.ts" }], rootDir: root });
	assert.equal(single.selected.length, 1);
	assert.equal(single.skipped.length, 1);
	assert.equal(single.skipped[0]?.resourceKey, `file:${path.join(root, "src/a.ts")}`);
	const multi = await resolveHookBatch({ params, invocations: [{ hook: "tool:read", target: "src/a.ts" }, { hook: "tool:read", target: "src/a.ts" }], rootDir: root });
	assert.deepEqual(multi.selected, single.selected);
});

test("prompt explicit targets skip configured read injections but keep other read context", async () => {
	const root = tempRepo();
	await mkdir(path.join(root, "src"), { recursive: true });
	await writeFile(path.join(root, "src/tui.ts"), "export const tui = 1;\n");
	await writeFile(path.join(root, "src/tui.test.ts"), "test\n");
	await writeFile(path.join(root, "src/rules.md"), "rules\n");
	const owner = scope(root, path.join(root, "src"), config({
		sources: { rules: { type: "file", path: "./rules.md" }, tests: { type: "file", path: "./tui.test.ts" } },
		injection_rules: [{ match: ["tui.ts"], inject: [{ source: "rules", on: "tool:read" }, { source: "tests", on: "tool:read" }] }],
	}));
	const params = buildInjectionParamsRegistry([owner], root);
	const result = await resolveHookBatch({
		params,
		invocations: [{ hook: "tool:read", target: "src/tui.ts", trigger: "user_prompt_file_reference", promptReference: "@src/tui.ts", synthetic: true }],
		rootDir: root,
		explicitTargets: ["src/tui.ts", "src/tui.test.ts"],
	});
	assert.deepEqual(result.selected.map((item) => item.resourceKey), [`file:${path.join(root, "src/rules.md")}`]);
	assert.equal(result.skipped[0]?.resourceKey, `file:${path.join(root, "src/tui.test.ts")}`);
	assert.equal(result.skipped[0]?.reason, "source file is explicitly referenced by user prompt");
});

test("active injection registry inserts, moves, and replaces resource representations", () => {
	const registry = createActiveInjectionRegistry();
	const first = param({ mode: { type: "ref" }, order: 1 });
	const moved = param({ mode: { type: "ref" }, order: 2 });
	const replaced = param({ mode: { type: "inline" }, order: 3 });
	assert.equal(updateActiveInjections({ registry, params: [first], hook: "tool:read", targets: ["src/a.ts"], invokedAt: 1 })[0]?.action, "inserted");
	assert.equal(updateActiveInjections({ registry, params: [moved], hook: "tool:read", targets: ["src/b.ts"], invokedAt: 2 })[0]?.action, "moved");
	const change = updateActiveInjections({ registry, params: [replaced], hook: "tool:read", targets: ["src/c.ts"], invokedAt: 3 })[0];
	assert.ok(change);
	assert.equal(change.action, "replaced-mode");
	assert.equal(change.invocationCount, 3);
	assert.equal(activeInjectionStack(registry).length, 1);
	assert.deepEqual(activeInjectionStack(registry)[0]?.lastTargets, ["src/c.ts"]);
});
