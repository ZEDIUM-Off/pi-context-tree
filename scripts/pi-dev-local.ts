import path from "node:path";
import {
	contextTreeRemoteSource,
	disableRemoteContextTree,
	type PackageEntry,
	packageSource,
	readSettings,
	type Settings,
	writeSettings,
} from "./pi-settings.js";

const settingsPath = path.join(process.cwd(), ".pi", "settings.json");
const localSource = "../";

function isLocal(source: string | undefined): boolean {
	return (
		source === localSource ||
		source === "." ||
		source === "./" ||
		source === ".."
	);
}

function withLocalOverride(settings: Settings): Settings {
	const disabled = disableRemoteContextTree(settings);
	const packages = Array.isArray(disabled.packages)
		? [...disabled.packages]
		: [];
	const nextPackages: PackageEntry[] = [];
	let sawLocal = false;

	for (const entry of packages) {
		const source = packageSource(entry);
		if (isLocal(source)) {
			sawLocal = true;
			nextPackages.push(
				typeof entry === "string"
					? localSource
					: { ...entry, source: localSource },
			);
			continue;
		}
		nextPackages.push(entry);
	}

	if (!sawLocal) nextPackages.push(localSource);
	return { ...disabled, packages: nextPackages };
}

const settings = await readSettings(settingsPath);
const nextSettings = withLocalOverride(settings);
await writeSettings(settingsPath, nextSettings);
console.log(`pi:dev local override ready in ${settingsPath}`);
console.log(
	`- ${contextTreeRemoteSource} extensions disabled at project scope`,
);
console.log(`- ${localSource} local package enabled`);
