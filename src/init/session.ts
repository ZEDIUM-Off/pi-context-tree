import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { InitSession } from "./types.js";

export function initSessionDir(cwd: string): string {
	return path.join(cwd, ".pi", "context-tree", "init");
}

export async function persistInitSession(session: InitSession): Promise<void> {
	await mkdir(initSessionDir(session.cwd), { recursive: true });
	await writeFile(
		initSessionPath(session),
		JSON.stringify(session, null, 2),
		"utf8",
	);
}

export function initSessionPath(session: InitSession): string {
	return path.join(initSessionDir(session.cwd), `${session.id}.json`);
}

export async function loadLatestInitSession(
	cwd: string,
): Promise<InitSession | undefined> {
	let files: string[];
	try {
		files = await readdir(initSessionDir(cwd));
	} catch {
		return undefined;
	}
	const latest = files
		.filter((file) => file.endsWith(".json"))
		.sort()
		.at(-1);
	if (!latest) return undefined;
	return sanitizeInitSession(
		JSON.parse(
			await readFile(path.join(initSessionDir(cwd), latest), "utf8"),
		) as InitSession,
	);
}

function sanitizeInitSession(session: InitSession): InitSession {
	if (session.phase === "preview") session.generatedFiles = [];
	return session;
}
