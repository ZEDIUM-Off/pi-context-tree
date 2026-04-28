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
const id = `${rawBase}/v${version}/schemas/context.schema.json`;
const withId = { $id: id, ...schema };

const versionDir = path.join("schemas", "versions", `v${version}`);
await mkdir(versionDir, { recursive: true });
await writeFile(
	path.join(versionDir, "context.schema.json"),
	`${JSON.stringify(withId, null, 2)}\n`,
	"utf8",
);
