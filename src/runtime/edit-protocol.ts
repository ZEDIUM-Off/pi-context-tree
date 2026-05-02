import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { keyHint, type ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Text } from "@mariozechner/pi-tui";
import { updateActiveInjections } from "../runtime-context/active-injection-registry.js";
import { resolveHookBatch } from "../runtime-context/batch-resolver.js";
import { stripAtPrefix } from "../util.js";
import type { RuntimeState } from "./state.js";
import { buildPatchFeedback, compactPatchFeedbackLine, previewPatchDiff, type CtPatchFeedback } from "./edit-feedback.js";
import { showActiveInjection } from "./state.js";

function normalizeTarget(cwd: string, target: string): string {
	const absolute = path.resolve(cwd, stripAtPrefix(target));
	const relative = path.relative(cwd, absolute);
	if (relative.startsWith("..") || path.isAbsolute(relative)) throw new Error(`Target escapes workspace: ${target}`);
	return relative.split(path.sep).join("/");
}

async function activateEditContext(state: RuntimeState, cwd: string, targets: string[]) {
	const invocations = targets.flatMap((target) => [{ hook: "tool:edit" as const, target }, { hook: "tool:write" as const, target }]);
	const resolution = await resolveHookBatch({ params: state.injectionParams, invocations, rootDir: cwd });
	state.resolutionHistory = [resolution, ...state.resolutionHistory].slice(0, 50);
	state.activeChanges = updateActiveInjections({ registry: state.activeInjections, params: resolution.selected, hook: "tool:edit", targets, warnings: resolution.warnings });
	return resolution;
}

export function registerEditProtocolTools(pi: ExtensionAPI, state: RuntimeState): void {
	pi.registerTool({
		name: "ct_edit_request",
		label: "Context Tree Edit Request",
		description: "Request a Context Tree-gated edit session for explicit targets before patching.",
		parameters: {
			type: "object",
			properties: {
				targets: { type: "array", items: { type: "string" }, minItems: 1 },
				intent: { type: "string" },
			},
			required: ["targets"],
		},
		async execute(_toolCallId, args, _signal, _onUpdate, ctx) {
			const input = args as { targets?: string[]; intent?: string };
			const targets = (input.targets ?? []).map((target) => normalizeTarget(ctx.cwd, target));
			if (!targets.length) throw new Error("ct_edit_request requires at least one target");
			const resolution = await activateEditContext(state, ctx.cwd, targets);
			state.editSession = { targets, requestedAt: Date.now(), ...(input.intent ? { intent: input.intent } : {}) };
			showActiveInjection(state, ctx);
			const text = `Context Tree edit session active for ${targets.join(", ")}. Selected ${resolution.selected.length} context sources; skipped ${resolution.skipped.length}; conflicts ${resolution.conflicts.length}. Use ct_patch for authorized targets only.`;
			return { content: [{ type: "text", text }], details: { targets, selected: resolution.selected.length, skipped: resolution.skipped.length, conflicts: resolution.conflicts.length, message: text } };
		},
		renderCall(args, theme) {
			const input = args as { targets?: string[]; intent?: string };
			const targets = input.targets?.join(", ") ?? "<no targets>";
			const intent = input.intent ? ` · ${input.intent}` : "";
			return new Text(`${theme.fg("toolTitle", theme.bold("ct_edit_request"))} ${theme.fg("muted", targets)}${theme.fg("dim", intent)}`, 0, 0);
		},
		renderResult(result, _options, theme) {
			const details = result.details as { selected?: number; skipped?: number; conflicts?: number; targets?: string[] } | undefined;
			const targets = details?.targets?.join(", ") ?? "targets authorized";
			const diagnostics = `selected ${details?.selected ?? 0}, skipped ${details?.skipped ?? 0}, conflicts ${details?.conflicts ?? 0}`;
			return new Text(`${theme.fg("success", "✓ Context Tree edit session active")} ${theme.fg("muted", targets)}\n${theme.fg("dim", `↳ ${diagnostics}; use ct_patch for authorized targets only`)}`, 0, 0);
		},
	});

	pi.registerTool({
		name: "ct_patch",
		label: "Context Tree Patch",
		description: "Apply exact text replacements within the active Context Tree edit session targets.",
		parameters: {
			type: "object",
			properties: {
				path: { type: "string" },
				edits: { type: "array", items: { type: "object", properties: { oldText: { type: "string" }, newText: { type: "string" } }, required: ["oldText", "newText"] }, minItems: 1 },
			},
			required: ["path", "edits"],
		},
		async execute(_toolCallId, args, _signal, _onUpdate, ctx) {
			if (!state.editSession) throw new Error("No active Context Tree edit session. Call ct_edit_request first.");
			const input = args as { path?: string; edits?: Array<{ oldText: string; newText: string }> };
			if (!input.path || !input.edits?.length) throw new Error("ct_patch requires path and edits");
			const target = normalizeTarget(ctx.cwd, input.path);
			if (!state.editSession.targets.includes(target)) throw new Error(`Target not authorized by ct_edit_request: ${target}`);
			const absolute = path.join(ctx.cwd, target);
			const existing = await readFile(absolute, "utf8").then((content) => ({ exists: true as const, content })).catch((error: NodeJS.ErrnoException) => {
				if (error.code === "ENOENT") return { exists: false as const, content: "" };
				throw error;
			});
			let content = existing.content;
			if (!existing.exists) {
				if (input.edits.length !== 1 || input.edits[0]?.oldText !== "") throw new Error(`Cannot patch missing file ${target}; use one edit with oldText="" to create it`);
				content = input.edits[0]?.newText ?? "";
			} else {
				for (const edit of input.edits) {
					if (edit.oldText === "") throw new Error(`oldText cannot be empty for existing file ${target}`);
					const occurrences = content.split(edit.oldText).length - 1;
					if (occurrences !== 1) throw new Error(`oldText must match exactly once in ${target}; matched ${occurrences}`);
					content = content.replace(edit.oldText, edit.newText);
				}
			}
			await mkdir(path.dirname(absolute), { recursive: true });
			await writeFile(absolute, content);
			const feedback = buildPatchFeedback({ path: target, editCount: input.edits.length, created: !existing.exists, before: existing.content, after: content });
			return { content: [{ type: "text", text: feedback.agentText }], details: feedback };
		},
		renderCall(args, theme) {
			const input = args as { path?: string; edits?: Array<{ oldText: string; newText: string }> };
			const count = input.edits?.length ?? 0;
			return new Text(`${theme.fg("toolTitle", theme.bold("ct_patch"))} ${theme.fg("muted", input.path ?? "<missing path>")} ${theme.fg("dim", `${count} edit(s)`)}`, 0, 0);
		},
		renderResult(result, options, theme) {
			const details = result.details as CtPatchFeedback | undefined;
			if (!details) return new Text(theme.fg("success", "✓ Context Tree patch applied"), 0, 0);
			let text = theme.fg("success", `✓ ${compactPatchFeedbackLine(details)}`);
			if (details.truncated) text += theme.fg("muted", " · diff truncated");
			const diff = options.expanded ? details.diff : previewPatchDiff(details.diff, 10).preview;
			const hint = options.expanded
				? "full diff; use the Pi/terminal scrollback for long output"
				: `preview; ${keyHint("app.tools.expand", "for full diff")}; then use Pi/terminal scrollback for long output`;
			text += `\n${theme.fg("dim", `↳ ${hint}`)}\n${diff.split("\n").map((line) => {
				if (line.startsWith("+")) return theme.fg("success", line);
				if (line.startsWith("-")) return theme.fg("error", line);
				if (line.startsWith("@@")) return theme.fg("accent", line);
				return theme.fg("toolOutput", line);
			}).join("\n")}`;
			return new Text(text, 0, 0);
		},
	});
}
