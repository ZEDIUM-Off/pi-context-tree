import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import type { buildBundle } from "../bundle.js";
import type { ExtensionContextLike, OptionalSessionContext } from "../pi/types.js";
import type { ContextScope } from "../scan.js";
import type { HookName } from "../schema.js";

export type CommandDeps = {
	reload: (cwd: string) => Promise<ContextScope[]>;
	showStatus: (ctx: OptionalSessionContext) => void;
	statusText: () => string;
	showDetail: (ctx: ExtensionContextLike) => Promise<void>;
	resolveAndRender: (
		cwd: string,
		target: string,
		hook: HookName,
	) => Promise<{
		bundle: Awaited<ReturnType<typeof buildBundle>>;
		rendered: string;
	}>;
	getScopes: () => ContextScope[];
	getScanErrors: () => Array<{ configPath: string; message: string }>;
	setTuiEnabled: (value: boolean) => void;
	setExtensionEnabled: (value: boolean) => void;
};

export type CommandRegistrar = (
	name: string,
	description: string,
	handler: (args: string, ctx: ExtensionContextLike) => Promise<void> | void,
) => void;

export type CommandGroupDeps = {
	pi: ExtensionAPI;
	command: CommandRegistrar;
	deps: CommandDeps;
};
