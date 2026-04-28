import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

export const contextTreeRemoteSource =
	"git:github.com/ZEDIUM-Off/pi-context-tree";

export type PackageEntry =
	| string
	| { source?: string; extensions?: string[]; [key: string]: unknown };
export type Settings = { packages?: PackageEntry[]; [key: string]: unknown };

export async function readSettings(settingsPath: string): Promise<Settings> {
	try {
		return JSON.parse(await readFile(settingsPath, "utf8")) as Settings;
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return {};
		throw error;
	}
}

export async function writeSettings(
	settingsPath: string,
	settings: Settings,
): Promise<void> {
	await mkdir(path.dirname(settingsPath), { recursive: true });
	await writeFile(
		settingsPath,
		`${JSON.stringify(settings, null, "\t")}\n`,
		"utf8",
	);
}

export function packageSource(entry: PackageEntry): string | undefined {
	return typeof entry === "string" ? entry : entry.source;
}

export function sameContextTreeRemote(source: string | undefined): boolean {
	if (!source) return false;
	return (
		source === contextTreeRemoteSource ||
		source === `${contextTreeRemoteSource}.git` ||
		source === "https://github.com/ZEDIUM-Off/pi-context-tree" ||
		source === "https://github.com/ZEDIUM-Off/pi-context-tree.git" ||
		source === "ZEDIUM-Off/pi-context-tree"
	);
}

export function disableRemoteContextTree(settings: Settings): Settings {
	const packages = Array.isArray(settings.packages)
		? [...settings.packages]
		: [];
	let sawRemote = false;
	const nextPackages = packages.map((entry) => {
		const source = packageSource(entry);
		if (!sameContextTreeRemote(source)) return entry;
		sawRemote = true;
		return {
			...(typeof entry === "string" ? { source: entry } : entry),
			source: contextTreeRemoteSource,
			extensions: [],
		};
	});
	if (!sawRemote)
		nextPackages.unshift({
			source: contextTreeRemoteSource,
			extensions: [],
		});
	return { ...settings, packages: nextPackages };
}
