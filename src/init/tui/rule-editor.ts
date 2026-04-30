import { readFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { z } from "zod";
import type {
	CustomUi,
	ExtensionContextLike,
	ThemeLike,
} from "../../pi/types.js";
import type { InitSession } from "../types.js";
import {
	formatVisualRange,
	parseVisualRange,
	RuleRangePicker,
	type VisualRange,
} from "./rule-range-picker.js";

const ruleProposalSchema = z.object({
	path: z.string().min(1),
	title: z.string().min(1),
	kind: z.enum(["skill", "rule", "doc"]),
	reason: z.string().min(1),
	mode: z.union([
		z.object({ type: z.literal("ref") }),
		z.object({ type: z.literal("lines"), ranges: z.array(z.string()).min(1) }),
	]),
	enabled: z.boolean().default(true),
});

export async function editRule(
	ctx: ExtensionContextLike,
	session: InitSession,
	index: number,
): Promise<void> {
	const rule = session.rules[index];
	if (!rule) return;
	const choice = await ctx.ui.select?.(`Rule: ${rule.title}`, [
		rule.enabled ? "Toggle off" : "Toggle on",
		"Edit ranges visually",
		"Edit rule JSON / ranges",
		`Show ref: ${pathToFileURL(path.join(session.cwd, rule.path)).href}`,
		"Back",
	]);
	if (!choice || choice === "Back") return;
	if (choice === "Toggle off" || choice === "Toggle on") {
		rule.enabled = !rule.enabled;
		return;
	}
	if (choice.startsWith("Show ref:")) {
		ctx.ui.notify(
			pathToFileURL(path.join(session.cwd, rule.path)).href,
			"info",
		);
		return;
	}
	if (choice === "Edit ranges visually") {
		await editRuleRangesVisual(ctx, session, rule);
		return;
	}
	const edited = await ctx.ui.editor?.(
		"Edit rule JSON. Line ranges may be line-line or line:char-line:char.",
		JSON.stringify(rule, null, "\t"),
	);
	if (!edited) return;
	try {
		session.rules[index] = ruleProposalSchema.parse(JSON.parse(edited));
	} catch (error) {
		ctx.ui.notify(
			error instanceof Error ? error.message : String(error),
			"error",
		);
	}
}

async function editRuleRangesVisual(
	ctx: ExtensionContextLike,
	session: InitSession,
	rule: InitSession["rules"][number],
): Promise<void> {
	const fullPath = path.join(session.cwd, rule.path);
	let text = "";
	try {
		text = await readFile(fullPath, "utf8");
	} catch (error) {
		ctx.ui.notify(
			error instanceof Error ? error.message : String(error),
			"error",
		);
		return;
	}
	const fileLines = text.split(/\r?\n/);
	const ranges = initialVisualRanges(rule, fileLines);
	if (typeof ctx.ui.custom !== "function") return;
	const custom = ctx.ui.custom as CustomUi;
	const result = await custom<VisualRange[] | undefined>(
		(tui, theme, _kb, done) => {
			if (!isThemeLike(theme)) throw new Error("Theme API is not available.");
			return new RuleRangePicker(fileLines, ranges, theme, tui, done);
		},
	);
	if (!result) return;
	rule.mode = { type: "lines", ranges: result.map(formatVisualRange) };
}

function initialVisualRanges(
	rule: InitSession["rules"][number],
	fileLines: string[],
): VisualRange[] {
	return rule.mode.type === "lines" && rule.mode.ranges.length > 0
		? rule.mode.ranges.map((raw) => parseVisualRange(raw, fileLines))
		: [parseVisualRange(undefined, fileLines)];
}

function isThemeLike(value: unknown): value is ThemeLike {
	return (
		typeof value === "object" &&
		value !== null &&
		typeof (value as { fg?: unknown }).fg === "function" &&
		typeof (value as { bg?: unknown }).bg === "function"
	);
}
