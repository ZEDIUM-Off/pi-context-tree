import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { contextFileSchema } from "../src/context-schema.js";

const packageJson = JSON.parse(await readFile("package.json", "utf8")) as {
	version: string;
	repository?: { url?: string };
};

const version = packageJson.version;
const schema = z.toJSONSchema(contextFileSchema, {
	target: "draft-7",
});

const repository =
	packageJson.repository?.url
		?.replace(/^git\+/, "")
		.replace(/\.git$/, "")
		.replace("github.com:", "github.com/")
		.replace("ssh://git@", "https://")
		.replace("git@", "https://") ??
	"https://github.com/ZEDIUM-Off/pi-context-tree";
const rawBase = repository.replace(
	"https://github.com/",
	"https://raw.githubusercontent.com/",
);
const versionedId = `${rawBase}/v${version}/schemas/context.schema.json`;
const versionedSchema = { $id: versionedId, ...schema };
const latestId = `${rawBase}/main/schemas/versions/latest/context.schema.json`;
const latestSchema = { $id: latestId, ...schema };

async function writeSchemaSnapshot(dir: string, schemaSnapshot: unknown): Promise<void> {
	await mkdir(dir, { recursive: true });
	await writeFile(
		path.join(dir, "context.schema.json"),
		`${JSON.stringify(schemaSnapshot, null, 2)}\n`,
		"utf8",
	);
}

await writeSchemaSnapshot(
	path.join("schemas", "versions", `v${version}`),
	versionedSchema,
);
await writeSchemaSnapshot(
	path.join("schemas", "versions", "latest"),
	latestSchema,
);
