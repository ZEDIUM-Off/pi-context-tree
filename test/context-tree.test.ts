import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { contextFileSchema } from "../src/context-schema.js";
import {
	buildBundle,
	contextId,
	explainPath,
	extractContent,
	extractLines,
	extractMarker,
	extractSection,
	hookMatches,
	matchGlobs,
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

test("schema rejects unsupported scope/context fields and validates hook match compatibility", () => {
	assert.throws(() =>
		contextFileSchema.parse({
			$schema: "./schemas/context.schema.json",
			scope: ".",
			hooks: [],
		}),
	);
	assert.throws(() =>
		contextFileSchema.parse({
			$schema: "./schemas/context.schema.json",
			hooks: [{ on: "tool:read", inject: ["./a.md"] }],
		}),
	);
	assert.throws(() =>
		contextFileSchema.parse({
			$schema: "./schemas/context.schema.json",
			hooks: [{ on: "agent:start", match: ["**/*.ts"], inject: ["./a.md"] }],
		}),
	);
	assert.doesNotThrow(() =>
		contextFileSchema.parse({
			$schema: "./schemas/context.schema.json",
			hooks: [{ on: "tool:read", match: ["**/*.ts"], inject: ["./a.md"] }],
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
			hooks: [{ on: "agent:start", inject: ["./a.md"] }],
		}),
	);
	assert.throws(() =>
		contextFileSchema.parse({
			$schema: "./schemas/context.schema.json",
			stability: { state: "unknown" },
			hooks: [],
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

test("scan and explain use implicit scope and relative matching", async () => {
	const repo = tempRepo();
	await mkdir(join(repo, "src/features/billing/docs"), { recursive: true });
	await writeFile(
		join(repo, "CONTEXT.json"),
		JSON.stringify({
			$schema: "./schemas/context.schema.json",
			hooks: [
				{
					on: "agent:start",
					inject: ["./root.md"],
				},
			],
		}),
	);
	await writeFile(join(repo, "root.md"), "root");
	await writeFile(
		join(repo, "src/features/billing/CONTEXT.json"),
		JSON.stringify({
			$schema: "./schemas/context.schema.json",
			hooks: [
				{
					on: "agent:start",
					inject: ["./docs/rules.md"],
				},
			],
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
				hooks: [
					{
						on: "tool:read",
						match: ["**/*.ts"],
						inject: [
							{ type: "file", path: "./global.md", mode: { type: "inline" } },
						],
					},
				],
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
			hooks: [
				{
					on: "agent:start",
					inject: ["./root.md"],
				},
			],
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
			hooks: [],
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
	const block = {
		match: ["**/*.ts"],
		on: "tool:read",
	} as const;
	const a = { basePath: "a" };
	const b = { basePath: "b" };
	assert.notEqual(
		contextId(a, block),
		contextId(a, {
			on: "agent:start",
		}),
	);
	assert.notEqual(contextId(a, block), contextId(b, block));
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
			hooks: [
				{
					on: "agent:start",
					inject: [
						{ type: "file", path: "./rules.md", mode: { type: "inline" } },
					],
				},
			],
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
			hooks: [
				{
					on: "agent:start",
					inject: [
						{
							type: "url",
							url: "https://example.com/docs",
							mode: { type: "inline" },
						},
					],
				},
			],
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
			hooks: [
				{
					match: ["**/*.md"],
					on: "tool:read",
					inject: [
						{ type: "file", path: "./README.md", mode: { type: "inline" } },
						{ type: "file", path: "./rules.md", mode: { type: "inline" } },
					],
				},
			],
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
