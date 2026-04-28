import { writeFile } from "node:fs/promises";
import type { UpgradePlanItem } from "./upgrade-plan.js";

export async function applyUpgradePlan(
	plan: UpgradePlanItem[],
): Promise<number> {
	let count = 0;
	for (const item of plan) {
		if (!item.after) continue;
		await writeFile(
			item.path,
			`${JSON.stringify(item.after, null, "\t")}\n`,
			"utf8",
		);
		count++;
	}
	return count;
}

export function formatUpgradePlan(
	cwd: string,
	plan: UpgradePlanItem[],
): string {
	const lines = ["Context Tree schema upgrade plan"];
	for (const item of plan) {
		const rel = item.path.startsWith(cwd)
			? item.path.slice(cwd.length + 1)
			: item.path;
		lines.push(`- ${item.status} ${rel}: ${item.message}`);
	}
	return lines.join("\n");
}
