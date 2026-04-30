import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import type { ExtensionContextLike } from "../pi/types.js";
import { registerCacheCommands } from "./cache-commands.js";
import { registerExplainCommands } from "./explain-commands.js";
import { registerInitCommands } from "./init-commands.js";
import { registerStatusCommands } from "./status-commands.js";
import { registerSubagentCommands } from "./subagent-commands.js";
import type { CommandDeps, CommandGroupDeps } from "./types.js";
import { registerUpgradeCommands } from "./upgrade-commands.js";

export type { CommandDeps } from "./types.js";

export function registerCommands(pi: ExtensionAPI, deps: CommandDeps): void {
	const command = (
		name: string,
		description: string,
		handler: (args: string, ctx: ExtensionContextLike) => Promise<void> | void,
	) =>
		pi.registerCommand(name, {
			description,
			handler: async (args, ctx) => {
				await handler(args, ctx);
			},
		});
	const groupDeps: CommandGroupDeps = { pi, command, deps };
	registerStatusCommands(groupDeps);
	registerExplainCommands(groupDeps);
	registerCacheCommands(groupDeps);
	registerUpgradeCommands(groupDeps);
	registerInitCommands(groupDeps);
	registerSubagentCommands(groupDeps);
}
