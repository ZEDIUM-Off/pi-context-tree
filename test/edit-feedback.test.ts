import assert from "node:assert/strict";
import test from "node:test";
import { buildFocusedUnifiedDiff, buildPatchFeedback, compactPatchFeedbackLine, previewPatchDiff } from "../src/runtime/edit-feedback.js";

test("patch feedback gives agent-readable summary and focused diff", () => {
	const feedback = buildPatchFeedback({
		path: "src/example.ts",
		editCount: 1,
		created: false,
		before: "export const value = 1;\n",
		after: "export const value = 2;\n",
	});

	assert.equal(feedback.path, "src/example.ts");
	assert.equal(feedback.beforeLines, 1);
	assert.equal(feedback.afterLines, 1);
	assert.match(feedback.agentText, /Applied 1 Context Tree patch/);
	assert.match(feedback.agentText, /```diff/);
	assert.match(feedback.diff, /-export const value = 1;/);
	assert.match(feedback.diff, /\+export const value = 2;/);
	assert.equal(compactPatchFeedbackLine(feedback), "Applied 1 patch(es) to src/example.ts · 1 → 1 lines (+0)");
});

test("patch feedback reports file creation and truncates large diffs", () => {
	const after = Array.from({ length: 20 }, (_, index) => `line ${index + 1}`).join("\n");
	const feedback = buildPatchFeedback({
		path: "docs/new.md",
		editCount: 1,
		created: true,
		before: "",
		after,
		maxDiffLines: 8,
	});

	assert.equal(feedback.created, true);
	assert.equal(feedback.beforeLines, 0);
	assert.equal(feedback.afterLines, 20);
	assert.equal(feedback.truncated, true);
	assert.match(feedback.agentText, /Created 1 Context Tree patch/);
	assert.match(feedback.diff, /more diff line\(s\) omitted/);
});

test("focused unified diff shows unchanged text as no textual change", () => {
	const diff = buildFocusedUnifiedDiff("same\n", "same\n", "file.txt");
	assert.equal(diff.truncated, false);
	assert.match(diff.diff, /no textual change/);
});

test("patch diff preview keeps collapsed TUI output informative", () => {
	const diff = Array.from({ length: 15 }, (_, index) => `line ${index + 1}`).join("\n");
	const preview = previewPatchDiff(diff, 4);
	assert.equal(preview.omitted, 11);
	assert.match(preview.preview, /line 1/);
	assert.match(preview.preview, /expand the tool row for full diff/);
});
