import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { createActiveInjectionRegistry, updateActiveInjections } from "../src/runtime-context/active-injection-registry.js";
import { appendActiveContextMessage, stripLegacyContextTreeBlocks } from "../src/runtime-context/context-renderer.js";
import { renderContextStack, RepomixFilePacker } from "../src/runtime-context/providers.js";
import { buildResourceRegistry } from "../src/runtime-context/resource-registry.js";
import { buildInjectionParamsRegistry } from "../src/runtime-context/injection-params-registry.js";
import { contextFileSchema, type ContextFile } from "../src/schema.js";
import type { ContextScope } from "../src/scan.js";

function repo(): string {
	return mkdtempSync(path.join(tmpdir(), "context-tree-active-"));
}
function config(value: Record<string, unknown>): ContextFile {
	return contextFileSchema.parse({ $schema: "./schemas/context.schema.json", ...value });
}
function scope(root: string, cfg: ContextFile): ContextScope {
	return { configPath: path.join(root, "CONTEXT.json"), dir: root, basePath: "<root>", config: cfg };
}

test("active context renderer strips legacy bundles and appends one marked active stack", async () => {
	const root = repo();
	await mkdir(path.join(root, "docs"));
	await writeFile(path.join(root, "docs/rules.md"), "# Rules\nUse strict typing.\n");
	const owner = scope(root, config({
		sources: { rules: { type: "file", path: "./docs/rules.md", mode: { type: "inline" }, kind: "rules" } },
		injection_rules: [{ inject: [{ source: "rules", on: "session:start" }] }],
	}));
	const resources = buildResourceRegistry([owner], root);
	const params = buildInjectionParamsRegistry([owner], root);
	const registry = createActiveInjectionRegistry();
	updateActiveInjections({ registry, params, hook: "session:start", targets: [] });
	const messages = await appendActiveContextMessage({
		messages: [{ role: "toolResult", content: [{ type: "text", text: "tool output\n\n# Context Tree Bundle\nlegacy repeated content" }] }],
		cwd: root,
		resources,
		activeInjections: registry,
	});
	assert.equal(messages.length, 2);
	assert.deepEqual((messages[0] as { content: Array<{ text: string }> }).content[0]?.text, "tool output");
	const active = messages[1] as unknown as { content: string; customType: string };
	assert.equal(active.customType, "context-tree-active-stack");
	assert.match(active.content, /context-tree:active-stack:start/);
	assert.match(active.content, /# Context Tree Active Stack/);
	assert.match(active.content, /Use strict typing/);
	assert.doesNotMatch(active.content, /# Context Tree Bundle/);
});

test("provider rendering supports ref, filesystem extraction, and Repomix selection fallback", async () => {
	const root = repo();
	await writeFile(path.join(root, "a.md"), "# A\nalpha\n## Keep\nbody\n");
	const owner = scope(root, config({
		sources: {
			ref: { type: "file", path: "./a.md", mode: { type: "ref" } },
			section: { type: "file", path: "./a.md", mode: { type: "sections", names: ["Keep"] } },
		},
		injection_rules: [{ inject: [{ source: "ref", on: "session:start" }, { source: "section", on: "session:start" }] }],
	}));
	const resources = buildResourceRegistry([owner], root);
	const params = buildInjectionParamsRegistry([owner], root);
	const rendered = await renderContextStack({ cwd: root, resources, params });
	assert.ok(rendered);
	assert.match(rendered.content, /read path="a.md"/);
	assert.match(rendered.content, /## Keep\nbody/);
	const repomix = new RepomixFilePacker();
	assert.equal(repomix.supports({ cwd: root, warnings: [], sources: [] }), false);
});

test("legacy stripper removes active-stack blocks and old bundle blocks from text", () => {
	const [message] = stripLegacyContextTreeBlocks([{ role: "user", content: "hello\n<!-- context-tree:active-stack:start -->x<!-- context-tree:active-stack:end -->\n# Context Tree Bundle\nold" }]);
	assert.equal((message as { content: string }).content, "hello");
});
