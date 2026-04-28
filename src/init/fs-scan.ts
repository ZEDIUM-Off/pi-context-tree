import type { Dirent } from "node:fs";
import { readdir, stat } from "node:fs/promises";
import path from "node:path";
import type { FsScanResult } from "./types.js";

const defaultIgnores = new Set([
	".git",
	"node_modules",
	".pnpm-store",
	"dist",
	"build",
	"coverage",
	".next",
	".nuxt",
	".cache",
	".turbo",
	"target",
	"vendor",
	".venv",
	"__pycache__",
	".pi",
]);

export async function scanFileSystem(
	cwd: string,
	options: { maxFiles?: number; ignore?: string[] } = {},
): Promise<FsScanResult> {
	const maxFiles = options.maxFiles ?? 5000;
	const ignores = new Set([...defaultIgnores, ...(options.ignore ?? [])]);
	const files: FsScanResult["files"] = [];
	const dirs: string[] = [];
	const ignored: string[] = [];
	const byExtension: Record<string, number> = {};
	let totalBytes = 0;

	async function walk(dir: string): Promise<void> {
		if (files.length >= maxFiles) return;
		let entries: Dirent[];
		try {
			entries = await readdir(dir, { withFileTypes: true });
		} catch {
			return;
		}
		for (const entry of entries) {
			if (ignores.has(entry.name)) {
				ignored.push(
					path.relative(cwd, path.join(dir, entry.name)) || entry.name,
				);
				continue;
			}
			const full = path.join(dir, entry.name);
			const rel = path.relative(cwd, full).replaceAll(path.sep, "/");
			if (entry.isDirectory()) {
				dirs.push(rel);
				await walk(full);
				continue;
			}
			if (!entry.isFile()) continue;
			const info = await stat(full).catch(() => undefined);
			const extension = path.extname(entry.name) || "<none>";
			const size = info?.size ?? 0;
			files.push({ path: rel, size, extension });
			byExtension[extension] = (byExtension[extension] ?? 0) + 1;
			totalBytes += size;
			if (files.length >= maxFiles) return;
		}
	}

	await walk(cwd);
	files.sort((a, b) => a.path.localeCompare(b.path));
	dirs.sort();
	return {
		cwd,
		files,
		dirs,
		ignored,
		stats: {
			fileCount: files.length,
			dirCount: dirs.length,
			byExtension,
			totalBytes,
		},
	};
}
