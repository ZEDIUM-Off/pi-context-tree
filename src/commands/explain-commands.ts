import { explainPath, formatExplain } from "../bundle.js";
import { scanContextParents } from "../scan.js";
import type { HookName } from "../schema.js";
import type { CommandGroupDeps } from "./types.js";

const hookNames = new Set<HookName>([
	"session:start",
	"agent:start",
	"tool:read",
	"tool:edit",
	"tool:write",
	"tool:grep",
	"tool:find",
	"tool:ls",
	"tool:bash",
	"session:spawn",
	"subagent:spawn",
]);

export function registerExplainCommands({ command }: CommandGroupDeps): void {
	command(
		"ct-explain",
		"Explain matched hooks and sources for target. Args: <path> [hook], default hook agent:start.",
		async (args, ctx) => {
			const parts = args.trim().split(/\s+/).filter(Boolean);
			const maybeHook = parts.at(-1) as HookName | undefined;
			const hook =
				maybeHook && hookNames.has(maybeHook) ? maybeHook : "agent:start";
			const target = (hook === maybeHook ? parts.slice(0, -1) : parts).join(
				" ",
			);
			if (!target)
				return ctx.ui.notify("Usage: /ct-explain <path> [hook]", "warning");
			const targetScopes = await scanContextParents(ctx.cwd, target);
			ctx.ui.notify(
				formatExplain(
					ctx.cwd,
					explainPath(ctx.cwd, targetScopes, target, hook),
				),
				"info",
			);
		},
	);
}
