export type CtPatchFeedback = {
	path: string;
	editCount: number;
	created: boolean;
	beforeLines: number;
	afterLines: number;
	addedLines: number;
	removedLines: number;
	diff: string;
	truncated: boolean;
	agentText: string;
};

function linesOf(content: string): string[] {
	if (content.length === 0) return [];
	return content.endsWith("\n") ? content.slice(0, -1).split("\n") : content.split("\n");
}

function commonPrefixLength(left: readonly string[], right: readonly string[]): number {
	let index = 0;
	while (index < left.length && index < right.length && left[index] === right[index]) index += 1;
	return index;
}

function commonSuffixLength(left: readonly string[], right: readonly string[], prefix: number): number {
	let count = 0;
	while (
		count + prefix < left.length &&
		count + prefix < right.length &&
		left[left.length - 1 - count] === right[right.length - 1 - count]
	) count += 1;
	return count;
}

function clampDiffLines(lines: string[], maxLines: number): { lines: string[]; truncated: boolean } {
	if (lines.length <= maxLines) return { lines, truncated: false };
	const omitted = lines.length - maxLines;
	return { lines: [...lines.slice(0, maxLines), `... ${omitted} more diff line(s) omitted`], truncated: true };
}

export function buildFocusedUnifiedDiff(before: string, after: string, filePath: string, maxLines = 80): { diff: string; truncated: boolean } {
	const beforeLines = linesOf(before);
	const afterLines = linesOf(after);
	if (before === after) return { diff: `--- ${filePath}\n+++ ${filePath}\n(no textual change)`, truncated: false };

	const prefix = commonPrefixLength(beforeLines, afterLines);
	const suffix = commonSuffixLength(beforeLines, afterLines, prefix);
	const removed = beforeLines.slice(prefix, beforeLines.length - suffix);
	const added = afterLines.slice(prefix, afterLines.length - suffix);
	const contextBefore = beforeLines.slice(Math.max(0, prefix - 3), prefix);
	const contextAfter = afterLines.slice(afterLines.length - suffix, Math.min(afterLines.length, afterLines.length - suffix + 3));
	const startLine = Math.max(1, prefix - contextBefore.length + 1);
	const diffLines = [
		`--- ${filePath}`,
		`+++ ${filePath}`,
		`@@ around line ${startLine} @@`,
		...contextBefore.map((line) => ` ${line}`),
		...removed.map((line) => `-${line}`),
		...added.map((line) => `+${line}`),
		...contextAfter.map((line) => ` ${line}`),
	];
	const clamped = clampDiffLines(diffLines, maxLines);
	return { diff: clamped.lines.join("\n"), truncated: clamped.truncated };
}

export function buildPatchFeedback(input: {
	path: string;
	editCount: number;
	created: boolean;
	before: string;
	after: string;
	maxDiffLines?: number;
}): CtPatchFeedback {
	const beforeLines = linesOf(input.before).length;
	const afterLines = linesOf(input.after).length;
	const addedLines = Math.max(0, afterLines - beforeLines);
	const removedLines = Math.max(0, beforeLines - afterLines);
	const { diff, truncated } = buildFocusedUnifiedDiff(input.before, input.after, input.path, input.maxDiffLines);
	const verb = input.created ? "Created" : "Applied";
	const lineDelta = afterLines - beforeLines;
	const signedDelta = lineDelta >= 0 ? `+${lineDelta}` : String(lineDelta);
	const truncation = truncated ? "\n(diff preview truncated)" : "";
	return {
		path: input.path,
		editCount: input.editCount,
		created: input.created,
		beforeLines,
		afterLines,
		addedLines,
		removedLines,
		diff,
		truncated,
		agentText: `${verb} ${input.editCount} Context Tree patch(es) to ${input.path}.\nLines: ${beforeLines} → ${afterLines} (${signedDelta}).${truncation}\n\n\`\`\`diff\n${diff}\n\`\`\``,
	};
}

export function compactPatchFeedbackLine(details: Pick<CtPatchFeedback, "path" | "editCount" | "created" | "beforeLines" | "afterLines">): string {
	const verb = details.created ? "Created" : "Applied";
	const delta = details.afterLines - details.beforeLines;
	const signedDelta = delta >= 0 ? `+${delta}` : String(delta);
	return `${verb} ${details.editCount} patch(es) to ${details.path} · ${details.beforeLines} → ${details.afterLines} lines (${signedDelta})`;
}

export function previewPatchDiff(diff: string, maxLines = 12): { preview: string; omitted: number } {
	const lines = diff.split("\n");
	if (lines.length <= maxLines) return { preview: diff, omitted: 0 };
	const omitted = lines.length - maxLines;
	return { preview: [...lines.slice(0, maxLines), `... ${omitted} more diff line(s); expand the tool row for full diff`].join("\n"), omitted };
}
