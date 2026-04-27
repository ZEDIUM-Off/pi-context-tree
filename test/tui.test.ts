import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
	buildBundle,
	explainPath,
	renderBundle,
	scanContextParents,
} from "../src/context-tree.js";
import {
	detailText,
	renderTui,
	statusText,
	summarizeBundle,
	type TuiState,
	widgetLines,
} from "../src/tui.js";

function tempRepo() {
	return mkdtempSync(join(tmpdir(), "context-tree-tui-"));
}

async function buildLocalBundle() {
	const repo = tempRepo();
	await mkdir(join(repo, "docs"), { recursive: true });
	await writeFile(
		join(repo, "CONTEXT.json"),
		JSON.stringify({
			version: 1,
			context: [
				{
					match: ["src/**/*.ts"],
					operations: ["read", "edit"],
					inject: ["./docs/rules.md"],
				},
			],
		}),
	);
	await mkdir(join(repo, "src"), { recursive: true });
	await writeFile(join(repo, "src/service.ts"), "export const service = true;\n");
	await writeFile(join(repo, "docs/rules.md"), "# Rules\nline two\nline three\n");
	const scopes = await scanContextParents(repo, "src/service.ts");
	const explained = explainPath(repo, scopes, "src/service.ts", "read");
	const bundle = await buildBundle(repo, explained);
	return { repo, bundle };
}

test("tui summarizes injected bundle with reference counts, lines, and tokens", async () => {
	const { repo, bundle } = await buildLocalBundle();
	const summary = summarizeBundle(repo, bundle);

	assert.equal(summary.target, "src/service.ts");
	assert.equal(summary.operation, "read");
	assert.equal(summary.sourceCount, 1);
	assert.equal(summary.fileCount, 1);
	assert.equal(summary.urlCount, 0);
	assert.equal(summary.lineCount, 4);
	assert.ok(summary.tokensApprox > 0);
	assert.equal(summary.references[0]?.id, "docs/rules.md");
	assert.equal(summary.references[0]?.kind, "file");
	assert.match(summary.references[0]?.uri ?? "", /^file:\/\//);
});

test("tui compact widget shows injection overview without full source content", async () => {
	const { repo, bundle } = await buildLocalBundle();
	const state: TuiState = {
		scopesValid: 1,
		scopesInvalid: 0,
		enabled: true,
		mode: "compact",
		lastInjection: summarizeBundle(repo, bundle),
	};
	const lines = widgetLines(state);
	const joined = lines.join("\n");

	assert.match(statusText(state), /1 src/);
	assert.match(statusText(state), /tok/);
	assert.match(joined, /refs: 1 \(1 files, 0 urls\)/);
	assert.match(joined, /size: 4 lines · ~\d+ tok/);
	assert.match(joined, /detail: Ctrl\+Shift\+C/);
	assert.doesNotMatch(joined, /line two/);
});

test("tui verbose widget and detail view expose clickable references", async () => {
	const { repo, bundle } = await buildLocalBundle();
	const state: TuiState = {
		scopesValid: 1,
		scopesInvalid: 0,
		enabled: true,
		mode: "verbose",
		lastInjection: summarizeBundle(repo, bundle),
	};

	assert.match(widgetLines(state).join("\n"), /references:\n- docs\/rules\.md/);
	const detail = detailText(state);
	assert.match(detail, /# Context Tree injection detail/);
	assert.match(detail, /References: 1 \(1 files, 0 urls\)/);
	assert.match(detail, /file:\/\/.*docs\/rules\.md/);
});

test("renderTui writes status and clears widget when disabled", async () => {
	const { repo, bundle } = await buildLocalBundle();
	const calls: Array<{ key: string; value: string | string[] | undefined }> = [];
	const ui = {
		setStatus: (key: string, value: string) => calls.push({ key, value }),
		setWidget: (key: string, value: string[] | undefined) =>
			calls.push({ key, value }),
	};
	const state: TuiState = {
		scopesValid: 1,
		scopesInvalid: 0,
		enabled: false,
		mode: "compact",
		lastInjection: summarizeBundle(repo, bundle),
	};

	renderTui(ui, state);
	assert.equal(calls[0]?.key, "context-tree");
	assert.equal(typeof calls[0]?.value, "string");
	assert.equal(calls[1]?.key, "context-tree");
	assert.equal(calls[1]?.value, undefined);
});

test("injection render still contains full bundle for agent while TUI stays overview", async () => {
	const { repo, bundle } = await buildLocalBundle();
	const rendered = renderBundle(bundle);
	const state: TuiState = {
		scopesValid: 1,
		scopesInvalid: 0,
		enabled: true,
		mode: "compact",
		lastInjection: summarizeBundle(repo, bundle),
	};

	assert.match(rendered, /# Context Tree Bundle/);
	assert.match(rendered, /## Source: docs\/rules\.md/);
	assert.match(rendered, /line two/);
	assert.doesNotMatch(widgetLines(state).join("\n"), /line two/);
});
