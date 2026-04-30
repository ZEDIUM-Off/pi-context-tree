import type { CommandGroupDeps } from "./types.js";

export function registerSubagentCommands({ command }: CommandGroupDeps): void {
	command(
		"ct-subagent",
		"Planned subagent handoff using subagent:spawn hook. Args: <path> <task>.",
		async (_args, ctx) =>
			ctx.ui.notify(
				"Subagent interop planned: resolve hook subagent:spawn via Context Tree bundle.",
				"warning",
			),
	);
}
