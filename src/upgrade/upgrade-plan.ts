import { readFile } from "node:fs/promises";
import { scanAllContextTree } from "../scan.js";
import { contextFileSchema } from "../schema.js";
import { currentSchemaUrl, parseSchemaRef } from "./schema-ref.js";

export type UpgradePlanItem = {
	path: string;
	status: "current" | "outdated" | "local" | "unknown" | "invalid";
	message: string;
	before?: unknown;
	after?: unknown;
};

export async function buildUpgradePlan(
	cwd: string,
	version?: string,
): Promise<UpgradePlanItem[]> {
	const scan = await scanAllContextTree(cwd);
	const paths = new Set(scan.scopes.map((scope) => scope.configPath));
	const out: UpgradePlanItem[] = [];
	for (const scope of scan.scopes) {
		const raw = await readJson(scope.configPath);
		const ref = parseSchemaRef(raw?.$schema);
		if (ref.kind === "local") {
			out.push({
				path: scope.configPath,
				status: "local",
				message: `local schema ${ref.raw}`,
			});
			continue;
		}
		if (ref.kind === "github-release" && ref.version === version) {
			out.push({
				path: scope.configPath,
				status: "current",
				message: "schema current",
			});
			continue;
		}
		const after = { ...raw, $schema: currentSchemaUrl(version) };
		contextFileSchema.parse(after);
		out.push({
			path: scope.configPath,
			status: "outdated",
			message: `migrate ${ref.raw ?? "unknown schema"} -> current schema`,
			before: raw,
			after,
		});
	}
	for (const error of scan.errors) {
		paths.add(error.configPath);
		out.push({
			path: error.configPath,
			status: "invalid",
			message: error.message,
		});
	}
	return out.sort((a, b) => a.path.localeCompare(b.path));
}

async function readJson(filePath: string): Promise<any | undefined> {
	try {
		return JSON.parse(await readFile(filePath, "utf8"));
	} catch {
		return undefined;
	}
}
