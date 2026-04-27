import { mkdir, writeFile } from "node:fs/promises";
import { z } from "zod";
import { contextFileSchema } from "../src/context-schema.js";

const schema = z.toJSONSchema(contextFileSchema, {
	target: "draft-7",
});

await mkdir("schemas", { recursive: true });
await writeFile(
	"schemas/context.schema.json",
	`${JSON.stringify(schema, null, 2)}\n`,
	"utf8",
);
