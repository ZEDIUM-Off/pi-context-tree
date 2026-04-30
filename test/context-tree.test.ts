import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { contextFileSchema } from "../src/context-schema.js";
import { buildUpgradePlan } from "../src/upgrade/upgrade-plan.js";
import {
	buildBundle,
	contextId,
	explainHook,
	explainPath,
	extractContent,
	extractLines,
	extractMarker,
	extractSection,
	hookMatches,
	matchGlobs,
	matchScopedPatterns,
	parsePromptPaths,
	scanAllContextTree,
	scanContextParents,
} from "../src/context-tree.js";

process.env.PI_CONTEXT_TREE_GLOBAL = join(
	tmpdir(),
	"context-tree-test-no-global-CONTEXT.json",
);

function tempRepo() {
	return mkdtempSync(join(tmpdir(), "context-tree-"));
}

test("upgrade plan adds target schema before reporting remaining validation errors", async () => {
	const repo = tempRepo();
	await mkdir(join(repo, "bad"), { recursive: true });
	await writeFile(
		join(repo, "CONTEXT.json"),
		JSON.stringify({ hooks: [{ on: "agent:start", inject: ["./rules.md"] }] }),
	);
	await writeFile(
		join(repo, "bad/CONTEXT.json"),
		JSON.stringify({ hooks: [{ on: "tool:read", inject: ["./rules.md"] }] }),
	);
	const plan = await buildUpgradePlan(repo, "9.9.9");
	const target =
		"https://raw.githubusercontent.com/ZEDIUM-Off/pi-context-tree/v9.9.9/schemas/context.schema.json";
	const root = plan.find((item) => item.path === join(repo, "CONTEXT.json"));
	const bad = plan.find((item) => item.path === join(repo, "bad/CONTEXT.json"));
	assert.equal(root?.status, "missing");
	assert.equal((root?.after as Record<string, unknown>)?.$schema, target);
	assert.equal(bad?.status, "missing");
	assert.equal((bad?.after as Record<string, unknown>)?.$schema, target);
	assert.ok((bad?.after as Record<string, unknown>)?.sources);
	assert.ok((bad?.after as Record<string, unknown>)?.injection_rules);
});

test("schema rejects unsupported fields and validates new rule compatibility", () => {
	assert.throws(() =>
		contextFileSchema.parse({
			$schema: "./schemas/context.schema.json",
			scope: ".",
			injection_rules: [],
		}),
	);
	assert.throws(() =>
		contextFileSchema.parse({
			$schema: "./schemas/context.schema.json",
			hooks: [{ on: "agent:start", inject: ["./a.md"] }],
		}),
	);
	assert.throws(() =>
		contextFileSchema.parse({
			$schema: "./schemas/context.schema.json",
			sources: { a: { type: "file", path: "./a.md" } },
			injection_rules: [{ match: ["**/*.ts"], inject: [{ source: "a", on: "agent:start" }] }],
		}),
	);
	assert.doesNotThrow(() =>
		contextFileSchema.parse({
			$schema: "./schemas/context.schema.json",
			sources: { a: { type: "file", path: "./a.md" } },
			injection_rules: [{ match: ["**/*.ts"], inject: [{ source: "a", on: "tool:read" }] }],
		}),
	);
	assert.doesNotThrow(() =>
		contextFileSchema.parse({
			$schema: "./schemas/context.schema.json",
			stability: {
				state: "in_progress",
				summary: "Resolver refactor active.",
				updatedAt: "2026-04-28",
				updatedBy: "agent",
			},
			sources: { a: { type: "file", path: "./a.md" } },
			injection_rules: [{ inject: [{ source: "a", on: "agent:start" }] }],
		}),
	);
	assert.throws(() =>
		contextFileSchema.parse({
			$schema: "./schemas/context.schema.json",
			stability: { state: "unknown" },
			injection_rules: [],
		}),
	);
});

test("new schema accepts source catalog and injection rules", () => {
	const parsed = contextFileSchema.parse({
		$schema: "./schemas/context.schema.json",
		sources: {
			rules: { type: "file", path: "./rules.md" },
		},
		injection_rules: [
			{
				match: ["**/*.ts"],
				inject: [{ source: "rules", on: "tool:read" }],
			},
		],
	});
	assert.equal(parsed.sources.rules?.mode.type, "ref");
});

test("new schema validates source ids and runtime/path hook families", () => {
	const base = {
		$schema: "./schemas/context.schema.json",
		sources: { rules: { type: "file", path: "./rules.md" } },
	};
	assert.throws(() =>
		contextFileSchema.parse({
			...base,
			injection_rules: [
				{ match: ["**/*.ts"], inject: [{ source: "missing", on: "tool:read" }] },
			],
		}),
	);
	assert.throws(() =>
		contextFileSchema.parse({
			...base,
			injection_rules: [
				{ match: ["**/*.ts"], inject: [{ source: "rules", on: "agent:start" }] },
			],
		}),
	);
	assert.throws(() =>
		contextFileSchema.parse({
			...base,
			injection_rules: [{ inject: [{ source: "rules", on: "tool:read" }] }],
		}),
	);
	assert.doesNotThrow(() =>
		contextFileSchema.parse({
			...base,
			injection_rules: [{ inject: [{ source: "rules", on: "runtime:*" }] }],
		}),
	);
});

test("new schema accepts on arrays and granular overrides", () => {
	assert.doesNotThrow(() =>
		contextFileSchema.parse({
			$schema: "./schemas/context.schema.json",
			sources: { rules: { type: "file", path: "./rules.md" } },
			injection_rules: [
				{
					match: ["**/*.ts"],
					inject: [
						{ source: "rules", on: ["tool:read", "tool:write"] },
						{
							source: "rules",
							on: [
								{ hooks: ["tool:edit"], mode: { type: "lines", ranges: ["1-120"] } },
							],
						},
					],
				},
			],
		}),
	);
});

test("match globs support positive and ! exclusions", () => {
	assert.equal(matchGlobs(["**/*.ts"], "foo.ts"), true);
	assert.equal(matchGlobs(["**/*.ts", "!**/*.test.ts"], "foo.test.ts"), false);
	assert.equal(
		matchGlobs(["**/*.test.ts", "**/*.spec.ts"], "foo.spec.ts"),
		true,
	);
	assert.equal(matchGlobs(["!**/*.test.ts"], "foo.ts"), false);
});

test("hooks match exactly", () => {
	assert.equal(hookMatches("tool:write", "tool:write"), true);
	assert.equal(hookMatches("tool:read", "tool:write"), false);
});

test("scoped patterns support @ root escape", () => {
	assert.equal(
		matchScopedPatterns({
			patterns: ["*.ts"],
			relativeToScope: "job.ts",
			relativeToRoot: "nfc-bo/src/jobs/job.ts",
		}),
		true,
	);
	assert.equal(
		matchScopedPatterns({
			patterns: ["@nfc-bo/src/jobs/*.ts"],
			relativeToScope: "job.ts",
			relativeToRoot: "nfc-bo/src/jobs/job.ts",
		}),
		true,
	);
	assert.equal(
		matchScopedPatterns({
			patterns: ["@nfc-bo/src/jobs/*.ts", "!@nfc-bo/src/jobs/*.test.ts"],
			relativeToScope: "job.test.ts",
			relativeToRoot: "nfc-bo/src/jobs/job.test.ts",
		}),
		false,
	);
});

test("new injection rules resolve runtime and path-aware sources with overrides", async () => {
	const repo = tempRepo();
	await mkdir(join(repo, "nfc-bo/src/jobs"), { recursive: true });
	await writeFile(
		join(repo, "CONTEXT.json"),
		JSON.stringify({
			$schema: "./schemas/context.schema.json",
			sources: {
				pgvector: { type: "url", url: "https://github.com/pgvector/pgvector" },
				medusaJobs: {
					type: "file",
					path: "./jobs.md",
					reason: "Default jobs docs.",
				},
			},
			injection_rules: [
				{ inject: [{ source: "pgvector", on: "agent:start" }] },
				{
					match: ["nfc-bo/src/jobs/**"],
					inject: [
						{
							source: "medusaJobs",
							reason: "Jobs docs for this path.",
							on: [
								{ hooks: ["tool:read"], mode: { type: "ref" } },
								{ hooks: ["tool:edit", "tool:write"], mode: { type: "sections", names: ["Scheduled jobs"] } },
							],
						},
					],
				},
			],
		}),
	);
	await writeFile(join(repo, "jobs.md"), "# Scheduled jobs\nbody");
	await writeFile(join(repo, "nfc-bo/src/jobs/sync.ts"), "code");
	const scopes = await scanContextParents(repo, "nfc-bo/src/jobs/sync.ts");
	const readExp = explainPath(repo, scopes, "nfc-bo/src/jobs/sync.ts", "tool:read");
	assert.equal(readExp.sources[0]?.mode.type, "ref");
	assert.equal(readExp.sources[0]?.reason, "Jobs docs for this path.");
	const editExp = explainPath(repo, scopes, "nfc-bo/src/jobs/sync.ts", "tool:edit");
	assert.equal(editExp.sources[0]?.mode.type, "sections");
	const runtimeExp = explainHook(repo, scopes, "agent:start");
	assert.equal(runtimeExp.sources[0]?.type, "url");
});

test("scan and explain use implicit scope and relative matching", async () => {
	const repo = tempRepo();
	await mkdir(join(repo, "src/features/billing/docs"), { recursive: true });
	await writeFile(
		join(repo, "CONTEXT.json"),
		JSON.stringify({
			$schema: "./schemas/context.schema.json",
			sources: { root: { type: "file", path: "./root.md" } },
			injection_rules: [{ inject: [{ source: "root", on: "agent:start" }] }],
		}),
	);
	await writeFile(join(repo, "root.md"), "root");
	await writeFile(
		join(repo, "src/features/billing/CONTEXT.json"),
		JSON.stringify({
			$schema: "./schemas/context.schema.json",
			sources: { rules: { type: "file", path: "./docs/rules.md" } },
			injection_rules: [{ inject: [{ source: "rules", on: "agent:start" }] }],
		}),
	);
	await writeFile(join(repo, "src/features/billing/docs/rules.md"), "rules");
	await writeFile(join(repo, "src/features/billing/invoice.ts"), "code");
	const scopes = await scanContextParents(
		repo,
		"src/features/billing/invoice.ts",
	);
	assert.equal(scopes.length, 2);
	assert.equal(scopes[1]?.basePath, "src/features/billing");
	const explained = explainPath(
		repo,
		scopes,
		"src/features/billing/invoice.ts",
		"agent:start",
	);
	assert.equal(explained.matched.length, 2);
	assert.equal(explained.sources.length, 2);
});

test("scan includes user-global CONTEXT before project scopes", async () => {
	const repo = tempRepo();
	const globalDir = tempRepo();
	const previous = process.env.PI_CONTEXT_TREE_GLOBAL;
	process.env.PI_CONTEXT_TREE_GLOBAL = join(globalDir, "CONTEXT.json");
	try {
		await writeFile(
			join(globalDir, "CONTEXT.json"),
			JSON.stringify({
				$schema: "./schemas/context.schema.json",
				sources: { global: { type: "file", path: "./global.md", mode: { type: "inline" } } },
				injection_rules: [{ match: ["**/*.ts"], inject: [{ source: "global", on: "tool:read" }] }],
			}),
		);
		await writeFile(join(globalDir, "global.md"), "global rules");
		await writeFile(join(repo, "x.ts"), "x");
		const scopes = await scanContextParents(repo, "x.ts");
		assert.equal(scopes[0]?.global, true);
		assert.equal(scopes[0]?.basePath, "<global>");
		const exp = explainPath(repo, scopes, "x.ts", "tool:read");
		const bundle = await buildBundle(repo, exp);
		assert.equal(bundle.sources[0]?.content, "global rules");
		const all = await scanAllContextTree(repo);
		assert.equal(all.scopes[0]?.global, true);
	} finally {
		if (previous === undefined) delete process.env.PI_CONTEXT_TREE_GLOBAL;
		else process.env.PI_CONTEXT_TREE_GLOBAL = previous;
	}
});

test("bundle includes nearest scope stability", async () => {
	const repo = tempRepo();
	await mkdir(join(repo, "src/feature"), { recursive: true });
	await writeFile(
		join(repo, "CONTEXT.json"),
		JSON.stringify({
			$schema: "./schemas/context.schema.json",
			stability: { state: "stable", summary: "Root stable." },
			sources: { root: { type: "file", path: "./root.md" } },
			injection_rules: [{ inject: [{ source: "root", on: "agent:start" }] }],
		}),
	);
	await writeFile(join(repo, "root.md"), "root");
	await writeFile(
		join(repo, "src/feature/CONTEXT.json"),
		JSON.stringify({
			$schema: "./schemas/context.schema.json",
			stability: {
				state: "in_progress",
				summary: "Feature refactor active.",
				updatedBy: "agent",
			},
			sources: {},
			injection_rules: [],
		}),
	);
	await writeFile(join(repo, "src/feature/a.ts"), "code");
	const scopes = await scanContextParents(repo, "src/feature/a.ts");
	const exp = explainPath(repo, scopes, "src/feature/a.ts", "agent:start");
	const bundle = await buildBundle(repo, exp);
	assert.equal(bundle.stability?.config.state, "in_progress");
	assert.equal(bundle.stability?.scope.basePath, "src/feature");
});

test("contextId stable and changes with base path", async () => {
	const item = {
		match: ["**/*.ts"],
		hook: "tool:read",
		source: "rules",
		ruleIndex: 0,
		injectIndex: 0,
	} as const;
	const a = { basePath: "a" };
	const b = { basePath: "b" };
	assert.notEqual(
		contextId(a, item),
		contextId(a, {
			...item,
			hook: "tool:write",
		}),
	);
	assert.notEqual(contextId(a, item), contextId(b, item));
});

test("extracts sections, lines, markers, and annotated segments", () => {
	const md = "# A\nno\n## Billing invariants\nrule1\nrule2\n## Other\nx";
	assert.match(extractSection(md, "Billing invariants"), /rule1/);
	assert.equal(extractLines("a\nb\nc", "2-3"), "b\nc");
	const code =
		"// context-tree:start types\ntype A = string;\n// context-tree:end types";
	assert.equal(extractMarker(code, "types"), "type A = string;");
	const out = extractContent(md, {
		segments: [{ section: "Billing invariants", note: "Checklist." }],
	});
	assert.match(out, /Agent note: Checklist\./);
});

test("bundle loads local files and hashes content", async () => {
	const repo = tempRepo();
	await writeFile(
		join(repo, "CONTEXT.json"),
		JSON.stringify({
			$schema: "./schemas/context.schema.json",
			sources: { rules: { type: "file", path: "./rules.md", mode: { type: "inline" } } },
			injection_rules: [{ inject: [{ source: "rules", on: "agent:start" }] }],
		}),
	);
	await writeFile(join(repo, "rules.md"), "# Rules");
	await writeFile(join(repo, "x.ts"), "x");
	const scopes = await scanContextParents(repo, "x.ts");
	const exp = explainPath(repo, scopes, "x.ts", "agent:start");
	const bundle = await buildBundle(repo, exp);
	assert.equal(bundle.sources.length, 1);
	assert.match(bundle.bundleHash, /^[a-f0-9]{64}$/);
});

test("url cache uses mock fetch and then fresh cache", async () => {
	const repo = tempRepo();
	await writeFile(
		join(repo, "CONTEXT.json"),
		JSON.stringify({
			$schema: "./schemas/context.schema.json",
			sources: { docs: { type: "url", url: "https://example.com/docs", mode: { type: "inline" } } },
			injection_rules: [{ inject: [{ source: "docs", on: "agent:start" }] }],
		}),
	);
	await writeFile(join(repo, "x.ts"), "x");
	const scopes = await scanContextParents(repo, "x.ts");
	const exp = explainPath(repo, scopes, "x.ts", "agent:start");
	let calls = 0;
	const fetcher = async () => {
		calls++;
		return {
			ok: true,
			status: 200,
			text: async () => "remote docs",
		} as Response;
	};
	const b1 = await buildBundle(repo, exp, { fetcher: fetcher as any });
	const b2 = await buildBundle(repo, exp, { fetcher: fetcher as any });
	assert.equal(b1.sources[0]?.content, "remote docs");
	assert.equal(b2.sources[0]?.content, "remote docs");
	assert.equal(calls, 1);
});

test("parse prompt paths extracts @file and plain paths", () => {
	assert.deepEqual(parsePromptPaths("Fix @src/a.ts and src/b.test.ts"), [
		"src/a.ts",
		"src/b.test.ts",
	]);
});

test("read bundle skips self-injected target file", async () => {
	const repo = tempRepo();
	await writeFile(
		join(repo, "CONTEXT.json"),
		JSON.stringify({
			$schema: "./schemas/context.schema.json",
			sources: {
				readme: { type: "file", path: "./README.md", mode: { type: "inline" } },
				rules: { type: "file", path: "./rules.md", mode: { type: "inline" } },
			},
			injection_rules: [{ match: ["**/*.md"], inject: [{ source: "readme", on: "tool:read" }, { source: "rules", on: "tool:read" }] }],
		}),
	);
	await writeFile(join(repo, "README.md"), "readme");
	await writeFile(join(repo, "rules.md"), "rules");
	const scopes = await scanContextParents(repo, "README.md");
	const exp = explainPath(repo, scopes, "README.md", "tool:read");
	const bundle = await buildBundle(repo, exp);
	assert.deepEqual(
		bundle.sources.map((s) => s.sourceId),
		["rules.md"],
	);
	assert.match(bundle.warnings.join("\n"), /Skipped self-injection/);
});
