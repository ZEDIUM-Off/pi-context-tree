import { parsePromptPaths } from "../bundle.js";
import type { HookName } from "../schema.js";

export function toolHook(toolName: string): HookName | undefined {
	if (
		["read", "edit", "write", "grep", "find", "ls", "bash"].includes(toolName)
	)
		return `tool:${toolName}` as HookName;
	return undefined;
}

export function toolTargetPath(
	toolName: string,
	input: unknown,
): string | undefined {
	if (!input || typeof input !== "object") return undefined;
	const record = input as Record<string, unknown>;
	if (typeof record.path === "string") return record.path;
	if (typeof record.pattern === "string" && typeof record.path === "string")
		return record.path;
	if (toolName === "bash" && typeof record.command === "string")
		return parsePromptPaths(record.command)[0];
	return undefined;
}
