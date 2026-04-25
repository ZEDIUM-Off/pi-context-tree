import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";
import assert from "node:assert/strict";
import { tmpdir } from "node:os";
import { mkdtempSync } from "node:fs";
import {
    buildBundle,
    contextId,
    explainPath,
    extractContent,
    extractLines,
    extractMarker,
    extractSection,
    matchGlobs,
    operationMatches,
    parsePromptPaths,
    scanContextParents,
} from "../src/context-tree.js";
import { contextFileSchema } from "../src/context-schema.js";

function tempRepo() {
    return mkdtempSync(join(tmpdir(), "context-tree-"));
}

test("schema rejects legacy scope and requires operations", () => {
    assert.throws(() =>
        contextFileSchema.parse({ version: 1, scope: ".", context: [] }),
    );
    assert.throws(() =>
        contextFileSchema.parse({
            version: 1,
            context: [{ match: ["**/*.ts"], inject: ["./a.md"] }],
        }),
    );
    assert.doesNotThrow(() =>
        contextFileSchema.parse({
            version: 1,
            context: [
                { match: ["**/*.ts"], operations: ["*"], inject: ["./a.md"] },
            ],
        }),
    );
});

test("match globs support positive and ! exclusions", () => {
    assert.equal(matchGlobs(["**/*.ts"], "foo.ts"), true);
    assert.equal(
        matchGlobs(["**/*.ts", "!**/*.test.ts"], "foo.test.ts"),
        false,
    );
    assert.equal(
        matchGlobs(["**/*.test.ts", "**/*.spec.ts"], "foo.spec.ts"),
        true,
    );
    assert.equal(matchGlobs(["!**/*.test.ts"], "foo.ts"), false);
});

test("operations support wildcard", () => {
    assert.equal(operationMatches(["*"], "write"), true);
    assert.equal(operationMatches(["read"], "write"), false);
});

test("scan and explain use implicit scope and relative matching", async () => {
    const repo = tempRepo();
    await mkdir(join(repo, "src/features/billing/docs"), { recursive: true });
    await writeFile(
        join(repo, "CONTEXT.json"),
        JSON.stringify({
            version: 1,
            context: [
                {
                    match: ["src/**/*.ts"],
                    operations: ["agent_start"],
                    inject: ["./root.md"],
                },
            ],
        }),
    );
    await writeFile(join(repo, "root.md"), "root");
    await writeFile(
        join(repo, "src/features/billing/CONTEXT.json"),
        JSON.stringify({
            version: 1,
            context: [
                {
                    match: ["**/*.ts", "!**/*.test.ts"],
                    operations: ["agent_start"],
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
        "agent_start",
    );
    assert.equal(explained.matched.length, 2);
    assert.equal(explained.sources.length, 2);
});

test("contextId stable and changes with base path", async () => {
    const block = {
        match: ["**/*.ts"],
        operations: ["read", "agent_start"],
    } as const;
    const a = { basePath: "a" } as any;
    const b = { basePath: "b" } as any;
    assert.equal(
        contextId(a, block),
        contextId(a, {
            match: ["**/*.ts"],
            operations: ["agent_start", "read"],
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
            version: 1,
            context: [
                {
                    match: ["**/*.ts"],
                    operations: ["agent_start"],
                    inject: [
                        { type: "file", path: "./rules.md", required: true },
                    ],
                },
            ],
        }),
    );
    await writeFile(join(repo, "rules.md"), "# Rules");
    await writeFile(join(repo, "x.ts"), "x");
    const scopes = await scanContextParents(repo, "x.ts");
    const exp = explainPath(repo, scopes, "x.ts", "agent_start");
    const bundle = await buildBundle(repo, exp);
    assert.equal(bundle.sources.length, 1);
    assert.match(bundle.bundleHash, /^[a-f0-9]{64}$/);
});

test("url cache uses mock fetch and then fresh cache", async () => {
    const repo = tempRepo();
    await writeFile(
        join(repo, "CONTEXT.json"),
        JSON.stringify({
            version: 1,
            context: [
                {
                    match: ["**/*.ts"],
                    operations: ["agent_start"],
                    inject: ["https://example.com/docs"],
                },
            ],
        }),
    );
    await writeFile(join(repo, "x.ts"), "x");
    const scopes = await scanContextParents(repo, "x.ts");
    const exp = explainPath(repo, scopes, "x.ts", "agent_start");
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
  await writeFile(join(repo, "CONTEXT.json"), JSON.stringify({ version: 1, context: [{ match: ["**/*.md"], operations: ["read"], inject: ["./README.md", "./rules.md"] }] }));
  await writeFile(join(repo, "README.md"), "readme");
  await writeFile(join(repo, "rules.md"), "rules");
  const scopes = await scanContextParents(repo, "README.md");
  const exp = explainPath(repo, scopes, "README.md", "read");
  const bundle = await buildBundle(repo, exp);
  assert.deepEqual(bundle.sources.map((s) => s.sourceId), ["rules.md"]);
  assert.match(bundle.warnings.join("\n"), /Skipped self-injection/);
});
