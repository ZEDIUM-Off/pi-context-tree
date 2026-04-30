import { reviewInitProposal, runInitWizard } from "../init/wizard.js";
import type { CommandGroupDeps } from "./types.js";

export function registerInitCommands({ pi, command }: CommandGroupDeps): void {
	command(
		"ct-init",
		"Initialize Context Tree for current codebase with editable TUI loops and agent feedback. Args: [--resume].",
		async (args, ctx) => runInitWizard(pi, ctx, args.includes("--resume")),
	);
	command(
		"ct-init-review",
		"Review and persist an agent init proposal in current init session. Args: proposal text/JSON.",
		async (args, ctx) => reviewInitProposal(ctx, args),
	);
}
