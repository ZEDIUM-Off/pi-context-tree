export type SchemaRef = {
	raw: string | undefined;
	kind: "missing" | "local" | "github-release" | "github-dev" | "unknown";
	version?: string;
};

export function parseSchemaRef(raw: string | undefined): SchemaRef {
	if (!raw) return { raw, kind: "missing" };
	if (raw.startsWith("./") || raw.startsWith("../"))
		return { raw, kind: "local" };
	const release = raw.match(
		/githubusercontent\.com\/.+\/v([^/]+)\/schemas\/context\.schema\.json/,
	);
	if (release?.[1]) return { raw, kind: "github-release", version: release[1] };
	if (raw.includes("githubusercontent.com")) return { raw, kind: "github-dev" };
	return { raw, kind: "unknown" };
}

export function currentSchemaUrl(version = "0.2.0"): string {
	return `https://raw.githubusercontent.com/ZEDIUM-Off/pi-context-tree/v${version}/schemas/context.schema.json`;
}
