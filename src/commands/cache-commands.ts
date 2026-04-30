import type { ExtensionContextLike } from "../pi/types.js";
import type { CommandDeps, CommandGroupDeps } from "./types.js";

export function registerCacheCommands({ command, deps }: CommandGroupDeps): void {
	command(
		"ct-fetch",
		"Compile bundle for target and fetch/cache inline URL sources. Args: <path>.",
		async (args, ctx) => fetchCommand(args, ctx, deps),
	);
	command(
		"ct-cache-refresh",
		"Refresh cached URL sources for target bundle. Args: <path>.",
		async (args, ctx) => fetchCommand(args, ctx, deps),
	);
	command(
		"ct-cache-list",
		"Show Context Tree URL cache directory.",
		async (_args, ctx) =>
			ctx.ui.notify(
				"URL cache lives at .pi/context-tree/cache/urls. Use ls/find for detailed inspection.",
				"info",
			),
	);
}

async function fetchCommand(
	args: string,
	ctx: ExtensionContextLike,
	deps: CommandDeps,
): Promise<void> {
	const target = args.trim();
	if (!target) return ctx.ui.notify("Usage: /ct-fetch <path>", "warning");
	const { bundle } = await deps.resolveAndRender(
		ctx.cwd,
		target,
		"agent:start",
	);
	ctx.ui.notify(
		`Fetched/compiled ${bundle.sources.length} source(s). Bundle ${bundle.bundleHash.slice(0, 12)}.`,
		"info",
	);
}
