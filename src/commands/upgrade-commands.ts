import {
	applyUpgradePlan,
	formatUpgradePlan,
} from "../upgrade/apply-upgrade.js";
import { buildUpgradePlan } from "../upgrade/upgrade-plan.js";
import type { CommandGroupDeps } from "./types.js";

export function registerUpgradeCommands({ command, deps }: CommandGroupDeps): void {
	command(
		"ct-schema-status",
		"Show schema refs and upgrade status for all CONTEXT.json files.",
		async (_args, ctx) => {
			const plan = await buildUpgradePlan(ctx.cwd, "0.2.0");
			ctx.ui.notify(
				formatUpgradePlan(ctx.cwd, plan),
				plan.some((item) => item.status === "invalid") ? "error" : "info",
			);
		},
	);
	command(
		"ct-upgrade-plan",
		"Preview CONTEXT.json schema migrations without writing.",
		async (_args, ctx) => {
			const plan = await buildUpgradePlan(ctx.cwd, "0.2.0");
			ctx.ui.notify(formatUpgradePlan(ctx.cwd, plan), "info");
		},
	);
	command(
		"ct-upgrade",
		"Migrate CONTEXT.json files to current required $schema contract after confirmation.",
		async (_args, ctx) => {
			const plan = await buildUpgradePlan(ctx.cwd, "0.2.0");
			const actionable = plan.filter((item) => item.after);
			if (actionable.length === 0)
				return ctx.ui.notify("No schema upgrade needed.", "info");
			const ok = await ctx.ui.confirm?.(
				"Apply Context Tree schema upgrade?",
				formatUpgradePlan(ctx.cwd, plan),
			);
			if (!ok) return;
			const count = await applyUpgradePlan(plan);
			await deps.reload(ctx.cwd);
			ctx.ui.notify(`Upgraded ${count} CONTEXT.json file(s).`, "info");
		},
	);
}
