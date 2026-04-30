import type { Dirent } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { type ContextFile, contextFileSchema } from "./schema.js";
import { stripAtPrefix, toPosix } from "./util.js";

export type ContextScope = {
	configPath: string;
	dir: string;
	basePath: string;
	config: ContextFile;
	global?: boolean;
};

export type ScanAllResult = {
	scopes: ContextScope[];
	errors: Array<{ configPath: string; message: string }>;
};

export function globalContextPath(): string {
	return (
		process.env.PI_CONTEXT_TREE_GLOBAL ??
		path.join(homedir(), ".pi", "CONTEXT.json")
	);
}

async function readContextScope(
	configPath: string,
	cwd: string,
	options: { global?: boolean } = {},
): Promise<ContextScope> {
	const raw = await readFile(configPath, "utf8");
	const config = contextFileSchema.parse(JSON.parse(raw));
	const dir = path.dirname(configPath);
	return {
		configPath,
		dir,
		basePath: options.global
			? "<global>"
			: toPosix(path.relative(cwd, dir)) || ".",
		config,
		...(options.global ? { global: true } : {}),
	};
}

export async function scanContextParents(
	cwd: string,
	targetPath = ".",
): Promise<ContextScope[]> {
	const targetAbs = path.resolve(cwd, stripAtPrefix(targetPath));
	const statPath =
		targetAbs.endsWith("CONTEXT.json") || path.extname(targetAbs)
			? path.dirname(targetAbs)
			: targetAbs;
	const relParts = toPosix(path.relative(cwd, statPath))
		.split("/")
		.filter(Boolean);
	const dirs = [cwd];
	let cur = cwd;
	for (const part of relParts) {
		cur = path.join(cur, part);
		dirs.push(cur);
	}
	const scopes: ContextScope[] = [];
	try {
		scopes.push(
			await readContextScope(globalContextPath(), cwd, { global: true }),
		);
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
	}
	for (const dir of dirs) {
		const configPath = path.join(dir, "CONTEXT.json");
		try {
			scopes.push(await readContextScope(configPath, cwd));
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code === "ENOENT") continue;
			throw error;
		}
	}
	return scopes;
}

export async function scanAllContextTree(cwd: string): Promise<ScanAllResult> {
	const scopes: ContextScope[] = [];
	const errors: Array<{ configPath: string; message: string }> = [];
	try {
		scopes.push(
			await readContextScope(globalContextPath(), cwd, { global: true }),
		);
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== "ENOENT")
			errors.push({
				configPath: globalContextPath(),
				message: error instanceof Error ? error.message : String(error),
			});
	}

	async function walk(dir: string): Promise<void> {
		let entries: Dirent[];
		try {
			entries = await readdir(dir, { withFileTypes: true });
		} catch {
			return;
		}
		for (const entry of entries) {
			if (
				entry.name === "node_modules" ||
				entry.name === ".git" ||
				entry.name === ".pi"
			)
				continue;
			const full = path.join(dir, entry.name);
			if (entry.isDirectory()) {
				await walk(full);
				continue;
			}
			if (entry.isFile() && entry.name === "CONTEXT.json") {
				try {
					scopes.push(await readContextScope(full, cwd));
				} catch (error) {
					errors.push({
						configPath: full,
						message: error instanceof Error ? error.message : String(error),
					});
				}
			}
		}
	}

	await walk(cwd);
	scopes.sort((a, b) => a.basePath.localeCompare(b.basePath));
	errors.sort((a, b) => a.configPath.localeCompare(b.configPath));
	return { scopes, errors };
}
