import path from "node:path";
import type { CommandGroupDeps } from "./types.js";

export function registerStatusCommands({ command, deps }: CommandGroupDeps): void {
	command(
		"ct-status",
		"Show Context Tree scan status: valid/invalid CONTEXT.json count and last injection summary.",
		async (_args, ctx) =>
			ctx.ui.notify(
				deps.statusText(),
				deps.getScanErrors().length ? "warning" : "info",
			),
	);
	command(
		"ct-detail",
		"Open interactive Context Tree inspector with scopes, branch, injection stack, references, and warnings.",
		async (_args, ctx) => deps.showDetail(ctx),
	);
	command(
		"ct-tui",
		"Toggle Context Tree TUI widget only. Args: on|off.",
		async (args, ctx) => {
			const mode = args.trim();
			if (mode !== "on" && mode !== "off")
				return ctx.ui.notify("Usage: /ct-tui on|off", "warning");
			deps.setTuiEnabled(mode === "on");
			deps.showStatus(ctx);
		},
	);
	command(
		"ct-toggle",
		"Toggle entire Context Tree extension runtime. Args: on|off.",
		async (args, ctx) => {
			const mode = args.trim();
			if (mode !== "on" && mode !== "off")
				return ctx.ui.notify("Usage: /ct-toggle on|off", "warning");
			deps.setExtensionEnabled(mode === "on");
			deps.showStatus(ctx);
			ctx.ui.notify(`Context Tree extension ${mode}.`, "info");
		},
	);
	command(
		"ct-validate",
		"Validate all CONTEXT.json files and print valid/invalid paths.",
		async (_args, ctx) => {
			await deps.reload(ctx.cwd);
			const lines = [
				`Context Tree validation: ${deps.getScopes().length} valid, ${deps.getScanErrors().length} invalid.`,
			];
			for (const scope of deps.getScopes()) {
				const runtimeRules = scope.config.injection_rules.filter(
					(rule) => !rule.match,
				).length;
				const pathRules = scope.config.injection_rules.length - runtimeRules;
				lines.push(
					`- valid ${path.relative(ctx.cwd, scope.configPath) || "CONTEXT.json"}: ${Object.keys(scope.config.sources).length} source(s), ${scope.config.injection_rules.length} rule(s) (${pathRules} path, ${runtimeRules} runtime)`,
				);
			}
			for (const error of deps.getScanErrors())
				lines.push(
					`- invalid ${path.relative(ctx.cwd, error.configPath)}: ${error.message}`,
				);
			ctx.ui.notify(
				lines.join("\n"),
				deps.getScanErrors().length ? "error" : "info",
			);
		},
	);
}
